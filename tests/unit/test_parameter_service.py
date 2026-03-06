"""
Unit tests for parameter scoping validation in api.services.parameter_service.

These tests cover the pure validate_parameter_scoping() function exclusively —
no DB, no FastAPI, no async machinery required. Each test verifies one rule.
"""

import pytest

from api.models.parameter import ParameterScope
from api.services.parameter_service import validate_parameter_scoping


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GLOBAL_SCOPE = ParameterScope.global_
PROJECT_SCOPE = ParameterScope.project
TEMPLATE_SCOPE = ParameterScope.template


# ===========================================================================
# Global scope
# ===========================================================================

class TestGlobalScope:
    """scope=global — name must start with 'glob.', organization_id required."""

    def test_valid_global(self):
        """Happy path: correct prefix and organization_id."""
        validate_parameter_scoping("glob.ntp_server", GLOBAL_SCOPE, 1, None, None)

    def test_valid_global_nested_key(self):
        """Names like glob.company.ntp are valid."""
        validate_parameter_scoping("glob.company.ntp", GLOBAL_SCOPE, 1, None, None)

    def test_global_missing_prefix(self):
        """Plain name (no glob. prefix) must be rejected."""
        with pytest.raises(ValueError, match="glob\\."):
            validate_parameter_scoping("ntp_server", GLOBAL_SCOPE, 1, None, None)

    def test_global_proj_prefix_rejected(self):
        """proj. prefix is invalid for global scope."""
        with pytest.raises(ValueError, match="glob\\."):
            validate_parameter_scoping("proj.ntp_server", GLOBAL_SCOPE, 1, None, None)

    def test_global_missing_organization_id(self):
        """organization_id is required for global scope."""
        with pytest.raises(ValueError, match="organization_id"):
            validate_parameter_scoping("glob.ntp", GLOBAL_SCOPE, None, None, None)

    def test_global_with_project_id_rejected(self):
        """project_id must be None for global scope."""
        with pytest.raises(ValueError, match="project_id"):
            validate_parameter_scoping("glob.ntp", GLOBAL_SCOPE, 1, 5, None)

    def test_global_with_template_id_rejected(self):
        """template_id must be None for global scope."""
        with pytest.raises(ValueError, match="template_id"):
            validate_parameter_scoping("glob.ntp", GLOBAL_SCOPE, 1, None, 7)

    def test_global_with_both_project_and_template_rejected(self):
        """Both project_id and template_id violate global scope rules."""
        with pytest.raises(ValueError):
            validate_parameter_scoping("glob.ntp", GLOBAL_SCOPE, 1, 5, 7)

    def test_global_string_scope(self):
        """Accepts raw string 'global' as scope (not just the enum)."""
        validate_parameter_scoping("glob.ntp", "global", 1, None, None)


# ===========================================================================
# Project scope
# ===========================================================================

class TestProjectScope:
    """scope=project — name must start with 'proj.', project_id required."""

    def test_valid_project(self):
        """Happy path: correct prefix and project_id."""
        validate_parameter_scoping("proj.default_vrf", PROJECT_SCOPE, None, 1, None)

    def test_project_missing_prefix(self):
        """Plain name must be rejected."""
        with pytest.raises(ValueError, match="proj\\."):
            validate_parameter_scoping("default_vrf", PROJECT_SCOPE, None, 1, None)

    def test_project_glob_prefix_rejected(self):
        """glob. prefix is invalid for project scope."""
        with pytest.raises(ValueError, match="proj\\."):
            validate_parameter_scoping("glob.vrf", PROJECT_SCOPE, None, 1, None)

    def test_project_missing_project_id(self):
        """project_id is required for project scope."""
        with pytest.raises(ValueError, match="project_id"):
            validate_parameter_scoping("proj.vrf", PROJECT_SCOPE, None, None, None)

    def test_project_with_organization_id_rejected(self):
        """organization_id must be None for project scope."""
        with pytest.raises(ValueError, match="organization_id"):
            validate_parameter_scoping("proj.vrf", PROJECT_SCOPE, 1, 1, None)

    def test_project_with_template_id_rejected(self):
        """template_id must be None for project scope."""
        with pytest.raises(ValueError, match="template_id"):
            validate_parameter_scoping("proj.vrf", PROJECT_SCOPE, None, 1, 7)

    def test_project_string_scope(self):
        """Accepts raw string 'project' as scope."""
        validate_parameter_scoping("proj.vrf", "project", None, 42, None)


# ===========================================================================
# Template scope
# ===========================================================================

class TestTemplateScope:
    """scope=template — no glob./proj. prefix, template_id required."""

    def test_valid_template(self):
        """Happy path: plain name and template_id."""
        validate_parameter_scoping("router.hostname", TEMPLATE_SCOPE, None, None, 1)

    def test_valid_template_simple_name(self):
        """Single-word names without any prefix are valid."""
        validate_parameter_scoping("bandwidth", TEMPLATE_SCOPE, None, None, 1)

    def test_template_glob_prefix_rejected(self):
        """glob. prefix is reserved — must be rejected for template scope."""
        with pytest.raises(ValueError, match="glob\\."):
            validate_parameter_scoping("glob.hostname", TEMPLATE_SCOPE, None, None, 1)

    def test_template_proj_prefix_rejected(self):
        """proj. prefix is reserved — must be rejected for template scope."""
        with pytest.raises(ValueError, match="proj\\."):
            validate_parameter_scoping("proj.hostname", TEMPLATE_SCOPE, None, None, 1)

    def test_template_missing_template_id(self):
        """template_id is required for template scope."""
        with pytest.raises(ValueError, match="template_id"):
            validate_parameter_scoping("router.hostname", TEMPLATE_SCOPE, None, None, None)

    def test_template_with_organization_id_rejected(self):
        """organization_id must be None for template scope."""
        with pytest.raises(ValueError, match="organization_id"):
            validate_parameter_scoping("router.hostname", TEMPLATE_SCOPE, 1, None, 1)

    def test_template_with_project_id_rejected(self):
        """project_id must be None for template scope."""
        with pytest.raises(ValueError, match="project_id"):
            validate_parameter_scoping("router.hostname", TEMPLATE_SCOPE, None, 1, 1)

    def test_template_string_scope(self):
        """Accepts raw string 'template' as scope."""
        validate_parameter_scoping("router.hostname", "template", None, None, 99)


# ===========================================================================
# Unknown scope
# ===========================================================================

class TestUnknownScope:
    def test_unknown_scope_raises(self):
        """An unrecognised scope string raises ValueError."""
        with pytest.raises(ValueError, match="Unknown scope"):
            validate_parameter_scoping("some.param", "invalid_scope", None, None, None)
