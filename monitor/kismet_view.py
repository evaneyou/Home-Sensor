"""Turn Kismet JSON into the airwave upload. No network and no database."""

from __future__ import annotations


# Top-level fields this module reads. A list names a complex field and the children we keep.
DEVICE_FIELDS = [
    "kismet.device.base.macaddr",
    "kismet.device.base.name",
    "kismet.device.base.type",
    "kismet.device.base.channel",
    "kismet.device.base.frequency",
    "kismet.device.base.manuf",
    "kismet.device.base.first_time",
    "kismet.device.base.last_time",
    [
        "kismet.device.base.signal",
        "kismet.common.signal.last_signal",
        "kismet.common.signal.min_signal",
        "kismet.common.signal.max_signal",
    ],
    [
        "kismet.device.base.packets",
        "kismet.device.base.packets.total",
        "kismet.device.base.packets.data",
    ],
    "kismet.device.base.datasize",
    [
        "dot11.device",
        "dot11.device.last_bssid",
        "dot11.device.num_associated_clients",
        "dot11.device.num_retries",
        "dot11.device.client_disconnects",
        "dot11.device.probed_ssid_map",
    ],
]


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
    if 1 <= channel <= 14:
        return "2.4", channel
    if channel > 14:
        return "5", channel
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


def _mhz(frequency: int | float) -> int:
    """Kismet reports kismet.device.base.frequency and channel frequency in kHz."""
    return int(frequency) // 1000


def _signal_span(device: dict) -> tuple[float | None, float | None, float | None]:
    raw = device.get("kismet.device.base.signal")

    def known(value: object) -> float | None:
        if isinstance(value, (int, float)) and value != 0:
            return float(value)
        return None

    if isinstance(raw, dict):
        return (
            known(raw.get("kismet.common.signal.last_signal")),
            known(raw.get("kismet.common.signal.min_signal")),
            known(raw.get("kismet.common.signal.max_signal")),
        )
    last = known(raw)
    return last, None, None


def _count(source: dict, *keys: str) -> int | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return None


def _probed_ssids(dot11: dict) -> list[str]:
    raw = dot11.get("dot11.device.probed_ssid_map") or []
    if isinstance(raw, dict):
        raw = list(raw.values())
    names: list[str] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("dot11.probedssid.ssid") or "").strip()
        if name and name not in names:
            names.append(name[:64])
    return names[:12]


def _signal(device: dict) -> float:
    last, _low, _high = _signal_span(device)
    return last if last is not None else -100.0


def _dot11(device: dict) -> dict:
    raw = device.get("dot11.device")
    return raw if isinstance(raw, dict) else {}


def _vendor(device: dict) -> str:
    text = str(device.get("kismet.device.base.manuf") or "").strip()
    if not text or text.lower() == "unknown":
        return ""
    return text[:64]


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
        freq = _mhz(int(frequency)) if isinstance(frequency, (int, float)) else 0
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
        last_signal, signal_min, signal_max = _signal_span(device)
        first_seen = device.get("kismet.device.base.first_time")
        clients.append(
            {
                "mac": mac,
                "bssid": bssid,
                "signal": last_signal if last_signal is not None else 0,
                "signal_min": signal_min,
                "signal_max": signal_max,
                "last_seen": int(last_seen) if isinstance(last_seen, (int, float)) else 0,
                "first_seen": int(first_seen) if isinstance(first_seen, (int, float)) else 0,
                "randomized": randomized_mac(mac),
                "vendor": _vendor(device),
                "band": band,
                "channel": channel,
                "packets": _count(device, "kismet.device.base.packets.total", "kismet.device.base.packets.data"),
                "data_bytes": _count(device, "kismet.device.base.datasize"),
                "retries": _count(dot11, "dot11.device.num_retries"),
                "disconnects": _count(dot11, "dot11.device.client_disconnects"),
                "probed_ssids": _probed_ssids(dot11),
            }
        )
    return {"aps": aps, "clients": clients}


def visible_clients(clients: list[dict], trusted_bssids: set[str]) -> list[dict]:
    trusted = {item.lower() for item in trusted_bssids}
    return [client for client in clients if str(client.get("bssid") or "").lower() in trusted]


def channel_rows(payload: object) -> list[dict]:
    """`/channels/channels.json` is a dict. Records live in the frequency map."""
    if not isinstance(payload, dict):
        return []
    freq_map = payload.get("kismet.channeltracker.frequency_map")
    if not isinstance(freq_map, dict):
        return []
    return [row for row in freq_map.values() if isinstance(row, dict)]


