"""
Integration tests for git sync / import (Step 3.5).

Requires a running PostgreSQL database with migrations applied.
All DB changes are rolled back after each test — the live DB is never
permanently modified.

Run with:
    uv run pytest tests/integration/test_git_sync.py -v
"""

from __future__ import annotations

import pytest
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.organization import Organization
from api.models.parameter import Parameter
from api.models.project import Project
from api.models.template import Template
from api.services.git_service import GitService
from api.services.git_sync_service import get_sync_status, run_git_sync


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def test_org(db: AsyncSession) -> Organization:
    """A test organization flushed (but not committed) into the session."""
    org = Organization(
        name="__test_sync_org__",
        display_name="Test Sync Org",
    )
    db.add(org)
    await db.flush()
    return org


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    """An isolated GitService backed by a temporary directory."""
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_project(
    db: AsyncSession,
    test_org: Organization,
    git_repo: GitService,
) -> Project:
    """
    A test project flushed into the session, with its Git directory
    initialised (containing only a .gitkeep file).
    """
    proj = Project(
        organization_id=test_org.id,
        name="__test_sync_proj__",
        display_name="Test Sync Project",
        git_path="sync_proj",
        output_comment_style="#",
    )
    db.add(proj)
    await db.flush()

    # Initialise the project directory in Git (mirrors what create_project does)
    git_repo.write_template(
        "sync_proj/.gitkeep",
        "",
        message="Init project dir",
        author="test",
    )
    return proj


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_j2(
    git_repo: GitService,
    rel_path: str,
    content: str,
) -> None:
    """Commit a .j2 file directly to Git (simulates work done outside the API)."""
    git_repo.write_template(rel_path, content, message=f"Add {rel_path}", author="test")


# ---------------------------------------------------------------------------
# run_git_sync — basic import
# ---------------------------------------------------------------------------

