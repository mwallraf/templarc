"""
Structured logging configuration for Templarc.

Call ``configure_logging()`` once at process start (top of api/main.py, before
app construction) to set up the root logger with the selected format.

Env vars (via api/config.py Settings):
  LOG_LEVEL  — DEBUG | INFO | WARNING | ERROR (default: INFO)
  LOG_FORMAT — "text" (human-readable) | "json" (machine-parseable, default)
  LOG_FILE   — absolute path for rotating file output (default: empty = stdout only)
               When set, logs go to BOTH stdout AND the file simultaneously.
               Parent directory is created automatically if it does not exist.
               Rotation: 10 MB per file, 5 backups (total max ~50 MB).
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys


def configure_logging(level: str = "INFO", fmt: str = "text", log_file: str = "") -> None:
    """
    Configure the root Python logger.

    Parameters
    ----------
    level:
        Log level string: DEBUG | INFO | WARNING | ERROR.
    fmt:
        "json"  → machine-parseable JSON lines (pythonjsonlogger)
        "text"  → human-readable  %(asctime)s %(levelname)s %(name)s: %(message)s
    log_file:
        Absolute path for rotating file output.  Empty string = stdout only.
        When non-empty, logs go to BOTH stdout AND the rotating file.
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    if fmt.lower() == "json":
        try:
            from pythonjsonlogger.jsonlogger import JsonFormatter
            formatter: logging.Formatter = JsonFormatter(
                "%(asctime)s %(levelname)s %(name)s %(message)s",
                rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
            )
        except ImportError:
            # Graceful fallback: python-json-logger not installed
            formatter = logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s: %(message)s"
            )
    else:
        formatter = logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s"
        )

    root = logging.getLogger()
    # Remove any handlers added by basicConfig or previous calls
    root.handlers.clear()
    root.setLevel(numeric_level)

    # Always: StreamHandler → stdout
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    # Optional: RotatingFileHandler
    if log_file:
        parent_dir = os.path.dirname(log_file)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

    # Suppress noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
