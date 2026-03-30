---
title: Projects
sidebar_position: 6
---

# Projects

A **project** is the top-level container for templates within an organization. Each project maps to a directory in the Git-backed template repository.

## Creating a Project

1. Go to **System → Projects**
2. Click **New Project**
3. Fill in the required fields:

| Field | Description |
|-------|-------------|
| Name | Human-readable project name (e.g., "Router Provisioning") |
| Slug | URL-safe identifier, auto-generated from name. Used in API paths. |
| Git path | Relative path within `TEMPLATES_REPO_PATH` (e.g., `router_provisioning/`) |
| Comment style | Header prefix for rendered output: `#`, `!`, `//`, `<!-- -->`, or none |
| History label param | Template parameter name whose value is stored as the render's `display_label` for search |

## Git Path

The `git_path` is the directory within the local template repository that this project uses. All `.j2` template files for this project must be stored under this path.

```
templates_repo/
├── router_provisioning/   ← git_path for "Router Provisioning" project
│   ├── cpe/
│   │   └── cisco_891.j2
│   └── shared/
│       └── banner.j2
└── server_installation/   ← git_path for "Server Installation" project
    └── debian.j2
```

## History Label Parameter

Set `history_label_param` to the name of a template-local parameter that uniquely identifies a render (e.g., `router.hostname`). This value is saved as the `display_label` on every render, enabling fast search in the history list.

Example: if set to `router.hostname`, every render for `router-01` will be searchable by that hostname in the history page.

## Comment Style

The comment style controls the format of the metadata header prepended to every rendered output. Choose the style that matches your template content:

| Style | Example |
|-------|---------|
| `#` | `# Template: Router Provisioning / CPE / Cisco 891` |
| `!` | `! Template: Router Provisioning / CPE / Cisco 891` |
| `//` | `// Template: Router Provisioning / CPE / Cisco 891` |
| `<!-- -->` | `<!-- Template: Router Provisioning / CPE / Cisco 891 -->` |
| none | _(no header)_ |

## Remote Git

Projects can optionally link to a remote Git repository. This enables pulling templates from a central source and pushing edits back.

See the Remote Git section in the project settings. Configure:
- **Remote URL** — HTTPS or SSH URL of the remote repo
- **Branch** — branch to track
- **Credential** — secret reference (e.g., `secret:git_token`) for HTTPS auth

Available actions: **Clone**, **Pull** (fast-forward only), **Push** (checks for divergence first).

## Project Parameters

`proj.*` parameters are injected into all templates in this project. Configure them via **Studio → Parameters** filtered by scope **Project**, or directly in the project editor.

## Git Sync

If template files were added directly to Git (outside the API), import them with:

```bash
POST /admin/git-sync/{project_id}
```

This scans the project's `git_path` for `.j2` files not yet in the database, creates DB records, and parses frontmatter to auto-register parameters.
