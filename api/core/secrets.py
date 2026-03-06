"""
Secrets resolver for Templarc.

Resolves secret references used by data source auth fields into plaintext
values. Three storage back-ends are supported:

  env:ENV_VAR_NAME
      Reads from os.environ at resolve-time. Use for local dev or
      container-injected secrets.

  vault:secret/path/to/key
      Reads from HashiCorp Vault using the KV v2 API. Only active when the
      VAULT_ADDR environment variable is set; raises SecretNotFoundError
      otherwise. Requires ``hvac`` (already in requirements.txt).

  secret:secret_name
      Reads an AES-encrypted (Fernet) value from the ``secrets`` DB table.
      The row is scoped to the caller's organization. Decrypted in-process
      using the application's SECRET_KEY.

Reference format examples:
  "env:NETBOX_TOKEN"
  "vault:secret/netbox/token"
  "secret:netbox_api"

Usage:
    resolver = SecretResolver(db=session, org_id=1)
    token = await resolver.resolve("env:NETBOX_TOKEN")
"""

from __future__ import annotations

import base64
import os
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings
from api.models.secret import Secret, SecretType

if TYPE_CHECKING:
    pass

# Optional Vault client — only imported if installed
try:
    import hvac  # type: ignore[import]
except ImportError:
    hvac = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class SecretNotFoundError(Exception):
    """Raised when a secret reference cannot be resolved."""


# ---------------------------------------------------------------------------
# Fernet key derivation
# ---------------------------------------------------------------------------

def _fernet_key(secret_key: str) -> bytes:
    """
    Derive a 32-byte Fernet key from the application's SECRET_KEY.

    Fernet requires a URL-safe base64-encoded 32-byte key.  We hash the
    raw SECRET_KEY string with SHA-256 (always 32 bytes) and base64-encode it.
    """
    import hashlib
    digest = hashlib.sha256(secret_key.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt *plaintext* using Fernet and the app SECRET_KEY."""
    from cryptography.fernet import Fernet
    settings = get_settings()
    f = Fernet(_fernet_key(settings.SECRET_KEY))
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted ciphertext using the app SECRET_KEY."""
    from cryptography.fernet import Fernet
    settings = get_settings()
    f = Fernet(_fernet_key(settings.SECRET_KEY))
    return f.decrypt(ciphertext.encode()).decode()


# ---------------------------------------------------------------------------
# SecretResolver
# ---------------------------------------------------------------------------

class SecretResolver:
    """
    Resolves secret references to their plaintext values.

    Parameters
    ----------
    db:
        An open async SQLAlchemy session (needed for ``secret:`` refs only).
    org_id:
        The organization ID of the calling user.  DB-stored secrets are
        scoped to this organization.
    """

    def __init__(self, db: AsyncSession, org_id: int) -> None:
        self._db = db
        self._org_id = org_id

    async def resolve(self, secret_ref: str) -> str:
        """
        Resolve *secret_ref* to a plaintext string.

        Raises
        ------
        SecretNotFoundError
            If the reference is malformed or the secret cannot be found.
        ValueError
            If the Vault client is unavailable and a ``vault:`` ref is used.
        """
        if ":" not in secret_ref:
            raise SecretNotFoundError(
                f"Invalid secret reference (no scheme): {secret_ref!r}"
            )

        scheme, _, rest = secret_ref.partition(":")
        scheme = scheme.strip().lower()

        if scheme == "env":
            return self._resolve_env(rest)
        if scheme == "vault":
            return await self._resolve_vault(rest)
        if scheme == "secret":
            return await self._resolve_db(rest)

        raise SecretNotFoundError(
            f"Unknown secret scheme {scheme!r} in reference {secret_ref!r}"
        )

    # ------------------------------------------------------------------
    # Private resolution methods
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_env(var_name: str) -> str:
        value = os.environ.get(var_name)
        if value is None:
            raise SecretNotFoundError(
                f"Environment variable {var_name!r} is not set"
            )
        return value

    @staticmethod
    async def _resolve_vault(vault_path: str) -> str:
        vault_addr = os.environ.get("VAULT_ADDR")
        if not vault_addr:
            raise SecretNotFoundError(
                "Vault secret requested but VAULT_ADDR is not configured"
            )
        if hvac is None:
            raise SecretNotFoundError(
                "hvac library not installed; cannot resolve Vault secrets"
            )

        vault_token = os.environ.get("VAULT_TOKEN")
        client = hvac.Client(url=vault_addr, token=vault_token)
        if not client.is_authenticated():
            raise SecretNotFoundError("Vault client is not authenticated")

        # Supports KV v2 paths (secret/data/<path>) and v1 paths
        try:
            # Try KV v2 first
            parts = vault_path.lstrip("/").split("/", 1)
            mount, path = (parts[0], parts[1]) if len(parts) == 2 else ("secret", parts[0])
            response = client.secrets.kv.v2.read_secret_version(
                path=path, mount_point=mount
            )
            data: dict = response["data"]["data"]
            # Return the first value if only one key, else the raw dict as JSON
            if len(data) == 1:
                return str(next(iter(data.values())))
            import json
            return json.dumps(data)
        except Exception as exc:
            raise SecretNotFoundError(
                f"Failed to read Vault path {vault_path!r}: {exc}"
            ) from exc

    async def _resolve_db(self, secret_name: str) -> str:
        result = await self._db.execute(
            select(Secret).where(
                Secret.organization_id == self._org_id,
                Secret.name == secret_name,
                Secret.secret_type == SecretType.db,
            )
        )
        secret: Secret | None = result.scalar_one_or_none()
        if secret is None or secret.value is None:
            raise SecretNotFoundError(
                f"DB secret {secret_name!r} not found for organization {self._org_id}"
            )
        try:
            return decrypt_secret(secret.value)
        except Exception as exc:
            raise SecretNotFoundError(
                f"Failed to decrypt secret {secret_name!r}: {exc}"
            ) from exc
