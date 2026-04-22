# Frontend Deployment — Self-Hosted VPS

This document describes the current production deployment for the PopDAM frontend at `dam.designflow.app`.

## Architecture

```
┌──────────────────────────┐
│ User browser             │
└────────────┬─────────────┘
             │ HTTPS (TLS via Cloudflare DNS-01)
             ▼
┌──────────────────────────┐    ← VPS: 178.156.180.212
│ Traefik (coolify-proxy)  │    ← runs inside Docker container, not host process
│ - routes dam.designflow  │
│ - terminates TLS         │
└────────────┬─────────────┘
             │ Docker network: coolify
             ▼
┌──────────────────────────┐
│ popdam-frontend          │
│ nginx:1.27-alpine        │
│ port 80 (internal only)  │
└──────────────────────────┘
             ▲
             │ deploy on every push to main
┌────────────┴─────────────┐
│ GitHub Actions           │
│ publish-frontend.yml     │
│ 1. npm ci + vite build   │
│ 2. docker build + push   │
│    → GHCR :latest + :sha │
│ 3. SSH to VPS            │
│    docker pull + run     │
│    docker cp Traefik cfg │
└──────────────────────────┘
```

### Key architectural facts

- **Traefik runs inside `coolify-proxy`** — not as a host process. Coolify installs Traefik in a Docker container named `coolify-proxy`. Config files must be written **into** this container using `docker cp`, not to the host filesystem.
- **Docker DNS for routing** — both `coolify-proxy` and `popdam-frontend` are on the `coolify` network. Traefik reaches the app at `http://popdam-frontend:80` (Docker DNS). Using `127.0.0.1:8781` would reference localhost *inside* the Traefik container, not the host.
- **GitHub Actions manages the container directly** — the frontend container is not managed through Coolify's UI. Coolify provides the `coolify` network and the Traefik proxy, but deployment bypasses Coolify's application lifecycle entirely.
- **TLS via `letsencrypt-dns` (Cloudflare DNS-01)** — the `.app` TLD is on Chrome's HSTS preload list (hardcoded HTTPS required). Standard HTTP-01 ACME doesn't work because port 80 validation would fail HSTS. Cloudflare DNS-01 is configured in Coolify's Traefik with CF credentials in the container environment.
- **Supabase URL/anon key baked into the bundle** — these are embedded at build time by Vite. No runtime env vars needed on the VPS. The container is a pure static-asset server.

---

## CI/CD Pipeline

**Workflow:** `.github/workflows/publish-frontend.yml`

Triggers on push to `main` touching: `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `nginx.conf`, or the workflow file itself.

### Steps

1. **Checkout** + capture git metadata (`APP_COMMIT`, `APP_DATE`)
2. **`npm ci`** — install dependencies
3. **`npm run build`** — Vite produces `dist/`
4. **Docker build** using `Dockerfile.ci`:
   - base: `nginx:1.27-alpine`
   - copies `nginx.conf` and `dist/`
   - tags: `ghcr.io/u2giants/popdam-frontend:latest` and `:<short-sha>`
5. **Push** both tags to GHCR (authenticated via `GHCR_PAT` secret)
6. **SSH to VPS** (`root@178.156.180.212`, key in `VPS_SSH_KEY` secret):
   - `docker pull ghcr.io/u2giants/popdam-frontend:latest`
   - Stop and remove existing `popdam-frontend` container
   - `docker run -d --name popdam-frontend --network coolify --restart unless-stopped -p 8781:80` with Traefik labels
   - Decode base64 Traefik file-provider config and `docker cp` it into `coolify-proxy:/traefik/dynamic/popdam-frontend.yml`
   - Smoke test: `curl -H "Host: dam.designflow.app" http://127.0.0.1:80/`

### Required GitHub secrets

| Secret | Value |
|--------|-------|
| `GHCR_PAT` | GitHub PAT with `write:packages` scope |
| `VPS_SSH_KEY` | SSH private key for `root@178.156.180.212` |

---

## Traefik Routing Config

