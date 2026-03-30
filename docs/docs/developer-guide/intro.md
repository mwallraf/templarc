---
title: Introduction
sidebar_position: 1
---

# Developer Guide

This guide is for developers who want to contribute to Templarc, integrate with the API, write custom templates, or understand the system internals.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  (Vite + TailwindCSS + React Hook Form)              │
└────────────────────┬────────────────────────────────┘
                     │ REST / JSON
┌────────────────────▼────────────────────────────────┐
│               FastAPI (Python 3.12+)                 │
│  Routers → Services → SQLAlchemy (async) + Jinja2   │
└──────────┬──────────────────────────┬───────────────┘
           │                          │
┌──────────▼──────────┐  ┌────────────▼───────────────┐
│   PostgreSQL 15+     │  │   Git Repository            │
│   (metadata, params, │  │   (.j2 template files)      │
│    history, secrets) │  │   (GitPython)               │
└─────────────────────┘  └────────────────────────────┘
```

## Key Design Decisions

- **DB is source of truth for metadata; Git is source of truth for template content** — the DB indexes Git templates but never duplicates their body
- **Three-tier parameter scoping** — `glob.*` → `proj.*` → template-local; global always wins
- **Per-project Jinja2 environments** — each project gets its own `jinja2.Environment` with custom filters, objects, and a `GitLoader`
- **Template hierarchy ≠ Jinja2 extends** — hierarchy is for organization and parameter inheritance; actual composition uses `{% include %}`

## Tech Stack Quick Reference

| Layer | Technology |
|-------|-----------|
| API | FastAPI + Python 3.12 |
| ORM | SQLAlchemy 2.x async + Alembic |
| DB | PostgreSQL 15+ |
| Templating | Jinja2 |
| Template storage | GitPython |
| Auth | JWT (`python-jose`) + LDAP (`ldap3`) |
| HTTP client | httpx (async) |
| JSON path | jsonpath-ng |
| Validation | Pydantic v2 |
| Frontend | React 18 + Vite + React Hook Form + TailwindCSS |
| Testing | pytest + pytest-asyncio + httpx |
| Package manager | uv (Python), npm (JS) |

## Where to Start

- [Architecture](./architecture) — deep dive into system design
- [Dev Setup](./dev-setup) — get a local environment running
- [Writing Templates](./writing-templates) — `.j2` frontmatter reference
- [API Integration](./api-integration) — quick-start curl examples
- [Contributing](./contributing) — PR conventions and style guide
