#!/bin/bash
set -eu
cd /home/evany/Home-Sensor
sed -i 's/\r$//' webrtc-call/cross-arm64.sh webrtc-call/run-cross.sh
chmod +x webrtc-call/cross-arm64.sh
docker run --rm -v /home/evany/Home-Sensor/webrtc-call:/src -w /src rust:1-bookworm bash /src/cross-arm64.sh
