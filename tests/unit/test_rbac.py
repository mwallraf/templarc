"""
Unit tests for Phase 11 RBAC helpers in api/core/auth.py.

These tests run without a live database — all DB interactions are mocked.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from api.core.auth import (
    TokenData,
    _PROJECT_ROLE_RANK,
    _check_project_membership,
    get_user_project_ids,
    is_org_admin,
    require_org_admin,
    require_project_role,
    require_project_role_for_template,
)


# ===========================================================================
# is_org_admin
# ===========================================================================

class TestIsOrgAdmin:

    def test_org_owner_is_admin(self):
        token = TokenData(sub="owner", org_id="1", org_role="org_owner")
        assert is_org_admin(token) is True

    def test_org_admin_is_admin(self):
        token = TokenData(sub="admin", org_id="1", org_role="org_admin")
        assert is_org_admin(token) is True

    def test_member_is_not_admin(self):
        token = TokenData(sub="user", org_id="1", org_role="member")
        assert is_org_admin(token) is False

    def test_platform_admin_overrides_member_role(self):
        token = TokenData(sub="superadmin", org_id="1", org_role="member", is_platform_admin=True)
        assert is_org_admin(token) is True

    def test_platform_admin_false_member_is_not_admin(self):
        token = TokenData(sub="user", org_id="1", org_role="member", is_platform_admin=False)
        assert is_org_admin(token) is False


# ===========================================================================
# Role hierarchy constants
# ===========================================================================

class TestProjectRoleHierarchy:

    def test_guest_is_lowest(self):
        assert _PROJECT_ROLE_RANK["guest"] < _PROJECT_ROLE_RANK["project_member"]

    def test_project_member_below_editor(self):
        assert _PROJECT_ROLE_RANK["project_member"] < _PROJECT_ROLE_RANK["project_editor"]

    def test_project_editor_below_admin(self):
        assert _PROJECT_ROLE_RANK["project_editor"] < _PROJECT_ROLE_RANK["project_admin"]

    def test_project_admin_is_highest(self):
        ranks = list(_PROJECT_ROLE_RANK.values())
        assert _PROJECT_ROLE_RANK["project_admin"] == max(ranks)


# ===========================================================================
# require_org_admin
# ===========================================================================

class TestRequireOrgAdmin:

    async def test_org_owner_passes(self):
        token = TokenData(sub="owner", org_id="1", org_role="org_owner")
        result = await require_org_admin(token)
        assert result is token

    async def test_org_admin_passes(self):
        token = TokenData(sub="admin", org_id="1", org_role="org_admin")
        result = await require_org_admin(token)
        assert result is token

    async def test_member_raises_403(self):
        token = TokenData(sub="user", org_id="1", org_role="member")
        with pytest.raises(HTTPException) as exc:
            await require_org_admin(token)
        assert exc.value.status_code == 403

    async def test_platform_admin_as_member_passes(self):
        token = TokenData(sub="super", org_id="1", org_role="member", is_platform_admin=True)
        result = await require_org_admin(token)
        assert result is token


# ===========================================================================
# _check_project_membership
# ===========================================================================

def _make_user_mock(user_id: str = "user-uuid-1") -> MagicMock:
    user = MagicMock()
    user.id = user_id
    return user


def _make_membership_mock(role: str = "project_member") -> MagicMock:
    m = MagicMock()
    m.role = role
    return m


def _make_db(user: object, membership: object) -> AsyncMock:
    db = AsyncMock()

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    mem_result = MagicMock()
    mem_result.scalar_one_or_none.return_value = membership

    db.execute = AsyncMock(side_effect=[user_result, mem_result])
    return db


class TestCheckProjectMembership:

    async def test_sufficient_role_passes(self):
        token = TokenData(sub="alice", org_id="1", org_role="member")
        db = _make_db(_make_user_mock(), _make_membership_mock(role="project_editor"))

        # Should not raise
        await _check_project_membership(token, "proj-1", "project_member", db)

    async def test_exact_role_passes(self):
        token = TokenData(sub="alice", org_id="1", org_role="member")
        db = _make_db(_make_user_mock(), _make_membership_mock(role="project_member"))
        await _check_project_membership(token, "proj-1", "project_member", db)

    async def test_insufficient_role_raises_403(self):
        token = TokenData(sub="alice", org_id="1", org_role="member")
        db = _make_db(_make_user_mock(), _make_membership_mock(role="guest"))
        with pytest.raises(HTTPException) as exc:
            await _check_project_membership(token, "proj-1", "project_editor", db)
        assert exc.value.status_code == 403

    async def test_no_user_raises_403(self):
        token = TokenData(sub="ghost", org_id="1", org_role="member")
        db = _make_db(None, None)
        with pytest.raises(HTTPException) as exc:
            await _check_project_membership(token, "proj-1", "guest", db)
        assert exc.value.status_code == 403

    async def test_no_membership_raises_403(self):
        token = TokenData(sub="alice", org_id="1", org_role="member")
        db = _make_db(_make_user_mock(), None)
        with pytest.raises(HTTPException) as exc:
            await _check_project_membership(token, "proj-1", "guest", db)
        assert exc.value.status_code == 403


# ===========================================================================
# get_user_project_ids
# ===========================================================================

class TestGetUserProjectIds:

    async def test_org_admin_returns_all_org_projects(self):
        token = TokenData(sub="admin", org_id="org-1", org_role="org_admin")
        db = AsyncMock()
        result_mock = MagicMock()
        result_mock.all.return_value = [("proj-1",), ("proj-2",)]
        db.execute = AsyncMock(return_value=result_mock)

        ids = await get_user_project_ids(token, db)
        assert set(ids) == {"proj-1", "proj-2"}

    async def test_member_returns_only_membership_projects(self):
        token = TokenData(sub="user", org_id="org-1", org_role="member")
        db = AsyncMock()

        user_row = MagicMock()
        user_row.one_or_none.return_value = ("user-uuid-1",)

        mem_result = MagicMock()
        mem_result.all.return_value = [("proj-a",), ("proj-b",)]

        db.execute = AsyncMock(side_effect=[user_row, mem_result])

        ids = await get_user_project_ids(token, db)
        assert set(ids) == {"proj-a", "proj-b"}

    async def test_member_with_no_user_row_returns_empty(self):
        token = TokenData(sub="ghost", org_id="org-1", org_role="member")
        db = AsyncMock()

        user_row = MagicMock()
        user_row.one_or_none.return_value = None

        db.execute = AsyncMock(return_value=user_row)

        ids = await get_user_project_ids(token, db)
        assert ids == []
