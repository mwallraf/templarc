"""Pydantic schemas for the RenderPreset resource."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RenderPresetCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "name": "C891F DirectFiber Test",
            "description": "Sample values from TESTDATA for C891F hardware",
            "params": {
                "hardware": "C891F",
                "router.hostname": "cpe-test-01",
                "loopback_ip": "10.1.2.3/32",
                "wan_p2p_network": "10.2.3.4/30",
            },
        }]
    })

    name: str = Field(..., max_length=200)
    description: str | None = None
    params: dict = Field(..., description="Parameter name→value map")


class RenderPresetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, json_schema_extra={
        "examples": [{
            "id": 1,
            "template_id": 5,
            "name": "C891F DirectFiber Test",
            "description": "Sample values from TESTDATA for C891F hardware",
            "params": {
                "hardware": "C891F",
                "router.hostname": "cpe-test-01",
            },
            "created_by": 1,
            "created_at": "2026-03-06T16:20:00Z",
        }]
    })

    id: int
    template_id: int
    name: str
    description: str | None
    params: dict
    created_by: int | None
    created_at: datetime
