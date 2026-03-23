"""
project_yaml_service — write-back helper for project.yaml.

Called after any mutation of a project-scope parameter or project metadata
to keep project.yaml in Git in sync with the DB (DB is authoritative).
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.parameter import Parameter, ParameterScope
from api.models.project import Project
from api.services.git_service import GitService

logger = logging.getLogger(__name__)


async def write_project_yaml(
    db: AsyncSession,
    project_id: str,
    git_svc: GitService,
    author: str = "templarc",
) -> None:
    """
    Fetch the current project + all active proj.* params from DB and
    overwrite project.yaml in Git.

    Best-effort: logs a warning on failure but never raises, so the
    API response is unaffected even if the Git write fails.
    """
    proj = await db.get(Project, project_id)
    if proj is None or not proj.git_path:
        return

    # Fetch all active project-scope params, ordered for deterministic output
    stmt = (
        select(Parameter)
        .where(
            Parameter.project_id == project_id,
            Parameter.scope == ParameterScope.project,
            Parameter.is_active.is_(True),
        )
        .order_by(Parameter.sort_order, Parameter.name)
    )
    params = (await db.execute(stmt)).scalars().all()

    params_list = []
    for p in params:
        entry: dict = {"name": p.name, "widget": p.widget_type}
        if p.label:
            entry["label"] = p.label
        if p.description:
            entry["description"] = p.description
        if p.default_value is not None:
            entry["default_value"] = p.default_value
        if p.required:
            entry["required"] = True
        params_list.append(entry)

    project_data: dict = {
        "name": proj.name,
        "display_name": proj.display_name,
    }
    if proj.description:
        project_data["description"] = proj.description
    project_data["output_comment_style"] = proj.output_comment_style
    if params_list:
        project_data["parameters"] = params_list

    try:
        git_svc.write_project_yaml(proj.git_path, project_data, author=author)
    except Exception as exc:
        # project.yaml is a best-effort write-back (DB is authoritative), so we
        # never raise here. But this is logged at ERROR — a silent failure means
        # Git and the DB are now out of sync, which an operator MUST investigate.
        # Common causes: git ownership mismatch, disk full, repo corruption.
        logger.error(
            "project.yaml write-back failed for project %s — Git is out of sync "
            "with the DB. Check git repository health at: %s. Error: %s",
            project_id,
            proj.git_path,
            exc,
        )
