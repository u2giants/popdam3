# Coolify Deployment — Frontend

This doc explains how to host the PopDAM **frontend** on your Coolify server while keeping:

- **Backend (Supabase)** on supabase.com (project `ryltkzzernhwnojzouyb`)
- **Worker** on Railway
- **Editor** on Lovable (auto-syncs to GitHub `main`)

The frontend is built into a Docker image and pushed to GitHub Container Registry (GHCR) on every push to `main`. Coolify pulls the image and runs it.

---

## One-time setup

### 1. Make the GHCR image public (or give Coolify a token)

The GitHub Actions workflow `.github/workflows/publish-frontend.yml` pushes to:

```
ghcr.io/u2giants/popdam-frontend:latest
```

Easiest path: make this package public.

1. Go to https://github.com/u2giants?tab=packages
2. Click `popdam-frontend` (it appears after the first successful workflow run)
3. Package settings → **Change visibility** → **Public**

(Alternative: keep it private and add a GHCR pull token in Coolify under **Sources → Docker Registries**.)

### 2. Create the Coolify application

1. In Coolify: **+ New → Resource → Application**
2. Choose **Docker Image** as the source
3. Image: `ghcr.io/u2giants/popdam-frontend:latest`
4. Port: `80`
5. Domain: enter the domain you want (e.g. `dam.designflow.app`) — Coolify will auto-issue a Let's Encrypt cert
6. Environment variables: **none required** — Supabase URL/key are baked into the bundle at build time
7. Click **Deploy**

### 3. Auto-redeploy on every push (optional but recommended)

Coolify can pull the new `:latest` image automatically:

- In the application's **Settings → Advanced**, enable **Watchtower** / **Automatic redeploy**
- Or use Coolify's webhook URL and add it as a step at the end of `.github/workflows/publish-frontend.yml`

---

## What runs where after migration

| Component | Host | Notes |
|-----------|------|-------|
| Frontend (this repo) | **Coolify** | Built as Docker image, served by nginx |
| Worker (`apps/worker`) | Railway | Unchanged |
| Supabase (DB, Auth, Edge Functions, Storage) | supabase.com | Unchanged — project `ryltkzzernhwnojzouyb` |
| Bridge Agent | Synology NAS (Docker) | Unchanged — pulls from GHCR |
| Windows Render Agent | Windows desktop | Unchanged |

---

## Keeping the Lovable editor working

Nothing changes. Lovable continues to commit to `main`. Each push triggers:

1. `publish-frontend.yml` → builds and pushes the Docker image to GHCR
2. Coolify pulls the new image and restarts the container
3. Your custom domain serves the new build within ~2 minutes

You can still preview changes inside Lovable on the `*.lovable.app` URL — it stays live as a parallel deployment. Use whichever URL you prefer day-to-day.

---

## Local Docker test

You can test the production build locally before committing:

```bash
docker build -t popdam-frontend .
docker run --rm -p 8080:80 popdam-frontend
# open http://localhost:8080
```

If routing breaks on refresh, check `nginx.conf` — the `try_files ... /index.html` line is the SPA fallback.

---

## Troubleshooting

**Image pull fails in Coolify**
The package is private. Either make it public (see step 1) or add a GHCR registry token in Coolify.

**Build fails in CI with "git rev-parse" error**
Already handled — `vite.config.ts` reads `APP_COMMIT` / `APP_DATE` env vars passed in via `--build-arg`. If you build locally without git, set them manually:
```bash
docker build --build-arg APP_COMMIT=local --build-arg APP_DATE=2026-04-22 -t popdam-frontend .
```

**404 on page refresh in production**
nginx isn't serving the SPA fallback. Verify `nginx.conf` was copied into the image: `docker run --rm popdam-frontend cat /etc/nginx/conf.d/default.conf`.

**Old version stuck after deploy**
Hard-refresh browser (Cmd/Ctrl+Shift+R). The `index.html` is set to `no-cache` so this should be rare. If it persists, check Coolify actually pulled the new `:latest` digest.