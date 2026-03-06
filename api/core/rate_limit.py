"""
Rate limiting for Templarc API.

Provides a single slowapi Limiter instance that is mounted on app.state.limiter
in main.py.  SlowAPIMiddleware then applies the default limit (100 req/min per
user) to every route automatically.

Per-route overrides use the @limiter.limit() decorator:
  - Login routes    — 5 req/min per IP   (brute-force protection)
  - Render routes   — 10 req/min per user (rendering is expensive)

Key function:
  _jwt_or_ip_key — extracts the JWT 'sub' claim when a valid Bearer token is
  present, otherwise falls back to the client IP address.  This gives
  per-authenticated-user bucketing rather than per-IP for logged-in traffic.
"""

from __future__ import annotations

from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address


def _jwt_or_ip_key(request: Request) -> str:
    """Return JWT sub when authenticated, else client IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            from api.config import get_settings  # local import — avoid circular risk at module load

            settings = get_settings()
            payload = jwt.decode(auth[7:], settings.SECRET_KEY, algorithms=["HS256"])
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except JWTError:
            pass
    return get_remote_address(request)


# Single Limiter instance shared across the application.
# SlowAPIMiddleware (mounted in main.py) applies default_limits to ALL routes.
# Specific routes override with @limiter.limit("X/minute") decorators.
limiter = Limiter(key_func=_jwt_or_ip_key, default_limits=["100/minute"])
