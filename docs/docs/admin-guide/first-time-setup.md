---
title: First-Time Setup
sidebar_position: 3
---

# First-Time Setup

After installing Templarc, follow these steps to get your instance ready for users.

## 1. Navigate to the App

Open `http://localhost:5173` (dev) or `http://your-domain` (prod) in a browser.

## 2. Log In as Admin

Default dev credentials (set via the seed script / LDAP dev config):

- **Username:** `admin`
- **Password:** `admin`

:::warning
Change the admin password immediately in any non-development environment. Go to your profile page or use the API: `PUT /auth/users/{id}`.
:::

## 3. Review Your Organization

The seed script creates a default organization named **"Templarc"**. To rename it or configure org-level settings:

1. Go to **System → Settings**
2. Update the organization name, contact email, and default comment style

## 4. Create the First Project

A **project** maps to a Git repository path containing `.j2` template files.

1. Go to **System → Projects**
2. Click **New Project**
3. Fill in:
   - **Name** — human-readable project name (e.g., "Router Provisioning")
   - **Slug** — URL-safe identifier (auto-generated from name)
   - **Git path** — path within `TEMPLATES_REPO_PATH` (e.g., `router_provisioning/`)
   - **Comment style** — comment prefix for the metadata header (`#`, `!`, `//`, or none)
4. Click Save

## 5. Create Template Files

Add `.j2` template files to the project's Git path, then import them:

```bash
# Option A: Add files to templates_repo/ and import via API
POST /admin/git-sync/{project_id}
```

Or create templates directly in the UI via **Studio → Templates → New Template**.

## 6. Add Users and Assign Roles

1. Go to **System → Users**
2. Click **Invite User** (local auth) or enable LDAP sync (see [LDAP](./ldap))
3. Assign roles at the org or project level

See [Users and Roles](./users-and-roles) for the full role matrix.

## 7. Configure Global Parameters

Global (`glob.*`) parameters are injected into every template render in your organization:

1. Go to **Studio → Parameters**
2. Filter by scope **Global**
3. Add parameters like `glob.ntp_server`, `glob.company_name`, `glob.dns_server`

## 8. Test a Render

1. Go to **Catalog**
2. Open your project
3. Click a leaf template
4. Fill in the form and click **Render**
5. Verify the output looks correct

## Next Steps

- [Configure secrets](./secrets) for data source credentials
- [Set up LDAP](./ldap) if using directory authentication
- [Create API keys](./api-keys) for automation
- [Enable the seed script](./projects) to populate demo templates
