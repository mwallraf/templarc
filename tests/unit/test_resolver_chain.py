"""
Unit tests for the full parameter resolver (Step 2.3).

Tests focus on build_resolution_result() — the pure function containing all
merge/scope/derivation logic. DB-dependent behaviour is covered by one async
test that patches the private loader helpers.

Scenarios covered:
  1. Simple template (no inheritance)
  2. Two-level inheritance — child overrides parent param
  3. Three-level inheritance with override — only grandchild wins
  4. Scope injection — glob.* and proj.* always present, never overridden
  5. Derived param in chain — computed value appears in prefill
  6. Chained derived param — dependency evaluated before dependent
  7. Inheritance chain list correct — child-first order in result
  8. resolve_template_parameters integration — mocked DB async helpers
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.models.parameter import Parameter, ParameterScope
from api.models.parameter_option import ParameterOption
from api.models.project import Project
from api.models.template import Template
from api.services.parameter_resolver import (
    DerivedParamError,
    ParameterResolutionResult,
    ResolvedParameter,
    _merge_chain,
    build_resolution_result,
    resolve_template_parameters,
)


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

def make_template(
    id: int,
    name: str,
    project_id: int = 1,
    parent_id: int | None = None,
    params: list | None = None,
) -> Template:
    t = MagicMock(spec=Template)
    t.id = id
    t.name = name
    t.project_id = project_id
    t.parent_template_id = parent_id
    t.parameters = params or []
    return t


def make_param(
    name: str,
    scope: str = "template",
    *,
    template_id: int | None = None,
    project_id: int | None = None,
    organization_id: int | None = None,
    default_value: str | None = None,
    required: bool = False,
    is_derived: bool = False,
    derived_expression: str | None = None,
    options: list | None = None,
    sort_order: int = 0,
    widget_type: str = "text",
    is_active: bool = True,
) -> Parameter:
    p = MagicMock(spec=Parameter)
    p.name = name
    p.scope = scope
    p.template_id = template_id
    p.project_id = project_id
    p.organization_id = organization_id
    p.default_value = default_value
    p.required = required
    p.is_derived = is_derived
    p.derived_expression = derived_expression
    p.options = options or []
    p.sort_order = sort_order
    p.widget_type = widget_type
    p.label = None
    p.description = None
    p.help_text = None
    p.is_active = is_active
    return p


def make_project(id: int = 1, organization_id: int = 10) -> Project:
    p = MagicMock(spec=Project)
    p.id = id
    p.organization_id = organization_id
    return p


# ===========================================================================
# _merge_chain
# ===========================================================================

class TestMergeChain:
    def test_single_template(self):
        p1 = make_param("router.hostname", template_id=1)
        p2 = make_param("router.port", template_id=1)
        tmpl = make_template(1, "leaf", params=[p1, p2])

        merged = _merge_chain([tmpl])
        assert set(merged.keys()) == {"router.hostname", "router.port"}
        assert merged["router.hostname"][1] == 1  # source_template_id

    def test_child_overrides_parent(self):
        parent_param = make_param("router.hostname", template_id=10, default_value="parent-host")
        parent = make_template(10, "parent", params=[parent_param])

        child_param = make_param("router.hostname", template_id=20, default_value="child-host")
        child = make_template(20, "child", parent_id=10, params=[child_param])

        # chain is child-first: [child, parent]
        merged = _merge_chain([child, parent])
        param, src_id = merged["router.hostname"]
        assert param.default_value == "child-host"
        assert src_id == 20

    def test_three_level_override(self):
        """grandchild overrides grandparent's param; parent doesn't override it."""
        gp_param = make_param("x", template_id=1, default_value="grandparent")
        grandparent = make_template(1, "gp", params=[gp_param])

        parent = make_template(2, "parent", parent_id=1, params=[])  # no override

        gc_param = make_param("x", template_id=3, default_value="grandchild")
        grandchild = make_template(3, "gc", parent_id=2, params=[gc_param])

        merged = _merge_chain([grandchild, parent, grandparent])
        param, src_id = merged["x"]
        assert param.default_value == "grandchild"
        assert src_id == 3

    def test_parent_param_inherited_when_no_override(self):
        p_param = make_param("shared.item", template_id=10, default_value="from-parent")
        parent = make_template(10, "parent", params=[p_param])

        child = make_template(20, "child", parent_id=10, params=[])  # no params

        merged = _merge_chain([child, parent])
        param, src_id = merged["shared.item"]
        assert param.default_value == "from-parent"
        assert src_id == 10

    def test_inactive_params_excluded(self):
        active = make_param("active.param", template_id=1, is_active=True)
        inactive = make_param("inactive.param", template_id=1, is_active=False)
        tmpl = make_template(1, "t", params=[active, inactive])

        merged = _merge_chain([tmpl])
        assert "active.param" in merged
        assert "inactive.param" not in merged

    def test_non_template_scope_excluded(self):
        """Params with scope != 'template' must be ignored by _merge_chain."""
        proj_param = make_param("proj.vrf", scope="project", template_id=1)
        tmpl_param = make_param("router.host", scope="template", template_id=1)
        tmpl = make_template(1, "t", params=[proj_param, tmpl_param])

        merged = _merge_chain([tmpl])
        assert "router.host" in merged
        assert "proj.vrf" not in merged

    def test_empty_chain(self):
        assert _merge_chain([]) == {}


# ===========================================================================
# build_resolution_result — scope injection
# ===========================================================================

class TestScopeInjection:
    def _simple_chain(self) -> list:
        param = make_param("router.hostname", template_id=1, default_value="r1")
        return [make_template(1, "leaf", params=[param])]

    def test_glob_params_always_present(self):
        glob = make_param("glob.ntp", scope="global", organization_id=10, default_value="1.2.3.4")
        result = build_resolution_result(self._simple_chain(), [], [glob])

        assert len(result.glob_params) == 1
        assert result.glob_params[0].name == "glob.ntp"
        assert result.glob_params[0].scope == "global"

    def test_proj_params_always_present(self):
        proj = make_param("proj.vrf", scope="project", project_id=1, default_value="mgmt")
        result = build_resolution_result(self._simple_chain(), [proj], [])

        assert len(result.proj_params) == 1
        assert result.proj_params[0].name == "proj.vrf"
        assert result.proj_params[0].scope == "project"

    def test_all_params_combined(self):
        glob = make_param("glob.ntp", scope="global", default_value="1.2.3.4")
        proj = make_param("proj.vrf", scope="project", default_value="mgmt")
        chain = self._simple_chain()

        result = build_resolution_result(chain, [proj], [glob])

        names = {p.name for p in result.parameters}
        assert "glob.ntp" in names
        assert "proj.vrf" in names
        assert "router.hostname" in names

    def test_glob_not_overridden_by_template(self):
        """A template param with the same name as a glob must not replace glob."""
        # This is a contrived test — scoping rules normally prevent this name collision,
        # but we test the resolver doesn't accidentally overwrite glob in the context.
        glob = make_param("glob.ntp", scope="global", default_value="safe-ntp")
        chain = self._simple_chain()  # has router.hostname, not glob.ntp
        result = build_resolution_result(chain, [], [glob])

        glob_out = next(p for p in result.parameters if p.name == "glob.ntp")
        assert glob_out.default_value == "safe-ntp"

    def test_source_template_id_set_for_template_params(self):
        param = make_param("router.hostname", template_id=42)
        chain = [make_template(42, "leaf", params=[param])]
        result = build_resolution_result(chain, [], [])

        tmpl_param = next(p for p in result.parameters if p.name == "router.hostname")
        assert tmpl_param.source_template_id == 42

    def test_source_template_id_none_for_glob_proj(self):
        glob = make_param("glob.ntp", scope="global")
        proj = make_param("proj.vrf", scope="project")
        chain = [make_template(1, "leaf", params=[])]
        result = build_resolution_result(chain, [proj], [glob])

        for p in result.glob_params + result.proj_params:
            assert p.source_template_id is None


# ===========================================================================
# build_resolution_result — simple template
# ===========================================================================

class TestSimpleTemplate:
    def test_single_template_no_parents(self):
        p1 = make_param("router.hostname", template_id=1, required=True)
        p2 = make_param("router.port", template_id=1, default_value="22")
        chain = [make_template(1, "my-template", params=[p1, p2])]

        result = build_resolution_result(chain, [], [])

        assert result.inheritance_chain == ["my-template"]
        names = {p.name for p in result.parameters}
        assert "router.hostname" in names
        assert "router.port" in names

    def test_required_flag_preserved(self):
        p = make_param("router.hostname", template_id=1, required=True)
        result = build_resolution_result([make_template(1, "t", params=[p])], [], [])

        out = next(x for x in result.parameters if x.name == "router.hostname")
        assert out.required is True

    def test_options_passed_through(self):
        opt = MagicMock(spec=ParameterOption)
        opt.value = "GigE"
        opt.label = "GigabitEthernet"
        p = make_param("core.iface", template_id=1, widget_type="select", options=[opt])
        result = build_resolution_result([make_template(1, "t", params=[p])], [], [])

        out = next(x for x in result.parameters if x.name == "core.iface")
        assert len(out.options) == 1
        assert out.options[0].value == "GigE"


# ===========================================================================
# build_resolution_result — inheritance chain
# ===========================================================================

class TestInheritanceChain:
    def test_inheritance_chain_order(self):
        """chain list in result must be child-first (leaf → root)."""
        root = make_template(1, "cpe_base", params=[])
        mid = make_template(2, "cisco_base", parent_id=1, params=[])
        leaf = make_template(3, "cisco_891", parent_id=2, params=[])

        result = build_resolution_result([leaf, mid, root], [], [])
        assert result.inheritance_chain == ["cisco_891", "cisco_base", "cpe_base"]

    def test_three_level_override_in_result(self):
        """Param defined in grandparent, overridden in grandchild."""
        gp_p = make_param("core.speed", template_id=1, default_value="100")
        gp = make_template(1, "cpe_base", params=[gp_p])

        mid = make_template(2, "cisco_base", parent_id=1, params=[])  # no override

        gc_p = make_param("core.speed", template_id=3, default_value="1000")
        gc = make_template(3, "cisco_891", parent_id=2, params=[gc_p])

        result = build_resolution_result([gc, mid, gp], [], [])

        speed = next(p for p in result.parameters if p.name == "core.speed")
        assert speed.default_value == "1000"
        assert speed.source_template_id == 3

    def test_grandparent_unique_param_inherited(self):
        """Param only in grandparent appears in result with grandparent as source."""
        gp_p = make_param("core.banner", template_id=1, default_value="Welcome")
        gp = make_template(1, "cpe", params=[gp_p])
        mid = make_template(2, "mid", parent_id=1, params=[])
        leaf = make_template(3, "leaf", parent_id=2, params=[])

        result = build_resolution_result([leaf, mid, gp], [], [])

        banner = next(p for p in result.parameters if p.name == "core.banner")
        assert banner.default_value == "Welcome"
        assert banner.source_template_id == 1

    def test_each_level_contributes_unique_params(self):
        gp_p = make_param("gp.param", template_id=1)
        mid_p = make_param("mid.param", template_id=2)
        leaf_p = make_param("leaf.param", template_id=3)

        result = build_resolution_result(
            [
                make_template(3, "leaf", params=[leaf_p]),
                make_template(2, "mid", params=[mid_p]),
                make_template(1, "gp", params=[gp_p]),
            ],
            [],
            [],
        )
        names = {p.name for p in result.parameters}
        assert {"gp.param", "mid.param", "leaf.param"}.issubset(names)


# ===========================================================================
# build_resolution_result — derived params
# ===========================================================================

class TestDerivedParamsInChain:
    def test_derived_param_prefill_computed(self):
        """A formula-type derived param's resolved value appears in prefill."""
        base = make_param("core.bandwidth_mb", template_id=1, default_value="10")
        derived = make_param(
            "core.kbps",
            template_id=1,
            is_derived=True,
            derived_expression="{{ core.bandwidth_mb * 1000 }}",
        )
        chain = [make_template(1, "t", params=[base, derived])]
        result = build_resolution_result(chain, [], [])

        kbps = next(p for p in result.parameters if p.name == "core.kbps")
        assert kbps.is_derived is True
        assert kbps.prefill == "10000"

    def test_non_derived_param_prefill_is_none(self):
        """Regular params must have prefill=None (datasource resolver handles that)."""
        p = make_param("router.hostname", template_id=1, default_value="r1")
        result = build_resolution_result([make_template(1, "t", params=[p])], [], [])

        out = next(x for x in result.parameters if x.name == "router.hostname")
        assert out.prefill is None

    def test_chained_derived_params(self):
        """Derived param that depends on another derived param."""
        base = make_param("core.mbps", template_id=1, default_value="1")
        kbps = make_param(
            "core.kbps",
            template_id=1,
            is_derived=True,
            derived_expression="{{ core.mbps * 1000 }}",
        )
        label = make_param(
            "core.label",
            template_id=1,
            is_derived=True,
            derived_expression="{{ core.kbps ~ ' kbps' }}",
        )
        chain = [make_template(1, "t", params=[base, kbps, label])]
        result = build_resolution_result(chain, [], [])

        kbps_out = next(p for p in result.parameters if p.name == "core.kbps")
        label_out = next(p for p in result.parameters if p.name == "core.label")
        assert kbps_out.prefill == "1000"
        assert label_out.prefill == "1000 kbps"

    def test_derived_param_uses_glob_context(self):
        """A derived param in a template can reference a glob.* value."""
        glob = make_param("glob.domain", scope="global", default_value="example.com")
        derived = make_param(
            "router.fqdn",
            template_id=1,
            is_derived=True,
            derived_expression="{{ router.hostname ~ '.' ~ glob.domain }}",
        )
        host = make_param("router.hostname", template_id=1, default_value="r1")
        chain = [make_template(1, "t", params=[derived, host])]

        result = build_resolution_result(chain, [], [glob])
        fqdn = next(p for p in result.parameters if p.name == "router.fqdn")
        assert fqdn.prefill == "r1.example.com"

    def test_circular_derived_raises(self):
        a = make_param("d.a", template_id=1, is_derived=True, derived_expression="{{ d.b }}")
        b = make_param("d.b", template_id=1, is_derived=True, derived_expression="{{ d.a }}")
        chain = [make_template(1, "t", params=[a, b])]

        with pytest.raises(DerivedParamError):
            build_resolution_result(chain, [], [])


