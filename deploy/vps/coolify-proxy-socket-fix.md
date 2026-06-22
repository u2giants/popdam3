# coolify-proxy Docker-Socket Failure — Root Cause & Permanent Fix

Detailed reference for the recurring failure where a **new or changed container returns
`502` from the public domain even though it's healthy**, while other sites stay up. This
bit us on 2026-06-18 and 2026-06-21. As of 2026-06-22 it is fixed at the root cause and
the fix is **verified**. This doc explains the whole thing so a future human or AI never
has to re-derive it.

---

## TL;DR

- **Symptom:** a freshly (re)deployed Coolify *Application* 502s publicly while existing
  sites are fine. The container is healthy and reachable from inside `coolify-proxy`.
- **Cause:** a Docker daemon restart (almost always an auto-upgrade of `docker-ce`/
  `containerd`) recreates `/var/run/docker.sock` with a new inode. Because Docker runs
  with **`live-restore: true`**, `coolify-proxy` keeps running across the restart and
  clings to the **stale** socket mount, so Traefik's docker provider goes blind to
  container events and keeps routing to the old (gone) container → `502`.
- **Fix:** `coolify-proxy-reconnect.service` — a systemd unit bound to `docker.service`
  that restarts **only** `coolify-proxy` after the daemon (re)starts, so Traefik re-reads
  the current socket. Routing recovers in **~30s automatically**. Docker stays **unheld**
  and auto-updates freely; apps stay up via live-restore (only the public proxy blips).
- **Backstop:** `coolify-proxy-watchdog.timer` (every 3 min) restarts the proxy if a
  *sustained* socket failure is ever detected that the reconnect unit didn't handle.
- **Manual escape hatch (any time):** `docker restart coolify-proxy`.

---

## Symptom — how to recognize it

1. A site/endpoint served by a recently redeployed **Coolify Application** returns `502`
   (Bad Gateway) from its public URL.
2. **Other domains keep working** — this partial pattern is the tell.
3. The container itself is **healthy** and answers when hit directly:
   ```bash
   docker ps --filter name=<resource-uuid>            # Up (healthy)
   # from inside the proxy, hit the container's IP:port directly:
   docker exec coolify-proxy wget -qO- --timeout=5 http://<container-ip>:<port>/   # responds
   ```
4. Traefik logs show the docker provider is disconnected:
   ```bash
   docker logs coolify-proxy --since 5m 2>&1 | grep "Cannot connect to the Docker daemon"
   # ERR ... "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" providerName=docker
   ```

> **Key diagnostic distinction:** `502` here is a **routing** failure, not an app failure.
> If `curl`-ing with a bad token returns `401`/`403`/`406`, the app + auth are fine and
> you're looking at this problem. A flat `502` for *every* request to one host while other
> hosts are up = stale docker provider.

---

## Root cause — the full chain

1. **Trigger:** `unattended-upgrades` (installed) auto-upgrades `docker-ce` / `docker-ce-cli`
   / `containerd.io`. The package post-install **restarts the Docker daemon**. Evidence in
   `/var/log/dpkg.log` lines up exactly with both incidents:
   - `2026-06-18 15:43` upgrade `docker-ce-rootless-extras` → incident #1
   - `2026-06-21 21:45` upgrade `docker-ce` 29.5.3→29.6.0 + `containerd.io` 2.2.4→2.2.5 → incident #2
2. **Socket inode change:** restarting `dockerd` removes and recreates
   `/var/run/docker.sock`. A container that **bind-mounts the socket file** captured the
   *old* inode at container-create time; after the recreate that mount is dangling.
3. **`live-restore: true` keeps the proxy alive (this is the crux):** Docker's live-restore
   (Coolify's default — good, it keeps your *apps* running during a docker upgrade) means
   containers are **not** restarted with the daemon. So `coolify-proxy` keeps running with
   its now-**stale** `/var/run/docker.sock` mount instead of getting a fresh one.
   - Verified: after the 21:45 upgrade, `coolify-proxy`'s `StartedAt` was unchanged (it had
     not been restarted), and Traefik logged continuous `Cannot connect to the Docker daemon`.
4. **Traefik docker provider goes blind:** Traefik can no longer read container
   start/stop events, so it keeps the **old** backend (the pre-redeploy container's IP,
   now gone) for any Application whose container was recreated → `502`.
