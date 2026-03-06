"""
Unit tests for input validation added in Phase 6.2.

Covers:
  - TemplateCreate.name  — alphanumeric + underscores only, max 100 chars
  - TemplateCreate.content / TemplateUpdate.content — 500 KB max
  - ParameterCreate.name — must match parameter name regex
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas.catalog import TemplateCreate, TemplateUpdate
from api.schemas.parameter import ParameterCreate
from api.models.parameter import ParameterScope


# ---------------------------------------------------------------------------
# Minimal valid base data for TemplateCreate
# ---------------------------------------------------------------------------

_BASE_TEMPLATE = {
    "project_id": 1,
    "name": "my_template",
    "display_name": "My Template",
}

_BASE_PARAM = {
    "name": "router.hostname",
    "scope": ParameterScope.template,
    "template_id": 1,
}


# ---------------------------------------------------------------------------
# TemplateCreate.name validation
# ---------------------------------------------------------------------------

class TestTemplateCreateName:
    def test_valid_alphanumeric(self):
        t = TemplateCreate(**{**_BASE_TEMPLATE, "name": "cisco891"})
        assert t.name == "cisco891"

    def test_valid_with_underscores(self):
        t = TemplateCreate(**{**_BASE_TEMPLATE, "name": "cisco_891_config"})
        assert t.name == "cisco_891_config"

    def test_valid_uppercase(self):
        # Uppercase is allowed by the pattern
        t = TemplateCreate(**{**_BASE_TEMPLATE, "name": "CiscoRouter"})
        assert t.name == "CiscoRouter"

    def test_invalid_space(self):
        with pytest.raises(ValidationError, match="pattern"):
            TemplateCreate(**{**_BASE_TEMPLATE, "name": "my template"})

    def test_invalid_dash(self):
        with pytest.raises(ValidationError, match="pattern"):
            TemplateCreate(**{**_BASE_TEMPLATE, "name": "my-template"})

    def test_invalid_dot(self):
        with pytest.raises(ValidationError, match="pattern"):
            TemplateCreate(**{**_BASE_TEMPLATE, "name": "my.template"})

    def test_invalid_exclamation(self):
        with pytest.raises(ValidationError, match="pattern"):
            TemplateCreate(**{**_BASE_TEMPLATE, "name": "Invalid!"})

    def test_too_long(self):
        with pytest.raises(ValidationError):
            TemplateCreate(**{**_BASE_TEMPLATE, "name": "a" * 101})

    def test_exactly_100_chars(self):
        t = TemplateCreate(**{**_BASE_TEMPLATE, "name": "a" * 100})
        assert len(t.name) == 100


# ---------------------------------------------------------------------------
# TemplateCreate.content / TemplateUpdate.content size limit
# ---------------------------------------------------------------------------

class TestTemplateContentSize:
    def test_valid_empty(self):
        t = TemplateCreate(**_BASE_TEMPLATE)
        assert t.content == ""

    def test_valid_content(self):
        t = TemplateCreate(**{**_BASE_TEMPLATE, "content": "hostname {{ router.hostname }}\n"})
        assert "hostname" in t.content

    def test_create_content_at_limit(self):
        big = "x" * 512_000
        t = TemplateCreate(**{**_BASE_TEMPLATE, "content": big})
        assert len(t.content) == 512_000

    def test_create_content_over_limit(self):
        with pytest.raises(ValidationError):
            TemplateCreate(**{**_BASE_TEMPLATE, "content": "x" * 512_001})

    def test_update_content_at_limit(self):
        big = "x" * 512_000
        t = TemplateUpdate(content=big)
        assert t.content is not None and len(t.content) == 512_000

    def test_update_content_over_limit(self):
        with pytest.raises(ValidationError):
            TemplateUpdate(content="x" * 512_001)

    def test_update_content_none_allowed(self):
        t = TemplateUpdate(display_name="Updated")
        assert t.content is None


# ---------------------------------------------------------------------------
# ParameterCreate.name validation
# ---------------------------------------------------------------------------

class TestParameterCreateName:
    def _make(self, name: str, **kwargs) -> ParameterCreate:
        return ParameterCreate(**{**_BASE_PARAM, "name": name, **kwargs})

    def test_valid_simple(self):
        p = self._make("hostname")
        assert p.name == "hostname"

    def test_valid_dotted(self):
        p = self._make("router.hostname")
        assert p.name == "router.hostname"

    def test_valid_glob_prefix(self):
        p = ParameterCreate(
            name="glob.ntp_server",
            scope=ParameterScope.global_,
            organization_id=1,
        )
        assert p.name == "glob.ntp_server"

    def test_valid_proj_prefix(self):
        p = ParameterCreate(
            name="proj.default_vrf",
            scope=ParameterScope.project,
            project_id=1,
        )
        assert p.name == "proj.default_vrf"

    def test_valid_multi_segment(self):
        p = self._make("router.interface.ip")
        assert p.name == "router.interface.ip"

    def test_valid_with_numbers(self):
        p = self._make("interface1.ip")
        assert p.name == "interface1.ip"

    def test_invalid_uppercase(self):
        with pytest.raises(ValidationError, match="Parameter name must match"):
            self._make("UPPERCASE")

    def test_invalid_starts_with_number(self):
        with pytest.raises(ValidationError, match="Parameter name must match"):
            self._make("1starts")

    def test_invalid_space(self):
        with pytest.raises(ValidationError, match="Parameter name must match"):
            self._make("has space")

    def test_invalid_dash(self):
        with pytest.raises(ValidationError, match="Parameter name must match"):
            self._make("has-dash")

    def test_invalid_unknown_prefix(self):
        # "env" is not a valid prefix — treated as a regular dotted name
        # "env.something" → fails because segment after dot must be [a-z][a-z0-9_]*
        # Actually env.something IS valid as a template-local dotted name
        p = self._make("env.something")
        assert p.name == "env.something"

    def test_invalid_empty(self):
        with pytest.raises(ValidationError):
            self._make("")

    def test_invalid_dot_only(self):
        with pytest.raises(ValidationError):
            self._make(".")
