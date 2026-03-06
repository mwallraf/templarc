# Templarc — Project Context for Claude Code

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.  For the API python code this is not needed.

## What is Templarc?
Templarc is a **general-purpose template engine API** for any provisioning, operational, or text-generation task. Although examples in this project often use network equipment provisioning (routers, switches), the system is fully domain-agnostic — it can be used equally for server deployments, cloud resource configurations, database setup scripts, contract document generation, or any other structured text output. It provides a product catalog of Jinja2 templates with a parameter registry, inheritance chains, remote API data sources, dynamic form generation, and full render history.

## Core Concepts (READ THIS FIRST)

### Three-Tier Parameter Scoping
Parameters are scoped at three levels — this is fundamental to the entire architecture:

- `glob.*` — Global parameters (e.g. `glob.company_ntp`). Injected into **every** Jinja2 environment. Defined in the DB, never in template files. Cannot be overridden by templates.
- `proj.*` — Project parameters (e.g. `proj.default_vrf`). Injected into all templates within a specific project/environment. Defined per-project in the DB.
- `(no prefix)` — Template-local parameters. Defined in the YAML frontmatter of each `.j2` template file. May include remote API data sources.

### Jinja2 Environment = Project
Each project (e.g. "Router Provisioning", "Server Installation") maps to its own `jinja2.Environment` instance. This enables project-scoped filters, custom objects, and isolated template namespaces.

### Template Inheritance (NOT Jinja2 extends)
Templates form a catalog hierarchy for organization and parameter inheritance:
```
CPE (base)
  └── Product X
        └── Cisco
              └── Cisco 891  ← leaf template
```
Each child inherits parent's local parameters but can override them. `glob.*` and `proj.*` are NOT part of this chain — they're injected separately.

### Template Includes (Jinja2 `{% include %}`)
Beyond the catalog inheritance chain, template **bodies** can use Jinja2's native `{% include %}` directive to compose output from shared fragments stored as `.j2` files in the same repository:
```jinja2
{% include "shared/banner.j2" %}
hostname {{ router.hostname }}
{% include "shared/ntp_block.j2" %}
```
The per-project `jinja2.Environment` is built with a `GitLoader` pointed at the project's `git_path`, so included files are resolved relative to that path. Included fragments are plain `.j2` files without frontmatter — they are content-only building blocks, not catalog entries, and are not registered in the DB as templates. Admins manage them directly in Git.

### Parameter Display Order
Parameters within a template form are rendered in `sort_order` sequence (ascending integer, 0-based). The `sort_order` column exists on the `parameters` table. Admins can reorder parameters via a drag-and-drop interface in the Template Editor or via `PUT /parameters/{id}` with a new `sort_order`. Within each scope group (Global / Project / Template) the sort_order is independent.

### Template File Format
Templates are `.j2` files stored in Git with YAML frontmatter:
```yaml
---
parameters:
  - name: router.hostname
    widget: text
    label: "Router Hostname"
    description: "FQDN of the router"
    required: true

data_sources:
  - id: netbox
    url: "https://netbox.company.com/api/dcim/devices/?name={{ router.hostname }}"
    auth: "secret:netbox_api"
    trigger: on_change:router.hostname
    on_error: warn
    cache_ttl: 300
    mapping:
      - remote_field: "results[0].site.id"
        to_parameter: router.site_id
        auto_fill: true
      - remote_field: "results[0].device_role.name"
        to_parameter: router.role
        widget_override: readonly
---

hostname {{ router.hostname }}
ntp server {{ glob.ntp_server }}
ip vrf {{ proj.default_vrf }}
bandwidth {{ core.bandwidth_mb | mb_to_kbps }}
```

### DB is Source of Truth for Metadata; Git is Source of Truth for Template Content
- Template `.j2` files live in Git (read/write via GitPython)
- Parameter definitions, project config, secrets, render history → PostgreSQL
- The DB indexes Git templates but does not duplicate their content
- Templates created directly in Git (outside the API) can be imported via `POST /admin/git-sync/{project_id}`, which scans the project's `git_path` for `.j2` files not yet registered in the DB and creates DB records for them. Frontmatter is parsed to auto-register parameters.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Python | always use uv |
| API | FastAPI (Python 3.12+) |
| ORM | SQLAlchemy 2.x async + Alembic |
| DB | PostgreSQL 15+ |
| Templating | Jinja2 with custom filters/extensions |
| Template storage | Git repo via GitPython |
| Auth | JWT (python-jose) + LDAP (python-ldap / ldap3) |
| HTTP client | httpx (async) |
| JSON path | jsonpath-ng |
| Validation | Pydantic v2 |
| Frontend | React 18 + Vite + React Hook Form + TailwindCSS |
| Testing | pytest + pytest-asyncio + httpx test client |

