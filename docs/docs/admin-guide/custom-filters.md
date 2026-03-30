---
title: Custom Filters
sidebar_position: 8
---

# Custom Filters

Custom Jinja2 filters let you extend the templating language with project-specific transformation functions. Once added, filters are available in all templates within the project.

## Built-in Filters

Templarc ships with a set of built-in network engineering filters available in every project. See [Jinja2 Filters](../developer-guide/jinja2-filters) for the full reference.

## Creating a Custom Filter

1. Go to **Studio → Filters**
2. Click **New Filter**
3. Fill in:
   - **Name** — filter identifier used in templates (e.g., `vlan_to_hex`)
   - **Description** — human-readable explanation
   - **Project** — which project this filter belongs to
   - **Code** — Python function body (see below)

### Filter Code Format

Write a Python function. The function must accept a `value` as its first argument and return a string or other serializable type:

```python
def filter(value):
    """Convert a VLAN ID to its hexadecimal representation."""
    return format(int(value), '04x')
```

The function is executed in a sandboxed environment. Allowed imports are limited to the Python standard library. Network calls and filesystem access are blocked.

## Testing a Filter

Use the **Test** button in the filter editor to run the filter against a sample value:

1. Enter the filter code
2. Enter a test value (e.g., `100`)
3. Click **Test** — the output appears in the preview panel

You can also test filters in the **Sandbox** (accessible from the main nav) without saving them.

## Attaching a Filter to a Project

When you create a filter, you select which project it belongs to. Once created, the filter is immediately available to all templates in that project.

```jinja2
! VLAN {{ vlan_id | vlan_to_hex }}
```

## Editing and Deleting Filters

Edit or delete filters from **Studio → Filters**. Changes take effect immediately — the per-project Jinja2 environment is rebuilt on the next render.

:::warning
Deleting a filter that is used in template bodies will cause those templates to fail to render until the reference is removed. Always check template bodies before deleting a filter.
:::
