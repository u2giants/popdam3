# popdam3

Internal Digital Asset Manager for licensed consumer-product art, with a second mode for licensor style guide libraries.

Design files (`.psd`, `.ai`) live on a Synology NAS. The system ingests them, generates thumbnails, uploads to DigitalOcean Spaces, and gives the team a dark-mode web UI for browsing, searching, filtering, tagging, and managing artwork submissions. The same codebase serves two apps: **PopDAM** (internal art team, SKUs/ERP) and **PopSG** (licensors, folder-based browsing).

## Deployment targets

| URL | Mode | Description |
|-----|------|-------------|
| `dam.designflow.app` | PopDAM | Licensed consumer-product DAM — SKUs, MG codes, ERP enrichment, AI tagging |
| `sg.designflow.app` | PopSG | Licensor style guide library — folder browsing, render pipeline, no SKUs |

One Docker image, one Coolify app. Traefik routes both hostnames to the same container. Mode is detected at runtime from `window.location.host` via `src/lib/app-mode.ts`.

## Quick links

| Doc | What it covers |
|-----|---------------|
| [AGENTS.md](AGENTS.md) | Full developer guide — structure, identifiers, quirks, deployment, task navigation |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Brain + Muscle system design, networking model |
| [docs/development.md](docs/development.md) | Local dev setup and commands |
| [docs/deployment.md](docs/deployment.md) | Bridge agent and Helper release pipeline |
| [docs/configuration.md](docs/configuration.md) | Environment variables, secrets, admin config keys |

## Getting started

```bash
npm install
npm run dev          # runs on port 8080
```

No `.env.local` needed — the frontend connects directly to the production Supabase project (`ryltkzzernhwnojzouyb`). Credentials are hardcoded in `src/lib/app-mode.ts` (anon key only; see AGENTS.md §9 for why).

To preview PopSG mode locally, add `?mode=popsg` to the URL.

## Dual-mode design

PopDAM and PopSG share one codebase, one Docker image, one Supabase project, and one deployment. Mode controls UI routing only — PopSG-specific pages live in `src/pages/popsg/` and are guarded by `IS_POPSG`. PopDAM-only views (filter sidebar, ERP tabs, style group grid) are not rendered in PopSG mode. See [AGENTS.md](AGENTS.md) for the full architecture.
