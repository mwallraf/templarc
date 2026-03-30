---
title: Dev Setup
sidebar_position: 3
---

# Dev Setup

## Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Node.js 20+
- Docker + Docker Compose v2 (for the database and optional LDAP)
- git

## Quick Start (Docker dev stack)

```bash
git clone <repo-url>
cd templarc
cp .env.example .env   # review and edit
make dev               # start all containers with hot-reload
make smoke             # verify the stack
```

## Manual Setup (no Docker)

### 1. Create virtual environment

```bash
uv venv .venv
source .venv/bin/activate   # macOS/Linux
# .venv\Scripts\activate    # Windows
```

### 2. Install dependencies

```bash
uv pip install -r requirements.txt
```

### 3. Configure `.env`

```bash
cp .env.local.example .env
# Edit DATABASE_URL to point at your local Postgres
# Set SECRET_KEY to any random string for dev
```

Minimum `.env`:
```
DATABASE_URL=postgresql://templarc:templarc@localhost/templarc
SECRET_KEY=dev-secret-change-in-production
TEMPLATES_REPO_PATH=./templates_repo
```

### 4. Initialize the database

```bash
uv run alembic upgrade head
```

### 5. Start the API

```bash
uvicorn api.main:app --reload
# API available at http://localhost:8000
```

### 6. Start the frontend

```bash
cd frontend
npm install
npm run dev
# Frontend available at http://localhost:5173
```

## Running Tests

```bash
# Full suite (unit + integration — needs running DB)
uv run pytest tests/ -v

# Unit tests only (no DB required)
uv run pytest tests/unit/ -v

# Integration tests only (needs running DB)
uv run pytest tests/integration/ -v
```

## Project Structure

```
templarc/
├── api/
│   ├── main.py              ← FastAPI app factory
│   ├── config.py            ← Settings (pydantic-settings)
│   ├── database.py          ← Async engine + session
│   ├── models/              ← SQLAlchemy ORM models
│   ├── schemas/             ← Pydantic request/response schemas
│   ├── routers/             ← FastAPI routers (one per domain)
│   ├── services/            ← Business logic (no FastAPI deps)
│   ├── jinja_filters/       ← Built-in Jinja2 filters
│   └── core/                ← Auth, secrets, rate limiting
├── migrations/              ← Alembic migration files
├── templates_repo/          ← Git-backed .j2 files
├── frontend/                ← React app
├── docs/                    ← This documentation site
└── tests/
    ├── unit/
    └── integration/
```

## Alembic Migrations

```bash
# Apply all migrations
uv run alembic upgrade head

# Create a new migration after model changes
uv run alembic revision --autogenerate -m "describe the change"

# Rollback one step
uv run alembic downgrade -1
```

Migration naming convention: `YYYYMMDD_HHMM_<hash>_<snake_case_description>.py`

## Key Service Dependencies

```
TemplateRenderer
  └── ParameterResolver
  └── DatasourceResolver
        └── SecretResolver
  └── EnvironmentFactory
        └── GitService
```

When writing tests, mock from the outermost layer inward.
