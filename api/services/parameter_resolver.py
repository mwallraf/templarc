"""
Parameter resolver — derived parameter evaluation.

Supports four expression types for derived parameters:

  Type 1 — Formula (Jinja2 template):
      derived_expression = "{{ core.bandwidth_mb * 1000 }}"
      Rendered with the full current context; supports arithmetic, filters,
      string ops, and anything available in a SandboxedEnvironment.

  Type 2 — Conditional lookup:
      derived_expression = "lookup:core.interface_type"
      Selects a value from the parameter's options list based on a
      condition_param / condition_value match. Returns empty string on miss.

  Type 3 — Transform:
      derived_expression = "transform:core.hostname:lower|strip"
      Applies one or more named string transformations (pipe-separated):
        upper, lower, strip, title, replace:<from>:<to>
      Transforms are applied left-to-right.

  Type 4 — Coalesce:
      derived_expression = "coalesce:core.custom_prefix:core.default_prefix"
      Returns the first non-empty value from the listed parameter names.

Dependency ordering:
  resolve_derived_params() topologically sorts derived parameters so that a
  derived param that references another derived param is always evaluated
  after its dependency. Circular dependencies raise DerivedParamError.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import jinja2
import jinja2.nodes
import jinja2.sandbox
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

if TYPE_CHECKING:
    from api.models.parameter import Parameter
    from api.models.parameter_option import ParameterOption
    from api.models.template import Template
    from api.models.project import Project


# ---------------------------------------------------------------------------
# Custom error
# ---------------------------------------------------------------------------

class DerivedParamError(Exception):
    """Raised when derived parameter resolution fails."""


# ---------------------------------------------------------------------------
# Expression type detection
# ---------------------------------------------------------------------------

def _expression_type(expression: str) -> str:
    """Return 'formula', 'lookup', 'transform', or 'coalesce'."""
    if expression.startswith("lookup:"):
        return "lookup"
    if expression.startswith("transform:"):
        return "transform"
    if expression.startswith("coalesce:"):
        return "coalesce"
    return "formula"


# ---------------------------------------------------------------------------
# Jinja2 AST — extract dotted parameter names
# ---------------------------------------------------------------------------

def _dotted_name_from_node(node: jinja2.nodes.Node) -> str | None:
    """
    Reconstruct a dotted name from a chain of Getattr / Name nodes.
    Returns None if the node chain is not a simple dotted name.

    Example: Getattr(Getattr(Name('a'), 'b'), 'c')  →  "a.b.c"
    """
    parts: list[str] = []
    current: jinja2.nodes.Node = node
    while isinstance(current, jinja2.nodes.Getattr):
        parts.append(current.attr)
        current = current.node
    if isinstance(current, jinja2.nodes.Name):
        parts.append(current.name)
        parts.reverse()
        return ".".join(parts)
    return None


def _walk_for_refs(node: jinja2.nodes.Node, refs: set[str]) -> None:
    """Recursively collect all dotted/plain variable references in the AST."""
    if isinstance(node, jinja2.nodes.Getattr):
        name = _dotted_name_from_node(node)
        if name:
            refs.add(name)
        # Do NOT recurse — the full dotted chain is already captured
        return
    if isinstance(node, jinja2.nodes.Name):
        refs.add(node.name)
        return
    for child in node.iter_child_nodes():
        _walk_for_refs(child, refs)


def _extract_jinja2_deps(expression: str) -> set[str]:
    """Parse a Jinja2 expression and return all variable references found."""
    env = jinja2.Environment()
    try:
        ast = env.parse(expression)
    except jinja2.TemplateSyntaxError:
        return set()
    refs: set[str] = set()
    _walk_for_refs(ast, refs)
    return refs


# ---------------------------------------------------------------------------
# Dependency extraction per expression type
# ---------------------------------------------------------------------------

def _get_dependencies(param: "Parameter") -> set[str]:
    """
    Return the set of parameter names this derived param depends on.
    Only the names returned here are used for topological ordering —
    non-derived parameters in this set are expected to already be in
    the context when evaluation starts.
    """
    expr = param.derived_expression or ""
    etype = _expression_type(expr)

    if etype == "lookup":
        target = expr[len("lookup:"):]
        return {target} if target else set()

    if etype == "transform":
        # format: transform:<param_name>:<ops>
        parts = expr.split(":", 2)
        return {parts[1]} if len(parts) >= 2 and parts[1] else set()

    if etype == "coalesce":
        # format: coalesce:<p1>:<p2>:...
        parts = expr.split(":")
        return {p for p in parts[1:] if p}

    # formula — parse Jinja2 AST
    return _extract_jinja2_deps(expr)


# ---------------------------------------------------------------------------
# Topological sort (DFS, post-order)
# ---------------------------------------------------------------------------

def _topological_sort(derived_params: list["Parameter"]) -> list["Parameter"]:
    """
    Return derived_params in evaluation order: dependencies always appear
    before the params that depend on them.

    Only inter-derived-param dependencies are considered for ordering;
    dependencies on regular (non-derived) params are ignored here because
    those are already resolved in the context before this function is called.

    Raises DerivedParamError on circular dependency.
    """
    derived_names = {p.name for p in derived_params}
    by_name = {p.name: p for p in derived_params}

    # Restrict dependency graph to derived-only edges
    deps: dict[str, set[str]] = {
        p.name: _get_dependencies(p) & derived_names
        for p in derived_params
    }

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {p.name: WHITE for p in derived_params}
    result: list["Parameter"] = []

    def visit(name: str, stack: list[str]) -> None:
        if color[name] == BLACK:
            return
        if color[name] == GRAY:
            cycle = " → ".join(stack + [name])
            raise DerivedParamError(
                f"Circular dependency detected in derived parameters: {cycle}"
            )
        color[name] = GRAY
        for dep in deps[name]:
            visit(dep, stack + [name])
        color[name] = BLACK
        result.append(by_name[name])

    for param in derived_params:
        if color[param.name] == WHITE:
            visit(param.name, [])

    return result  # post-order DFS = topological order for dependencies-first


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------

def _to_nested(flat: dict) -> dict:
    """
    Convert a flat parameter context to a nested dict for Jinja2 rendering.

    {"core.bandwidth_mb": 100, "glob.ntp": "1.2.3.4"}
    →  {"core": {"bandwidth_mb": 100}, "glob": {"ntp": "1.2.3.4"}}

    Arbitrary depth is supported.
    """
    result: dict = {}
    for key, value in flat.items():
        parts = key.split(".")
        d = result
        for part in parts[:-1]:
            if part not in d or not isinstance(d[part], dict):
                d[part] = {}
            d = d[part]
        d[parts[-1]] = value
    return result


# ---------------------------------------------------------------------------
# Evaluators
# ---------------------------------------------------------------------------

def _coerce_numeric(value: object) -> object:
    """
    Try to convert a string to int or float so Jinja2 arithmetic works correctly.
    "10" * 1000 → string repetition in Jinja2; 10 * 1000 → 10000.

    Strings with leading zeros (e.g. "01", "007") are left as-is because they
    represent formatted identifiers, not arithmetic operands.
    Non-numeric strings and non-string values are returned unchanged.
    """
    if not isinstance(value, str):
        return value
    # Preserve zero-padded strings — they are formatted identifiers, not numbers
    if len(value) > 1 and value[0] == "0" and value[1:2].isdigit():
        return value
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def _evaluate_formula(expression: str, context: dict) -> str:
    """
    Render a Jinja2 formula template against the context.
    Uses SandboxedEnvironment to prevent code injection.
    Unknown variables render as empty string (not an error).
    String values that look numeric are coerced to int/float so that
    arithmetic like {{ core.bandwidth_mb * 1000 }} works correctly.
    """
    # ChainableUndefined allows attribute access on missing vars (returns Undefined)
    # so {{ missing.attr }} renders as "" instead of raising UndefinedError.
    env = jinja2.sandbox.SandboxedEnvironment(undefined=jinja2.ChainableUndefined)
    template = env.from_string(expression)
    coerced = {k: _coerce_numeric(v) for k, v in context.items()}
    nested = _to_nested(coerced)
    return str(template.render(**nested)).strip()


def _evaluate_lookup(expression: str, param: "Parameter", context: dict) -> str:
    """
    Select a value from param.options where:
      option.condition_param == trigger_param_name
      option.condition_value == str(context[trigger_param_name])

    Returns empty string if no option matches.
    """
    target_name = expression[len("lookup:"):]
    trigger_value = str(context.get(target_name, ""))

    for option in param.options:
        if (
            option.condition_param == target_name
            and option.condition_value == trigger_value
        ):
            return option.value

    return ""


def _evaluate_transform(expression: str, context: dict) -> str:
    """
    Apply string transformations to a parameter value.

    Format: transform:<param_name>:<op1>|<op2>|...
    Supported ops: upper, lower, strip, title, replace:<from>:<to>
    """
    parts = expression.split(":", 2)
    if len(parts) < 3:
        # Malformed — return empty rather than crash
        return ""

    _, param_name, ops_str = parts
    value = str(context.get(param_name, ""))

    for op in ops_str.split("|"):
        op = op.strip()
        if op == "upper":
            value = value.upper()
        elif op == "lower":
            value = value.lower()
        elif op == "strip":
            value = value.strip()
        elif op == "title":
            value = value.title()
        elif op.startswith("replace:"):
            # replace:<from>:<to>
            replace_parts = op.split(":", 2)
            if len(replace_parts) == 3:
                _, from_, to_ = replace_parts
                value = value.replace(from_, to_)

    return value


def _evaluate_coalesce(expression: str, context: dict) -> str:
    """
    Return the first non-empty value from a list of parameter names.

    Format: coalesce:<param1>:<param2>:...<paramN>
    Returns empty string if all values are empty/missing.
    """
    parts = expression.split(":")
    param_names = parts[1:]

    for name in param_names:
        value = context.get(name)
        if value is not None and str(value) != "":
            return str(value)

    return ""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_derived_params(
    derived_params: list["Parameter"],
    context: dict,
) -> dict:
    """
    Evaluate all derived parameters in topological order and return a new
    context dict enriched with their computed values.

    Args:
        derived_params: Parameter objects with is_derived=True.
                        Options must already be loaded (e.g. via selectinload).
        context:        The current resolved parameter context (name → value),
                        containing all non-derived parameter values.

    Returns:
        A new dict = context + computed derived values.

    Raises:
        DerivedParamError: On circular dependency or unsupported expression.
    """
    if not derived_params:
        return dict(context)

    sorted_params = _topological_sort(derived_params)
    result = dict(context)

    for param in sorted_params:
        expr = param.derived_expression or ""
        if not expr:
            continue

        etype = _expression_type(expr)

        if etype == "lookup":
            value = _evaluate_lookup(expr, param, result)
        elif etype == "transform":
            value = _evaluate_transform(expr, result)
        elif etype == "coalesce":
            value = _evaluate_coalesce(expr, result)
        else:
            value = _evaluate_formula(expr, result)

        result[param.name] = value

    return result


# ===========================================================================
# Step 2.3 — Full template parameter resolver
# ===========================================================================

# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class ResolvedParameter:
    """A single parameter in the resolution result, enriched with all metadata."""
    name: str
    scope: str                    # "global" | "project" | "template"
    source_template_id: str | None  # which template in the chain defined this (template scope only)
    widget_type: str
    label: str | None
    description: str | None
    help_text: str | None
    default_value: str | None
    required: bool
    sort_order: int
    options: list                 # list[ParameterOption] — for select/multiselect widgets
    prefill: str | None           # computed value for derived params; None for regular (filled later by datasource resolver)
    is_derived: bool
    validation_regex: str | None = None
    section: str | None = None
    visible_when: dict | None = None


@dataclass
class ParameterResolutionResult:
    """
    Full resolution output for a template.

    parameters: all params (global + project + template) in form display order.
    glob_params / proj_params: convenient subsets for the UI to render scope badges.
    inheritance_chain: template names from leaf → root (child-first order).
    """
    parameters: list[ResolvedParameter]
    inheritance_chain: list[str]
    glob_params: list[ResolvedParameter]
    proj_params: list[ResolvedParameter]


# ---------------------------------------------------------------------------
# Pure business logic (no DB — easily unit-tested)
# ---------------------------------------------------------------------------

def _merge_chain(
    chain: "list[Template]",
) -> "dict[str, tuple[Parameter, int]]":
    """
    Merge template-local parameters across the inheritance chain.

    Walking order: root → child (reversed chain). Each subsequent template
    can override a same-named param from a parent, so child wins.

    Returns: {param_name: (Parameter, source_template_id)}
    """
    merged: dict[str, tuple] = {}
    for template in reversed(chain):  # root first, child last → child overrides
        for param in template.parameters:
            if param.is_active and param.scope == "template":
                merged[param.name] = (param, template.id)
    return merged


def _build_base_context(
    template_merged: "dict[str, tuple[Parameter, int]]",
    proj_params: "list[Parameter]",
    glob_params: "list[Parameter]",
) -> dict:
    """
    Build the initial name→default_value context used for derived param evaluation.

    Priority (later wins):  template chain → proj.* → glob.*
    Derived parameters are excluded from the base context (they are computed).
    """
    ctx: dict = {}
    for param, _ in template_merged.values():
        if not param.is_derived:
            ctx[param.name] = param.default_value
    for param in proj_params:
        if not param.is_derived:
            ctx[param.name] = param.default_value
    for param in glob_params:
        if not param.is_derived:
            ctx[param.name] = param.default_value
    return ctx


def build_resolution_result(
    chain: "list[Template]",
    proj_params: "list[Parameter]",
    glob_params: "list[Parameter]",
) -> ParameterResolutionResult:
    """
    Pure function: build a ParameterResolutionResult from pre-loaded DB objects.

    All lazy relationships must already be loaded before calling this function
    (use selectinload in the async DB helpers below).

    Merge semantics:
      - Template chain: child overrides parent for same-named params
      - glob.* and proj.* are ALWAYS injected and CANNOT be overridden by template params
    """
    # 1. Merge template chain (child wins)
    template_merged = _merge_chain(chain)

    # 2. Build base context for derived param evaluation
    base_ctx = _build_base_context(template_merged, proj_params, glob_params)

    # 3. Collect all derived params across all scopes
    all_derived: list = []
    for param, _ in template_merged.values():
        if param.is_derived:
            all_derived.append(param)
    for param in proj_params:
        if param.is_derived:
            all_derived.append(param)
    for param in glob_params:
        if param.is_derived:
            all_derived.append(param)

    # 4. Evaluate derived params
    resolved_ctx = resolve_derived_params(all_derived, base_ctx)

    # 5. Build ResolvedParameter objects
    def _make(param: "Parameter", source_tid: int | None) -> ResolvedParameter:
        prefill: str | None = None
        if param.is_derived and param.name in resolved_ctx:
            prefill = str(resolved_ctx[param.name])
        return ResolvedParameter(
            name=param.name,
            scope=param.scope,
            source_template_id=source_tid,
            widget_type=param.widget_type,
            label=param.label,
            description=param.description,
            help_text=param.help_text,
            default_value=param.default_value,
            required=param.required,
            sort_order=param.sort_order,
            options=list(param.options),
            prefill=prefill,
            is_derived=param.is_derived,
            validation_regex=param.validation_regex,
            section=param.section,
            visible_when=param.visible_when,
        )

    resolved_glob = [
        _make(p, None)
        for p in sorted(glob_params, key=lambda p: (p.sort_order, p.name))
    ]
    resolved_proj = [
        _make(p, None)
        for p in sorted(proj_params, key=lambda p: (p.sort_order, p.name))
    ]
    resolved_tmpl = [
        _make(param, src_tid)
        for param, src_tid in sorted(
            template_merged.values(), key=lambda t: (t[0].sort_order, t[0].name)
        )
    ]

    all_params = resolved_glob + resolved_proj + resolved_tmpl

    return ParameterResolutionResult(
        parameters=all_params,
        inheritance_chain=[t.name for t in chain],
        glob_params=resolved_glob,
        proj_params=resolved_proj,
    )


# ---------------------------------------------------------------------------
# Async DB helpers (thin — all logic is in pure functions above)
# ---------------------------------------------------------------------------

async def _load_template_with_params(
    db: AsyncSession, template_id: str
) -> "Template | None":
    """Load a template with its parameters and each parameter's options."""
    from api.models.template import Template
    from api.models.parameter import Parameter

    result = await db.execute(
        select(Template)
        .where(Template.id == template_id)
        .options(
            selectinload(Template.parameters).selectinload(Parameter.options)
        )
    )
    return result.scalar_one_or_none()


async def _load_inheritance_chain(
    db: AsyncSession, template_id: str
) -> "list[Template]":
    """
    Walk parent_template_id FKs from leaf to root.
    Returns [leaf, parent, grandparent, ...root] (child-first order).
    Raises DerivedParamError on circular inheritance (defensive guard).
    """
    chain = []
    current_id: str | None = template_id
    visited: set[str] = set()

    while current_id is not None:
        if current_id in visited:
            raise DerivedParamError(
                f"Circular template inheritance detected at template id={current_id}"
            )
        visited.add(current_id)
        template = await _load_template_with_params(db, current_id)
        if template is None:
            break
        chain.append(template)
        current_id = template.parent_template_id

    return chain


async def _load_project_params(
    db: AsyncSession, project_id: str
) -> "list[Parameter]":
    """Load active project-scoped (proj.*) parameters with options."""
    from api.models.parameter import Parameter

    result = await db.execute(
        select(Parameter)
        .where(
            Parameter.project_id == project_id,
            Parameter.scope == "project",
            Parameter.is_active.is_(True),
        )
        .options(selectinload(Parameter.options))
        .order_by(Parameter.sort_order, Parameter.name)
    )
    return list(result.scalars().all())


async def _load_glob_params(
    db: AsyncSession, organization_id: str
) -> "list[Parameter]":
    """Load active global (glob.*) parameters with options."""
    from api.models.parameter import Parameter

    result = await db.execute(
        select(Parameter)
        .where(
            Parameter.organization_id == organization_id,
            Parameter.scope == "global",
            Parameter.is_active.is_(True),
        )
        .options(selectinload(Parameter.options))
        .order_by(Parameter.sort_order, Parameter.name)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def re_evaluate_derived_params(
    db: AsyncSession,
    template_id: str,
    current_context: dict,
) -> dict[str, str]:
    """
    Re-evaluate all derived parameters for a template against a given context.

    Used by the on_change handler so that derived readonly fields (e.g. ``vendor``
    derived from ``hardware``) are updated in the UI whenever a dependency changes.

    Parameters
    ----------
    current_context:
        The current form values (name → value), typically from the on_change
        request body. Derived params are re-computed against this context.

    Returns
    -------
    A dict mapping each derived parameter name to its newly computed value.
    """
    chain = await _load_inheritance_chain(db, template_id)
    if not chain:
        return {}

    # Collect all derived params from the inheritance chain
    all_derived: list = []
    for template in chain:
        for param in template.parameters:
            if param.is_active and param.is_derived:
                all_derived.append(param)

    if not all_derived:
        return {}

    resolved = resolve_derived_params(all_derived, current_context)
    return {p.name: str(resolved[p.name]) for p in all_derived if p.name in resolved}


async def resolve_template_parameters(
    db: AsyncSession,
    template_id: str,
) -> ParameterResolutionResult:
    """
    Resolve all parameters for a template — the primary API for Step 2.3.

    1. Loads the inheritance chain (leaf → root) via parent_template_id
    2. Merges template-local params (child overrides parent)
    3. Loads project proj.* params and org glob.* params
    4. Evaluates derived parameters in topological order
    5. Returns a ParameterResolutionResult with all metadata for the UI form

    Raises HTTPException 404 if the template does not exist.
    Raises DerivedParamError if there is a circular derived-param dependency.
    """
    from api.models.project import Project

    chain = await _load_inheritance_chain(db, template_id)
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found.",
        )

    leaf = chain[0]

    # Load the project to get organization_id for glob params
    proj_result = await db.execute(
        select(Project).where(Project.id == leaf.project_id)
    )
    project = proj_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {leaf.project_id} not found.",
        )

    proj_params = await _load_project_params(db, project.id)
    glob_params = await _load_glob_params(db, project.organization_id)

    return build_resolution_result(chain, proj_params, glob_params)
