# Self-Hosting PopDAM Frontend on Coolify

**Audience**: A developer (or careful operator) who has never seen this codebase before.
**Goal**: Move the PopDAM **frontend** from `*.lovable.app` hosting to a self-managed VPS running Coolify, while keeping:

- **Backend** on Supabase.com (project `ryltkzzernhwnojzouyb`) — **unchanged**
- **Worker** on Railway — **unchanged**
- **Bridge Agent** on Synology NAS (Docker) — **unchanged**
- **Windows Render Agent** on Windows desktop — **unchanged**
- **Lovable editor** as the primary IDE, auto-syncing to GitHub `main` — **unchanged**

If you follow this document top-to-bottom and do not skip steps, you cannot break the system. Every command, every field, every checkbox is spelled out.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [What's Already Done in the Repo](#3-whats-already-done-in-the-repo)
4. [Phase 1 — Verify the Docker Image Builds in CI](#4-phase-1--verify-the-docker-image-builds-in-ci)
5. [Phase 2 — Make the GHCR Image Pullable](#5-phase-2--make-the-ghcr-image-pullable)
6. [Phase 3 — Provision the VPS](#6-phase-3--provision-the-vps)
7. [Phase 4 — Install Coolify](#7-phase-4--install-coolify)
8. [Phase 5 — Create the Coolify Application](#8-phase-5--create-the-coolify-application)
9. [Phase 6 — Connect the Custom Domain](#9-phase-6--connect-the-custom-domain)
10. [Phase 7 — Auto-Redeploy on Every Lovable Edit](#10-phase-7--auto-redeploy-on-every-lovable-edit)
11. [Phase 8 — Cutover from Lovable Hosting](#11-phase-8--cutover-from-lovable-hosting)
12. [Phase 9 — Post-Cutover Verification](#12-phase-9--post-cutover-verification)
13. [Operations Runbook](#13-operations-runbook)
14. [Rollback Plan](#14-rollback-plan)
15. [Troubleshooting](#15-troubleshooting)
16. [What NOT To Do](#16-what-not-to-do)
17. [Appendix A — File Reference](#17-appendix-a--file-reference)
18. [Appendix B — Glossary](#18-appendix-b--glossary)

---

## 1) Architecture Overview

### Before (current, all-Lovable hosting)

```
┌──────────────────────────┐
│ User browser             │
└────────────┬─────────────┘
             │ HTTPS
             ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│ dam.designflow.app       │ ──XHR──▶│ ryltkzzernhwnojzouyb     │
│ (Lovable static hosting) │         │ .supabase.co (Supabase)  │
│ — built by Lovable       │         │ — Auth, DB, Edge Funcs,  │
│ — auto-deploys on edit   │         │   Storage                │
└──────────────────────────┘         └────────────┬─────────────┘
                                                  │
                                          polled by ▼
                                     ┌──────────────────────────┐
                                     │ Railway worker           │
                                     │ (apps/worker)            │
                                     └──────────────────────────┘
                                                  ▲
                                                  │ polls
                                     ┌────────────┴─────────────┐
                                     │ Bridge Agent (Synology)  │
                                     │ Windows Render Agent     │
                                     └──────────────────────────┘
```

### After (frontend on your Coolify VPS, everything else unchanged)

```
┌──────────────────────────┐
│ User browser             │
└────────────┬─────────────┘
             │ HTTPS
             ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│ dam.designflow.app       │ ──XHR──▶│ ryltkzzernhwnojzouyb     │
│ Coolify on your VPS      │         │ .supabase.co (UNCHANGED) │
│ Docker: nginx + SPA      │         └──────────────────────────┘
│ Image: GHCR popdam-      │
│        frontend:latest   │
└────────────▲─────────────┘
             │ pulls new image
┌────────────┴─────────────┐
│ GitHub Container Registry│
└────────────▲─────────────┘
             │ pushes built image
┌────────────┴─────────────┐
│ GitHub Actions           │
│ publish-frontend.yml     │
└────────────▲─────────────┘
             │ webhook on push
┌────────────┴─────────────┐
│ GitHub repo: u2giants/   │
│ popdam3 (main branch)    │
└────────────▲─────────────┘
             │ auto-syncs every edit
┌────────────┴─────────────┐
│ Lovable editor           │
│ (unchanged workflow)     │
└──────────────────────────┘

    Workers + agents unchanged — they only talk to Supabase.
```

**Critical insight**: The Supabase URL and anon key are **baked into the JavaScript bundle at build time** (Vite reads `.env`). The frontend doesn't need any runtime environment variables. This means the Coolify container is a pure static-asset server with zero secrets.

---

## 2) Prerequisites

You must have **all** of the following before starting. Do not skip any.

| # | Requirement | Where to get it | Notes |
|---|-------------|-----------------|-------|
| 1 | A VPS with public IPv4 | Hetzner / DigitalOcean / Vultr / Linode | Minimum: 2 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 22.04 LTS or 24.04 LTS |
| 2 | Root SSH access to that VPS | Provider control panel | Use SSH keys, not passwords |
| 3 | Ability to edit DNS for `designflow.app` | Domain registrar | You'll create A records |
| 4 | A GitHub account with **admin** access to `u2giants/popdam3` | github.com | Required for package visibility + Actions |
| 5 | The current Lovable project still works | https://dam.designflow.app | Do not start migration until baseline is healthy |
| 6 | A test browser profile that does NOT cache aggressively | Firefox / Chrome incognito | For verifying cutover |

**Estimated total time**: 90–120 minutes if everything goes smoothly.
**Cost**: $5–$15/month for the VPS. GHCR and GitHub Actions are free for public packages on this scale.

---

## 3) What's Already Done in the Repo

The following files **already exist** on `main` and are ready to use. Do not modify them unless this guide tells you to:

| File | Purpose |
|------|---------|
| `Dockerfile` | Two-stage build: `node:20` builds the SPA, `nginx:1.27-alpine` serves it |
| `nginx.conf` | SPA fallback (`try_files $uri $uri/ /index.html`), gzip, cache headers, security headers |
| `vite.config.ts` | Reads `APP_COMMIT` / `APP_DATE` env vars; falls back to git only when those are missing — Docker-safe |
| `.github/workflows/publish-frontend.yml` | Builds and pushes `ghcr.io/u2giants/popdam-frontend:latest` and `:<short-sha>` on every push to `main` that touches frontend files |
| `docs/COOLIFY_DEPLOYMENT.md` | Earlier short version of this guide. Still valid; this document supersedes it for the full procedure |

If any of these files is missing, **stop**. Either restore from a recent commit or open the project in Lovable and ask the AI to recreate them before continuing.

---

## 4) Phase 1 — Verify the Docker Image Builds in CI

You need to confirm the image-build pipeline works **before** you provision a VPS. If the build is broken, fix it first.

### 4.1 Trigger a build

Either of these will trigger `publish-frontend.yml`:

- **Option A (recommended)**: Make any small edit in Lovable (e.g., add a space to a comment in `src/App.tsx`) and let it auto-commit to `main`.
- **Option B (manual)**: In GitHub, go to **Actions → Publish Frontend Image → Run workflow** and pick `main`.

### 4.2 Watch the run complete

1. Go to https://github.com/u2giants/popdam3/actions
2. Click the most recent run of **Publish Frontend Image**
3. Wait for **all jobs to be green** (typically 3–5 minutes)

### 4.3 Confirm the image exists

1. Go to https://github.com/u2giants?tab=packages
2. You should see a package named **`popdam-frontend`**
3. Click into it and confirm there are tags `latest` and a short SHA (e.g., `a1b2c3d`)

If the run fails, see [Troubleshooting → CI build fails](#15-troubleshooting). **Do not proceed to Phase 2 until this is green.**

### 4.4 (Optional but recommended) Test the image locally

If you have Docker installed on your laptop:

```bash
docker run --rm -p 8080:80 ghcr.io/u2giants/popdam-frontend:latest
# Then open http://localhost:8080
```

You should see the PopDAM login page. Click around — every route refresh should work (the SPA fallback in `nginx.conf` handles this). If you get a 404 on refresh, `nginx.conf` is broken; do not proceed.

---

## 5) Phase 2 — Make the GHCR Image Pullable

By default, GHCR packages are **private** and require a token to pull. The simplest fix is to make this one public.

### 5.1 Make the package public

1. Go to https://github.com/u2giants?tab=packages
2. Click **`popdam-frontend`**
3. In the right sidebar, click **Package settings**
4. Scroll to the bottom: **Danger Zone → Change visibility**
5. Click **Change visibility → Public**
6. Type the package name to confirm

The image is now world-readable. The frontend bundle contains only the Supabase URL + **anon** publishable key, which are designed to be public, so this is safe.

### 5.2 (Alternative, only if you cannot make it public) Use a pull token

If your org policy forbids public packages:

1. Create a GitHub Personal Access Token (classic) with **only** the `read:packages` scope.
2. In Coolify, after the server is set up: **Sources → Docker Registries → + New**.
3. Registry URL: `ghcr.io` · Username: your GitHub username · Password: the PAT.
4. When you create the application in Phase 5, select this registry.

The rest of this guide assumes the **public** path. If you went private, the only difference is that the Coolify image field works the same way; you just preselect the registry.

---

## 6) Phase 3 — Provision the VPS

Any provider works. Recommended sizing:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| vCPU | 2 | 2 |
| RAM | 2 GB | 4 GB |
| Disk | 25 GB | 40 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Network | 1 Gbps, public IPv4 | same |

### 6.1 Create the server

1. Spin up an Ubuntu 24.04 LTS server with the sizing above.
2. **Add your SSH public key during creation.** Do not allow password SSH.
3. Note the **public IPv4 address** — you will need it for DNS.

### 6.2 First-login hardening (10 minutes)

SSH in as root:

```bash
ssh root@YOUR_VPS_IP
```

Run these commands one at a time. They are safe and idempotent:

```bash
# Update everything
apt update && apt upgrade -y

# Set hostname (replace with whatever you like)
hostnamectl set-hostname popdam-coolify

# Set timezone (use UTC for servers)
timedatectl set-timezone UTC

# Enable the firewall — allow SSH, HTTP, HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp   # Coolify dashboard (we'll lock this down later)
ufw --force enable

# Enable automatic security updates
apt install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# Reboot to apply kernel updates
reboot
```

Wait ~60 seconds, then SSH back in.

---

## 7) Phase 4 — Install Coolify

Coolify provides a one-line installer that handles Docker, Traefik, and the dashboard. Run it as root on your VPS:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This takes 3–5 minutes. When it finishes, the script prints a URL like:

```
Coolify is now available at: http://YOUR_VPS_IP:8000
```

### 7.1 First-time setup

1. Open `http://YOUR_VPS_IP:8000` in your browser
2. Create the **root admin account** — use a strong, unique password and store it in a password manager
3. On the dashboard you'll see your **localhost** server already registered — Coolify can deploy to itself

### 7.2 (Optional but recommended) Put Coolify itself behind HTTPS

Coolify has a built-in flow for this:

1. **Settings → Instance Settings**
2. Set **Instance's Domain** to something like `coolify.yourdomain.com`
3. Add a DNS A record `coolify.yourdomain.com → YOUR_VPS_IP` at your registrar
4. Wait for DNS to propagate (a few minutes)
5. Click **Save**. Coolify will issue a Let's Encrypt cert and serve itself over HTTPS
6. Once that works, close port 8000 in the firewall: `ufw delete allow 8000/tcp`

---

## 8) Phase 5 — Create the Coolify Application

This is where you tell Coolify to pull and run the frontend image.

### 8.1 Create a new project

1. In Coolify: **Projects → + New Project**
2. Name: `popdam`
3. Click **Continue**

### 8.2 Create the application

1. Inside the `popdam` project: **+ New Resource → Application**
2. Choose **Docker Image** as the source (NOT a git repo — we want the prebuilt image)
3. Click **Continue**

### 8.3 Fill in the form

| Field | Value |
|-------|-------|
| **Name** | `popdam-frontend` |
| **Image** | `ghcr.io/u2giants/popdam-frontend:latest` |
| **Port (exposed)** | `80` |
| **Health check path** | `/` |
| **Restart policy** | `unless-stopped` |

Leave everything else at defaults.

### 8.4 Environment variables

**None.** This is correct. The Supabase URL and anon key are baked into the bundle at build time.

If you ever see a guide telling you to add `VITE_SUPABASE_URL` here at runtime — ignore it. Vite-based apps require the env vars at build time, not runtime, and ours are already embedded.

### 8.5 Deploy

1. Click **Deploy** (top right)
2. Watch the logs panel — Coolify will:
   - Pull `ghcr.io/u2giants/popdam-frontend:latest`
   - Start the container
   - Run the healthcheck (`wget --spider http://localhost/`)
3. After ~30–60 seconds, status should be **Running** with a green dot

### 8.6 Verify it's serving

Coolify automatically assigns a temporary subdomain like `popdam-frontend-xxx.YOUR_VPS_IP.sslip.io`. Click it.

You should see the PopDAM login screen. **Don't log in yet** — we still need to set the real domain so OAuth callbacks work.

---

## 9) Phase 6 — Connect the Custom Domain

The current production domain is `dam.designflow.app`. You need to move it from Lovable's IP to your VPS.

### 9.1 Add the domain in Coolify (BEFORE updating DNS)

1. Open the `popdam-frontend` application in Coolify
2. Go to **Domains** (or "Configuration" → "Domains" depending on Coolify version)
3. Add: `https://dam.designflow.app`
4. Enable **Generate Let's Encrypt certificate**
5. Save — Coolify configures Traefik but cannot issue the cert yet (DNS still points to Lovable)

### 9.2 Update DNS at your registrar

Find the existing record for `dam.designflow.app`. It currently points to a Lovable IP (likely `185.158.133.1`). Change it:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `dam` | `YOUR_VPS_IP` | 300 (5 min) |

**Set TTL to 300 seconds before cutover** so you can roll back quickly if needed.

If you also have a `www.dam.designflow.app` or similar, update it the same way.

### 9.3 Wait for DNS to propagate, then issue the cert

1. From your laptop, run: `dig dam.designflow.app +short`
2. When it returns `YOUR_VPS_IP`, you're propagated
3. In Coolify, on the Domains page, click **Force regenerate certificate** (or redeploy)
4. Within ~30 seconds, Let's Encrypt issues the cert

### 9.4 Smoke test

1. Open `https://dam.designflow.app` in an **incognito window**
2. You should see the login page with a valid padlock (no cert warnings)
3. **Do not log in yet** — first verify the Supabase OAuth callback works (Phase 8)

---

## 10) Phase 7 — Auto-Redeploy on Every Lovable Edit

Right now, when Lovable edits the code, GitHub Actions rebuilds the image — but Coolify doesn't know to pull it. Fix this with a webhook.

### 10.1 Get the Coolify webhook URL

1. Open the `popdam-frontend` application
2. Go to **Webhooks** (sometimes under "Configuration")
3. Copy the **Deploy webhook URL** (looks like `https://coolify.yourdomain.com/api/v1/deploy?uuid=...&force=false`)
4. Also copy the **API token** if shown separately

### 10.2 Add the webhook to GitHub Actions

1. In GitHub: **Settings → Secrets and variables → Actions → + New repository secret**
2. Name: `COOLIFY_DEPLOY_WEBHOOK`
3. Value: the full webhook URL from step 10.1
4. Save

### 10.3 Append a deploy step to the workflow

Open `.github/workflows/publish-frontend.yml` (in Lovable or via a direct PR) and add this step at the very end of the `build-and-push` job:

```yaml
      - name: Trigger Coolify deploy
        if: success()
        run: |
          curl -fsSL -X GET "${{ secrets.COOLIFY_DEPLOY_WEBHOOK }}" \
            -H "Accept: application/json"
```

Now every push to `main` that touches frontend files will:

1. Build the new image
2. Push it to GHCR
3. Poke Coolify, which pulls the new `:latest` and rolls the container

End-to-end propagation: **~3–5 minutes from Lovable edit to live site.**

### 10.4 Alternative: Coolify polling

If you don't want to add the webhook, Coolify can poll GHCR for new image digests:

1. In the application: **Settings → Advanced**
2. Enable **Watch for new image versions** (or "Automatic redeploy on image update")
3. Set the poll interval (default: 5 minutes)

Webhook is faster and more reliable. Use it if possible.

---

## 11) Phase 8 — Cutover from Lovable Hosting

At this point both Lovable hosting AND your Coolify deploy serve the same app. Now make Coolify the only one.

### 11.1 Verify Supabase Auth callback URLs

Because the **same domain** (`dam.designflow.app`) is moving, Supabase OAuth should not need any changes. But verify anyway:

1. Log into Supabase dashboard for project `ryltkzzernhwnojzouyb`
2. **Authentication → URL Configuration**
3. Confirm **Site URL** = `https://dam.designflow.app`
4. Confirm **Redirect URLs** includes `https://dam.designflow.app/**`

If for any reason you used a temporary subdomain during testing, add it here too — otherwise OAuth login will silently fail.

### 11.2 Test the full login flow on Coolify

In an incognito window on `https://dam.designflow.app`:

1. Click **Sign in with Google** (or whichever method)
2. Complete OAuth
3. You should land on the library page
4. Open the asset library — thumbnails should load (proves DigitalOcean Spaces still serves them)
5. Try a search — proves Supabase queries work
6. Click into Settings → Diagnostics — proves edge functions work

If any of these fail, see [Troubleshooting](#15-troubleshooting). **Do not detach the Lovable hosting until the test passes.**

### 11.3 Detach the domain from Lovable

Once Coolify is verified:

1. Open the Lovable editor
2. **Project Settings → Domains**
3. Find `dam.designflow.app`
4. Click the three-dot menu → **Remove domain** (or "Disconnect")
5. Confirm

The Lovable preview URL (`*.lovable.app`) keeps working as a parallel deploy. That's fine — it's a free safety net.

### 11.4 Restore DNS TTL

At your registrar, change the TTL on the `dam` A record from `300` back to `3600` (1 hour) or higher. Lower TTLs cost more in DNS queries; you only needed the short TTL for the cutover.

---

## 12) Phase 9 — Post-Cutover Verification

Run through this checklist within 24 hours of cutover:

- [ ] `https://dam.designflow.app` loads in incognito with a valid cert
- [ ] Login via Google OAuth works
- [ ] Login via email/password works
- [ ] Library shows assets and thumbnails
- [ ] Search returns results
- [ ] Settings → Diagnostics shows green for all subsystems
- [ ] Bridge agent on Synology shows recent heartbeat (Settings → Diagnostics → Agents)
- [ ] Windows render agent shows recent heartbeat
- [ ] Railway worker logs show recent activity (no spike in errors)
- [ ] Edit something tiny in Lovable → wait 3–5 min → verify the change appears live
- [ ] In Coolify dashboard, check container memory usage is stable (typically <100 MB for nginx)
- [ ] In Coolify, set up email/discord notifications for deploy failures

---

## 13) Operations Runbook

### 13.1 Daily editing workflow (no change for the user)

Edit in Lovable as normal. Lovable commits to `main`. GitHub Actions builds and pushes. Coolify redeploys. Done. **You as a developer touch nothing.**

### 13.2 Force a redeploy (if Coolify gets stuck)

1. Coolify dashboard → `popdam-frontend` → **Redeploy** button (top right)
2. Watch logs panel

### 13.3 Roll back to a previous image

Every CI run tags the image with the git short SHA (e.g., `:a1b2c3d`). To roll back:

1. Find the SHA you want from GitHub commit history
2. Coolify → application → **Image** field → change `:latest` to `:a1b2c3d`
3. Click **Redeploy**

To return to live tip, change the image back to `:latest` and redeploy.

### 13.4 Update Coolify itself

1. Coolify dashboard → **Settings → Update**
2. Click **Update Coolify**
3. Takes ~2 minutes; your app keeps running during the update

### 13.5 Renew Let's Encrypt certs

Automatic. Coolify renews 30 days before expiry. No action needed.

### 13.6 Server reboots / OS upgrades

Reboot whenever you like. Coolify and the app come back automatically (Docker `restart: unless-stopped`).

For Ubuntu LTS upgrades, schedule a maintenance window: `do-release-upgrade` at the OS level, then reboot.

### 13.7 Backups

The frontend container is stateless. **Nothing to back up on the VPS.**

What you DO need to back up (none of which is on the VPS):

- **Supabase database** — already backed up automatically by Supabase.com
- **DigitalOcean Spaces** (thumbnails) — enable Spaces versioning if you want extra safety
- **GitHub repo** — already the source of truth

---

## 14) Rollback Plan

If anything goes wrong after cutover, you can be back on Lovable hosting in under 10 minutes:

### Fast rollback (DNS-only)

1. At your registrar, change the `dam` A record back to `185.158.133.1` (Lovable's IP)
2. Re-add `dam.designflow.app` in Lovable's **Project Settings → Domains** (you may need to re-verify ownership via TXT record — Lovable shows the value)
3. Wait for DNS TTL (5 min if you kept it low during cutover)
4. Lovable re-issues the SSL cert automatically

The Coolify deployment can keep running in parallel — no rush to tear it down.

### Why this works

Both deploys serve the **same code** from the **same commit**, talking to the **same Supabase backend**. There is no data migration involved. Switching is purely a DNS change.

---

## 15) Troubleshooting

### CI build fails: "git rev-parse HEAD" error

Already handled. `vite.config.ts` falls back to env vars when git isn't available. If you still see this, check that `Dockerfile` passes `APP_COMMIT` and `APP_DATE` as build args.

### CI build fails: "manifest unknown" or auth error pushing to GHCR

The workflow uses `${{ secrets.GITHUB_TOKEN }}` which is automatically provisioned. If it fails:

1. **Settings → Actions → General → Workflow permissions**
2. Select **Read and write permissions**
3. Save and re-run the workflow

### Coolify can't pull the image: "denied: requested access to the resource is denied"

The package is still private. Re-do step 5.1 (make it public) or configure a pull token (step 5.2).

### App loads but shows white screen / console error "Failed to fetch dynamically imported module"

The user has an old `index.html` cached pointing to `/assets/index-OLDHASH.js` that no longer exists. Hard-refresh (Cmd/Ctrl+Shift+R). The `nginx.conf` already sets `Cache-Control: no-cache` on `index.html` so this should be very rare after the first visit.

### App loads but Supabase requests get CORS errors

The Supabase URL or anon key in the bundle is wrong. Check `.env` in the repo (it should have `VITE_SUPABASE_URL=https://ryltkzzernhwnojzouyb.supabase.co`). Then trigger a rebuild.

### Login redirects to localhost or wrong domain after OAuth

Supabase Site URL is wrong. Fix in **Authentication → URL Configuration** (Phase 8.1).

### 404 on every page after refresh

`nginx.conf` SPA fallback isn't being applied. Verify:

```bash
docker exec -it $(docker ps -qf name=popdam-frontend) cat /etc/nginx/conf.d/default.conf | grep try_files
```

You should see `try_files $uri $uri/ /index.html;`. If not, the wrong image is running — redeploy.

### Container keeps restarting (CrashLoopBackOff)

Check Coolify logs for the application. Most common cause: nginx config syntax error from a botched edit. The `nginx.conf` in this repo is known-good — revert to it.

### Let's Encrypt rate-limited

You hit Let's Encrypt's 5-failures-per-hour limit by deploying the wrong DNS. Wait 1 hour, fix DNS, retry.

### Worker on Railway can't reach the new frontend

Trick question — the worker doesn't talk to the frontend. It talks to Supabase. If the worker is acting up, the issue is unrelated to this migration.

---

## 16) What NOT To Do

- ❌ **Do not** edit `src/integrations/supabase/client.ts`. It is auto-generated. Lovable overwrites it.
- ❌ **Do not** add runtime env vars in Coolify like `VITE_SUPABASE_URL`. Vite bakes these in at build time. Runtime env vars do nothing.
- ❌ **Do not** disconnect the Lovable GitHub integration. The whole automation depends on Lovable pushing to `main`.
- ❌ **Do not** start a feature branch workflow. The repo and the Lovable editor expect direct-to-`main`.
- ❌ **Do not** rebuild the image manually on the VPS. Always go through CI so the image in GHCR matches what's deployed.
- ❌ **Do not** mix the SynoMon Supabase project (`qnjimovrsaacneqkggsn`) with the popdam project (`ryltkzzernhwnojzouyb`).
- ❌ **Do not** open port 8000 to the public internet long-term. Use a real domain for the Coolify dashboard (Phase 7.2).
- ❌ **Do not** move the worker or backend in this migration. Scope creep is the #1 way to break a working system.
- ❌ **Do not** use `--include-all` if Coolify or any tool suggests it for Supabase migrations. Migrations are not part of this migration; backend stays on Supabase.com unchanged.

---

## 17) Appendix A — File Reference

Files in the repo that are part of the self-host setup. Read these if you want to understand the full chain:

| File | Read it to understand |
|------|-----------------------|
| `Dockerfile` | How the image is assembled |
| `nginx.conf` | How requests are served |
| `vite.config.ts` | How env vars are baked into the bundle |
| `.github/workflows/publish-frontend.yml` | How CI builds and pushes the image |
| `.env` | What gets baked into the bundle (URL + anon key only — both safe to expose) |
| `package.json` | Build script (`npm run build` → `vite build`) |
| `docs/COOLIFY_DEPLOYMENT.md` | Earlier short version of this doc |
| `docs/ARCHITECTURE.md` | Big picture of the whole system, agents included |
| `docs/DEPLOYMENT.md` | Worker (Railway) deployment, NOT frontend |

---

## 18) Appendix B — Glossary

- **Coolify** — Self-hosted PaaS (Heroku-like) that wraps Docker + Traefik + Let's Encrypt with a friendly UI.
- **GHCR** — GitHub Container Registry. Hosts Docker images for free for public packages.
- **Traefik** — Reverse proxy that Coolify uses to route domains to containers and handle TLS.
- **SPA fallback** — nginx rule that serves `index.html` for any unknown path so React Router can take over.
- **Anon key** — Supabase publishable JWT. Safe to embed in browser bundles. RLS protects the data.
- **Lovable Cloud** — Lovable's managed Supabase + hosting product. **We are NOT using this.** Our backend is on Supabase.com directly under the project ref `ryltkzzernhwnojzouyb`.
- **Bridge Agent** — Node.js daemon on Synology NAS that scans files and uploads thumbnails. Polls Supabase outward; nothing inbound.
- **Windows Render Agent** — Helper for `.ai` files using Illustrator. Polls Supabase.
- **Worker** — Long-running Node.js process on Railway for heavy/async work (AI tagging, ERP sync, etc).

---

## Final note for the developer doing this work

If at any point the instructions don't match what you see in the Coolify UI (Coolify ships frequent updates and labels move around), **stop and ask** before improvising. The semantic intent of each step is described above — match the intent, not the exact button name.

If you finish all phases and the [Post-Cutover Verification](#12-phase-9--post-cutover-verification) checklist is fully green, you are done. The user (a non-technical operator) should not have to know anything changed. Their workflow stays: open Lovable, edit, see changes live in 3–5 minutes.
