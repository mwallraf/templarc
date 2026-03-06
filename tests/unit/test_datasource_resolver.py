"""
Unit tests for api.services.datasource_resolver.

Scenarios covered:
  _render_url              — static URL, Jinja2 substitution, dot-notation params
  _apply_mappings          — auto_fill, readonly widget_override, bad JSONPath, no match
  resolve_on_load          — parallel fetch (gather), empty when no on_load sources
  caching                  — cache hit, cache expiry, cache disabled (ttl=0)
  on_error: warn           — HTTP error returns empty enrichment, no raise
  on_error: block          — HTTP error raises DataSourceError
  auth                     — Authorization header injected from SecretResolver
  SSRF guard               — private URL rejected when ALLOW_PRIVATE=False
  resolve_on_change        — basic trigger, visited set loop prevention, cascade
"""

from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from api.services.datasource_resolver import (
    DataSourceConfig,
    DataSourceError,
    DataSourceResolver,
    MappingConfig,
    ParameterEnrichment,
    _apply_mappings,
    _render_url,
    clear_cache,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_source(
    id_: str = "src",
    url: str = "https://example.com/api",
    trigger: str = "on_load",
    on_error: str = "warn",
    auth: str | None = None,
    cache_ttl: int = 60,
    mappings: list[MappingConfig] | None = None,
) -> DataSourceConfig:
    return DataSourceConfig(
        id=id_,
        url=url,
        trigger=trigger,
        auth=auth,
        on_error=on_error,
        cache_ttl=cache_ttl,
        mapping=mappings or [],
    )


def mock_response(data: Any, status: int = 200) -> httpx.Response:
    request = httpx.Request("GET", "https://example.com")
    return httpx.Response(status_code=status, json=data, request=request)


@pytest.fixture(autouse=True)
def _clear_cache():
    """Ensure each test starts with a clean cache."""
    clear_cache()
    yield
    clear_cache()


# ===========================================================================
# _render_url
# ===========================================================================

class TestRenderUrl:
    def test_static_url(self):
        assert _render_url("https://example.com/api", {}) == "https://example.com/api"

    def test_simple_substitution(self):
        url = "https://host/api?q={{ name }}"
        result = _render_url(url, {"name": "myrouter"})
        assert result == "https://host/api?q=myrouter"

    def test_dot_notation_param(self):
        url = "https://host/devices?name={{ router.hostname }}"
        result = _render_url(url, {"router.hostname": "r1.example.com"})
        assert result == "https://host/devices?name=r1.example.com"

    def test_multiple_params(self):
        url = "https://host/api/{{ site.id }}/devices/{{ router.hostname }}"
        result = _render_url(url, {"site.id": "42", "router.hostname": "r1"})
        assert result == "https://host/api/42/devices/r1"


# ===========================================================================
# _apply_mappings
# ===========================================================================

class TestApplyMappings:
    def test_auto_fill(self):
        source = make_source(mappings=[
            MappingConfig("results[0].name", "router.hostname", auto_fill=True),
        ])
        data = {"results": [{"name": "myrouter"}]}
        result = _apply_mappings(source, data)
        assert "router.hostname" in result
        assert result["router.hostname"]["prefill"] == "myrouter"
        assert result["router.hostname"]["source_id"] == "src"

    def test_readonly_widget_override(self):
        source = make_source(mappings=[
            MappingConfig("role", "router.role", auto_fill=False, widget_override="readonly"),
        ])
        data = {"role": "edge"}
        result = _apply_mappings(source, data)
        assert result["router.role"]["readonly"] is True
        assert result["router.role"]["prefill"] is None  # auto_fill=False

    def test_no_match_skipped(self):
        source = make_source(mappings=[
            MappingConfig("results[99].name", "router.hostname", auto_fill=True),
        ])
        result = _apply_mappings(source, {"results": [{"name": "r1"}]})
        # index 99 doesn't exist → no enrichment
        assert "router.hostname" not in result

    def test_bad_jsonpath_skipped(self):
        source = make_source(mappings=[
            MappingConfig("???invalid???", "router.hostname", auto_fill=True),
        ])
        # Should not raise; bad path is logged and skipped
        result = _apply_mappings(source, {"results": []})
        assert result == {}

    def test_nested_jsonpath(self):
        source = make_source(mappings=[
            MappingConfig("site.id", "router.site_id", auto_fill=True),
        ])
        data = {"site": {"id": 7}}
        result = _apply_mappings(source, data)
        assert result["router.site_id"]["prefill"] == 7


# ===========================================================================
# resolve_on_load — basic
# ===========================================================================

class TestResolveOnLoad:
    @pytest.mark.asyncio
    async def test_empty_when_no_on_load_sources(self):
        resolver = DataSourceResolver()
        sources = [make_source(trigger="on_change:router.hostname")]
        result = await resolver.resolve_on_load(sources, {}, "tmpl-1")
        assert result == {}

    @pytest.mark.asyncio
    async def test_single_source_happy_path(self):
        mappings = [MappingConfig("results[0].name", "router.hostname", auto_fill=True)]
        source = make_source(trigger="on_load", mappings=mappings)
        resolver = DataSourceResolver()

        response_data = {"results": [{"name": "r1.example.com"}]}
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = AsyncMock(return_value=mock_response(response_data))
            result = await resolver.resolve_on_load([source], {}, "tmpl-1")

        assert result["router.hostname"]["prefill"] == "r1.example.com"

    @pytest.mark.asyncio
    async def test_parallel_fetch(self):
        """Both on_load sources are fetched; results merged."""
        s1 = make_source("s1", trigger="on_load", mappings=[
            MappingConfig("v", "param.a", auto_fill=True),
        ])
        s2 = make_source("s2", url="https://other.com/api", trigger="on_load", mappings=[
            MappingConfig("v", "param.b", auto_fill=True),
        ])
        resolver = DataSourceResolver()

        call_count = 0

        async def fake_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response({"v": f"val-{call_count}"})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            result = await resolver.resolve_on_load([s1, s2], {}, "tmpl-1")

        assert "param.a" in result
        assert "param.b" in result
        assert call_count == 2


# ===========================================================================
# Caching
# ===========================================================================

class TestCaching:
    @pytest.mark.asyncio
    async def test_cache_hit_skips_http(self):
        mappings = [MappingConfig("v", "p", auto_fill=True)]
        source = make_source(trigger="on_load", cache_ttl=60, mappings=mappings)
        resolver = DataSourceResolver()

        call_count = 0

        async def fake_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response({"v": "cached-value"})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            await resolver.resolve_on_load([source], {}, "t")
            await resolver.resolve_on_load([source], {}, "t")

        assert call_count == 1  # second call served from cache

    @pytest.mark.asyncio
    async def test_cache_expiry_refetches(self):
        mappings = [MappingConfig("v", "p", auto_fill=True)]
        source = make_source(trigger="on_load", cache_ttl=1, mappings=mappings)
        resolver = DataSourceResolver()
        call_count = 0

        async def fake_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response({"v": call_count})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get

            await resolver.resolve_on_load([source], {}, "t")

            # Simulate cache expiry by back-dating the stored timestamp
            from api.services.datasource_resolver import _CACHE
            for key in list(_CACHE):
                data, _exp = _CACHE[key]
                _CACHE[key] = (data, time.monotonic() - 1)

            await resolver.resolve_on_load([source], {}, "t")

        assert call_count == 2

    @pytest.mark.asyncio
    async def test_cache_disabled_when_ttl_zero(self):
        mappings = [MappingConfig("v", "p", auto_fill=True)]
        source = make_source(trigger="on_load", cache_ttl=0, mappings=mappings)
        resolver = DataSourceResolver()
        call_count = 0

        async def fake_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response({"v": call_count})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            await resolver.resolve_on_load([source], {}, "t")
            await resolver.resolve_on_load([source], {}, "t")

        assert call_count == 2


# ===========================================================================
# on_error handling
# ===========================================================================

class TestOnError:
    @pytest.mark.asyncio
    async def test_on_error_warn_returns_empty(self):
        source = make_source(trigger="on_load", on_error="warn")
        resolver = DataSourceResolver()

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
            result = await resolver.resolve_on_load([source], {}, "t")

        assert result == {}  # no enrichment, no exception

    @pytest.mark.asyncio
    async def test_on_error_block_raises(self):
        source = make_source(trigger="on_load", on_error="block")
        resolver = DataSourceResolver()

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
            with pytest.raises(DataSourceError, match="src"):
                await resolver.resolve_on_load([source], {}, "t")

    @pytest.mark.asyncio
    async def test_http_error_status_on_error_warn(self):
        source = make_source(trigger="on_load", on_error="warn")
        resolver = DataSourceResolver()

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            # 500 response — raise_for_status will raise
            instance.get = AsyncMock(return_value=mock_response({}, status=500))
            result = await resolver.resolve_on_load([source], {}, "t")

        assert result == {}


# ===========================================================================
# Auth header injection
# ===========================================================================

class TestAuth:
    @pytest.mark.asyncio
    async def test_auth_header_injected(self):
        source = make_source(
            trigger="on_load",
            auth="env:MY_TOKEN",
            mappings=[MappingConfig("v", "p", auto_fill=True)],
        )
        mock_secrets = AsyncMock()
        mock_secrets.resolve = AsyncMock(return_value="secret-token")
        resolver = DataSourceResolver(secret_resolver=mock_secrets)

        captured_headers: dict = {}

        async def fake_get(url, headers=None, **kwargs):
            captured_headers.update(headers or {})
            return mock_response({"v": "x"})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            await resolver.resolve_on_load([source], {}, "t")

        assert captured_headers.get("Authorization") == "Bearer secret-token"

    @pytest.mark.asyncio
    async def test_auth_failure_warn(self):
        from api.core.secrets import SecretNotFoundError
        source = make_source(trigger="on_load", auth="env:MISSING", on_error="warn")
        mock_secrets = AsyncMock()
        mock_secrets.resolve = AsyncMock(side_effect=SecretNotFoundError("not set"))
        resolver = DataSourceResolver(secret_resolver=mock_secrets)

        result = await resolver.resolve_on_load([source], {}, "t")
        assert result == {}


# ===========================================================================
# SSRF guard
# ===========================================================================

class TestSsrfGuard:
    @pytest.mark.asyncio
    async def test_private_url_rejected_by_default(self):
        source = make_source(url="http://192.168.1.1/api", trigger="on_load", on_error="block")
        resolver = DataSourceResolver()

        with patch("api.services.datasource_resolver.get_settings") as mock_settings:
            mock_settings.return_value.ALLOW_PRIVATE_DATASOURCE_URLS = False
            with pytest.raises(DataSourceError, match="SSRF"):
                await resolver.resolve_on_load([source], {}, "t")

    @pytest.mark.asyncio
    async def test_private_url_allowed_when_flag_set(self):
        source = make_source(
            url="http://192.168.1.1/api",
            trigger="on_load",
            on_error="warn",
            mappings=[MappingConfig("v", "p", auto_fill=True)],
        )
        resolver = DataSourceResolver()

        with patch("api.services.datasource_resolver.get_settings") as mock_settings:
            mock_settings.return_value.ALLOW_PRIVATE_DATASOURCE_URLS = True
            with patch("httpx.AsyncClient") as MockClient:
                instance = MockClient.return_value.__aenter__.return_value
                instance.get = AsyncMock(return_value=mock_response({"v": "ok"}))
                result = await resolver.resolve_on_load([source], {}, "t")

        assert result["p"]["prefill"] == "ok"


# ===========================================================================
# resolve_on_change — basic + cascade + loop prevention
# ===========================================================================

class TestResolveOnChange:
    @pytest.mark.asyncio
    async def test_basic_on_change(self):
        source = make_source(
            trigger="on_change:router.hostname",
            mappings=[MappingConfig("site", "router.site_id", auto_fill=True)],
        )
        resolver = DataSourceResolver()

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = AsyncMock(return_value=mock_response({"site": 42}))
            result = await resolver.resolve_on_change(
                [source], "router.hostname", {"router.hostname": "r1"}, None
            )

        assert result["router.site_id"]["prefill"] == 42

    @pytest.mark.asyncio
    async def test_non_matching_trigger_ignored(self):
        source = make_source(trigger="on_change:other.param")
        resolver = DataSourceResolver()
        result = await resolver.resolve_on_change([source], "router.hostname", {}, None)
        assert result == {}

    @pytest.mark.asyncio
    async def test_visited_prevents_loop(self):
        """A source whose auto_fill target is the same changed_param must not loop."""
        source = make_source(
            id_="s1",
            trigger="on_change:param.a",
            mappings=[MappingConfig("v", "param.a", auto_fill=True)],  # fills param.a itself
        )
        resolver = DataSourceResolver()
        call_count = 0

        async def fake_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response({"v": "looped"})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            result = await resolver.resolve_on_change([source], "param.a", {}, None)

        # Called exactly once; cascade back to param.a is prevented by visited set
        assert call_count == 1
        assert result["param.a"]["prefill"] == "looped"

    @pytest.mark.asyncio
    async def test_cascade_on_change(self):
        """
        Changing router.hostname triggers s1, which fills router.site_id.
        router.site_id change triggers s2, which fills router.role.
        """
        s1 = make_source(
            id_="s1",
            url="https://host/s1",
            trigger="on_change:router.hostname",
            mappings=[MappingConfig("site_id", "router.site_id", auto_fill=True)],
        )
        s2 = make_source(
            id_="s2",
            url="https://host/s2",
            trigger="on_change:router.site_id",
            mappings=[MappingConfig("role", "router.role", auto_fill=True)],
        )
        resolver = DataSourceResolver()

        async def fake_get(url, **kwargs):
            if "s1" in url:
                return mock_response({"site_id": 7})
            return mock_response({"role": "edge"})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            result = await resolver.resolve_on_change(
                [s1, s2], "router.hostname", {"router.hostname": "r1"}, None
            )

        assert result["router.site_id"]["prefill"] == 7
        assert result["router.role"]["prefill"] == "edge"

    @pytest.mark.asyncio
    async def test_cascade_loop_between_two_sources(self):
        """
        s1: on_change:a fills b  (auto_fill)
        s2: on_change:b fills a  (auto_fill)
        Should resolve both once, not loop.
        """
        s1 = make_source(
            id_="s1",
            url="https://host/s1",
            trigger="on_change:a",
            mappings=[MappingConfig("v", "b", auto_fill=True)],
        )
        s2 = make_source(
            id_="s2",
            url="https://host/s2",
            trigger="on_change:b",
            mappings=[MappingConfig("v", "a", auto_fill=True)],
        )
        resolver = DataSourceResolver()
        call_count = 0

        async def fake_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_response({"v": call_count})

        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = fake_get
            result = await resolver.resolve_on_change([s1, s2], "a", {}, None)

        # s1 runs (a → visited), then cascades to b → s2 runs (b → visited),
        # then tries to cascade back to a, but a is in visited → stops.
        assert call_count == 2
        assert "b" in result
        assert "a" in result
