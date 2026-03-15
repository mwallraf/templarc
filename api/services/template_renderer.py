"""
Template Renderer — the full rendering pipeline for Templarc.

This service coordinates all prior Phase 4 components into two public methods:

resolve_params_for_form(template_id) → FormDefinition
    Resolves parameters, runs on_load data sources, and returns a rich
    parameter description ready for the UI to build a dynamic form.

render(template_id, provided_params, user, notes, persist) → RenderResult
    Full render: validates params, renders the Jinja2 template, prepends a
    structured metadata header, optionally persists to render_history.

Dependencies (injected via constructor):
    db           — AsyncSession for all DB reads/writes
    git_service  — GitService for reading .j2 file content
    env_factory  — EnvironmentFactory for per-project Jinja2 environments

The DataSourceResolver and SecretResolver are constructed internally because
they require the org_id (loaded from the project), which is not known until
the template is resolved.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import jinja2
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.secrets import SecretResolver
from api.models.feature import Feature, TemplateFeature
from api.services.webhook_dispatcher import WebhookContext, WebhookError, dispatch_webhooks
from api.models.parameter import Parameter
from api.models.project import Project
from api.models.render_history import RenderHistory
from api.models.template import Template
from api.models.user import User
from api.services.datasource_resolver import (
    DataSourceConfig,
    DataSourceResolver,
    MappingConfig,
)
from api.services.environment_factory import EnvironmentFactory
from api.services.git_service import GitService, TemplateNotFoundError, parse_frontmatter
from api.services.jinja_parser import extract_variables
from api.services.parameter_resolver import (
    ResolvedParameter,
    re_evaluate_derived_params,
    resolve_template_parameters,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------

@dataclass
class EnrichedParameter:
    """A resolved parameter with any data-source enrichments applied."""
    name: str
    scope: str
    widget_type: str
    label: str | None
    description: str | None
    help_text: str | None
    default_value: str | None
    required: bool
    sort_order: int
    is_derived: bool
    validation_regex: str | None = None
    section: str | None = None
    visible_when: dict | None = None
    prefill: Any | None = None
    options: list[dict] = field(default_factory=list)
    readonly: bool = False
    source_id: str | None = None


@dataclass
class AvailableFeatureParam:
    """A parameter belonging to an available feature."""
    name: str
    widget_type: str
    label: str | None
    description: str | None
    help_text: str | None
    default_value: str | None
    required: bool
    sort_order: int
    options: list[dict] = field(default_factory=list)


@dataclass
class AvailableFeature:
    """A feature available for selection in the render form."""
    id: int
    name: str
    label: str
    description: str | None
    is_default: bool
    sort_order: int
    parameters: list[AvailableFeatureParam] = field(default_factory=list)


@dataclass
class FormDefinition:
    """Result of resolve_params_for_form — ready to drive a dynamic UI form."""
    template_id: int
    parameters: list[EnrichedParameter]
    inheritance_chain: list[str]
    features: list[AvailableFeature] = field(default_factory=list)


@dataclass
class RenderResult:
    """Result of a render operation."""
    output: str
    render_id: int | None   # None when persist=False
    template_id: int
    git_sha: str


# ---------------------------------------------------------------------------
# Metadata header builder
# ---------------------------------------------------------------------------

def build_metadata_header(
    *,
    template_name: str,
    template_display_name: str,
    project_name: str,
    project_display_name: str,
    breadcrumb: list[str],          # [leaf_name, ..., root_name] — child-first
    git_sha: str,
    user: str,
    rendered_at: str,               # ISO-8601 string
    notes: str | None,
    full_context: dict[str, Any],
    comment_style: str,
) -> str:
    """
    Return a structured comment block describing this render.

    *comment_style* values:
      ``"#"``   → Python / YAML / shell line comments (default)
      ``"!"``   → Cisco IOS ``!`` comments
      ``"//"``  → C / JSON ``//`` comments
      ``"<!--"`` → XML / HTML block comment
      ``""``    → no header at all
    """
    if not comment_style:
        return ""

    sep = "=" * 60
    # breadcrumb: show root → leaf (reverse child-first order)
    crumb = " > ".join(reversed(breadcrumb))
    sha_short = git_sha[:8] + ("..." if len(git_sha) > 8 else "")

    param_lines = [
        f"  {k:<22} = {v}"
        for k, v in sorted(full_context.items())
    ]

    if comment_style == "<!--":
        body_lines = [
            f"<!-- {sep}",
            f"Generated by: {user}",
            f"Date:         {rendered_at}",
            f"Template:     {template_display_name} ({template_name})",
            f"Breadcrumb:   {crumb}",
            f"Git SHA:      {sha_short}",
            f"Project:      {project_display_name} ({project_name})",
        ]
        if notes:
            body_lines.append(f"Notes:        {notes}")
        body_lines.append("Parameters:")
        body_lines.extend(param_lines)
        body_lines.append(f"{sep} -->")
    else:
        c = comment_style
        body_lines = [
            f"{c} {sep}",
            f"{c} Generated by: {user}",
            f"{c} Date:         {rendered_at}",
            f"{c} Template:     {template_display_name} ({template_name})",
            f"{c} Breadcrumb:   {crumb}",
            f"{c} Git SHA:      {sha_short}",
            f"{c} Project:      {project_display_name} ({project_name})",
        ]
        if notes:
            body_lines.append(f"{c} Notes:        {notes}")
        body_lines.append(f"{c} Parameters:")
        body_lines.extend(f"{c}{ln}" for ln in param_lines)
        body_lines.append(f"{c} {sep}")

    return "\n".join(body_lines) + "\n"


# ---------------------------------------------------------------------------
# Frontmatter → DataSourceConfig
# ---------------------------------------------------------------------------

def _parse_data_sources(raw: list[dict]) -> list[DataSourceConfig]:
    """Convert YAML frontmatter ``data_sources`` entries to DataSourceConfig objects."""
    result: list[DataSourceConfig] = []
    for entry in raw:
        mappings = [
            MappingConfig(
                remote_field=m["remote_field"],
                to_parameter=m["to_parameter"],
                auto_fill=bool(m.get("auto_fill", False)),
                widget_override=m.get("widget_override"),
            )
            for m in entry.get("mapping", [])
        ]
        # Normalise trigger: strip accidental Jinja2 braces, e.g. "on_change:{{param}}" → "on_change:param"
        raw_trigger = entry.get("trigger", "on_load")
        normalised_trigger = re.sub(r"\{\{\s*([\w.]+)\s*\}\}", r"\1", raw_trigger)
        result.append(DataSourceConfig(
            id=entry["id"],
            url=entry["url"],
            trigger=normalised_trigger,
            auth=entry.get("auth"),
            on_error=entry.get("on_error", "warn"),
            cache_ttl=int(entry.get("cache_ttl", 60)),
            mapping=mappings,
        ))
    return result


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------

def _to_nested(flat: dict[str, Any]) -> dict:
    """
    Convert flat dot-notation keys to a nested dict for Jinja2 rendering.

    ``{"router.hostname": "r1", "glob.ntp": "1.1.1.1"}``
    → ``{"router": {"hostname": "r1"}, "glob": {"ntp": "1.1.1.1"}}``
    """
    result: dict = {}
    for key, value in flat.items():
        parts = key.split(".")
        d = result
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = value
    return result


def _build_full_context(
    parameters: list[EnrichedParameter],
    provided_params: dict[str, Any],
) -> dict[str, Any]:
    """
    Build the definitive flat parameter context for rendering.

    Priority (later wins):
      1. Parameter default_value
      2. Datasource prefill (from resolve_on_load)
      3. provided_params (user input — template-local only; glob.* / proj.* filtered)
    """
    ctx: dict[str, Any] = {}

    for ep in parameters:
        value: Any = ep.default_value or ""
        if ep.prefill is not None:
            value = ep.prefill
        ctx[ep.name] = value

    # User-provided values override defaults.
    # glob.* is always read-only (injected via Jinja2 env globals, never from user input).
    # proj.* values ARE accepted here so they appear correctly in the header and render history;
    # they are still excluded from local_ctx below, so the Jinja2 env globals take precedence
    # for the actual template rendering.
    for k, v in provided_params.items():
        if not k.startswith("glob."):
            ctx[k] = v

    return ctx


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_required(
    parameters: list[EnrichedParameter],
    provided_params: dict[str, Any],
    full_context: dict[str, Any],
) -> None:
    """
    Raise HTTP 422 if any required template-local parameter has no value.

    A parameter is satisfied if it has a non-empty value in full_context.
    """
    missing = []
    for ep in parameters:
        if ep.scope != "template":
            continue
        if not ep.required:
            continue
        val = full_context.get(ep.name)
        if val is None or str(val).strip() == "":
            missing.append(ep.name)

    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Required parameters missing values: {missing}",
        )


# ---------------------------------------------------------------------------
# TemplateRenderer
# ---------------------------------------------------------------------------

class TemplateRenderer:
    """
    Orchestrates the full template resolution and rendering pipeline.

    Parameters
    ----------
    db:
        Open async SQLAlchemy session.
    git_service:
        GitService bound to the templates repository root.
    env_factory:
        EnvironmentFactory for building / caching per-project Jinja2 envs.
    """

    def __init__(
        self,
        db: AsyncSession,
        git_service: GitService,
        env_factory: EnvironmentFactory,
    ) -> None:
        self._db = db
        self._git = git_service
        self._env_factory = env_factory

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def resolve_params_for_form(self, template_id: int) -> FormDefinition:
        """
        Return an enriched parameter list suitable for rendering a UI form.

        Steps:
        1. Resolve parameters (inheritance chain + glob/proj) from DB.
        2. Parse template frontmatter from Git for data_sources.
        3. Run datasource_resolver.resolve_on_load in parallel.
        4. Merge enrichments (prefill, options, readonly) into params.
        5. Filter glob/proj params to only those referenced in the template body.
        """
        # 1. Resolve parameters from DB
        resolution = await resolve_template_parameters(self._db, template_id)

        # 2. Load template + project for datasource resolution context
        template, project = await self._load_template_and_project(template_id)

        # 3. Parse template body + frontmatter from Git
        data_sources: list[DataSourceConfig] = []
        template_body: str = ""
        if template.git_path:
            try:
                raw = self._git.read_template(template.git_path)
                fm, template_body = parse_frontmatter(raw)
                data_sources = _parse_data_sources(fm.get("data_sources") or [])
            except TemplateNotFoundError:
                logger.warning("Template file missing from git: %s", template.git_path)

        # 4. Build set of variable names actually used in the template body.
        #    Template-local params are always included (they are explicitly registered
        #    for this template). Only glob.* and proj.* are filtered.
        used_var_paths: set[str] | None = None
        if template_body:
            try:
                used_var_paths = {ref.full_path for ref in extract_variables(template_body)}
            except Exception as exc:
                logger.warning(
                    "extract_variables failed for template %d: %s — showing all params",
                    template_id, exc,
                )

        def _is_relevant(p: "ResolvedParameter") -> bool:
            if p.scope == "template":
                return True  # always include explicitly defined template params
            if used_var_paths is None:
                return True  # parse failed — fall back to showing everything
            return p.name in used_var_paths

        filtered_params = [p for p in resolution.parameters if _is_relevant(p)]

        # 5. Build initial context from defaults for datasource URL rendering
        initial_ctx = {p.name: p.default_value or "" for p in filtered_params}

        # 6. Resolve on_load data sources
        enrichments: dict = {}
        if data_sources:
            secret_resolver = SecretResolver(self._db, project.organization_id)
            ds_resolver = DataSourceResolver(secret_resolver=secret_resolver)
            try:
                enrichments = await ds_resolver.resolve_on_load(
                    data_sources, initial_ctx, str(template_id)
                )
            except Exception as exc:
                logger.warning(
                    "on_load datasource resolution failed for template %d: %s",
                    template_id, exc,
                )

        # 7. Build EnrichedParameter list
        enriched = _enrich_parameters(filtered_params, enrichments)

        # 8. Load available features for this template
        available_features = await self._load_available_features(template_id)

        return FormDefinition(
            template_id=template_id,
            parameters=enriched,
            inheritance_chain=resolution.inheritance_chain,
            features=available_features,
        )

    async def resolve_on_change(
        self,
        template_id: int,
        changed_param: str,
        current_params: dict[str, Any],
    ) -> dict:
        """Resolve datasources and re-evaluate derived params after a param change."""
        template, project = await self._load_template_and_project(template_id)

        result: dict = {}

        # 1. Datasource triggers
        if template.git_path:
            try:
                raw = self._git.read_template(template.git_path)
                fm, _ = parse_frontmatter(raw)
                data_sources = _parse_data_sources(fm.get("data_sources") or [])
                logger.info(
                    "[on_change] template %d — %d datasource(s) in frontmatter: %s",
                    template_id, len(data_sources),
                    [(ds.id, ds.trigger) for ds in data_sources],
                )
                if data_sources:
                    secret_resolver = SecretResolver(self._db, project.organization_id)
                    ds_resolver = DataSourceResolver(secret_resolver=secret_resolver)
                    ds_enrichments = await ds_resolver.resolve_on_change(
                        data_sources, changed_param, current_params
                    )
                    result.update(ds_enrichments)
            except TemplateNotFoundError:
                logger.warning("[on_change] template %d — git file not found at %s", template_id, template.git_path)

        # 2. Re-evaluate derived parameters against the updated context
        derived_values = await re_evaluate_derived_params(
            self._db, template_id, current_params
        )
        for name, value in derived_values.items():
            if name not in result:
                result[name] = {}
            result[name]["prefill"] = value

        return result

    async def render(
        self,
        template_id: int,
        provided_params: dict[str, Any],
        user: str,
        notes: str | None = None,
        persist: bool = True,
        feature_ids: list[int] | None = None,
    ) -> RenderResult:
        """
        Render a template and optionally persist the result to render_history.

        Parameters
        ----------
        template_id:
            DB ID of the template to render.
        provided_params:
            User-supplied parameter values (template-local scope only).
        user:
            Username / display name of the caller (stored in metadata header).
        notes:
            Optional freeform notes stored in render_history and metadata header.
        persist:
            When False the render_history row is skipped (ephemeral / preview).
        """
        # 1. Resolve params and datasource enrichments
        form_def = await self.resolve_params_for_form(template_id)

        # 2. Load template + project for rendering
        template, project = await self._load_template_and_project(template_id)

        # 3. Build full context (defaults → enrichments → user input)
        full_context = _build_full_context(form_def.parameters, provided_params)

        # 4. Validate required params
        _validate_required(form_def.parameters, provided_params, full_context)

        # 5. Get git content + SHA
        if not template.git_path:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Template {template_id} has no git_path — cannot render.",
            )
        try:
            raw_content = self._git.read_template(template.git_path)
        except TemplateNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template file not found in repository: {template.git_path}",
            )

        _, template_body = parse_frontmatter(raw_content)
        git_sha = self._git.get_commit_sha(template.git_path)

        # 6. Get Jinja2 environment (with glob/proj globals + builtin filters)
        env = await self._env_factory.get_environment(project.id)

        # 7. Render — pass all non-glob params as nested context.
        # proj.* user-provided values override the project-level env globals, allowing
        # per-render overrides (e.g. service_id entered in the form, hostname from datasource).
        # glob.* remains strictly read-only via env.globals only.
        local_ctx = {
            k: v for k, v in full_context.items()
            if not k.startswith("glob.")
        }
        try:
            rendered_body = env.from_string(template_body).render(**_to_nested(local_ctx))
        except jinja2.TemplateError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Jinja2 rendering failed: {exc}",
            )

        # 7b. Render and append selected features
        if feature_ids:
            feature_blocks = await self._render_features(template_id, feature_ids, env, local_ctx)
            if feature_blocks:
                rendered_body = rendered_body + "\n" + "\n".join(feature_blocks)

        # 8. Metadata header — only include params actually used in the template body
        rendered_at = datetime.now(timezone.utc).isoformat()
        try:
            used_vars = {ref.full_path for ref in extract_variables(template_body)}
            header_context = {k: v for k, v in full_context.items() if k in used_vars}
        except Exception:
            # If parsing fails for any reason, fall back to showing all params
            header_context = full_context
        header = build_metadata_header(
            template_name=template.name,
            template_display_name=template.display_name,
            project_name=project.name,
            project_display_name=project.display_name,
            breadcrumb=form_def.inheritance_chain,
            git_sha=git_sha,
            user=user,
            rendered_at=rendered_at,
            notes=notes,
            full_context=header_context,
            comment_style=project.output_comment_style,
        )
        raw_output = header + rendered_body

        # 9. Persist
        # Resolve user ID from username (best-effort; None if not found)
        rendered_by_id: int | None = None
        if persist or True:  # always resolve for display_label extraction below
            user_result = await self._db.execute(
                select(User.id).where(User.username == user)
            )
            rendered_by_id = user_result.scalar_one_or_none()

        # Extract display_label from resolved params using template.history_label_param
        display_label: str | None = None
        if template.history_label_param:
            raw_label = full_context.get(template.history_label_param)
            if raw_label is not None:
                display_label = str(raw_label)[:500] or None

        render_id: int | None = None
        if persist:
            history = RenderHistory(
                template_id=template_id,
                template_git_sha=git_sha,
                resolved_parameters=full_context,
                raw_output=raw_output,
                rendered_by=rendered_by_id,
                notes=notes,
                display_label=display_label,
            )
            self._db.add(history)
            await self._db.flush()
            await self._db.commit()
            await self._db.refresh(history)
            render_id = history.id

        # 10. Dispatch webhooks
        webhook_ctx = WebhookContext(
            render_id=render_id,
            template_id=template_id,
            template_name=template.name,
            project_name=project.name,
            git_sha=git_sha,
            rendered_by=user,
            rendered_at=rendered_at,
            parameters=full_context,
            output=raw_output,
        )
        try:
            await dispatch_webhooks(
                db=self._db,
                template_id=template_id,
                project_id=project.id,
                organization_id=project.organization_id,
                ctx=webhook_ctx,
                persist=persist,
            )
        except WebhookError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Blocking webhook failed: {exc}",
            )

        return RenderResult(
            output=raw_output,
            render_id=render_id,
            template_id=template_id,
            git_sha=git_sha,
        )

    async def re_render(
        self,
        history_id: int,
        override_template_id: int | None = None,
        notes: str | None = None,
        persist: bool = True,
        user: str = "system",
    ) -> RenderResult:
        """
        Re-render using the stored parameters from a render_history record.

        The template body is re-loaded from Git (so a changed template body
        produces different output for the same params). The Jinja2 environment
        is rebuilt for the project of the (possibly overridden) template.

        Parameters
        ----------
        history_id:
            ID of the RenderHistory record whose params to reuse.
        override_template_id:
            If provided, render this template instead of the original.
        notes:
            Notes for the new history record (if persist=True).
        persist:
            Whether to write a new render_history record.
        user:
            Username for the metadata header.
        """
        # Load history record
        result = await self._db.execute(
            select(RenderHistory).where(RenderHistory.id == history_id)
        )
        history = result.scalar_one_or_none()
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"RenderHistory {history_id} not found",
            )

        template_id = override_template_id or history.template_id
        if template_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cannot re-render: original template has been deleted",
            )

        # Separate stored params into provided (template-local) vs glob/proj
        stored_params: dict = history.resolved_parameters or {}

        # Use the stored params as the provided params — they already include
        # the values the user submitted originally.
        return await self.render(
            template_id=template_id,
            provided_params=stored_params,
            user=user,
            notes=notes or history.notes,
            persist=persist,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_available_features(self, template_id: int) -> list[AvailableFeature]:
        """
        Load features attached to this template (via template_features) and build
        AvailableFeature dataclasses for the FormDefinition.
        """
        from sqlalchemy.orm import selectinload

        result = await self._db.execute(
            select(TemplateFeature)
            .where(TemplateFeature.template_id == template_id)
            .options(
                selectinload(TemplateFeature.feature).selectinload(Feature.parameters).selectinload(Parameter.options)
            )
            .order_by(TemplateFeature.sort_order, TemplateFeature.id)
        )
        tfs = list(result.scalars().all())

        available: list[AvailableFeature] = []
        for tf in tfs:
            feat = tf.feature
            if not feat.is_active:
                continue
            params = [
                AvailableFeatureParam(
                    name=p.name,
                    widget_type=p.widget_type,
                    label=p.label,
                    description=p.description,
                    help_text=p.help_text,
                    default_value=p.default_value,
                    required=p.required,
                    sort_order=p.sort_order,
                    options=[
                        {"value": o.value, "label": o.label}
                        for o in sorted(p.options, key=lambda o: o.sort_order)
                    ],
                )
                for p in sorted(feat.parameters, key=lambda p: (p.sort_order, p.name))
                if p.is_active
            ]
            available.append(AvailableFeature(
                id=feat.id,
                name=feat.name,
                label=feat.label,
                description=feat.description,
                is_default=tf.is_default,
                sort_order=tf.sort_order,
                parameters=params,
            ))
        return available

    async def _render_features(
        self,
        template_id: int,
        feature_ids: list[int],
        env: jinja2.Environment,
        local_ctx: dict[str, Any],
    ) -> list[str]:
        """
        Render each selected feature snippet and return the rendered blocks.
        Features not attached to this template are silently skipped (security guard).
        """
        from sqlalchemy.orm import selectinload

        result = await self._db.execute(
            select(TemplateFeature)
            .where(
                TemplateFeature.template_id == template_id,
                TemplateFeature.feature_id.in_(feature_ids),
            )
            .options(selectinload(TemplateFeature.feature))
            .order_by(TemplateFeature.sort_order, TemplateFeature.feature_id)
        )
        tfs = list(result.scalars().all())

        blocks: list[str] = []
        for tf in tfs:
            feat = tf.feature
            if not feat.is_active or not feat.snippet_path:
                continue
            try:
                content = self._git.read_template(feat.snippet_path)
                _, snippet_body = parse_frontmatter(content)
            except TemplateNotFoundError:
                logger.warning("Feature snippet missing from git: %s", feat.snippet_path)
                continue
            try:
                rendered = env.from_string(snippet_body).render(**_to_nested(local_ctx))
                if rendered.strip():
                    blocks.append(rendered)
            except jinja2.TemplateError as exc:
                logger.warning("Feature '%s' rendering failed: %s", feat.name, exc)

        return blocks

    async def _load_template_and_project(
        self, template_id: int
    ) -> tuple[Template, Project]:
        result = await self._db.execute(
            select(Template).where(Template.id == template_id)
        )
        template = result.scalar_one_or_none()
        if template is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template {template_id} not found",
            )

        proj_result = await self._db.execute(
            select(Project).where(Project.id == template.project_id)
        )
        project = proj_result.scalar_one_or_none()
        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {template.project_id} not found",
            )

        return template, project


# ---------------------------------------------------------------------------
# Enrichment merge (pure)
# ---------------------------------------------------------------------------

def _enrich_parameters(
    resolved: list[ResolvedParameter],
    enrichments: dict,
) -> list[EnrichedParameter]:
    """
    Merge datasource enrichments into the list of ResolvedParameters.

    The enrichment dict maps param_name → ParameterEnrichment TypedDict.
    """
    result: list[EnrichedParameter] = []
    for rp in resolved:
        enrichment = enrichments.get(rp.name, {})
        # DB options converted to dicts (base); datasource enrichment can append/replace
        db_options = [
            {
                "value": o.value,
                "label": o.label,
                "condition_param": o.condition_param,
                "condition_value": o.condition_value,
            }
            for o in rp.options
        ]
        result.append(EnrichedParameter(
            name=rp.name,
            scope=rp.scope,
            widget_type=rp.widget_type,
            label=rp.label,
            description=rp.description,
            help_text=rp.help_text,
            default_value=rp.default_value,
            required=rp.required,
            sort_order=rp.sort_order,
            is_derived=rp.is_derived,
            validation_regex=rp.validation_regex,
            section=rp.section,
            visible_when=rp.visible_when,
            # Derived param prefill (from parameter_resolver) wins unless overridden
            prefill=enrichment.get("prefill") if enrichment else rp.prefill,
            options=enrichment.get("options", db_options) if enrichment else db_options,
            readonly=enrichment.get("readonly", False) if enrichment else False,
            source_id=enrichment.get("source_id") if enrichment else None,
        ))
    return result
