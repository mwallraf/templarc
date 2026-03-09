"""
AI assistant router.

Endpoints:
  POST /ai/generate  — SSE stream of Jinja2 template tokens
  GET  /ai/status    — whether AI is configured (uses DB-resolved settings)

AI config is resolved with DB-wins-over-env precedence via settings_service.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, get_current_user
from api.database import get_db
from api.schemas.ai import AIGenerateRequest
from api.services.ai_service import build_system_prompt, get_provider_from_config
from api.services.settings_service import get_resolved_ai_config

router = APIRouter()


@router.post(
    "/generate",
    summary="Stream AI-generated Jinja2 template body",
    description=(
        "Accepts a natural-language prompt and streams back a Jinja2 template body "
        "as Server-Sent Events. Each SSE `data:` line carries a JSON-encoded text chunk. "
        "Returns `data: [DONE]` when the stream is complete. "
        "Returns HTTP 503 when AI is not configured."
    ),
)
async def generate(
    body: AIGenerateRequest,
    current_user: TokenData = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    cfg = await get_resolved_ai_config(db, current_user.org_id)
    try:
        provider = get_provider_from_config(**cfg)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI assistant is not configured. Set AI_PROVIDER in System → Settings or in your environment.",
        )

    system = build_system_prompt(
        registered_params=body.registered_params,
        custom_filters=body.custom_filters,
        existing_body=body.existing_body,
    )

    async def event_stream():
        try:
            async for chunk in provider.stream(system, body.prompt):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'__error__': str(exc)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/status",
    summary="Check whether the AI assistant is configured",
)
async def ai_status(
    current_user: TokenData = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    cfg = await get_resolved_ai_config(db, current_user.org_id)
    try:
        provider = get_provider_from_config(**cfg)
        enabled = provider is not None
        error = None
    except ValueError as exc:
        enabled = False
        error = str(exc)

    return {
        "enabled": enabled,
        "provider": cfg["provider"] or None,
        "model": cfg["model"] if enabled else None,
        "error": error,
    }
