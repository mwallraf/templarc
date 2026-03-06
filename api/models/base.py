"""
SQLAlchemy declarative base shared by all Templarc ORM models.

All model classes in api/models/ inherit from ``Base`` defined here.
The ``naming_convention`` attached to ``Base.metadata`` is the critical
piece that makes Alembic's ``--autogenerate`` and ``op.drop_constraint()``
work reliably across environments: without it, PostgreSQL assigns its own
internal names to unnamed constraints, which differ between dev, CI, and
production databases, causing Alembic migration scripts to fail at runtime.
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# ---------------------------------------------------------------------------
# Constraint naming convention
# ---------------------------------------------------------------------------
# Required for Alembic to reliably manage (rename / drop) named constraints
# in future migrations. Without this, PostgreSQL auto-generates constraint
# names that differ between environments, making ALTER TABLE fragile.
# ---------------------------------------------------------------------------
convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """
    Declarative base for all Templarc SQLAlchemy models.

    Attaches the shared ``MetaData`` instance with the Alembic-friendly
    constraint naming convention. Every model module imports this class
    instead of calling ``DeclarativeBase()`` directly, ensuring there is
    exactly one ``MetaData`` registry across the application.
    """

    metadata = MetaData(naming_convention=convention)
