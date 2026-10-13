#!/bin/bash
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
sed -i 's/\r$//' webrtc-call/cross-arm64.sh webrtc-call/run-cross.sh
chmod +x webrtc-call/cross-arm64.sh
docker run --rm -v "$ROOT/webrtc-call:/src" -w /src rust:1-bookworm bash /src/cross-arm64.sh
