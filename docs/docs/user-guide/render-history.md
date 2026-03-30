---
title: Render History
sidebar_position: 5
---

# Render History

Every render (unless run in Preview mode) is saved to the render history. You can find, inspect, and re-use past renders at any time.

## Accessing History

Click **History** in the left sidebar. The history list shows all renders you have access to, sorted by most recent first.

## History List

Each row in the history list shows:

- **Template name** — which template was rendered
- **Display label** — a configurable identifier (e.g., the device hostname) set by the template admin via `history_label_param`
- **Rendered by** — the user who ran the render
- **Timestamp** — when the render occurred

## Searching History

Use the search bar to filter by display label. This is useful when a template has `history_label_param` set — for example, all renders for `router-01` will have that as their display label and can be filtered instantly.

:::info
The search bar filters by `display_label`, not by template name or parameter values. If the template does not have `history_label_param` set, all display labels will be blank and search will not filter.
:::

## History Detail

Click any row to open the history detail view, which shows:

- **Rendered output** — the full text including the metadata header
- **Parameter values** — all parameters that were in effect at render time (global, project, and template-local)
- **Template breadcrumb** — the full hierarchy path
- **Git SHA** — the exact commit of the template file used

## Re-render

Click **Re-render** to open the render form pre-filled with the same parameters from this history entry. Adjust any values if needed and render again to create a new history entry.

## Cross-Template Re-use

From a history detail page, click **Apply to another template** to use the same parameter values with a different template in the same project. A template picker opens and the render form for the selected template opens pre-filled with all matching parameter names from the history record. Unmatched parameters are left empty.

This is useful when you want to apply the same device's parameters to a different template (e.g., switch from a standard config template to a hardened variant).
