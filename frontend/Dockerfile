# ─── Stage 1: base ───────────────────────────────────────────────────────────
# Install node_modules once; reused by every subsequent stage.
# Build context is the project root so docs/ and api/ are accessible.
FROM node:20-alpine AS base

# Build-time proxy support — pass via --build-arg or compose build.args.
# Only active during RUN steps (npm ci); not baked into image.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

WORKDIR /app

# Install deps before copying source so this layer is cached until
# package.json / package-lock.json change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent


# ─── Stage 2: dev ────────────────────────────────────────────────────────────
# Vite development server with HMR.
# Source code is bind-mounted at runtime (not copied), so changes on the host
# are immediately visible in the container.
#
# Usage (via docker-compose.dev.yml):
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
#
# The Vite proxy target is set via API_PROXY_TARGET so it resolves to the
# 'api' Docker service instead of localhost.
FROM base AS dev

# Expose Vite's default HMR port as well as the dev server port.
EXPOSE 5173
EXPOSE 24678

# 'vite' reads API_PROXY_TARGET at server-start time (not build time).
# Pass it via the 'environment:' block in docker-compose.dev.yml.
CMD ["npm", "run", "dev"]


# ─── Stage 3: build ──────────────────────────────────────────────────────────
# Compile TypeScript and bundle assets into /app/dist.
# VITE_API_URL is left empty so the browser calls /api/* (same-origin),
# which nginx will proxy to the FastAPI container.
FROM base AS build

COPY frontend/ .
RUN npm run build


# ─── Stage 3a: openapi-gen ───────────────────────────────────────────────────
# Generate openapi.json from the FastAPI source so the API reference in the
# docs always reflects the current codebase — no pre-generated file needed.
FROM python:3.12-slim AS openapi-gen

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

COPY api/ ./api/

RUN python -c "\
import json, os; \
os.environ.setdefault('DATABASE_URL', 'postgresql://x:x@localhost/x'); \
os.environ.setdefault('SECRET_KEY', 'build-time-key'); \
os.environ.setdefault('TEMPLATES_REPO_PATH', '/tmp/templates'); \
from api.main import app; \
print(json.dumps(app.openapi(), indent=2))" > /openapi.json


# ─── Stage 3b: docs-build ────────────────────────────────────────────────────
# Build the Docusaurus documentation site into /docs/build.
FROM node:20-alpine AS docs-build

WORKDIR /docs
COPY docs/package*.json ./
RUN npm ci --silent
COPY docs/ ./
COPY --from=openapi-gen /openapi.json /openapi.json
RUN npm run build


# ─── Stage 4: production ─────────────────────────────────────────────────────
# Minimal nginx image — only the compiled static assets + nginx config.
FROM nginx:1.27-alpine AS production

# Remove the default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy the custom config (handles SPA routing, /api proxy, and /docs/)
COPY frontend/nginx.conf /etc/nginx/conf.d/templarc.conf

# Copy the Vite build output
COPY --from=build /app/dist /usr/share/nginx/html

# Copy the Docusaurus build output → served at /docs/
COPY --from=docs-build /docs/build /usr/share/nginx/html/docs

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
