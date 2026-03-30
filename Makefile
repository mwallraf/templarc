# ─── Templarc — Docker Management ────────────────────────────────────────────
#
# Run `make` or `make help` to see all available targets.
#
# Two operating modes:
#   DEV   — OpenLDAP + hot-reload + exposed DB port (login: admin / admin)
#   PROD  — lean build, DB internal only, no LDAP bundled
#
# Requirements: docker compose v2, curl, jq (for smoke tests)
# ─────────────────────────────────────────────────────────────────────────────

COMPOSE    := docker compose
DEV_FILES  := -f docker-compose.yml -f docker-compose.dev.yml
PROD_FILES := -f docker-compose.yml -f docker-compose.prod.yml

DEV  := $(COMPOSE) $(DEV_FILES)
PROD := $(COMPOSE) $(PROD_FILES)

# Smoke-test defaults (override on CLI: make smoke SMOKE_PASS=mypass)
API_URL    ?= http://localhost:8000
SMOKE_USER ?= admin
SMOKE_PASS ?= admin

# Registry push defaults (override on CLI: make push REGISTRY=ghcr.io/you VERSION=1.2.3)
REGISTRY ?= ghcr.io/mwallraf
VERSION  ?= latest

.DEFAULT_GOAL := help

.PHONY: help \
	env-prod env-dev \
	dev dev-d dev-down dev-clean \
	prod prod-down prod-pull prod-remote \
	status logs logs-frontend logs-ldap logs-db logs-all \
	shell frontend-shell psql ldap-search \
	migrate create-admin \
	test test-unit test-int \
	smoke \
	build build-dev push \
	docs-build docs-serve \
	openapi python-docs screenshots


# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@printf "\n\033[1mTemplarc — Docker management\033[0m\n\n"
	@printf "\033[36m%-20s\033[0m %s\n" "Target" "Description"
	@printf "%-20s %s\n"  "──────" "───────────"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ \
	    { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf "\n\033[1mQuick start (dev):\033[0m\n"
	@printf "  make dev          # foreground — Ctrl-C to stop\n"
	@printf "  make dev-d        # background — make dev-down to stop\n"
	@printf "  make smoke        # verify the stack is healthy\n"
	@printf "\n\033[1mDefault dev credentials:\033[0m\n"
	@printf "  Login      admin / admin  (LDAP)\n"
	@printf "  Frontend   http://localhost:5173\n"
	@printf "  API        $(API_URL)\n"
	@printf "  API Docs   $(API_URL)/docs\n\n"


# ─── Environment setup ────────────────────────────────────────────────────────

# Auto-create .env from the example if it doesn't exist yet.
.env:
	@echo "No .env found — copying from .env.example ..."
	cp .env.example .env
	@echo "Review .env and adjust values before running in production."

env-prod: ## Create .env from .env.example (production template)
	cp .env.example .env
	@echo ".env created from .env.example"

env-dev: ## Create .env from .env.local.example (local non-Docker dev template)
	cp .env.local.example .env
	@echo ".env created from .env.local.example"


# ─── Dev stack ────────────────────────────────────────────────────────────────

dev: .env ## Build and start dev stack in foreground (LDAP + hot-reload)
	$(DEV) up --build

dev-d: .env ## Build and start dev stack in background
	$(DEV) up --build -d
	@echo ""
	@echo "Dev stack is up. Useful follow-up commands:"
	@echo "  make logs         — tail API logs"
	@echo "  make smoke        — run smoke tests"
	@echo "  make dev-down     — stop the stack"

dev-down: ## Stop dev stack (containers only, volumes preserved)
	$(DEV) down

dev-clean: ## Stop dev stack and delete ALL data volumes (full reset)
	$(DEV) down -v
	@echo "All volumes removed. Next 'make dev' will seed fresh data."


# ─── Production stack ─────────────────────────────────────────────────────────

prod: .env ## Build and start production stack in background
	$(PROD) up --build -d

prod-down: ## Stop production stack
	$(PROD) down

prod-pull: .env ## Pull latest production images from $(REGISTRY) (no build)
	$(PROD) pull api frontend

prod-remote: prod-pull ## Pull images from $(REGISTRY) and start production stack (no build)
	$(PROD) up -d
	@echo ""
	@echo "Stack started from remote images ($(REGISTRY), version: $(VERSION))"
	@echo "  make logs       — tail API logs"
	@echo "  make smoke      — verify the stack is healthy"
	@echo "  make prod-down  — stop the stack"


# ─── Status & logs ────────────────────────────────────────────────────────────

status: ## Show running container status
	$(DEV) ps

logs: ## Follow API container logs (Ctrl-C to stop)
	$(DEV) logs -f api

logs-ldap: ## Follow OpenLDAP container logs
	$(DEV) logs -f ldap

logs-db: ## Follow PostgreSQL container logs
	$(DEV) logs -f db

logs-frontend: ## Follow frontend container logs (Vite dev server or nginx)
	$(DEV) logs -f frontend

logs-all: ## Follow all container logs
	$(DEV) logs -f


# ─── Interactive shells ───────────────────────────────────────────────────────

shell: ## Open a bash shell inside the running API container
	$(DEV) exec api bash

frontend-shell: ## Open a shell inside the running frontend container
	$(DEV) exec frontend sh

psql: ## Open a psql session in the database container
	$(DEV) exec db psql -U $${POSTGRES_USER:-templarc} $${POSTGRES_DB:-templarc}

ldap-search: ## List LDAP users in the dev directory (runs ldapsearch inside the container)
	$(DEV) exec ldap ldapsearch -x \
	    -H ldap://localhost:1389 \
	    -D "cn=manager,dc=templarc,dc=dev" -w manager \
	    -b "ou=users,dc=templarc,dc=dev" \
	    "(objectClass=inetOrgPerson)" dn uid mail memberOf


# ─── Database ─────────────────────────────────────────────────────────────────

migrate: ## Run Alembic migrations in the API container (upgrade head)
	$(DEV) exec api alembic upgrade head

create-admin: ## Create or reset a local admin user in the running prod stack
	@printf "Username [admin]: "; read u; [ -z "$$u" ] && u=admin; \
	 printf "Password: "; read -s p; echo ""; \
	 $(PROD) exec -T \
	   -e _ADMIN_USER="$$u" \
	   -e _ADMIN_PASS="$$p" \
	   api python - < scripts/create_admin.py


# ─── Tests (local — requires activated .venv) ─────────────────────────────────

test: ## Run the full test suite locally
	uv run pytest tests/ -v

test-unit: ## Run unit tests only
	uv run pytest tests/unit/ -v

test-int: ## Run integration tests only (requires a running database)
	uv run pytest tests/integration/ -v


# ─── Build only (no start) ────────────────────────────────────────────────────

build: ## Build all production Docker images without starting containers
	$(PROD) build

build-dev: ## Build all dev Docker images without starting containers
	$(DEV) build


# ─── Registry push ────────────────────────────────────────────────────────────
# Build production images and push to a container registry.
# Set REGISTRY and VERSION on the CLI or export them as env vars:
#   make push REGISTRY=ghcr.io/yourname VERSION=1.2.3
#
# One-time login:  echo $PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

push: ## Build and push production images to $(REGISTRY) (set REGISTRY and VERSION)
	@echo "Building production images..."
	$(PROD) build
	@echo ""
	@echo "Tagging as $(REGISTRY)/templarc-api:$(VERSION) and $(REGISTRY)/templarc-frontend:$(VERSION)"
	docker tag templarc-api      $(REGISTRY)/templarc-api:$(VERSION)
	docker tag templarc-frontend $(REGISTRY)/templarc-frontend:$(VERSION)
	@echo ""
	@echo "Pushing to $(REGISTRY)..."
	docker push $(REGISTRY)/templarc-api:$(VERSION)
	docker push $(REGISTRY)/templarc-frontend:$(VERSION)
	@echo ""
	@echo "Done. Images pushed:"
	@echo "  $(REGISTRY)/templarc-api:$(VERSION)"
	@echo "  $(REGISTRY)/templarc-frontend:$(VERSION)"


# ─── Smoke test ───────────────────────────────────────────────────────────────
# Sends four requests to verify the running stack is healthy end-to-end.
# Override defaults:  make smoke API_URL=http://localhost:8000 SMOKE_USER=admin SMOKE_PASS=admin

docs-build: ## Build static Docusaurus site into docs/build/
	cd docs && npm run build

docs-serve: ## Build and serve the docs site locally
	cd docs && npm run build && npm run serve

openapi: ## Regenerate openapi.json from the FastAPI app
	@echo "Regenerating openapi.json..."
	@uv run python -c "import json,os; \
	  os.environ.setdefault('DATABASE_URL','x'); \
	  os.environ.setdefault('SECRET_KEY','x'); \
	  os.environ.setdefault('TEMPLATES_REPO_PATH','./templates_repo'); \
	  from api.main import app; print(json.dumps(app.openapi(),indent=2))" > openapi.json
	@echo "Done — openapi.json updated"

python-docs: ## Generate Python module docs via pdoc (requires: uv pip install pdoc)
	uv run pdoc api/ --output-dir docs/static/python-api/

screenshots: ## Capture tutorial screenshots (requires running app on BASE_URL)
	cd docs && npx ts-node scripts/capture-screenshots.ts


# ─── Smoke test ───────────────────────────────────────────────────────────────
# Sends four requests to verify the running stack is healthy end-to-end.
# Override defaults:  make smoke API_URL=http://localhost:8000 SMOKE_USER=admin SMOKE_PASS=admin

smoke: ## Run a quick end-to-end smoke test against the dev stack (needs curl + jq)
	@command -v curl >/dev/null 2>&1 || (echo "Error: curl is required"; exit 1)
	@command -v jq   >/dev/null 2>&1 || (echo "Error: jq is required (brew install jq)"; exit 1)
	@set -e; \
	echo ""; \
	echo "=== Templarc smoke test — $(API_URL) ==="; \
	echo ""; \
	echo "1/4  GET /health"; \
	STATUS=$$(curl -sf "$(API_URL)/health" | jq -r '.status'); \
	echo "     status: $$STATUS"; \
	[ "$$STATUS" = "ok" ] || (echo "FAIL: /health returned $$STATUS"; exit 1); \
	echo ""; \
	echo "2/4  POST /auth/login  ($(SMOKE_USER) / $(SMOKE_PASS))"; \
	RESP=$$(curl -sf -X POST "$(API_URL)/auth/login" \
	    -H "Content-Type: application/json" \
	    -d "{\"username\":\"$(SMOKE_USER)\",\"password\":\"$(SMOKE_PASS)\"}"); \
	TOKEN=$$(echo "$$RESP" | jq -r '.access_token'); \
	[ "$$TOKEN" != "null" ] && [ -n "$$TOKEN" ] \
	    || (echo "FAIL: login returned $$(echo $$RESP | jq .)"; exit 1); \
	echo "     token: $${TOKEN:0:50}..."; \
	echo ""; \
	echo "3/4  GET /auth/me"; \
	ME=$$(curl -sf "$(API_URL)/auth/me" -H "Authorization: Bearer $$TOKEN"); \
	echo "     user:     $$(echo $$ME | jq -r '.username')"; \
	echo "     is_admin: $$(echo $$ME | jq -r '.is_admin')"; \
	echo ""; \
	echo "4/4  GET /catalog/projects"; \
	COUNT=$$(curl -sf "$(API_URL)/catalog/projects" -H "Authorization: Bearer $$TOKEN" | jq 'length'); \
	echo "     $$COUNT project(s) returned"; \
	echo ""; \
	echo "=== All checks passed ✓ ==="
