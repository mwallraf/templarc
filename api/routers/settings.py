"""
System settings router.

GET  /settings/ai        — read effective AI settings (admin only)
PUT  /settings/ai        — save AI settings to DB (admin only)
POST /settings/ai/test   — test current AI configuration (admin only)

Settings follow DB-wins-over-env precedence:
  env var  →  DB override  (DB wins when set)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, require_admin
from api.database import get_db
from api.schemas.system_settings import AISettingsOut, AISettingsUpdate, AITestResult
from api.services import settings_service
from api.services.ai_service import get_provider_from_config

router = APIRouter()


@router.get(
    "/ai",
    response_model=AISettingsOut,
    summary="Get effective AI settings",
    description=(
        "Returns the resolved AI configuration. DB overrides take precedence over "
        "environment variables. The API key value is never returned — only whether "
        "a key is configured and from which source."
    ),
)
async def get_ai_settings(
    current_user: TokenData = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AISettingsOut:
    return await settings_service.get_ai_settings(db, current_user.org_id)


@router.put(
    "/ai",
    response_model=AISettingsOut,
    summary="Save AI settings",
    description=(
        "Persists AI settings to the database for this organisation. "
        "Pass ``null`` for a field to leave it unchanged. "
        "Pass an empty string to clear a DB override and revert to the env fallback."
    ),
)
async def update_ai_settings(
    body: AISettingsUpdate,
    current_user: TokenData = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AISettingsOut:
    await settings_service.save_ai_settings(
        db=db,
        org_id=current_user.org_id,
        updated_by=current_user.sub,
        provider=body.provider,
        api_key=body.api_key,
        model=body.model,
        base_url=body.base_url,
    )
    await db.commit()
    return await settings_service.get_ai_settings(db, current_user.org_id)


@router.post(
    "/ai/test",
    response_model=AITestResult,
    status_code=status.HTTP_200_OK,
    summary="Test AI configuration",
    description="Validates the current AI settings by resolving them and checking the provider is instantiable.",
)
async def test_ai_settings(
    current_user: TokenData = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AITestResult:
    cfg = await settings_service.get_resolved_ai_config(db, current_user.org_id)
    try:
        provider = get_provider_from_config(**cfg)
        enabled = provider is not None
        error = None
    except ValueError as exc:
        enabled = False
        error = str(exc)

    return AITestResult(
        enabled=enabled,
        provider=cfg["provider"] or None,
        model=cfg["model"] if enabled else None,
        error=error,
    )
