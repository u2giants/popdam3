# deploy/vps — Hetzner VPS host tooling

Host-level scripts for the VPS that runs the Coolify stack (frontend, MCP servers,
other apps). These are **not** deployed by CI — they're installed manually on the host
and versioned here so they survive a rebuild.

## coolify-proxy socket self-heal watchdog

**Problem it fixes:** `coolify-proxy` (Traefik) bind-mounts `/var/run/docker.sock`.
When the Docker daemon restarts, the socket inode changes and the proxy's mount goes
stale — Traefik's docker provider logs `Cannot connect to the Docker daemon at
unix:///var/run/docker.sock` and stops seeing container events. New/changed containers
then fail to route and return **502**, while existing/file-provider routes keep working
(so it looks partial and is easy to misdiagnose). The host socket is fine; only the
proxy's view is stale, and **only restarting `coolify-proxy` fixes it**. This has
recurred (2026-06-18, 2026-06-22 — see AGENTS.md → Critical incidents).

**Root cause & PRIMARY fix (do this):** Both recurrences (2026-06-18, 2026-06-21) were
triggered by **`unattended-upgrades` auto-upgrading `docker-ce`/`containerd`**, which
restarts the daemon and recreates the socket. The elegant fix is to stop the daemon from
being auto-restarted by holding those packages:

```bash
sudo apt-mark hold docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras docker-model-plugin
```

Trade-off: Docker no longer auto-updates — update it manually in a controlled window
(`sudo apt-mark unhold ...; sudo apt update && sudo apt install --only-upgrade docker-ce ...;
sudo apt-mark hold ...`) and **`docker restart coolify-proxy` afterwards** (or let the
watchdog catch it). Verify holds: `apt-mark showhold | grep -E 'docker|containerd'`.

**Why ALSO a watchdog (defense in depth):** the hold prevents the *automatic* trigger,
but a manual docker upgrade, a crash, or an OOM can still restart the daemon. Coolify owns
the `coolify-proxy` container definition, so a mount/healthcheck change there would be
overwritten on the next proxy redeploy. The watchdog is external, non-invasive, and
clobber-proof — it self-heals the rare remaining cases.

**What it does:** `coolify-proxy-socket-watchdog.sh` runs every 3 min via a systemd
timer. It restarts `coolify-proxy` **only** when the docker-socket error is *sustained*
(≥3 occurrences in the last 2 min **and** still erroring in the last 45s — ignores
transient blips during a normal daemon restart), and **rate-limits** to at most one
restart per 15 min so it can never flap. Actions are logged to
`/var/log/coolify-proxy-watchdog.log`.

### Install (on the VPS, as a sudo user)

```bash
sudo install -m 0755 deploy/vps/coolify-proxy-socket-watchdog.sh /usr/local/bin/

sudo tee /etc/systemd/system/coolify-proxy-watchdog.service >/dev/null <<'EOF'
[Unit]
Description=Coolify proxy docker-socket self-heal watchdog
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/coolify-proxy-socket-watchdog.sh
EOF

sudo tee /etc/systemd/system/coolify-proxy-watchdog.timer >/dev/null <<'EOF'
[Unit]
Description=Run coolify-proxy socket watchdog every 3 minutes
[Timer]
OnBootSec=2min
OnCalendar=*:0/3
AccuracySec=20s
Persistent=true
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now coolify-proxy-watchdog.timer
```

### Verify / operate

```bash
systemctl list-timers coolify-proxy-watchdog.timer   # next scheduled run
sudo systemctl start coolify-proxy-watchdog.service  # run once now (no-op if healthy)
sudo tail -f /var/log/coolify-proxy-watchdog.log     # see detections/restarts
```

To manually fix the underlying issue at any time: `docker restart coolify-proxy`.
