---
title: Introduction
sidebar_position: 1
---

# Admin Guide

This guide covers everything needed to deploy, configure, and operate a Templarc instance. It is intended for **org owners**, **org admins**, and anyone responsible for maintaining the platform.

## Admin Responsibilities

| Responsibility | Role |
|---------------|------|
| Install and upgrade Templarc | org_owner / sysadmin |
| Create and manage organizations | org_owner |
| Create projects and assign git repos | org_admin |
| Manage users, LDAP sync, API keys | org_admin |
| Configure secrets | org_admin |
| Create custom Jinja2 filters and objects | org_admin |
| Review the audit log | org_admin |
| Manage remote Git repos | org_admin |

## Admin UI Access

The **System** section in the left sidebar (visible only to org admins) provides access to:

- **Projects** — create/edit projects and configure Git paths
- **Secrets** — manage credential references
- **Users** — manage user accounts and roles
- **API Keys** — create and revoke programmatic access keys
- **Settings** — org-level configuration
- **Observability** — logs, metrics, audit trail

## Quick Links

- [Installation](./installation) — Docker Compose and manual setup
- [First-Time Setup](./first-time-setup) — post-install configuration
- [Projects](./projects) — configuring template repositories
- [Secrets](./secrets) — managing credentials
- [Users and Roles](./users-and-roles) — RBAC configuration
- [LDAP](./ldap) — directory integration
- [API Keys](./api-keys) — programmatic access
- [Audit Log](./audit-log) — compliance and traceability
