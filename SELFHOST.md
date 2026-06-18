# Frontend Deployment — Self-Hosted VPS

Production deployment for `dam.designflow.app` (PopDAM) and `sg.designflow.app` (PopSG). Both hostnames serve the same Docker image; the app detects hostname at runtime to switch modes.

## Architecture

```
┌──────────────────────────┐
│ User browser             │
└────────────┬─────────────┘
             │ HTTPS (TLS via letsencrypt HTTP-01)
             ▼
┌──────────────────────────┐    ← VPS: 178.156.180.212
│ Traefik (coolify-proxy)  │    ← Coolify-managed Docker container
│ - routes dam.designflow  │      host mount: /data/coolify/proxy/
│ - routes sg.designflow   │      → container: /traefik/
│ - terminates TLS         │
└────────────┬─────────────┘
             │ Docker network: coolify
             ▼
┌──────────────────────────────────────────┐
│ popdam-frontend (Coolify-managed)        │
│ nginx:1.27-alpine, port 80              │
│ Coolify app UUID: qxj8a0j3tpa9lq4q5rs6pezy │
│ Image: ghcr.io/u2giants/popdam-frontend  │
└──────────────────────────────────────────┘
             ▲
             │ pull image + start container
┌────────────┴───────────┐
│ Coolify                │  https://coolify.designflow.app
│ POST /api/v1/deploy    │
└────────────┬───────────┘
             ▲
             │ COOLIFY_TOKEN secret
┌────────────┴─────────────┐
│ GitHub Actions           │
│ publish-frontend.yml     │
│ 1. npm ci + vite build   │
│ 2. docker build + push   │
│    → GHCR :latest + :sha │
│ 3. POST Coolify API      │
└──────────────────────────┘
```

### Key facts

- **Coolify owns the container.** App UUID `qxj8a0j3tpa9lq4q5rs6pezy`. Coolify pulls `:latest` from GHCR and manages the container lifecycle. Do not run `docker run` manually for this container.
- **GitHub Actions triggers Coolify, not the server.** After pushing the image, CI posts to Coolify's deploy API. Coolify then pulls the image and replaces the container.
- **Traefik reads from `/data/coolify/proxy/dynamic/` on the host.** This directory is bind-mounted into `coolify-proxy` as `/traefik/dynamic/`. Files placed here are watched and loaded live (no restart needed).
- **`dam.designflow.app` is routed via Docker labels** set by Coolify on the managed container. The Traefik service name `https-0-qxj8a0j3tpa9lq4q5rs6pezy` is derived from the app UUID and remains stable across redeploys even though the container name changes.
- **`sg.designflow.app` is routed via a file provider** at `/data/coolify/proxy/dynamic/popdam-sg.yml`. Coolify's Docker label mechanism only applies the first FQDN per app; a separate file provider handles the second hostname using a `@docker` cross-provider service reference.
- **Supabase credentials are hardcoded in the bundle.** `src/lib/app-mode.ts` embeds the Supabase URL and anon key at build time. No runtime env vars are needed on the VPS; the container is a pure static-file server.
- **TLS uses `letsencrypt` (HTTP-01).** Both `dam.designflow.app` and `sg.designflow.app` get certs from Traefik's `letsencrypt` resolver. The `.app` HSTS preload list means browsers enforce HTTPS, but that doesn't affect Let's Encrypt's server-to-server HTTP-01 validation — HTTP-01 works fine.
- **nginx listens on both IPv4 and IPv6 (`listen 80; listen [::]:80;`).** Coolify's health check resolves `localhost` to `::1` (IPv6). If nginx only listens on IPv4, the container is marked `unhealthy` and Traefik stops routing to it.

---

## CI/CD Pipeline

**Workflow:** `.github/workflows/publish-frontend.yml`

Triggers on push to `main` touching: `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`, `Dockerfile`, `nginx.conf`, or the workflow file itself.

### Steps

1. **Checkout** + capture git metadata (`APP_COMMIT`, `APP_DATE`)
2. **`npm ci`** — install dependencies
3. **`npm run build`** — Vite produces `dist/`
4. **Docker build** using `Dockerfile.ci` (runtime-only nginx; Node build runs in the Actions runner):
   - base: `nginx:1.27-alpine`
   - tags: `ghcr.io/u2giants/popdam-frontend:latest`, `:sha-<short-sha>`, and `:<short-sha>`
5. **Push** tags to GHCR (authenticated via the workflow `GITHUB_TOKEN`)
6. **Trigger Coolify** — `GET /api/v1/deploy?uuid=qxj8a0j3tpa9lq4q5rs6pezy&force=false` with `Authorization: Bearer $COOLIFY_TOKEN`

### Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `COOLIFY_TOKEN` | Coolify API token (deploy permission) — ID 30 in the Coolify DB |
| `COOLIFY_APP_UUID` | `qxj8a0j3tpa9lq4q5rs6pezy` — passed to the deploy endpoint |
| `COOLIFY_URL` | `https://coolify.designflow.app` — Coolify API base URL |

`VPS_SSH_KEY` was removed on 2026-05-15; it is no longer used or stored.

---

## Traefik Routing

### `dam.designflow.app` — Docker labels (Coolify-managed)

Coolify applies these labels when it starts the container. The Traefik service name is stable across redeploys.

```
traefik.enable=true
traefik.http.routers.http-0-qxj8a0j3tpa9lq4q5rs6pezy.rule=Host(`dam.designflow.app`) && PathPrefix(`/`)
traefik.http.routers.http-0-qxj8a0j3tpa9lq4q5rs6pezy.middlewares=redirect-to-https
traefik.http.routers.https-0-qxj8a0j3tpa9lq4q5rs6pezy.rule=Host(`dam.designflow.app`) && PathPrefix(`/`)
traefik.http.routers.https-0-qxj8a0j3tpa9lq4q5rs6pezy.tls=true
traefik.http.routers.https-0-qxj8a0j3tpa9lq4q5rs6pezy.tls.certresolver=letsencrypt
traefik.http.services.https-0-qxj8a0j3tpa9lq4q5rs6pezy.loadbalancer.server.port=80
```

### `sg.designflow.app` — file provider

**Host path:** `/data/coolify/proxy/dynamic/popdam-sg.yml`
**Traefik path:** `/traefik/dynamic/popdam-sg.yml` (bind-mounted; no `docker cp` needed)

```yaml
http:
  routers:
    popdam-sg-http:
      rule: "Host(`sg.designflow.app`)"
      entrypoints: [http]
      middlewares: [redirect-to-https@file]
      service: "https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker"
    popdam-sg-https:
      rule: "Host(`sg.designflow.app`)"
      entrypoints: [https]
      middlewares: [gzip@file]
      tls:
        certResolver: letsencrypt
      service: "https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker"
```

The `@docker` suffix references the service registered by Coolify's Docker provider. This stays valid across container redeploys because the service name is UUID-based, not container-name-based. During a deployment (old container stopped, new one not yet healthy), `sg.designflow.app` returns 503 for ~10–30 seconds.

---

## Docker Images

| Image | Tag | Purpose |
|-------|-----|---------|
| `ghcr.io/u2giants/popdam-frontend` | `latest` | Current prod — Coolify pulls this on every deploy |
| `ghcr.io/u2giants/popdam-frontend` | `sha-<short-sha>` | Preferred immutable rollback/audit target |
| `ghcr.io/u2giants/popdam-frontend` | `<short-sha>` | Pinned rollback target |

**`Dockerfile` vs `Dockerfile.ci`:**
- `Dockerfile` — local dev/test: multi-stage, Node build runs inside Docker
- `Dockerfile.ci` — CI only: runtime-only nginx; Node build runs in the Actions runner

---

## Operations Runbook

> **SSH access to the production server is for emergency and diagnostic use only.**
> Normal deployment uses GitHub Actions → GHCR → Coolify API (no SSH required).
> GitHub's green `popdam / production` deployment badge can be Railway worker status. For frontend freshness, verify the `Publish Frontend Image` workflow and live build SHA/header.
> SSH commands in this section are for debugging incidents, inspecting logs, and emergency break-glass repairs.
> They must not become a routine deployment path. Any action taken via SSH must be reflected in the repo or Coolify immediately afterward so the server does not become a hidden source of truth.

### Force redeploy (without a code change)

```bash
git commit --allow-empty -m "chore: force redeploy"
git push origin main && git push github main
```

Or retrigger from the GitHub Actions UI.

Or call Coolify directly (needs the token):
```bash
curl -H "Authorization: Bearer <COOLIFY_TOKEN>" -H "Accept: application/json" \
  "https://coolify.designflow.app/api/v1/deploy?uuid=qxj8a0j3tpa9lq4q5rs6pezy&force=false"
```

### Roll back to a previous image

Rollback goes through Coolify. Change the image tag in Coolify's UI (`https://coolify.designflow.app`, open the `popdam-frontend` app, edit image tag to `<short-sha>`), then trigger a redeploy.

For emergency rollback without Coolify UI access (break-glass only — restore to Coolify UI management as soon as possible):
```bash
ssh root@178.156.180.212
docker exec coolify-db psql -U coolify -d coolify -c \
  "UPDATE applications SET docker_registry_image_tag='<sha>' WHERE uuid='qxj8a0j3tpa9lq4q5rs6pezy';"
# Then trigger deploy via API or empty commit
```

