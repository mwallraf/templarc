---
title: Browsing the Catalog
sidebar_position: 2
---

# Browsing the Catalog

The catalog is your starting point for finding and using templates.

## Project List

Navigate to **Catalog** in the sidebar. You will see a grid of project cards, one per project (e.g., "Router Provisioning", "Server Installation"). Each card shows the project name, description, and the number of templates it contains.

Click a project card to open that project's template catalog.

## Template Hierarchy

Inside a project, templates are arranged in a tree:

```
CPE
  ├── Cisco
  │     ├── Cisco 891
  │     └── Cisco 1921
  └── Juniper
        └── Juniper SRX
```

- **Branch nodes** (CPE, Cisco) are organizational containers. Clicking them expands or collapses their children.
- **Leaf nodes** (Cisco 891) are renderable templates. Clicking a leaf opens the render form.

:::tip
If a template name appears greyed out, it is a parent/base template. Only templates with a render button are leaf templates you can fill in.
:::

## Template Breadcrumb

When you open a template, the breadcrumb at the top of the page shows its full path in the hierarchy:

```
Home / Catalog / Router Provisioning / CPE / Cisco / Cisco 891
```

This helps you understand where the template sits and what parameter inheritance applies.

## Search and Filter

Use the search bar at the top of the catalog to filter templates by name. The search is instant and covers both template names and descriptions.

:::info
Search is scoped to the current project. To search across all projects, navigate to the project first and then search.
:::
