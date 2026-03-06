"""
Data Source Resolver for Templarc.

Processes the ``data_sources`` block from a template's YAML frontmatter and
enriches parameter metadata with values fetched from remote HTTP APIs.

High-level flow
---------------
1.  Template frontmatter declares zero or more data sources.
2.  ``resolve_on_load``  — called when a form first renders; fetches all
    sources whose trigger is ``"on_load"`` in parallel (asyncio.gather).
3.  ``resolve_on_change`` — called when the user edits a parameter; fetches
    all sources whose trigger matches ``"on_change:<param_name>"``.  Auto-fill
    targets can themselves trigger further sources (cascading), with a *visited*
    set preventing infinite loops.

Each source resolution:
- Renders the URL template (Jinja2) with current parameter values.
- Resolves the ``auth`` secret reference via ``SecretResolver``.
- Checks the in-process TTL cache before issuing an HTTP request.
- Applies JSONPath mappings to extract parameter enrichments.
- Respects ``on_error: warn|block``.

Cache
-----
Module-level dict ``_CACHE`` keyed by ``"<rendered_url>:<params_json>"``.
Values are ``(data, expiry_monotonic_timestamp)`` tuples.  Good enough for
a single-process API; swap for Redis in a multi-process deployment.

SSRF note
---------
``settings.ALLOW_PRIVATE_DATASOURCE_URLS`` (default False) is checked before
each HTTP request.  Private/loopback hostnames are rejected unless explicitly
allowed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, TypedDict

import httpx
from jinja2 import Environment, Undefined
from jsonpath_ng.ext import parse as jsonpath_parse

from api.config import get_settings
from api.core.secrets import SecretNotFoundError, SecretResolver

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class DataSourceError(Exception):
    """Raised when a data source fetch fails and on_error is set to 'block'."""


# ---------------------------------------------------------------------------
# Data models (parsed from YAML frontmatter)
# ---------------------------------------------------------------------------

@dataclass
class MappingConfig:
    """A single JSONPath → parameter mapping within a data source."""
    remote_field: str           # JSONPath expression, e.g. "results[0].site.id"
    to_parameter: str           # target parameter name, e.g. "router.site_id"
    auto_fill: bool = False     # if True, pre-populate the parameter value
    widget_override: str | None = None  # e.g. "readonly"


@dataclass
class DataSourceConfig:
    """Represents one entry in a template's ``data_sources`` frontmatter block."""
    id: str
    url: str                    # Jinja2 template string, e.g. "https://host/api?q={{ router.hostname }}"
    trigger: str                # "on_load" or "on_change:<param_name>"
    auth: str | None = None     # secret ref, e.g. "env:TOKEN" or "secret:netbox_api"
    on_error: str = "warn"      # "warn" or "block"
    cache_ttl: int = 60         # seconds; 0 disables caching
    mapping: list[MappingConfig] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Enrichment output type
# ---------------------------------------------------------------------------

class ParameterEnrichment(TypedDict):
    prefill: Any                # value to pre-fill the form field
    options: list[dict]         # [{value, label}] for select/dropdown widgets
    source_id: str              # which data source produced this
    readonly: bool              # True when widget_override == "readonly"


# ---------------------------------------------------------------------------
# Module-level TTL cache
# ---------------------------------------------------------------------------

# key → (raw_json_data, expiry_monotonic_timestamp)
_CACHE: dict[str, tuple[Any, float]] = {}


def _cache_get(key: str) -> Any | None:
    """Return cached data if present and not expired; else None."""
    entry = _CACHE.get(key)
    if entry is None:
        return None
    data, expiry = entry
    if time.monotonic() < expiry:
        return data
    del _CACHE[key]
    return None


def _cache_set(key: str, data: Any, ttl: int) -> None:
    if ttl > 0:
        _CACHE[key] = (data, time.monotonic() + ttl)


def clear_cache() -> None:
    """Flush the in-process cache (useful in tests)."""
    _CACHE.clear()


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def _flatten_to_nested(params: dict[str, Any]) -> dict[str, Any]:
    """
    Convert flat dot-notation param keys to a nested dict suitable for Jinja2.

    Example::
        {"router.hostname": "r1", "router.site_id": "42"}
        → {"router": {"hostname": "r1", "site_id": "42"}}
    """
    result: dict[str, Any] = {}
    for key, value in params.items():
        parts = key.split(".")
        d = result
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = value
    return result


def _render_url(url_template: str, params: dict[str, Any]) -> str:
    """Render *url_template* (a Jinja2 string) with *params*."""
    env = Environment(undefined=Undefined)
    return env.from_string(url_template).render(**_flatten_to_nested(params))


# ---------------------------------------------------------------------------
# SSRF guard
# ---------------------------------------------------------------------------

_PRIVATE_PATTERNS = re.compile(
    r"^("
    r"localhost"
    r"|127\.\d+\.\d+\.\d+"
    r"|10\.\d+\.\d+\.\d+"
    r"|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+"
    r"|192\.168\.\d+\.\d+"
    r"|::1"
    r")$",
    re.IGNORECASE,
)


def _check_ssrf(url: str) -> None:
    """Raise DataSourceError if the URL targets a private address and SSRF is disabled."""
    settings = get_settings()
    if settings.ALLOW_PRIVATE_DATASOURCE_URLS:
        return
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
    except Exception:
        return
    if _PRIVATE_PATTERNS.match(host):
        raise DataSourceError(
            f"SSRF protection: URL {url!r} targets a private/loopback address. "
            "Set ALLOW_PRIVATE_DATASOURCE_URLS=true to permit this."
        )


