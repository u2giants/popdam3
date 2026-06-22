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

**Root cause:** Both recurrences (2026-06-18, 2026-06-21) were triggered by docker/containerd
auto-upgrades restarting the daemon, which recreates `/var/run/docker.sock` (new inode).
With **`live-restore: true`** (Coolify's default), containers — including `coolify-proxy` —
keep running through the daemon restart, so the proxy never gets a fresh socket mount and
its Traefik docker provider goes blind → new/changed containers 502.

**PRIMARY fix (event-driven, lets docker update freely):** `coolify-proxy-reconnect.service`
— a systemd unit bound to `docker.service` that restarts **only** `coolify-proxy` after the
daemon (re)starts, so Traefik re-reads the current socket. Verified 2026-06-22: a
`systemctl restart docker` recovers full routing in ~30s automatically (apps stay up via
live-restore; only the public proxy blips). Docker stays **unheld** and auto-updates
normally. Install:

```bash
sudo install -m 0755 deploy/vps/restart-coolify-proxy-after-docker.sh /usr/local/bin/
sudo tee /etc/systemd/system/coolify-proxy-reconnect.service >/dev/null <<'EOF'
[Unit]
Description=Restart coolify-proxy after docker (re)starts so Traefik re-reads the docker socket
After=docker.service
BindsTo=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/restart-coolify-proxy-after-docker.sh
[Install]
WantedBy=docker.service
EOF
sudo systemctl daemon-reload && sudo systemctl enable coolify-proxy-reconnect.service
```

**BACKSTOP — the watchdog (below):** covers the rare case the reconnect unit doesn't fire
(e.g. a daemon crash that systemd handles oddly). It's external, non-invasive, and
clobber-proof. Keep it as belt-and-suspenders; it should rarely act now.

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
