from __future__ import annotations

import smtplib
from email.message import EmailMessage

from ad_mcp.settings import Settings


class EmailDeliveryError(RuntimeError):
    pass


class SmtpNotConfigured(EmailDeliveryError):
    pass


class PasswordResetEmailer:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()

    def configured(self) -> bool:
        return self.settings.smtp_configured

    def send_password_reset(self, *, to_email: str, reset_url: str, ttl_minutes: int) -> None:
        if not self.configured():
            raise SmtpNotConfigured("SMTP не настроен.")

        message = EmailMessage()
        from_name = self.settings.smtp_from_name.strip() or "HolyMedia MCP"
        from_email = self.settings.smtp_from_email.strip()
        message["Subject"] = "Восстановление пароля HolyMedia MCP"
        message["From"] = f"{from_name} <{from_email}>"
        message["To"] = to_email
        message.set_content(
            "\n".join(
                [
                    "Здравствуйте!",
                    "",
                    "Мы получили запрос на восстановление пароля HolyMedia MCP.",
                    f"Ссылка действует {ttl_minutes} минут:",
                    reset_url,
                    "",
                    "Если вы не запрашивали восстановление, просто проигнорируйте это письмо.",
                    "",
                    "HolyMedia MCP",
                ]
            )
        )

        try:
            if self.settings.smtp_use_ssl:
                with smtplib.SMTP_SSL(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
                    self._login_if_needed(smtp)
                    smtp.send_message(message)
                return

            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
                if self.settings.smtp_use_tls:
                    smtp.starttls()
                self._login_if_needed(smtp)
                smtp.send_message(message)
        except SmtpNotConfigured:
            raise
        except Exception as exc:  # noqa: BLE001 - normalize provider-specific SMTP errors.
            raise EmailDeliveryError("Не удалось отправить письмо восстановления.") from exc

    def _login_if_needed(self, smtp: smtplib.SMTP) -> None:
        username = self.settings.smtp_username.strip()
        password = self.settings.smtp_password
        if username:
            smtp.login(username, password)
