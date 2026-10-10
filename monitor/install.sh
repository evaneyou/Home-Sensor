#!/bin/sh
set -eu
kismet=0
for arg in "$@"; do
  if [ "$arg" = "--kismet" ]; then
    kismet=1
  else
    echo "Unknown option: $arg" >&2
    echo "Usage: sudo ./install.sh [--kismet]" >&2
    exit 1
  fi
done
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./install.sh"
  exit 1
fi
cd "$(dirname "$0")"
if ! id monitor >/dev/null 2>&1; then
  useradd --system --home /opt/monitor --shell /usr/sbin/nologin monitor
fi
install -d -m 755 /opt/monitor
install -m 644 agent.py checks.py kismet_view.py rf_spool.py /opt/monitor/
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
command -v iw >/dev/null 2>&1 || need="$need iw"
if [ -n "$need" ]; then
  apt-get update
  apt-get install -y $need
fi
systemctl daemon-reload
systemctl enable monitor.service
systemctl restart monitor.service
if [ -f wg0.conf ] || [ -f wg1.conf ]; then
  apt-get update
  apt-get install -y wireguard
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

install_kismet() {
  # shellcheck disable=SC1091
  . /etc/os-release
  codename="${VERSION_CODENAME:-}"
  if [ -z "$codename" ]; then
    echo "Kismet was not installed. This Pi's Debian release is not in /etc/os-release."
    return 0
  fi
  radio="$(python3 -c 'import sys; sys.path.insert(0, "/opt/monitor"); from checks import wifi_roles; print(wifi_roles().get("radio") or "")')"
  if [ -z "$radio" ]; then
    echo "Kismet was not enabled. No second radio adapter was found."
    return 0
  fi
  phy="$(iw dev "$radio" info 2>/dev/null | awk '/wiphy/ {print $2; exit}')"
  if [ -z "$phy" ] || ! iw phy "phy${phy}" info 2>/dev/null | grep -q '\* monitor'; then
    echo "Kismet was not enabled. ${radio} does not support monitor mode."
    return 0
  fi
  keyring=/usr/share/keyrings/kismet-archive-keyring.gpg
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://www.kismetwireless.net/repos/kismet-release.gpg.key | gpg --dearmor --yes -o "$keyring"
  echo "deb [signed-by=${keyring}] https://www.kismetwireless.net/repos/apt/release/${codename} ${codename} main" > /etc/apt/sources.list.d/kismet.list
  if ! apt-get update; then
    echo "Kismet was not installed. The official apt repo has no packages for ${codename}."
    return 0
  fi
  apt-get install -y kismet
  mac="$(cat "/sys/class/net/${radio}/address")"
  install -d -m 755 /etc/systemd/network
  cat > /etc/systemd/network/10-hnwradio.link <<EOF
[Match]
MACAddress=${mac}

[Link]
Name=hnwradio0
EOF
  ip link set "$radio" down || true
  if ! ip link set "$radio" name hnwradio0; then
    echo "The radio will be named hnwradio0 after it is re-plugged or the Pi reboots."
  fi
  user="hnw$(python3 -c 'import secrets; print(secrets.token_hex(4))')"
  password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
  if ! getent group kismet >/dev/null; then
    groupadd --system kismet
  fi
  if ! id kismet >/dev/null 2>&1; then
    useradd --system --gid kismet --home-dir /var/lib/kismet --shell /usr/sbin/nologin kismet
  fi
  install -d -o kismet -g kismet -m 750 /var/lib/kismet
  install -d -o root -g kismet -m 750 /etc/kismet
  umask 077
  cat > /etc/kismet/kismet_site.conf <<EOF
server_name=HomeNetWatch
httpd_bind_address=127.0.0.1
httpd_port=2501
httpd_username=${user}
httpd_password=${password}
source=hnwradio0:name=hnw-radio,hop=true
enable_logging=false
tracker_device_timeout=600
EOF
  chown root:kismet /etc/kismet/kismet_site.conf
  chmod 0640 /etc/kismet/kismet_site.conf
  HNW_KISMET_USER="$user" HNW_KISMET_PASSWORD="$password" python3 <<'PY'
import json, os
from pathlib import Path
path = Path("/etc/monitor/kismet.json")
path.write_text(json.dumps({
    "username": os.environ["HNW_KISMET_USER"],
    "password": os.environ["HNW_KISMET_PASSWORD"],
    "url": "http://127.0.0.1:2501",
}) + "\n")
os.chmod(path, 0o640)
PY
  chown root:monitor /etc/monitor/kismet.json
  chmod 0640 /etc/monitor/kismet.json
  if [ -e /usr/bin/kismet_cap_hak5_wifi_coconut ]; then
    dpkg-statoverride --remove /usr/bin/kismet_cap_hak5_wifi_coconut 2>/dev/null || true
    dpkg-statoverride --update --add root kismet 0754 /usr/bin/kismet_cap_hak5_wifi_coconut
  fi
  umask 022
  rm -f /tmp/.kismet_cap_linux_wifi_interface_lock
  install -d -m 755 /etc/systemd/system/kismet.service.d
  cat > /etc/systemd/system/kismet.service.d/privileges.conf <<EOF
[Service]
User=kismet
Group=kismet
WorkingDirectory=/var/lib/kismet
EOF
  systemctl daemon-reload
  systemctl enable kismet.service
  systemctl restart kismet.service
  echo "Kismet is listening on 127.0.0.1:2501 only."
}

if [ "$kismet" -eq 1 ]; then
  install_kismet
fi
