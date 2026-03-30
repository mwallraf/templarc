---
title: API Integration
sidebar_position: 8
---

# API Integration

The full interactive API reference is at [/docs/api.html](/docs/api.html) — execute requests directly from the browser using a Bearer token or API key.

This page provides quick-start examples for common workflows.

## Authentication

Templarc supports two authentication methods:

| Method | Header | Use case |
|--------|--------|---------|
| Bearer JWT | `Authorization: Bearer <token>` | User sessions, short-lived |
| API Key | `X-API-Key: tmpl_<hex>` | Automation, CI/CD |

API key auth takes priority if both headers are present.

## Obtaining a Token

```bash
# Login with username/password
curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}' | jq .

# Response: {"access_token": "eyJ...", "token_type": "bearer"}

export TOKEN="eyJ..."
```

## List Projects

```bash
curl -s http://localhost:8000/catalog/projects \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## List Templates in a Project

```bash
# List all templates (flat)
curl -s "http://localhost:8000/catalog/projects/{project_slug}/templates" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get template tree (hierarchical)
curl -s "http://localhost:8000/catalog/projects/{project_slug}/tree" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Resolve Parameters for a Template

Call this before rendering to get the full parameter set, including defaults from the inheritance chain and global/project params:

```bash
curl -s "http://localhost:8000/templates/{template_id}/resolve-params" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Optional: pass current user values to get data source enrichment
curl -s -X POST "http://localhost:8000/templates/{template_id}/resolve-params" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"router.hostname": "router-01"}' | jq .
```

## Render a Template

```bash
curl -s -X POST "http://localhost:8000/templates/{template_id}/render" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "router.hostname": "router-01",
      "router.bandwidth_mb": 100
    },
    "persist": true,
    "feature_ids": []
  }' | jq .
```

Add `"persist": false` for a preview render that is not saved to history.

## Fetch Render History

```bash
# List recent renders
curl -s "http://localhost:8000/render-history?limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get a specific render
curl -s "http://localhost:8000/render-history/{history_id}" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Using an API Key

```bash
curl -s http://localhost:8000/catalog/projects \
  -H "X-API-Key: tmpl_a1b2c3d4e5f6..."
```

## Rate Limits

The API enforces rate limits on authentication and render endpoints:
- `POST /auth/login` — 10 requests/minute per IP
- `POST /templates/{id}/render` — 60 requests/minute per user

Rate limit responses return HTTP 429 with a `Retry-After` header.

## Error Responses

All errors use standard HTTP status codes with a JSON body:

```json
{
  "detail": "Template not found"
}
```

Common codes:
| Code | Meaning |
|------|---------|
| 400 | Validation error |
| 401 | Missing or invalid auth |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 422 | Request body schema error |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
