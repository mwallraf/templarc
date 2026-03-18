"""
Integration tests for the full rendering pipeline.

Tests exercise the HTTP stack (routing → TemplateRenderer → DB → Git) using
httpx.AsyncClient with ASGITransport — no live server required.

The same _FlushOnCommitSession pattern as test_catalog_crud.py is used so
that DB state is never durably committed; rollback() at teardown cleans up.

Scenarios:
  - Full render pipeline — params resolved, Jinja2 rendered, metadata header prepended
  - Render history storage (persist=True)
  - Ephemeral render (persist=false) — no history row written
  - Re-render — same stored params applied to re-loaded template body
  - Metadata header format — all five comment styles tested (unit-level)
  - resolve-params endpoint
  - render-history list + single endpoints
"""

from __future__ import annotations

import textwrap
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
from api.models.parameter import Parameter, ParameterScope, WidgetType
from api.models.project import Project
from api.models.template import Template
from api.services.git_service import GitService
from api.services.template_renderer import build_metadata_header

_MOCK_ADMIN_TOKEN = TokenData(sub="testadmin", org_id=1, org_role="org_admin")


# ===========================================================================
# Infrastructure (mirrors test_catalog_crud.py)
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


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
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
# DB fixtures — org, project, template
# ---------------------------------------------------------------------------

@pytest.fixture
async def org(api_db: AsyncSession) -> Organization:
    o = Organization(name="__render_test_org__", display_name="Render Test Org")
    api_db.add(o)
    await api_db.flush()
    return o


@pytest.fixture
async def project(api_db: AsyncSession, org: Organization) -> Project:
    p = Project(
        organization_id=org.id,
        name="render_test_proj",
        display_name="Render Test Project",
        git_path="render_test",
        output_comment_style="#",
    )
    api_db.add(p)
    await api_db.flush()
    return p


@pytest.fixture
async def template(
    api_db: AsyncSession,
    project: Project,
    git_repo: GitService,
) -> Template:
    """Create a Template DB record and write its .j2 file to the temp git repo."""
    git_path = "render_test/router.j2"

    content = textwrap.dedent("""\
        ---
        parameters:
          - name: router.hostname
            widget: text
            label: Router Hostname
            required: true
          - name: router.site_id
            widget: text
            label: Site ID
            required: false
        ---
        hostname {{ router.hostname }}
        site-id {{ router.site_id }}
        """)
    git_repo.write_template(git_path, content, "add router template", "test")

    t = Template(
        project_id=project.id,
        name="router",
        display_name="Router Template",
        git_path=git_path,
    )
    api_db.add(t)
    await api_db.flush()

    # Register parameters in the DB (scope=template, matching the frontmatter)
    p1 = Parameter(
        template_id=t.id,
        name="router.hostname",
        scope=ParameterScope.template,
        widget_type=WidgetType.text,
        label="Router Hostname",
        required=True,
        sort_order=0,
    )
    p2 = Parameter(
        template_id=t.id,
        name="router.site_id",
        scope=ParameterScope.template,
        widget_type=WidgetType.text,
        label="Site ID",
        required=False,
        sort_order=1,
    )
    api_db.add(p1)
    api_db.add(p2)
    await api_db.flush()

    return t


# ===========================================================================
# Unit tests for build_metadata_header (no DB needed)
# ===========================================================================

