#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p dist
tar -czf dist/monitor.tar.gz agent.py checks.py install.sh monitor.service avahi-monitor.service
echo "Wrote $(pwd)/dist/monitor.tar.gz"
