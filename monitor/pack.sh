#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p dist
tar -czf dist/monitor.tar.gz agent.py checks.py kismet_view.py rf_spool.py synthetic.py install.sh monitor.service avahi-monitor.service
echo "Wrote $(pwd)/dist/monitor.tar.gz"
