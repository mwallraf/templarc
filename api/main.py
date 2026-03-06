"""
Templarc FastAPI application factory.

This module constructs the ``app`` instance, registers all middleware,
mounts domain routers, and defines the lifespan context (startup DB check,
engine disposal on shutdown). It is the entry point for uvicorn:

    uvicorn api.main:app --reload

Router responsibilities (see api/routers/ for details):
  - auth       — JWT login, token refresh, LDAP authentication
  - catalog    — Template catalog hierarchy browsing
  - templates  — CRUD for Template records and Git-backed .j2 files
  - parameters — CRUD for Parameter records across all three scopes
  - render     — Template rendering, resolve-params, and render history
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from api.config import get_settings
from api.core.rate_limit import limiter
from api.database import AsyncSessionLocal, engine
from api.routers import admin, auth, catalog, parameters, render, templates

logger = logging.getLogger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Lifespan — startup/shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Templarc API starting up")

    # --- DB check ---
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        logger.info("Database connectivity verified")
    except Exception as exc:
        logger.warning("Database connectivity check failed on startup: %s", exc)

    # --- Git repo check ---
    try:
        from api.dependencies import get_git_service  # local import — avoid circular risk

        git_svc = get_git_service()
        repo = git_svc._repo
        commits = list(repo.iter_commits(max_count=1))
        if commits:
            logger.info("Git repository accessible — HEAD: %s", commits[0].hexsha[:8])
        else:
            logger.warning("templates_repo has no commits — templates will not render")
    except Exception as exc:
        logger.warning("Git repository check failed: %s", exc)

    if settings.SEED_ON_STARTUP:
        from api.dependencies import get_git_service  # local import — avoids circular risk at module load
        from api.seed import seed_database
        async with AsyncSessionLocal() as session:
            await seed_database(session, get_git_service())
            await session.commit()
        logger.info("Seed step complete")

    yield

    # Shutdown
    await engine.dispose()
    logger.info("Database engine disposed — shutdown complete")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

_DESCRIPTION = """
Templarc is a **general-purpose template engine API** for provisioning, operational,
and text-generation tasks. It provides a product catalog of Jinja2 templates with a
parameter registry, inheritance chains, remote API data sources, dynamic form generation,
and full render history.

## Authentication

All endpoints require a valid JWT Bearer token. Obtain one via:
- `POST /auth/login` — JSON body `{username, password}` (preferred)
- `POST /auth/token` — OAuth2 form body (Swagger UI "Authorize" button)

## Three-Tier Parameter Scoping

Parameters are resolved at three scopes, applied in this order (later wins):

| Prefix | Scope | Defined in |
|--------|-------|-----------|
| `glob.*` | Organization-wide — every render | DB via `POST /parameters` |
| `proj.*` | Project-wide — all templates in a project | DB via `POST /parameters` |
| *(none)* | Template-local — this template only | `.j2` YAML frontmatter |

`glob.*` and `proj.*` values **cannot be overridden** by template-local parameters.

## Template Catalog Hierarchy

Templates form a tree for organization and parameter inheritance:
```
Router Provisioning (project)
  └── CPE (base template)
        └── Cisco
              └── Cisco 891  ← leaf template users select
```
Each child inherits its parent's template-local parameters and can override them.
The API catalog (`GET /catalog/{project_slug}`) returns this tree ready for UI rendering.

## Key Workflows

### Render a template
1. `GET /catalog/{slug}` — browse available templates
2. `GET /templates/{id}/resolve-params` — get the enriched parameter form definition
3. Fill in the form (remote data sources are already merged in step 2)
4. `POST /templates/{id}/render` — submit params, receive rendered output

### Manage templates (admin)
1. `POST /catalog/projects` — create a project (Git directory initialised)
2. `POST /templates` — create a template (writes `.j2` to Git)
3. `POST /parameters` — register parameters for the template
4. `POST /admin/git-sync/{project_id}` — import `.j2` files added directly in Git

## API Groups

| Tag | Base path | Description |
|-----|-----------|-------------|
| Authentication | `/auth` | Login, token management, user & secret CRUD |
| Catalog | `/catalog` | Project management and product catalog browsing |
| Templates | `/templates` | Template CRUD, variables analysis, inheritance chain |
| Parameters | `/parameters` | Parameter registry across all three scopes |
| Render | `/templates/{id}/render` | Template rendering and datasource resolution |
| Render History | `/render-history` | Render history storage and replay |
| Admin | `/admin` | Git sync, audit log, custom filters & objects |
| System | `/health` | Liveness / readiness probes |
"""

app = FastAPI(
    title="Templarc",
    description=_DESCRIPTION,
    version="0.1.0",
    contact={"name": "Templarc"},
    license_info={"name": "Private"},
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Rate limiting — SlowAPIMiddleware applies default_limits (100/min per user)
# to every route.  Individual routes override via @limiter.limit() decorators.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(auth.router,       prefix="/auth",       tags=["Authentication"])
app.include_router(catalog.router,    prefix="/catalog",    tags=["Catalog"])
app.include_router(templates.router,  prefix="/templates",  tags=["Templates"])
app.include_router(parameters.router, prefix="/parameters", tags=["Parameters"])
app.include_router(render.router,                           tags=["Render"])
app.include_router(admin.router,      prefix="/admin",      tags=["Admin"])


# ---------------------------------------------------------------------------
# System endpoints
# ---------------------------------------------------------------------------

@app.get(
    "/health",
    tags=["System"],
    summary="Health check",
    description="Returns 200 if the API and database are reachable, 503 otherwise.",
    response_description="Service health status",
)
async def health() -> dict[str, Any]:
    """
    Lightweight liveness + readiness check.

    Runs a `SELECT 1` against the database. Use this endpoint for:
    - Load balancer health checks
    - Docker/k8s readiness probes
    - Startup verification after `alembic upgrade head`
    """
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok", "version": app.version}
    except Exception as exc:
        logger.error("Health check failed: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "error", "database": str(exc), "version": app.version},
        )
