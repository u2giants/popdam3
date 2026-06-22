#!/usr/bin/env bash
# Installed as the ExecStart of coolify-proxy-reconnect.service (a systemd unit that
# fires whenever docker.service (re)starts). Restarts coolify-proxy so Traefik re-reads
# the current docker socket after a daemon restart.
#
# Why: with `live-restore: true` (Coolify's default), containers keep running through a
# docker daemon restart/upgrade — including coolify-proxy, which then holds a STALE
# /var/run/docker.sock mount (the daemon recreated the socket with a new inode). Traefik's
# docker provider goes blind and new/changed containers 502. The host socket is fine; only
# the proxy's view is stale, and only restarting that one container fixes it. This restores
# routing within ~30s of any docker restart, so docker can auto-update freely. See README.md.
LOG=/var/log/coolify-proxy-watchdog.log
for i in $(seq 1 30); do docker info >/dev/null 2>&1 && docker inspect coolify-proxy >/dev/null 2>&1 && break; sleep 2; done
if docker restart coolify-proxy >/dev/null 2>&1; then
  echo "$(date -u +%FT%TZ) reconnect: coolify-proxy restarted after docker (re)start" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) reconnect: FAILED to restart coolify-proxy" >> "$LOG"
fi
