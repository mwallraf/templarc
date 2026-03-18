"""
System settings service.

Implements the DB-wins-over-env precedence rule:
  - On read: merge DB row with env defaults; DB non-null values override env.
  - On write: upsert the DB row for the given org.

If no DB row exists for an org the service transparently falls back to env,
so the application works correctly on a fresh install before any UI save.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings
from api.models.system_settings import SystemSettings
from api.schemas.system_settings import (
    AISettingsOut, AISettingsSource,
    EmailSettingsOut, EmailSettingsSource,
)


async def _get_or_none(db: AsyncSession, org_id: int) -> SystemSettings | None:
    result = await db.execute(
        select(SystemSettings).where(SystemSettings.org_id == org_id)
    )
    return result.scalar_one_or_none()


async def get_ai_settings(db: AsyncSession, org_id: int) -> AISettingsOut:
    """
    Return the effective AI settings for an org.

    DB values win when non-None and non-empty; env is the fallback.
    """
    row = await _get_or_none(db, org_id)
    env = get_settings()

    def _resolve(db_val: str | None, env_val: str) -> tuple[str, str]:
        """Return (effective_value, source_label)."""
        if db_val is not None and db_val != "":
            return db_val, "db"
        return env_val, "env"

    provider, prov_src = _resolve(row.ai_provider if row else None, env.AI_PROVIDER)
    model, model_src = _resolve(row.ai_model if row else None, env.AI_MODEL)
    base_url, url_src = _resolve(row.ai_base_url if row else None, env.AI_BASE_URL)

    # API key — determine source
    db_key = row.ai_api_key if row else None
    if db_key:
        api_key_src = "db"
        api_key_configured = True
    elif env.AI_API_KEY:
        api_key_src = "env"
        api_key_configured = True
    else:
        api_key_src = "none"
        api_key_configured = False

    return AISettingsOut(
        provider=provider,
        model=model,
        base_url=base_url,
        api_key_configured=api_key_configured,
        source=AISettingsSource(
            provider=prov_src,
            api_key=api_key_src,
            model=model_src,
            base_url=url_src,
        ),
    )


async def get_resolved_ai_config(db: AsyncSession, org_id: int) -> dict[str, str]:
    """
    Return a plain dict of resolved AI config values for use by ai_service.

    Keys: provider, api_key, model, base_url — all strings (never None).
    """
    row = await _get_or_none(db, org_id)
    env = get_settings()

    def _pick(db_val: str | None, env_val: str) -> str:
        return db_val if (db_val is not None and db_val != "") else env_val

    # Resolve api_key separately (we need the actual value here)
    db_key = row.ai_api_key if row else None
    api_key = db_key if db_key else env.AI_API_KEY

    return {
        "provider": _pick(row.ai_provider if row else None, env.AI_PROVIDER),
        "api_key": api_key,
        "model": _pick(row.ai_model if row else None, env.AI_MODEL),
        "base_url": _pick(row.ai_base_url if row else None, env.AI_BASE_URL),
    }


async def save_ai_settings(
    db: AsyncSession,
    org_id: int,
    updated_by: str,
    provider: str | None,
    api_key: str | None,
    model: str | None,
    base_url: str | None,
) -> None:
    """
    Upsert AI settings for an org.

    None fields are left unchanged.  Empty-string fields clear the DB override
    (causing the env fallback to be used).
    """
    row = await _get_or_none(db, org_id)
    if row is None:
        row = SystemSettings(org_id=org_id)
        db.add(row)

    if provider is not None:
        row.ai_provider = provider
    if api_key is not None:
        row.ai_api_key = api_key  # "" clears the override
    if model is not None:
        row.ai_model = model
    if base_url is not None:
        row.ai_base_url = base_url

    row.updated_by = updated_by
    await db.flush()
    await db.refresh(row)


# ---------------------------------------------------------------------------
# Email / SMTP settings
# ---------------------------------------------------------------------------


async def get_email_settings(db: AsyncSession, org_id: str) -> EmailSettingsOut:
    row = await _get_or_none(db, org_id)
    env = get_settings()

    def _r(db_val: str | None, env_val: str) -> tuple[str, str]:
        if db_val is not None and db_val != "":
            return db_val, "db"
        return env_val, "env"

    def _ri(db_val: int | None, env_val: int) -> tuple[int, str]:
        if db_val is not None:
            return db_val, "db"
        return env_val, "env"

    host, host_src = _r(row.smtp_host if row else None, env.SMTP_HOST)
    port, port_src = _ri(row.smtp_port if row else None, env.SMTP_PORT)
    user, user_src = _r(row.smtp_user if row else None, env.SMTP_USER)
    from_, from_src = _r(row.smtp_from if row else None, env.SMTP_FROM)

    db_pw = row.smtp_password if row else None
    password_configured = bool(db_pw) or bool(env.SMTP_PASSWORD)

    return EmailSettingsOut(
        host=host,
        port=port,
        user=user,
        from_=from_,
        password_configured=password_configured,
        source=EmailSettingsSource(
            host=host_src,
            port=port_src,
            user=user_src,
            from_=from_src,
        ),
    )


async def get_resolved_email_config(db: AsyncSession, org_id: str) -> dict:
    """Return resolved SMTP config dict for constructing EmailService."""
    row = await _get_or_none(db, org_id)
    env = get_settings()

    def _p(db_val, env_val):
        return db_val if (db_val is not None and db_val != "") else env_val

    def _pi(db_val, env_val):
        return db_val if db_val is not None else env_val

    db_pw = row.smtp_password if row else None
    password = db_pw if db_pw else env.SMTP_PASSWORD

    return {
        "smtp_host": _p(row.smtp_host if row else None, env.SMTP_HOST),
        "smtp_port": _pi(row.smtp_port if row else None, env.SMTP_PORT),
        "smtp_user": _p(row.smtp_user if row else None, env.SMTP_USER),
        "smtp_password": password,
        "smtp_from": _p(row.smtp_from if row else None, env.SMTP_FROM),
    }


async def save_email_settings(
    db: AsyncSession,
    org_id: str,
    updated_by: str,
    host: str | None,
    port: int | None,
    user: str | None,
    password: str | None,
    from_: str | None,
) -> None:
    row = await _get_or_none(db, org_id)
    if row is None:
        row = SystemSettings(org_id=org_id)
        db.add(row)

    if host is not None:
        row.smtp_host = host
    if port is not None:
        row.smtp_port = port
    if user is not None:
        row.smtp_user = user
    if password is not None:
        row.smtp_password = password  # "" clears the override
    if from_ is not None:
        row.smtp_from = from_

    row.updated_by = updated_by
    await db.flush()
    await db.refresh(row)