class TestBuildMetadataHeader:
    def _call(self, style: str) -> str:
        return build_metadata_header(
            template_name="router",
            template_display_name="Router Template",
            project_name="my_proj",
            project_display_name="My Project",
            breadcrumb=["router"],
            git_sha="abc123def456",
            user="jsmith",
            rendered_at="2025-03-15T14:22:01+00:00",
            notes="Initial provisioning",
            full_context={"router.hostname": "r1.example.com", "router.site_id": "42"},
            comment_style=style,
        )

    def test_hash_style_starts_with_hash(self):
        header = self._call("#")
        assert header.startswith("# =")
        assert "# Generated by: jsmith" in header
        assert "# Template:     Router Template (router)" in header

    def test_exclamation_style(self):
        header = self._call("!")
        assert header.startswith("! =")
        assert "! Generated by:" in header

    def test_double_slash_style(self):
        header = self._call("//")
        assert header.startswith("// =")
        assert "// Generated by:" in header

    def test_xml_comment_style(self):
        header = self._call("<!--")
        assert header.startswith("<!--")
        assert "-->" in header
        assert "Generated by: jsmith" in header

    def test_empty_style_returns_empty_string(self):
        assert self._call("") == ""

    def test_notes_included_when_present(self):
        header = self._call("#")
        assert "Initial provisioning" in header

    def test_params_included(self):
        header = self._call("#")
        assert "router.hostname" in header
        assert "r1.example.com" in header

    def test_breadcrumb_root_to_leaf(self):
        header = build_metadata_header(
            template_name="leaf",
            template_display_name="Leaf",
            project_name="p",
            project_display_name="P",
            breadcrumb=["leaf", "parent", "root"],  # child-first from resolver
            git_sha="abc",
            user="u",
            rendered_at="2025-01-01T00:00:00+00:00",
            notes=None,
            full_context={},
            comment_style="#",
        )
        # Displayed as root > parent > leaf
        assert "root > parent > leaf" in header

    def test_no_notes_line_omitted(self):
        header = build_metadata_header(
            template_name="t",
            template_display_name="T",
            project_name="p",
            project_display_name="P",
            breadcrumb=["t"],
            git_sha="abc",
            user="u",
            rendered_at="2025-01-01T00:00:00+00:00",
            notes=None,
            full_context={},
            comment_style="#",
        )
        assert "Notes" not in header


# ===========================================================================
# Integration: resolve-params endpoint
# ===========================================================================

