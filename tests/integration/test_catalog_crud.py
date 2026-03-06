"""
Integration tests for the catalog and template CRUD API endpoints.

These tests exercise the full HTTP stack (routing → service → DB → Git) using
httpx.AsyncClient with ASGITransport — no live server is needed.

Isolation strategy — "flush-on-commit" pattern
───────────────────────────────────────────────
A custom AsyncSession subclass (_FlushOnCommitSession) converts every
session.commit() call into a session.flush(). Routers call commit() freely,
but the data is only flushed (written to the server-side transaction buffer),
never truly committed. At teardown, session.rollback() undoes everything.

This avoids the "joined external transaction" pattern which requires
engine.connect() — an approach that triggers greenlet/event-loop ordering
issues inside pytest-asyncio's function-scoped event loops.

The git dependency is overridden with a temporary GitService backed by
tmp_path, so no real TEMPLATES_REPO_PATH is touched.

Run with:
    uv run pytest tests/integration/test_catalog_crud.py -v
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.services.git_service import GitService

# Shared mock token for all catalog/crud tests (admin, org_id is irrelevant for these endpoints)
_MOCK_ADMIN_TOKEN = TokenData(sub="testadmin", org_id=1, is_admin=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FlushOnCommitSession(AsyncSession):
    """
    AsyncSession variant used exclusively in tests.

    Replaces commit() with flush() so that data written by routers is visible
    within the current transaction but never durably committed to the database.
    Rolling back the session at teardown removes all test data.
    """

    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def api_db() -> AsyncSession:
    """
    Yield a _FlushOnCommitSession backed by a fresh engine for this test.

    Router commit() calls become flush() calls — the transaction is never
    committed. A rollback() at teardown removes all test data.
    """
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


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    """Isolated GitService backed by a temporary directory."""
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    """Create a test organization within the test transaction."""
    org = Organization(
        name="__test_crud_org__",
        display_name="Test CRUD Org",
    )
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
    """
    httpx.AsyncClient configured to send requests through the FastAPI ASGI app.

    The get_db and get_git_service dependencies are overridden so the app
    uses the test session and the temporary git repo.
    """
    async def override_get_db():
        yield api_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = lambda: _MOCK_ADMIN_TOKEN
    app.dependency_overrides[require_admin] = lambda: _MOCK_ADMIN_TOKEN

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Project creation
# ---------------------------------------------------------------------------

class TestCreateProject:

    async def test_returns_201_with_project_fields(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        """POST /catalog/projects returns 201 with all expected fields."""
        resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "my_project",
                "display_name": "My Project",
                "output_comment_style": "#",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "my_project"
        assert data["display_name"] == "My Project"
        assert data["organization_id"] == test_org.id
        assert data["git_path"] == "my_project"  # defaults to name
        assert "id" in data
        assert "created_at" in data

    async def test_git_directory_initialised(
        self, client: httpx.AsyncClient, test_org: Organization, git_repo: GitService
    ) -> None:
        """Creating a project writes a .gitkeep to the git repo."""
        resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "git_init_proj",
                "display_name": "Git Init Project",
                "output_comment_style": "#",
            },
        )
        assert resp.status_code == 201
        git_path = resp.json()["git_path"]

        gitkeep = git_repo._root / git_path / ".gitkeep"
        assert gitkeep.exists(), ".gitkeep was not written to the git repo"

    async def test_custom_git_path(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        """git_path can be set explicitly, overriding the default (=name)."""
        resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "slug_name",
                "display_name": "Slug Project",
                "git_path": "custom/path",
                "output_comment_style": "#",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["git_path"] == "custom/path"

    async def test_project_appears_in_list(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        """Newly created project is returned by GET /catalog/projects."""
        await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "listed_project",
                "display_name": "Listed Project",
                "output_comment_style": "#",
            },
        )
        resp = await client.get(
            "/catalog/projects",
            params={"organization_id": test_org.id},
        )
        assert resp.status_code == 200
        names = [p["name"] for p in resp.json()]
        assert "listed_project" in names


# ---------------------------------------------------------------------------
# Template creation
# ---------------------------------------------------------------------------

class TestCreateTemplate:

    async def _create_project(
        self, client: httpx.AsyncClient, test_org: Organization, name: str = "tmpl_proj"
    ) -> dict:
        resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": name,
                "display_name": "Template Project",
                "output_comment_style": "#",
            },
        )
        assert resp.status_code == 201
        return resp.json()

    async def test_returns_201_with_template_fields(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        """POST /templates returns 201 with correct DB fields."""
        proj = await self._create_project(client, test_org)

        resp = await client.post(
            "/templates",
            json={
                "project_id": proj["id"],
                "name": "cisco_891",
                "display_name": "Cisco 891",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "cisco_891"
        assert data["display_name"] == "Cisco 891"
        assert data["project_id"] == proj["id"]
        assert data["git_path"] == f"{proj['git_path']}/cisco_891.j2"
        assert data["is_active"] is True

    async def test_j2_file_written_to_git(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
        git_repo: GitService,
    ) -> None:
        """Creating a template writes a .j2 file to the git repo."""
        proj = await self._create_project(client, test_org, "git_write_proj")

        resp = await client.post(
            "/templates",
            json={
                "project_id": proj["id"],
                "name": "my_router",
                "display_name": "My Router",
            },
        )
        assert resp.status_code == 201
        git_path = resp.json()["git_path"]

        # File must exist in the git repo
        content = git_repo.read_template(git_path)
        assert content  # non-empty

    async def test_j2_file_contains_provided_content(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
        git_repo: GitService,
    ) -> None:
        """Custom content supplied at creation is stored verbatim in git."""
        proj = await self._create_project(client, test_org, "content_proj")
        custom_content = (
            "---\nparameters:\n  - name: router.hostname\n    widget: text\n---\n"
            "hostname {{ router.hostname }}\n"
        )

        resp = await client.post(
            "/templates",
            json={
                "project_id": proj["id"],
                "name": "custom_tmpl",
                "display_name": "Custom Template",
                "content": custom_content,
            },
        )
        assert resp.status_code == 201

        git_path = resp.json()["git_path"]
        stored = git_repo.read_template(git_path)
        assert "router.hostname" in stored
        assert "hostname {{ router.hostname }}" in stored


# ---------------------------------------------------------------------------
# Full flow — the missing Phase 3 criterion
# ---------------------------------------------------------------------------

class TestFullFlow:
    """
    End-to-end coverage of:
      create project → create template → read it back from Git
    """

    async def test_create_project_then_template_then_read_from_git(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
        git_repo: GitService,
    ) -> None:
        """
        Phase 3 completion criterion:
          1. Create a project via API
          2. Create a template with frontmatter + body via API
          3. Read the raw .j2 content back directly from Git
          4. Verify the stored content is correct
        """
        # 1. Create project
        proj_resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "full_flow_proj",
                "display_name": "Full Flow Project",
                "output_comment_style": "#",
            },
        )
        assert proj_resp.status_code == 201
        proj = proj_resp.json()

        # 2. Create template with explicit content
        content = (
            "---\n"
            "parameters:\n"
            "  - name: router.hostname\n"
            "    widget: text\n"
            "    label: Router Hostname\n"
            "    required: true\n"
            "  - name: router.site_id\n"
            "    widget: number\n"
            "    required: false\n"
            "---\n"
            "hostname {{ router.hostname }}\n"
            "ip vrf {{ proj.vrf }}\n"
        )
        tmpl_resp = await client.post(
            "/templates",
            json={
                "project_id": proj["id"],
                "name": "cisco_isr",
                "display_name": "Cisco ISR",
                "description": "ISR router template",
                "content": content,
            },
        )
        assert tmpl_resp.status_code == 201
        tmpl = tmpl_resp.json()
        assert tmpl["git_path"] == f"{proj['git_path']}/cisco_isr.j2"

        # 3 + 4. Read raw .j2 directly from Git and verify
        raw = git_repo.read_template(tmpl["git_path"])
        assert "router.hostname" in raw
        assert "router.site_id" in raw
        assert "hostname {{ router.hostname }}" in raw

    async def test_get_template_via_api(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
    ) -> None:
        """GET /templates/{id} returns the template record created via POST."""
        proj_resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "get_tmpl_proj",
                "display_name": "Get Template Project",
                "output_comment_style": "#",
            },
        )
        proj_id = proj_resp.json()["id"]

        create_resp = await client.post(
            "/templates",
            json={"project_id": proj_id, "name": "ospf_base", "display_name": "OSPF Base"},
        )
        tmpl_id = create_resp.json()["id"]

        get_resp = await client.get(f"/templates/{tmpl_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["name"] == "ospf_base"

    async def test_variables_parsed_from_git_content(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
    ) -> None:
        """GET /templates/{id}/variables parses variables from the stored .j2."""
        proj_resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "var_proj",
                "display_name": "Variables Project",
                "output_comment_style": "#",
            },
        )
        proj_id = proj_resp.json()["id"]

        content = (
            "---\nparameters: []\n---\n"
            "hostname {{ router.hostname }}\n"
            "ntp {{ glob.ntp }}\n"
        )
        tmpl_resp = await client.post(
            "/templates",
            json={
                "project_id": proj_id,
                "name": "var_tmpl",
                "display_name": "Variable Template",
                "content": content,
            },
        )
        tmpl_id = tmpl_resp.json()["id"]

        vars_resp = await client.get(f"/templates/{tmpl_id}/variables")
        assert vars_resp.status_code == 200

        full_paths = {v["full_path"] for v in vars_resp.json()}
        assert "router.hostname" in full_paths
        assert "glob.ntp" in full_paths

    async def test_project_detail_shows_template_tree(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
    ) -> None:
        """GET /catalog/projects/{id} includes the template tree after creation."""
        proj_resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "tree_proj",
                "display_name": "Tree Project",
                "output_comment_style": "#",
            },
        )
        proj_id = proj_resp.json()["id"]

        await client.post(
            "/templates",
            json={"project_id": proj_id, "name": "parent_tmpl", "display_name": "Parent"},
        )

        detail_resp = await client.get(f"/catalog/projects/{proj_id}")
        assert detail_resp.status_code == 200
        data = detail_resp.json()
        assert data["id"] == proj_id
        tree_names = [t["name"] for t in data["templates"]]
        assert "parent_tmpl" in tree_names

    async def test_catalog_endpoint_returns_template_with_breadcrumb(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
    ) -> None:
        """GET /catalog/{slug} returns the template with a correct breadcrumb."""
        proj_resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "catalog_slug_proj",
                "display_name": "Catalog Slug Project",
                "output_comment_style": "#",
            },
        )
        proj_id = proj_resp.json()["id"]

        await client.post(
            "/templates",
            json={
                "project_id": proj_id,
                "name": "leaf_tmpl",
                "display_name": "Leaf Template",
            },
        )

        catalog_resp = await client.get("/catalog/catalog_slug_proj")
        assert catalog_resp.status_code == 200
        data = catalog_resp.json()
        assert data["project"]["name"] == "catalog_slug_proj"

        templates = data["templates"]
        assert len(templates) == 1
        assert templates[0]["name"] == "leaf_tmpl"
        assert templates[0]["breadcrumb"] == ["Leaf Template"]
        assert templates[0]["is_leaf"] is True
