# Templarc

**Templarc** is a general-purpose template engine API for provisioning, operational, and text-generation tasks. It provides a product catalog of Jinja2 templates with a parameter registry, inheritance chains, remote API data sources, dynamic form generation, and full render history.

Although the examples in this project often use network equipment provisioning (routers, switches), the system is fully domain-agnostic — it works equally for server deployments, cloud resource configurations, database setup scripts, contract documents, or any other structured text output.

---

## Quick Start

### Docker Compose

```bash
git clone <repo-url> templarc
cd templarc
cp .env.example .env          # edit credentials
docker compose up -d
```

The API starts at `http://localhost:8000`. Visit:
- **Swagger UI** — http://localhost:8000/docs
- **ReDoc** — http://localhost:8000/redoc
- **OpenAPI JSON** — http://localhost:8000/openapi.json
- **Health check** — http://localhost:8000/health

### Local Development

```bash
# Python environment (always use uv)
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt

# Database
uv run alembic upgrade head

# API (auto-reload)
uvicorn api.main:app --reload

# Frontend
cd frontend && npm install && npm run dev

# Tests
uv run pytest tests/ -v
```

### Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@localhost/templarc` | PostgreSQL connection string |
| `SECRET_KEY` | *(random 32+ chars)* | JWT signing key |
| `TEMPLATES_REPO_PATH` | `./templates_repo` | Path to the Git-backed `.j2` file store |
| `LDAP_SERVER` | `ldap://ldap.company.com` | LDAP server URL (leave blank for local auth) |
| `LDAP_BASE_DN` | `dc=company,dc=com` | LDAP search base |
| `LDAP_ADMIN_GROUP` | `cn=admins,ou=groups,dc=company,dc=com` | LDAP group for admin role |

---

## Key Concepts

### Three-Tier Parameter Scoping

Parameters are resolved at three scopes, applied in this order:

| Prefix | Scope | Example | Defined via |
|--------|-------|---------|-------------|
| `glob.*` | Organization-wide | `glob.ntp_server` | `POST /parameters` (scope=global) |
| `proj.*` | Project-wide | `proj.default_vrf` | `POST /parameters` (scope=project) |
| *(none)* | Template-local | `router.hostname` | `.j2` YAML frontmatter |

`glob.*` and `proj.*` values are injected **after** template-local resolution and cannot be overridden by templates.

### Template Catalog Hierarchy

Templates form a tree used for organization and parameter inheritance:

```
Router Provisioning (project)
  └── CPE (base template)
        └── Cisco
              └── Cisco 891   ← leaf template users select
```

Each child inherits its parent's template-local parameters and may override them. This hierarchy is **not** Jinja2's `{% extends %}` — it is a catalog concept managed by the API.

### Template File Format

Templates are `.j2` files stored in Git with YAML frontmatter:

```yaml
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
    on_error: warn
    mapping:
      - remote_field: "results[0].site.id"
        to_parameter: router.site_id
        auto_fill: true
---

hostname {{ router.hostname }}
ntp server {{ glob.ntp_server }}
ip vrf {{ proj.default_vrf }}
```

### Remote Data Sources

Data sources fetch external APIs (e.g. NetBox, CMDB) server-side at form-load time or when a parameter changes. Credentials are resolved from secrets — they never leave the backend.

### Render History

Every render stores: template ID, git commit SHA, resolved parameters, raw output, rendered-by user, and timestamp. Re-renders replay stored parameters against the current `.j2` file content.

---

## API Overview

### Authentication

All endpoints require a JWT Bearer token.

```bash
# Get a token
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secret"}' | jq -r .access_token)

AUTH="-H \"Authorization: Bearer $TOKEN\""
```

---

### Common Workflows

#### Browse the template catalog

```bash
# List all projects
curl -s http://localhost:8000/catalog/projects $AUTH | jq .

# Browse the product catalog for a project (by slug)
curl -s http://localhost:8000/catalog/router_provisioning $AUTH | jq .
```

#### Render a template

```bash
# 1. Get the enriched parameter form for template ID 5
curl -s http://localhost:8000/templates/5/resolve-params $AUTH | jq .

# 2. Render (persist=true stores to render history)
curl -s -X POST http://localhost:8000/templates/5/render $AUTH \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "router.hostname": "edge-01.dc.company.com",
      "router.loopback": "10.0.0.1"
    },
    "notes": "Production push"
  }' | jq .output

# 3. Ephemeral preview (no history written)
curl -s -X POST "http://localhost:8000/templates/5/render?persist=false" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"params": {"router.hostname": "test-router"}}' | jq .output
```

