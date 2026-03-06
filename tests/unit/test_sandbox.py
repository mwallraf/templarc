"""
Unit tests for api/core/sandbox.py.

Tests the AST validation pipeline and the async timeout test helper.
"""

from __future__ import annotations

import pytest

from api.core.sandbox import SandboxError, sandbox_test, validate_and_compile


# ---------------------------------------------------------------------------
# validate_and_compile — valid inputs
# ---------------------------------------------------------------------------

class TestValidateAndCompileValid:
    def test_simple_filter_function(self):
        code = "def shorten(v):\n    return str(v)[:8]"
        func = validate_and_compile(code)
        assert callable(func)
        assert func("hello world") == "hello wo"

    def test_filter_using_safe_builtins(self):
        code = "def upper_len(v):\n    return str(v).upper() + str(len(str(v)))"
        func = validate_and_compile(code)
        assert callable(func)

    def test_class_definition(self):
        code = (
            "class Router:\n"
            "    def __init__(self, site_id):\n"
            "        self.site_id = site_id\n"
            "    def loopback(self):\n"
            "        return f'10.0.{self.site_id}.1'"
        )
        cls = validate_and_compile(code)
        assert callable(cls)
        r = cls(5)
        assert r.loopback() == "10.0.5.1"

    def test_function_with_conditional(self):
        code = "def maybe_upper(v):\n    return str(v).upper() if isinstance(v, str) else v"
        func = validate_and_compile(code)
        assert func("hi") == "HI"
        assert func(42) == 42

    def test_function_returning_list(self):
        code = "def split_words(v):\n    return str(v).split()"
        func = validate_and_compile(code)
        assert func("hello world") == ["hello", "world"]


# ---------------------------------------------------------------------------
# validate_and_compile — blocked constructs
# ---------------------------------------------------------------------------

class TestValidateAndCompileBlocked:
    def test_import_blocked(self):
        code = "import os\ndef f(v): return v"
        with pytest.raises(SandboxError, match="Import"):
            validate_and_compile(code)

    def test_from_import_blocked(self):
        code = "from os import path\ndef f(v): return v"
        with pytest.raises(SandboxError, match="Import"):
            validate_and_compile(code)

    def test_open_blocked(self):
        code = "def f(v):\n    return open(v).read()"
        with pytest.raises(SandboxError, match="open"):
            validate_and_compile(code)

    def test_exec_blocked(self):
        code = "def f(v):\n    exec(v)"
        with pytest.raises(SandboxError, match="exec"):
            validate_and_compile(code)

    def test_globals_blocked(self):
        code = "def f(v):\n    return globals()"
        with pytest.raises(SandboxError, match="globals"):
            validate_and_compile(code)

    def test_dunder_subclasses_blocked(self):
        code = "def f(v):\n    return ().__class__.__subclasses__()"
        with pytest.raises(SandboxError, match="__subclasses__"):
            validate_and_compile(code)

    def test_multiple_top_level_defs_blocked(self):
        code = "def f(v): return v\ndef g(v): return v"
        with pytest.raises(SandboxError, match="exactly one"):
            validate_and_compile(code)

    def test_bare_statement_blocked(self):
        code = "x = 1 + 2"
        with pytest.raises(SandboxError, match="exactly one"):
            validate_and_compile(code)

    def test_syntax_error(self):
        code = "def f(v: return v"
        with pytest.raises(SandboxError, match="Syntax error"):
            validate_and_compile(code)

    def test_empty_code_blocked(self):
        code = ""
        with pytest.raises(SandboxError):
            validate_and_compile(code)


# ---------------------------------------------------------------------------
# sandbox_test — async runner
# ---------------------------------------------------------------------------

class TestSandboxTest:
    @pytest.mark.asyncio
    async def test_runs_and_returns_value(self):
        code = "def f(v): return str(v).upper()"
        func = validate_and_compile(code)
        result = await sandbox_test(func, "hello")
        assert result == "HELLO"

    @pytest.mark.asyncio
    async def test_default_test_input(self):
        code = "def f(v): return len(str(v))"
        func = validate_and_compile(code)
        result = await sandbox_test(func)  # default input = "test_value"
        assert result == len("test_value")

    @pytest.mark.asyncio
    async def test_timeout_raises_sandbox_error(self):
        # An infinite loop should hit the 100 ms timeout
        code = "def f(v):\n    while True: pass"
        func = validate_and_compile(code)
        with pytest.raises(SandboxError, match="exceeded"):
            await sandbox_test(func, timeout=0.05)

    @pytest.mark.asyncio
    async def test_runtime_exception_raises_sandbox_error(self):
        code = "def f(v):\n    raise ValueError('boom')"
        func = validate_and_compile(code)
        with pytest.raises(SandboxError, match="boom"):
            await sandbox_test(func)
