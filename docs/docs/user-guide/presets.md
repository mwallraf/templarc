---
title: Presets
sidebar_position: 6
---

# Presets

Presets are named bundles of parameter values for a template. They let you quickly restore a known configuration without re-typing common values.

## Using a Preset

If presets are available for the current template, a **Load Preset** dropdown appears at the top of the render form.

1. Click the dropdown and select a preset name
2. All parameter values defined in the preset are applied to the form
3. You can still edit any field after loading — presets are just a starting point

## Preset Scope

Presets are defined per template by project editors and admins. They are shared across all users who have access to that template.

## Saving a Preset

:::info
Saving new presets requires the **project_editor** role or above. End users can load presets but cannot create or modify them.
:::

If you have the required role:

1. Fill in the parameter form with the values you want to save
2. Click **Save as Preset** (visible only to editors/admins)
3. Enter a name for the preset
4. Click Save — the preset is now available to all users of this template

## Managing Presets

Admins can rename and delete presets from the **Studio → Parameters** page or directly in the template editor's Presets tab.
