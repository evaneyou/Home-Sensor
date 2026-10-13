#!/bin/sh
set -eu
cd /opt/librespeed
./librespeed-rs &
i=0
while [ "$i" -lt 50 ]; do
  if curl -fsS -o /dev/null http://127.0.0.1:8081/backend/empty; then
    break
  fi
  i=$((i + 1))
  sleep 0.1
done
exec nginx -g 'daemon off;'
