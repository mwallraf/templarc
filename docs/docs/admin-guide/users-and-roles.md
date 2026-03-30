---
title: Users and Roles
sidebar_position: 5
---

# Users and Roles

Templarc uses role-based access control (RBAC) with two role levels: organization-level and project-level.

## Organization Roles

| Role | Description |
|------|-------------|
| `org_owner` | Full control over the organization. Can manage all resources and transfer ownership. |
| `org_admin` | Can manage users, projects, secrets, API keys, filters, and the audit log. Cannot transfer ownership. |
| `org_member` | Base role for all authenticated users. Access to projects is granted via project roles. |

## Project Roles

| Role | Description |
|------|-------------|
| `project_admin` | Full control within a project. Can manage templates, parameters, features, and project settings. |
| `project_editor` | Can create and edit templates and parameters. Cannot change project settings or manage members. |
| `project_member` | Can browse the catalog and render templates. Cannot edit templates or parameters. |
| `guest` | Read-only access to the catalog. Cannot render templates. |

## Creating Users

### Local Authentication

1. Go to **System → Users**
2. Click **Invite User**
3. Enter username, email, and initial password
4. Assign an org role

The user receives their credentials and can log in at `/login`.

### LDAP Authentication

When `LDAP_SERVER` is configured, users can log in with their directory credentials. On first login, a Templarc user record is created automatically. See [LDAP](./ldap) for configuration.

## Assigning Project Roles

1. Go to **System → Projects** and select a project
2. Click the **Members** tab
3. Search for a user and assign their project role

Or navigate to **Studio → Members** which shows membership across all projects.

## API Keys

API keys provide programmatic access without a user login. They use the same RBAC — each key is associated with an admin flag that controls access level. See [API Keys](./api-keys) for details.

## Password Management

Admins can reset passwords for local users via **System → Users → Reset Password**. Users can change their own password on the profile page.

:::info
LDAP users cannot change their password through Templarc — they must use their directory's password management tools.
:::