## Project Layout
```
templarc/
├── CLAUDE.md                    ← you are here
├── api/
│   ├── main.py                  ← FastAPI app factory
│   ├── config.py                ← Settings (pydantic-settings)
│   ├── database.py              ← Async engine + session
│   ├── models/                  ← SQLAlchemy ORM models
│   │   ├── organization.py
│   │   ├── parameter.py
│   │   ├── template.py
│   │   ├── project.py
│   │   ├── render_history.py
│   │   └── secret.py
│   ├── schemas/                 ← Pydantic request/response schemas
│   ├── routers/                 ← FastAPI routers (one per domain)
│   │   ├── catalog.py
│   │   ├── parameters.py
│   │   ├── templates.py
│   │   ├── render.py
│   │   └── auth.py
│   ├── services/                ← Business logic (no FastAPI deps)
│   │   ├── parameter_resolver.py    ← Core: resolve full param set for a template
│   │   ├── environment_factory.py   ← Build/cache per-project Jinja2 environments
│   │   ├── datasource_resolver.py   ← Fetch remote APIs, apply JSONPath mappings
│   │   ├── template_renderer.py     ← Bind params + render, store history
│   │   ├── git_service.py           ← Read/write .j2 files from Git
│   │   └── jinja_parser.py          ← Extract variable refs from template AST
│   └── core/
│       ├── auth.py              ← JWT + LDAP integration
│       └── secrets.py           ← Secret resolution (env/vault/db)
├── migrations/                  ← Alembic
├── templates_repo/              ← Git-backed .j2 files (submodule or local)
├── frontend/                    ← React app
│   ├── src/
│   │   ├── components/
│   │   │   ├── DynamicForm/     ← Renders form from parameter metadata
│   │   │   ├── TemplateEditor/  ← Template creation/edit with param drag-drop
│   │   │   └── RenderHistory/
│   │   ├── pages/
│   │   └── api/                 ← API client (axios/fetch wrappers)
├── tests/
│   ├── unit/
│   └── integration/
└── docker-compose.yml
```

## Critical Design Rules

1. **Parameter scoping is enforced by the API** — the `glob.` prefix is reserved for global-scope params only. The API rejects attempts to create a template-local param named `glob.*` or `proj.*`.
2. **`glob.*` and `proj.*` cannot be overridden by template inheritance** — the resolver injects them after the inheritance chain merge, always winning.
3. **Data sources resolve server-side** — credentials never leave the backend. The UI calls the API's `/templates/{id}/resolve-params` endpoint, which returns enriched parameter metadata (already including remote API values as `options` or `prefill`).
4. **Cascading on_change triggers must be loop-safe** — use a visited set in `datasource_resolver.py`.
5. **Each project gets its own `jinja2.Environment` instance** — constructed lazily, cached in-process, invalidated on project config change.
6. **Template content is the `.j2` file** — YAML frontmatter is stripped before rendering. Included fragment files (`{% include %}`) are also plain `.j2` files without frontmatter.
7. **Render history stores**: template ID + git commit SHA + resolved parameters + raw output + timestamp + user.
8. **Rendered output includes a metadata header** — by default, every rendered output is prepended with a structured comment block containing: template name + breadcrumb, git SHA, rendered by, rendered at, and all resolved parameter values. The format is configurable per project (comment style: `#`, `!`, `//`, XML comment, or none). This header is part of `raw_output` in render_history.
9. **Ad-hoc / ephemeral rendering** — `POST /templates/{id}/render` accepts `?persist=false` to skip render_history storage. This is for quick previews, test renders, or lightweight one-shot use cases. The response is identical but no DB write occurs.
10. **Multi-tenancy is a DB-level concern** — an `organizations` table sits above `projects`. Every `project`, `user`, and `secret` has an `organization_id` FK. `glob.*` parameters are scoped per organization (not truly global across all orgs). The API resolves organization from the authenticated user's JWT claim. Full multi-tenancy is not a Phase 1–6 priority but the schema must support it from day one to avoid a painful migration later.

## Sub-Agent Routing Rules (for Claude Code)

**Parallel dispatch** (all conditions met):
- 3+ unrelated tasks, no shared state, clear file boundaries

**Sequential dispatch** (any condition triggers):
- DB schema changes before any code that uses them
- Parameter resolver before datasource resolver (it depends on it)
- Environment factory before template renderer

**Background dispatch**:
- Research, analysis, test generation (not file modifications)

## Python Environment
Always use `uv` for Python environment management. Never use raw `pip` or `python -m venv`.

```bash
# First-time setup
uv venv .venv
source .venv/bin/activate      # macOS/Linux
# .venv\Scripts\activate       # Windows

# Install / sync dependencies
uv pip install -r requirements.txt
```

If `uv` is not installed: `curl -LsSf https://astral.sh/uv/install.sh | sh`

## Running the Project
```bash
# API (from project root, venv active)
uvicorn api.main:app --reload

# Frontend
cd frontend && npm run dev

# Tests
uv run pytest tests/ -v

# DB migrations
uv run alembic upgrade head
```

## Environment Variables
```
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/templarc
SECRET_KEY=<jwt-secret>
TEMPLATES_REPO_PATH=./templates_repo
LDAP_SERVER=ldap://your-ldap-server
LDAP_BASE_DN=dc=company,dc=com
```
read them from .env