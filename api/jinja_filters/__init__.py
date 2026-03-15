"""
Jinja2 filter registry for Templarc.

``BUILTIN_FILTERS`` is a dict mapping filter name → callable.  It is imported
by the EnvironmentFactory and merged into every per-project Jinja2 Environment
via ``env.filters.update(BUILTIN_FILTERS)``.

Adding new filters
------------------
1. Implement the filter function in a module under ``api/jinja_filters/``.
2. Import it here and add it to ``BUILTIN_FILTERS``.
"""

from __future__ import annotations

import base64

from api.jinja_filters.network import (
    cidr_to_wildcard,
    int_to_ip,
    ip_to_int,
    ipaddr,
    mb_to_bps,
    mb_to_kbps,
)


def b64encode(value: str) -> str:
    """Base64-encode a string. Useful for embedding config blobs in JSON payloads."""
    return base64.b64encode(value.encode()).decode()


BUILTIN_FILTERS: dict[str, object] = {
    "mb_to_kbps": mb_to_kbps,
    "mb_to_bps": mb_to_bps,
    "cidr_to_wildcard": cidr_to_wildcard,
    "ip_to_int": ip_to_int,
    "int_to_ip": int_to_ip,
    "ipaddr": ipaddr,
    "b64encode": b64encode,
}
