"""
Jinja2 Environment Factory for Templarc.

Manages a process-level cache of per-project ``jinja2.Environment`` instances.
Each project has its own isolated environment with:

- A ``FileSystemLoader`` pointed at the project's Git-backed template directory
  (``{TEMPLATES_REPO_PATH}/{project.git_path}``).
- ``glob`` dict in ``env.globals`` containing all active ``glob.*`` parameters
  for the project's organization (with the ``glob.`` prefix stripped).
- ``proj`` dict in ``env.globals`` containing all active ``proj.*`` parameters
  for the project (with the ``proj.`` prefix stripped).
- All built-in Jinja2 filters from ``api.jinja_filters.BUILTIN_FILTERS``.

Cache invalidation
------------------
The cache entry is keyed by ``project_id`` and stores the environment together
with the ``project.updated_at`` timestamp at build time.  On each
``get_environment`` call the current ``updated_at`` is compared; a mismatch
triggers a rebuild.  ``invalidate(project_id)`` forces an immediate eviction
(call it whenever glob or project parameters are modified).

Project-specific custom filters
--------------------------------
The spec calls for DB-stored Python filter callables loaded via ``exec``.
This requires a ``project_filters`` table which is not yet in the schema.
The plumbing is present (``_load_project_filters`` stub) and will be wired
once the model exists.  For now only built-in filters are registered.

Thread / concurrency safety
---------------------------
The module-level ``_ENV_CACHE`` dict is mutated only inside async methods,
and Python's asyncio event loop is single-threaded, so no locking is needed.
In a multi-worker (multi-process) deployment each worker has its own cache;
``invalidate`` must be called on all workers (e.g. via a shared pub/sub
channel) or a distributed cache like Redis should replace this dict.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import jinja2
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings
from api.jinja_filters import BUILTIN_FILTERS
from api.models.parameter import Parameter, ParameterScope
from api.models.project import Project

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level cache
# ---------------------------------------------------------------------------

# project_id → (jinja2.Environment, updated_at at build time)
_ENV_CACHE: dict[str, tuple[jinja2.Environment, datetime]] = {}


def clear_env_cache() -> None:
    """Flush the entire environment cache (useful in tests)."""
    _ENV_CACHE.clear()


# ---------------------------------------------------------------------------
# EnvironmentFactory
# ---------------------------------------------------------------------------

class EnvironmentFactory:
    """
    Builds and caches per-project Jinja2 environments.

    Parameters
    ----------
    db:
        An open async SQLAlchemy session used to query project metadata,
        glob parameters, and project parameters.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_environment(self, project_id: str) -> jinja2.Environment:
        """
        Return the Jinja2 Environment for *project_id*.

        Returns a cached instance unless the project has been updated since
        the environment was last built.
        """
        project = await self._load_project(project_id)

        cached = _ENV_CACHE.get(project_id)
        if cached is not None:
            env, cached_at = cached
            if cached_at >= project.updated_at:
                logger.debug("Environment cache hit for project %s", project_id)
                return env

        logger.debug("Building Jinja2 environment for project %s", project_id)
        env = await self._build_environment(project)
        _ENV_CACHE[project_id] = (env, project.updated_at)
        return env

    @staticmethod
    def invalidate(project_id: str) -> None:
        """
        Evict the cached environment for *project_id*.

        Call this whenever glob or project parameters are added, updated,
        or deleted so the next ``get_environment`` call rebuilds from scratch.
        """
        _ENV_CACHE.pop(project_id, None)
        logger.debug("Environment cache invalidated for project %s", project_id)

    # ------------------------------------------------------------------
    # Build helpers
    # ------------------------------------------------------------------

    async def _build_environment(self, project: Project) -> jinja2.Environment:
        loader = self._build_loader(project)
        env = jinja2.Environment(
            loader=loader,
            undefined=jinja2.Undefined,
            autoescape=False,
            keep_trailing_newline=True,
        )

        # Built-in filters
        env.filters.update(BUILTIN_FILTERS)

        # Custom filters from DB (global + project-scoped)
        await self._load_project_filters(env, project)

        # Custom context objects from DB (global + project-scoped)
        await self._load_project_objects(env, project)

        # Custom macros from DB (global + project-scoped)
        await self._load_project_macros(env, project)

        # Parameter globals
        env.globals["glob"] = await self._load_glob_params(project.organization_id)
        env.globals["proj"] = await self._load_proj_params(project.id)

        return env

    @staticmethod
    def _build_loader(project: Project) -> jinja2.BaseLoader:
        settings = get_settings()
        base = Path(settings.TEMPLATES_REPO_PATH)
        if project.git_path:
            template_dir = base / project.git_path
        else:
            template_dir = base

        if template_dir.is_dir():
            return jinja2.FileSystemLoader(str(template_dir))

        # Directory doesn't exist yet (new project, empty repo) — use a no-op loader.
        logger.warning(
            "Template directory %r does not exist for project %s; "
            "using BaseLoader (no templates loadable by path).",
            str(template_dir),
            project.id,
        )
        return jinja2.BaseLoader()

    async def _load_glob_params(self, org_id: int) -> dict[str, str]:
        """Return {stripped_name: default_value} for all active global parameters."""
        result = await self._db.execute(
            select(Parameter).where(
                Parameter.scope == ParameterScope.global_,
                Parameter.organization_id == org_id,
                Parameter.is_active.is_(True),
            )
        )
        params = result.scalars().all()
        return {
            _strip_prefix(p.name, "glob."): p.default_value or ""
            for p in params
        }

    async def _load_proj_params(self, project_id: str) -> dict[str, str]:
        """Return {stripped_name: default_value} for all active project parameters."""
        result = await self._db.execute(
            select(Parameter).where(
                Parameter.scope == ParameterScope.project,
                Parameter.project_id == project_id,
                Parameter.is_active.is_(True),
            )
        )
        params = result.scalars().all()
        return {
            _strip_prefix(p.name, "proj."): p.default_value or ""
            for p in params
        }

    async def _load_project_filters(self, env: jinja2.Environment, project: Project) -> None:
        """
        Register custom Jinja2 filters from the DB into *env*.

        Loads all active global filters plus any project-scoped filters for
        this project.  Invalid filter code is skipped with a warning so a
        single bad filter does not break environment builds for all users.
        """
        from api.core.sandbox import SandboxError, validate_and_compile
        from api.models.custom_filter import CustomFilter

        result = await self._db.execute(
            select(CustomFilter).where(
                CustomFilter.is_active.is_(True),
                or_(
                    CustomFilter.scope == "global",
                    and_(
                        CustomFilter.scope == "project",
                        CustomFilter.project_id == project.id,
                    ),
                ),
            )
        )
        for cf in result.scalars().all():
            try:
                env.filters[cf.name] = validate_and_compile(cf.code)
            except SandboxError:
                logger.warning(
                    "Skipping invalid custom filter %r (id=%d) — sandbox rejected the code",
                    cf.name,
                    cf.id,
                )

    async def _load_project_objects(self, env: jinja2.Environment, project: Project) -> None:
        """
        Register custom context objects from the DB into *env.globals*.

        Loads all active global objects (project_id IS NULL) plus any
        project-scoped objects for this project.
        """
        from api.core.sandbox import SandboxError, validate_and_compile
        from api.models.custom_object import CustomObject

        result = await self._db.execute(
            select(CustomObject).where(
                CustomObject.is_active.is_(True),
                or_(
                    CustomObject.project_id.is_(None),
                    CustomObject.project_id == project.id,
                ),
            )
        )
        for co in result.scalars().all():
            try:
                env.globals[co.name] = validate_and_compile(co.code)
            except SandboxError:
                logger.warning(
                    "Skipping invalid custom object %r (id=%d) — sandbox rejected the code",
                    co.name,
                    co.id,
                )

    async def _load_project_macros(self, env: jinja2.Environment, project: Project) -> None:
        """
        Compile custom Jinja2 macros from the DB and register them in *env.globals*.

        Each macro body must contain a ``{% macro <name>(...) %}...{% endmacro %}``
        definition.  The compiled callable is registered as ``env.globals[name]``
        so templates can call it directly without an import statement.

        Loads all active global macros plus any project-scoped macros for this project.
        Invalid macro bodies are skipped with a warning.
        """
        from api.models.custom_macro import CustomMacro

        result = await self._db.execute(
            select(CustomMacro).where(
                CustomMacro.is_active.is_(True),
                or_(
                    CustomMacro.scope == "global",
                    and_(
                        CustomMacro.scope == "project",
                        CustomMacro.project_id == project.id,
                    ),
                ),
            )
        )
        for cm in result.scalars().all():
            try:
                tmpl = env.from_string(cm.body)
                fn = getattr(tmpl.module, cm.name, None)
                if fn is not None:
                    env.globals[cm.name] = fn
                else:
                    logger.warning(
                        "Custom macro %r (id=%d) body does not define a macro named %r — skipping",
                        cm.name,
                        cm.id,
                        cm.name,
                    )
            except jinja2.exceptions.TemplateSyntaxError:
                logger.warning(
                    "Skipping invalid custom macro %r (id=%d) — Jinja2 syntax error",
                    cm.name,
                    cm.id,
                )

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    async def _load_project(self, project_id: str) -> Project:
        result = await self._db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if project is None:
            raise ValueError(f"Project {project_id!r} not found")
        return project


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _strip_prefix(name: str, prefix: str) -> str:
    """Remove *prefix* from *name* if present; return *name* unchanged otherwise."""
    return name[len(prefix):] if name.startswith(prefix) else name
