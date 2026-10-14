"""Where a visitor's address is, from a local DB-IP "City Lite" database file.

The lookup never leaves the server: the file is read from disk, and no address is sent to a
third party. If the file is missing, or an address is not in it, the result is None and the
dashboard shows "Unknown". `scripts/update-geoip.sh` downloads and refreshes the file.

IP geolocation data by DB-IP (https://db-ip.com), licensed CC BY 4.0.
"""

from __future__ import annotations

import ipaddress
import os
import threading
from typing import TypedDict

from app.config import get_settings

try:  # the library is a normal dependency; this keeps a bare checkout importable
    import maxminddb
except ImportError:  # pragma: no cover
    maxminddb = None


class Place(TypedDict):
    country: str
    country_code: str
    region: str
    city: str


PRIVATE: Place = {"country": "Private network", "country_code": "", "region": "", "city": ""}

_lock = threading.Lock()
_reader = None
_loaded: tuple[str, float] | None = None


def _name(record: object) -> str:
    if not isinstance(record, dict):
        return ""
    names = record.get("names")
    if isinstance(names, dict):
        return str(names.get("en") or next(iter(names.values()), "") or "")
    return ""


def _open():
    """The open database, reopened when the file changes (it is replaced monthly)."""
    global _reader, _loaded
    path = get_settings().geoip_db
    if not path or maxminddb is None or not os.path.isfile(path):
        return None
    stamp = (path, os.path.getmtime(path))
    with _lock:
        if _reader is None or _loaded != stamp:
            if _reader is not None:
                _reader.close()
            _reader = maxminddb.open_database(path)
            _loaded = stamp
        return _reader


def available() -> bool:
    return _open() is not None


def lookup(address: str) -> Place | None:
    """Country, region and city for an address, or None when it cannot be placed."""
    try:
        ip = ipaddress.ip_address(address.strip())
    except ValueError:
        return None
    if not ip.is_global:
        return PRIVATE
    reader = _open()
    if reader is None:
        return None
    try:
        record = reader.get(str(ip))
    except (ValueError, OSError):
        return None
    if not isinstance(record, dict):
        return None
    country = record.get("country") if isinstance(record.get("country"), dict) else {}
    subdivisions = record.get("subdivisions")
    region = _name(subdivisions[0]) if isinstance(subdivisions, list) and subdivisions else ""
    place: Place = {
        "country": _name(country),
        "country_code": str(country.get("iso_code") or ""),
        "region": region,
        "city": _name(record.get("city")),
    }
    return place if place["country"] else None
