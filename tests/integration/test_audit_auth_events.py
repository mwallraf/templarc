"""
Integration tests for auth event audit logging (Phase 14).

Tests:
  - POST /auth/login/local (valid creds) → audit_log has action="login", resource_type="auth"
  - POST /auth/login/local (invalid password) → audit_log has action="login_failed"
  - POST /auth/forgot-password → audit_log has action="password_reset_requested"
"""

from __future__ import annotations

import pytest
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_org_admin
from api.database import get_db, AsyncSessionLocal
from api.main import app
from api.models.audit_log import AuditLog
from api.models.organization import Organization
from api.models.user import User


class _FlushOnCommitSession(AsyncSession):
    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


@pytest.fixture
async def setup_user():
    """Create a test org and user for login tests."""
    import bcrypt as _bcrypt
    import uuid

    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    username = f"audituser_{uuid.uuid4().hex[:8]}"
    email = f"{username}@test.example.com"
    password = "TestPass123!"

    async with factory() as session:
        org = Organization(
            id=org_id,
            name=f"AuditOrg_{uuid.uuid4().hex[:6]}",
            slug=f"auditorg_{uuid.uuid4().hex[:6]}",
        )
        session.add(org)
        await session.flush()

        pw_hash = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()
        user = User(
            id=user_id,
            organization_id=org_id,
            username=username,
            email=email,
            password_hash=pw_hash,
            is_ldap=False,
            role="member",
            is_platform_admin=False,
        )
        session.add(user)
        await session.commit()

    yield {"username": username, "password": password, "email": email, "org_id": org_id, "user_id": user_id}

    # Cleanup
    async with factory() as session:
        await session.execute(
            AuditLog.__table__.delete().where(AuditLog.user_sub == username)
        )
        result = await session.execute(select(User).where(User.id == user_id))
        u = result.scalar_one_or_none()
        if u:
            await session.delete(u)
        result = await session.execute(select(Organization).where(Organization.id == org_id))
        o = result.scalar_one_or_none()
        if o:
            await session.delete(o)
        await session.commit()

    await engine.dispose()


@pytest.fixture
async def auth_client():
    """HTTP client with no auth overrides (real auth flow)."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c


@pytest.mark.asyncio
async def test_successful_login_creates_audit_log(setup_user, auth_client):
    """Successful local login creates audit_log with action='login', resource_type='auth'."""
    user = setup_user
    resp = await auth_client.post(
        "/auth/login/local",
        json={"username": user["username"], "password": user["password"]},
    )
    assert resp.status_code == 200, resp.text

    # Check audit log
    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_sub == user["username"])
            .where(AuditLog.action == "login")
            .where(AuditLog.resource_type == "auth")
        )
        log_entry = result.scalar_one_or_none()
    await engine.dispose()

    assert log_entry is not None
    assert log_entry.changes.get("method") == "local"


@pytest.mark.asyncio
async def test_failed_login_creates_audit_log(setup_user, auth_client):
    """Failed local login creates audit_log with action='login_failed'."""
    user = setup_user
    resp = await auth_client.post(
        "/auth/login/local",
        json={"username": user["username"], "password": "WrongPassword!"},
    )
    assert resp.status_code == 401

    # Check audit log for login_failed
    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_sub == user["username"])
            .where(AuditLog.action == "login_failed")
            .where(AuditLog.resource_type == "auth")
        )
        log_entry = result.scalar_one_or_none()
    await engine.dispose()

    assert log_entry is not None
    assert log_entry.changes.get("reason") == "invalid_credentials"


@pytest.mark.asyncio
async def test_forgot_password_creates_audit_log(setup_user, auth_client):
    """POST /auth/forgot-password creates audit_log with action='password_reset_requested'."""
    user = setup_user
    resp = await auth_client.post(
        "/auth/forgot-password",
        json={"email": user["email"]},
    )
    # Always 200 (doesn't reveal email existence)
    assert resp.status_code == 200

    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.action == "password_reset_requested")
            .where(AuditLog.resource_type == "auth")
        )
        log_entry = result.scalars().first()
    await engine.dispose()

    assert log_entry is not None
