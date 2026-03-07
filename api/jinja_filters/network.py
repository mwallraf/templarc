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


def ipaddr(value: str, query: str = "") -> str:
    """Ansible-compatible ipaddr filter for IPv4 CIDR manipulation.

    Supported queries::
        ipaddr('address')   → extract IP address without prefix  ("10.1.1.1")
        ipaddr('netmask')   → extract subnet mask                ("255.255.255.252")
        ipaddr('network')   → extract network address            ("192.168.0.0")
        ipaddr('prefix')    → extract prefix length              ("30")
        ipaddr('broadcast') → extract broadcast address          ("192.168.0.3")
        ipaddr('1')         → Nth host in the network with prefix ("192.168.0.1/30")
        ipaddr('2')         → 2nd host in the network with prefix ("192.168.0.2/30")

    Examples::
        "10.1.1.1/32"       | ipaddr('address') → "10.1.1.1"
        "192.168.100.0/30"  | ipaddr('2')       → "192.168.100.2/30"
        "192.168.100.2/30"  | ipaddr('address') → "192.168.100.2"
        "192.168.100.0/30"  | ipaddr('netmask') → "255.255.255.252"
    """
    try:
        interface = ipaddress.IPv4Interface(value)
    except (ValueError, TypeError):
        return value

    network = interface.network
    prefix = network.prefixlen

    if query == "address":
        return str(interface.ip)
    elif query == "netmask":
        return str(network.netmask)
    elif query == "network":
        return str(network.network_address)
    elif query == "prefix":
        return str(prefix)
    elif query == "broadcast":
        return str(network.broadcast_address)
    elif query.isdigit():
        n = int(query)
        host_ip = network.network_address + n
        return f"{host_ip}/{prefix}"
    else:
        return value
