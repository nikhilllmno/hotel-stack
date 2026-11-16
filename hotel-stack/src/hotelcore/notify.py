"""Outbound messages: SMS through Twilio, alerts through Slack. Both optional; tools fall back when absent."""

import os
from dataclasses import dataclass

import httpx


class SendError(RuntimeError):
    pass


@dataclass
class TwilioSms:
    account_sid: str
    auth_token: str
    from_number: str

    @classmethod
    def from_env(cls) -> "TwilioSms | None":
        sid, token, number = (os.environ.get(k, "") for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"))
        return cls(sid, token, number) if sid and token and number else None

    def send(self, to: str, body: str) -> str:
        r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json",
                       auth=(self.account_sid, self.auth_token), data={"To": to, "From": self.from_number, "Body": body}, timeout=15)
        if r.is_error:
            raise SendError(f"Twilio {r.status_code}: {r.json().get('message', r.text[:200])}")
        return r.json()["sid"]


@dataclass
class SlackAlerts:
    bot_token: str
    channel: str  # a channel id, or a user id for a direct message

    @classmethod
    def from_env(cls, default_channel: str = "") -> "SlackAlerts | None":
        token = os.environ.get("SLACK_BOT_TOKEN", "")
        channel = os.environ.get("SLACK_ALERT_CHANNEL", "") or default_channel
        return cls(token, channel) if token and channel else None

    def post(self, text: str) -> None:
        r = httpx.post("https://slack.com/api/chat.postMessage", headers={"Authorization": f"Bearer {self.bot_token}"},
                       json={"channel": self.channel, "text": text}, timeout=10).json()
        if not r.get("ok"):
            raise SendError(f"Slack: {r.get('error')}")
