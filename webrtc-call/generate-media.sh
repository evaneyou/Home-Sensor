#!/bin/sh
# Build the short gray picture and silence clip that the binary embeds.
set -eu
cd "$(dirname "$0")"
mkdir -p media
ffmpeg -y -f lavfi -i "color=c=0x808080:s=320x240:r=30" -t 1 \
    -c:v libvpx -b:v 200k -g 30 -keyint_min 30 -auto-alt-ref 0 \
    -deadline good -cpu-used 5 -f ivf media/gray.ivf
ffmpeg -y -f lavfi -i "anullsrc=r=48000:cl=mono" -t 1 \
    -c:a libopus -b:a 16k media/silence.ogg
