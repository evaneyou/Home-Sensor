#!/bin/sh
# Replace the agent code and restart monitor.
# Enrollment, WireGuard, and /etc/monitor are left as they are.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./update.sh" >&2
  exit 1
fi

cd "$(dirname "$0")"

files="agent.py agent_state.py enrollment.py health.py radio.py scheduler.py checks.py kismet_view.py rf_spool.py synthetic.py speedtest.py"
for file in $files; do
  if [ ! -f "$file" ]; then
    echo "Missing $file. Unpack monitor.tar.gz and run this script from that directory." >&2
    exit 1
  fi
done

if [ ! -f /opt/monitor/agent.py ]; then
  echo "No agent is installed here. For a first install, run sudo ./install.sh." >&2
  exit 1
fi

install -d -m 755 /opt/monitor
# shellcheck disable=SC2086
install -m 644 $files /opt/monitor/
if [ -f rtnp-send ]; then
  install -m 755 rtnp-send /opt/monitor/rtnp-send
fi

systemctl restart monitor.service

version=$(sed -n 's/^AGENT_VERSION = "\(.*\)"/\1/p' /opt/monitor/agent_state.py)
echo "Agent ${version:-unknown} is running. Enrollment, tunnels, and /etc/monitor were left in place."
