FROM rust:1-bookworm AS webrtc-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY webrtc-call /src
RUN sed -i 's/\r$//' generate-media.sh \
    && chmod +x generate-media.sh \
    && ./generate-media.sh \
    && cargo test --release \
    && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wireguard-tools wireguard-go iproute2 iptables socat iperf3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=webrtc-build /src/target/release/webrtc-call /webrtc-call
COPY wireguard/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh /webrtc-call

ENTRYPOINT ["/entrypoint.sh"]