class TestResolveParams:
    @pytest.mark.asyncio
    async def test_returns_parameter_list(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        resp = await client.get(f"/templates/{template.id}/resolve-params")
        assert resp.status_code == 200
        data = resp.json()
        assert data["template_id"] == template.id
        param_names = {p["name"] for p in data["parameters"]}
        assert "router.hostname" in param_names
        assert "router.site_id" in param_names

    @pytest.mark.asyncio
    async def test_404_for_missing_template(self, client: httpx.AsyncClient) -> None:
        resp = await client.get("/templates/99999/resolve-params")
        assert resp.status_code == 404


# ===========================================================================
# Integration: render endpoint
# ===========================================================================

class TestRender:
    @pytest.mark.asyncio
    async def test_renders_template_body(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        resp = await client.post(
            f"/templates/{template.id}/render?user=jsmith",
            json={"params": {"router.hostname": "r1.example.com", "router.site_id": "42"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "hostname r1.example.com" in data["output"]
        assert "site-id 42" in data["output"]

    @pytest.mark.asyncio
    async def test_metadata_header_prepended(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        resp = await client.post(
            f"/templates/{template.id}/render?user=jsmith",
            json={"params": {"router.hostname": "r1.example.com", "router.site_id": "42"}},
        )
        data = resp.json()
        assert data["output"].startswith("# =")
        assert "Generated by: testadmin" in data["output"]

    @pytest.mark.asyncio
    async def test_persist_true_stores_history(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        resp = await client.post(
            f"/templates/{template.id}/render?persist=true&user=tester",
            json={"params": {"router.hostname": "r2.example.com", "router.site_id": "7"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["render_id"] is not None

        # Verify history is queryable
        history_resp = await client.get(f"/render-history/{data['render_id']}")
        assert history_resp.status_code == 200
        h = history_resp.json()
        assert h["template_id"] == template.id
        assert "router.hostname" in h["resolved_parameters"]

    @pytest.mark.asyncio
    async def test_persist_false_returns_no_render_id(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        resp = await client.post(
            f"/templates/{template.id}/render?persist=false&user=preview",
            json={"params": {"router.hostname": "r3.example.com", "router.site_id": "9"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["render_id"] is None

    @pytest.mark.asyncio
    async def test_missing_required_param_returns_422(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        # router.hostname is required; omit it
        resp = await client.post(
            f"/templates/{template.id}/render?user=u",
            json={"params": {}},
        )
        assert resp.status_code == 422
        assert "router.hostname" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_git_sha_in_response(
        self, client: httpx.AsyncClient, template: Template
    ) -> None:
        resp = await client.post(
            f"/templates/{template.id}/render?user=u",
            json={"params": {"router.hostname": "r1.example.com", "router.site_id": "1"}},
        )
        data = resp.json()
        assert data["git_sha"]
        assert len(data["git_sha"]) >= 8

    @pytest.mark.asyncio
    async def test_404_for_missing_template(self, client: httpx.AsyncClient) -> None:
        resp = await client.post(
            "/templates/99999/render?user=u",
            json={"params": {}},
        )
        assert resp.status_code == 404


# ===========================================================================
# Integration: render history endpoints
# ===========================================================================

class TestRenderHistory:
    @pytest.fixture
    async def render_id(
        self, client: httpx.AsyncClient, template: Template
    ) -> int:
        resp = await client.post(
            f"/templates/{template.id}/render?persist=true&user=hist_test",
            json={"params": {"router.hostname": "hist.example.com", "router.site_id": "99"}},
        )
        assert resp.status_code == 200
        return resp.json()["render_id"]

    @pytest.mark.asyncio
    async def test_list_returns_renders(
        self, client: httpx.AsyncClient, render_id: int, template: Template
    ) -> None:
        resp = await client.get(f"/render-history?template_id={template.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        ids = [item["id"] for item in data["items"]]
        assert render_id in ids

    @pytest.mark.asyncio
    async def test_get_single_has_output(
        self, client: httpx.AsyncClient, render_id: int
    ) -> None:
        resp = await client.get(f"/render-history/{render_id}")
        assert resp.status_code == 200
        h = resp.json()
        assert "raw_output" in h
        assert "hist.example.com" in h["raw_output"]

    @pytest.mark.asyncio
    async def test_get_single_404(self, client: httpx.AsyncClient) -> None:
        resp = await client.get("/render-history/9999999")
        assert resp.status_code == 404


# ===========================================================================
# Integration: re-render
# ===========================================================================

class TestReRender:
    @pytest.fixture
    async def first_render(
        self, client: httpx.AsyncClient, template: Template
    ) -> dict:
        resp = await client.post(
            f"/templates/{template.id}/render?persist=true&user=orig",
            json={
                "params": {"router.hostname": "orig.example.com", "router.site_id": "1"},
                "notes": "original render",
            },
        )
        assert resp.status_code == 200
        return resp.json()

    @pytest.mark.asyncio
    async def test_re_render_produces_same_params(
        self, client: httpx.AsyncClient, first_render: dict
    ) -> None:
        render_id = first_render["render_id"]
        resp = await client.post(
            f"/render-history/{render_id}/re-render?user=rerender",
            json={"persist": False},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Same template content → same rendered body params
        assert "orig.example.com" in data["output"]

    @pytest.mark.asyncio
    async def test_re_render_persist_stores_new_history(
        self, client: httpx.AsyncClient, first_render: dict
    ) -> None:
        render_id = first_render["render_id"]
        resp = await client.post(
            f"/render-history/{render_id}/re-render?user=rerender",
            json={"persist": True, "notes": "re-render test"},
        )
        assert resp.status_code == 200
        new_id = resp.json()["render_id"]
        assert new_id is not None
        assert new_id != render_id  # A new history record was created

    @pytest.mark.asyncio
    async def test_re_render_404_for_missing_history(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            "/render-history/9999999/re-render?user=u",
            json={"persist": False},
        )
        assert resp.status_code == 404
