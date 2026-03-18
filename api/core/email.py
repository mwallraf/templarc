"""
Email service for Templarc.

Sends transactional emails via SMTP (smtplib). No third-party SDK required —
works with any SMTP relay (Gmail, Mailgun SMTP, SendGrid SMTP, self-hosted).

Configuration (all optional — email is disabled when SMTP_HOST is empty):
    SMTP_HOST       SMTP server hostname
    SMTP_PORT       Port (default 587 for STARTTLS)
    SMTP_USER       SMTP login username
    SMTP_PASSWORD   SMTP login password
    SMTP_FROM       From address (default noreply@templarc.io)

If SMTP_HOST is empty, send_* methods log a warning and return without raising.
This allows the API to function without email configured (e.g. dev/self-hosted).
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(
        self,
        smtp_host: str,
        smtp_port: int,
        smtp_user: str,
        smtp_password: str,
        smtp_from: str,
    ) -> None:
        self._host = smtp_host
        self._port = smtp_port
        self._user = smtp_user
        self._password = smtp_password
        self._from = smtp_from

    @property
    def enabled(self) -> bool:
        return bool(self._host)

    def _send(self, to: str, subject: str, html: str) -> None:
        """Low-level SMTP send. Raises on failure."""
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = self._from
        msg["To"] = to
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(self._host, self._port) as smtp:
            smtp.ehlo()
            smtp.starttls()
            if self._user:
                smtp.login(self._user, self._password)
            smtp.sendmail(self._from, [to], msg.as_string())

    def send_password_reset(self, to_email: str, reset_url: str) -> None:
        """
        Send a password reset email.

        If SMTP is not configured, logs a warning and returns silently.
        """
        if not self.enabled:
            logger.warning(
                "EmailService: SMTP_HOST not configured — skipping password reset email to %s",
                to_email,
            )
            return

        subject = "Reset your Templarc password"
        html = f"""
        <html><body style="font-family:sans-serif;color:#1e293b;padding:32px">
          <h2 style="margin-bottom:8px">Reset your password</h2>
          <p>Click the link below to set a new password. This link expires in <strong>15 minutes</strong>.</p>
          <p style="margin:24px 0">
            <a href="{reset_url}"
               style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;
                      text-decoration:none;font-weight:600">
              Reset password
            </a>
          </p>
          <p style="color:#64748b;font-size:13px">
            If you didn't request a password reset, you can ignore this email.<br>
            Direct link: <a href="{reset_url}">{reset_url}</a>
          </p>
        </body></html>
        """
        try:
            self._send(to_email, subject, html)
            logger.info("Password reset email sent to %s", to_email)
        except Exception as exc:
            logger.error("Failed to send password reset email to %s: %s", to_email, exc)
            raise


def get_email_service() -> EmailService:
    """FastAPI dependency — returns configured EmailService singleton."""
    from api.config import get_settings
    s = get_settings()
    return EmailService(
        smtp_host=s.SMTP_HOST,
        smtp_port=s.SMTP_PORT,
        smtp_user=s.SMTP_USER,
        smtp_password=s.SMTP_PASSWORD,
        smtp_from=s.SMTP_FROM,
    )
