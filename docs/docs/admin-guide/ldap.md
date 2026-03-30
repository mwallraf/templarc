---
title: LDAP Authentication
sidebar_position: 14
---

# LDAP Authentication

Templarc supports LDAP/Active Directory authentication alongside local username/password login. When LDAP is configured, users can log in with their directory credentials.

## Configuration

Set these environment variables in `.env`:

```bash
LDAP_SERVER=ldap://ldap.company.com
LDAP_BASE_DN=dc=company,dc=com
LDAP_ADMIN_GROUP=cn=admins,ou=groups,dc=company,dc=com
```

| Variable | Description |
|----------|-------------|
| `LDAP_SERVER` | LDAP server URL. Set to empty string (`""`) to disable LDAP auth entirely. |
| `LDAP_BASE_DN` | Base distinguished name for user searches |
| `LDAP_ADMIN_GROUP` | DN of the group whose members get `is_admin=True` in Templarc |

## How It Works

1. User submits credentials at `POST /auth/login`
2. If `LDAP_SERVER` is set and the username doesn't match a local account, Templarc tries LDAP:
   - Binds to LDAP as the user (`uid=<username>,<base_dn>`)
   - On success, upserts a user record in the Templarc database
   - Checks group membership against `LDAP_ADMIN_GROUP`
3. A JWT is issued with the resolved permissions

:::info
Local accounts take priority over LDAP. If a username exists in both the local database and LDAP, local auth is used.
:::

## Group-to-Role Mapping

| LDAP Group Member | Templarc Role |
|------------------|---------------|
| Member of `LDAP_ADMIN_GROUP` | `is_admin=True` (org_admin) |
| All other LDAP users | `is_admin=False` (org_member) |

Project-level roles must be assigned manually via **System → Users** or **Studio → Members** after the user first logs in.

## Dev LDAP

The dev Docker stack includes an embedded OpenLDAP server with a pre-seeded directory:

```bash
make ldap-search   # list all dev LDAP users
```

Default dev credentials:
- LDAP server: `ldap://localhost:1389`
- Manager DN: `cn=manager,dc=templarc,dc=dev`
- Manager password: `manager`

## Testing LDAP

To verify LDAP is working:

```bash
curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "ldapuser", "password": "password"}' | jq .
```

A successful response returns `{"access_token": "..."}`.

## Disabling LDAP

Set `LDAP_SERVER=""` in `.env` and restart. All existing LDAP-sourced user records remain in the database but future LDAP logins will fail with a 401.
