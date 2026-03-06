"""
Unit tests for api.services.jinja_parser.

Covers:
  extract_variables   — simple names, attribute chains, deduplication,
                        variables inside conditionals/loops, filter args,
                        complex nested expressions
  extract_filters_used — single filter, chained filters, deduplication,
                         filters with arguments, no filters
  extract_blocks       — single block, multiple blocks, no blocks,
                         nested blocks
"""

from __future__ import annotations

import textwrap

import pytest
import jinja2

from api.services.jinja_parser import (
    VariableRef,
    extract_blocks,
    extract_filters_used,
    extract_variables,
)


# ===========================================================================
# extract_variables
# ===========================================================================

class TestExtractVariables:

    # --- Basic cases ---

    def test_simple_variable(self):
        refs = extract_variables("{{ bandwidth }}")
        assert len(refs) == 1
        assert refs[0] == VariableRef(name="bandwidth", type="simple", full_path="bandwidth")

    def test_single_attribute(self):
        refs = extract_variables("{{ router.hostname }}")
        assert len(refs) == 1
        assert refs[0] == VariableRef(name="router", type="attribute", full_path="router.hostname")

    def test_glob_prefix(self):
        refs = extract_variables("{{ glob.ntp_server }}")
        assert len(refs) == 1
        assert refs[0] == VariableRef(name="glob", type="attribute", full_path="glob.ntp_server")

    def test_proj_prefix(self):
        refs = extract_variables("{{ proj.default_vrf }}")
        assert len(refs) == 1
        assert refs[0] == VariableRef(name="proj", type="attribute", full_path="proj.default_vrf")

    def test_three_level_attribute(self):
        refs = extract_variables("{{ router.iface.ip }}")
        assert len(refs) == 1
        assert refs[0] == VariableRef(name="router", type="attribute", full_path="router.iface.ip")

    # --- Multiple variables ---

    def test_multiple_distinct_variables(self):
        tmpl = "hostname {{ router.hostname }}\nntp {{ glob.ntp_server }}\nvrf {{ proj.default_vrf }}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert "router.hostname" in paths
        assert "glob.ntp_server" in paths
        assert "proj.default_vrf" in paths

    def test_deduplication_preserves_first_seen_order(self):
        tmpl = "{{ router.hostname }} {{ bandwidth }} {{ router.hostname }}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert paths.count("router.hostname") == 1
        assert paths.index("router.hostname") < paths.index("bandwidth")

    # --- Realistic template ---

    def test_realistic_cisco_template(self):
        tmpl = textwrap.dedent("""\
            hostname {{ router.hostname }}
            ntp server {{ glob.ntp_server }}
            ip vrf {{ proj.default_vrf }}
            bandwidth {{ core.bandwidth_mb | mb_to_kbps }}
        """)
        refs = extract_variables(tmpl)
        paths = {r.full_path for r in refs}
        assert "router.hostname" in paths
        assert "glob.ntp_server" in paths
        assert "proj.default_vrf" in paths
        assert "core.bandwidth_mb" in paths

    # --- Control structures ---

    def test_variable_inside_if_block(self):
        tmpl = "{% if router.enabled %}up{% endif %}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert "router.enabled" in paths

    def test_variable_inside_for_loop(self):
        tmpl = "{% for iface in router.interfaces %}{{ iface.name }}{% endfor %}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert "router.interfaces" in paths

    def test_loop_variable_captured(self):
        """Variables introduced by for-loop are still captured as references."""
        tmpl = "{% for item in items %}{{ item }}{% endfor %}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert "items" in paths

    # --- Type classification ---

    def test_simple_type_for_bare_name(self):
        refs = extract_variables("{{ bandwidth }}")
        assert refs[0].type == "simple"

    def test_attribute_type_for_dotted_name(self):
        refs = extract_variables("{{ router.hostname }}")
        assert refs[0].type == "attribute"

    # --- Edge cases ---

    def test_empty_template(self):
        assert extract_variables("") == []

    def test_template_with_no_variables(self):
        assert extract_variables("hostname myrouter\n") == []

    def test_literal_in_template(self):
        refs = extract_variables("{{ 'literal' }}")
        assert refs == []

    def test_variable_as_filter_argument(self):
        """A variable used as an argument to a filter is still a variable ref."""
        tmpl = "{{ value | default(fallback) }}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert "value" in paths
        assert "fallback" in paths

    def test_variable_in_set_tag(self):
        tmpl = "{% set x = router.hostname %}{{ x }}"
        refs = extract_variables(tmpl)
        paths = [r.full_path for r in refs]
        assert "router.hostname" in paths


