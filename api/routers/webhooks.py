"""
Webhooks router — CRUD for RenderWebhook records.

Mounted at /webhooks in main.py. All endpoints require admin.

Routes:
  GET    /webhooks                — list (filter ?project_id= or ?template_id=)
  POST   /webhooks                — create
  GET    /webhooks/{id}           — get single
  PUT    /webhooks/{id}           — update
  DELETE /webhooks/{id}           — delete
  POST   /webhooks/{id}/test      — fire a test dispatch
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, require_org_admin
from api.core.secrets import SecretResolver
from api.database import get_db
from api.models.render_webhook import RenderWebhook
from api.schemas.render_webhook import (
    RenderWebhookCreate,
    RenderWebhookListOut,
    RenderWebhookOut,
    RenderWebhookUpdate,
    WebhookTestResult,
)
from api.services.webhook_dispatcher import WebhookError, dispatch_test

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_webhook(webhook_id: int, org_id: str, db: AsyncSession) -> RenderWebhook:
    result = await db.execute(
        select(RenderWebhook).where(
            RenderWebhook.id == webhook_id,
            RenderWebhook.organization_id == org_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if webhook is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    return webhook


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get("", response_model=RenderWebhookListOut, summary="List render webhooks")
async def list_webhooks(
    project_id: str | None = Query(None, description="Filter by project"),
    template_id: str | None = Query(None, description="Filter by template"),
    is_active: bool | None = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> RenderWebhookListOut:
    filters = [RenderWebhook.organization_id == current_user.org_id]
    if project_id is not None:
        filters.append(RenderWebhook.project_id == project_id)
    if template_id is not None:
        filters.append(RenderWebhook.template_id == template_id)
    if is_active is not None:
        filters.append(RenderWebhook.is_active.is_(is_active))

    result = await db.execute(
        select(RenderWebhook).where(*filters).order_by(RenderWebhook.id).offset(skip).limit(limit)
    )
    items = list(result.scalars().all())

    count_result = await db.execute(
        select(RenderWebhook).where(*filters)
    )
    total = len(list(count_result.scalars().all()))

    return RenderWebhookListOut(
        items=[RenderWebhookOut.model_validate(w) for w in items],
        total=total,
    )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


@router.post("", response_model=RenderWebhookOut, status_code=status.HTTP_201_CREATED, summary="Create render webhook")
async def create_webhook(
    body: RenderWebhookCreate,
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> RenderWebhookOut:
    webhook = RenderWebhook(
        organization_id=current_user.org_id,
        name=body.name,
        is_active=body.is_active,
        project_id=body.project_id,
        template_id=body.template_id,
        url=body.url,
        http_method=body.http_method,
        auth_header=body.auth_header,
        payload_template=body.payload_template,
        trigger_on=body.trigger_on,
        on_error=body.on_error,
        timeout_seconds=body.timeout_seconds,
    )
    db.add(webhook)
    await db.flush()
    await db.refresh(webhook)
    await db.commit()
    return RenderWebhookOut.model_validate(webhook)


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------


@router.get("/{webhook_id}", response_model=RenderWebhookOut, summary="Get render webhook")
async def get_webhook(
    webhook_id: int,
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> RenderWebhookOut:
    webhook = await _get_webhook(webhook_id, current_user.org_id, db)
    return RenderWebhookOut.model_validate(webhook)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


@router.put("/{webhook_id}", response_model=RenderWebhookOut, summary="Update render webhook")
async def update_webhook(
    webhook_id: int,
    body: RenderWebhookUpdate,
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> RenderWebhookOut:
    webhook = await _get_webhook(webhook_id, current_user.org_id, db)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(webhook, field, value)

    await db.flush()
    await db.refresh(webhook)
    await db.commit()
    return RenderWebhookOut.model_validate(webhook)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None, summary="Delete render webhook")
async def delete_webhook(
    webhook_id: int,
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    webhook = await _get_webhook(webhook_id, current_user.org_id, db)
    await db.delete(webhook)
    await db.commit()


# ---------------------------------------------------------------------------
# Test dispatch
# ---------------------------------------------------------------------------


@router.post("/{webhook_id}/test", response_model=WebhookTestResult, summary="Test a webhook with a synthetic payload")
async def test_webhook(
    webhook_id: int,
    current_user: TokenData = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
) -> WebhookTestResult:
    """
    Fire a test dispatch with a synthetic render context.
    Does not create render history. Useful for verifying connectivity and auth.
    """
    webhook = await _get_webhook(webhook_id, current_user.org_id, db)
    secret_resolver = SecretResolver(db, current_user.org_id)

    result = await dispatch_test(webhook, secret_resolver)
    return WebhookTestResult(
        webhook_id=webhook_id,
        success=result["success"],
        status_code=result.get("status_code"),
        response_body=result.get("response_body"),
        error=result.get("error"),
    )
