---
title: Organizations
sidebar_position: 4
---

# Organizations

An **organization** is the top-level container for all Templarc resources. Projects, users, templates, secrets, and global parameters all belong to an organization.

## Multi-Tenancy

Templarc is designed for multi-tenancy at the database level. Every resource has an `organization_id` foreign key, and the API resolves the organization from the authenticated user's JWT claims. This means:

- Users from one org cannot see or access resources from another org
- `glob.*` parameters are scoped per organization (not truly global across all orgs)
- Each org manages its own projects, users, secrets, and API keys

:::info
Full multi-tenant SaaS provisioning (org self-signup, billing, etc.) is outside the current scope, but the schema supports it. The default installation creates a single organization.
:::

## Organization Settings

Access via **System → Settings**:

| Setting | Description |
|---------|-------------|
| Name | Display name for the organization |
| Slug | URL-safe identifier |
| Contact email | Used for notifications |
| Default comment style | Header comment prefix for all projects (`#`, `!`, `//`, or none) |

## Organization Roles

| Role | Permissions |
|------|-------------|
| `org_owner` | Full access, can transfer ownership, manage billing |
| `org_admin` | Manage users, projects, secrets, API keys, audit log |
| `org_member` | Access to projects they are assigned to |

Project-level roles (set separately per project) further restrict what users can do within a project. See [Users and Roles](./users-and-roles) for the full matrix.
