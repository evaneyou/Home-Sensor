#!/usr/bin/env bash
# Download the free DB-IP "City Lite" database that places guest visitors (country and city).
# No account is needed. The data is licensed CC BY 4.0, credited on the Guest visits page.
# The file is replaced about once a month: run this monthly (see docs/deploy.md for a cron line).
# Usage: ./scripts/update-geoip.sh
set -euo pipefail
cd "$(dirname "$0")/.."

dir=geoip
file="$dir/dbip-city-lite.mmdb"
mkdir -p "$dir"
tmp="$(mktemp "$dir/.download.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# This month's file may not be published yet, so fall back to last month's.
for offset in 0 1; do
  month="$(date -u -d "$offset month ago" +%Y-%m 2>/dev/null || date -u -v-"$offset"m +%Y-%m)"
  url="https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz"
  if curl -fsSL --max-time 300 "$url" | gunzip > "$tmp"; then
    mv "$tmp" "$file"
    chmod 644 "$file"
    echo "Installed $file from $url ($(du -h "$file" | cut -f1))"
    echo "The server reads it on the next request; no restart is needed."
    exit 0
  fi
  echo "Could not download $url" >&2
done
echo "Could not download the DB-IP City Lite database." >&2
exit 1
