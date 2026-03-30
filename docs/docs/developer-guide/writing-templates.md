---
title: Writing Templates
sidebar_position: 4
---

# Writing Templates

Templates are `.j2` files stored in Git. They consist of an optional YAML frontmatter block followed by the Jinja2 template body.

## File Format

```yaml
---
parameters:
  - name: router.hostname
    widget: text
    label: "Router Hostname"
    description: "FQDN of the router"
    required: true
    sort_order: 0

  - name: router.bandwidth_mb
    widget: number
    label: "Bandwidth (MB/s)"
    required: false
    default: 100
    sort_order: 1

data_sources:
  - id: netbox
    url: "https://netbox.company.com/api/dcim/devices/?name={{ router.hostname }}"
    auth: "secret:netbox_api"
    trigger: on_change:router.hostname
    on_error: warn
    cache_ttl: 300
    mapping:
      - remote_field: "results[0].site.id"
        to_parameter: router.site_id
        auto_fill: true
      - remote_field: "results[0].device_role.name"
        to_parameter: router.role
        widget_override: readonly
---

hostname {{ router.hostname }}
ntp server {{ glob.ntp_server }}
ip vrf {{ proj.default_vrf }}
bandwidth {{ router.bandwidth_mb | mb_to_kbps }}
```

## Parameter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Parameter name. Dots are allowed (e.g., `router.hostname`). Cannot start with `glob.` or `proj.`. |
| `widget` | ✅ | UI widget type (see below) |
| `label` | ✅ | Human-readable label shown in the form |
| `description` | — | Tooltip/help text |
| `required` | — | `true`/`false`, default `false` |
| `default` | — | Default value pre-filled in the form |
| `sort_order` | — | Integer display order (0-based, ascending) |
| `options` | — | List of `{label, value}` objects for `select`/`multiselect` widgets |

## Widget Types

| Widget | Description |
|--------|-------------|
| `text` | Single-line text input |
| `number` | Numeric input |
| `textarea` | Multi-line text input |
| `select` | Dropdown with predefined options |
| `multiselect` | Multi-value dropdown |
| `readonly` | Non-editable display (used for auto-filled values) |
| `hidden` | Not shown in the form (useful for injected values) |

## Data Source Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier for this data source within the template |
| `url` | ✅ | URL to fetch. May contain Jinja2 expressions using current parameter values. |
| `auth` | — | Credential reference: `secret:<name>` or `env:<var>` |
| `trigger` | — | When to fetch: `on_load` (when form loads) or `on_change:<param>` (when param value changes) |
| `on_error` | — | `warn` (show warning, continue) or `fail` (block render) |
| `cache_ttl` | — | Seconds to cache the response (default: 0 = no cache) |
| `mapping` | — | List of JSONPath → parameter mappings (see below) |

## Data Source Mapping

```yaml
mapping:
  - remote_field: "results[0].site.slug"  # JSONPath into the response
    to_parameter: router.site              # parameter to populate
    auto_fill: true                        # set as prefill value
    widget_override: readonly              # optionally override the widget type
```

- `remote_field` is a JSONPath expression evaluated against the JSON response
- `auto_fill: true` is required for the value to appear in the form; without it the value is extracted but not applied
- `widget_override` lets you change a parameter's widget for this response (e.g., make it `readonly` after auto-fill)

## Template Body

Below the second `---`, write standard Jinja2:

```jinja2
hostname {{ router.hostname }}

! Auto-filled from NetBox:
! Site: {{ router.site }}
! Role: {{ router.role }}

{% for vlan in vlans %}
vlan {{ vlan }}
{% endfor %}
```

## Including Fragments

Use Jinja2's `{% include %}` to compose output from shared fragments:

```jinja2
{% include "shared/banner.j2" %}
hostname {{ router.hostname }}
{% include "shared/ntp_block.j2" %}
```

Included files are plain `.j2` files **without** frontmatter. They are resolved relative to the project's `git_path`.

## Template Inheritance

Templates form a hierarchy where children inherit parent parameters:

```
CPE (base) — defines: cpe.vendor, cpe.model
  └── Cisco (inherits CPE params, adds: cisco.ios_version)
        └── Cisco 891 (inherits all above, adds: cisco.891.memory_mb)
```

A child's parameter values override the parent's defaults for the same parameter name. `glob.*` and `proj.*` are injected separately and always win.

## Naming Conventions

- Use dotted namespaces: `router.hostname`, `bgp.asn`, `interface.description`
- Keep the namespace consistent within a project (e.g., always `router.*` for device-level params)
- Reserve `glob.*` and `proj.*` — the API rejects template-local params with these prefixes
