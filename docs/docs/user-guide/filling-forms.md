---
title: Filling Parameter Forms
sidebar_position: 3
---

# Filling Parameter Forms

When you open a leaf template, Templarc generates a dynamic form from the template's parameter definitions.

## Form Sections

The form is divided into three sections matching the three parameter scopes:

1. **Global** — `glob.*` parameters set org-wide by admins (often pre-filled, may be read-only)
2. **Project** — `proj.*` parameters set per-project (may be editable depending on your role)
3. **Template** — parameters specific to this template and its parent chain

Parameters within each section are sorted by the order defined by the template admin.

## Parameter Widgets

| Widget | Description | Example use |
|--------|-------------|-------------|
| `text` | Single-line free text | Hostname, IP address |
| `number` | Numeric input | Bandwidth, VLAN ID |
| `textarea` | Multi-line free text | Description block |
| `select` | Dropdown with predefined options | Interface type, protocol |
| `multiselect` | Multi-value dropdown | Feature list, tag list |
| `readonly` | Non-editable display field | Auto-filled from data source |
| `hidden` | Not shown (used for injected values) | Internal reference IDs |

## Required Fields

Parameters marked as **required** show a red asterisk (`*`) in their label. The Render button is disabled until all required fields have a value.

:::warning
Hidden parameters are never shown but may be required. If the Render button stays disabled after filling all visible fields, a hidden parameter may be missing its default value. Contact your template admin.
:::

## Auto-Fill from Data Sources

Some templates fetch data from external APIs when you change a field. This is indicated by:

1. A spinner appearing in a field after you finish typing
2. A dependent `readonly` field populating automatically

**Example:** Changing the `router.hostname` field triggers a lookup in NetBox. The resulting `router.site_id` and `router.role` fields auto-fill with the fetched values.

:::info
Auto-fill uses `on_change` triggers configured in the template's data source definitions. The API call is made server-side — your credentials are never exposed.
:::

## Presets

If your template admin has defined presets, a **Load Preset** button appears at the top of the form. Presets are named bundles of parameter values for common configurations. See [Presets](./presets) for details.

## Features

If the template has optional feature add-ons, a **Features** section appears below the main form. Toggle features on or off before rendering. See [Features](./features) for details.
