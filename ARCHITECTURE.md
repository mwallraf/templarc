# Templarc — Architecture & System Understanding

> This document captures the complete understanding of what Templarc is, how it works,
> and what it will look like when finished. It is the authoritative reference for
> anyone (or any AI assistant) joining the project mid-stream.

---

## 1. What Is Templarc?

Templarc is a **general-purpose template engine API**. Although the examples throughout this project use network equipment provisioning (routers, switches), the system is fully domain-agnostic. It can be used for:

- Network device configuration (Cisco IOS, Juniper JunOS, etc.)
- Server and cloud resource provisioning scripts
- Database setup and migration scripts
- Contract or document generation
- Any structured text output that benefits from parameterisation and version control

Its core job is to let engineers define reusable Jinja2 templates once and then allow non-expert operators to fill in a web form and generate correct, validated output.

### Target users

| Role | How they use Templarc |
|------|-----------------------|
| **Network/Systems Engineer (Admin)** | Writes `.j2` templates, defines parameters, maps remote data sources, organises the product catalog |
| **Operator / NOC** | Picks a product from the catalog, fills in the generated form, downloads the rendered output |
| **API consumer / automation** | Calls the REST API directly to render templates in CI/CD pipelines or orchestration systems |

### Target environment

A service provider internal platform — not SaaS, not multi-tenant. Single organisation,
LDAP-backed authentication, PostgreSQL + a local Git repo. Designed to run on a VM or
in Docker, not Kubernetes (though there's nothing stopping it).

---

## 2. Core Concepts

### 2.1 Three-Tier Parameter Scoping

This is the single most important concept in the system. Every parameter in Templarc
belongs to exactly one scope:

```
┌────────────────────────────────────────────────────────────────────┐
│  glob.*    Global scope — injected into every render, every project │
│            e.g. glob.company_ntp, glob.dns_server                   │
│            Defined in DB. Never in template files. Cannot be        │
│            overridden by anything below.                            │
├────────────────────────────────────────────────────────────────────┤
│  proj.*    Project scope — injected into all templates in one       │
│            project/environment.                                     │
│            e.g. proj.default_vrf, proj.mgmt_subnet                 │
│            Defined in DB per project. Cannot be overridden by       │
│            the template inheritance chain.                          │
├────────────────────────────────────────────────────────────────────┤
│  (none)    Template-local scope — defined in the YAML frontmatter   │
│            of a .j2 file. Visible only to that template and its     │
│            children. Can reference remote API data sources.         │
│            e.g. router.hostname, core.bandwidth_mb                  │
└────────────────────────────────────────────────────────────────────┘
```

**Resolution order (later wins, but glob/proj always win over template chain):**

```
  parent template params
      ↓ (child overrides)
  child template params       ← template-local chain merge
      ↓ (proj always wins)
  proj.* params
      ↓ (glob always wins)
  glob.* params
```

The API enforces naming conventions: `glob.*` prefix is reserved for global scope,
`proj.*` prefix for project scope, any other name for template-local scope.
Violations return HTTP 422.

### 2.2 Jinja2 Environment = Project

Each project (e.g. "Router Provisioning", "Server Installation") gets its own
`jinja2.Environment` instance. This enables:

- Project-scoped custom filters (e.g. a filter only meaningful for network templates)
- Isolated template namespace (no bleed-through between projects)
- `glob.*` and `proj.*` injected as environment globals

Environments are built lazily, cached in-process, and invalidated when the project's
parameters or config change.

### 2.3 Template Includes (content composition)

Beyond the catalog inheritance chain, template **bodies** can compose output using Jinja2's native `{% include %}` directive:

```jinja2
{% include "shared/banner.j2" %}
hostname {{ router.hostname }}
{% include "shared/ntp_block.j2" %}
```

Included files (fragments) are plain `.j2` files stored in the same Git repo, without YAML frontmatter. They are content-only building blocks — not catalog entries, not registered in the DB. The per-project `jinja2.Environment` is built with a `GitLoader` so includes resolve relative to the project's `git_path`. Fragments can be marked `is_fragment: true` in a minimal frontmatter block to distinguish them during Git sync.

This is separate from catalog inheritance. A template can both be a child of `cisco_base` (inheriting parameters) **and** use `{% include "shared/logging.j2" %}` (composing body content).

### 2.4 Template Inheritance (catalog hierarchy, not Jinja2 `extends`)

Templates form a tree for **organisation and parameter inheritance**:

```
CPE Base                    ← root (abstract, never rendered directly)
  └── Cisco                 ← intermediate (groups Cisco products)
        ├── Cisco 891       ← leaf (rendered by operators)
        └── Cisco ISR4K     ← leaf
  └── Juniper
        └── Juniper SRX     ← leaf
```

Each node in the tree is a `.j2` file in Git. When resolving parameters for
`Cisco 891`, the resolver walks the chain upward (`cisco_891 → cisco → cpe_base`)
and merges parameters child-first (child params override parent params with the same
name). `glob.*` and `proj.*` are injected on top of this merged set.

Operators only see **leaf templates** (those with no children) in the catalog.

### 2.5 Parameter Display Order

Parameters within a template form are rendered in `sort_order` sequence (per scope group). Admins control this via drag-and-drop in the Template Editor or via `PUT /parameters/{id}`. Each scope group (Global / Project / Template) has its own independent sort order.

### 2.6 Dual Source of Truth

| What | Where |
|------|-------|
| Template content (Jinja2 body + YAML frontmatter) | **Git** — read/write via GitPython |
| Parameter definitions, project config, secrets, render history | **PostgreSQL** |
| Data source configurations | **Git** (embedded in `.j2` frontmatter) |
| Secret credentials | **PostgreSQL** (encrypted) or environment variables or HashiCorp Vault |

The DB indexes templates by `git_path` but never duplicates content. Every render
stores the exact Git commit SHA so output is always reproducible.

### 2.7 Multi-Tenancy Design

An `organizations` table sits at the top of the hierarchy. Every `project`, `user`, and `secret` has an `organization_id` FK. `glob.*` parameters are scoped per organization (not truly global across all orgs in a shared instance).

```
Organization
  └── Project (with proj.* params)
        └── Template (with local params)
```

For single-org deployments, one default organization is seeded at startup. The API resolves the current organization from the authenticated user's JWT. Full multi-tenant isolation (separate schemas, row-level security) is not a Phase 1–6 goal, but the FK structure is there from the start to avoid a painful migration later.

### 2.8 Template File Format

```yaml
---
# YAML frontmatter — stripped before rendering
parameters:
  - name: router.hostname
    widget: text
    label: "Router Hostname"
    description: "FQDN of the router"
    required: true

  - name: core.bandwidth_mb
    widget: number
    label: "Uplink Bandwidth (Mbps)"
    required: true

data_sources:
  - id: netbox
    url: "https://netbox.company.com/api/dcim/devices/?name={{ router.hostname }}"
    auth: "secret:netbox_api"           # references a named secret in DB
    trigger: on_change:router.hostname  # re-fetch when this param changes
    on_error: warn                       # warn | block
    cache_ttl: 300                       # seconds
    mapping:
      - remote_field: "results[0].site.id"
        to_parameter: router.site_id
        auto_fill: true                  # pre-fill the form field
      - remote_field: "results[0].device_role.name"
        to_parameter: router.role
        widget_override: readonly        # show the value but don't let user edit
---

hostname {{ router.hostname }}
ntp server {{ glob.ntp_server }}
ip vrf {{ proj.default_vrf }}
bandwidth {{ core.bandwidth_mb | mb_to_kbps }}
```

The Jinja2 body (after the closing `---`) is what gets rendered. Custom filters
like `mb_to_kbps` are registered per-project in the environment factory.

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         React Frontend                           │
│  Catalog → Template select → Dynamic Form → Render output        │
│  Admin: Template editor (Monaco), Parameter manager, History     │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS / JSON
┌────────────────────────────▼─────────────────────────────────────┐
│                       FastAPI (Python 3.12)                      │
│                                                                  │
│  Routers:  /catalog  /templates  /parameters  /render  /auth    │
│                                                                  │
│  Services:                                                        │
│   parameter_resolver   ← walks inheritance chain, merges params  │
│   datasource_resolver  ← async fetches remote APIs, JSONPath     │
│   environment_factory  ← builds/caches per-project Jinja2 envs   │
│   template_renderer    ← binds params, renders, stores history   │
│   git_service          ← reads/writes .j2 files via GitPython    │
│   jinja_parser         ← AST-extracts variable refs from .j2     │
│                                                                  │
│  Core:                                                           │
│   auth.py    ← JWT issuance + LDAP bind + local user fallback   │
│   secrets.py ← resolves env/vault/db secrets for data sources   │
└──────────┬──────────────────────────┬────────────────────────────┘
           │                          │
    ┌──────▼──────┐            ┌──────▼──────┐
    │ PostgreSQL  │            │  Git repo   │
    │             │            │  (local)    │
    │ orgs        │            │  .j2 files  │
    │ projects    │            │  fragments  │
    │ templates   │            │  commit log │
    │ parameters  │            └─────────────┘
    │ secrets     │
    │ users       │
    │ render_hist │
    └─────────────┘
```

### Key service dependencies (sequential build order matters)

```
parameter_resolver
    ↑ depends on
datasource_resolver ← needs parameter_resolver result
    ↑ depends on
environment_factory ← builds Jinja2 env before rendering
    ↑ depends on
template_renderer   ← orchestrates all of the above
```

---

## 4. Data Flow Diagrams

### 4.1 Admin: Creating a Template

```
Admin opens Template Editor
    │
    ├─→ Select project (GET /projects)
    ├─→ (optionally) Select parent template (GET /projects/{id}/templates)
    │
    ├─→ Write Jinja2 body in Monaco editor
    │       Jinja2 AST parser highlights unregistered variables in real-time
    │       (GET /templates/{id}/variables shows registered vs. unregistered)
    │
    ├─→ Define parameters via drag-drop panel:
    │       - Drag existing parameter from registry → inserts {{ param.name }} at cursor
    │       - Or create new parameter inline (name, widget, label, required, options)
    │       - Parameters stored in DB (POST /parameters)
    │
    ├─→ Add data_sources via form:
    │       - URL (with {{ param.name }} interpolation)
    │       - Auth → picks from secret registry
    │       - trigger: on_load | on_change:param_name
    │       - JSONPath mapping → which remote field prefills which local param
    │       (data sources stored in YAML frontmatter, not DB)
    │
    ├─→ "Preview Form" → calls GET /templates/{id}/resolve-params
    │       Shows what operators will see, with data sources pre-fetched
    │
    └─→ "Save" → PUT /templates/{id}
            Git service writes .j2 to disk, commits (author = admin username)
            Returns new commit SHA → shown in success toast
```

### 4.2 Operator: Generating Output

```
Operator opens Catalog (GET /catalog/{project_slug})
    │
    ├─→ Browses product tree, picks leaf template (e.g. "Cisco 891")
    │
    ├─→ System calls GET /templates/{id}/resolve-params
    │       parameter_resolver walks inheritance chain:
    │           cisco_891 params ← cisco_base params ← cpe_base params
    │           (child overrides parent for same-named params)
    │       + proj.* params for this project
    │       + glob.* params (global)
    │       = full merged parameter list
    │
    │       datasource_resolver runs all on_load data sources in PARALLEL:
    │           fetches remote APIs (e.g. NetBox, IPAM)
    │           applies JSONPath mappings
    │           auto-fills form fields, marks some as readonly
    │           caches results by URL+params key
    │
    │       Returns: FormDefinition (enriched parameter list)
    │
    ├─→ Frontend renders DynamicForm:
    │       Groups params by scope: Global / Project / Template
    │       Shows label, help text, required indicator
    │       Renders correct widget per widget_type
    │       Auto-filled fields show values; readonly fields are disabled
    │
    ├─→ Operator fills in remaining fields
    │       When a field changes:
    │           POST /templates/{id}/on-change/{param_name}
    │           Re-runs relevant data sources (trigger: on_change)
    │           Updates dependent field options/prefills
    │           Cascading triggers are loop-safe (visited set)
    │
    └─→ Operator clicks "Generate"
            POST /templates/{id}/render { params: {...} }
            (optionally ?persist=false for ad-hoc/ephemeral render — no DB write)
            │
            ├─→ Validates all required params are provided
            ├─→ Gets Jinja2 environment for project (cached)
            ├─→ Reads .j2 from Git, strips YAML frontmatter
            ├─→ Renders: env.from_string(body).render(**full_context)
            │       Any {% include "fragment.j2" %} resolved via GitLoader
            ├─→ Prepends metadata header to output:
            │       # Generated by: jsmith
            │       # Date: 2025-03-15T14:22:01Z
            │       # Template: Cisco 891, Git SHA: a3f7c21d
            │       # Parameters: router.hostname=..., glob.ntp=...
            │       (comment style configurable per project: #, !, //, <!-- , or none)
            ├─→ If persist=true: stores in render_history:
            │       template_id, git_sha, resolved_parameters (JSONB),
            │       raw_output (including header), rendered_by, rendered_at
            └─→ Returns rendered text → shown in code block, copyable
```

### 4.3 Re-render from History

```
Operator opens History → finds a previous render
    │
    ├─→ "Re-render with same parameters"
    │       POST /render-history/{id}/re-render
    │       Uses stored JSONB params, renders with current Git HEAD
    │       (or same SHA if you want byte-for-byte reproduction)
    │
    ├─→ "Re-render on different template"
    │       Same params, different template_id
    │       Useful when upgrading from Cisco 891 to Cisco ISR4K
    │
    └─→ "Re-open form"
            Navigates to /render/:templateId
            Pre-fills form with stored parameter values
            Operator can adjust and re-render
```

---

## 5. Feature Inventory (When Finished)

### 5.1 Backend API (FastAPI)

| Endpoint group | Key capabilities |
|----------------|-----------------|
| `/catalog` | Project list, template tree (nested), leaf-template product catalog with breadcrumbs |
| `/templates` | Full CRUD, Git write-on-save, variable extraction, inheritance chain inspection |
| `/parameters` | Full CRUD with scoping enforcement, derived parameter support, option conditions |
| `/render` | Form definition generation, on-change re-resolution, render (persist or ephemeral), history, re-render |
| `/auth` | LDAP login, local user fallback, JWT issuance, admin-only gating |
| `/secrets` | Named credential management (env/vault/db types), admin-only |
| `/admin/filters` | Custom Jinja2 filter registration with sandboxed Python execution |
| `/admin/objects` | Custom Jinja2 context object registration |
| `/audit-log` | Full write-operation audit trail with JSONB diffs |

### 5.2 Core Services

| Service | What it does |
|---------|-------------|
| `parameter_resolver` | Walks inheritance chain, merges params child-first, injects glob/proj, runs derived params |
| `datasource_resolver` | Async-parallel HTTP fetches, JSONPath mapping, caching, cascade trigger loop prevention |
| `environment_factory` | Per-project Jinja2 environment with globals, built-in + custom filters, lazy + cached |
| `template_renderer` | Orchestrates resolve → enrich → validate → render → prepend header → store history |
| `git_service` | Read/write/commit `.j2` files, frontmatter parsing, file history, Git sync/import |
| `jinja_parser` | AST-based variable reference extraction (used for admin tooling) |
| `secrets` | Resolves `env:`, `vault:`, `secret:` refs for data source auth |

### 5.3 Built-in Jinja2 Filters

| Filter | Purpose |
|--------|---------|
| `mb_to_kbps` | Bandwidth unit conversion |
| `mb_to_bps` | Bandwidth unit conversion |
| `cidr_to_wildcard` | Network mask conversion for ACLs |
| `ip_to_int` | IP address arithmetic |
| `int_to_ip` | IP address arithmetic |

Plus custom filters/objects registered per-project via the admin API.

### 5.4 Frontend (React)

| Page/Component | What it provides |
|----------------|-----------------|
| `/catalog` | Project browser |
| `/catalog/:slug` | Template selector with hierarchy tree |
| `/render/:id` | **DynamicForm** — the primary operator interface |
| `/history` | Searchable render history list |
| `/history/:id` | Render detail with parameter table, output, re-render options |
| `/admin/templates` | **Template Editor** — Monaco + param drag-drop + data source builder |
| `/admin/parameters` | Parameter registry manager (CRUD, scope grouping, derived param builder) |
| `/admin/secrets` | Secret management |
| `/admin/filters` | Custom filter code editor with Monaco + sandbox test |
| `/login` | LDAP / local auth form |

### 5.5 Security & Ops

- JWT auth on all endpoints; LDAP primary, local user fallback
- Admin-only gating on all write operations (templates, parameters, secrets, filters)
- Rate limiting: 100 req/min general, 10 req/min render, 5 req/min login
- Data source URL validation: private IP ranges blocked by default
- Custom filter sandbox: RestrictedPython, no imports, 100ms timeout
- Audit log table for all write operations
- CORS configurable via env var
- Startup health checks (DB, Git, template repo)

---

## 6. Build Phases

The project is built in six sequential phases:

### Phase 1 — Foundation
DB schema, SQLAlchemy models, Alembic migrations, FastAPI skeleton, Docker Compose.
**Deliverable:** `GET /health` works, `/docs` shows OpenAPI UI, DB migrated.

### Phase 2 — Parameter System
Parameter CRUD with scoping enforcement, derived parameters (formula + conditional lookup),
the core `parameter_resolver` service with full inheritance chain walking.
**Deliverable:** Parameter API works; resolver correctly merges 3-level chain.

### Phase 3 — Template Management & Git Backend
Git service (read/write/commit), Jinja2 AST parser, Template + Project CRUD API,
product catalog endpoint with breadcrumbs, template tree as nested structure,
Git sync/import endpoint for templates created directly in Git.
**Deliverable:** Create template → saved to Git; catalog returns leaf templates; Git sync imports externally-added files.

### Phase 4 — Rendering Engine
Secrets service, data source resolver (async parallel, caching, cascade triggers),
per-project Jinja2 environment factory (with GitLoader for `{% include %}` fragments),
full render pipeline with metadata header prepend and history storage.
Ad-hoc/ephemeral rendering (`?persist=false`) skips history for previews.
**Deliverable:** End-to-end render: form → fill → render → header prepended → output stored.

### Phase 5 — React Frontend
Vite + React 18 + TypeScript, DynamicForm component (all widget types, on-change triggers),
Template Editor (Monaco + drag-drop), Render History UI, Parameter admin.
**Deliverable:** Full operator workflow in browser; admin can create/edit templates.

### Phase 6 — Auth, Hardening & Polish
LDAP integration, JWT middleware, RBAC, rate limiting, audit log, custom filter sandbox,
OpenAPI documentation polish, README.
**Deliverable:** Production-ready; LDAP users can log in; audit trail active.

---

## 7. Key Design Decisions

### Why Git for template storage?
Templates benefit from version history, diff-ability, and the ability to re-render
against an exact historical commit SHA. Git gives this for free. It also means template
files can be edited outside the UI (e.g. in a code editor or reviewed in a PR).

### Why a single `parameters` table with scope discriminator?
Avoids three separate tables and the join complexity for the resolver. Enforced by a
CHECK constraint and three partial unique indexes. The trade-off is a slightly complex
schema with nullable FKs — but the resolver queries are simple (`WHERE scope = 'template'
AND template_id = ?`).

### Why not Jinja2 `extends` for template inheritance?
Jinja2 `extends` requires the template to know its parent at render time and uses
block/override mechanics. Templarc's inheritance is about **parameter inheritance and
catalog organisation** — a child template may not extend the parent's Jinja2 body at all,
it just inherits the parameter definitions. The resolver walks the chain in Python, not
inside Jinja2.

### Why data sources server-side only?
Credentials (API keys, tokens) never leave the backend. The UI never sees a secret value.
The frontend calls `/resolve-params` and receives already-enriched parameter metadata
(with prefilled values and option lists) — it never makes direct calls to NetBox, IPAM, etc.

### Why per-project Jinja2 environments?
Isolation: a filter registered for "Router Provisioning" doesn't pollute "Server
Installation". It also allows different projects to have different context globals without
any parameter naming conflicts.

### Why LDAP + local user fallback?
LDAP is the enterprise standard for this environment. Local users (`is_ldap=False`) exist
for development/testing environments that don't have an LDAP server available.

### Why in-memory cache for data source results (not Redis)?
Simplicity for v1. The cache key is `url_rendered + sorted_params`, TTL from the data
source config. A comment in `datasource_resolver.py` marks the swap point for Redis.
Acceptable because: (a) renders are user-triggered, not high-frequency, (b) the app
is single-process in the target environment.

### Why is the metadata header part of `raw_output` (not a separate field)?
The rendered output is meant to be self-documenting — if someone copies the file off a
router or out of a ticket, the provenance travels with it. Storing it as part of
`raw_output` means the stored artifact is exactly what the operator received. A separate
`rendered_output_body` field would split what is conceptually one thing.

### Why fragment files (for `{% include %}`) are NOT DB-registered templates
Fragments are content primitives, not products. They have no parameters, no inheritance
chain, no form, and should never appear in the operator catalog. Keeping them Git-only
(with an optional `is_fragment: true` frontmatter marker) prevents catalog pollution
while still making them discoverable via Git sync's drift report.

### Why `organizations` from day one even though multi-tenancy is low priority
Adding `organization_id` FK to six tables later — after data exists — requires a painful
migration and application audit. Adding it now costs one nullable FK per table and a
seeded default org. The API ignores it in single-org mode. The payoff is zero migration
pain if multi-tenancy is needed in the future.

---

## Implementation Status

### Phase 1 — Foundation (Complete)

**What was built:**

| Item | Status | Notes |
|------|--------|-------|
| `requirements.txt` | Done | fastapi, uvicorn[standard], sqlalchemy[asyncio], asyncpg, alembic, pydantic-settings, pydantic[email], python-dotenv |
| `api/config.py` | Done | pydantic-settings `Settings` class; `async_database_url` property auto-converts `postgresql://` to `postgresql+asyncpg://` |
| `api/database.py` | Done | Async engine, `AsyncSessionLocal` with `expire_on_commit=False`, `get_db()` FastAPI dependency |
| SQLAlchemy models | Done | 8 models in `api/models/`; all relationships use `lazy="raise"` |
| Alembic setup | Done | `alembic.ini` + `migrations/env.py` using the async pattern (`asyncio.run` + `connection.run_sync`) |
| `api/main.py` | Done | FastAPI app with lifespan context manager, CORS middleware, 5 stub routers, `GET /health` |
| `docker-compose.yml` | Done | `postgres:15-alpine` + `api` service with `DATABASE_URL` override |
| `Dockerfile` | Done | `uv`-based image, `uvicorn` entrypoint |
| `.env` | Done | `DATABASE_URL` set to `postgresql://` (sync, for external tooling) |

**Deliverable met:** `GET /health` returns 200, `/docs` shows OpenAPI UI, `alembic upgrade head` runs cleanly.

**Key implementation decisions:**

1. **`lazy="raise"` on all ORM relationships.** Async SQLAlchemy silently hangs if a lazy relationship is accessed outside a session. `lazy="raise"` converts that to an immediate `MissingGreenlet` error at development time, forcing explicit `selectinload`/`joinedload` at every call site. This is a deliberate strictness choice.

2. **`naming_convention` on `Base.metadata`.** Alembic requires deterministic constraint names to emit `DROP CONSTRAINT` reliably across databases. Without this, auto-generated names differ between environments and future migrations fail. Defined once in `database.py`, inherited by all models.

3. **Partial unique indexes defined as `Index()` objects outside the model class body.** SQLAlchemy does not support `postgresql_where=` inside `UniqueConstraint` in the class body. These three indexes (one per parameter scope) are declared as module-level `Index()` objects in `api/models/parameter.py`.

4. **`PgEnum(create_type=True)` for all PostgreSQL enum columns.** Ensures Alembic emits `CREATE TYPE` DDL automatically. Without this flag, the type must be created manually before the migration runs.

5. **`sys.path.insert` in `migrations/env.py`.** Makes the `api` package importable from any working directory so `alembic upgrade head` works regardless of where it is invoked (project root, `api/`, CI runner, Docker).

6. **`DATABASE_URL` in `.env` uses the sync `postgresql://` scheme.** `config.py` converts it to `postgresql+asyncpg://` for the async engine. This lets external tools (MCP, psql, DB GUI clients) read the same `.env` without needing driver-specific URI syntax.

7. **`uv` chosen for Python environment management.** Faster than `pip`, deterministic installs, no virtualenv activation required in Docker. The `Dockerfile` uses `uv pip install` instead of `pip install`.

**Phases 2–6:** Not yet started. See section 6 for the full phase plan.

---

## 8. What the Finished System Enables

For a network engineer, this means:

1. Write a Cisco 891 Jinja2 config template once with all edge cases handled.
2. Hang it in the product catalog under `CPE → Cisco → Cisco 891`.
3. Define 15 parameters, 3 of which auto-fill from NetBox when the hostname is typed.
4. A NOC engineer opens the browser, picks "Cisco 891", fills in 12 fields (3 are pre-filled),
   hits Generate, and gets a validated, correct device configuration.
5. The output is stored forever with the exact parameter values used and the exact Git SHA
   of the template — making it auditable and reproducible.
6. Six months later, someone can open that render, see exactly what was generated and why,
   and re-render it for a new device with one click.

For automation teams:
- The same workflow is available via REST API — CI/CD pipelines can call `/render` directly.
- The parameter resolver handles all the scoping complexity; the caller just provides
  the template-local values.
