"""Pydantic schemas for the health/status endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


ComponentStatus = Literal["ok", "warn", "error"]


class ComponentCheck(BaseModel):
    name: str
    status: ComponentStatus
    message: str | None = None
    latency_ms: int | None = None


class HealthOut(BaseModel):
    status: ComponentStatus
    version: str
    uptime_seconds: float
    components: list[ComponentCheck] = []
