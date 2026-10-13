FROM debian:12-slim

ARG VERSION=1.4.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

WORKDIR /opt/librespeed

RUN curl -fsSL -o /tmp/librespeed.tar.xz \
        "https://github.com/librespeed/speedtest-rust/releases/download/v${VERSION}/librespeed-rs-aarch64-unknown-linux-gnu.tar.xz" \
    && tar -xJf /tmp/librespeed.tar.xz -C /opt/librespeed \
    && rm /tmp/librespeed.tar.xz /opt/librespeed/configs.toml \
    && chmod 755 /opt/librespeed/librespeed-rs

COPY configs.toml /opt/librespeed/configs.toml
COPY nginx.conf /etc/nginx/conf.d/librespeed.conf
COPY entrypoint.sh /opt/librespeed/entrypoint.sh
RUN chmod 755 /opt/librespeed/entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:8080/backend/empty || exit 1

CMD ["/opt/librespeed/entrypoint.sh"]
