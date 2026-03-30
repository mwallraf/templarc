---
title: "Tutorial 4: History and Re-use"
sidebar_position: 4
---

# Tutorial 4: History and Re-use

**Goal:** Find a past render, inspect it, and re-use the same parameters with another template.

**Time:** ~10 minutes

**Who:** End users

---

## Step 1: Open the History Page

Click **History** in the left sidebar. The history list shows all renders you have access to, sorted by most recent first.

<!-- SCREENSHOT: history-list -->

Each row shows:
- Template name and breadcrumb
- **Display label** — a human-readable identifier (e.g., device hostname) if the template has `history_label_param` configured
- Who rendered it
- When it was rendered

---

## Step 2: Search by Label

If the template uses `history_label_param`, the display label is searchable. Type a device name or identifier in the search bar to filter the list.

<!-- SCREENSHOT: history-search -->

:::tip
Ask your template admin to set `history_label_param` on frequently used templates. This makes the history list much more navigable.
:::

---

## Step 3: Open a History Entry

Click any row to open the detail view.

<!-- SCREENSHOT: history-detail -->

The detail view shows:
- **Rendered output** — the full text (including metadata header)
- **Parameter values** — every parameter that was in effect (global, project, and template-local)
- **Template breadcrumb** — the full hierarchy path
- **Git SHA** — the exact template file version used at render time

---

## Step 4: Re-render

Click **Re-render** to open the render form pre-filled with all the same parameters.

<!-- SCREENSHOT: history-rerender -->

You can adjust any values before rendering again. The re-render creates a new history entry with the current timestamp.

---

## Step 5: Apply to Another Template

From the history detail view, click **Apply to another template**. A template picker modal opens.

<!-- SCREENSHOT: history-template-picker -->

Select a different template from the same project. The render form opens pre-filled with parameter values from the history record — any parameter whose name matches a parameter in the selected template is pre-populated. Unmatched parameters are left empty.

<!-- SCREENSHOT: history-prefilled-form -->

This is useful when you want to apply the same device's configuration parameters to a different template variant (e.g., switch from a standard config to a hardened variant while keeping the same hostname, site ID, and role).

---

## Summary

You have learned how to:
- Navigate the history list and search by display label
- Inspect a past render's full context (output + parameters + git SHA)
- Re-render with the same or modified parameters
- Transfer parameters to a different template for rapid template switching

---

## What's Next?

- Explore the [User Guide](../user-guide/intro) for a complete reference
- Set up [Presets](../user-guide/presets) to save frequently used parameter bundles
- Learn to [Create a Template](./create-a-template) if you have an editor role
