"""
Built-in Jinja2 filters for network engineering templates.

These filters are registered in every per-project Jinja2 environment by the
EnvironmentFactory.  They are pure functions with no side effects and no
external dependencies beyond the Python standard library.

Usage in a template::

    bandwidth {{ core.bandwidth_mb | mb_to_kbps }}
    ip access-list wildcard {{ "10.0.0.0/24" | cidr_to_wildcard }}
    ! int repr: {{ "192.168.1.1" | ip_to_int }}
    ! back:     {{ 3232235777 | int_to_ip }}
"""

from __future__ import annotations

import ipaddress


def mb_to_kbps(value: float) -> int:
    """Convert megabytes-per-second to kilobits-per-second.

    1 MB/s = 8 Mbit/s = 8000 kbit/s
    """
    return int(value * 1000 * 8)


def mb_to_bps(value: float) -> int:
    """Convert megabytes-per-second to bits-per-second.

    1 MB/s = 8 Mbit/s = 8,000,000 bit/s
    """
    return int(value * 1_000_000 * 8)


def cidr_to_wildcard(cidr: str) -> str:
    """Convert a CIDR prefix to its wildcard (host-mask) form.

    Examples::
        "10.0.0.0/24"   → "0.0.0.255"
        "10.0.0.0/8"    → "0.255.255.255"
        "192.168.1.0/30" → "0.0.0.3"
    """
    network = ipaddress.IPv4Network(cidr, strict=False)
    return str(network.hostmask)


def ip_to_int(ip: str) -> int:
    """Convert a dotted-decimal IPv4 address to its integer representation.

    Examples::
        "192.168.1.1" → 3232235777
        "10.0.0.1"    → 167772161
    """
    return int(ipaddress.IPv4Address(ip))


def int_to_ip(n: int) -> str:
    """Convert an integer to its dotted-decimal IPv4 address form.

    Examples::
        3232235777 → "192.168.1.1"
        167772161  → "10.0.0.1"
    """
    return str(ipaddress.IPv4Address(n))
