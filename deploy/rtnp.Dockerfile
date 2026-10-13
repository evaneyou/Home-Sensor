FROM rust:1-bookworm AS build

WORKDIR /src
COPY rtnp/Cargo.toml rtnp/Cargo.lock ./
COPY rtnp/crates ./crates
RUN cargo build --release -p rtnp-cli --bin rtnp-recv --bin rtnp-send

FROM debian:12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 65532 --no-create-home rtnp

COPY --from=build /src/target/release/rtnp-recv /usr/local/bin/rtnp-recv
COPY --from=build /src/target/release/rtnp-send /usr/local/bin/rtnp-send
COPY deploy/rtnp-entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh /usr/local/bin/rtnp-recv /usr/local/bin/rtnp-send

EXPOSE 8998/udp

USER rtnp

ENTRYPOINT ["/entrypoint.sh"]
