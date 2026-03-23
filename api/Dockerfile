# ─── Stage 1: base ───────────────────────────────────────────────────────────
# Shared foundation: OS deps, uv, Python packages.
# Neither source code nor migration files are copied here so this layer is
# reused by both the production and dev targets.
FROM python:3.12-slim AS base

# Build-time proxy support — pass via --build-arg or compose build.args.
# Only active during RUN steps (apt-get, uv pip install); not baked into image.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

# git is required by GitPython to read the templates repository.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Configure git system-wide (applies to ALL users and any UID the container runs as).
#  safe.directory '*'    — allows git to operate on bind-mounted dirs even when the
#                          host directory owner UID differs from the container UID.
#                          This is mandatory on servers where the host user ≠ container user.
#  user.email / name     — identity for any commit that doesn't come via GitPython Actor.
#  init.defaultBranch    — suppresses the "master vs main" warning on git init.
RUN git config --system --add safe.directory '*' \
    && git config --system user.email "templarc@localhost" \
    && git config --system user.name "Templarc" \
    && git config --system init.defaultBranch "main"

# Install uv for fast, deterministic dependency installation.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install Python dependencies before copying source code so that this layer
# is cached and only rebuilt when requirements.txt changes.
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt


# ─── Stage 2: production ─────────────────────────────────────────────────────
# Lean, self-contained image with all application code baked in.
# Runs DB migrations then starts uvicorn (no --reload).
FROM base AS production

COPY api/        ./api/
COPY alembic.ini .
COPY migrations/ ./migrations/

# Mount point for the Git-backed templates repository (bind-mounted at runtime).
RUN mkdir -p /app/templates_repo

EXPOSE 8000

# Run migrations on every container start (idempotent), then start the server.
# exec replaces the shell so uvicorn receives OS signals directly (SIGTERM).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn api.main:app --host 0.0.0.0 --port 8000"]


# ─── Stage 3: dev ────────────────────────────────────────────────────────────
# Development image: source code is volume-mounted at runtime, NOT copied.
# This lets uvicorn's --reload pick up file changes without rebuilding.
#
# Usage (via docker-compose.dev.yml):
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
FROM base AS dev

# Mount point for the templates repo; also satisfies alembic path assumptions.
RUN mkdir -p /app/templates_repo

EXPOSE 8000

# --reload watches for source-code changes under /app (the bind-mounted project
# root). Migrations are still run on startup so the DB is always up to date.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload"]
