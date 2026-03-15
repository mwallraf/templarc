"""
Jinja2 Sandbox router — stateless, ephemeral template rendering.

Available to all authenticated users (no admin required). Nothing is stored.

Endpoints:
  POST /sandbox/render  — render a Jinja2 template string with a JSON context
  POST /sandbox/lint    — parse-check a template without rendering
"""

from __future__ import annotations

import logging
from typing import Any

import jinja2
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api.core.auth import TokenData, get_current_user
from api.jinja_filters import BUILTIN_FILTERS

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Shared sandbox Jinja2 environment
# No loader needed — we render from string every time.
# All Templarc builtin filters are available.
# ---------------------------------------------------------------------------

def _make_env() -> jinja2.Environment:
    env = jinja2.Environment(
        undefined=jinja2.Undefined,  # permissive — silently renders undefined as ""
        autoescape=False,
    )
    env.filters.update(BUILTIN_FILTERS)
    return env


_ENV = _make_env()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SandboxRenderRequest(BaseModel):
    template: str = Field(..., description="Jinja2 template string to render")
    context: dict[str, Any] | None = Field(
        None,
        description="JSON object injected as the template context. Keys become top-level variables.",
    )


class SandboxRenderResult(BaseModel):
    output: str
    error: str | None = None


class SandboxLintRequest(BaseModel):
    template: str = Field(..., description="Jinja2 template string to lint")


class SandboxLintResult(BaseModel):
    ok: bool
    error: str | None = None
    line: int | None = None
    col: int | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/render",
    response_model=SandboxRenderResult,
    summary="Render a Jinja2 template string with an optional JSON context",
    description=(
        "Stateless render — nothing is stored. "
        "All Templarc builtin filters (mb_to_kbps, b64encode, ipaddr, …) are available. "
        "Undefined variables silently render as empty strings."
    ),
)
async def sandbox_render(
    body: SandboxRenderRequest,
    _: TokenData = Depends(get_current_user),
) -> SandboxRenderResult:
    ctx = body.context or {}
    try:
        tmpl = _ENV.from_string(body.template)
        output = tmpl.render(**ctx)
        return SandboxRenderResult(output=output)
    except jinja2.TemplateSyntaxError as exc:
        return SandboxRenderResult(output="", error=f"SyntaxError (line {exc.lineno}): {exc.message}")
    except jinja2.TemplateError as exc:
        return SandboxRenderResult(output="", error=f"TemplateError: {exc}")
    except Exception as exc:
        logger.warning("Sandbox render error: %s", exc)
        return SandboxRenderResult(output="", error=str(exc))


@router.post(
    "/lint",
    response_model=SandboxLintResult,
    summary="Check Jinja2 template syntax without rendering",
)
async def sandbox_lint(
    body: SandboxLintRequest,
    _: TokenData = Depends(get_current_user),
) -> SandboxLintResult:
    try:
        _ENV.parse(body.template)
        return SandboxLintResult(ok=True)
    except jinja2.TemplateSyntaxError as exc:
        return SandboxLintResult(ok=False, error=exc.message, line=exc.lineno)
    except Exception as exc:
        return SandboxLintResult(ok=False, error=str(exc))
