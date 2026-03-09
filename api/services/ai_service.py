"""
AI provider abstraction for the Templarc template assistant.

Implements two providers via raw httpx streaming — no additional SDKs needed:
  - AnthropicProvider  → POST https://api.anthropic.com/v1/messages  (SSE)
  - OpenAICompatibleProvider → POST {base_url}/chat/completions      (SSE)

Both providers implement the same interface: an async generator that yields
plain text chunks as they stream from the remote API.

Usage:
    from api.services.ai_service import get_provider, build_system_prompt

    provider = get_provider()      # None when AI_PROVIDER is empty / disabled
    if provider:
        async for chunk in provider.stream(system, user_prompt):
            ...
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

import httpx

from api.config import get_settings

# ---------------------------------------------------------------------------
# System prompt builder
# ---------------------------------------------------------------------------

_SYSTEM_TEMPLATE = """\
You are a Jinja2 template expert for Templarc, a general-purpose \
provisioning and text-generation system.

Your task: generate a Jinja2 template body based on the user's description.

RULES — follow all of them strictly:
1. Output ONLY the raw Jinja2 body. No YAML frontmatter. No markdown. No code fences.
2. Use the registered parameter names provided below when they match the \
concept needed. If a suitable registered parameter exists, prefer it over \
inventing a new name.
3. You may introduce new parameter names using dot-notation (e.g. \
ospf.area, bgp.peer_ip). Keep them short, lowercase, and descriptive.
4. Use Jinja2 syntax — not Python. Use {{% if %}}, {{% for %}}, \
{{{{ variable }}}}, {{# comment #}}.
5. Available custom filters: {filters}. \
Use them where they naturally apply. Do not invent other custom filter names.
6. Add {{# inline comments #}} for non-obvious blocks only.
7. Keep output clean and production-ready. No TODO placeholders.

REGISTERED PARAMETERS (prefer these names):
{params}

{existing_section}\
"""


def build_system_prompt(
    registered_params: list[str],
    custom_filters: list[str],
    existing_body: str | None = None,
) -> str:
    params_block = "\n".join(f"  - {p}" for p in registered_params) or "  (none yet)"
    filters_block = ", ".join(custom_filters) if custom_filters else "none (Jinja2 builtins only)"
    existing_section = (
        f"EXISTING BODY (improve or extend it — do not simply repeat it unchanged):\n{existing_body}\n"
        if existing_body
        else ""
    )
    return _SYSTEM_TEMPLATE.format(
        params=params_block,
        filters=filters_block,
        existing_section=existing_section,
    )


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class AIProvider(ABC):
    @abstractmethod
    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]: ...


# ---------------------------------------------------------------------------
# Anthropic provider (Messages API, SSE)
# ---------------------------------------------------------------------------


class AnthropicProvider(AIProvider):
    _BASE = "https://api.anthropic.com/v1/messages"
    _VERSION = "2023-06-01"

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": self._VERSION,
            "content-type": "application/json",
        }
        body = {
            "model": self._model,
            "max_tokens": 4096,
            "stream": True,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", self._BASE, headers=headers, json=body) as resp:
                if not resp.is_success:
                    body_text = await resp.aread()
                    try:
                        detail = json.loads(body_text)
                        msg = detail.get("error", {}).get("message") or detail.get("message") or body_text.decode()
                    except Exception:
                        msg = body_text.decode(errors="replace")
                    raise ValueError(f"Anthropic returned {resp.status_code}: {msg}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    # content_block_delta carries text chunks
                    if event.get("type") == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            yield delta.get("text", "")


# ---------------------------------------------------------------------------
# OpenAI-compatible provider (chat completions, SSE)
# ---------------------------------------------------------------------------


class OpenAICompatibleProvider(AIProvider):
    def __init__(self, api_key: str, model: str, base_url: str) -> None:
        self._api_key = api_key
        self._model = model
        # Strip trailing /chat/completions if the user accidentally included
        # the full endpoint path in the base URL (a common misconfiguration).
        base = base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            base = base[: -len("/chat/completions")]
        self._base_url = base

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        url = f"{self._base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "content-type": "application/json",
        }
        body = {
            "model": self._model,
            "stream": True,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if not resp.is_success:
                    body_text = await resp.aread()
                    try:
                        detail = json.loads(body_text).get("error", {})
                        msg = detail.get("message") or detail if isinstance(detail, str) else body_text.decode()
                    except Exception:
                        msg = body_text.decode(errors="replace")
                    raise ValueError(f"Provider returned {resp.status_code}: {msg}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    text = event.get("choices", [{}])[0].get("delta", {}).get("content")
                    if text:
                        yield text


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_provider_from_config(
    provider: str,
    api_key: str,
    model: str,
    base_url: str,
) -> AIProvider | None:
    """
    Return an AI provider from explicit config values.

    Called by the router after resolving DB-vs-env precedence via settings_service.
    Returns None when provider is empty (AI disabled).
    Raises ValueError for unknown provider names or missing api_key.
    """
    p = provider.lower().strip()

    if not p:
        return None

    if p == "anthropic":
        if not api_key:
            raise ValueError("AI_API_KEY must be set when AI_PROVIDER=anthropic")
        return AnthropicProvider(api_key=api_key, model=model)

    if p == "openai":
        if not api_key:
            raise ValueError("AI_API_KEY must be set when AI_PROVIDER=openai")
        return OpenAICompatibleProvider(api_key=api_key, model=model, base_url=base_url)

    raise ValueError(f"Unknown AI_PROVIDER {provider!r}. Use 'anthropic', 'openai', or leave empty to disable.")


def get_provider() -> AIProvider | None:
    """Return the configured AI provider reading directly from env. Used in tests/CLI."""
    s = get_settings()
    return get_provider_from_config(
        provider=s.AI_PROVIDER,
        api_key=s.AI_API_KEY,
        model=s.AI_MODEL,
        base_url=s.AI_BASE_URL,
    )
