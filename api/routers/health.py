"""
Health / status router for Templarc.

Mounted WITHOUT the /api prefix so it is accessible at /health for load
balancer probes. Also mounted at /api/health for API consumers.

  GET /health        — public; returns { status, version, uptime_seconds }
  GET /health/detail — org admin only; returns full HealthOut with component list
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import time
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from git import InvalidGitRepositoryError, Repo

from api.config import get_settings
from api.core.auth import TokenData, require_org_admin
from api.database import AsyncSessionLocal
from api.schemas.health import ComponentCheck, ComponentStatus, HealthOut

logger = logging.getLogger(__name__)
router = APIRouter()

# Process start time for uptime calculation
_START_TIME = time.monotonic()


# ---------------------------------------------------------------------------
# Component probes
# ---------------------------------------------------------------------------

async def _probe_database() -> ComponentCheck:
    """SELECT 1 against the database; required component."""
    from sqlalchemy import text
    t0 = time.monotonic()
    try:
        async with asyncio.timeout(3.0):
            async with AsyncSessionLocal() as session:
                await session.execute(text("SELECT 1"))
        latency_ms = int((time.monotonic() - t0) * 1000)
        return ComponentCheck(name="database", status="ok", latency_ms=latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - t0) * 1000)
        return ComponentCheck(name="database", status="error", message=str(exc)[:200], latency_ms=latency_ms)


async def _probe_git() -> ComponentCheck:
    """Check that TEMPLATES_REPO_PATH exists and is a valid git repo; optional (warn)."""
    import os
    settings = get_settings()
    t0 = time.monotonic()
    try:
        async with asyncio.timeout(3.0):
            path = settings.TEMPLATES_REPO_PATH
            if not os.path.isdir(path):
                return ComponentCheck(name="git", status="warn",
                                      message=f"Templates repo path not found: {path}",
                                      latency_ms=int((time.monotonic() - t0) * 1000))
            try:
                Repo(path)
            except InvalidGitRepositoryError:
                return ComponentCheck(name="git", status="warn",
                                      message=f"{path} is not a valid git repository",
                                      latency_ms=int((time.monotonic() - t0) * 1000))
        return ComponentCheck(name="git", status="ok",
                              latency_ms=int((time.monotonic() - t0) * 1000))
    except Exception as exc:
        return ComponentCheck(name="git", status="warn", message=str(exc)[:200],
                              latency_ms=int((time.monotonic() - t0) * 1000))


async def _probe_smtp() -> ComponentCheck | None:
    """SMTP connect + EHLO probe; optional (warn). Returns None when SMTP is disabled."""
    settings = get_settings()
    if not settings.SMTP_HOST:
        return None
    t0 = time.monotonic()
    try:
        async with asyncio.timeout(3.0):
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _smtp_ping, settings.SMTP_HOST, settings.SMTP_PORT)
        return ComponentCheck(name="smtp", status="ok",
                              latency_ms=int((time.monotonic() - t0) * 1000))
    except Exception as exc:
        return ComponentCheck(name="smtp", status="warn", message=str(exc)[:200],
                              latency_ms=int((time.monotonic() - t0) * 1000))


def _smtp_ping(host: str, port: int) -> None:
    """Synchronous SMTP connect + EHLO (no auth, no send)."""
    with smtplib.SMTP(host, port, timeout=3) as conn:
        conn.ehlo()


async def _probe_ai() -> ComponentCheck | None:
    """Ping AI provider; optional (warn). Returns None when AI is disabled."""
    settings = get_settings()
    if not settings.AI_PROVIDER:
        return None
    t0 = time.monotonic()
    try:
        import httpx
        async with asyncio.timeout(3.0):
            if settings.AI_PROVIDER == "anthropic":
                url = "https://api.anthropic.com/v1/models"
                headers = {"x-api-key": settings.AI_API_KEY, "anthropic-version": "2023-06-01"}
            else:
                url = f"{settings.AI_BASE_URL.rstrip('/')}/models"
                headers = {"Authorization": f"Bearer {settings.AI_API_KEY}"}
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code >= 500:
                    raise RuntimeError(f"HTTP {resp.status_code}")
        return ComponentCheck(name="ai", status="ok",
                              latency_ms=int((time.monotonic() - t0) * 1000))
    except Exception as exc:
        return ComponentCheck(name="ai", status="warn", message=str(exc)[:200],
                              latency_ms=int((time.monotonic() - t0) * 1000))


async def _collect_components() -> list[ComponentCheck]:
    """Run all component probes concurrently and return the list."""
    results: list[ComponentCheck | None] = await asyncio.gather(
        _probe_database(),
        _probe_git(),
        _probe_smtp(),
        _probe_ai(),
        return_exceptions=False,
    )
    return [r for r in results if r is not None]


def _overall_status(components: list[ComponentCheck]) -> ComponentStatus:
    """error if any required component failed; warn if any optional failed; else ok."""
    for c in components:
        if c.name == "database" and c.status == "error":
            return "error"
    for c in components:
        if c.status != "ok":
            return "warn"
    return "ok"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/health",
    summary="Health check (summary)",
    description="Public liveness probe. Returns overall status, version, and uptime. No auth required.",
    tags=["System"],
)
async def health_summary() -> dict[str, Any]:
    """Lightweight probe — runs DB check only for fast response."""
    settings = get_settings()
    db_check = await _probe_database()
    overall: ComponentStatus = db_check.status if db_check.status == "error" else "ok"
    uptime = time.monotonic() - _START_TIME
    payload: dict[str, Any] = {
        "status": overall,
        "version": settings.APP_VERSION,
        "uptime_seconds": round(uptime, 1),
    }
    if overall == "error":
        return JSONResponse(status_code=503, content=payload)
    return payload


@router.get(
    "/health/detail",
    response_model=HealthOut,
    summary="Health check (detail)",
    description="Full component-level health check. Requires org admin authentication.",
    tags=["System"],
)
async def health_detail(
    token: TokenData = Depends(require_org_admin),
) -> HealthOut:
    """Full probe — runs all component checks. Requires admin auth."""
    settings = get_settings()
    components = await _collect_components()
    overall = _overall_status(components)
    uptime = time.monotonic() - _START_TIME
    return HealthOut(
        status=overall,
        version=settings.APP_VERSION,
        uptime_seconds=round(uptime, 1),
        components=components,
    )
