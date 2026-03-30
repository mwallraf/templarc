---
title: Features
sidebar_position: 7
---

# Features

Features are optional, reusable template add-ons. When a template has features attached, you can enable or disable them before rendering. Each enabled feature appends its own generated block to the render output.

## Feature Use Case

Features let template authors decompose complex configurations into composable building blocks:

```
Base router config           ← always rendered
  + QoS policy feature       ← optional
  + MPLS VPN feature         ← optional
  + Syslog hardening feature ← optional
```

Instead of creating separate templates for every combination, you create one base template and attach features that users toggle as needed.

## Enabling Features

The **Features** section appears at the bottom of the render form when at least one feature is attached to the template.

Each feature is shown as a toggle (checkbox). Features configured as `is_default` are pre-checked when the form loads.

When you toggle a feature on, its parameter fields appear below the toggle, interspersed with any other feature parameters. Fill in these values before rendering.

## Feature Output

Feature output is appended **after** the main template body in the rendered result. Each feature renders as a separate block. The order of features in the output matches the order they appear in the form.

## Feature Parameters

Each feature can define its own parameters (using the same widget types as regular template parameters). These parameters appear only when the feature is enabled.

:::tip
Feature parameters are distinct from template parameters and do not conflict with them, even if they share the same name. Each feature's parameters are namespaced internally.
:::

## Managing Features

Features are created and managed by project admins via **Studio → Features**. Template editors can attach and detach features from templates via the **Features** tab in the Template Editor.