5. **Why only *some* sites break:** Coolify routes **Services** (compose stacks) largely via
   Traefik's **file** provider (`/traefik/dynamic/`), which is unaffected, while
   **Applications** are routed via the **docker** provider (labels), which is blind. So
   Service-based sites and unchanged routes survive; a freshly redeployed Application 502s.
   (Concretely: `devops-mcp` is a Service → survived; `nas-mcp` is an Application → 502'd.)

The host socket is always fine (`docker` works from the shell). **Only the proxy's view is
stale, and only restarting that one container fixes it.**

---

## The fix — event-driven proxy reconnect

When `docker.service` (re)starts, restart `coolify-proxy` so it re-mounts the current socket
and Traefik re-reads everything. This is event-driven (no polling), targeted (only the proxy
restarts, not your apps), and lets docker update on its normal schedule.

### systemd unit — `/etc/systemd/system/coolify-proxy-reconnect.service`
```ini
[Unit]
Description=Restart coolify-proxy after docker (re)starts so Traefik re-reads the docker socket
After=docker.service
BindsTo=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/restart-coolify-proxy-after-docker.sh
[Install]
WantedBy=docker.service
```
Why each line:
- **`WantedBy=docker.service`** (set by `enable`) — pulls this unit in whenever
  `docker.service` is started, including after an upgrade restart.
- **`After=docker.service`** — ordering: run only once `dockerd` is back up.
- **`BindsTo=docker.service`** — ties this unit's lifecycle to docker, so a docker restart
  propagates to a restart of this unit (re-firing the ExecStart).
- **`Type=oneshot`** — runs the script to completion; doesn't stay resident.

### script — `/usr/local/bin/restart-coolify-proxy-after-docker.sh` (versioned at `deploy/vps/restart-coolify-proxy-after-docker.sh`)
```bash
#!/usr/bin/env bash
LOG=/var/log/coolify-proxy-watchdog.log
# wait until dockerd is responsive AND coolify-proxy exists (it comes back via its restart policy)
for i in $(seq 1 30); do docker info >/dev/null 2>&1 && docker inspect coolify-proxy >/dev/null 2>&1 && break; sleep 2; done
if docker restart coolify-proxy >/dev/null 2>&1; then
  echo "$(date -u +%FT%TZ) reconnect: coolify-proxy restarted after docker (re)start" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) reconnect: FAILED to restart coolify-proxy" >> "$LOG"
fi
```
The wait loop (up to ~60s) avoids a race where the unit fires before `dockerd` has finished
coming up / before the proxy container is back.

### Install
See `deploy/vps/README.md` for the copy-paste install block. Docker is left **unheld**
(`apt-mark showhold` shows none) so it auto-updates normally.

---

## The watchdog backstop

`coolify-proxy-watchdog.timer` (systemd, every 3 min) runs
`/usr/local/bin/coolify-proxy-socket-watchdog.sh`, which restarts the proxy **only** when a
*sustained* socket failure is detected (≥3 `Cannot connect to the Docker daemon` errors in
the last 2 min **and** still failing in the last 45s), rate-limited to **1 restart / 15 min**.
It exists for the rare case the reconnect unit doesn't fire (e.g. an unclean daemon crash
systemd handles oddly). With the reconnect unit in place it should essentially never act.

---

## Alternatives considered and rejected

| Approach | Why rejected |
|---|---|
| `apt-mark hold` docker packages | Blocks docker security updates entirely — a workaround, not a fix. (Was applied briefly 2026-06-22, then reverted in favor of the reconnect unit.) |
| Bind-mount the socket **directory** (`/var/run`) into the proxy so the path resolves fresh | Coolify owns `coolify-proxy`'s compose (`/data/coolify/proxy/docker-compose.yml`) and regenerates it on proxy reconfigure/upgrade → the change is **silently reverted**. Also mounts more of `/run` than needed. |
| Disable `live-restore` | Would make *all* containers restart on every docker restart — more app downtime, not less. live-restore is desirable. |
| `docker-socket-proxy` (TCP) in front of Traefik | Still bind-mounts the socket file → same stale-inode failure mode; just moves it. |
| Polling watchdog as the *primary* fix | Works but is reactive (up to ~3 min downtime) and is "more moving parts." Kept only as a backstop. |

---

## Verification — how it was proven (and how to re-test)

On 2026-06-22, `systemctl restart docker` (which exercises the exact daemon-restart +
stale-socket path an upgrade causes) was run while polling the public endpoints:

