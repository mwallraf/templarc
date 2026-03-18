"""
Webhook dispatcher for Templarc.

Fires outbound HTTP webhooks after a successful template render.

Public API
----------
dispatch_webhooks(...)
    Called from TemplateRenderer.render(). Separates blocking (on_error=block)
    from fire-and-forget (on_error=warn) webhooks and handles both.

dispatch_one(...)
    Fire a single webhook; raises WebhookError on non-2xx if on_error=block.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
import jinja2
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.secrets import SecretResolver
from api.models.render_webhook import RenderWebhook
from api.models.webhook_delivery import WebhookDelivery

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------


class WebhookError(Exception):
    """Raised by dispatch_one when on_error='block' and the request fails."""


# ---------------------------------------------------------------------------
# Dispatch context (passed to each webhook)
# ---------------------------------------------------------------------------


@dataclass
class WebhookContext:
    render_id: str | None
    template_id: str
    template_name: str
    project_name: str
    git_sha: str
    rendered_by: str
    rendered_at: str          # ISO-8601
    parameters: dict[str, Any]
    output: str


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------


def _build_default_payload(ctx: WebhookContext) -> str:
    """Return the default JSON payload as a string."""
    payload = {
        "event": "render.completed",
        "render_id": ctx.render_id,
        "template_id": ctx.template_id,
        "template_name": ctx.template_name,
        "project_name": ctx.project_name,
        "git_sha": ctx.git_sha,
        "rendered_by": ctx.rendered_by,
        "rendered_at": ctx.rendered_at,
        "parameters": ctx.parameters,
        "output": ctx.output,
    }
    return json.dumps(payload)


def _build_template_payload(payload_template: str, ctx: WebhookContext) -> str:
    """Render a Jinja2 payload_template string with the webhook context."""
    env = jinja2.Environment(autoescape=False)

    # Add b64encode filter (useful for encoding config blobs)
    def _b64encode(value: str) -> str:
        return base64.b64encode(value.encode()).decode()

    env.filters["b64encode"] = _b64encode

    template = env.from_string(payload_template)
    return template.render(
        render_id=ctx.render_id,
        template_id=ctx.template_id,
        template_name=ctx.template_name,
        project_name=ctx.project_name,
        git_sha=ctx.git_sha,
        rendered_by=ctx.rendered_by,
        rendered_at=ctx.rendered_at,
        parameters=ctx.parameters,
        output=ctx.output,
    )


# ---------------------------------------------------------------------------
# Single webhook dispatch
# ---------------------------------------------------------------------------


async def dispatch_one(
    webhook: RenderWebhook,
    ctx: WebhookContext,
    secret_resolver: SecretResolver,
    db: AsyncSession | None = None,
) -> None:
    """
    Fire one webhook.

    - Renders payload (default JSON or payload_template)
    - Resolves auth header via SecretResolver
    - Sends HTTP request with httpx
    - Records a WebhookDelivery row in DB if db is provided
    - Raises WebhookError on failure when on_error='block'
    - Logs at WARNING level on failure when on_error='warn'
    """
    event = "render.completed"

    # Build payload
    try:
        if webhook.payload_template:
            payload_str = _build_template_payload(webhook.payload_template, ctx)
        else:
            payload_str = _build_default_payload(ctx)
    except Exception as exc:
        msg = f"Webhook {webhook.id} ({webhook.name!r}) payload render failed: {exc}"
        await _record_delivery(db, webhook.id, event, {}, None, None, str(exc), None)
        if webhook.on_error == "block":
            raise WebhookError(msg) from exc
        logger.warning(msg)
        return

    payload_dict = json.loads(payload_str)

    # Build headers
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if webhook.auth_header:
        try:
            token = await secret_resolver.resolve(webhook.auth_header)
            headers["Authorization"] = f"Bearer {token}"
        except Exception as exc:
            msg = f"Webhook {webhook.id} ({webhook.name!r}) auth resolution failed: {exc}"
            await _record_delivery(db, webhook.id, event, payload_dict, None, None, str(exc), None)
            if webhook.on_error == "block":
                raise WebhookError(msg) from exc
            logger.warning(msg)
            return

    # Send HTTP request
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=webhook.timeout_seconds) as client:
            response = await client.request(
                method=webhook.http_method,
                url=webhook.url,
                content=payload_str,
                headers=headers,
            )
        duration_ms = int((time.monotonic() - t0) * 1000)
        await _record_delivery(
            db, webhook.id, event, payload_dict,
            response.status_code, response.text[:2000], None, duration_ms,
        )
        if response.is_success:
            logger.info(
                "Webhook %d (%r) → %s %s",
                webhook.id, webhook.name, response.status_code, webhook.url,
            )
        else:
            msg = (
                f"Webhook {webhook.id} ({webhook.name!r}) returned "
                f"HTTP {response.status_code}: {response.text[:200]}"
            )
            if webhook.on_error == "block":
                raise WebhookError(msg)
            logger.warning(msg)

    except WebhookError:
        raise
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        await _record_delivery(db, webhook.id, event, payload_dict, None, None, str(exc), duration_ms)
        msg = f"Webhook {webhook.id} ({webhook.name!r}) request failed: {exc}"
        if webhook.on_error == "block":
            raise WebhookError(msg) from exc
        logger.warning(msg)


async def _record_delivery(
    db: AsyncSession | None,
    webhook_id: int,
    event: str,
    payload: dict,
    status_code: int | None,
    response_body: str | None,
    error: str | None,
    duration_ms: int | None,
) -> None:
    """Insert a WebhookDelivery row. Best-effort — never raises."""
    if db is None:
        return
    try:
        delivery = WebhookDelivery(
            webhook_id=webhook_id,
            event=event,
            payload=payload,
            status_code=status_code,
            response_body=response_body,
            error=error,
            duration_ms=duration_ms,
        )
        db.add(delivery)
        await db.flush()
    except Exception as exc:
        logger.warning("Failed to record webhook delivery: %s", exc)


# ---------------------------------------------------------------------------
# Test dispatch (synthetic payload, no real render context needed)
# ---------------------------------------------------------------------------


async def dispatch_test(
    webhook: RenderWebhook,
    secret_resolver: SecretResolver,
) -> dict[str, Any]:
    """
    Fire a test dispatch with a synthetic context.
    Returns a dict with success, status_code, response_body, error.
    """
    ctx = WebhookContext(
        render_id=None,
        template_id=0,
        template_name="test_template",
        project_name="test_project",
        git_sha="0000000000000000",
        rendered_by="templarc-test",
        rendered_at=datetime.now(timezone.utc).isoformat(),
        parameters={"example.param": "test_value"},
        output="# This is a test webhook dispatch from Templarc\nhostname test-router\n",
    )

    try:
        if webhook.payload_template:
            payload_str = _build_template_payload(webhook.payload_template, ctx)
        else:
            payload_str = _build_default_payload(ctx)
    except Exception as exc:
        return {"success": False, "status_code": None, "response_body": None, "error": str(exc)}

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if webhook.auth_header:
        try:
            token = await secret_resolver.resolve(webhook.auth_header)
            headers["Authorization"] = f"Bearer {token}"
        except Exception as exc:
            return {"success": False, "status_code": None, "response_body": None, "error": str(exc)}

    try:
        async with httpx.AsyncClient(timeout=webhook.timeout_seconds) as client:
            response = await client.request(
                method=webhook.http_method,
                url=webhook.url,
                content=payload_str,
                headers=headers,
            )
        return {
            "success": response.is_success,
            "status_code": response.status_code,
            "response_body": response.text[:2000],
            "error": None,
        }
    except Exception as exc:
        return {
            "success": False,
            "status_code": None,
            "response_body": None,
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Main dispatch entry point
# ---------------------------------------------------------------------------


async def dispatch_webhooks(
    *,
    db: AsyncSession,
    template_id: str,
    project_id: str,
    organization_id: str,
    ctx: WebhookContext,
    persist: bool,
) -> None:
    """
    Load matching active webhooks and fire them.

    Called from TemplateRenderer.render() after the RenderResult is built.
    Blocking webhooks (on_error=block) are awaited before the result is returned.
    Warn webhooks are backgrounded via asyncio.create_task.
    """
    # Load webhooks scoped to this template OR this project
    stmt = select(RenderWebhook).where(
        RenderWebhook.organization_id == organization_id,
        RenderWebhook.is_active.is_(True),
        or_(
            RenderWebhook.template_id == template_id,
            RenderWebhook.project_id == project_id,
        ),
    )
    result = await db.execute(stmt)
    webhooks = list(result.scalars().all())

    if not webhooks:
        return

    # Filter by trigger_on: skip persist-only webhooks on preview renders
    if not persist:
        webhooks = [w for w in webhooks if w.trigger_on == "always"]

    if not webhooks:
        return

    secret_resolver = SecretResolver(db, organization_id)

    block_webhooks = [w for w in webhooks if w.on_error == "block"]
    warn_webhooks = [w for w in webhooks if w.on_error == "warn"]

    # Blocking webhooks — awaited; failure propagates as WebhookError → 502
    for w in block_webhooks:
        await dispatch_one(w, ctx, secret_resolver, db=db)

    # Fire-and-forget webhooks
    for w in warn_webhooks:
        asyncio.create_task(dispatch_one(w, ctx, secret_resolver, db=db))
