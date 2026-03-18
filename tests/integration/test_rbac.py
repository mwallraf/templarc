"""
Integration tests for Phase 11 RBAC:
  - Project membership endpoints (GET/POST/DELETE /catalog/projects/{id}/members)
  - Access control: org_admin bypass, project_role enforcement
  - Token claims: org_role + is_platform_admin in JWT
"""

from __future__ import annotations

import uuid
from pathlib import Path

import bcrypt as _bcrypt
import httpx
import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_admin, require_org_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.models.project import Project
from api.models.project_membership import ProjectMembership
from api.models.user import User
from api.services.git_service import GitService


# ===========================================================================
# Infrastructure
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
    org = Organization(name=f"rbac-test-org-{uuid.uuid4().hex[:8]}")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def test_project(api_db: AsyncSession, test_org: Organization, git_repo: GitService) -> Project:
    project = Project(
        organization_id=test_org.id,
        name=f"rbac-project-{uuid.uuid4().hex[:6]}",
        slug=f"rbac-proj-{uuid.uuid4().hex[:6]}",
        display_name="RBAC Test Project",
        git_path=str(git_repo.root),
    )
    api_db.add(project)
    await api_db.flush()
    return project


@pytest.fixture
async def org_admin_user(api_db: AsyncSession, test_org: Organization) -> User:
    user = User(
        organization_id=test_org.id,
        username=f"rbac_admin_{uuid.uuid4().hex[:6]}",
        email="rbac_admin@example.com",
        role="org_admin",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"adminpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def member_user(api_db: AsyncSession, test_org: Organization) -> User:
    user = User(
        organization_id=test_org.id,
        username=f"rbac_member_{uuid.uuid4().hex[:6]}",
        email="rbac_member@example.com",
        role="member",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"memberpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def admin_client(
    api_db: AsyncSession,
    git_repo: GitService,
    test_org: Organization,
    org_admin_user: User,
) -> httpx.AsyncClient:
    async def override_get_db():
        yield api_db

    def override_admin() -> TokenData:
        return TokenData(sub=org_admin_user.username, org_id=test_org.id, org_role="org_admin")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = override_admin
    app.dependency_overrides[require_admin] = override_admin
    app.dependency_overrides[require_org_admin] = override_admin

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def member_client(
    api_db: AsyncSession,
    git_repo: GitService,
    test_org: Organization,
    member_user: User,
) -> httpx.AsyncClient:
    async def override_get_db():
        yield api_db

    def override_member() -> TokenData:
        return TokenData(sub=member_user.username, org_id=test_org.id, org_role="member")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = override_member

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# GET /catalog/projects/{project_id}/members
# ===========================================================================

class TestListProjectMembers:

    async def test_admin_can_list_members(
        self,
        admin_client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        resp = await admin_client.get(f"/catalog/projects/{test_project.id}/members")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)

    async def test_member_without_membership_gets_403(
        self,
        member_client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        """A member with no project membership cannot list project members."""
        resp = await member_client.get(f"/catalog/projects/{test_project.id}/members")
        assert resp.status_code == 403


# ===========================================================================
# POST /catalog/projects/{project_id}/members
# ===========================================================================

class TestUpsertProjectMember:

    async def test_admin_can_add_member(
        self,
        admin_client: httpx.AsyncClient,
        test_project: Project,
        member_user: User,
    ) -> None:
        resp = await admin_client.post(
            f"/catalog/projects/{test_project.id}/members",
            json={"user_id": member_user.id, "role": "project_member"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == member_user.id
        assert data["role"] == "project_member"
        assert data["project_id"] == test_project.id

    async def test_admin_can_change_member_role(
        self,
        admin_client: httpx.AsyncClient,
        api_db: AsyncSession,
        test_project: Project,
        member_user: User,
    ) -> None:
        """Upsert semantics: calling POST twice updates the role."""
        # First add as guest
        await admin_client.post(
            f"/catalog/projects/{test_project.id}/members",
            json={"user_id": member_user.id, "role": "guest"},
        )
        # Upsert to project_editor
        resp2 = await admin_client.post(
            f"/catalog/projects/{test_project.id}/members",
            json={"user_id": member_user.id, "role": "project_editor"},
        )
        assert resp2.status_code == 200
        assert resp2.json()["role"] == "project_editor"

    async def test_invalid_role_returns_422(
        self,
        admin_client: httpx.AsyncClient,
        test_project: Project,
        member_user: User,
    ) -> None:
        resp = await admin_client.post(
            f"/catalog/projects/{test_project.id}/members",
            json={"user_id": member_user.id, "role": "superadmin"},
        )
        assert resp.status_code == 422

    async def test_member_cannot_add_members(
        self,
        member_client: httpx.AsyncClient,
        test_project: Project,
        member_user: User,
    ) -> None:
        resp = await member_client.post(
            f"/catalog/projects/{test_project.id}/members",
            json={"user_id": member_user.id, "role": "guest"},
        )
        assert resp.status_code == 403


# ===========================================================================
# DELETE /catalog/projects/{project_id}/members/{user_id}
# ===========================================================================

class TestRemoveProjectMember:

    async def test_admin_can_remove_member(
        self,
        admin_client: httpx.AsyncClient,
        api_db: AsyncSession,
        test_project: Project,
        member_user: User,
    ) -> None:
        # Add membership first
        membership = ProjectMembership(
            user_id=member_user.id,
            project_id=test_project.id,
            role="project_member",
        )
        api_db.add(membership)
        await api_db.flush()

        resp = await admin_client.delete(
            f"/catalog/projects/{test_project.id}/members/{member_user.id}"
        )
        assert resp.status_code == 204

    async def test_remove_nonexistent_member_returns_404(
        self,
        admin_client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        fake_user_id = str(uuid.uuid4())
        resp = await admin_client.delete(
            f"/catalog/projects/{test_project.id}/members/{fake_user_id}"
        )
        assert resp.status_code == 404

    async def test_member_cannot_remove_members(
        self,
        member_client: httpx.AsyncClient,
        test_project: Project,
        member_user: User,
    ) -> None:
        resp = await member_client.delete(
            f"/catalog/projects/{test_project.id}/members/{member_user.id}"
        )
        assert resp.status_code == 403


# ===========================================================================
# Org-admin bypass: org admins can access all projects
# ===========================================================================

class TestOrgAdminBypass:

    async def test_org_admin_sees_all_projects(
        self,
        admin_client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        """Org admin can list all projects without a membership row."""
        resp = await admin_client.get("/catalog/projects")
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()]
        assert test_project.id in ids

    async def test_member_without_membership_sees_empty_catalog(
        self,
        member_client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        """Member with no memberships sees an empty project list."""
        resp = await member_client.get("/catalog/projects")
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()]
        # test_project is not in member's list since there's no membership row
        assert test_project.id not in ids

    async def test_member_with_membership_sees_project(
        self,
        member_client: httpx.AsyncClient,
        admin_client: httpx.AsyncClient,
        test_project: Project,
        member_user: User,
    ) -> None:
        """After granting a membership, the member can see the project."""
        # Grant membership via admin
        await admin_client.post(
            f"/catalog/projects/{test_project.id}/members",
            json={"user_id": member_user.id, "role": "guest"},
        )

        resp = await member_client.get("/catalog/projects")
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()]
        assert test_project.id in ids
