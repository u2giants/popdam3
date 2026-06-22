#!/usr/bin/env bash
# coolify-proxy-socket-watchdog.sh
#
# Self-heals the recurring "Traefik lost its Docker socket connection" failure:
# after a Docker daemon restart, coolify-proxy's bind-mounted /var/run/docker.sock
# points at the old (gone) socket inode, so Traefik's docker provider can no longer
# see container events. New/changed containers then stop routing and return 502
# (e.g. the 2026-06-18 and 2026-06-22 incidents in AGENTS.md). The host socket is
# fine; only coolify-proxy's view is stale, and only a restart of that container
# re-establishes it. Coolify manages the proxy container, so we don't modify it —
# we watch for the condition and restart it, rate-limited so it can never flap.
#
# Install: see deploy/vps/README.md (copy to /usr/local/bin + enable the systemd timer).
set -uo pipefail

PROXY="coolify-proxy"
LOG="/var/log/coolify-proxy-watchdog.log"
STAMP="/run/coolify-proxy-watchdog.last-restart"
COOLDOWN=900                                   # min seconds between auto-restarts
ERRPAT="Cannot connect to the Docker daemon"   # Traefik docker-provider failure

log(){ echo "$(date -u +%FT%TZ) $*" >> "$LOG" 2>/dev/null || true; }

# Proxy must exist
docker inspect "$PROXY" >/dev/null 2>&1 || { log "skip: $PROXY not present"; exit 0; }

# Sustained failure only: several errors over the last 2 min AND still failing in
# the last 45s. This ignores transient blips during a normal daemon restart.
recent=$(docker logs "$PROXY" --since 2m  2>&1 | grep -c "$ERRPAT" || true)
nowfail=$(docker logs "$PROXY" --since 45s 2>&1 | grep -c "$ERRPAT" || true)
[ "${recent:-0}" -ge 3 ] && [ "${nowfail:-0}" -ge 1 ] || exit 0

# Rate limit
now=$(date +%s)
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  if [ $(( now - last )) -lt "$COOLDOWN" ]; then
    log "detected socket failure (recent=$recent nowfail=$nowfail) but within cooldown $(( now - last ))s; skipping"
    exit 0
  fi
fi

log "SUSTAINED docker-socket failure on $PROXY (recent=$recent nowfail=$nowfail) -> restarting"
if docker restart "$PROXY" >/dev/null 2>&1; then
  echo "$now" > "$STAMP"
  log "restarted $PROXY OK"
else
  log "ERROR: docker restart $PROXY failed"
fi
