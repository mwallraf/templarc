"""
SQLAlchemy model registry.

Import all models here so that:
1. Alembic --autogenerate discovers all tables via Base.metadata
2. Relationship back-references resolve correctly (all classes in memory)
3. Application code can do: from api.models import Organization, User, ...

Import order follows FK dependency graph (parent tables before children).
"""

from api.models.base import Base  # noqa: F401 — must be first

# Tier 1: No FK dependencies
from api.models.organization import Organization  # noqa: F401

# Tier 2: FK → Organization
from api.models.user import User  # noqa: F401
from api.models.project import Project  # noqa: F401
from api.models.secret import Secret, SecretType  # noqa: F401

# Tier 3: FK → Project + self-FK + FK → User
from api.models.template import Template  # noqa: F401

# Tier 4: FK → Organization | Project | Template (scope discriminator)
from api.models.parameter import (  # noqa: F401
    Parameter,
    ParameterScope,
    WidgetType,
)

# Tier 5: FK → Parameter
from api.models.parameter_option import ParameterOption  # noqa: F401

# Tier 6: FK → Template + FK → User (both nullable / SET NULL)
from api.models.render_history import RenderHistory  # noqa: F401
from api.models.render_preset import RenderPreset  # noqa: F401

# Tier 7: No FKs (standalone audit log — user_sub is a denormalized string, not a FK)
from api.models.audit_log import AuditLog  # noqa: F401

# Tier 8: FK → Project (nullable — None means global scope)
from api.models.custom_filter import CustomFilter  # noqa: F401
from api.models.custom_object import CustomObject  # noqa: F401
from api.models.custom_macro import CustomMacro  # noqa: F401

# Tier 9: FK → Organization + FK → User (SET NULL)
from api.models.api_key import ApiKey  # noqa: F401

# Tier 10: FK → Project (features) + FK → Template + Feature (template_features)
from api.models.feature import Feature, TemplateFeature  # noqa: F401

# Tier 11: FK → Organization (one row per org)
from api.models.system_settings import SystemSettings  # noqa: F401

# Tier 12: FK → Organization (quickpad scratch notes)
from api.models.quickpad import Quickpad  # noqa: F401

# Tier 13: FK → Organization + Project (nullable) + Template (nullable)
from api.models.render_webhook import RenderWebhook  # noqa: F401

# Tier 14: FK → User + Project (RBAC memberships)
from api.models.project_membership import ProjectMembership  # noqa: F401

__all__ = [
    "Base",
    "Organization",
    "User",
    "Project",
    "Secret",
    "SecretType",
    "Template",
    "Parameter",
    "ParameterScope",
    "WidgetType",
    "ParameterOption",
    "RenderHistory",
    "RenderPreset",
    "AuditLog",
    "CustomFilter",
    "CustomObject",
    "CustomMacro",
    "ApiKey",
    "Feature",
    "TemplateFeature",
    "SystemSettings",
    "Quickpad",
    "RenderWebhook",
    "ProjectMembership",
]
