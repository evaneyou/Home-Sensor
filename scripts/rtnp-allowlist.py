#!/usr/bin/env python3
"""Refresh the UDP 8998 allowlist from the WireGuard peer endpoints.

Run as root every 60 seconds. An empty peer set drops every packet.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app.rtnp_allowlist import endpoints_from_wg, nft_commands  # noqa: E402


def _wg_endpoints() -> str:
    completed = subprocess.run(
        ["docker", "compose", "exec", "-T", "wireguard", "wg", "show", "wg0", "endpoints"],
        check=False,
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout


def _chain(family: str) -> str:
    completed = subprocess.run(
        ["nft", "list", "chain", family, "filter", "DOCKER-USER"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout


def apply(commands: list[list[str]]) -> None:
    for command in commands:
        subprocess.run(command, check=False, capture_output=True)


def main() -> int:
    addresses = endpoints_from_wg(_wg_endpoints())
    apply(nft_commands(addresses, _chain("ip"), _chain("ip6")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
