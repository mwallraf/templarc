---
title: Parameter Scoping
sidebar_position: 5
---

# Parameter Scoping

Understanding parameter scoping is essential for writing correct templates and predicting how parameters merge at render time.

## The Three Scopes

| Scope | Prefix | Defined In | Overrideable By |
|-------|--------|-----------|----------------|
| Global | `glob.` | Org-level DB records | Nothing — always wins |
| Project | `proj.` | Project-level DB records | Nothing — wins over template-local |
| Template-local | _(none)_ | Template `.j2` frontmatter | Child template defaults |

## Resolution Order

`ParameterResolver` builds the final parameter dict in this order:

```
1. Walk template ancestry (leaf → parent → … → root)
   For each ancestor, collect template-local params
   Child values override parent defaults (child wins)

2. Inject proj.* params from the project record
   These overwrite any template-local param with the same name
   (This cannot happen since names are prefixed, but glob/proj are injected separately)

3. Inject glob.* params from the org record
   These overwrite everything
```

**Result:** `glob.*` always wins, `proj.*` wins over template-local, and child template defaults win over parent defaults.

## Why This Design?

- **`glob.*` cannot be overridden** — ensures org-wide constants (NTP servers, DNS servers, company name) are consistent across all outputs
- **`proj.*` cannot be overridden** — ensures project-level defaults (default VRF, SNMP community) are consistent within a project
- **Template inheritance** — lets base templates define reasonable defaults while allowing child templates to specialize

## Example

```
Org settings:
  glob.ntp_server = "10.0.0.1"
  glob.company_name = "Acme Corp"

Project settings:
  proj.default_vrf = "MGMT"

Base template (CPE):
  router.snmp_community = "public"  (default)

Child template (Cisco 891):
  router.snmp_community = "private"  (overrides base)

User submits:
  router.hostname = "router-01"

Final context received by Jinja2:
  glob.ntp_server       = "10.0.0.1"      ← from org
  glob.company_name     = "Acme Corp"      ← from org
  proj.default_vrf      = "MGMT"           ← from project
  router.snmp_community = "private"        ← from child template (wins over base)
  router.hostname       = "router-01"      ← from user
```

## Accessing Parameters in Templates

```jinja2
! Always available:
ntp server {{ glob.ntp_server }}
ip vrf {{ proj.default_vrf }}

! Template-local:
hostname {{ router.hostname }}
snmp-server community {{ router.snmp_community }}
```

## Strict Undefined

Templarc uses `jinja2.StrictUndefined`. Referencing an undefined variable causes a render error, not a silent empty string. This prevents misconfigured templates from producing incorrect output silently.

## Validation

The API enforces:
- Template-local params cannot have names starting with `glob.` or `proj.`
- Parameter names within a template must be unique
- Required parameters must have a value at render time (either from user input, defaults, or auto-fill)
