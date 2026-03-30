---
title: Audit Log
sidebar_position: 13
---

# Audit Log

The audit log records every write operation performed through the Templarc API. It is append-only and provides a full trail of who changed what and when.

## Accessing the Audit Log

Go to **System → Observability → Audit Log** in the admin UI, or query the API:

```bash
GET /admin/audit-log?limit=50&offset=0
```

## What is Logged

Every `POST`, `PUT`, `PATCH`, and `DELETE` request that modifies a resource creates an audit log entry. Examples:

| Action | Resource |
|--------|---------|
| Create template | `templates` |
| Update parameter | `parameters` |
| Delete secret | `secrets` |
| Create user | `users` |
| Login (local) | `auth` |
| Create API key | `api_keys` |
| Render template | `render` |
| Clone remote repo | `git_remote` |

## Log Entry Fields

| Field | Description |
|-------|-------------|
| `id` | Monotonically increasing entry ID |
| `timestamp` | UTC timestamp of the operation |
| `user` | Username or `apikey:<name>` for API key requests |
| `org_id` | Organization scope |
| `action` | HTTP method + endpoint path (e.g., `POST /templates`) |
| `resource_type` | Affected resource type |
| `resource_id` | Affected resource ID (if applicable) |
| `changes` | JSONB snapshot of the before/after state (write ops only) |

## Filtering

The UI provides filtering by:
- Date range
- User
- Resource type
- Action type

API filtering:
```bash
GET /admin/audit-log?user=admin&resource_type=templates&limit=20
```

## Retention

By default, audit log entries are kept forever. Configure `AUDIT_LOG_RETENTION_DAYS` in `.env` to automatically purge old entries:

```
AUDIT_LOG_RETENTION_DAYS=90
```

:::warning
Deleting audit log entries is a destructive operation and cannot be undone. Consider exporting logs to an external system before setting a retention policy.
:::
