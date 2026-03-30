---
title: Secrets
sidebar_position: 7
---

# Secrets

Secrets store credentials used by data sources (and remote Git repos). They are never exposed to the frontend — the backend resolves them server-side before making external API calls.

## Secret Types

Templarc supports three secret reference formats:

| Format | Example | Resolution |
|--------|---------|------------|
| `secret:<name>` | `secret:netbox_api` | Looked up by name in the `secrets` database table |
| `env:<var>` | `env:NETBOX_API_TOKEN` | Read from the environment variable at request time |
| `vault:<path>` | `vault:kv/data/netbox` | _Reserved for future HashiCorp Vault integration_ |

:::tip
Use `secret:` for credentials that should be managed via the UI. Use `env:` for secrets injected at container startup via your orchestration platform.
:::

## Creating a Secret

1. Go to **System → Secrets**
2. Click **New Secret**
3. Enter:
   - **Name** — identifier used in `secret:<name>` references (e.g., `netbox_api`)
   - **Value** — the actual secret value (stored encrypted in the database)
   - **Description** — optional human-readable note

## Using a Secret in a Data Source

In the template's `data_sources` YAML frontmatter:

```yaml
data_sources:
  - id: netbox
    url: "https://netbox.company.com/api/dcim/devices/?name={{ router.hostname }}"
    auth: "secret:netbox_api"   # ← reference format
    trigger: on_change:router.hostname
```

The backend resolves `secret:netbox_api` at request time and passes it as a Bearer token or API key header.

## Using a Secret for Remote Git

In project settings, set the **Credential** field to a secret reference:

```
secret:git_token
```

The backend embeds the resolved token into the HTTPS remote URL: `https://oauth2:<token>@host/repo.git`.

## Security Notes

- Secret values are stored encrypted at rest in the database
- Secret values are never returned by the API — only names and descriptions
- Audit log records writes to secrets (creation, update, deletion)
- `env:` secrets are resolved from the API container's environment — ensure your container runtime injects them securely

:::warning
Do not put secret references directly in template body content. References are only resolved in `auth:` fields of data source configurations.
:::
