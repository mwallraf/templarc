"""
Unit tests for api.core.secrets.

Scenarios covered:
  encrypt_secret / decrypt_secret  — round-trip, wrong key raises
  SecretResolver.resolve           — env: happy path, missing var
                                   — vault: no VAULT_ADDR raises
                                   — secret: happy path, not found, bad ciphertext
                                   — unknown scheme raises
                                   — missing scheme separator raises
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.secrets import (
    SecretNotFoundError,
    SecretResolver,
    decrypt_secret,
    encrypt_secret,
)


# ===========================================================================
# Fernet helpers
# ===========================================================================

class TestFernet:
    def test_round_trip(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-fernet")
        # Patch get_settings to return a predictable SECRET_KEY
        with patch("api.core.secrets.get_settings") as mock_settings:
            mock_settings.return_value.SECRET_KEY = "test-secret-key-for-fernet"
            plaintext = "super-secret-token-12345"
            ciphertext = encrypt_secret(plaintext)
            assert ciphertext != plaintext
            assert decrypt_secret(ciphertext) == plaintext

    def test_different_key_cannot_decrypt(self):
        with patch("api.core.secrets.get_settings") as mock_settings:
            mock_settings.return_value.SECRET_KEY = "key-one"
            ciphertext = encrypt_secret("my-secret")

        with patch("api.core.secrets.get_settings") as mock_settings:
            mock_settings.return_value.SECRET_KEY = "key-two"
            with pytest.raises(Exception):
                decrypt_secret(ciphertext)


# ===========================================================================
# SecretResolver
# ===========================================================================

@pytest.fixture
def mock_db():
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def resolver(mock_db):
    return SecretResolver(db=mock_db, org_id=1)


class TestResolveEnv:
    @pytest.mark.asyncio
    async def test_env_happy_path(self, resolver, monkeypatch):
        monkeypatch.setenv("MY_TEST_TOKEN", "abc123")
        result = await resolver.resolve("env:MY_TEST_TOKEN")
        assert result == "abc123"

    @pytest.mark.asyncio
    async def test_env_missing_var(self, resolver):
        with pytest.raises(SecretNotFoundError, match="MY_MISSING_VAR"):
            await resolver.resolve("env:MY_MISSING_VAR")


class TestResolveVault:
    @pytest.mark.asyncio
    async def test_vault_no_addr_raises(self, resolver, monkeypatch):
        monkeypatch.delenv("VAULT_ADDR", raising=False)
        with pytest.raises(SecretNotFoundError, match="VAULT_ADDR"):
            await resolver.resolve("vault:secret/myapp/token")

    @pytest.mark.asyncio
    async def test_vault_with_addr(self, resolver, monkeypatch):
        monkeypatch.setenv("VAULT_ADDR", "http://localhost:8200")
        monkeypatch.setenv("VAULT_TOKEN", "root")

        mock_client = MagicMock()
        mock_client.is_authenticated.return_value = True
        mock_client.secrets.kv.v2.read_secret_version.return_value = {
            "data": {"data": {"token": "vault-token-value"}}
        }
        mock_hvac = MagicMock()
        mock_hvac.Client.return_value = mock_client

        with patch("api.core.secrets.hvac", mock_hvac):
            result = await resolver.resolve("vault:secret/myapp")
            assert result == "vault-token-value"

    @pytest.mark.asyncio
    async def test_vault_not_authenticated(self, resolver, monkeypatch):
        monkeypatch.setenv("VAULT_ADDR", "http://localhost:8200")

        mock_client = MagicMock()
        mock_client.is_authenticated.return_value = False
        mock_hvac = MagicMock()
        mock_hvac.Client.return_value = mock_client

        with patch("api.core.secrets.hvac", mock_hvac):
            with pytest.raises(SecretNotFoundError, match="not authenticated"):
                await resolver.resolve("vault:secret/myapp")


class TestResolveDb:
    @pytest.mark.asyncio
    async def test_db_happy_path(self, mock_db):
        with patch("api.core.secrets.get_settings") as mock_settings:
            mock_settings.return_value.SECRET_KEY = "test-key-for-db-resolve"

            plaintext = "my-db-secret"
            ciphertext = encrypt_secret(plaintext)

            from api.models.secret import Secret, SecretType
            mock_secret = MagicMock(spec=Secret)
            mock_secret.value = ciphertext
            mock_secret.secret_type = SecretType.db

            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = mock_secret
            mock_db.execute = AsyncMock(return_value=mock_result)

            resolver = SecretResolver(db=mock_db, org_id=1)
            result = await resolver.resolve("secret:my_netbox_api")
            assert result == plaintext

    @pytest.mark.asyncio
    async def test_db_not_found(self, mock_db):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        resolver = SecretResolver(db=mock_db, org_id=1)
        with pytest.raises(SecretNotFoundError, match="not found"):
            await resolver.resolve("secret:nonexistent")


class TestResolveErrors:
    @pytest.mark.asyncio
    async def test_unknown_scheme(self, resolver):
        with pytest.raises(SecretNotFoundError, match="Unknown secret scheme"):
            await resolver.resolve("s3:bucket/key")

    @pytest.mark.asyncio
    async def test_no_scheme_separator(self, resolver):
        with pytest.raises(SecretNotFoundError, match="no scheme"):
            await resolver.resolve("PLAIN_VALUE_NO_COLON")
