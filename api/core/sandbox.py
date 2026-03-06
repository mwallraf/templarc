"""
Sandboxed Python code execution for custom Jinja2 filters and objects.

Validation pipeline
-------------------
1. ``ast.parse(code)`` — catches syntax errors before any execution
2. Top-level structure check — must be exactly one FunctionDef, AsyncFunctionDef,
   or ClassDef (no bare scripts, no multiple definitions)
3. AST walk — blocks Import/ImportFrom nodes; blocks a set of dangerous built-in
   names; blocks dunder attribute access (except a safe allowlist)
4. Restricted ``exec()`` — runs inside a minimal ``__builtins__`` whitelist so
   even if the AST walk misses something, the execution environment is constrained

The async ``sandbox_test`` helper runs the compiled callable with a test input
in a ``ThreadPoolExecutor`` with a 100 ms timeout via ``asyncio.wait_for``.

Security note
-------------
This sandbox is designed for *trusted administrators*, not arbitrary internet
users.  It blocks the most common escape vectors but is not a hardened
production sandbox.  For fully untrusted code consider RestrictedPython,
PyPy sandbox, or a subprocess-based approach.
"""

from __future__ import annotations

import ast
import asyncio
import logging
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Blocked / allowed sets
# ---------------------------------------------------------------------------

_BLOCKED_NODES = (ast.Import, ast.ImportFrom)

_BLOCKED_NAMES: frozenset[str] = frozenset({
    "__import__",
    "open",
    "exec",
    "eval",
    "compile",
    "__builtins__",
    "globals",
    "locals",
    "vars",
    "breakpoint",
    "input",
    "memoryview",
    "bytearray",
    "bytes",
})

# Dunder attributes allowed inside user code (e.g., class __init__)
_ALLOWED_DUNDERS: frozenset[str] = frozenset({
    "__init__",
    "__str__",
    "__repr__",
    "__call__",
    "__len__",
    "__iter__",
    "__next__",
    "__getitem__",
    "__setitem__",
    "__contains__",
    "__eq__",
    "__lt__",
    "__gt__",
    "__le__",
    "__ge__",
    "__add__",
    "__mul__",
})

# Minimal safe builtins available inside sandboxed code
_SAFE_BUILTINS: dict[str, Any] = {
    "len": len,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "set": set,
    "frozenset": frozenset,
    "max": max,
    "min": min,
    "sum": sum,
    "abs": abs,
    "round": round,
    "range": range,
    "enumerate": enumerate,
    "zip": zip,
    "sorted": sorted,
    "reversed": reversed,
    "map": map,
    "filter": filter,
    "any": any,
    "all": all,
    "isinstance": isinstance,
    "issubclass": issubclass,
    "type": type,
    "repr": repr,
    "format": format,
    "hex": hex,
    "oct": oct,
    "bin": bin,
    "chr": chr,
    "ord": ord,
    "hasattr": hasattr,
    "print": print,  # harmless for debugging; output goes to stdout only
    "None": None,
    "True": True,
    "False": False,
    "NotImplemented": NotImplemented,
    "Ellipsis": ...,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "KeyError": KeyError,
    "IndexError": IndexError,
    "AttributeError": AttributeError,
    "Exception": Exception,
    "StopIteration": StopIteration,
    "RuntimeError": RuntimeError,
    # Required for class-statement execution (Python internal class builder)
    "__build_class__": __build_class__,
    "__name__": "<sandbox>",
}


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------

class SandboxError(Exception):
    """Raised when code fails sandbox validation, compilation, or execution."""


# ---------------------------------------------------------------------------
# Core validator / compiler
# ---------------------------------------------------------------------------

def validate_and_compile(code: str) -> Callable:
    """
    Parse, validate, and exec a Python function or class string in a
    restricted environment.  Returns the first callable defined in the code.

    Parameters
    ----------
    code:
        Python source code containing exactly one top-level function or class.

    Returns
    -------
    Callable
        The compiled function or class (for classes, the class itself is
        returned so templates can instantiate it).

    Raises
    ------
    SandboxError
        On any syntax error, structural violation, blocked construct, or
        execution-time exception.
    """
    # 1 — Syntax check
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise SandboxError(f"Syntax error: {exc}") from exc

    # 2 — AST walk (security-critical checks run BEFORE structural check so
    #     "import os\ndef f(v): return v" gets the Import error, not the
    #     "exactly one definition" error)
    for node in ast.walk(tree):
        if isinstance(node, _BLOCKED_NODES):
            raise SandboxError("Import statements are not allowed")

        if isinstance(node, ast.Name) and node.id in _BLOCKED_NAMES:
            raise SandboxError(f"Use of '{node.id}' is not allowed")

        if isinstance(node, ast.Attribute):
            attr = node.attr
            if (
                attr.startswith("__")
                and attr.endswith("__")
                and attr not in _ALLOWED_DUNDERS
            ):
                raise SandboxError(f"Dunder attribute '{attr}' is not allowed")

    # 3 — Structural check: exactly one top-level definition
    if len(tree.body) != 1 or not isinstance(
        tree.body[0], (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    ):
        raise SandboxError(
            "Code must contain exactly one top-level function or class definition"
        )

    # 4 — Restricted exec
    restricted_globals: dict[str, Any] = {
        "__builtins__": _SAFE_BUILTINS,
    }
    local_ns: dict[str, Any] = {}
    try:
        exec(compile(tree, "<sandbox>", "exec"), restricted_globals, local_ns)  # noqa: S102
    except Exception as exc:
        raise SandboxError(f"Execution error: {exc}") from exc

    callables = [v for v in local_ns.values() if callable(v)]
    if not callables:
        raise SandboxError("No callable defined in code")

    return callables[0]


# ---------------------------------------------------------------------------
# Async timeout test
# ---------------------------------------------------------------------------

async def sandbox_test(
    func: Callable,
    test_input: Any = "test_value",
    timeout: float = 0.1,
) -> Any:
    """
    Run ``func(test_input)`` in a daemon thread with a timeout.

    Parameters
    ----------
    func:
        A callable produced by :func:`validate_and_compile`.
    test_input:
        Value passed as the sole argument to *func*.
    timeout:
        Maximum execution time in seconds (default 100 ms).

    Returns
    -------
    Any
        The return value of ``func(test_input)``.

    Raises
    ------
    SandboxError
        On timeout or any exception raised by *func*.
    """
    # We spin up a daemon thread so that a timed-out infinite-loop thread
    # never blocks the process (or the test runner) from exiting.
    # daemon=True must be set BEFORE Thread.start(), not via an initializer.
    loop = asyncio.get_running_loop()
    done: asyncio.Future = loop.create_future()

    def _run() -> None:
        try:
            result = func(test_input)
            loop.call_soon_threadsafe(done.set_result, result)
        except Exception as exc:  # noqa: BLE001
            loop.call_soon_threadsafe(done.set_exception, exc)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    try:
        return await asyncio.wait_for(asyncio.shield(done), timeout=timeout)
    except asyncio.TimeoutError:
        raise SandboxError(
            f"Function exceeded {int(timeout * 1000)} ms execution limit"
        )
    except Exception as exc:
        raise SandboxError(f"Test execution failed: {exc}") from exc
