---
title: "Tutorial 2: Render a Template"
sidebar_position: 2
---

# Tutorial 2: Render a Template

**Goal:** Find a template, fill in the form, render output, and copy the result.

**Time:** ~10 minutes

**Who:** End users

---

## Step 1: Open a Leaf Template

From the Catalog, navigate into a project and click a leaf template (one with a render/arrow button, not just a folder icon).

The render form opens on the right side of the screen.

<!-- SCREENSHOT: template-form-empty -->

The form is divided into sections:
- **Global** — `glob.*` parameters shared across the whole org
- **Project** — `proj.*` parameters shared across this project
- **Template** — parameters specific to this template

---

## Step 2: Fill In Required Fields

Fields marked with a red asterisk `*` are required. The **Render** button remains disabled until all required fields have values.

Click into a text field and type a value. For `select` widgets, choose from the dropdown.

<!-- SCREENSHOT: template-form-filled -->

:::tip
Hover over the `?` icon next to a field label to see the description the template author wrote for that parameter.
:::

---

## Step 3: Watch Auto-Fill Trigger

If the template has data source integrations, changing certain fields triggers a server-side lookup. You will see:

1. A spinner in the triggering field while the lookup runs
2. Dependent `readonly` fields populate automatically with fetched values

<!-- SCREENSHOT: on-change-autofill -->

For example, typing a device hostname might trigger a NetBox lookup that fills in the site ID and device role automatically.

---

## Step 4: Click Render

Once all required fields are filled, click the **Render** button at the bottom of the form.

The output panel appears on the right (or below on narrow screens):

<!-- SCREENSHOT: render-output -->

The output includes:
- A metadata comment header (template path, git SHA, who rendered it, parameter values)
- The rendered template body

---

## Step 5: Copy the Output

Click the **Copy** button at the top of the output panel to copy the full rendered text to your clipboard.

<!-- SCREENSHOT: copy-button -->

You can now paste it into your toolchain, a config management system, or a device terminal.

---

## Step 6: Optional — Features

If the template has optional feature add-ons, a **Features** section appears below the main form. Toggle features on or off before rendering to include additional config blocks.

<!-- SCREENSHOT: render-with-features -->

---

## Step 7: Check History

The render was automatically saved to History (unless you enabled **Preview mode**). Navigate to **History** in the sidebar to find it.

---

## Next Steps

- [Create a Template →](./create-a-template) — learn how to author your own templates
- [History and Re-use →](./history-and-reuse) — find past renders and re-use parameters
