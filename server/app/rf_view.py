"""Wi-Fi scan parsing, channel advice, and chart series. No database access."""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone

_BSS = re.compile(r"^BSS ((?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})")
_NON_DFS_5 = (36, 40, 44, 48, 149, 153, 157, 161, 165)
_CANDIDATES = {"2.4": (1, 6, 11), "5": _NON_DFS_5}


def channel_from_freq(freq: int) -> tuple[str, int]:
    if freq == 2484:
        return "2.4", 14
    if 2412 <= freq <= 2472:
        return "2.4", (freq - 2407) // 5
    if 5000 <= freq < 5900:
        return "5", (freq - 5000) // 5
    if freq >= 5955:
        return "6", (freq - 5950) // 5
    return "2.4", 0


def parse_iw_survey(text: str) -> list[dict]:
    """Turn `iw dev <iface> survey dump` into one row per frequency."""
    rows: list[dict] = []
    current: dict | None = None

    def flush() -> None:
        nonlocal current
        if not current or not current.get("frequency"):
            current = None
            return
        freq = int(current["frequency"])
        band, channel = channel_from_freq(freq)
        active = current.get("active")
        busy = current.get("busy")
        busy_pct = None
        if isinstance(active, int) and active > 0 and isinstance(busy, int):
            busy_pct = round(min(100.0, busy / active * 100.0), 1)
        if channel > 0:
            rows.append(
                {
                    "frequency": freq,
                    "band": band,
                    "channel": channel,
                    "noise_dbm": current.get("noise"),
                    "busy_pct": busy_pct,
                }
            )
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
        elif stripped.startswith("noise:"):
            current["noise"] = _first_float(stripped)
        elif stripped.startswith("channel active time:"):
            current["active"] = _first_int(stripped)
        elif stripped.startswith("channel busy time:"):
            current["busy"] = _first_int(stripped)
    flush()
    return rows


def noise_by_frequency(survey: list[dict]) -> dict[int, float]:
    found: dict[int, float] = {}
    for row in survey:
        if isinstance(row.get("noise_dbm"), (int, float)):
            found[int(row["frequency"])] = float(row["noise_dbm"])
    return found


def parse_iw_scan(text: str, noise_by_freq: dict[int, float] | None = None) -> list[dict]:
    """Turn `iw dev <iface> scan` text into access-point dicts."""
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.startswith("BSS "):
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
    if current:
        blocks.append(current)
    found: list[dict] = []
    for block in blocks:
        ap = _parse_block(block, noise_by_freq or {})
        if ap is not None:
            found.append(ap)
    return found


def _parse_block(lines: list[str], noise_by_freq: dict[int, float]) -> dict | None:
    match = _BSS.match(lines[0])
    if match is None:
        return None
    bssid = match.group(1).lower()
    freq = 0
    rssi = -100.0
    ssid = ""
    saw_ssid = False
    security = "Open"
    saw_rsn = False
    saw_wpa = False
    privacy = False
    width = 20
    phy = "g"
    channel = 0
    for line in lines[1:]:
        stripped = line.strip()
        if stripped.startswith("freq:"):
            freq = _first_int(stripped)
        elif stripped.startswith("signal:"):
            rssi = _first_float(stripped)
        elif stripped.startswith("SSID:"):
            saw_ssid = True
            ssid = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("DS Parameter set:"):
            channel = _first_int(stripped)
        elif stripped.startswith("RSN:"):
            saw_rsn = True
        elif stripped.startswith("WPA:"):
            saw_wpa = True
        elif "Privacy" in stripped:
            privacy = True
        elif "160 MHz" in stripped:
            width = max(width, 160)
        elif "80 MHz" in stripped:
            width = max(width, 80)
        elif "40 MHz" in stripped or "HT40" in stripped:
            width = max(width, 40)
        if stripped.startswith("HE "):
            phy = "ax"
        elif "VHT" in stripped and phy not in {"ax"}:
            phy = "ac"
        elif stripped.startswith("HT ") and phy not in {"ax", "ac"}:
            phy = "n"
    band, from_freq = channel_from_freq(freq) if freq else ("2.4", 0)
    if channel <= 0:
        channel = from_freq
    if band == "5" and phy == "g":
        phy = "a"
    if saw_rsn:
        security = "WPA2"
    elif saw_wpa:
        security = "WPA"
    elif privacy:
        security = "WEP"
    if not saw_ssid:
        ssid = ""
    return {
        "bssid": bssid,
        "ssid": ssid,
        "hidden": ssid == "",
        "band": band,
        "channel": channel,
        "channel_width": width,
        "rssi_dbm": rssi,
        "noise_dbm": noise_by_freq.get(freq) if freq else None,
        "security": security,
        "phy": phy,
        "vendor": "Unknown",
        "max_link_rate_mbps": 0,
    }