### Check container status

```bash
ssh root@178.156.180.212
docker ps --filter "name=qxj8a0j3tpa9lq4q5rs6pezy" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
docker logs $(docker ps -q --filter "name=qxj8a0j3tpa9lq4q5rs6pezy") --tail 50
```

### Check routing

```bash
ssh root@178.156.180.212
# Test HTTP (should 302 to HTTPS):
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: dam.designflow.app" http://127.0.0.1:80/
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: sg.designflow.app" http://127.0.0.1:80/

# Test HTTPS (should 200):
curl -sk -o /dev/null -w "%{http_code}\n" https://dam.designflow.app/
curl -sk -o /dev/null -w "%{http_code}\n" https://sg.designflow.app/

# Verify sg file provider:
cat /data/coolify/proxy/dynamic/popdam-sg.yml
```

### Verify TLS

```bash
curl -sI https://dam.designflow.app | head -5
openssl s_client -connect dam.designflow.app:443 -servername dam.designflow.app \
  < /dev/null 2>&1 | grep -E 'subject|issuer|expire'
```

### Re-create the sg.designflow.app file provider

If `/data/coolify/proxy/dynamic/popdam-sg.yml` is missing (e.g., after a VPS rebuild):

```bash
cat > /data/coolify/proxy/dynamic/popdam-sg.yml << 'EOF'
http:
  routers:
    popdam-sg-http:
      rule: "Host(`sg.designflow.app`)"
      entrypoints: [http]
      middlewares: [redirect-to-https@file]
      service: "https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker"
    popdam-sg-https:
      rule: "Host(`sg.designflow.app`)"
      entrypoints: [https]
      middlewares: [gzip@file]
      tls:
        certResolver: letsencrypt
      service: "https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker"
EOF
```

Traefik reloads within seconds (no restart needed).

---

## Troubleshooting

### HTTP 404 on `dam.designflow.app`

Traefik has no route for this host. Causes:
- Container is `unhealthy` — Traefik stops routing to unhealthy containers. Run `docker ps --filter "name=qxj8a0j3tpa9lq4q5rs6pezy"` to check status.
- Container just replaced — Docker label discovery has a ~5s lag after the new container becomes healthy.

To check health:
```bash
docker inspect $(docker ps -q --filter "name=qxj8a0j3tpa9lq4q5rs6pezy") \
  | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d['State']['Health'])"
```

### Container unhealthy despite nginx running

Coolify's health check resolves `localhost` to `::1` (IPv6). If nginx doesn't listen on `[::]:80`, the check fails. The `nginx.conf` in this repo includes `listen [::]:80;`. If you see `(unhealthy)` verify:
```bash
docker exec $(docker ps -q --filter "name=qxj8a0j3tpa9lq4q5rs6pezy") \
  netstat -tlnp | grep :80
# Should show: 0.0.0.0:80 AND :::80
```

### HTTP 503 on `sg.designflow.app`

The file provider references the Docker service but it's unavailable. Either:
- Transient (container replacing) — wait 30s
- The Coolify-managed container stopped: `docker ps --filter "name=qxj8a0j3tpa9lq4q5rs6pezy"`
- Traefik error: `docker logs coolify-proxy --tail 30 2>&1 | grep qxj8a0j`

### HSTS / `.app` domain

Browsers enforce HTTPS for `.app` with no click-through option. If TLS is broken, check Traefik cert renewal:
```bash
docker logs coolify-proxy 2>&1 | grep -i 'acme\|certificate\|letsencrypt'
```

### SPA routes return 404 on hard refresh

nginx `try_files` fallback isn't configured. Verify:
```bash
docker exec $(docker ps -q --filter "name=qxj8a0j3tpa9lq4q5rs6pezy") \
  cat /etc/nginx/conf.d/default.conf | grep try_files
# Expected: try_files $uri $uri/ /index.html;
```

---

## What NOT To Do

- **Do not** manage this container with `docker run` — Coolify owns it. A manual `docker run` creates a second container that competes with the Coolify-managed one.
- **Do not** delete `/data/coolify/proxy/dynamic/popdam-sg.yml` — `sg.designflow.app` will stop routing.
- **Do not** add runtime env vars to the container — Supabase credentials are baked into the bundle at build time.
- **Do not** rebuild the image on the VPS — always go through CI.
- **Do not** mix Supabase projects: popdam-prod is `ryltkzzernhwnojzouyb`; SynoMon is `qnjimovrsaacneqkggsn`.
