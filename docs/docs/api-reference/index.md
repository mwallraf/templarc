---
title: API Reference
sidebar_position: 1
---

# API Reference

The full interactive API reference is rendered from the OpenAPI specification via Redoc.

**Direct link: [/docs/api.html](/docs/api.html)**

You can execute requests directly from the Redoc UI using a Bearer token or an API key. See [API Integration](../developer-guide/api-integration) for authentication instructions.

## Regenerating the OpenAPI Spec

When API endpoints change, regenerate `openapi.json` from the project root:

```bash
make openapi
```

This runs:

```bash
uv run python -c "
import json, os
os.environ.setdefault('DATABASE_URL', 'x')
os.environ.setdefault('SECRET_KEY', 'x')
os.environ.setdefault('TEMPLATES_REPO_PATH', './templates_repo')
from api.main import app
print(json.dumps(app.openapi(), indent=2))
" > openapi.json
```

## API Groups

| Group | Base Path | Description |
|-------|-----------|-------------|
| Auth | `/auth/` | Login, user management, API keys |
| Catalog | `/catalog/` | Browse projects and template hierarchy |
| Templates | `/templates/` | Template CRUD, resolve params, render |
| Parameters | `/parameters/` | Parameter management |
| Render History | `/render-history/` | Query and replay past renders |
| Admin | `/admin/` | Filters, objects, audit log, git sync |
| Webhooks | `/webhooks/` | Outbound webhook subscriptions |

## Authentication

All endpoints require authentication via either:

- `Authorization: Bearer <jwt_token>` — obtained from `POST /auth/login`
- `X-API-Key: tmpl_<hex>` — created via `POST /auth/api-keys`

GET endpoints require the `get_current_user` dependency. POST/PUT/DELETE endpoints on administrative resources require the `require_admin` dependency.
