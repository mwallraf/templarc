---
title: API Keys
sidebar_position: 11
---

# API Keys

API keys enable programmatic access to Templarc without a user login session. They are intended for automation scripts, CI/CD pipelines, and third-party integrations.

## Key Format

API keys are prefixed with `tmpl_` followed by 64 hex characters:

```
tmpl_a1b2c3d4e5f6...
```

## Creating an API Key

:::warning
You must be an **org_admin** to create API keys.
:::

1. Go to **System → API Keys**
2. Click **New API Key**
3. Enter:
   - **Name** — descriptive identifier (e.g., "CI/CD pipeline", "Ansible automation")
   - **Admin** — toggle on if this key should have admin-level access
   - **Expires at** — optional expiry date/time

4. Click **Create**
5. **Copy the key immediately** — it is shown only once. The backend stores a SHA-256 hash, not the raw key.

## Using an API Key

Pass the key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: tmpl_a1b2c3d4..." \
     http://localhost:8000/catalog/projects
```

API key auth takes priority over Bearer JWT — if both headers are present, the API key is used.

## Key Prefix

The first 12 characters of the key (the prefix, e.g., `tmpl_a1b2c3`) are stored in the database for display purposes. The **API Keys** list shows these prefixes so you can identify keys without exposing the full value.

## Revoking a Key

1. Go to **System → API Keys**
2. Find the key by its name or prefix
3. Click **Revoke**

Revoking immediately invalidates the key. There is no undo — the raw key is not recoverable.

## Key Rotation

There is no in-place rotation. To rotate:

1. Create a new key with the same name and permissions
2. Update your automation to use the new key
3. Revoke the old key

## Last Used

The **Last used** column shows the timestamp of the most recent request authenticated with this key. This updates on every successful request (best-effort, non-blocking).

## Security Notes

- Keys are never stored in plain text — only a SHA-256 hash
- Expired keys (past `expires_at`) are rejected with a 401 response
- All key creation and revocation events are written to the audit log
- Use the minimum permission level needed — avoid creating admin keys for read-only automation
