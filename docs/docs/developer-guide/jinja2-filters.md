---
title: Jinja2 Filters
sidebar_position: 7
---

# Jinja2 Filters

Templarc ships with built-in network engineering filters available in every project. Project admins can add custom filters via the Studio UI.

## Built-in Filters

All built-in filters are defined in `api/jinja_filters/`.

### `mb_to_kbps`

Convert megabytes-per-second to kilobits-per-second. Useful for Cisco QoS bandwidth statements.

```jinja2
bandwidth {{ core.bandwidth_mb | mb_to_kbps }}
{# Input: 100 → Output: 800000 #}
```

Formula: `value × 1000 × 8`

---

### `mb_to_bps`

Convert megabytes-per-second to bits-per-second.

```jinja2
{{ 10 | mb_to_bps }}
{# Output: 80000000 #}
```

Formula: `value × 1,000,000 × 8`

---

### `cidr_to_wildcard`

Convert a CIDR prefix to its wildcard (host-mask) form. Used in Cisco ACLs.

```jinja2
ip access-list standard MGMT
 permit {{ mgmt_subnet | cidr_to_wildcard }}
```

| Input | Output |
|-------|--------|
| `10.0.0.0/24` | `0.0.0.255` |
| `10.0.0.0/8` | `0.255.255.255` |
| `192.168.1.0/30` | `0.0.0.3` |

---

### `ip_to_int`

Convert a dotted-decimal IPv4 address to its integer representation.

```jinja2
{{ "192.168.1.1" | ip_to_int }}
{# Output: 3232235777 #}
```

---

### `int_to_ip`

Convert an integer to its dotted-decimal IPv4 address form.

```jinja2
{{ 3232235777 | int_to_ip }}
{# Output: 192.168.1.1 #}
```

---

### `ipaddr`

Ansible-compatible IPv4 CIDR manipulation filter. Supports a query argument to extract specific components.

| Query | Description | Example input | Output |
|-------|-------------|--------------|--------|
| `'address'` | Extract IP without prefix | `10.1.1.1/32` | `10.1.1.1` |
| `'netmask'` | Extract subnet mask | `192.168.0.0/30` | `255.255.255.252` |
| `'network'` | Extract network address | `192.168.1.5/24` | `192.168.1.0` |
| `'prefix'` | Extract prefix length | `10.0.0.0/16` | `16` |
| `'broadcast'` | Extract broadcast address | `10.0.0.0/24` | `10.0.0.255` |
| `'1'`, `'2'`, … | Nth host in network with prefix | `192.168.0.0/30` | `192.168.0.1/30` |

```jinja2
 ip address {{ interface.ip | ipaddr('address') }} {{ interface.ip | ipaddr('netmask') }}
{# Input: "10.0.0.1/24" → "ip address 10.0.0.1 255.255.255.0" #}
```

---

### `b64encode`

Base64-encode a string. Useful for embedding config blobs in JSON payloads or certificate data.

```jinja2
{{ config_blob | b64encode }}
```

---

## Standard Jinja2 Filters

All standard Jinja2 built-in filters are also available: `upper`, `lower`, `trim`, `replace`, `join`, `list`, `int`, `float`, `default`, `reject`, `select`, `map`, and many more.

See the [Jinja2 documentation](https://jinja.palletsprojects.com/en/stable/templates/#builtin-filters) for the full list.

---

## Custom Filters

Project admins can add Python-based custom filters via **Studio → Filters**. Once added, they are available in all templates within that project.

For more details, see [Custom Filters](../admin-guide/custom-filters).

### Adding a Filter in Code

If you prefer to add a filter directly in code rather than via the UI:

1. Create a function in `api/jinja_filters/your_module.py`
2. Import and add it to `BUILTIN_FILTERS` in `api/jinja_filters/__init__.py`
3. The filter becomes available in all projects globally

```python
# api/jinja_filters/__init__.py
from api.jinja_filters.your_module import my_filter

BUILTIN_FILTERS: dict[str, object] = {
    # ... existing filters ...
    "my_filter": my_filter,
}
```