The file-provider config (base64-encoded in the workflow, decoded to `/tmp/popdam-traefik.yml` and then `docker cp`'d into the container) contains:

```yaml
http:
  routers:
    popdam-http:
      rule: "Host(`dam.designflow.app`)"
      entrypoints: [http]
      service: popdam-svc
    popdam-https:
      rule: "Host(`dam.designflow.app`)"
      entrypoints: [https]
      tls:
        certResolver: letsencrypt-dns
      service: popdam-svc
  services:
    popdam-svc:
      loadBalancer:
        servers:
          - url: "http://popdam-frontend:80"
```

**Why file provider, not Docker labels?** Docker labels on the `popdam-frontend` container were not being picked up because Traefik's Docker provider is configured to only watch containers Coolify created. The file provider is loaded from `/traefik/dynamic/` inside `coolify-proxy` and is watched for changes (`--providers.file.watch=true`).

---

## Docker Images

| Image | Tag | Purpose |
|-------|-----|---------|
| `ghcr.io/u2giants/popdam-frontend` | `latest` | Current prod (pulled on every deploy) |
| `ghcr.io/u2giants/popdam-frontend` | `<short-sha>` | Pinned rollback target |

Image is built from `Dockerfile.ci` (not `Dockerfile`):
- `Dockerfile` — local dev/test (multi-stage with Node builder inside Docker)
- `Dockerfile.ci` — CI only (Node build runs in the Actions runner; Docker image is runtime-only nginx)

---

## Operations Runbook

### Force redeploy (without a code change)

Push an empty commit:
```bash
git commit --allow-empty -m "chore: force redeploy"
git push origin main
git push github main
```

Or retrigger the workflow from GitHub Actions UI.

### Roll back to a previous image

```bash
ssh root@178.156.180.212
docker stop popdam-frontend && docker rm popdam-frontend
docker run -d \
  --name popdam-frontend \
  --network coolify \
  --restart unless-stopped \
  -p 8781:80 \
  ghcr.io/u2giants/popdam-frontend:<short-sha>
# Also re-inject the Traefik config (it survives container restarts, but verify):
docker exec coolify-proxy ls /traefik/dynamic/
```

### Check container status

```bash
ssh root@178.156.180.212
docker ps --filter "name=popdam-frontend" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs popdam-frontend --tail 50
```

### Check Traefik routing

```bash
ssh root@178.156.180.212
# Verify config file exists in the container:
docker exec coolify-proxy cat /traefik/dynamic/popdam-frontend.yml

# Test routing from host (Traefik listens on port 80):
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: dam.designflow.app" http://127.0.0.1:80/

# If Traefik returns 404: config not loaded yet or wrong file content
# If Traefik returns 502: config loaded but backend not reachable (check Docker network)
# If Traefik returns 200: working
```

### Verify TLS certificate

```bash
# From any machine:
curl -sI https://dam.designflow.app | grep -i 'HTTP\|server\|content-type'
openssl s_client -connect dam.designflow.app:443 -servername dam.designflow.app < /dev/null 2>&1 | grep -E 'subject|issuer|expire'
```

### If HSTS blocks the site in browser

The `.app` TLD is on Chrome's HSTS preload list — all `.app` domains must serve valid HTTPS. If the cert is invalid or missing, Chrome will show "You cannot visit dam.designflow.app right now because the website uses HSTS" with no click-through option.

Fix: the `letsencrypt-dns` certresolver in Traefik will issue/renew automatically. If it hasn't issued yet, check:
1. `docker exec coolify-proxy cat /etc/traefik/traefik.yml` — verify `letsencrypt-dns` certresolver is configured
2. `docker logs coolify-proxy 2>&1 | grep -i 'acme\|certificate\|dns'` — look for Cloudflare DNS-01 errors
3. Cloudflare API token for DNS-01 must be present in `coolify-proxy`'s environment

### Update the server

The VPS runs Ubuntu. Standard OS upgrades are safe:
```bash
ssh root@178.156.180.212
apt update && apt upgrade -y
# Reboot if kernel update:
reboot
# Containers come back automatically (restart: unless-stopped)
```

Coolify auto-updates itself via its own mechanism. The `popdam-frontend` container is unaffected by Coolify updates.

---

## Troubleshooting

### CI: "YAML parse error" / "0 jobs found"

Any YAML content (heredoc, multiline shell) starting at column 0 inside a `run: |` block scalar terminates the block early. GitHub then falls back to the filename as the workflow name and shows 0 jobs.

Fix: never put content at column 0 in a `run:` block. Use base64-encoded content for any multi-line YAML strings embedded in the workflow.

### Container is running but site returns 404

Traefik doesn't have the routing config. Check if the file exists in the container:
```bash
docker exec coolify-proxy ls /traefik/dynamic/
docker exec coolify-proxy cat /traefik/dynamic/popdam-frontend.yml
```

If missing, the `docker cp` step in the last deployment may have failed. Re-inject manually:
```bash
echo '<base64-string>' | base64 -d > /tmp/popdam-traefik.yml
TRAEFIK_CONT=$(docker ps --format '{{.Names}}' | grep -iE '^coolify-proxy$|^traefik$' | head -1)
docker exec "$TRAEFIK_CONT" mkdir -p /traefik/dynamic
docker cp /tmp/popdam-traefik.yml "$TRAEFIK_CONT":/traefik/dynamic/popdam-frontend.yml
```

The base64 string is in `.github/workflows/publish-frontend.yml`.

### Container returns 502 Bad Gateway

Traefik has a routing rule but can't reach the backend. Most likely cause: `popdam-frontend` container isn't on the `coolify` network or used the wrong backend URL.

Check:
```bash
docker inspect popdam-frontend | python3 -c "import json,sys; d=json.load(sys.stdin); print(list(d[0]['NetworkSettings']['Networks'].keys()))"
# Should include 'coolify'
```

The Traefik config must use `http://popdam-frontend:80` (Docker DNS), not `http://127.0.0.1:8781` (host loopback inside Traefik container).

### SPA routes return 404 on hard refresh

The `nginx.conf` SPA fallback isn't working. Verify:
```bash
docker exec popdam-frontend cat /etc/nginx/conf.d/default.conf | grep try_files
# Expected: try_files $uri $uri/ /index.html;
```

### App loads but Supabase requests fail (CORS or 401)

The Vite build baked in wrong credentials. Check `.env` in the repo — `VITE_SUPABASE_URL` should be `https://ryltkzzernhwnojzouyb.supabase.co`. Fix the env file and push to `main` to trigger a rebuild.

---

## What NOT To Do

- **Do not** manage the `popdam-frontend` container via Coolify's UI — Coolify doesn't know about it; changes through the UI will conflict.
- **Do not** add runtime env vars to the container — Supabase credentials are baked in at build time.
- **Do not** write Traefik config to `/traefik/dynamic/` on the host filesystem — Traefik reads from inside the `coolify-proxy` container.
- **Do not** use `http://127.0.0.1:8781` as the backend URL in Traefik config — that's localhost inside the Traefik container, not the host.
- **Do not** use HTTP-01 ACME challenges for `dam.designflow.app` — the `.app` HSTS preload list requires valid HTTPS, and HTTP-01 validation will fail under those constraints. Use `letsencrypt-dns`.
- **Do not** rebuild the image directly on the VPS. Go through CI.
- **Do not** mix the SynoMon Supabase project (`qnjimovrsaacneqkggsn`) with the popdam project (`ryltkzzernhwnojzouyb`).
