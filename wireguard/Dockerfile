FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wireguard-tools wireguard-go iproute2 iptables socat \
    && rm -rf /var/lib/apt/lists/*

COPY wireguard/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