# ---------------------------------------------------------------------------
# DataSourceResolver
# ---------------------------------------------------------------------------

class DataSourceResolver:
    """
    Resolves data source blocks from template frontmatter into parameter enrichments.

    Parameters
    ----------
    secret_resolver:
        A ``SecretResolver`` bound to the current user's DB session and org_id.
        Pass ``None`` if no sources use auth (safe for tests that don't need it).
    """

    def __init__(self, secret_resolver: SecretResolver | None = None) -> None:
        self._secrets = secret_resolver

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def resolve_on_load(
        self,
        data_sources: list[DataSourceConfig],
        current_params: dict[str, Any],
        template_id: str,
    ) -> dict[str, ParameterEnrichment]:
        """
        Resolve all ``on_load`` data sources in parallel.

        Returns a mapping of *parameter_name → ParameterEnrichment*.
        """
        on_load = [s for s in data_sources if s.trigger == "on_load"]
        if not on_load:
            return {}

        results = await asyncio.gather(
            *[self._resolve_one(src, current_params) for src in on_load],
            return_exceptions=False,
        )
        merged: dict[str, ParameterEnrichment] = {}
        for batch in results:
            merged.update(batch)
        return merged

    async def resolve_on_change(
        self,
        data_sources: list[DataSourceConfig],
        changed_param: str,
        current_params: dict[str, Any],
        visited: set[str] | None = None,
    ) -> dict[str, ParameterEnrichment]:
        """
        Resolve all sources triggered by *changed_param* changing.

        Cascades: if any auto_fill target is itself an ``on_change`` trigger
        for another source, that source is resolved too.  The *visited* set
        prevents infinite loops in circular cascade chains.
        """
        if visited is None:
            visited = set()
        if changed_param in visited:
            return {}
        visited.add(changed_param)

        trigger_key = f"on_change:{changed_param}"
        triggered = [s for s in data_sources if s.trigger == trigger_key]
        if not triggered:
            return {}

        merged: dict[str, ParameterEnrichment] = {}
        for source in triggered:
            enrichments = await self._resolve_one(source, current_params)
            merged.update(enrichments)

            # Cascade: auto_fill targets may themselves be on_change triggers.
            # Update params with newly filled values before cascading.
            updated_params = dict(current_params)
            for param_name, enrichment in enrichments.items():
                if enrichment.get("prefill") is not None:
                    updated_params[param_name] = enrichment["prefill"]

            for mapping in source.mapping:
                if mapping.auto_fill:
                    cascaded = await self.resolve_on_change(
                        data_sources,
                        mapping.to_parameter,
                        updated_params,
                        visited,
                    )
                    merged.update(cascaded)

        return merged

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _resolve_one(
        self,
        source: DataSourceConfig,
        current_params: dict[str, Any],
    ) -> dict[str, ParameterEnrichment]:
        """Fetch *source*, apply mappings, return enrichment dict."""
        raw = await self._fetch(source, current_params)
        if raw is None:
            return {}
        return _apply_mappings(source, raw)

    async def _fetch(
        self,
        source: DataSourceConfig,
        current_params: dict[str, Any],
    ) -> Any | None:
        """
        Render URL, check cache, issue HTTP GET, store in cache.

        Returns raw JSON data or None if the request failed and
        ``on_error == "warn"``.  Raises ``DataSourceError`` if
        ``on_error == "block"``.
        """
        url = _render_url(source.url, current_params)
        cache_key = f"{url}:{json.dumps(current_params, sort_keys=True)}"

        cached = _cache_get(cache_key)
        if cached is not None:
            logger.debug("Cache hit for data source %r (key=%r)", source.id, cache_key)
            return cached

        _check_ssrf(url)

        headers: dict[str, str] = {}
        if source.auth:
            try:
                if self._secrets is None:
                    raise SecretNotFoundError("No SecretResolver configured")
                token = await self._secrets.resolve(source.auth)
                headers["Authorization"] = f"Bearer {token}"
            except SecretNotFoundError as exc:
                return self._handle_error(source, f"auth resolution failed: {exc}")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            return self._handle_error(source, str(exc))

        _cache_set(cache_key, data, source.cache_ttl)
        return data

    @staticmethod
    def _handle_error(source: DataSourceConfig, detail: str) -> None:
        """Apply on_error policy — return None for warn, raise for block."""
        if source.on_error == "block":
            raise DataSourceError(
                f"Data source {source.id!r} failed: {detail}"
            )
        logger.warning("Data source %r failed (on_error=warn): %s", source.id, detail)
        return None


# ---------------------------------------------------------------------------
# JSONPath mapping (pure, no IO)
# ---------------------------------------------------------------------------

def _apply_mappings(
    source: DataSourceConfig,
    raw_data: Any,
) -> dict[str, ParameterEnrichment]:
    """
    Walk *source.mapping* and extract values from *raw_data* via JSONPath.

    Returns a dict keyed by target parameter name.
    """
    result: dict[str, ParameterEnrichment] = {}

    for mapping in source.mapping:
        try:
            expr = jsonpath_parse(mapping.remote_field)
            matches = expr.find(raw_data)
        except Exception as exc:
            logger.warning(
                "JSONPath parse error in source %r field %r: %s",
                source.id, mapping.remote_field, exc,
            )
            continue

        if not matches:
            continue

        value = matches[0].value
        enrichment: ParameterEnrichment = result.setdefault(
            mapping.to_parameter,
            {
                "prefill": None,
                "options": [],
                "source_id": source.id,
                "readonly": False,
            },
        )

        if mapping.auto_fill:
            enrichment["prefill"] = value

        if mapping.widget_override == "readonly":
            enrichment["readonly"] = True

    return result
