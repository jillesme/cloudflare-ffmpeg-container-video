FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

USER app
WORKDIR /home/app

# Keep the Container alive; conversions are child processes started by exec().
CMD ["sleep", "infinity"]
