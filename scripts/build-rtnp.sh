#!/bin/sh
# Cross-build rtnp-send for the Pi and leave it where pack.sh can see it.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
docker run --rm -v "$ROOT/rtnp:/src" -w /src rust:1-bookworm bash -c \
  'apt-get update && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu && rustup target add aarch64-unknown-linux-gnu && cargo build --release --target aarch64-unknown-linux-gnu -p rtnp-cli --bin rtnp-send'
cp "$ROOT/rtnp/target/aarch64-unknown-linux-gnu/release/rtnp-send" "$ROOT/monitor/rtnp-send"
chmod 755 "$ROOT/monitor/rtnp-send"
echo "Wrote $ROOT/monitor/rtnp-send"
