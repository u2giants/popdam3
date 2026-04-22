# PopDAM

Digital Asset Manager for licensed consumer-product art (Disney, Marvel, Warner Bros., etc.).
Source design files (`.psd`, `.ai`) live on a Synology NAS. PopDAM ingests them, generates
thumbnails, uploads to cloud storage, and gives the team a dark-mode web UI for browsing,
searching, filtering, and tagging assets.

## Architecture — Brain + Muscle

```
┌──────────────────────────────────────────────────────────────┐
│  BRAIN — Cloud                                               │
│                                                              │
│  Web App (Lovable/React)   Edge Functions (Supabase/Deno)    │
│  - browse, search, filter  - admin-api (admin UI ops)        │
│  - admin config/monitoring - agent-api (agent comms)         │
│                            - erp-sync, export-*, etc.        │
│                                                              │
│  Cloud Worker (Railway/Node.js)                              │
│  - AI tagging (OpenRouter/Gemini)                            │
│  - ERP enrichment + AI classification                        │
│  - Style group rebuild + tag propagation                     │
│                                                              │
│  Supabase: PostgreSQL + Auth + Realtime                      │
│  DigitalOcean Spaces: thumbnail storage (S3-compatible)      │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS (poll only — NAS never receives inbound calls)
            ┌───────────────┴───────────────┐
            │                               │
┌───────────▼──────────┐    ┌───────────────▼──────────────┐
│  Bridge Agent        │    │  Windows Render Agent         │
│  (Synology Docker)   │    │  (optional, .ai files only)   │
│  - scans NAS         │    │  - renders via Illustrator    │
│  - quick hash        │    │  - TIFF optimization          │
│  - thumbnail gen     │    │  - hygiene scanning           │
│  - uploads to Spaces │    │  - reports via agent-api      │
│  - reports to cloud  │    └───────────────────────────────┘
└──────────────────────┘
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
│   └── popdam-helper/    ← Helper utilities
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
| [docs/WORKER_LOGIC.md](docs/WORKER_LOGIC.md) | Background worker behavior (AI tagging, propagation, ERP, rebuild) |
| [docs/BULK_JOBS.md](docs/BULK_JOBS.md) | Bulk/background job system and cross-lane conflict map |
| [SELFHOST.md](SELFHOST.md) | Frontend deployment: VPS architecture, CI/CD pipeline, ops runbook |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Worker (Railway) and Supabase deployment |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | Local setup, environment, first-run checklist |
| [docs/KNOWN_QUIRKS.md](docs/KNOWN_QUIRKS.md) | Intentional oddities — read before changing anything |
| [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) | API contracts between Brain and Muscle |
| [docs/PATH_UTILS.md](docs/PATH_UTILS.md) | Path canonicalization rules (prevents the most common class of bugs) |
| [docs/WINDOWS_AGENT_RUNBOOK.md](docs/WINDOWS_AGENT_RUNBOOK.md) | Windows render agent operation |
| [docs/AI_OPERATING_RULES.md](docs/AI_OPERATING_RULES.md) | Rules for AI tools working in this repo |
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
