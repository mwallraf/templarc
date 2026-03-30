---
title: Installation
sidebar_position: 2
---

# Installation

Templarc can be deployed via Docker Compose (recommended) or run manually for development.

## Docker Compose (Recommended)

### Prerequisites

- Docker 24+
- Docker Compose v2 (`docker compose` command)
- git

### Steps

```bash
# 1. Clone the repository
git clone <your-templarc-repo-url>
cd templarc

# 2. Create your environment file
cp .env.example .env
# Edit .env and set the required variables (see below)

# 3. Start the dev stack (LDAP + hot-reload)
make dev

# Or start in background
make dev-d

# 4. Verify the stack is healthy
make smoke
```

The dev stack starts:
- **API** on port 8000 (FastAPI + uvicorn)
- **Frontend** on port 5173 (Vite dev server)
- **PostgreSQL** on port 5432 (exposed in dev)
- **OpenLDAP** on port 1389 (bundled dev LDAP)

### Production Stack

```bash
make prod      # build and start
make prod-down # stop
```

The production stack uses a lean nginx image to serve the built frontend and does not expose the database port externally.

### Verify

```bash
curl http://localhost:8000/health
# {"status":"ok","version":"1.0.0"}
```

---

## Manual / Development Setup

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- PostgreSQL 15+
- Node.js 20+

### API Setup

```bash
# Create virtual environment
uv venv .venv
source .venv/bin/activate   # macOS/Linux

# Install dependencies
uv pip install -r requirements.txt

# Copy and configure .env
cp .env.local.example .env
# Edit DATABASE_URL, SECRET_KEY, TEMPLATES_REPO_PATH

# Run database migrations
uv run alembic upgrade head

# Start the API
uvicorn api.main:app --reload
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### Docs Setup (optional)

```bash
cd docs
npm install
npm start   # starts on port 3001
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string (`postgresql://user:pass@host/db`) |
| `SECRET_KEY` | ✅ | — | JWT signing secret (generate with `openssl rand -hex 32`) |
| `TEMPLATES_REPO_PATH` | — | `./templates_repo` | Path to the Git repository containing `.j2` template files |
| `LDAP_SERVER` | — | `""` | LDAP server URL (e.g. `ldap://ldap.company.com`). Empty disables LDAP auth. |
| `LDAP_BASE_DN` | — | `""` | LDAP base DN (e.g. `dc=company,dc=com`) |
| `LDAP_ADMIN_GROUP` | — | `""` | DN of the LDAP group that grants `is_admin=True` |
| `CORS_ORIGINS` | — | `["http://localhost:5173"]` | Allowed CORS origins for the frontend |
| `ALLOW_PRIVATE_DATASOURCE_URLS` | — | `false` | Allow data sources to call RFC-1918 internal addresses. Set `true` for on-prem NetBox etc. |
| `SEED_ON_STARTUP` | — | `false` | Populate demo data on startup (idempotent) |
| `SMTP_HOST` | — | `""` | SMTP server for email (empty = disabled) |
| `SMTP_PORT` | — | `587` | SMTP port |
| `SMTP_USER` | — | `""` | SMTP username |
| `SMTP_PASSWORD` | — | `""` | SMTP password |
| `SMTP_FROM` | — | `noreply@templarc.io` | From address for outgoing emails |
| `FRONTEND_URL` | — | `http://localhost:5173` | Base URL for password reset links in emails |
| `AI_PROVIDER` | — | `""` | AI assistant provider: `anthropic`, `openai`, or empty to disable |
| `AI_API_KEY` | — | `""` | API key for the AI provider |
| `AI_MODEL` | — | `claude-sonnet-4-6` | Model name |
| `AI_BASE_URL` | — | `https://api.openai.com/v1` | Base URL for OpenAI-compatible providers |
| `LOG_LEVEL` | — | `INFO` | Log level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `LOG_FORMAT` | — | `text` | Log format: `text` (human-readable) or `json` (for aggregators) |
| `LOG_FILE` | — | `""` | Absolute path for rotating log file (empty = stdout only) |
| `APP_VERSION` | — | `dev` | Application version (override in Docker via build arg) |
| `AUDIT_LOG_RETENTION_DAYS` | — | `null` | Days to retain audit log entries (`null` = keep forever) |

:::warning
Never commit a real `SECRET_KEY` to git. Use `openssl rand -hex 32` to generate a strong key, then set it in `.env` or your secrets manager.
:::
