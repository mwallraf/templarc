---
title: Contributing
sidebar_position: 9
---

# Contributing

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes (see conventions below)
4. Write or update tests
5. Run `uv run pytest tests/ -v` — all tests must pass
6. Submit a pull request

## Code Style

### Python

- Use `uv` for all package management — never raw `pip`
- Format with `black` and lint with `ruff`
- Type hints are mandatory for all function signatures
- Docstrings on all public functions and classes
- Use `from __future__ import annotations` only when necessary — avoid in routers that use `slowapi` decorators (incompatible)

### FastAPI Conventions

- One router file per domain (`catalog.py`, `templates.py`, `render.py`, etc.)
- Shared dependencies in `api/dependencies.py`
- Routes call `db.commit()` — services call `db.flush()`
- Use `response_model=None` with `status_code=204` on DELETE routes
- Declare specific routes before catch-all patterns (ordering matters in FastAPI)

### SQLAlchemy

- All relationships use `lazy="raise"` — never traverse relationships in services, only use FK columns
- `expire_on_commit=False` on the session factory
- Call `await db.refresh(obj)` after `db.flush()` when accessing `onupdate` columns

### TypeScript / React

- Functional components only
- Use React Hook Form for all forms
- Call `getValues(name)` per-field (not `getValues()`) when building API payloads from RHF state
- Use `var(--c-*)` CSS tokens for all colors — no hardcoded hex values

## Migration Naming Convention

```
YYYYMMDD_HHMM_<8char_hash>_<snake_case_description>.py
```

Example: `20260307_1100_f6a1b2c3_add_api_keys.py`

Generate with:
```bash
uv run alembic revision --autogenerate -m "add api keys"
# then rename the file to follow the convention
```

## Test Requirements

- Every new service function needs a unit test
- Every new API endpoint needs an integration test
- Unit tests mock the database; integration tests use a real DB
- Integration tests create a fresh engine per test (avoid asyncpg event loop issues):

```python
@pytest.fixture
async def db():
    engine = create_async_engine(settings.async_database_url)
    factory = async_sessionmaker(bind=engine, ...)
    async with factory() as session:
        yield session
        await session.rollback()
    await engine.dispose()
```

- Override auth dependencies in the `client` fixture for integration tests:

```python
app.dependency_overrides[get_current_user] = lambda: TokenData(
    sub="testadmin", org_id=1, is_admin=True
)
```

## Adding a Built-in Jinja2 Filter

1. Implement the filter function in `api/jinja_filters/` (add to an existing module or create a new one)
2. Write a docstring with usage examples
3. Import and register in `api/jinja_filters/__init__.py`
4. Update `tests/unit/test_environment_factory.py` — the `test_all_keys_present` test checks for all registered filter names

## Adding an Alembic Migration

1. Modify the SQLAlchemy model
2. Generate: `uv run alembic revision --autogenerate -m "description"`
3. Review the generated migration file — autogenerate is not perfect
4. Rename to follow the naming convention
5. Test: `uv run alembic upgrade head` and `uv run alembic downgrade -1`
6. Include the migration in the same PR as the model change

## Internal Python API Docs

Auto-generated Python module documentation is available at `/docs/python-api/api/` (after running `make python-docs`). This covers all service classes, methods, and models — useful for contributors exploring the codebase.
