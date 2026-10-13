#!/bin/sh
set -eu
# Data is UDP 8998 on the public IPv4 address. Control listens only on the
# tunnel addresses, which are not published on the host.
while [ ! -s /var/lib/hns-rtnp/key ]; do
  echo "waiting for the RTNP control key"
  sleep 1
done
while [ ! -d /var/lib/hns-rtnp/keys ] || [ -z "$(ls -A /var/lib/hns-rtnp/keys 2>/dev/null || true)" ]; do
  echo "waiting for an SRTP key"
  sleep 1
done
exec rtnp-recv \
  --bind 0.0.0.0 \
  --udp-port 8998 \
  --no-tcp \
  --control-bind 10.7.0.1 \
  --control-bind 10.7.1.1 \
  --control-port 8999 \
  --allow-reverse \
  --key-file /var/lib/hns-rtnp/key \
  --srtp-key-dir /var/lib/hns-rtnp/keys \
  --report-interval 0s
