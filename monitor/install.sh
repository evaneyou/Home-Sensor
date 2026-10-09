#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./install.sh"
  exit 1
fi
cd "$(dirname "$0")"
if ! id monitor >/dev/null 2>&1; then
  useradd --system --home /opt/monitor --shell /usr/sbin/nologin monitor
fi
install -d -m 755 /opt/monitor
install -m 644 agent.py checks.py /opt/monitor/
install -d -o monitor -g monitor -m 750 /etc/monitor
install -m 644 monitor.service /etc/systemd/system/monitor.service
if [ -d /etc/avahi/services ]; then
  install -m 644 avahi-monitor.service /etc/avahi/services/monitor.service
  systemctl try-restart avahi-daemon || true
else
  echo "Avahi is not installed. The page is still available at this Pi's IP address on port 80."
fi
need=""
command -v iperf3 >/dev/null 2>&1 || need="$need iperf3"
command -v ping >/dev/null 2>&1 || need="$need iputils-ping"
command -v mtr >/dev/null 2>&1 || need="$need mtr-tiny"
if [ -n "$need" ]; then
  apt-get update
  apt-get install -y $need
fi
systemctl daemon-reload
systemctl enable monitor.service
systemctl restart monitor.service
if [ -f wg0.conf ] || [ -f wg1.conf ]; then
  apt-get update
  apt-get install -y wireguard iw
  install -d -m 700 /etc/wireguard
fi
if [ -f wg0.conf ]; then
  install -m 600 wg0.conf /etc/wireguard/wg0.conf
  systemctl enable wg-quick@wg0
  systemctl restart wg-quick@wg0
  echo "Wired tunnel is up. Set the server address to http://10.7.0.1:8847."
fi
if [ -f wg1.conf ]; then
  install -m 600 wg1.conf /etc/wireguard/wg1.conf
  systemctl enable wg-quick@wg1
  systemctl restart wg-quick@wg1
  echo "Wireless tunnel is up. Wireless checks use http://10.7.1.1:8847."
fi
host="$(hostname -s)"
echo "Open http://${host}.local/ from a PC on this LAN."
echo "Create the device in Remote Agent Onboarding first, then paste its name and key here."