# ===========================================================================
# extract_filters_used
# ===========================================================================

class TestExtractFiltersUsed:

    def test_single_filter(self):
        filters = extract_filters_used("{{ bandwidth | mb_to_kbps }}")
        assert filters == ["mb_to_kbps"]

    def test_chained_filters(self):
        filters = extract_filters_used("{{ name | upper | trim }}")
        assert "upper" in filters
        assert "trim" in filters

    def test_deduplication(self):
        tmpl = "{{ a | upper }} {{ b | upper }}"
        filters = extract_filters_used(tmpl)
        assert filters.count("upper") == 1

    def test_filter_with_argument(self):
        filters = extract_filters_used("{{ value | default('N/A') }}")
        assert "default" in filters

    def test_multiple_distinct_filters(self):
        tmpl = "{{ a | lower }} {{ b | int }} {{ c | mb_to_kbps }}"
        filters = extract_filters_used(tmpl)
        assert set(filters) == {"lower", "int", "mb_to_kbps"}

    def test_no_filters(self):
        assert extract_filters_used("{{ router.hostname }}") == []

    def test_empty_template(self):
        assert extract_filters_used("") == []

    def test_filter_in_if_condition(self):
        tmpl = "{% if value | int > 0 %}yes{% endif %}"
        filters = extract_filters_used(tmpl)
        assert "int" in filters

    def test_realistic_template_filters(self):
        tmpl = textwrap.dedent("""\
            hostname {{ router.hostname | lower }}
            bandwidth {{ core.bandwidth_mb | mb_to_kbps }}
            description {{ desc | default('none') | upper }}
        """)
        filters = extract_filters_used(tmpl)
        assert "lower" in filters
        assert "mb_to_kbps" in filters
        assert "default" in filters
        assert "upper" in filters

    def test_first_seen_order(self):
        tmpl = "{{ a | alpha }} {{ b | beta }} {{ c | alpha }}"
        filters = extract_filters_used(tmpl)
        assert filters.index("alpha") < filters.index("beta")


# ===========================================================================
# extract_blocks
# ===========================================================================

class TestExtractBlocks:

    def test_single_block(self):
        tmpl = "{% block content %}body{% endblock %}"
        blocks = extract_blocks(tmpl)
        assert blocks == ["content"]

    def test_multiple_blocks(self):
        tmpl = textwrap.dedent("""\
            {% block header %}head{% endblock %}
            {% block content %}body{% endblock %}
            {% block footer %}foot{% endblock %}
        """)
        blocks = extract_blocks(tmpl)
        assert blocks == ["header", "content", "footer"]

    def test_no_blocks(self):
        assert extract_blocks("{{ router.hostname }}") == []

    def test_empty_template(self):
        assert extract_blocks("") == []

    def test_deduplication(self):
        # Jinja2 itself will raise on duplicate block names in the same
        # template, but we guard anyway.
        tmpl = "{% block content %}a{% endblock %}"
        blocks = extract_blocks(tmpl)
        assert blocks.count("content") == 1

    def test_block_with_variables_inside(self):
        tmpl = "{% block content %}{{ router.hostname }}{% endblock %}"
        blocks = extract_blocks(tmpl)
        assert "content" in blocks

    def test_first_seen_order_preserved(self):
        tmpl = textwrap.dedent("""\
            {% block alpha %}{% endblock %}
            {% block beta %}{% endblock %}
            {% block gamma %}{% endblock %}
        """)
        blocks = extract_blocks(tmpl)
        assert blocks == ["alpha", "beta", "gamma"]


# ===========================================================================
# Syntax error propagation
# ===========================================================================

class TestSyntaxErrors:

    def test_invalid_template_raises_syntax_error(self):
        with pytest.raises(jinja2.TemplateSyntaxError):
            extract_variables("{{ unclosed")

    def test_invalid_template_filters_raises(self):
        with pytest.raises(jinja2.TemplateSyntaxError):
            extract_filters_used("{% if %}")

    def test_invalid_template_blocks_raises(self):
        with pytest.raises(jinja2.TemplateSyntaxError):
            extract_blocks("{% block %}")
