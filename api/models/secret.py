from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.organization import Organization


class SecretType(str, enum.Enum):
    env = "env"      # value = env var name to read at runtime
    vault = "vault"  # vault_path used; value unused
    db = "db"        # value = AES-encrypted secret stored in DB


_secret_type_enum = PgEnum(
    "env", "vault", "db",
    name="secrettype",
    create_type=True,
)


class Secret(Base):
    __tablename__ = "secrets"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_secrets_org_name"),
        CheckConstraint(
            "secret_type != 'vault' OR vault_path IS NOT NULL",
            name="vault_requires_path",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    secret_type: Mapped[str] = mapped_column(_secret_type_enum, nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    vault_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="secrets", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Secret id={self.id} name={self.name!r} type={self.secret_type!r}>"
