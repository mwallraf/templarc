from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.parameter import Parameter


class ParameterOption(Base):
    __tablename__ = "parameter_options"

    id: Mapped[int] = mapped_column(primary_key=True)
    parameter_id: Mapped[int] = mapped_column(
        ForeignKey("parameters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    # Conditional display: show this option only when condition_param == condition_value
    condition_param: Mapped[str | None] = mapped_column(String(200), nullable=True)
    condition_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Relationships
    parameter: Mapped["Parameter"] = relationship(
        "Parameter", back_populates="options", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<ParameterOption id={self.id} value={self.value!r}>"
