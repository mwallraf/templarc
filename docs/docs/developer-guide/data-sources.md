---
title: Data Sources
sidebar_position: 6
---

# Data Sources

Data sources allow templates to fetch external API data at form-fill time and inject the results into parameter values. All data source calls are made server-side — credentials never reach the browser.

## Data Source YAML Spec

```yaml
data_sources:
  - id: netbox                             # unique ID within the template
    url: "https://netbox.company.com/api/dcim/devices/?name={{ router.hostname }}"
    auth: "secret:netbox_api"             # credential reference
    trigger: on_change:router.hostname    # when to fetch
    on_error: warn                         # error handling
    cache_ttl: 300                         # cache response for 5 minutes
    mapping:
      - remote_field: "results[0].site.slug"
        to_parameter: router.site
        auto_fill: true
        widget_override: readonly
```

## Trigger Types

| Trigger | Description |
|---------|-------------|
| `on_load` | Fetch when the render form first loads |
| `on_change:<param>` | Fetch when the named parameter's value changes |

Multiple data sources can share the same trigger parameter.

## URL Template

The `url` field is a Jinja2 expression evaluated with the current parameter values at trigger time:

```yaml
url: "https://cmdb.company.com/api/devices/{{ router.hostname }}/interfaces"
```

## Auth

Pass a secret or environment variable reference:

```yaml
auth: "secret:netbox_api"   # looks up the "netbox_api" secret in the DB
auth: "env:CMDB_API_TOKEN"  # reads the environment variable
```

The resolved value is passed as a Bearer token header: `Authorization: Bearer <value>`.

## Mapping with JSONPath

Use JSONPath expressions to extract values from the JSON response:

```yaml
mapping:
  - remote_field: "results[0].site.id"       # integer → router.site_id
    to_parameter: router.site_id
    auto_fill: true

  - remote_field: "results[0].device_role.name"  # string → router.role
    to_parameter: router.role
    widget_override: readonly
```

- `remote_field` is a JSONPath expression (dot notation and bracket index supported)
- `auto_fill: true` is required to inject the value as the parameter's prefill; without it, the value is extracted but not used
- `widget_override` changes the parameter's widget type for this response only

## Error Handling

| `on_error` | Behaviour |
|-----------|-----------|
| `warn` | Shows a warning in the form but does not block rendering |
| `fail` | Blocks rendering with an error message |

Default is `warn`.

## Cascade Triggers (Loop Safety)

If a data source mapping auto-fills a parameter, and that parameter is itself a trigger for another data source, the cascade fires automatically. `DatasourceResolver` uses a visited set to prevent infinite loops.

```
router.hostname changes
  → fetches netbox_by_hostname
  → auto-fills router.site_id
  → router.site_id is a trigger for netbox_by_site
  → fetches netbox_by_site
  → (no further triggers — cascade ends)
```

## SSRF Protection

By default, data source URLs that resolve to RFC-1918 private addresses are rejected to prevent server-side request forgery (SSRF) against internal services.

To allow internal URLs (e.g., on-premises NetBox):
```
ALLOW_PRIVATE_DATASOURCE_URLS=true
```

:::warning
Only set `ALLOW_PRIVATE_DATASOURCE_URLS=true` in trusted environments where all template admins are trusted users.
:::

## Caching

Set `cache_ttl` (seconds) to cache data source responses. The cache key is the resolved URL. Set to `0` (default) to disable caching.

```yaml
cache_ttl: 300   # cache for 5 minutes
```
