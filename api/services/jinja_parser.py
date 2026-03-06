"""
Jinja2 AST parser — extract structural information from template strings.

Uses Jinja2's built-in parser (Environment().parse()) to walk the AST and
collect:

  - extract_variables   — all variable references (simple names and attribute
                          chains like router.hostname, glob.ntp_server)
  - extract_filters_used — names of every filter applied in the template
  - extract_blocks       — names of every {% block %} defined in the template

These functions operate on the raw template body (frontmatter already stripped).
They are used when a user saves a template to automatically suggest which
parameters should be added (or already exist) in the parameter registry.

Design decisions:
  - A single shared jinja2.Environment is used purely for parsing. It has
    undefined=Undefined (the default) and no custom filters/globals, which is
    intentional: we only care about the AST structure, not evaluation.
  - Variable paths are built by recursively walking jinja2.nodes.Getattr and
    jinja2.nodes.Name nodes, producing dotted strings (e.g. "router.iface.ip").
  - Duplicate paths are deduplicated while preserving first-seen order.
  - Jinja2 internal variables (the special `loop` variable, `range`, `dict`,
    etc.) are not filtered out here — callers that want to exclude built-ins
    should check against the known Jinja2 globals if needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import jinja2
import jinja2.nodes


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VariableRef:
    """A variable reference found in a Jinja2 template."""
    name: str                          # root name (e.g. "router", "glob")
    type: Literal["simple", "attribute"]  # "simple" = bare name, "attribute" = dotted path
    full_path: str                     # full dotted path (e.g. "router.hostname")


# ---------------------------------------------------------------------------
# Module-level shared environment (parse-only)
# ---------------------------------------------------------------------------

_parse_env = jinja2.Environment()


# ---------------------------------------------------------------------------
# Internal AST helpers
# ---------------------------------------------------------------------------

def _node_to_path(node: jinja2.nodes.Expr) -> str | None:
    """
    Recursively convert a Name or Getattr node into a dotted path string.

    Returns None for any other node type (subscripts, calls, literals, etc.)
    that cannot be represented as a plain dotted identifier.
    """
    if isinstance(node, jinja2.nodes.Name):
        return node.name
    if isinstance(node, jinja2.nodes.Getattr):
        parent = _node_to_path(node.node)
        if parent is None:
            return None
        return f"{parent}.{node.attr}"
    return None


def _walk_variables(node: jinja2.nodes.Node, seen: dict[str, VariableRef]) -> None:
    """
    Walk the AST and populate *seen* with VariableRef instances.

    *seen* is keyed by full_path to deduplicate while preserving first-seen
    order (dict insertion order is stable in Python 3.7+).
    """
    # Collect the outermost name/attribute chains first, then recurse into
    # child nodes that are NOT part of the current chain.
    if isinstance(node, (jinja2.nodes.Name, jinja2.nodes.Getattr)):
        path = _node_to_path(node)
        if path and path not in seen:
            root = path.split(".")[0]
            ref = VariableRef(
                name=root,
                type="simple" if "." not in path else "attribute",
                full_path=path,
            )
            seen[path] = ref
        # For Getattr we still recurse into child nodes to pick up any nested
        # references that appear in subscript expressions, but we skip the
        # `node.node` child because it was already consumed by _node_to_path.
        if isinstance(node, jinja2.nodes.Getattr):
            # Only visit non-chain children (none for Getattr, which has only
            # .node and .attr — .attr is a plain string, not a node).
            return
        # For plain Name nodes there are no children to visit.
        return

    for child in node.iter_child_nodes():
        _walk_variables(child, seen)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_variables(template_str: str) -> list[VariableRef]:
    """
    Return all variable references in *template_str*, deduplicated and in
    first-seen order.

    Args:
        template_str: Jinja2 template body with frontmatter already stripped.

    Returns:
        List of VariableRef dataclasses.

    Raises:
        jinja2.TemplateSyntaxError: if the template cannot be parsed.
    """
    ast = _parse_env.parse(template_str)
    seen: dict[str, VariableRef] = {}
    _walk_variables(ast, seen)
    return list(seen.values())


def extract_filters_used(template_str: str) -> list[str]:
    """
    Return the names of every filter used in *template_str*, deduplicated and
    in first-seen order.

    Only filter *names* are returned — arguments are ignored.

    Args:
        template_str: Jinja2 template body with frontmatter already stripped.

    Returns:
        List of filter name strings (e.g. ["mb_to_kbps", "default", "upper"]).

    Raises:
        jinja2.TemplateSyntaxError: if the template cannot be parsed.
    """
    ast = _parse_env.parse(template_str)
    seen: dict[str, None] = {}
    for node in ast.find_all(jinja2.nodes.Filter):
        if node.name and node.name not in seen:
            seen[node.name] = None
    return list(seen.keys())


def extract_blocks(template_str: str) -> list[str]:
    """
    Return the names of every ``{% block %}`` defined in *template_str*,
    deduplicated and in first-seen order.

    Args:
        template_str: Jinja2 template body with frontmatter already stripped.

    Returns:
        List of block name strings (e.g. ["content", "footer"]).

    Raises:
        jinja2.TemplateSyntaxError: if the template cannot be parsed.
    """
    ast = _parse_env.parse(template_str)
    seen: dict[str, None] = {}
    for node in ast.find_all(jinja2.nodes.Block):
        if node.name and node.name not in seen:
            seen[node.name] = None
    return list(seen.keys())
