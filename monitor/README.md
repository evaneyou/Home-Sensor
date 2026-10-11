# Remote agent (Raspberry Pi)

The agent runs on a Raspberry Pi or other Linux PC inside your home network. It serves a small
setup page on the LAN, reports device health to the server, and runs the connectivity tests the
server assigns to it: HTTP, ICMP ping, MTR and iperf3.

The agent uses only the Python 3 standard library. Its version is `AGENT_VERSION` in
[`agent.py`](./agent.py).

## Requirements

- Raspberry Pi OS or another Debian-based Linux with `systemd`
- Python 3 and root access for installation
- Network access to the server (see [Network](#network))

The installer adds `iperf3`, `iputils-ping` and `mtr-tiny` if they are missing, plus `wireguard`
and `iw` when a tunnel config is present.

## Install

1. In the dashboard open **Settings → Remote Agent Onboarding** and add the device. Note its
   name and key. If you issue tunnels, save the wired tunnel as `wg0.conf` and the wireless tunnel
   as `wg1.conf`.
2. On a machine with this repository, build the package:

   ```bash
   ./monitor/pack.sh        # writes monitor/dist/monitor.tar.gz
   ```

3. Copy `monitor.tar.gz` (and any `wg0.conf` or `wg1.conf`) to the Pi, then install:

   ```bash
   mkdir monitor && tar -xzf monitor.tar.gz -C monitor
   cd monitor
   sudo ./install.sh
   ```

4. From a PC on the same LAN open `http://<hostname>.local/` (or the Pi's IP address on port 80).
5. Enter the device name, the server address and the device key, then choose **Connect**. The
   device name must match the dashboard exactly, including capital letters.

The agent starts at boot as the `monitor` user under `systemd`. Check it with:

```bash
systemctl status monitor
journalctl -u monitor -f
```

## Network

| Direction | Destination | Purpose |
|-----------|-------------|---------|
| Outbound | Server `8847` (HTTP) or the WireGuard address `10.7.0.1` | Health reports and results |
| Outbound | Server `8848` (HTTPS) | Enrollment check-in, with a pinned key |
| Outbound | Server `51820/udp` | WireGuard tunnel |
| Inbound (LAN only) | Pi `80` | Setup page |

Setup accepts HTTPS, or HTTP to a private LAN address.

## Files

| File | Purpose |
|------|---------|
| `agent.py` | Setup page, enrollment, health reporting, test scheduling |
| `checks.py` | HTTP, ping, MTR and iperf3 checks |
| `install.sh` | Installs the package and `systemd` unit |
| `monitor.service` | `systemd` unit (runs with `CAP_NET_RAW` and `CAP_NET_BIND_SERVICE` only) |
| `avahi-monitor.service` | Advertises the setup page as `<hostname>.local` |
| `pack.sh` | Builds `dist/monitor.tar.gz` |
