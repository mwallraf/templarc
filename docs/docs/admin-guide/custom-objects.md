---
title: Custom Objects
sidebar_position: 9
---

# Custom Objects

Custom objects inject Python object instances into the Jinja2 rendering context. They extend templates with callable helpers, lookup tables, or data structures that go beyond what simple filters provide.

## Use Cases

- A `NetworkHelper` object with methods like `next_available_ip(subnet)`
- A static lookup table: `vendor_codes = {"cisco": "CSC", "juniper": "JNP"}`
- A utility object that formats structured data blocks

## Creating a Custom Object

1. Go to **Studio → Filters** (custom objects are managed in the same area)
2. Click **New Object**
3. Fill in:
   - **Name** — variable name injected into the Jinja2 context (e.g., `net`)
   - **Description** — human-readable explanation
   - **Project** — which project this object belongs to
   - **Code** — Python class or instance definition

### Object Code Format

Define a class and instantiate it. The variable name you set in the **Name** field will hold this instance in the template context:

```python
class NetworkHelper:
    def vlan_range(self, start, count):
        """Return a list of VLAN IDs starting from start."""
        return list(range(start, start + count))

    def mac_to_cisco(self, mac):
        """Convert XX:XX:XX:XX:XX:XX to XXXX.XXXX.XXXX format."""
        parts = mac.replace(':', '').replace('-', '')
        return '.'.join(parts[i:i+4] for i in range(0, 12, 4))

instance = NetworkHelper()
```

The `instance` variable is picked up and injected under the object's **Name**.

## Using an Object in a Template

```jinja2
{% for vlan in net.vlan_range(100, 5) %}
vlan {{ vlan }}
{% endfor %}

interface GigabitEthernet0/0
 mac-address {{ net.mac_to_cisco(device.mac) }}
```

## Security Sandbox

Custom object code runs in the same sandbox as custom filters. Standard library imports are allowed; network and filesystem access are blocked.

:::warning
Custom objects have access to everything in their execution scope. Avoid storing sensitive values in object state — use secrets via data sources instead.
:::