class TestRunGitSync:

    async def test_import_new_template(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """A .j2 file created directly in Git is imported with its parameters."""
        content = (
            "---\n"
            "parameters:\n"
            "  - name: router.hostname\n"
            "    widget: text\n"
            "    label: \"Router Hostname\"\n"
            "    required: true\n"
            "  - name: router.site_id\n"
            "    widget: number\n"
            "    required: false\n"
            "---\n"
            "hostname {{ router.hostname }}\n"
        )
        _write_j2(git_repo, "sync_proj/my_router.j2", content)

        report = await run_git_sync(db, test_project.id, git_repo)

        assert report.scanned == 1
        assert report.imported == 1
        assert report.already_registered == 0
        assert report.skipped_fragments == 0
        assert report.errors == []
        assert len(report.imported_templates) == 1
        assert report.imported_templates[0].name == "my_router"
        assert report.imported_templates[0].git_path == "sync_proj/my_router.j2"

        # Verify template record in DB
        stmt = select(Template).where(
            Template.project_id == test_project.id,
            Template.name == "my_router",
        )
        result = await db.execute(stmt)
        tmpl = result.scalar_one_or_none()
        assert tmpl is not None
        assert tmpl.git_path == "sync_proj/my_router.j2"
        assert tmpl.is_active is True

        # Verify parameters were registered
        stmt = select(Parameter).where(
            Parameter.template_id == tmpl.id,
        ).order_by(Parameter.sort_order)
        result = await db.execute(stmt)
        params = result.scalars().all()

        assert len(params) == 2
        assert params[0].name == "router.hostname"
        assert params[0].required is True
        assert params[0].widget_type == "text"
        assert params[1].name == "router.site_id"
        assert params[1].required is False
        assert params[1].widget_type == "number"

    async def test_idempotent_second_run(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Running sync twice produces no duplicate imports."""
        _write_j2(
            git_repo,
            "sync_proj/idempotent.j2",
            "---\nparameters: []\n---\nhello\n",
        )

        report1 = await run_git_sync(db, test_project.id, git_repo)
        assert report1.imported == 1

        report2 = await run_git_sync(db, test_project.id, git_repo)
        assert report2.imported == 0
        assert report2.already_registered == 1
        assert report2.errors == []

        # Still only one template in DB
        stmt = select(Template).where(Template.project_id == test_project.id)
        result = await db.execute(stmt)
        assert len(result.scalars().all()) == 1

    async def test_fragment_files_not_imported(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Files with is_fragment: true are reported but not imported."""
        _write_j2(
            git_repo,
            "sync_proj/banner.j2",
            "---\nis_fragment: true\n---\n! Banner text\n",
        )

        report = await run_git_sync(db, test_project.id, git_repo)

        assert report.scanned == 1
        assert report.imported == 0
        assert report.skipped_fragments == 1
        assert report.errors == []

        stmt = select(Template).where(Template.project_id == test_project.id)
        result = await db.execute(stmt)
        assert len(result.scalars().all()) == 0

    async def test_gitkeep_not_counted(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """The .gitkeep placeholder file is silently ignored (not in scanned count)."""
        report = await run_git_sync(db, test_project.id, git_repo)

        assert report.scanned == 0
        assert report.imported == 0

    async def test_multiple_files_mixed(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Multiple files with different statuses are all handled correctly."""
        _write_j2(git_repo, "sync_proj/a.j2", "---\nparameters: []\n---\n")
        _write_j2(git_repo, "sync_proj/b.j2", "---\nparameters: []\n---\n")
        _write_j2(git_repo, "sync_proj/frag.j2", "---\nis_fragment: true\n---\n")

        report = await run_git_sync(db, test_project.id, git_repo)

        assert report.scanned == 3
        assert report.imported == 2
        assert report.skipped_fragments == 1

    async def test_frontmatter_display_name_used(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """display_name from frontmatter overrides the auto-generated title."""
        _write_j2(
            git_repo,
            "sync_proj/cisco_891.j2",
            "---\ndisplay_name: \"Cisco 891 Router\"\nparameters: []\n---\n",
        )

        await run_git_sync(db, test_project.id, git_repo)

        stmt = select(Template).where(
            Template.project_id == test_project.id, Template.name == "cisco_891"
        )
        result = await db.execute(stmt)
        tmpl = result.scalar_one()
        assert tmpl.display_name == "Cisco 891 Router"

    async def test_project_not_found(
        self, db: AsyncSession, git_repo: GitService
    ) -> None:
        """Raises 404 when the project_id does not exist."""
        import uuid
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await run_git_sync(db, str(uuid.uuid4()), git_repo)
        assert exc_info.value.status_code == 404

    async def test_subdirectory_name_derived(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Templates in subdirectories get a name derived from relative path."""
        _write_j2(
            git_repo,
            "sync_proj/ios/base.j2",
            "---\nparameters: []\n---\n",
        )

        report = await run_git_sync(db, test_project.id, git_repo)
        assert report.imported == 1
        assert report.imported_templates[0].name == "ios_base"

    async def test_proj_params_created_on_clean_db(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """proj.* parameters are created with project scope on a clean DB (regression test)."""
        content = (
            "---\n"
            "parameters:\n"
            "  - name: proj.service_id\n"
            "    widget: text\n"
            "    label: Service ID\n"
            "  - name: proj.hostname\n"
            "    widget: text\n"
            "    label: Hostname\n"
            "  - name: local.param\n"
            "    widget: text\n"
            "---\n"
            "{{ proj.service_id }} {{ proj.hostname }} {{ local.param }}\n"
        )
        _write_j2(git_repo, "sync_proj/test.j2", content)

        report = await run_git_sync(db, test_project.id, git_repo)
        assert report.errors == []
        assert report.imported == 1

        # proj.* params must be project-scoped
        stmt = select(Parameter).where(
            Parameter.scope == "project",
            Parameter.project_id == test_project.id,
        ).order_by(Parameter.name)
        result = await db.execute(stmt)
        proj_params = result.scalars().all()
        assert len(proj_params) == 2
        names = {p.name for p in proj_params}
        assert names == {"proj.hostname", "proj.service_id"}

        # template-scoped param must be template-scoped (filter by this test's template)
        from sqlalchemy import join as sql_join
        from api.models.template import Template as Tmpl
        tmpl_stmt = select(Parameter).join(
            Tmpl, Parameter.template_id == Tmpl.id
        ).where(
            Tmpl.project_id == test_project.id,
            Parameter.scope == "template",
        )
        result = await db.execute(tmpl_stmt)
        tmpl_params = result.scalars().all()
        assert len(tmpl_params) == 1
        assert tmpl_params[0].name == "local.param"

    async def test_proj_params_not_duplicated_across_templates(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """When two templates share proj.* params, only one DB record is created per param."""
        shared_fm = (
            "---\n"
            "parameters:\n"
            "  - name: proj.service_id\n"
            "    widget: text\n"
            "---\n"
        )
        _write_j2(git_repo, "sync_proj/a.j2", shared_fm + "body a\n")
        _write_j2(git_repo, "sync_proj/b.j2", shared_fm + "body b\n")

        report = await run_git_sync(db, test_project.id, git_repo)
        assert report.errors == []
        assert report.imported == 2

        # Exactly one proj.service_id in the DB
        stmt = select(Parameter).where(
            Parameter.name == "proj.service_id",
            Parameter.scope == "project",
            Parameter.project_id == test_project.id,
        )
        result = await db.execute(stmt)
        assert len(result.scalars().all()) == 1

    async def test_glob_params_created_on_clean_db(
        self, db: AsyncSession, test_project: Project, test_org: Organization, git_repo: GitService
    ) -> None:
        """glob.* parameters are created with global scope (org FK)."""
        content = (
            "---\n"
            "parameters:\n"
            "  - name: glob.ntp_server\n"
            "    widget: text\n"
            "    label: NTP Server\n"
            "---\n"
            "ntp server {{ glob.ntp_server }}\n"
        )
        _write_j2(git_repo, "sync_proj/ntp.j2", content)

        report = await run_git_sync(db, test_project.id, git_repo)
        assert report.errors == []
        assert report.imported == 1

        stmt = select(Parameter).where(
            Parameter.name == "glob.ntp_server",
            Parameter.scope == "global",
            Parameter.organization_id == test_org.id,
        )
        result = await db.execute(stmt)
        glob_params = result.scalars().all()
        assert len(glob_params) == 1

    async def test_snippets_folder_flagged_as_snippet(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Templates under snippets/ subdirectory are auto-flagged as is_snippet=True."""
        _write_j2(
            git_repo,
            "sync_proj/snippets/banner.j2",
            "---\nparameters: []\n---\n! Banner\n",
        )
        _write_j2(
            git_repo,
            "sync_proj/normal.j2",
            "---\nparameters: []\n---\nhostname {{ x }}\n",
        )

        report = await run_git_sync(db, test_project.id, git_repo)
        assert report.imported == 2

        stmt = select(Template).where(Template.project_id == test_project.id)
        result = await db.execute(stmt)
        templates = {t.name: t for t in result.scalars().all()}

        assert templates["snippets_banner"].is_snippet is True
        assert templates["normal"].is_snippet is False

    async def test_frontmatter_is_snippet_flag(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """is_snippet: true in frontmatter flags a template as snippet regardless of path."""
        _write_j2(
            git_repo,
            "sync_proj/not_in_snippets_dir.j2",
            "---\nis_snippet: true\nparameters: []\n---\n",
        )

        await run_git_sync(db, test_project.id, git_repo)

        stmt = select(Template).where(
            Template.project_id == test_project.id,
            Template.name == "not_in_snippets_dir",
        )
        result = await db.execute(stmt)
        tmpl = result.scalar_one()
        assert tmpl.is_snippet is True


# ---------------------------------------------------------------------------
# get_sync_status
# ---------------------------------------------------------------------------

class TestGetSyncStatus:

    async def test_in_git_only_before_sync(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """A .j2 file not yet imported shows as in_git_only."""
        _write_j2(
            git_repo,
            "sync_proj/orphan.j2",
            "---\nparameters: []\n---\nhello\n",
        )

        status_report = await get_sync_status(db, test_project.id, git_repo)

        assert status_report.in_git_only == 1
        assert status_report.in_sync == 0
        assert status_report.in_db_only == 0

        item = status_report.items[0]
        assert item.git_path == "sync_proj/orphan.j2"
        assert item.status == "in_git_only"

    async def test_in_sync_after_import(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """After a sync run the file is reported as in_sync."""
        _write_j2(
            git_repo,
            "sync_proj/synced.j2",
            "---\nparameters: []\n---\nhello\n",
        )

        await run_git_sync(db, test_project.id, git_repo)

        status_report = await get_sync_status(db, test_project.id, git_repo)
        assert status_report.in_sync == 1
        assert status_report.in_git_only == 0

    async def test_fragment_shows_as_fragment(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Fragment files are listed separately with status='fragment'."""
        _write_j2(
            git_repo,
            "sync_proj/inc_banner.j2",
            "---\nis_fragment: true\n---\n! Header\n",
        )

        status_report = await get_sync_status(db, test_project.id, git_repo)

        assert status_report.skipped_fragments == 1
        assert status_report.in_git_only == 0
        assert any(i.status == "fragment" for i in status_report.items)

    async def test_empty_project(
        self, db: AsyncSession, test_project: Project, git_repo: GitService
    ) -> None:
        """Empty project (only .gitkeep) returns all-zero counts."""
        status_report = await get_sync_status(db, test_project.id, git_repo)

        assert status_report.in_sync == 0
        assert status_report.in_git_only == 0
        assert status_report.in_db_only == 0
        assert status_report.items == []

    async def test_project_not_found(
        self, db: AsyncSession, git_repo: GitService
    ) -> None:
        """Raises 404 for unknown project_id."""
        import uuid
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_sync_status(db, str(uuid.uuid4()), git_repo)
        assert exc_info.value.status_code == 404
