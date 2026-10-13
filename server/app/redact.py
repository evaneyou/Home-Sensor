"""Hide the home address and path markings from the guest role."""

from __future__ import annotations

from typing import Any

from app.models import UserRole

_DROP = {"tos", "dscp", "dscp_seen"}


def redact(value: Any, role: UserRole) -> Any:
    if role != UserRole.guest:
        return value
    return _scrub(value)


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if key in _DROP:
                continue
            if key == "public_ip":
                cleaned[key] = None
                continue
            cleaned[key] = _scrub(item)
        return cleaned
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value
