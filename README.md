# PopDAM

Digital Asset Manager for licensed consumer-product art (Disney, Marvel, Warner Bros., etc.).
Source design files (`.psd`, `.ai`) live on a Synology NAS. PopDAM ingests them, generates
thumbnails, uploads to cloud storage, and gives the team a dark-mode web UI for browsing,
searching, filtering, and tagging assets.

## Architecture — Brain + Muscle + Helper

```
┌──────────────────────────────────────────────────────────────┐
│  BRAIN — Cloud                                               │
│                                                              │
│  Web App (Lovable/React)   Edge Functions (Supabase/Deno)    │
│  - browse, search, filter  - admin-api (admin UI ops)        │
│  - admin config/monitoring - agent-api (agent comms)         │
│  - checkout/checkin UI     - helper-api (desktop helper)     │
│                            - erp-sync, export-*, etc.        │
│                                                              │
│  Cloud Worker (Railway/Node.js)                              │
│  - AI tagging (OpenRouter/Gemini)                            │
│  - ERP enrichment + AI classification                        │
│  - Style group rebuild + tag propagation                     │
│                                                              │
│  Supabase: PostgreSQL + Auth + Realtime                      │
│  DigitalOcean Spaces: thumbnail storage (S3-compatible)      │
└─────────┬─────────────────────────────────┬─────────────────┘
          │ HTTPS                           │ HTTPS
          │ (poll only — NAS               │
          │  never receives inbound)        │
┌─────────▼──────────┐    ┌────────────────▼──────────────────┐
│  Bridge Agent      │    │  POP DAM Helper (Electron)        │
│  (Synology Docker) │    │  Windows / macOS desktop app      │
│  - scans NAS       │    │  - checkout + checkin workflow    │
│  - quick hash      │    │  - local server :47380 for fast   │
│  - thumbnail gen   │    │    directory browsing             │
│  - uploads Spaces  │    │  - uploads via Synology API       │
└────────────────────┘    └───────────────────────────────────┘
│  Windows Render Agent (optional, .ai files only)
│  - renders via Illustrator, TIFF optimization, hygiene scan
└──────────────────────────────────────────────────────────────
```

The cloud never reaches into the NAS. Agents poll outward via HTTPS.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full networking model.

## Quick start

```bash
npm install
npm run dev
```

Requires `.env.local` with at minimum `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The project uses the **external** Supabase project (`ryltkzzernhwnojzouyb`), not the Lovable-provisioned one — see quirk #1 in [docs/KNOWN_QUIRKS.md](docs/KNOWN_QUIRKS.md).
See [docs/ONBOARDING.md](docs/ONBOARDING.md) for the full setup checklist.

## Repo structure

```
popdam3/
├── apps/
│   ├── bridge-agent/     ← Synology NAS Docker agent (TypeScript)
│   ├── windows-agent/    ← Windows Illustrator render agent (TypeScript)
│   ├── worker/           ← Cloud background worker (AI tagging, ERP, propagation)
│   └── popdam-helper/    ← Windows/macOS Electron desktop app (checkout/checkin workflow)
├── src/                  ← React web app (Lovable-generated, Vite + Tailwind)
├── supabase/             ← Supabase migrations and Edge Functions
└── docs/                 ← All documentation
```

## Documentation

| Doc | What it covers |
|-----|----------------|
| [docs/PROJECT_BIBLE.md](docs/PROJECT_BIBLE.md) | Non-negotiables, golden rules, architecture constraints. **Highest authority — read first.** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Brain + Muscle system, networking model, API boundaries |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Database schema reference |
| [docs/WORKER_LOGIC.md](docs/WORKER_LOGIC.md) | Bridge/Windows agent behavior: AI tagging, PDF text extraction, ERP, propagation |
| [docs/BULK_JOBS.md](docs/BULK_JOBS.md) | Bulk/background job system and cross-lane conflict map |
| [docs/POPSG.md](docs/POPSG.md) | PopSG style guide mode — schema, crawl flow, render pipeline, nightly cron |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Auth paths: Authentik SSO, Google/Microsoft OAuth, email/password |
| [docs/MULTI_TENANT_AGENTS.md](docs/MULTI_TENANT_AGENTS.md) | Multi-tenant agent architecture |
| [docs/ERP_ENRICHMENT_PLAN.md](docs/ERP_ENRICHMENT_PLAN.md) | ERP sync, MG code resolution, category classification |
| [docs/STYLE_GROUPS.md](docs/STYLE_GROUPS.md) | Style group system — grouping logic, cover assets, tag propagation |
| [docs/UI_OVERVIEW.md](docs/UI_OVERVIEW.md) | Frontend page inventory and component map |
| [SELFHOST.md](SELFHOST.md) | Frontend deployment: VPS architecture, CI/CD pipeline, ops runbook |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Worker (Railway) and Supabase deployment |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | Local setup, environment, first-run checklist |
| [docs/KNOWN_QUIRKS.md](docs/KNOWN_QUIRKS.md) | Intentional oddities — read before changing anything |
| [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) | API contracts between Brain and Muscle |
| [docs/PATH_UTILS.md](docs/PATH_UTILS.md) | Path canonicalization rules (prevents the most common class of bugs) |
| [docs/WINDOWS_AGENT_RUNBOOK.md](docs/WINDOWS_AGENT_RUNBOOK.md) | Windows render agent operation |
| [docs/POPDAM_HELPER.md](docs/POPDAM_HELPER.md) | POP DAM Helper desktop app — architecture, build, install, checkout workflow |
| [docs/AI_OPERATING_RULES.md](docs/AI_OPERATING_RULES.md) | Rules for AI tools working in this repo |
| [docs/MODEL_RULES.md](docs/MODEL_RULES.md) | AI model catalogue — capabilities, routing, constraints |
| [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md) | Admin operations and maintenance tasks |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Infrastructure: Supabase, Spaces, Coolify, Tailscale |

## Critical rules (do not skip)

1. **Never change file timestamps.** Before any operation touching a file, record mtime + birthtime. After the operation, verify and restore them. If timestamps can't be restored, stop processing and report an error. See [docs/PROJECT_BIBLE.md](docs/PROJECT_BIBLE.md).

2. **Canonical path format in the DB:** POSIX style, no leading slash, no trailing slash. Example: `Decor/Projects/Foo/bar.psd`. See [docs/PATH_UTILS.md](docs/PATH_UTILS.md).

3. **The cloud never reaches into the NAS.** The Bridge Agent polls outward only.

4. **Before starting any background job, check the cross-lane conflict map in [docs/BULK_JOBS.md](docs/BULK_JOBS.md).** Concurrent jobs can conflict.

## Deployment

Push to `main` → GitHub Actions builds Docker image → SSHes into VPS → `docker run` + injects Traefik config.

The VPS runs Coolify (which provides the Docker network and Traefik reverse-proxy), but the `popdam-frontend` container is managed directly by GitHub Actions, not through Coolify's UI. See [SELFHOST.md](SELFHOST.md) for the full deployment architecture and ops runbook.
