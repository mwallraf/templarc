"""
Integration tests for Feature Management endpoints:

  GET    /features                               — list features
  POST   /features                               — create feature
  GET    /features/{id}                          — get feature
  PUT    /features/{id}                          — update feature
  DELETE /features/{id}                          — delete feature

  GET    /features/{id}/parameters              — list feature parameters
  POST   /features/{id}/parameters              — create feature parameter
  PUT    /features/{id}/parameters/{param_id}   — update feature parameter
  DELETE /features/{id}/parameters/{param_id}   — delete feature parameter

  GET    /features/templates/{tid}/features      — list template features
  POST   /features/templates/{tid}/features/{fid} — attach feature to template
  PUT    /features/templates/{tid}/features/{fid} — update attachment
  DELETE /features/templates/{tid}/features/{fid} — detach feature

All DB writes are rolled back after each test.
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
from api.models.feature import Feature
from api.models.organization import Organization
from api.models.project import Project
from api.models.template import Template
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
    """Force LDAP_SERVER to empty so auth tests use local authentication."""
    settings = get_settings()
    monkeypatch.setattr(settings, "LDAP_SERVER", "")


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


# ===========================================================================
# DB fixtures — org, project, template, feature
# ===========================================================================


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    org = Organization(name="__feat_test_org__", display_name="Feature Test Org")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def test_project(api_db: AsyncSession, test_org: Organization) -> Project:
    project = Project(
        organization_id=test_org.id,
        name="feat_test_project",
        display_name="Feature Test Project",
        git_path="feat_test",
        output_comment_style="#",
    )
    api_db.add(project)
    await api_db.flush()
    return project


@pytest.fixture
async def test_template(api_db: AsyncSession, test_project: Project) -> Template:
    template = Template(
        project_id=test_project.id,
        name="feat_test_template",
        display_name="Feature Test Template",
    )
    api_db.add(template)
    await api_db.flush()
    return template


@pytest.fixture
async def test_feature(api_db: AsyncSession, test_project: Project) -> Feature:
    feature = Feature(
        project_id=test_project.id,
        name="snmp_monitoring",
        label="SNMP Monitoring",
        description="Adds SNMP monitoring configuration",
        snippet_path="feat_test/features/snmp_monitoring/snmp_monitoring.j2",
        sort_order=0,
    )
    api_db.add(feature)
    await api_db.flush()
    return feature


# ===========================================================================
# HTTP client fixture — auth fully overridden
# ===========================================================================


@pytest.fixture
async def client(
    api_db: AsyncSession,
    git_repo: GitService,
    test_org: Organization,
) -> httpx.AsyncClient:
    """
    AsyncClient with:
    - DB overridden to the rollback-only api_db session
    - GitService overridden to a temp-path repo
    - get_current_user overridden to a non-admin user
    - require_admin overridden to an admin user
    """

    async def override_get_db():
        yield api_db

    def override_get_current_user() -> TokenData:
        return TokenData(sub="testuser", org_id=test_org.id, is_admin=False)

    def override_require_admin() -> TokenData:
        return TokenData(sub="testadmin", org_id=test_org.id, is_admin=True)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[require_admin] = override_require_admin

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# TestFeatureCRUD
# ===========================================================================


class TestFeatureCRUD:

    async def test_create_feature(
        self,
        client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        resp = await client.post(
            "/features",
            json={
                "project_id": test_project.id,
                "name": "bgp_policy",
                "label": "BGP Policy",
                "description": "Adds BGP policy configuration",
                "sort_order": 1,
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "bgp_policy"
        assert data["label"] == "BGP Policy"
        assert data["project_id"] == test_project.id
        assert data["is_active"] is True
        assert "id" in data
        assert "snippet_path" in data
        assert "parameters" in data

    async def test_list_features(
        self,
        client: httpx.AsyncClient,
        test_project: Project,
        test_feature: Feature,
    ) -> None:
        resp = await client.get(f"/features?project_id={test_project.id}")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "items" in data
        assert "total" in data
        ids = [item["id"] for item in data["items"]]
        assert test_feature.id in ids

    async def test_list_features_no_filter(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        """GET /features without project_id returns all active features."""
        resp = await client.get("/features")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        ids = [item["id"] for item in data["items"]]
        assert test_feature.id in ids

    async def test_get_feature(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        resp = await client.get(f"/features/{test_feature.id}")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["id"] == test_feature.id
        assert data["name"] == "snmp_monitoring"
        assert data["label"] == "SNMP Monitoring"
        assert isinstance(data["parameters"], list)

    async def test_update_feature(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        resp = await client.put(
            f"/features/{test_feature.id}",
            json={"label": "Updated SNMP Label", "sort_order": 5},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["label"] == "Updated SNMP Label"
        assert data["sort_order"] == 5

    async def test_delete_feature(
        self,
        client: httpx.AsyncClient,
        test_project: Project,
    ) -> None:
        # Create a fresh feature to delete (avoid interfering with test_feature fixture)
        create_resp = await client.post(
            "/features",
            json={
                "project_id": test_project.id,
                "name": "to_be_deleted",
                "label": "Delete Me",
            },
        )
        assert create_resp.status_code == 201
        fid = create_resp.json()["id"]

        # Delete it
        del_resp = await client.delete(f"/features/{fid}")
        assert del_resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(f"/features/{fid}")
        assert get_resp.status_code == 404

    async def test_get_nonexistent_returns_404(
        self,
        client: httpx.AsyncClient,
    ) -> None:
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/features/{fake_id}")
        assert resp.status_code == 404


# ===========================================================================
# TestFeatureParameters
# ===========================================================================


class TestFeatureParameters:

    async def test_create_feature_parameter(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        resp = await client.post(
            f"/features/{test_feature.id}/parameters",
            json={
                "name": "snmp.community",
                "widget_type": "text",
                "label": "SNMP Community String",
                "description": "Community string for SNMP v2c",
                "required": True,
                "sort_order": 0,
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "snmp.community"
        assert data["widget_type"] == "text"
        assert data["label"] == "SNMP Community String"
        assert data["required"] is True
        assert "id" in data

    async def test_list_feature_parameters(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        # First create a parameter
        await client.post(
            f"/features/{test_feature.id}/parameters",
            json={
                "name": "snmp.version",
                "widget_type": "select",
                "label": "SNMP Version",
            },
        )

        resp = await client.get(f"/features/{test_feature.id}/parameters")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)
        names = [p["name"] for p in data]
        assert "snmp.version" in names

    async def test_update_feature_parameter(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        # Create a parameter first
        create_resp = await client.post(
            f"/features/{test_feature.id}/parameters",
            json={
                "name": "snmp.port",
                "widget_type": "number",
                "label": "SNMP Port",
                "default_value": "161",
            },
        )
        assert create_resp.status_code == 201
        param_id = create_resp.json()["id"]

        # Update it
        update_resp = await client.put(
            f"/features/{test_feature.id}/parameters/{param_id}",
            json={
                "label": "SNMP UDP Port",
                "default_value": "162",
                "sort_order": 10,
            },
        )
        assert update_resp.status_code == 200, update_resp.text
        data = update_resp.json()
        assert data["label"] == "SNMP UDP Port"
        assert data["default_value"] == "162"
        assert data["sort_order"] == 10

    async def test_delete_feature_parameter(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        # Create a parameter to delete
        create_resp = await client.post(
            f"/features/{test_feature.id}/parameters",
            json={
                "name": "snmp.trap_host",
                "widget_type": "text",
                "label": "SNMP Trap Host",
            },
        )
        assert create_resp.status_code == 201
        param_id = create_resp.json()["id"]

        # Delete it
        del_resp = await client.delete(
            f"/features/{test_feature.id}/parameters/{param_id}"
        )
        assert del_resp.status_code == 204

        # Confirm it's no longer in the list
        list_resp = await client.get(f"/features/{test_feature.id}/parameters")
        assert list_resp.status_code == 200
        ids = [p["id"] for p in list_resp.json()]
        assert param_id not in ids

    async def test_create_parameter_on_nonexistent_feature_returns_404(
        self,
        client: httpx.AsyncClient,
    ) -> None:
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.post(
            f"/features/{fake_id}/parameters",
            json={"name": "x.y", "widget_type": "text", "label": "X"},
        )
        assert resp.status_code == 404

    async def test_update_parameter_wrong_feature_returns_404(
        self,
        client: httpx.AsyncClient,
        test_feature: Feature,
    ) -> None:
        fake_id = "00000000-0000-0000-0000-000000000000"
        # param_id 999999 does not exist on this feature
        resp = await client.put(
            f"/features/{test_feature.id}/parameters/999999",
            json={"label": "Ghost"},
        )
        assert resp.status_code == 404


# ===========================================================================
# TestTemplateFeatureAttachment
# ===========================================================================


class TestTemplateFeatureAttachment:

    async def test_attach_feature_to_template(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        resp = await client.post(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
            params={"is_default": False, "sort_order": 0},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["template_id"] == test_template.id
        assert data["feature_id"] == test_feature.id
        assert data["is_default"] is False
        assert data["sort_order"] == 0
        assert "feature" in data
        assert data["feature"]["id"] == test_feature.id

    async def test_list_template_features(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        # Attach first
        attach_resp = await client.post(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
        )
        assert attach_resp.status_code == 201

        # List
        resp = await client.get(f"/features/templates/{test_template.id}/features")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)
        feature_ids = [tf["feature_id"] for tf in data]
        assert test_feature.id in feature_ids

    async def test_update_attachment_is_default(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        # Attach first (not default)
        attach_resp = await client.post(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
            params={"is_default": False},
        )
        assert attach_resp.status_code == 201

        # Update is_default to True
        update_resp = await client.put(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
            json={"is_default": True, "sort_order": 2},
        )
        assert update_resp.status_code == 200, update_resp.text
        data = update_resp.json()
        assert data["is_default"] is True
        assert data["sort_order"] == 2

    async def test_detach_feature(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        # Attach first
        attach_resp = await client.post(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
        )
        assert attach_resp.status_code == 201

        # Detach
        del_resp = await client.delete(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
        )
        assert del_resp.status_code == 204

        # Confirm detached — feature no longer in list
        list_resp = await client.get(
            f"/features/templates/{test_template.id}/features"
        )
        assert list_resp.status_code == 200
        feature_ids = [tf["feature_id"] for tf in list_resp.json()]
        assert test_feature.id not in feature_ids

    async def test_attach_same_feature_twice_returns_409(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        await client.post(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
        )
        resp = await client.post(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
        )
        assert resp.status_code == 409

    async def test_attach_feature_wrong_project_returns_422(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
        test_template: Template,
        api_db: AsyncSession,
    ) -> None:
        """Attaching a feature from a different project must be rejected."""
        # Create a second project
        other_project = Project(
            organization_id=test_org.id,
            name="other_feat_project",
            display_name="Other Project",
            output_comment_style="#",
        )
        api_db.add(other_project)
        await api_db.flush()

        # Create a feature in the other project
        other_feature = Feature(
            project_id=other_project.id,
            name="other_feature",
            label="Other Feature",
        )
        api_db.add(other_feature)
        await api_db.flush()

        resp = await client.post(
            f"/features/templates/{test_template.id}/features/{other_feature.id}",
        )
        assert resp.status_code == 422

    async def test_detach_nonexistent_attachment_returns_404(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        # Nothing attached — detach should 404
        resp = await client.delete(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
        )
        assert resp.status_code == 404

    async def test_update_nonexistent_attachment_returns_404(
        self,
        client: httpx.AsyncClient,
        test_template: Template,
        test_feature: Feature,
    ) -> None:
        resp = await client.put(
            f"/features/templates/{test_template.id}/features/{test_feature.id}",
            json={"is_default": True},
        )
        assert resp.status_code == 404
