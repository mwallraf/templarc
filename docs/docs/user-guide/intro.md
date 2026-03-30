---
title: Introduction
sidebar_position: 1
---

# User Guide

Templarc is a **general-purpose template engine** that lets you browse a catalog of Jinja2 templates, fill in a dynamic form, and instantly generate structured text output — configuration files, provisioning scripts, deployment manifests, or any other text artifact.

## The Core Workflow

```
Browse Catalog → Open Template → Fill Form → Render → Copy / Save
```

1. **Browse the catalog** — templates are organized into projects and a tree hierarchy (base → product → vendor → model).
2. **Open a leaf template** — the system presents a dynamic form built from the template's parameter definitions.
3. **Fill in the form** — some fields may auto-fill from external data sources when you change a related field.
4. **Render** — the server merges your values into the Jinja2 template and returns the output.
5. **Copy or download** — paste the result into your toolchain, or find it later in Render History.

## Who Uses Templarc?

| Role | How They Use It |
|------|----------------|
| **End users** | Browse catalog, fill forms, generate configs |
| **Project editors** | Create and edit templates, manage parameters |
| **Org admins** | Manage users, secrets, projects, API keys |
| **Developers** | Integrate via REST API, write custom Jinja2 filters |

## Key Concepts

### Three-Tier Parameter Scoping

Every parameter in a form belongs to one of three scopes:

| Scope | Prefix | Example | Description |
|-------|--------|---------|-------------|
| Global | `glob.` | `glob.ntp_server` | Applies to all templates, set by org admin |
| Project | `proj.` | `proj.default_vrf` | Applies to all templates in one project |
| Template | _(none)_ | `router.hostname` | Specific to a template and its children |

Global and project parameters are always shown at the top of the form and cannot be overridden by a template.

### Template Hierarchy

Templates form a catalog tree for navigation and parameter inheritance:

```
CPE (base)
  └── Product X
        └── Cisco
              └── Cisco 891  ← leaf template (renderable)
```

Only leaf templates (those with no children) produce a render form. Parent templates serve as organizational containers and define parameters that children inherit.

## Navigation

The left sidebar provides access to all main areas:

- **Catalog** — browse projects and templates
- **History** — view past renders
- **Quickpads** — scratchpad for ad-hoc rendering
- **Sandbox** — test custom Jinja2 filters
- **Studio** — template and parameter management (editor role+)
- **System** — org-level admin (admin role only)
