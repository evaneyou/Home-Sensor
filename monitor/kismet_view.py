"""Turn Kismet JSON into the airwave upload. No network and no database."""

from __future__ import annotations


def iw_scan_skipped(mode: str, radio: str | None) -> bool:
    """Kismet owns the second adapter. The link adapter still uses iw when it is the only radio."""
    return mode == "kismet" and bool(radio)


def randomized_mac(mac: str) -> bool:
    try:
        first = int(mac.split(":", 1)[0], 16)
    except (ValueError, IndexError):
        return False
    return bool(first & 0x02)


def _band_channel(frequency: int, channel_text: str) -> tuple[str, int] | None:
    channel = 0
    digits = "".join(char for char in channel_text if char.isdigit())
    if digits:
        channel = int(digits)
    if frequency >= 5955:
        return None
    if 2412 <= frequency <= 2484:
        band = "2.4"
        if channel <= 0:
            channel = 14 if frequency == 2484 else (frequency - 2407) // 5
    elif 5000 <= frequency < 5900:
        band = "5"
        if channel <= 0:
            channel = (frequency - 5000) // 5
    elif channel > 0 and channel <= 14:
        band = "2.4"
    elif channel > 14:
        band = "5"
    else:
        return None
    if channel <= 0:
        return None
    return band, channel


def _signal(device: dict) -> float:
    raw = device.get("kismet.device.base.signal")
    if isinstance(raw, dict):
        value = raw.get("kismet.common.signal.last_signal")
        if isinstance(value, (int, float)):
            return float(value)
    if isinstance(raw, (int, float)):
        return float(raw)
    return -100.0


def _dot11(device: dict) -> dict:
    raw = device.get("dot11.device")
    return raw if isinstance(raw, dict) else {}


def _mac(value: object) -> str:
    text = str(value or "").strip().lower()
    parts = text.split(":")
    if len(parts) != 6:
        return ""
    return text


def map_devices(devices: list[dict]) -> dict[str, list[dict]]:
    aps = []
    clients = []
    for device in devices:
        if not isinstance(device, dict):
            continue
        mac = _mac(device.get("kismet.device.base.macaddr"))
        if not mac:
            continue
        frequency = device.get("kismet.device.base.frequency")
        freq = int(frequency) if isinstance(frequency, (int, float)) else 0
        channel_text = str(device.get("kismet.device.base.channel") or "")
        placed = _band_channel(freq, channel_text)
        if placed is None:
            continue
        band, channel = placed
        kind = str(device.get("kismet.device.base.type") or "").lower()
        dot11 = _dot11(device)
        signal = _signal(device)
        last_seen = device.get("kismet.device.base.last_time")
        if "ap" in kind and "client" not in kind:
            count = dot11.get("dot11.device.num_associated_clients")
            aps.append(
                {
                    "bssid": mac,
                    "ssid": str(device.get("kismet.device.base.name") or "")[:64],
                    "band": band,
                    "channel": channel,
                    "signal": signal,
                    "client_count": int(count) if isinstance(count, (int, float)) else 0,
                }
            )
            continue
        bssid = _mac(dot11.get("dot11.device.last_bssid"))
        if not bssid:
            continue
        clients.append(
            {
                "mac": mac,
                "bssid": bssid,
                "signal": signal,
                "last_seen": int(last_seen) if isinstance(last_seen, (int, float)) else 0,
                "randomized": randomized_mac(mac),
            }
        )
    return {"aps": aps, "clients": clients}


def visible_clients(clients: list[dict], trusted_bssids: set[str]) -> list[dict]:
    trusted = {item.lower() for item in trusted_bssids}
    return [client for client in clients if str(client.get("bssid") or "").lower() in trusted]


def map_channels(rows: list[dict]) -> list[dict]:
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        frequency = row.get("kismet.channel.frequency", row.get("kismet.channel.freq"))
        freq = int(frequency) if isinstance(frequency, (int, float)) else 0
        placed = _band_channel(freq, str(row.get("kismet.channel.channel") or ""))
        if placed is None:
            continue
        band, channel = placed
        airtime = row.get("kismet.channel.airtime", row.get("airtime"))
        packets = row.get("kismet.channel.packets", row.get("packets"))
        found.append(
            {
                "band": band,
                "channel": channel,
                "airtime_pct": float(airtime) if isinstance(airtime, (int, float)) else None,
                "packets": int(packets) if isinstance(packets, (int, float)) else None,
            }
        )
    return found


def map_alerts(rows: list[dict]) -> list[dict]:
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kismet.alert.header") or row.get("type") or "ALERT")[:64]
        text = str(row.get("kismet.alert.text") or row.get("text") or "")[:500]
        bssid = _mac(row.get("kismet.alert.bssid") or row.get("bssid") or row.get("kismet.alert.device_key"))
        moment = row.get("kismet.alert.timestamp", row.get("ts"))
        found.append(
            {
                "type": kind,
                "bssid": bssid,
                "text": text,
                "ts": int(moment) if isinstance(moment, (int, float)) else 0,
            }
        )
    return found


def as_list(payload: object) -> list:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("devices", "alerts", "channels"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []
