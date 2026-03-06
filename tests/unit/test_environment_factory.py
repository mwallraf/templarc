"""
Unit tests for api.jinja_filters and api.services.environment_factory.

Scenarios covered:
  Network filters        — mb_to_kbps, mb_to_bps, cidr_to_wildcard, ip_to_int, int_to_ip
  BUILTIN_FILTERS dict   — all five keys present and callable
  EnvironmentFactory     — glob vars injected, proj vars injected, custom filters registered,
                           cache hit (same updated_at), cache miss on stale updated_at,
                           invalidate clears cache, template directory fallback
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import jinja2
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.jinja_filters import BUILTIN_FILTERS
from api.jinja_filters.network import (
    cidr_to_wildcard,
    int_to_ip,
    ip_to_int,
    mb_to_bps,
    mb_to_kbps,
)
from api.services.environment_factory import (
    EnvironmentFactory,
    _strip_prefix,
    clear_env_cache,
)


# ===========================================================================
# Network filters
# ===========================================================================

class TestMbToKbps:
    def test_integer_value(self):
        assert mb_to_kbps(1) == 8000

    def test_fractional(self):
        assert mb_to_kbps(0.5) == 4000

    def test_zero(self):
        assert mb_to_kbps(0) == 0

    def test_large(self):
        assert mb_to_kbps(100) == 800_000


class TestMbToBps:
    def test_integer_value(self):
        assert mb_to_bps(1) == 8_000_000

    def test_fractional(self):
        assert mb_to_bps(0.5) == 4_000_000

    def test_zero(self):
        assert mb_to_bps(0) == 0


class TestCidrToWildcard:
    def test_slash_24(self):
        assert cidr_to_wildcard("10.0.0.0/24") == "0.0.0.255"

    def test_slash_8(self):
        assert cidr_to_wildcard("10.0.0.0/8") == "0.255.255.255"

    def test_slash_30(self):
        assert cidr_to_wildcard("192.168.1.0/30") == "0.0.0.3"

    def test_slash_32(self):
        assert cidr_to_wildcard("10.1.2.3/32") == "0.0.0.0"

    def test_non_strict_host_bits(self):
        # Non-zero host bits are allowed with strict=False
        assert cidr_to_wildcard("10.0.0.1/24") == "0.0.0.255"


class TestIpToInt:
    def test_loopback(self):
        assert ip_to_int("127.0.0.1") == 2130706433

    def test_192_168(self):
        assert ip_to_int("192.168.1.1") == 3232235777

    def test_zero(self):
        assert ip_to_int("0.0.0.0") == 0

    def test_max(self):
        assert ip_to_int("255.255.255.255") == 4294967295


class TestIntToIp:
    def test_loopback(self):
        assert int_to_ip(2130706433) == "127.0.0.1"

    def test_192_168(self):
        assert int_to_ip(3232235777) == "192.168.1.1"

    def test_zero(self):
        assert int_to_ip(0) == "0.0.0.0"

    def test_max(self):
        assert int_to_ip(4294967295) == "255.255.255.255"

    def test_round_trip(self):
        original = "172.16.0.1"
        assert int_to_ip(ip_to_int(original)) == original


# ===========================================================================
# BUILTIN_FILTERS registry
# ===========================================================================

class TestBuiltinFilters:
    def test_all_keys_present(self):
        expected = {"mb_to_kbps", "mb_to_bps", "cidr_to_wildcard", "ip_to_int", "int_to_ip"}
        assert set(BUILTIN_FILTERS.keys()) == expected

    def test_all_callable(self):
        for name, fn in BUILTIN_FILTERS.items():
            assert callable(fn), f"{name} is not callable"


# ===========================================================================
# _strip_prefix utility
# ===========================================================================

class TestStripPrefix:
    def test_strips_prefix(self):
        assert _strip_prefix("glob.ntp_server", "glob.") == "ntp_server"

    def test_no_prefix_unchanged(self):
        assert _strip_prefix("ntp_server", "glob.") == "ntp_server"

    def test_partial_prefix_unchanged(self):
        assert _strip_prefix("glo.ntp", "glob.") == "glo.ntp"


# ===========================================================================
# EnvironmentFactory helpers
# ===========================================================================

def _make_project(
    id_: int = 1,
    org_id: int = 10,
    git_path: str | None = "myproject",
    updated_at: datetime | None = None,
) -> MagicMock:
    """Build a minimal Project-like mock."""
    p = MagicMock()
    p.id = id_
    p.organization_id = org_id
    p.git_path = git_path
    p.updated_at = updated_at or datetime(2024, 1, 1, tzinfo=timezone.utc)
    return p


def _make_param(name: str, default_value: str | None = None) -> MagicMock:
    """Build a minimal Parameter-like mock."""
    p = MagicMock()
    p.name = name
    p.default_value = default_value
    return p


def _make_db(project: MagicMock, glob_params: list, proj_params: list) -> AsyncMock:
    """
    Build an AsyncSession mock that returns the right results for each execute() call:
      call 0 → project query
      call 1 → glob params query
      call 2 → proj params query
      call 3 → custom filters query (always empty in unit tests)
      call 4 → custom objects query (always empty in unit tests)
    """
    db = AsyncMock(spec=AsyncSession)

    def _scalars_result(items):
        r = MagicMock()
        r.scalars.return_value.all.return_value = items
        r.scalar_one_or_none.return_value = project if items is project else None
        return r

    results = [
        # project (_load_project in get_environment)
        _scalar_one_result(project),
        # custom filters (_load_project_filters, first in _build_environment)
        _scalars_all_result([]),
        # custom objects (_load_project_objects, second in _build_environment)
        _scalars_all_result([]),
        # glob params (_load_glob_params, third in _build_environment)
        _scalars_all_result(glob_params),
        # proj params (_load_proj_params, fourth in _build_environment)
        _scalars_all_result(proj_params),
    ]
    db.execute = AsyncMock(side_effect=results)
    return db


def _scalar_one_result(obj):
    """Mock execute() result for scalar_one_or_none() returning obj."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = obj
    return r


def _scalars_all_result(items: list):
    """Mock execute() result for .scalars().all() returning items."""
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


# ===========================================================================
# EnvironmentFactory tests
# ===========================================================================

@pytest.fixture(autouse=True)
def _clear_cache():
    clear_env_cache()
    yield
    clear_env_cache()


class TestGetEnvironment:
    @pytest.mark.asyncio
    async def test_glob_vars_injected(self, tmp_path):
        project = _make_project(git_path=None)
        glob_params = [
            _make_param("glob.ntp_server", "1.1.1.1"),
            _make_param("glob.dns_server", "8.8.8.8"),
        ]
        db = _make_db(project, glob_params, [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        assert env.globals["glob"] == {"ntp_server": "1.1.1.1", "dns_server": "8.8.8.8"}

    @pytest.mark.asyncio
    async def test_proj_vars_injected(self, tmp_path):
        project = _make_project(git_path=None)
        proj_params = [
            _make_param("proj.default_vrf", "MGMT"),
            _make_param("proj.region", "EU"),
        ]
        db = _make_db(project, [], proj_params)

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        assert env.globals["proj"] == {"default_vrf": "MGMT", "region": "EU"}

    @pytest.mark.asyncio
    async def test_builtin_filters_registered(self, tmp_path):
        project = _make_project(git_path=None)
        db = _make_db(project, [], [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        for filter_name in BUILTIN_FILTERS:
            assert filter_name in env.filters, f"Filter {filter_name!r} missing"

    @pytest.mark.asyncio
    async def test_filters_work_in_template(self, tmp_path):
        project = _make_project(git_path=None)
        db = _make_db(project, [], [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        tmpl = env.from_string("{{ bw | mb_to_kbps }}")
        assert tmpl.render(bw=10) == "80000"

    @pytest.mark.asyncio
    async def test_glob_prefix_stripped(self, tmp_path):
        project = _make_project(git_path=None)
        glob_params = [_make_param("glob.company_ntp", "ntp.example.com")]
        db = _make_db(project, glob_params, [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        assert "company_ntp" in env.globals["glob"]
        assert "glob.company_ntp" not in env.globals["glob"]

    @pytest.mark.asyncio
    async def test_filesystem_loader_used_when_dir_exists(self, tmp_path):
        (tmp_path / "proj").mkdir()
        project = _make_project(git_path="proj")
        db = _make_db(project, [], [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        assert isinstance(env.loader, jinja2.FileSystemLoader)

    @pytest.mark.asyncio
    async def test_base_loader_fallback_when_dir_missing(self, tmp_path):
        project = _make_project(git_path="nonexistent_subdir")
        db = _make_db(project, [], [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            factory = EnvironmentFactory(db)
            env = await factory.get_environment(project.id)

        assert isinstance(env.loader, jinja2.BaseLoader)


class TestCaching:
    @pytest.mark.asyncio
    async def test_cache_hit_returns_same_env(self, tmp_path):
        project = _make_project(git_path=None)
        db1 = _make_db(project, [], [])
        db2 = _make_db(project, [], [])  # should not be called on cache hit

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            env1 = await EnvironmentFactory(db1).get_environment(project.id)
            env2 = await EnvironmentFactory(db2).get_environment(project.id)

        # Same object returned from cache
        assert env1 is env2
        # db2 was only used for the project query on the second call (updated_at check)
        assert db2.execute.call_count == 1

    @pytest.mark.asyncio
    async def test_stale_cache_rebuilds(self, tmp_path):
        t1 = datetime(2024, 1, 1, tzinfo=timezone.utc)
        t2 = datetime(2024, 1, 2, tzinfo=timezone.utc)
        project_v1 = _make_project(git_path=None, updated_at=t1)
        project_v2 = _make_project(git_path=None, updated_at=t2)

        db1 = _make_db(project_v1, [_make_param("glob.a", "old")], [])
        db2 = _make_db(project_v2, [_make_param("glob.a", "new")], [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            env1 = await EnvironmentFactory(db1).get_environment(project_v1.id)
            env2 = await EnvironmentFactory(db2).get_environment(project_v2.id)

        assert env1 is not env2
        assert env1.globals["glob"]["a"] == "old"
        assert env2.globals["glob"]["a"] == "new"


class TestInvalidate:
    @pytest.mark.asyncio
    async def test_invalidate_forces_rebuild(self, tmp_path):
        project = _make_project(git_path=None)
        db1 = _make_db(project, [_make_param("glob.x", "first")], [])
        db2 = _make_db(project, [_make_param("glob.x", "second")], [])

        with patch("api.services.environment_factory.get_settings") as ms:
            ms.return_value.TEMPLATES_REPO_PATH = str(tmp_path)
            env1 = await EnvironmentFactory(db1).get_environment(project.id)

            EnvironmentFactory.invalidate(project.id)

            env2 = await EnvironmentFactory(db2).get_environment(project.id)

        assert env1 is not env2
        assert env2.globals["glob"]["x"] == "second"

    def test_invalidate_nonexistent_project_is_noop(self):
        # Should not raise
        EnvironmentFactory.invalidate(9999)
