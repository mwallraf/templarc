"""
System settings router.

GET  /settings/ai         — read effective AI settings (admin only)
PUT  /settings/ai         — save AI settings to DB (admin only)
POST /settings/ai/test    — test current AI configuration (admin only)

GET  /settings/email      — read effective SMTP settings (admin only)
PUT  /settings/email      — save SMTP settings to DB (admin only)
POST /settings/email/test — send a test email (admin only)

Settings follow DB-wins-over-env precedence:
  env var  →  DB override  (DB wins when set)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, require_org_admin
from api.database import get_db
from api.schemas.system_settings import (
    AISettingsOut, AISettingsUpdate, AITestResult,
    EmailSettingsOut, EmailSettingsUpdate, EmailTestResult,
)
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
    current_user: TokenData = Depends(require_org_admin),
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
    current_user: TokenData = Depends(require_org_admin),
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
    current_user: TokenData = Depends(require_org_admin),
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


# ---------------------------------------------------------------------------
# Email / SMTP settings
# ---------------------------------------------------------------------------


@router.get(
    "/email",
    response_model=EmailSettingsOut,
    summary="Get effective SMTP settings",
)
async def get_email_settings(
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> EmailSettingsOut:
    return await settings_service.get_email_settings(db, current_user.org_id)


@router.put(
    "/email",
    response_model=EmailSettingsOut,
    summary="Save SMTP settings",
)
async def update_email_settings(
    body: EmailSettingsUpdate,
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> EmailSettingsOut:
    await settings_service.save_email_settings(
        db=db,
        org_id=current_user.org_id,
        updated_by=current_user.sub,
        host=body.host,
        port=body.port,
        user=body.user,
        password=body.password,
        from_=body.from_,
    )
    await db.commit()
    return await settings_service.get_email_settings(db, current_user.org_id)


@router.post(
    "/email/test",
    response_model=EmailTestResult,
    summary="Send a test email",
)
async def test_email_settings(
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> EmailTestResult:
    from api.core.email import EmailService
    cfg = await settings_service.get_resolved_email_config(db, current_user.org_id)
    svc = EmailService(**cfg)
    if not svc.enabled:
        return EmailTestResult(success=False, error="SMTP host is not configured.")
    try:
        # Find the current user's email to send the test to
        from sqlalchemy import select
        from api.models.user import User
        result = await db.execute(
            select(User).where(User.username == current_user.sub)
        )
        user = result.scalar_one_or_none()
        to_email = user.email if user and user.email else current_user.sub
        svc.send_password_reset(to_email, f"https://example.com/test-reset?token=test")
        return EmailTestResult(success=True, error=None)
    except Exception as exc:
        return EmailTestResult(success=False, error=str(exc))
