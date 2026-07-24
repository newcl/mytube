FROM golang:1.26-bookworm AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go test ./...
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/mytube-server ./cmd/server

FROM node:22-bookworm-slim

ARG YT_DLP_VERSION=2026.06.09
ARG YT_DLP_SHA256=e5d57466682cfa9d61e9cf7c8a4f09b00f4a62af37d3bbdc4bcffdf63615feac

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 \
    && curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
      -o /usr/local/bin/yt-dlp \
    && echo "${YT_DLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 mytube \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mytube \
    && mkdir -p /data/downloads \
    && chown -R mytube:mytube /data

COPY --from=builder /out/mytube-server /usr/local/bin/mytube-server

USER 10001:10001
WORKDIR /data
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/mytube-server"]