```
proxy StartedAt BEFORE: 2026-06-22T14:15:50Z
>>> restarting docker.service ...
[1] proxy_started=14:15:50 | dam=200 sg=200 nas=000     # daemon going down
[2] proxy_started=16:57:19 | dam=503 sg=503 nas=503     # proxy restarted by the unit, Traefik booting
[3] proxy_started=16:57:19 | dam=503 sg=503 nas=406     # nas-mcp route loaded (406 = app+auth OK)
[7] proxy_started=16:57:19 | dam=200 sg=200 nas=406     # full recovery, ~30s total
reconnect log: "coolify-proxy restarted after docker (re)start"
```
`nas-mcp` — the Application that stayed 502 for ~15 min in the incident — recovered
automatically in ~10s; all public routing was back in ~30s; apps never went down (live-restore).

**To re-test safely** (causes a ~30s public-routing blip; apps stay up):
```bash
before=$(docker inspect coolify-proxy --format '{{.State.StartedAt}}')
sudo systemctl restart docker
# watch StartedAt change + sites return to 200, and the log line appear:
watch -n3 'docker inspect coolify-proxy --format "{{.State.StartedAt}}"; curl -s -o /dev/null -w "dam=%{http_code}\n" https://dam.designflow.app/'
sudo tail -1 /var/log/coolify-proxy-watchdog.log
```

---

## Manual recovery (if you ever see the symptom)

```bash
docker restart coolify-proxy        # the one and only fix; ~10-30s and routing is back
```
If that doesn't clear it, check the container is actually healthy and that Traefik comes
back clean:
```bash
docker ps --filter name=coolify-proxy
docker logs coolify-proxy --since 2m 2>&1 | grep -iE 'docker daemon|Configuration received'
```

---

## Diagnostics / troubleshooting commands

```bash
# Is the docker provider currently broken?
docker logs coolify-proxy --since 5m 2>&1 | grep "Cannot connect to the Docker daemon"

# Did a docker upgrade just happen? (the usual trigger)
grep -iE 'upgrade (docker|containerd)' /var/log/dpkg.log

# Is the reconnect unit healthy/enabled?
systemctl status coolify-proxy-reconnect.service
systemctl is-enabled coolify-proxy-reconnect.service        # -> enabled

# Backstop watchdog
systemctl list-timers coolify-proxy-watchdog.timer
tail -f /var/log/coolify-proxy-watchdog.log

# Confirm a given Application's container is healthy + reachable from the proxy
docker ps --filter name=<uuid>
docker exec coolify-proxy wget -qO- --timeout=5 http://<container-ip>:<port>/
```

---

## Component inventory

| Component | Location | Purpose |
|---|---|---|
| reconnect script | `/usr/local/bin/restart-coolify-proxy-after-docker.sh` (repo: `deploy/vps/restart-coolify-proxy-after-docker.sh`) | restart proxy after docker (re)start |
| reconnect unit | `/etc/systemd/system/coolify-proxy-reconnect.service` | fires the script on `docker.service` (re)start |
| watchdog script | `/usr/local/bin/coolify-proxy-socket-watchdog.sh` (repo: `deploy/vps/coolify-proxy-socket-watchdog.sh`) | backstop self-heal on sustained failure |
| watchdog timer/service | `/etc/systemd/system/coolify-proxy-watchdog.{timer,service}` | runs the watchdog every 3 min |
| shared log | `/var/log/coolify-proxy-watchdog.log` | both the reconnect unit and watchdog log here |
| Coolify proxy compose (do **not** hand-edit — Coolify regenerates it) | `/data/coolify/proxy/docker-compose.yml` | where the `:ro` socket **file** mount lives |

---

## Incident history & evidence

- **2026-06-18** — frontend/PopSG deploy looked green but routing was stale; root cause
  noted as a stale `coolify-proxy` docker socket; fixed then by a manual proxy restart.
  (See AGENTS.md "Resolved 2026-06-18".) Correlates with `docker-ce-rootless-extras`
  upgrade at 15:43 in `dpkg.log`.
- **2026-06-21/22** — during the MCP token rotation, redeploying the `nas-mcp` Application
  502'd publicly for ~15 min while `devops-mcp` (a Service) stayed up. Root-caused to the
  same stale socket, triggered by the 21:45 `docker-ce`/`containerd` auto-upgrade, with
  `live-restore: true` identified as why the proxy never self-recovered. Permanent fix
  (this doc) installed and verified. (See AGENTS.md "Resolved 2026-06-22".)
