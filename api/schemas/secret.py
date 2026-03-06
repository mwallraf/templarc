"""Pydantic v2 schemas for the Secret resource."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.secret import SecretType


class SecretCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [
            {
                "name": "netbox_api",
                "secret_type": "db",
                "value": "Token abc123secretvalue",
                "description": "NetBox API token for data source enrichment",
            },
            {
                "name": "vault_netbox",
                "secret_type": "vault",
                "vault_path": "secret/data/templarc/netbox",
                "description": "NetBox token fetched from HashiCorp Vault",
            },
        ]
    })

    name: str = Field(..., max_length=100, description="Unique name for this secret within the organization")
    secret_type: SecretType = Field(..., description="Storage back-end: env, vault, or db")
    value: str | None = Field(
        None,
        description=(
            "For env: the environment variable name to read. "
            "For db: the plaintext secret value (encrypted before storage). "
            "Not used for vault type."
        ),
    )
    vault_path: str | None = Field(
        None,
        description="Vault KV path (required when secret_type=vault)",
    )
    description: str | None = Field(None, description="Optional human-readable description")


class SecretOut(BaseModel):
    """Secret metadata — the plaintext value is never returned."""

    model_config = ConfigDict(from_attributes=True, json_schema_extra={
        "examples": [{
            "id": 3,
            "organization_id": 1,
            "name": "netbox_api",
            "secret_type": "db",
            "vault_path": None,
            "description": "NetBox API token for data source enrichment",
            "created_at": "2024-01-15T09:00:00Z",
        }]
    })

    id: int
    organization_id: int
    name: str
    secret_type: SecretType
    vault_path: str | None
    description: str | None
    created_at: datetime
