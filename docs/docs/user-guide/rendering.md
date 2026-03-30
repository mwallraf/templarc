---
title: Rendering Templates
sidebar_position: 4
---

# Rendering Templates

Once you have filled in the parameter form, click the **Render** button to generate the output.

## The Render Button

The Render button is located at the bottom of the parameter form. It is disabled until:

- All required parameters have values
- No validation errors exist

## Output Panel

After a successful render, the output panel appears to the right of (or below) the form, showing the generated text. The output includes:

1. **Metadata header** — a comment block at the top showing:
   - Template name and breadcrumb path
   - Git commit SHA of the template
   - Who rendered it and when
   - All resolved parameter values
2. **Template body** — the rendered Jinja2 output

The comment style of the header (e.g., `#`, `!`, `//`, or none) is configured per project by the admin.

**Example output:**

```
! ============================================================
! Template : Router Provisioning / CPE / Cisco / Cisco 891
! Git SHA  : a1b2c3d
! Rendered : admin @ 2026-03-23 14:05:00 UTC
! Params   : router.hostname=router-01, router.site_id=42
! ============================================================

hostname router-01
ntp server 10.0.0.1
ip vrf management
```

## Copy and Download

- **Copy** — copies the full output to the clipboard
- **Download** — downloads the output as a `.txt` file

## Preview Mode (No History)

By default, each render is saved to Render History. If you want a quick preview without saving, toggle the **Preview only** switch before clicking Render. Preview renders are identical in output but are not persisted to the database.

:::tip
Use Preview mode when experimenting with different parameter values. Switch back to the default mode when you're ready to save a canonical version.
:::

## Re-render

On the history detail page you can click **Re-render** to run the same template with the same (pre-filled) parameters again. This creates a new history entry with the current timestamp.
