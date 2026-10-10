#!/bin/bash
set -eu
apt-get update -qq
apt-get install -y -qq gcc-aarch64-linux-gnu libc6-dev-arm64-cross ffmpeg pkg-config
rustup target add aarch64-unknown-linux-gnu
sed -i 's/\r$//' generate-media.sh
chmod +x generate-media.sh
./generate-media.sh
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
cargo build --release --target aarch64-unknown-linux-gnu
file target/aarch64-unknown-linux-gnu/release/webrtc-call
