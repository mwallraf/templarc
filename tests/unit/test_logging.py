"""
Unit tests for api/core/logging.py — configure_logging().

Verifies that the root logger is set up with the correct formatter type and
level after calling configure_logging() with different arguments.
"""

from __future__ import annotations

import logging

import pytest


@pytest.fixture(autouse=True)
def restore_root_logger():
    """Restore root logger state after each test."""
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    yield
    root.handlers = original_handlers
    root.setLevel(original_level)


def test_configure_logging_text_format():
    from api.core.logging import configure_logging
    configure_logging(level="INFO", fmt="text")
    root = logging.getLogger()
    assert root.level == logging.INFO
    assert len(root.handlers) >= 1
    # Text format should use standard Formatter (not JsonFormatter)
    formatter = root.handlers[0].formatter
    assert isinstance(formatter, logging.Formatter)
    # JsonFormatter is a subclass; ensure plain Formatter was used for text
    try:
        from pythonjsonlogger.jsonlogger import JsonFormatter
        assert not isinstance(formatter, JsonFormatter)
    except ImportError:
        pass  # python-json-logger not installed — ok


def test_configure_logging_json_format():
    from api.core.logging import configure_logging
    configure_logging(level="DEBUG", fmt="json")
    root = logging.getLogger()
    assert root.level == logging.DEBUG
    assert len(root.handlers) >= 1
    formatter = root.handlers[0].formatter
    try:
        from pythonjsonlogger.jsonlogger import JsonFormatter
        assert isinstance(formatter, JsonFormatter)
    except ImportError:
        pytest.skip("python-json-logger not installed")


def test_configure_logging_level_warning():
    from api.core.logging import configure_logging
    configure_logging(level="WARNING", fmt="text")
    root = logging.getLogger()
    assert root.level == logging.WARNING


def test_configure_logging_clears_previous_handlers():
    from api.core.logging import configure_logging
    # Add a dummy handler
    dummy = logging.StreamHandler()
    logging.getLogger().addHandler(dummy)
    configure_logging(level="INFO", fmt="text")
    # After configure_logging, the old dummy handler should be gone
    root = logging.getLogger()
    assert dummy not in root.handlers


def test_configure_logging_file_handler(tmp_path):
    from api.core.logging import configure_logging
    log_file = str(tmp_path / "test.log")
    configure_logging(level="INFO", fmt="text", log_file=log_file)
    root = logging.getLogger()
    handler_types = [type(h).__name__ for h in root.handlers]
    assert "RotatingFileHandler" in handler_types
    # Should also have StreamHandler for stdout
    assert "StreamHandler" in handler_types