#### Manage templates (admin)

```bash
# Create a project
curl -s -X POST http://localhost:8000/catalog/projects $AUTH \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": 1,
    "name": "router_provisioning",
    "display_name": "Router Provisioning",
    "output_comment_style": "!"
  }'

# Create a template
curl -s -X POST http://localhost:8000/templates $AUTH \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 1,
    "name": "cisco_891",
    "display_name": "Cisco 891",
    "content": "---\nparameters:\n  - name: router.hostname\n    widget: text\n    required: true\n---\nhostname {{ router.hostname }}\n"
  }'

# Import templates added directly in Git
curl -s -X POST http://localhost:8000/admin/git-sync/1 $AUTH
```

#### Register a global parameter

```bash
curl -s -X POST http://localhost:8000/parameters $AUTH \
  -H "Content-Type: application/json" \
  -d '{
    "name": "glob.ntp_server",
    "scope": "global",
    "organization_id": 1,
    "widget_type": "text",
    "label": "NTP Server",
    "default_value": "ntp.company.com"
  }'
```

#### Register a secret for data source auth

```bash
curl -s -X POST http://localhost:8000/auth/secrets $AUTH \
  -H "Content-Type: application/json" \
  -d '{
    "name": "netbox_api",
    "secret_type": "db",
    "value": "Token myapitokenvalue",
    "description": "NetBox API token"
  }'
```

#### Register a custom Jinja2 filter

```bash
curl -s -X POST http://localhost:8000/admin/filters $AUTH \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mb_to_kbps",
    "code": "def mb_to_kbps(value):\n    return int(value) * 1000\n",
    "description": "Convert megabits to kilobits per second",
    "scope": "global"
  }'
```

---

## Project Structure

```
templarc/
├── api/
│   ├── main.py                  ← FastAPI app factory, middleware, router mounts
│   ├── config.py                ← Settings (pydantic-settings, reads .env)
│   ├── database.py              ← Async SQLAlchemy engine + session
│   ├── models/                  ← SQLAlchemy ORM models
│   ├── schemas/                 ← Pydantic request/response schemas
│   ├── routers/                 ← FastAPI routers (one per domain)
│   │   ├── auth.py              ← JWT login, user & secret management
│   │   ├── catalog.py           ← Project management, product catalog
│   │   ├── templates.py         ← Template CRUD + Git file management
│   │   ├── parameters.py        ← Parameter registry (all three scopes)
│   │   ├── render.py            ← Render, resolve-params, render history
│   │   └── admin.py             ← Git sync, audit log, custom filters/objects
│   ├── services/                ← Business logic (no FastAPI dependencies)
│   │   ├── parameter_resolver.py
│   │   ├── environment_factory.py
│   │   ├── datasource_resolver.py
│   │   ├── template_renderer.py
│   │   ├── git_service.py
│   │   └── jinja_parser.py
│   └── core/
│       ├── auth.py              ← JWT + LDAP authentication
│       ├── secrets.py           ← Secret resolution (env/vault/db)
│       └── rate_limit.py        ← slowapi rate limiter
├── migrations/                  ← Alembic migrations
├── templates_repo/              ← Git-backed .j2 file store
├── frontend/                    ← React 18 + Vite + TailwindCSS
├── tests/
│   ├── unit/
│   └── integration/
├── openapi.json                 ← Static OpenAPI snapshot (re-generate with uv run python -c "import json, os; os.environ.setdefault('DATABASE_URL','x'); os.environ.setdefault('SECRET_KEY','x'); os.environ.setdefault('TEMPLATES_REPO_PATH','./templates_repo'); from api.main import app; print(json.dumps(app.openapi(), indent=2))" > openapi.json)
└── docker-compose.yml
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | FastAPI (Python 3.12+) |
| ORM | SQLAlchemy 2.x async + Alembic |
| Database | PostgreSQL 15+ |
| Templating | Jinja2 with custom filters/extensions |
| Template storage | Git repo via GitPython |
| Auth | JWT (python-jose) + LDAP (ldap3) |
| HTTP client | httpx (async) |
| JSON path | jsonpath-ng |
| Validation | Pydantic v2 |
| Frontend | React 18 + Vite + React Hook Form + TailwindCSS |
| Testing | pytest + pytest-asyncio + httpx test client |
| Package mgmt | uv |
