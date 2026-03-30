---
title: Architecture
sidebar_position: 2
---

# Architecture

## System Overview

Templarc consists of three main layers: a React frontend, a FastAPI backend, and dual persistence (PostgreSQL + Git).

```
Browser
  │
  ▼
React SPA (Vite, port 5173 dev / nginx prod)
  │  REST API calls (Bearer JWT or X-API-Key)
  ▼
FastAPI Application (uvicorn, port 8000)
  ├── Routers  (HTTP layer, auth deps)
  ├── Services (business logic, no FastAPI deps)
  │   ├── ParameterResolver   → resolves full param set for a template
  │   ├── EnvironmentFactory  → builds/caches per-project Jinja2 environments
  │   ├── DatasourceResolver  → fetches remote APIs, applies JSONPath mappings
  │   ├── TemplateRenderer    → binds params + renders, stores history
  │   ├── GitService          → reads/writes .j2 files from Git
  │   └── JinjaParser         → extracts variable refs from template AST
  ├── Models   (SQLAlchemy ORM)
  ├── Schemas  (Pydantic v2)
  └── Core     (auth, secrets, rate limiting)
  │
  ├── PostgreSQL 15+ (metadata, auth, history, secrets, audit)
  └── Git Repository (template .j2 files, fragments, features)
```

## Three-Tier Parameter Scoping

This is the most important architectural concept. Every parameter in the system has a scope:

```
Priority (highest → lowest)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
glob.*       Org-level constants (injected last, always win)
proj.*       Project-level defaults (injected after inheritance chain)
<no prefix>  Template-local params (resolved via inheritance chain)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Resolution order in `ParameterResolver`:**

1. Walk the template's parent chain (leaf → … → root), collecting template-local params
2. Apply child overrides over parent defaults (child wins)
3. Inject `proj.*` params from the project record (these override template-local values)
4. Inject `glob.*` params from the org record (these override everything)

The final merged dict is what the Jinja2 environment receives.

## Per-Project Jinja2 Environment

Each project gets its own `jinja2.Environment` instance:

```python
env = jinja2.Environment(
    loader=GitLoader(git_path),   # resolves {% include %} from Git
    undefined=jinja2.StrictUndefined,
)
env.filters.update(BUILTIN_FILTERS)           # network filters etc.
env.filters.update(project_custom_filters)    # admin-defined filters
env.globals.update(project_custom_objects)    # admin-defined objects
```

Environments are:
- **Lazily constructed** on first use
- **Cached in-process** per project ID
- **Invalidated** when project config changes

## Render Pipeline

```
POST /templates/{id}/render
  │
  ├─1─ ParameterResolver.resolve(template_id, user_params)
  │    → returns merged {param_name: value} dict
  │
  ├─2─ DatasourceResolver.resolve(template, params)
  │    → fetches on_load data sources, enriches params
  │
  ├─3─ EnvironmentFactory.get(project_id)
  │    → returns cached jinja2.Environment
  │
  ├─4─ env.get_template(template.git_path)
  │    → loads .j2 body from Git, strips YAML frontmatter
  │
  ├─5─ template.render(**params)
  │    → Jinja2 renders body with merged params
  │
  ├─6─ prepend metadata header
  │
  └─7─ (if persist=True) RenderHistory.save(...)
       → stores template_id, git_sha, params, output, user, timestamp
```

## Template File Format

Templates are `.j2` files in Git with YAML frontmatter:

```
---
parameters:
  - name: router.hostname
    widget: text
    label: "Router Hostname"
    required: true

data_sources:
  - id: netbox
    url: "https://netbox.company.com/api/dcim/devices/?name={{ router.hostname }}"
    auth: "secret:netbox_api"
    trigger: on_change:router.hostname
    mapping:
      - remote_field: "results[0].site.id"
        to_parameter: router.site_id
        auto_fill: true
---

hostname {{ router.hostname }}
ntp server {{ glob.ntp_server }}
```

The YAML block above the second `---` is parsed by `JinjaParser` to extract parameters and data source definitions. The template body below is what Jinja2 renders.

## Multi-Tenancy

Every DB table has an `organization_id` FK. The API resolves the org from the JWT's `org_id` claim on every request. Resources from different orgs are never mixed.

## Audit Log

Every write operation (POST/PUT/PATCH/DELETE) is logged to the `audit_log` table with user, timestamp, resource type/ID, and a JSONB changes snapshot.
