"""
Unit tests for api/core/email.py — EmailService.

All tests mock smtplib so no real SMTP server is needed.
"""

from __future__ import annotations

import smtplib
from unittest.mock import MagicMock, patch

import pytest

from api.core.email import EmailService


# ===========================================================================
# Helpers
# ===========================================================================

def _service(host: str = "smtp.example.com") -> EmailService:
    return EmailService(
        smtp_host=host,
        smtp_port=587,
        smtp_user="user@example.com",
        smtp_password="secret",
        smtp_from="noreply@templarc.io",
    )


# ===========================================================================
# Tests
# ===========================================================================


def test_enabled_when_host_set():
    svc = _service("smtp.example.com")
    assert svc.enabled is True


def test_disabled_when_host_empty():
    svc = _service("")
    assert svc.enabled is False


def test_send_password_reset_no_op_when_disabled(caplog):
    """When SMTP_HOST is empty, send_password_reset logs a warning and returns silently."""
    svc = _service("")
    import logging
    with caplog.at_level(logging.WARNING, logger="api.core.email"):
        svc.send_password_reset("test@example.com", "https://example.com/reset?token=abc")

    assert any("SMTP_HOST not configured" in r.message for r in caplog.records)


def test_send_password_reset_calls_smtp():
    """send_password_reset connects via SMTP, sends the email, and does not raise."""
    svc = _service()

    mock_smtp_instance = MagicMock()
    mock_smtp_instance.__enter__ = lambda s: s
    mock_smtp_instance.__exit__ = MagicMock(return_value=False)

    with patch("smtplib.SMTP", return_value=mock_smtp_instance) as mock_smtp_cls:
        svc.send_password_reset("user@example.com", "https://example.com/reset?token=tok")

    mock_smtp_cls.assert_called_once_with("smtp.example.com", 587)
    mock_smtp_instance.ehlo.assert_called_once()
    mock_smtp_instance.starttls.assert_called_once()
    mock_smtp_instance.login.assert_called_once_with("user@example.com", "secret")
    mock_smtp_instance.sendmail.assert_called_once()

    # Verify recipient
    _, call_args, _ = mock_smtp_instance.sendmail.mock_calls[0]
    assert "user@example.com" in call_args[1]


def test_send_password_reset_raises_on_smtp_error():
    """If SMTP raises, send_password_reset re-raises the exception."""
    svc = _service()

    mock_smtp_instance = MagicMock()
    mock_smtp_instance.__enter__ = lambda s: s
    mock_smtp_instance.__exit__ = MagicMock(return_value=False)
    mock_smtp_instance.sendmail.side_effect = smtplib.SMTPException("connection refused")

    with patch("smtplib.SMTP", return_value=mock_smtp_instance):
        with pytest.raises(smtplib.SMTPException):
            svc.send_password_reset("user@example.com", "https://example.com/reset")


def test_skip_login_when_no_user():
    """If smtp_user is empty, smtp.login() must NOT be called."""
    svc = EmailService(
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="",
        smtp_password="",
        smtp_from="noreply@templarc.io",
    )

    mock_smtp_instance = MagicMock()
    mock_smtp_instance.__enter__ = lambda s: s
    mock_smtp_instance.__exit__ = MagicMock(return_value=False)

    with patch("smtplib.SMTP", return_value=mock_smtp_instance):
        svc.send_password_reset("user@example.com", "https://example.com/reset")

    mock_smtp_instance.login.assert_not_called()
