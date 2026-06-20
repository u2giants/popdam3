# PopDAM

Digital Asset Manager for licensed consumer-product art (Disney, Marvel, Warner Bros., etc.).
Source design files (`.psd`, `.ai`) live on a Synology NAS. PopDAM ingests them, generates
thumbnails, uploads to cloud storage, and gives the team a dark-mode web UI for browsing,
searching, filtering, and tagging assets.

**Start here for development:** read [`AGENTS.md`](AGENTS.md) — it has the full project map,
task navigation, deployment paths, and known quirks.

## Quick start

```bash
npm install
npm run dev
```

No `.env.local` needed — the Supabase URL and anon key are hardcoded in `src/lib/app-mode.ts`
and connect to the production project (`qsllyeztdwjgirsysgai`) by default. See quirk #1 in
[docs/KNOWN_QUIRKS.md](docs/KNOWN_QUIRKS.md) for why.

To preview PopSG mode locally: add `?mode=popsg` to the URL.

See [docs/development.md](docs/development.md) for local dev reference.

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────┐
│  Cloud                                                       │
│                                                              │
│  Web App (React/Vite)      Edge Functions (Supabase/Deno)    │
│  - browse, search, filter  - admin-api, agent-api            │
│  - admin config/monitoring - helper-api, erp-sync, etc.      │
│                                                              │
│  Cloud Worker (Railway/Node.js)                              │
│  - AI tagging, ERP enrichment, style group rebuild           │
│                                                              │
│  Supabase: PostgreSQL + Auth + pg_cron                       │
│  DigitalOcean Spaces: thumbnail storage (S3-compatible)      │
└─────────┬───────────────────────────────────────────────────┘
          │ HTTPS (agents poll outward; cloud never reaches in)
┌─────────▼──────────┐    ┌──────────────────────────────────┐
│  Bridge Agent      │    │  POP DAM Helper (Electron)       │
│  (Synology Docker) │    │  Windows / macOS desktop app     │
│  - scans NAS       │    │  - checkout + checkin workflow   │
│  - thumbnail gen   │    │  - local HTTP server :47380      │
│  - uploads Spaces  │    └──────────────────────────────────┘
└────────────────────┘
│  Windows Render Agent (optional, .ai/.psd files)
│  - renders via Illustrator
└──────────────────────────────────────────────────────────────
```

## Repo structure

```
popdam3/
├── apps/
│   ├── bridge-agent/     ← Synology NAS Docker agent
│   ├── windows-agent/    ← Windows Illustrator render agent
│   ├── worker/           ← Railway cloud background worker
│   └── popdam-helper/    ← Electron desktop app (checkout/checkin)
├── src/                  ← React web app
├── supabase/             ← Migrations and Edge Functions
├── packages/path-filters/ ← Shared path filter logic
└── docs/                 ← All documentation
```

## Documentation

| Doc | What it covers |
|-----|----------------|
| [AGENTS.md](AGENTS.md) | **Start here.** Full developer guide: project summary, repo structure, task navigation, identifiers, deployment, quirks. |
| [CLAUDE.md](CLAUDE.md) | Claude Code-specific workflow rules (git, migrations, workarounds policy) |
| [SELFHOST.md](SELFHOST.md) | VPS / Coolify / Traefik ops, CI/CD pipeline, SSH policy |
| [docs/architecture.md](docs/architecture.md) | System design, components, networking model, API boundaries |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Database schema reference |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Supabase, Spaces, Railway, edge function inventory |
| [docs/STYLE_GROUPS.md](docs/STYLE_GROUPS.md) | Style group system — rebuild, reconcile, cover assets |
| [docs/BULK_JOBS.md](docs/BULK_JOBS.md) | Bulk/background job system and cross-lane conflict map |
| [docs/ERP_ENRICHMENT_PLAN.md](docs/ERP_ENRICHMENT_PLAN.md) | ERP sync, MG codes, AI category classification |
| [docs/POPSG.md](docs/POPSG.md) | PopSG mode — schema, crawl flow, render pipeline |
| [docs/POPDAM_HELPER.md](docs/POPDAM_HELPER.md) | Desktop Helper (checkout/check-in) architecture |
| [docs/SEAFILE_INTEGRATION.md](docs/SEAFILE_INTEGRATION.md) | Seafile/SeaDrive transport for WFH designers |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Microsoft/Azure SSO, Google OAuth, email/password, legacy Authentik |
| [docs/WORKER_LOGIC.md](docs/WORKER_LOGIC.md) | Bridge agent behavior contracts |
| [docs/deployment.md](docs/deployment.md) | Full deploy pipeline (frontend, Supabase, Railway, agents, Helper), pg_cron jobs, rollback, SSH policy |
| [docs/development.md](docs/development.md) | Local dev setup, running, testing |
| [docs/configuration.md](docs/configuration.md) | Environment variables, GitHub secrets, admin config |
| [docs/KNOWN_QUIRKS.md](docs/KNOWN_QUIRKS.md) | Intentional oddities — read before changing anything |

## Critical rules

1. **Never change file timestamps.** Before any operation touching a file, record mtime + birthtime. After the operation, verify and restore. See [docs/PROJECT_BIBLE.md](docs/PROJECT_BIBLE.md).

2. **Canonical path format in the DB:** POSIX style, no leading slash, no trailing slash. See [docs/PATH_UTILS.md](docs/PATH_UTILS.md).

3. **The cloud never reaches into the NAS.** Bridge Agent polls outward only.

4. **Before starting any background job, check the cross-lane conflict map in [docs/BULK_JOBS.md](docs/BULK_JOBS.md).** Concurrent jobs can conflict.

## Deployment

Push to `main` → GitHub Actions builds Docker image → pushes to GHCR → triggers Coolify API → Coolify pulls image and updates the production container.

See [SELFHOST.md](SELFHOST.md) for the full architecture, required secrets, and ops runbook.
