"""
Integration tests for password reset endpoints:
  POST /auth/forgot-password
  POST /auth/reset-password

Tests mock EmailService.send_password_reset so no SMTP is needed.
All DB writes are rolled back after each test.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import bcrypt as _bcrypt
import httpx
import pytest
from jose import jwt
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings
from api.core.auth import get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.models.user import User
from api.services.git_service import GitService


# ===========================================================================
# Fixtures
# ===========================================================================


class _FlushOnCommitSession(AsyncSession):
    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


@pytest.fixture
async def api_db() -> AsyncSession:
    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(
        bind=engine,
        class_=_FlushOnCommitSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    async with factory() as session:
        yield session
        await session.rollback()
    await engine.dispose()


@pytest.fixture(autouse=True)
def disable_ldap(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "LDAP_SERVER", "")


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    org = Organization(name="__reset_test_org__", display_name="Reset Test Org")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def local_user(api_db: AsyncSession, test_org: Organization) -> User:
    user = User(
        organization_id=test_org.id,
        username="resetuser",
        email="reset@example.com",
        role="member",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"oldpassword1234", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
    async def override_get_db():
        yield api_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


def _reset_token(username: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "purpose": "password_reset",
        "iat": now,
        "exp": now + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def _expired_reset_token(username: str) -> str:
    settings = get_settings()
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    payload = {
        "sub": username,
        "purpose": "password_reset",
        "iat": past,
        "exp": past + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def _wrong_purpose_token(username: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "purpose": "login",
        "iat": now,
        "exp": now + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def _mock_email_service():
    """Return a mock EmailService with send_password_reset as a no-op."""
    svc = MagicMock()
    svc.enabled = True
    svc.send_password_reset = MagicMock()
    return svc


# ===========================================================================
# POST /auth/forgot-password
# ===========================================================================


class TestForgotPassword:

    async def test_known_email_returns_200(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        with patch("api.core.email.EmailService.send_password_reset"):
            with patch("api.core.email.EmailService.enabled", new_callable=lambda: property(lambda self: True)):
                resp = await client.post(
                    "/auth/forgot-password",
                    json={"email": "reset@example.com"},
                )

        assert resp.status_code == 200
        assert "message" in resp.json()

    async def test_unknown_email_also_returns_200(
        self, client: httpx.AsyncClient
    ) -> None:
        """Never reveal whether an email exists."""
        resp = await client.post(
            "/auth/forgot-password",
            json={"email": "nobody@nowhere.example.com"},
        )
        assert resp.status_code == 200
        assert "message" in resp.json()

    async def test_email_service_send_called(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        sent: list[tuple] = []

        mock_svc = _mock_email_service()
        mock_svc.send_password_reset.side_effect = lambda to, url: sent.append((to, url))

        with patch("api.core.email.get_email_service", return_value=mock_svc):
            await client.post(
                "/auth/forgot-password",
                json={"email": "reset@example.com"},
            )

        assert len(sent) == 1
        assert sent[0][0] == "reset@example.com"
        assert "reset-password" in sent[0][1]


# ===========================================================================
# POST /auth/reset-password
# ===========================================================================


class TestResetPassword:

    async def test_valid_token_updates_password(
        self, client: httpx.AsyncClient, local_user: User, api_db: AsyncSession
    ) -> None:
        token = _reset_token(local_user.username)

        resp = await client.post(
            "/auth/reset-password",
            json={"token": token, "new_password": "newpassword9999"},
        )
        assert resp.status_code == 200
        assert "message" in resp.json()

        await api_db.refresh(local_user)
        assert _bcrypt.checkpw(b"newpassword9999", local_user.password_hash.encode())

    async def test_expired_token_returns_400(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        token = _expired_reset_token(local_user.username)
        resp = await client.post(
            "/auth/reset-password",
            json={"token": token, "new_password": "newpassword9999"},
        )
        assert resp.status_code == 400

    async def test_wrong_purpose_token_returns_400(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        token = _wrong_purpose_token(local_user.username)
        resp = await client.post(
            "/auth/reset-password",
            json={"token": token, "new_password": "newpassword9999"},
        )
        assert resp.status_code == 400

    async def test_invalid_token_returns_400(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            "/auth/reset-password",
            json={"token": "not.a.valid.jwt", "new_password": "newpassword9999"},
        )
        assert resp.status_code == 400