def _first_int(text: str) -> int:
    digits = []
    started = False
    for char in text:
        if char.isdigit():
            digits.append(char)
            started = True
        elif started:
            break
    return int("".join(digits) or "0")


def _first_float(text: str) -> float:
    token = ""
    for char in text:
        if char.isdigit() or char in ".-":
            token += char
        elif token:
            break
    try:
        return float(token)
    except ValueError:
        return -100.0


def _span(width: int, band: str) -> int:
    if band == "2.4":
        return {20: 2, 40: 4, 80: 6}.get(width, 2)
    return {20: 0, 40: 4, 80: 6, 160: 14}.get(width, 0)


def _weight(rssi: float) -> float:
    return max(0.0, rssi + 100)


def _overlaps(ap: dict, channel: int) -> bool:
    return abs(int(ap["channel"]) - channel) <= _span(int(ap.get("channel_width") or 20), str(ap["band"]))


def score_channel(aps: list[dict], channel: int, band: str) -> float:
    return sum(_weight(float(ap["rssi_dbm"])) for ap in aps if ap["band"] == band and _overlaps(ap, channel))


def recommend_band(aps: list[dict], band: str) -> dict:
    """Quietest non-overlapping channel. Stronger neighbors count more than faint ones."""
    group = [ap for ap in aps if ap["band"] == band and int(ap.get("channel") or 0) > 0]
    candidates = _CANDIDATES.get(band, (1, 6, 11))
    if not group:
        choice = candidates[0]
        return {
            "band": band,
            "ap_count": 0,
            "busiest_channel": None,
            "recommended_channel": choice,
            "reason": f"No nearby {band} GHz networks yet. Channel {choice} is a clear place to start.",
        }
    scores = {channel: score_channel(group, channel, band) for channel in candidates}
    choice = min(candidates, key=lambda channel: (scores[channel], channel))
    present = sorted({int(ap["channel"]) for ap in group})
    busiest = max(present, key=lambda channel: (score_channel(group, channel, band), -channel))
    loud = scores[choice]
    if loud <= 0:
        reason = f"Channel {choice} is clear on {band} GHz."
    elif busiest == choice:
        reason = f"Channel {choice} is the quietest {band} GHz choice. Nearby networks still reach it."
    else:
        reason = f"Your {band} GHz band is crowded. Channel {choice} would be quieter than channel {busiest}."
    return {
        "band": band,
        "ap_count": len(group),
        "busiest_channel": busiest,
        "recommended_channel": choice,
        "reason": reason,
    }


def hill_points(ap: dict) -> list[dict]:
    """A filled curve centered on the AP channel. The edges sit at -100 dBm."""
    center = int(ap["channel"])
    half = _span(int(ap.get("channel_width") or 20), str(ap["band"])) or 1
    rssi = float(ap["rssi_dbm"])
    points = []
    for channel in range(center - half, center + half + 1):
        if channel < 1:
            continue
        dist = abs(channel - center) / half
        level = -100 + (rssi + 100) * (0.5 + 0.5 * math.cos(math.pi * dist))
        points.append({"channel": channel, "rssi": round(level, 1)})
    return points


def bucket_seconds(range_key: str) -> int:
    return {"1h": 300, "6h": 900, "24h": 3600, "7d": 6 * 3600}.get(range_key, 3600)


def range_start(range_key: str, now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    hours = {"1h": 1, "6h": 6, "24h": 24, "7d": 24 * 7}.get(range_key, 24)
    return now - timedelta(hours=hours)


def bucket_start(moment: datetime, seconds: int) -> datetime:
    stamp = int(moment.timestamp())
    return datetime.fromtimestamp(stamp - (stamp % seconds), tz=timezone.utc)
