"""
Audit log service — append-only write helper.

Usage in routers (after service call, before db.commit()):

    await log_write(db, token.sub, "create", "project", proj.id, body.model_dump())
    await db.commit()

The helper does NOT flush or commit — the calling router handles transaction
boundaries, ensuring the audit entry and the resource change are committed
atomically.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog


async def log_write(
    db: AsyncSession,
    user_sub: str,
    action: str,
    resource_type: str,
    resource_id: int | None = None,
    changes: dict | None = None,
) -> None:
    """
    Append an audit log entry for a write operation.

    Args:
        db:            Active async database session.
        user_sub:      JWT 'sub' claim of the authenticated caller.
        action:        One of "create", "update", "delete".
        resource_type: Resource domain, e.g. "template", "parameter", "project".
        resource_id:   Primary key of the affected row (None for bulk/unknown).
        changes:       Request payload as a dict (body.model_dump() for create/update,
                       omit or pass {} for delete).
    """
    db.add(AuditLog(
        user_sub=user_sub,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        changes=changes or {},
    ))