def _rrd_last_minute(rrd: object) -> int | None:
    if not isinstance(rrd, dict):
        return None
    vec = rrd.get("kismet.common.rrd.minute_vec")
    if isinstance(vec, dict):
        vec = vec.get("kismet.common.rrd.minute_vec")
    if not isinstance(vec, list) or not vec:
        return None
    last = vec[-1]
    if isinstance(last, bool) or not isinstance(last, (int, float)):
        return None
    return int(last)


def map_channels(rows: list[dict]) -> list[dict]:
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        frequency = row.get("kismet.channelrec.frequency")
        freq = _mhz(frequency) if isinstance(frequency, (int, float)) else 0
        placed = _band_channel(freq, str(row.get("kismet.channelrec.channel") or ""))
        if placed is None:
            continue
        band, channel = placed
        found.append(
            {
                "band": band,
                "channel": channel,
                "airtime_pct": None,
                "packets": _rrd_last_minute(row.get("kismet.channelrec.packets_rrd")),
                "devices": _rrd_last_minute(row.get("kismet.channelrec.device_rrd")),
                "busy_pct": None,
            }
        )
    return found


def _alert_mac(row: dict) -> str:
    for key in ("kismet.alert.transmitter_mac", "kismet.alert.source_mac", "kismet.alert.other_mac"):
        mac = _mac(row.get(key))
        if mac:
            return mac
    return ""


def map_alerts(rows: list[dict]) -> list[dict]:
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kismet.alert.header") or "ALERT")[:64]
        text = str(row.get("kismet.alert.text") or "")[:500]
        moment = row.get("kismet.alert.timestamp")
        digest = row.get("kismet.alert.hash")
        found.append(
            {
                "type": kind,
                "bssid": _alert_mac(row),
                "text": text,
                "ts": int(moment) if isinstance(moment, (int, float)) else 0,
                "hash": "" if digest in (None, "") else str(digest)[:128],
            }
        )
    return found


def map_kismet_capture(devices: object, channels: object, alerts: object) -> dict[str, list[dict]]:
    """The mapping `kismet_once` applies to one devices, channels, and alerts payload."""
    mapped = map_devices(as_list(devices))
    return {
        "aps": mapped["aps"],
        "clients": mapped["clients"],
        "channels": map_channels(channel_rows(channels)),
        "alerts": map_alerts(as_list(alerts)),
    }


def survey_channels(text: str) -> list[dict]:
    """Turn `iw dev <iface> survey dump` into busy percent per channel. Frequencies are already MHz."""
    rows: list[dict] = []
    current: dict | None = None

    def flush() -> None:
        nonlocal current
        if not current or not isinstance(current.get("frequency"), int):
            current = None
            return
        freq = int(current["frequency"])
        placed = _band_channel(freq, "")
        active = current.get("active")
        busy = current.get("busy")
        busy_pct = None
        if isinstance(active, int) and active > 0 and isinstance(busy, int):
            busy_pct = round(min(100.0, busy / active * 100.0), 1)
        if placed is not None:
            band, channel = placed
            rows.append({"band": band, "channel": channel, "busy_pct": busy_pct})
        current = None

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Survey data"):
            flush()
            current = {}
            continue
        if current is None:
            continue
        if stripped.startswith("frequency:"):
            if current.get("frequency"):
                flush()
                current = {}
            current["frequency"] = _first_int(stripped)
        elif stripped.startswith("channel active time:"):
            current["active"] = _first_int(stripped)
        elif stripped.startswith("channel busy time:"):
            current["busy"] = _first_int(stripped)
    flush()
    return rows


def prefer_survey(radio_text: str, link_text: str) -> str:
    """Monitor mode often returns an empty survey. Use the link adapter so the channel graph still has busy %."""
    if survey_channels(radio_text):
        return radio_text
    if survey_channels(link_text):
        return link_text
    return radio_text


def with_busy(channels: list[dict], survey: list[dict]) -> list[dict]:
    merged = [dict(row) for row in channels]
    index = {(row["band"], row["channel"]): row for row in merged}
    for row in survey:
        key = (row["band"], row["channel"])
        if key in index:
            if row.get("busy_pct") is not None:
                index[key]["busy_pct"] = row["busy_pct"]
            continue
        merged.append(
            {
                "band": row["band"],
                "channel": row["channel"],
                "airtime_pct": None,
                "packets": None,
                "devices": None,
                "busy_pct": row.get("busy_pct"),
            }
        )
        index[key] = merged[-1]
    return merged


def _first_int(text: str) -> int | None:
    digits = []
    started = False
    for char in text:
        if char.isdigit():
            digits.append(char)
            started = True
        elif started:
            break
    if not digits:
        return None
    return int("".join(digits))


def as_list(payload: object) -> list:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("devices", "alerts", "channels"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []
