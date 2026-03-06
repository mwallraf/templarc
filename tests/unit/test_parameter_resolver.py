"""
Unit tests for api.services.parameter_resolver.

All tests use simple mock Parameter/ParameterOption objects — no DB, no async.
The resolve_derived_params() function and all helpers are pure functions.

Coverage:
  - Formula (Jinja2): simple arithmetic, string ops, nested context access
  - Conditional lookup: match found, no match, multiple options
  - Transform: upper, lower|strip, replace, title
  - Coalesce: first non-empty, second non-empty, all empty
  - Chained derived params: evaluated in correct order
  - Circular dependency: raises DerivedParamError
  - Topological sort: multiple independent chains
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from api.models.parameter import Parameter, ParameterScope
from api.models.parameter_option import ParameterOption
from api.services.parameter_resolver import (
    DerivedParamError,
    _evaluate_coalesce,
    _evaluate_formula,
    _evaluate_lookup,
    _evaluate_transform,
    _extract_jinja2_deps,
    _to_nested,
    _topological_sort,
    resolve_derived_params,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def make_param(name: str, expression: str, options: list | None = None) -> Parameter:
    """Create a mock derived Parameter."""
    p = MagicMock(spec=Parameter)
    p.name = name
    p.derived_expression = expression
    p.options = options or []
    return p


def make_option(condition_param: str, condition_value: str, value: str) -> ParameterOption:
    opt = MagicMock(spec=ParameterOption)
    opt.condition_param = condition_param
    opt.condition_value = condition_value
    opt.value = value
    return opt


# ===========================================================================
# _to_nested helper
# ===========================================================================

class TestToNested:
    def test_simple_dotted(self):
        result = _to_nested({"core.bandwidth_mb": 100})
        assert result == {"core": {"bandwidth_mb": 100}}

    def test_multiple_same_prefix(self):
        result = _to_nested({"core.a": 1, "core.b": 2})
        assert result == {"core": {"a": 1, "b": 2}}

    def test_no_dot(self):
        result = _to_nested({"hostname": "r1"})
        assert result == {"hostname": "r1"}

    def test_deep_nesting(self):
        result = _to_nested({"a.b.c": "deep"})
        assert result == {"a": {"b": {"c": "deep"}}}

    def test_mixed(self):
        result = _to_nested({"glob.ntp": "1.2.3.4", "plain": "value"})
        assert result["glob"]["ntp"] == "1.2.3.4"
        assert result["plain"] == "value"


# ===========================================================================
# _extract_jinja2_deps helper
# ===========================================================================

class TestExtractJinja2Deps:
    def test_simple_name(self):
        deps = _extract_jinja2_deps("{{ hostname }}")
        assert "hostname" in deps

    def test_dotted_name(self):
        deps = _extract_jinja2_deps("{{ core.bandwidth_mb }}")
        assert "core.bandwidth_mb" in deps

    def test_arithmetic(self):
        deps = _extract_jinja2_deps("{{ core.bandwidth_mb * 1000 }}")
        assert "core.bandwidth_mb" in deps

    def test_multiple_refs(self):
        deps = _extract_jinja2_deps("{{ core.a + core.b }}")
        assert "core.a" in deps
        assert "core.b" in deps

    def test_deep_dotted(self):
        deps = _extract_jinja2_deps("{{ a.b.c }}")
        assert "a.b.c" in deps

    def test_no_refs(self):
        deps = _extract_jinja2_deps("hello world")
        assert deps == set()

    def test_filter_usage(self):
        deps = _extract_jinja2_deps("{{ core.hostname | upper }}")
        assert "core.hostname" in deps


# ===========================================================================
# Type 1 — Formula
# ===========================================================================

class TestEvaluateFormula:
    def test_arithmetic(self):
        result = _evaluate_formula("{{ core.bandwidth_mb * 1000 }}", {"core.bandwidth_mb": 100})
        assert result == "100000"

    def test_string_interpolation(self):
        result = _evaluate_formula("{{ router.hostname }}.example.com", {"router.hostname": "r1"})
        assert result == "r1.example.com"

    def test_jinja2_filter(self):
        result = _evaluate_formula("{{ core.hostname | upper }}", {"core.hostname": "router1"})
        assert result == "ROUTER1"

    def test_unknown_variable_renders_empty(self):
        result = _evaluate_formula("{{ missing.var }}", {})
        assert result == ""

    def test_integer_context_value(self):
        result = _evaluate_formula("{{ core.speed * 2 }}", {"core.speed": 500})
        assert result == "1000"

    def test_conditional_expression(self):
        result = _evaluate_formula(
            "{{ 'yes' if core.flag == 'true' else 'no' }}",
            {"core.flag": "true"},
        )
        assert result == "yes"

    def test_string_concat(self):
        result = _evaluate_formula(
            "{{ router.hostname ~ '-' ~ router.suffix }}",
            {"router.hostname": "core", "router.suffix": "01"},
        )
        assert result == "core-01"


# ===========================================================================
# Type 2 — Conditional lookup
# ===========================================================================

class TestEvaluateLookup:
    def test_match_found(self):
        param = make_param(
            "derived.speed",
            "lookup:core.interface_type",
            options=[
                make_option("core.interface_type", "GigE", "1000"),
                make_option("core.interface_type", "FastE", "100"),
            ],
        )
        result = _evaluate_lookup(param.derived_expression, param, {"core.interface_type": "GigE"})
        assert result == "1000"

    def test_second_option_matches(self):
        param = make_param(
            "derived.speed",
            "lookup:core.interface_type",
            options=[
                make_option("core.interface_type", "GigE", "1000"),
                make_option("core.interface_type", "FastE", "100"),
            ],
        )
        result = _evaluate_lookup(param.derived_expression, param, {"core.interface_type": "FastE"})
        assert result == "100"

    def test_no_match_returns_empty(self):
        param = make_param(
            "derived.speed",
            "lookup:core.interface_type",
            options=[make_option("core.interface_type", "GigE", "1000")],
        )
        result = _evaluate_lookup(param.derived_expression, param, {"core.interface_type": "TenGigE"})
        assert result == ""

    def test_missing_trigger_param_returns_empty(self):
        # option requires trigger to be "GigE" — absent trigger never matches
        param = make_param(
            "derived.speed",
            "lookup:core.interface_type",
            options=[make_option("core.interface_type", "GigE", "1000")],
        )
        # context missing the trigger param → str(None or "") == "" ≠ "GigE"
        result = _evaluate_lookup(param.derived_expression, param, {})
        assert result == ""

    def test_no_options_returns_empty(self):
        param = make_param("derived.speed", "lookup:core.type", options=[])
        result = _evaluate_lookup(param.derived_expression, param, {"core.type": "GigE"})
        assert result == ""


# ===========================================================================
# Type 3 — Transform
# ===========================================================================

class TestEvaluateTransform:
    def test_upper(self):
        result = _evaluate_transform("transform:core.hostname:upper", {"core.hostname": "router1"})
        assert result == "ROUTER1"

    def test_lower(self):
        result = _evaluate_transform("transform:core.hostname:lower", {"core.hostname": "ROUTER1"})
        assert result == "router1"

    def test_strip(self):
        result = _evaluate_transform("transform:core.hostname:strip", {"core.hostname": "  r1  "})
        assert result == "r1"

    def test_chained_lower_strip(self):
        result = _evaluate_transform(
            "transform:core.hostname:lower|strip",
            {"core.hostname": "  ROUTER1  "},
        )
        assert result == "router1"

    def test_title(self):
        result = _evaluate_transform("transform:core.name:title", {"core.name": "hello world"})
        assert result == "Hello World"

    def test_replace(self):
        result = _evaluate_transform(
            "transform:core.hostname:replace:-:_",
            {"core.hostname": "my-router-01"},
        )
        assert result == "my_router_01"

    def test_missing_param_returns_empty(self):
        result = _evaluate_transform("transform:core.missing:upper", {})
        assert result == ""

    def test_multiple_transforms(self):
        result = _evaluate_transform(
            "transform:core.hostname:strip|upper",
            {"core.hostname": "  r1  "},
        )
        assert result == "R1"


# ===========================================================================
# Type 4 — Coalesce
# ===========================================================================

class TestEvaluateCoalesce:
    def test_first_non_empty(self):
        result = _evaluate_coalesce(
            "coalesce:core.custom:core.default",
            {"core.custom": "custom_val", "core.default": "default_val"},
        )
        assert result == "custom_val"

    def test_first_empty_uses_second(self):
        result = _evaluate_coalesce(
            "coalesce:core.custom:core.default",
            {"core.custom": "", "core.default": "default_val"},
        )
        assert result == "default_val"

    def test_first_missing_uses_second(self):
        result = _evaluate_coalesce(
            "coalesce:core.custom:core.default",
            {"core.default": "fallback"},
        )
        assert result == "fallback"

    def test_all_empty_returns_empty(self):
        result = _evaluate_coalesce(
            "coalesce:core.a:core.b:core.c",
            {"core.a": "", "core.b": "", "core.c": ""},
        )
        assert result == ""

    def test_three_params_third_wins(self):
        result = _evaluate_coalesce(
            "coalesce:core.a:core.b:core.c",
            {"core.a": "", "core.b": None, "core.c": "found"},
        )
        assert result == "found"


# ===========================================================================
# Topological sort
# ===========================================================================

class TestTopologicalSort:
    def test_independent_params_any_order(self):
        a = make_param("derived.a", "{{ core.x }}")
        b = make_param("derived.b", "{{ core.y }}")
        result = _topological_sort([a, b])
        # Both should appear — order doesn't matter since they're independent
        assert len(result) == 2
        assert set(p.name for p in result) == {"derived.a", "derived.b"}

    def test_dependency_comes_first(self):
        # derived.b depends on derived.a → a must come first
        a = make_param("derived.a", "{{ core.x }}")
        b = make_param("derived.b", "{{ derived.a }}")
        result = _topological_sort([b, a])  # intentionally reversed input
        names = [p.name for p in result]
        assert names.index("derived.a") < names.index("derived.b")

    def test_chain_of_three(self):
        # c → b → a (a has no derived deps)
        a = make_param("d.a", "{{ core.x }}")
        b = make_param("d.b", "{{ d.a }}")
        c = make_param("d.c", "{{ d.b }}")
        result = _topological_sort([c, b, a])
        names = [p.name for p in result]
        assert names.index("d.a") < names.index("d.b") < names.index("d.c")

    def test_circular_dependency_raises(self):
        a = make_param("d.a", "{{ d.b }}")
        b = make_param("d.b", "{{ d.a }}")
        with pytest.raises(DerivedParamError, match="Circular dependency"):
            _topological_sort([a, b])

    def test_self_circular_dependency_raises(self):
        a = make_param("d.a", "{{ d.a }}")
        with pytest.raises(DerivedParamError, match="Circular dependency"):
            _topological_sort([a])

    def test_lookup_dependency_ordering(self):
        # d.speed's lookup triggers on core.type (non-derived), d.label depends on d.speed
        speed = make_param("d.speed", "lookup:core.type")
        label = make_param("d.label", "{{ d.speed ~ 'mbps' }}")
        result = _topological_sort([label, speed])
        names = [p.name for p in result]
        assert names.index("d.speed") < names.index("d.label")


# ===========================================================================
# resolve_derived_params — integration
# ===========================================================================

class TestResolveDerivedParams:
    def test_empty_derived_params(self):
        ctx = {"core.x": "100"}
        result = resolve_derived_params([], ctx)
        assert result == ctx
        assert result is not ctx  # returns a copy

    def test_simple_formula(self):
        p = make_param("derived.kbps", "{{ core.bandwidth_mb * 1000 }}")
        result = resolve_derived_params([p], {"core.bandwidth_mb": 10})
        assert result["derived.kbps"] == "10000"

    def test_lookup_type(self):
        p = make_param(
            "derived.speed",
            "lookup:core.iface_type",
            options=[
                make_option("core.iface_type", "GigE", "1000"),
                make_option("core.iface_type", "FastE", "100"),
            ],
        )
        result = resolve_derived_params([p], {"core.iface_type": "FastE"})
        assert result["derived.speed"] == "100"

    def test_transform_type(self):
        p = make_param("derived.upper_host", "transform:router.hostname:upper")
        result = resolve_derived_params([p], {"router.hostname": "core-r1"})
        assert result["derived.upper_host"] == "CORE-R1"

    def test_coalesce_type(self):
        p = make_param("derived.name", "coalesce:core.custom:core.default")
        result = resolve_derived_params(
            [p], {"core.custom": "", "core.default": "default_name"}
        )
        assert result["derived.name"] == "default_name"

    def test_chained_derived_params(self):
        """d.kbps = bandwidth * 1000; d.label uses d.kbps."""
        kbps = make_param("d.kbps", "{{ core.bandwidth * 1000 }}")
        label = make_param("d.label", "{{ d.kbps ~ ' kbps' }}")

        result = resolve_derived_params([label, kbps], {"core.bandwidth": 5})
        assert result["d.kbps"] == "5000"
        assert result["d.label"] == "5000 kbps"

    def test_circular_dependency_raises(self):
        a = make_param("d.a", "{{ d.b }}")
        b = make_param("d.b", "{{ d.a }}")
        with pytest.raises(DerivedParamError):
            resolve_derived_params([a, b], {})

    def test_original_context_not_modified(self):
        """resolve_derived_params must not mutate the input context dict."""
        ctx = {"core.x": "hello"}
        p = make_param("d.y", "{{ core.x | upper }}")
        resolve_derived_params([p], ctx)
        assert "d.y" not in ctx

    def test_lookup_then_transform_chain(self):
        """lookup picks a speed string; transform lowercases a name; both in one call."""
        speed = make_param(
            "d.speed",
            "lookup:core.iface",
            options=[make_option("core.iface", "GigE", "1000Mbps")],
        )
        hostname_clean = make_param("d.host", "transform:router.host:lower|strip")

        result = resolve_derived_params(
            [speed, hostname_clean],
            {"core.iface": "GigE", "router.host": "  ROUTER-01  "},
        )
        assert result["d.speed"] == "1000Mbps"
        assert result["d.host"] == "router-01"