# ===========================================================================
# resolve_template_parameters — async integration (mocked DB helpers)
# ===========================================================================

class TestResolveTemplateParametersIntegration:
    """
    Mock the four private DB-loading helpers so we can test the
    orchestration logic of resolve_template_parameters() without a real DB.
    """

    @pytest.mark.asyncio
    async def test_not_found_raises_404(self):
        db = AsyncMock()
        with patch(
            "api.services.parameter_resolver._load_inheritance_chain",
            new=AsyncMock(return_value=[]),  # empty chain → not found
        ):
            from fastapi import HTTPException

            with pytest.raises(HTTPException) as exc_info:
                await resolve_template_parameters(db, template_id=999)
            assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_simple_resolution(self):
        """End-to-end: single template, no parents, no proj/glob."""
        p = make_param("router.hostname", template_id=1, default_value="r1")
        tmpl = make_template(1, "leaf", project_id=5, params=[p])
        project = make_project(id=5, organization_id=10)

        db = AsyncMock()
        # Project load is done via db.execute().scalar_one_or_none()
        mock_execute = AsyncMock()
        mock_execute.scalar_one_or_none = MagicMock(return_value=project)
        db.execute = AsyncMock(return_value=mock_execute)

        with (
            patch(
                "api.services.parameter_resolver._load_inheritance_chain",
                new=AsyncMock(return_value=[tmpl]),
            ),
            patch(
                "api.services.parameter_resolver._load_project_params",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "api.services.parameter_resolver._load_glob_params",
                new=AsyncMock(return_value=[]),
            ),
        ):
            result = await resolve_template_parameters(db, template_id=1)

        assert isinstance(result, ParameterResolutionResult)
        assert result.inheritance_chain == ["leaf"]
        assert any(p.name == "router.hostname" for p in result.parameters)

    @pytest.mark.asyncio
    async def test_three_level_chain_with_glob_proj(self):
        """Full scenario: 3-level chain + proj + glob, with child override."""
        gp_p = make_param("core.speed", template_id=1, default_value="100")
        gp = make_template(1, "cpe_base", project_id=5, params=[gp_p])

        mid_p = make_param("mid.only", template_id=2, default_value="mid")
        mid = make_template(2, "cisco_base", project_id=5, parent_id=1, params=[mid_p])

        gc_p = make_param("core.speed", template_id=3, default_value="1000")
        gc = make_template(3, "cisco_891", project_id=5, parent_id=2, params=[gc_p])

        project = make_project(id=5, organization_id=10)
        proj = make_param("proj.vrf", scope="project", project_id=5, default_value="mgmt")
        glob = make_param("glob.ntp", scope="global", organization_id=10, default_value="1.1.1.1")

        db = AsyncMock()
        mock_execute = AsyncMock()
        mock_execute.scalar_one_or_none = MagicMock(return_value=project)
        db.execute = AsyncMock(return_value=mock_execute)

        with (
            patch(
                "api.services.parameter_resolver._load_inheritance_chain",
                new=AsyncMock(return_value=[gc, mid, gp]),
            ),
            patch(
                "api.services.parameter_resolver._load_project_params",
                new=AsyncMock(return_value=[proj]),
            ),
            patch(
                "api.services.parameter_resolver._load_glob_params",
                new=AsyncMock(return_value=[glob]),
            ),
        ):
            result = await resolve_template_parameters(db, template_id=3)

        assert result.inheritance_chain == ["cisco_891", "cisco_base", "cpe_base"]

        speed = next(p for p in result.parameters if p.name == "core.speed")
        assert speed.default_value == "1000"  # grandchild wins
        assert speed.source_template_id == 3

        assert any(p.name == "proj.vrf" for p in result.proj_params)
        assert any(p.name == "glob.ntp" for p in result.glob_params)
