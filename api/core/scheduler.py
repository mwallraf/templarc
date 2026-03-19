"""
Background scheduler for Templarc.

Jobs:
  - purge_old_render_history: daily at 02:00 UTC
      Deletes render_history rows older than org.retention_days for each
      organisation that has a retention_days value set.
  - purge_old_audit_log: daily at 03:00 UTC
      Deletes audit_log rows older than AUDIT_LOG_RETENTION_DAYS.
      Skipped when AUDIT_LOG_RETENTION_DAYS is None (keep forever).

Started/stopped via the FastAPI lifespan handler in api/main.py.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def purge_old_render_history(session_factory: async_sessionmaker) -> None:
    """
    Delete render_history rows that exceed each org's retention_days limit.

    Skips orgs where retention_days is NULL (keep forever).
    Logs the number of rows deleted per org.
    """
    from api.models.organization import Organization
    from api.models.render_history import RenderHistory
    from api.models.template import Template
    from api.models.project import Project

    async with session_factory() as session:
        # Fetch orgs with a retention policy
        result = await session.execute(
            select(Organization).where(Organization.retention_days.isnot(None))
        )
        orgs = result.scalars().all()

        for org in orgs:
            cutoff = datetime.now(timezone.utc) - timedelta(days=org.retention_days)

            # Subquery: render_history IDs for this org older than cutoff
            old_ids_subq = (
                select(RenderHistory.id)
                .join(Template, RenderHistory.template_id == Template.id)
                .join(Project, Template.project_id == Project.id)
                .where(
                    Project.organization_id == org.id,
                    RenderHistory.rendered_at < cutoff,
                )
                .scalar_subquery()
            )

            del_result = await session.execute(
                delete(RenderHistory).where(RenderHistory.id.in_(old_ids_subq))
            )
            deleted = del_result.rowcount
            if deleted:
                logger.info(
                    "Retention purge: deleted %d render_history rows for org %s (retention=%d days)",
                    deleted, org.id, org.retention_days,
                )

        await session.commit()


async def purge_old_audit_log(session_factory: async_sessionmaker) -> None:
    """
    Delete audit_log rows older than AUDIT_LOG_RETENTION_DAYS.

    Skips when AUDIT_LOG_RETENTION_DAYS is None (keep forever).
    Logs the number of rows deleted.
    """
    from api.models.audit_log import AuditLog

    settings = get_settings()
    if settings.AUDIT_LOG_RETENTION_DAYS is None:
        logger.debug("Audit log retention: AUDIT_LOG_RETENTION_DAYS is None — skipping purge")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.AUDIT_LOG_RETENTION_DAYS)
    async with session_factory() as session:
        del_result = await session.execute(
            delete(AuditLog).where(AuditLog.timestamp < cutoff)
        )
        deleted = del_result.rowcount
        if deleted:
            logger.info(
                "Audit log retention purge: deleted %d rows older than %s (%d days)",
                deleted, cutoff.date().isoformat(), settings.AUDIT_LOG_RETENTION_DAYS,
            )
        await session.commit()


def start_scheduler(session_factory: async_sessionmaker) -> AsyncIOScheduler:
    """Create and start the background scheduler. Call from lifespan startup."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        purge_old_render_history,
        trigger="cron",
        hour=2,
        minute=0,
        args=[session_factory],
        id="purge_render_history",
        replace_existing=True,
    )
    scheduler.add_job(
        purge_old_audit_log,
        trigger="cron",
        hour=3,
        minute=0,
        args=[session_factory],
        id="purge_audit_log",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Background scheduler started "
        "(purge_render_history at 02:00 UTC, purge_audit_log at 03:00 UTC)"
    )
    _scheduler = scheduler
    return scheduler


def stop_scheduler() -> None:
    """Shut down the scheduler gracefully. Call from lifespan shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Background scheduler stopped")
