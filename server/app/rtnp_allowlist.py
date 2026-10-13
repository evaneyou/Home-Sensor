"""Turn WireGuard peer endpoints into the host filter for UDP 8998.

An empty set drops every packet. IPv6 endpoints are ignored so they cannot
bypass the IPv4 allowlist. Docker accepts published ports before the host
INPUT chain, so the filter is a chain jumped from DOCKER-USER.
"""

from __future__ import annotations

import ipaddress


def endpoints_from_wg(text: str) -> list[str]:
    """Parse `wg show <iface> endpoints`. Keep distinct IPv4 addresses only."""
    found: list[str] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        endpoint = parts[-1]
        if endpoint == "(none)" or endpoint.startswith("["):
            continue
        host = endpoint.rsplit(":", 1)[0]
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            continue
        if address.version != 4:
            continue
        value = str(address)
        if value not in found:
            found.append(value)
    return found


def nft_commands(
    addresses: list[str],
    chain_text: str = "",
    chain6_text: str = "",
) -> list[list[str]]:
    """Rebuild the measurement chain and jump to it from DOCKER-USER once."""
    commands: list[list[str]] = [
        ["nft", "add", "table", "ip", "filter"],
        ["nft", "add", "table", "ip6", "filter"],
        ["nft", "add", "set", "ip", "filter", "rtnp_sources", "{ type ipv4_addr; }"],
        ["nft", "flush", "set", "ip", "filter", "rtnp_sources"],
        ["nft", "add", "chain", "ip", "filter", "RTNP_IN"],
        ["nft", "flush", "chain", "ip", "filter", "RTNP_IN"],
        ["nft", "add", "chain", "ip6", "filter", "RTNP_IN"],
        ["nft", "flush", "chain", "ip6", "filter", "RTNP_IN"],
        ["nft", "add", "rule", "ip6", "filter", "RTNP_IN", "drop"],
    ]
    if addresses:
        commands.append(
            [
                "nft",
                "add",
                "element",
                "ip",
                "filter",
                "rtnp_sources",
                "{ " + ", ".join(addresses) + " }",
            ]
        )
        commands.append(
            ["nft", "add", "rule", "ip", "filter", "RTNP_IN", "ip", "saddr", "@rtnp_sources", "accept"]
        )
    commands.append(["nft", "add", "rule", "ip", "filter", "RTNP_IN", "drop"])
    if "jump RTNP_IN" not in chain_text:
        commands.append(
            ["nft", "insert", "rule", "ip", "filter", "DOCKER-USER", "udp", "dport", "8998", "jump", "RTNP_IN"]
        )
    if "jump RTNP_IN" not in chain6_text:
        commands.append(
            ["nft", "insert", "rule", "ip6", "filter", "DOCKER-USER", "udp", "dport", "8998", "jump", "RTNP_IN"]
        )
    commands.append(["iptables", "-D", "DOCKER-USER", "-p", "udp", "-m", "udp", "--dport", "8998", "-j", "DROP"])
    commands.append(["ip6tables", "-D", "DOCKER-USER", "-p", "udp", "-m", "udp", "--dport", "8998", "-j", "DROP"])
    return commands
