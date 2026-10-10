"""Adapter roles from a fake sysfs tree. No radio hardware."""

import importlib.util
from pathlib import Path


def _checks():
    here = Path(__file__).resolve()
    candidates = [here.parents[2] / "monitor" / "checks.py", Path("/monitor/checks.py")]
    path = next((item for item in candidates if item.is_file()), None)
    if path is None:
        raise FileNotFoundError("monitor/checks.py")
    spec = importlib.util.spec_from_file_location("monitor_checks", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _iface(root: Path, name: str, target: Path, carrier: str, modalias: str = "") -> None:
    entry = root / name
    (entry / "wireless").mkdir(parents=True)
    (entry / "carrier").write_text(carrier + "\n", encoding="utf-8")
    target.mkdir(parents=True, exist_ok=True)
    if modalias:
        (target / "modalias").write_text(modalias, encoding="utf-8")
    (entry / "device").symlink_to(target, target_is_directory=True)


def test_one_adapter_is_the_link(tmp_path: Path):
    checks = _checks()
    builtin = tmp_path / "bus" / "pci" / "0000"
    _iface(tmp_path, "wlan0", builtin, "1")
    roles = checks.wifi_roles(tmp_path, ipv4_of=lambda name: "10.0.0.2" if name == "wlan0" else None)
    assert roles == {"link": "wlan0", "radio": None}


def test_usb_mediatek_is_the_radio_when_a_builtin_carries_traffic(tmp_path: Path):
    checks = _checks()
    builtin = tmp_path / "bus" / "pci" / "0000"
    generic = tmp_path / "bus" / "usb2" / "2-1"
    mediatek = tmp_path / "bus" / "usb1" / "1-1"
    _iface(tmp_path, "wlan0", builtin, "1")
    _iface(tmp_path, "wlan1", generic, "0", "usb:v0b05p")
    _iface(tmp_path, "wlan2", mediatek, "0", "usb:v0E8Dp7615d0000")
    roles = checks.wifi_roles(tmp_path, ipv4_of=lambda name: "10.0.0.2" if name == "wlan0" else None)
    assert roles["link"] == "wlan0"
    assert roles["radio"] == "wlan2"


def test_builtin_wins_the_link_when_both_adapters_have_an_address(tmp_path: Path):
    checks = _checks()
    builtin = tmp_path / "bus" / "pci" / "0000"
    usb = tmp_path / "bus" / "usb1" / "1-1"
    _iface(tmp_path, "wlan0", builtin, "1")
    _iface(tmp_path, "wlxusb", usb, "1", "usb:v0e8dp")
    roles = checks.wifi_roles(tmp_path, ipv4_of=lambda _name: "10.0.0.8")
    assert roles["link"] == "wlan0"
    assert roles["radio"] == "wlxusb"


def test_link_scans_wait_for_tests_and_fifteen_minutes():
    checks = _checks()
    assert checks.scan_may_run(role="radio", last_link_scan=0, now=10, link_busy=True, forced=False)
    assert not checks.scan_may_run(role="link", last_link_scan=0, now=10, link_busy=True, forced=True)
    assert checks.scan_may_run(role="link", last_link_scan=0, now=10, link_busy=False, forced=True)
    assert not checks.scan_may_run(role="link", last_link_scan=100, now=200, link_busy=False, forced=False)
    assert checks.scan_may_run(role="link", last_link_scan=100, now=1000, link_busy=False, forced=False)
    assert checks.link_lock.acquire(blocking=False)
    try:
        assert checks.link_is_busy()
    finally:
        checks.link_lock.release()
    assert not checks.link_is_busy()
