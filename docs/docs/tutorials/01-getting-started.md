---
title: "Tutorial 1: Getting Started"
sidebar_position: 1
---

# Tutorial 1: Getting Started

**Goal:** Log in and orient yourself in the Templarc UI.

**Time:** ~5 minutes

**Who:** All users

---

## Step 1: Open Templarc

Navigate to your Templarc URL in a browser. You will see the landing page with an overview of the system and a **Get Started** button.

<!-- SCREENSHOT: landing-page -->

---

## Step 2: Log In

Click **Login** or navigate to `/login`. Enter your credentials:

- **Username** — provided by your admin
- **Password** — your account password

Click **Sign In**.

<!-- SCREENSHOT: login-form -->

:::info
If your organization uses LDAP/Active Directory, use your directory credentials. Templarc will authenticate you against the configured directory server.
:::

---

## Step 3: The Catalog

After logging in, you land on the **Catalog** page (`/catalog`). This shows all projects your account has access to as a grid of cards.

<!-- SCREENSHOT: catalog-empty -->

Each card shows:
- Project name
- Description
- Number of templates

---

## Step 4: Open a Project

Click any project card to enter that project's template catalog. You will see the template hierarchy — a tree of base templates and leaf templates.

<!-- SCREENSHOT: project-catalog -->

**Branch nodes** (expandable): organizational containers, not renderable
**Leaf nodes** (with a render button): the templates you fill in and render

---

## Step 5: The Main Navigation

The left sidebar is your main navigation:

<!-- SCREENSHOT: navbar-annotated -->

| Area | Purpose |
|------|---------|
| **Catalog** | Browse and render templates |
| **History** | Find past renders |
| **Quickpads** | Ad-hoc text scratchpad |
| **Sandbox** | Test Jinja2 filter code |
| **Studio** | Template and parameter management |
| **System** | Org-level admin (admin role only) |

At the bottom of the sidebar, your username, a theme toggle, and a logout button are always visible.

---

## Next Steps

Now that you're oriented, try [Render a Template →](./render-a-template) to generate your first output.
