---
title: Macros
sidebar_position: 10
---

# Macros

Jinja2 macros are reusable template fragments defined with `{% macro %}` and called like functions. In Templarc, macros are stored as `.j2` files in the project's Git path and included via Jinja2's native `{% include %}` directive.

## Defining a Macro

Create a `.j2` file in the project's Git path. Macro files have no YAML frontmatter — they contain only Jinja2 content:

**`shared/interface_block.j2`**
```jinja2
{% macro interface_config(name, ip, desc) %}
interface {{ name }}
 description {{ desc }}
 ip address {{ ip | ipaddr('address') }} {{ ip | ipaddr('netmask') }}
 no shutdown
{% endmacro %}
```

## Using a Macro in a Template

```jinja2
{% include "shared/interface_block.j2" %}

{{ interface_config("GigabitEthernet0/0", "10.0.0.1/24", "Uplink to core") }}
{{ interface_config("GigabitEthernet0/1", "192.168.1.1/30", "Customer link") }}
```

:::tip
The `{% include %}` directive resolves paths relative to the project's `git_path`. Use paths relative to that root, not the filesystem root.
:::

## Macro Scoping Rules

Variables set at template level are **not** accessible inside macros. Pass all required data as macro arguments:

```jinja2
{# WRONG — router.hostname is not accessible inside the macro #}
{% macro bad_macro() %}
  hostname {{ router.hostname }}  {# This will be empty! #}
{% endmacro %}

{# CORRECT — pass the value as an argument #}
{% macro good_macro(hostname) %}
  hostname {{ hostname }}
{% endmacro %}

{{ good_macro(router.hostname) }}
```

## Managing Macro Files

Macro files are plain `.j2` files stored in Git. They are **not** registered in the database as templates — they are content-only fragments. Manage them directly in your Git repository or via the API's Git service.

The template editor's file browser (if available) lets you view files in the project's Git path but does not add frontmatter-less files to the template catalog.
