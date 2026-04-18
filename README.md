# PopDAM

Digital Asset Manager for licensed consumer-product art (Disney, Marvel, Warner Bros., etc.).
Source design files (`.psd`, `.ai`) live on a Synology NAS. PopDAM ingests them, generates
thumbnails, uploads to cloud storage, and gives the team a dark-mode web UI for browsing,
searching, filtering, and tagging assets.

## Architecture — Brain + Muscle

```
┌──────────────────────────────────────┐
│  BRAIN — Cloud Web App               │
│  (Lovable / React + Supabase)        │
│  - browse, search, filter, tag       │
│  - admin config and monitoring       │
│  - AI tagging via OpenRouter         │
└───────────────────┬──────────────────┘
                    │ HTTPS (poll only — NAS never receives inbound calls)
    ┌───────────────┴────────────────────────────────┐
    │                                                │
┌───▼──────────────────┐    ┌───────────────────────▼─────┐
│  Bridge Agent        │    │  Windows Render Agent        │
│  (Synology Docker)   │    │  (optional, .ai files only)  │
│  - scans NAS         │    │  - renders via Illustrator   │
│  - quick hash        │    │  - uploads to Spaces         │
│  - thumbnail gen     │    │  - reports via agent-api     │
│  - uploads to Spaces │    └──────────────────────────────┘
│  - reports to cloud  │
└──────────────────────┘
```

The cloud never reaches into the NAS. The NAS worker polls outward (HTTPS) to claim work
and report status. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full networking model.

## Quick start

```bash
pnpm install
pnpm dev
```

Requires `.env.local` with Supabase URL, anon key, and service role key.
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
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment and CI/CD |
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

Push to `main` → GitHub Actions builds Docker image → triggers Coolify deployment.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full pipeline.
