# PopDAM — Developer Onboarding Guide

> **Start here.** This document gives you everything you need to understand PopDAM's business, architecture, codebase, and development workflow. After reading this, you should be able to open a PR on day one.

---

## Table of Contents

1. [What Is PopDAM?](#1-what-is-popdam)
2. [Business Context](#2-business-context)
3. [Architecture Overview](#3-architecture-overview)
4. [Repository Layout](#4-repository-layout)
5. [The Two Supabase Projects Problem](#5-the-two-supabase-projects-problem)
6. [Data Model Essentials](#6-data-model-essentials)
7. [API Boundaries](#7-api-boundaries)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Agent Pairing & Onboarding](#9-agent-pairing--onboarding)
10. [Scanning & Ingestion Pipeline](#10-scanning--ingestion-pipeline)
11. [Thumbnails & Rendering](#11-thumbnails--rendering)
12. [Style Groups & SKU Parsing](#12-style-groups--sku-parsing)
13. [AI Tagging Pipeline](#13-ai-tagging-pipeline)
14. [ERP Enrichment & Classification](#14-erp-enrichment--classification)
15. [Bulk Operations & the Worker](#15-bulk-operations--the-worker)
16. [Path System](#16-path-system)
17. [Deployment & CI/CD](#17-deployment--cicd)
18. [Development Workflow](#18-development-workflow)
19. [Related Documentation](#19-related-documentation)

---

## 1. What Is PopDAM?

PopDAM is a **Digital Asset Manager** purpose-built for a consumer products company that designs licensed character merchandise (Disney, Marvel, Nickelodeon, etc.). Think of it as a specialized media library — but instead of stock photos, it manages thousands of `.psd`, `.ai`, `.pdf`, `.jpg`, and `.png` design files that live on a Synology NAS in the office.

The core problem it solves: designers need to quickly find existing art, see what's been created for which licensors and properties, track which designs are in development vs. approved, and never accidentally modify or lose source files.

## 2. Business Context

### What the company does
The company creates consumer products (home décor, wall art, clocks, storage, tabletop items, etc.) featuring licensed characters. They work with licensors like Disney, Warner Bros, and Nickelodeon. Each product goes through a workflow: concept → development → licensor approval → production.

### Why file dates matter
Licensors audit compliance. If a file's "created" date changes, it can break audit trails and version tracking. **PopDAM must never modify file timestamps** — this is the single most important technical constraint in the entire system (see PROJECT_BIBLE §15).

### Product taxonomy
Products are identified by a **SKU** — a structured code like `HXP8RNBHN02` where segments encode:
- Division (e.g., `H` = Home)
- Licensor code (e.g., `XP` = a specific licensor)
- Size code
- Property code
- Design reference
- Sequence number

The system also tracks **MG codes** (Merchandise Group hierarchy: MG01 → MG02 → MG03) which classify products into categories like "Wall Décor > Canvas > Wrapped Canvas."

### ERP integration
Product master data comes from an external ERP system (DesignFlow API). This provides item descriptions, division codes, licensor/property assignments, and MG categorization. PopDAM syncs this data to enrich asset metadata beyond what the filesystem alone provides.

---

## 3. Architecture Overview

PopDAM is a **hybrid system** split into "Brain" (cloud) and "Muscle" (on-premises):

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLOUD (Brain)                           │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Web App     │  │ Edge Funcs   │  │ Cloud Worker (Railway)  │ │
│  │  (Lovable)   │  │ (Supabase)   │  │ - AI tagging            │ │
│  │  React/Vite  │  │ - admin-api  │  │ - ERP enrichment        │ │
│  │              │  │ - agent-api  │  │ - Style group rebuild   │ │
│  │              │  │ - ai-tag     │  │ - Tag propagation       │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬────────────┘ │
│         │                 │                        │              │
│         └─────────┬───────┘────────────────────────┘              │
│                   │                                               │
│            ┌──────┴──────┐                                        │
│            │  Supabase   │   ← Postgres DB + Auth + Realtime      │
│            │  (hosted)   │                                        │
│            └──────┬──────┘                                        │
└───────────────────┼──────────────────────────────────────────────┘
                    │ HTTPS (outbound only)
        ┌───────────┼───────────┐
        ▼                       ▼
┌───────────────┐      ┌────────────────┐
│ Bridge Agent  │      │ Windows Agent  │
│ (Synology     │      │ (Office PC)    │
│  Docker)      │      │                │
│ - scan files  │      │ - render .ai   │
│ - thumbnail   │      │ - TIFF optim.  │
│ - upload to   │      │ - hygiene scan │
│   DO Spaces   │      │                │
└───────┬───────┘      └────────┬───────┘
        │                       │
        ▼                       ▼
   ┌─────────┐            ┌──────────┐
   │ Synology │            │ NAS      │
   │ NAS     │            │ (mapped  │
   │ (local) │            │  drive)  │
   └─────────┘            └──────────┘
```

### Why the split?

- **PSD/AI files are huge** (50MB–2GB). You can't upload them to the cloud — you generate thumbnails locally and upload only the small JPEGs.
- **The cloud never reaches into the NAS.** All agents poll outward via HTTPS. No VPN, no inbound ports, no Tailscale dependency for the app's data flow.
- **Each component is independently deployable** — the web app ships via Lovable, edge functions via GitHub Actions, the bridge agent as a Docker image, the Windows agent as an NSIS installer, and the worker runs on Railway.

### The 5 Components

| Component | Where | Language | Deployed Via |
|-----------|-------|----------|--------------|
| **Web App** | Lovable hosting | React/TypeScript/Vite | Lovable "Publish" button |
| **Edge Functions** | Supabase | Deno/TypeScript | GitHub Actions → `deploy-supabase.yml` |
| **Bridge Agent** | Synology NAS (Docker) | Node.js/TypeScript | GHCR image → `docker pull` on NAS |
| **Windows Agent** | Office Windows PC | Node.js/TypeScript | NSIS installer → GitHub Releases |
| **Cloud Worker** | Railway | Node.js/TypeScript | Auto-deploy from `main` branch |

---

## 4. Repository Layout

This is a **monorepo** without a formal workspace manager (no Turborepo/Nx). Each app has its own `package.json` and is built independently.

```
popdam3/
├── src/                          # Web App (React frontend)
│   ├── components/
│   │   ├── library/              # Asset browsing UI (grid, list, detail panels)
│   │   ├── settings/             # Admin settings tabs
│   │   └── ui/                   # shadcn/ui components
│   ├── hooks/                    # React hooks (auth, data fetching, admin API)
│   ├── lib/                      # Utilities (path-utils, external-supabase)
│   ├── pages/                    # Route pages
│   └── integrations/supabase/    # Auto-generated Supabase client + types
│
├── supabase/
│   ├── functions/                # Deno edge functions
│   │   ├── admin-api/            # Admin routes (JWT + admin role)
│   │   ├── agent-api/            # Agent routes (x-agent-key auth)
│   │   ├── ai-tag/               # Single-asset AI tagging endpoint
│   │   ├── bulk-job-runner/      # Legacy bulk orchestrator (being replaced by worker)
│   │   ├── _shared/              # Shared code for all edge functions
│   │   │   ├── admin-handlers/   # Extracted handler modules for admin-api
│   │   │   ├── http.ts           # CORS headers, json(), err() helpers
│   │   │   ├── service-client.ts # Creates Supabase client with service role key
│   │   │   ├── sku-parser.ts     # SKU → metadata extraction
│   │   │   ├── style-grouping.ts # SKU folder detection + primary asset selection
│   │   │   └── ...
│   │   └── deno.json             # Deno import map
│   ├── migrations/               # SQL migration files (READ-ONLY — never edit)
│   └── config.toml               # Function-level config (verify_jwt settings)
│
├── apps/
│   ├── bridge-agent/             # Synology NAS scanner + thumbnailer
│   ├── windows-agent/            # Windows rendering + TIFF optimization
│   └── worker/                   # Railway-hosted background worker
│
├── packages/
│   └── path-filters/             # Shared path filtering (junk files, excluded dirs)
│
├── docs/                         # Authoritative documentation
│   ├── PROJECT_BIBLE.md          # Non-negotiable rules (this file wins if conflicts)
│   ├── SCHEMA.md                 # Database schema spec
│   ├── API_CONTRACTS.md          # Endpoint request/response shapes
│   ├── PATH_UTILS.md             # Path normalization rules
│   ├── ARCHITECTURE.md           # System architecture details
│   ├── DEPLOYMENT.md             # How things deploy
│   ├── WORKER_LOGIC.md           # Bridge agent contract
│   └── ONBOARDING.md             # ← You are here
│
├── deploy/synology/              # docker-compose.yml + update script for NAS
├── scripts/                      # Utility scripts (protocol handler, agent scripts)
└── public/downloads/             # Downloadable install bundles
```

---

## 5. The Two Supabase Projects Problem

**This is the single most important architectural quirk to understand.**

PopDAM is built on **Lovable** (a visual app builder). Lovable auto-provisions its own Supabase project and auto-generates `.env`, `src/integrations/supabase/client.ts`, and `src/integrations/supabase/types.ts`.

However, PopDAM's production database is on a **separate, external Supabase project** (`ryltkzzernhwnojzouyb.supabase.co`) that was set up independently. The Lovable-managed project (`vklanxwmaeqjbwtmnygj`) exists but is essentially unused for data.

### How we handle it

1. **`src/lib/external-supabase.ts`** — Hardcodes the real Supabase URL and anon key. This is intentional, not a security issue (anon keys are publishable).

2. **`src/integrations/supabase/client.ts`** — Re-exports the external client:
   ```typescript
   export { externalSupabase as supabase } from "@/lib/external-supabase";
   ```
   Lovable auto-regenerates this file, but we override it. If Lovable overwrites it back, you need to restore the re-export.

3. **`src/integrations/supabase/types.ts`** — This is generated from the **external** project's schema via GitHub Actions, not from Lovable's internal project.

4. **`.env`** — Auto-generated by Lovable with the internal project's values. **We ignore it.** All actual credentials are hardcoded in `external-supabase.ts` or passed via environment variables to agents/worker.

### Rules

- **Never edit `.env`** — it gets overwritten by Lovable
- **Never edit `client.ts`** directly — it gets overwritten; restore the re-export if needed
- **Never edit `types.ts`** — it's auto-generated from the DB schema
- When importing Supabase, always use: `import { supabase } from "@/integrations/supabase/client"`
- For auth specifically, `useAuth.tsx` imports directly from `external-supabase.ts` (this is intentional — see KNOWN_QUIRKS.md)

---

## 6. Data Model Essentials

Full schema details are in `docs/SCHEMA.md`. Here are the key concepts:

### Core tables

| Table | Purpose |
|-------|---------|
| `assets` | Every file on the NAS. The main table (~50+ columns). |
| `style_groups` | Groups of assets sharing a SKU prefix (one "product"). |
| `asset_tags` | AI-generated and manual tags on assets. |
| `asset_characters` | Which Disney/Marvel characters appear in each asset. |
| `licensors` | Disney, Warner Bros, Nickelodeon, etc. |
| `properties` | Frozen, Spider-Man, PAW Patrol (belong to a licensor). |
| `characters` | Elsa, Mickey Mouse (belong to a property). |
| `processing_queue` | Render jobs for the Bridge/Windows agents. |
| `render_queue` | Specifically for Windows Agent rendering (with lease-based claiming). |
| `admin_config` | Key-value config store (scan roots, feature flags, bulk op state). |
| `agent_registrations` | Registered agents with hashed keys. |
| `agent_pairings` | One-time pairing codes for agent onboarding. |
| `invitations` | Email-based invite list (auth is invitation-only). |
| `profiles` | User profiles (created by trigger on signup). |
| `user_roles` | Role assignments (`admin` or `user`). |
| `erp_items_current` | Current ERP product master data. |
| `erp_items_raw` | Raw ERP API responses (immutable snapshots). |
| `product_category_predictions` | AI-classified product categories for ERP items. |
| `hygiene_findings` | File naming/structure issues found during scans. |
| `tiff_optimization_queue` | Queue for TIFF compression jobs. |
| `style_guide_files` | Crawled style guide PDFs/images from licensors. |

### Key columns on `assets`

- **`relative_path`** — Canonical POSIX path from NAS share root. No leading slash. e.g., `Decor/Projects/Disney/Frozen/HXP8RNBHN02/art.psd`
- **`quick_hash`** — First 64KB + last 64KB + file size, hashed. Used for move detection.
- **`modified_at`** — From filesystem `mtime`. NOT NULL, no default — agent must supply it.
- **`file_created_at`** — From filesystem `birthtime` when available.
- **`thumbnail_url`** — Full public URL to DigitalOcean Spaces. `NULL` if no thumbnail yet.
- **`style_group_id`** — FK to the product group this file belongs to.
- **`sku`** — Extracted from folder path if parseable.
- **`primary_sort_tier`** — Computed by trigger: tech packs with thumbnails = tier 0 (shown first on style group cards), down to tier 9.

### Visibility logic (critical)

An asset is **visible** in the UI if ANY of these is true:
- `file_created_at >= THUMBNAIL_MIN_DATE` (default: 2020-01-01)
- `modified_at >= THUMBNAIL_MIN_DATE`
- `thumbnail_url IS NOT NULL`

This means old files without thumbnails are hidden from browse views but still tracked in the DB.

---

## 7. API Boundaries

There are **two separate edge functions** for different auth models. They must never be combined.

### `agent-api` (2,781 lines)
- **Auth**: `x-agent-key` header → SHA-256 hashed → looked up in `agent_registrations`
- **`verify_jwt = false`** in config.toml (agents don't have user JWTs)
- **Callers**: Bridge Agent, Windows Agent
- **Key routes**: `register`, `heartbeat`, `ingest`, `batch-ingest`, `update`, `move`, `complete-job`, `pair`, `progress`, `report-hygiene`
- The heartbeat response doubles as a **config sync channel** — agents receive scan roots, feature flags, and command signals via heartbeat responses

### `admin-api` (1,268 lines)
- **Auth**: User JWT (Bearer token) + admin role check via `user_roles` table
- **`verify_jwt = false`** in config.toml (but JWT is verified manually inside the function because CORS preflight requests don't carry auth headers)
- **Callers**: Web app (via `useAdminApi` hook)
- **Pattern**: Single endpoint, action-based routing. Request body includes `{ action: "trigger-scan", ...params }`. Handlers extracted to `_shared/admin-handlers/`.
- **Service role key bypass**: The Railway worker can call admin-api using the service role key as a Bearer token (for server-to-server calls).

### `useAdminApi` hook (frontend)
All admin API calls go through this hook which handles:
- JWT token refresh (proactive — refreshes if token expires within 30s)
- Retry logic (up to 2 retries with backoff)
- Error extraction (digs into Supabase `FunctionsHttpError` to surface real error messages)

---

## 8. Authentication & Authorization

### Invitation-only
Users cannot self-register. An admin creates an invitation (email + role) via the admin UI. When the invited user signs up (email/password or Google OAuth), the `handle_new_user()` database trigger:
1. Checks the `invitations` table for a matching email
2. If found: creates a `profiles` row + `user_roles` row, marks invitation accepted
3. If not found: **raises an exception**, blocking signup

### Roles
- **`admin`** — Full access to settings, diagnostics, bulk operations, agent management
- **`user`** — Can browse/search/filter assets in the library, view style groups

### Impersonation
Admins can "impersonate" a regular user to see the UI as they would. This is **client-side only** — stored in `sessionStorage`, hides admin UI elements, does not change the JWT or actual permissions.

### OAuth
Google OAuth is configured on the external Supabase project. MS/Azure SSO is explicitly prohibited.

---

## 9. Agent Pairing & Onboarding

Agents use a **one-time pairing flow** to eliminate persistent `.env` configuration:

1. Admin generates a pairing code in the dashboard (format: `XXXX-XXXX-XXXX-XXXX`, expires in 15 minutes)
2. Agent runs for the first time, prompts for or receives the pairing code
3. Agent calls `POST /agent/pair` with the code
4. Server validates the code, generates a permanent `x-agent-key`, hashes it, stores the hash
5. Agent persists the raw key locally:
   - Bridge Agent: `/data/agent-config.json` (Docker volume)
   - Windows Agent: `%ProgramData%\PopDAM\agent-config.json`
6. On subsequent starts, the agent uses the persisted key directly

The **Install Bundles** tab provides downloadable ZIP packages for the Bridge Agent. The Windows Agent uses an NSIS installer that collects the pairing code during setup.

---

## 10. Scanning & Ingestion Pipeline

The Bridge Agent's scan lifecycle:

```
Admin clicks "Scan" → admin_config.SCAN_REQUEST set
       ↓
Agent heartbeat returns SCAN_REQUEST (or Realtime delivers instantly)
       ↓
Agent validates scan roots (stat() each one — fail-fast if missing)
       ↓
Recursive directory walk:
  - Skip junk files (._*, .DS_Store, Thumbs.db, ~*)
  - Skip excluded subfolders (configurable path filters)
  - For each candidate (.psd, .ai, .pdf, .jpg, .png):
    1. stat() → get mtime, birthtime, file size
    2. Check SCAN_MIN_DATE — skip if too old
    3. computeQuickHash() → first 64KB + last 64KB + size
    4. Call agent-api /ingest or /batch-ingest:
       - If quick_hash matches existing asset at same path → skip (unchanged)
       - If quick_hash matches at different path → move detected
       - If no match → new asset
    5. generateThumbnail() → Sharp/Ghostscript/ImageMagick fallbacks
    6. uploadThumbnail() → DigitalOcean Spaces
    7. Report thumbnail_url back to agent-api
       ↓
Agent reports progress counters throughout (heartbeat + progress endpoint)
       ↓
Scan complete → final counters reported
```

### Key scan counters
`files_checked`, `candidates_found`, `ingested_new`, `moved_detected`, `updated_existing`, `errors`, `roots_invalid`, `roots_unreadable`, `dirs_skipped_permission`

---

## 11. Thumbnails & Rendering

**Thumbnails are stored on DigitalOcean Spaces** (S3-compatible), NOT Supabase Storage. The DB stores full public URLs like:
```
https://popdam.nyc3.digitaloceanspaces.com/thumbnails/{asset_id}.jpg
```

### Bridge Agent thumbnail strategies
For PSD: Sharp (primary) → ImageMagick → sibling image fallback
For AI: Sharp → Ghostscript → Inkscape → sibling image fallback
For PDF: Ghostscript (multi-page: page 1 + page 2 thumbnails)

### Windows Agent rendering
Handles files that fail on the Bridge Agent (especially complex `.ai` files). Uses:
- Sharp, Ghostscript, Inkscape as fallback chain
- Lease-based job claiming (5-minute lease, 5 retries max)
- `render_queue` table with `FOR UPDATE SKIP LOCKED` for safe concurrent claiming

### Primary sort tier
A database trigger (`compute_primary_sort_tier`) assigns each asset a tier 0–9 based on filename keywords and thumbnail availability. This determines which asset's thumbnail represents the style group:
- Tier 0: Tech pack with thumbnail (most informative for product teams)
- Tier 1: Mockup with thumbnail
- Tier 2: Art file with thumbnail
- Tier 9: Fallback

---

## 12. Style Groups & SKU Parsing

A **style group** represents one "product" — all the files (art, mockups, tech packs, packaging) that share the same SKU.

### How SKUs are extracted
The system walks the `relative_path` segments looking for a folder name matching `^[A-Za-z]{1,6}[0-9]` with length ≥ 10. The deepest matching segment is the SKU. Example:
```
Decor/Projects/Disney/Frozen/HXP8RNBHN02/Tech Pack/art.psd
                                ↑ SKU = HXP8RNBHN02
```

### Style group rebuild
A bulk operation (`rebuild-style-groups`) processes all assets in batches:
1. Extract SKU from each asset's path
2. Upsert into `style_groups` table (keyed on SKU)
3. Assign `style_group_id` on each asset
4. A follow-up reconciliation pass updates counts, primary assets, and metadata

### Style group metadata
Style groups inherit metadata from their assets: licensor, property, division, MG codes, designer names, cover description. If assets in a group have conflicting designer names, `designer_conflict = true`.

---

## 13. AI Tagging Pipeline

Uses **Google Gemini** (via the Cloud Worker or edge functions) to analyze asset thumbnails and generate:
- Tags (e.g., "frozen", "elsa", "snowflake", "blue", "winter")
- Character identification (matched to `characters` table)
- Asset type classification (art_piece, product, packaging, tech_pack, photography)
- Art source classification (freelancer, straight_style_guide, style_guide_composition)
- Theme detection (big_theme, little_theme)
- Cover description (one-sentence summary)
- Licensed/unlicensed determination

### Tag propagation
After tagging, a bulk operation copies AI tags from the primary tagged asset to all siblings in the same style group (excluding file-specific tags like "front view" or "packaging").

---

## 14. ERP Enrichment & Classification

### Data flow
1. **Sync**: Admin triggers ERP sync → `erp-sync` edge function fetches from DesignFlow API → stores raw + normalized data
2. **Enrichment**: `apply-erp-enrichment` matches ERP items to assets by style number (SKU prefix) → copies division, licensor, property, MG codes to assets and style groups
3. **AI Classification**: For items missing `mgCategory` (legacy products), Gemini classifies them into 7 product categories based on item description, style number, and context

### Confidence thresholds
- ≥ 65%: Auto-applied to the ERP item
- < 65%: Queued in `product_category_predictions` for human review
- Items can have "custom instructions" and few-shot examples to improve AI accuracy

### Date guard
`mgCategory` from ERP is only used for items created **after May 9, 2025**. Older items rely on AI classification or manual assignment.

---

## 15. Bulk Operations & the Worker

Long-running operations (AI tagging, style group rebuild, ERP enrichment, tag propagation) are managed through a **state machine** stored in `admin_config.BULK_OPERATIONS`:

```json
{
  "ai-tag-untagged": {
    "status": "running",
    "run_id": "abc123",
    "progress": { "tagged": 150, "failed": 2, "total_eligible": 5000 },
    "updated_at": "2025-01-15T10:30:00Z"
  }
}
```

### Cloud Worker (Railway)
A Node.js process that polls `BULK_OPERATIONS` every 5 seconds:
1. Find operations with `status: "running"` or `"queued"`
2. Dispatch to the appropriate handler
3. Process in batches (configurable size)
4. Update progress after each batch
5. Check for user interruption (admin clicked "Stop") every 10 batches
6. Lane isolation: operations in the same "lane" (e.g., both AI tagging variants) are mutually exclusive

### Why not edge functions?
Edge functions have a ~60s execution limit. Bulk operations can process 50,000+ assets and run for hours. The Railway worker has no time budget and can process until done.

---

## 16. Path System

Detailed spec in `docs/PATH_UTILS.md`. Key rules:

### Canonical form (`relative_path`)
- POSIX slashes (`/`)
- No leading or trailing slash
- No `..` traversal
- Example: `Decor/Projects/Disney/Frozen/HXP8RNBHN02/art.psd`

### Display modes (derived from config)
The `path-utils.ts` library converts `relative_path` into display formats based on `admin_config`:

| Mode | Example |
|------|---------|
| UNC by hostname | `\\NAS-NAME\share\Decor\Projects\...` |
| UNC by IP | `\\192.168.1.100\share\Decor\Projects\...` |
| Synology Drive (remote) | `C:\Users\Name\SynologyDrive\share\Decor\Projects\...` |

Users can switch between modes. Preference is stored in `localStorage`.

### Path filters
The `@popdam/path-filters` package (in `packages/path-filters/`) provides shared logic for skipping junk files and excluded directories. Used by both the Bridge Agent and agent-api to ensure consistency.

---

## 17. Deployment & CI/CD

**⚠️ Frontend and backend deploy independently. They can get out of sync.**

| What | How | When |
|------|-----|------|
| **Frontend** | Lovable "Publish" button | Manual — click in Lovable UI |
| **Edge Functions + Migrations** | GitHub Actions `deploy-supabase.yml` | Push to `main` or manual dispatch |
| **Bridge Agent** | GitHub Actions builds Docker → GHCR → SSH update on NAS | Push to `main` (if `apps/bridge-agent/` changed) |
| **Windows Agent** | GitHub Actions builds NSIS installer → GitHub Releases | Push to `main` (if `apps/windows-agent/` changed) |
| **Cloud Worker** | Railway auto-deploy | Push to `main` (if `apps/worker/` changed) |

### Bridge Agent versioning
When making changes to `apps/bridge-agent/`, bump the version in `apps/bridge-agent/package.json` in the same commit. The Docker image tag includes this version.

### Migration workflow
1. Write SQL
2. Apply via MCP tool (`mcp__Supabase__apply_migration`)
3. Check `list_migrations` to get the exact timestamp Supabase recorded
4. Create the local file in `supabase/migrations/` using **that exact timestamp**
5. If timestamps don't match, `supabase db push` will try to re-apply and fail

---

## 18. Development Workflow

### Frontend
```bash
npm run dev          # Start Vite dev server
npm run build        # Production build
npm run lint         # ESLint
```

### Edge functions
Edge function changes require deployment via GitHub Actions. You can test locally with `supabase functions serve` if you have the Supabase CLI set up, but most development happens by deploying and testing against the live environment.

### Agents
```bash
cd apps/bridge-agent && npm install && npm run build
cd apps/windows-agent && npm install && npm run build
cd apps/worker && npm install && npm run build
```

### Key environment variables

**Bridge Agent** (`.env`):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — API access
- `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_BUCKET`, `DO_SPACES_ENDPOINT` — thumbnail uploads
- `SCAN_ROOTS` — comma-separated NAS paths to scan
- `THUMB_CONCURRENCY` — parallel thumbnail generation (default: 2)

**Cloud Worker** (`apps/worker/.env`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — full DB access
- `GOOGLE_AI_API_KEY` — Gemini API for AI tagging
- `ANTHROPIC_API_KEY` — Optional, for ERP classification

**Edge Functions** (Supabase secrets):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `BREVO_API_KEY` — Transactional email for invitations
- `LOVABLE_API_KEY` — For AI model access via Lovable gateway

---

## 19. Related Documentation

| Document | Content |
|----------|---------|
| `docs/PROJECT_BIBLE.md` | **Highest authority** — non-negotiable rules. If anything conflicts, this wins. |
| `docs/SCHEMA.md` | Complete database schema with columns, constraints, indexes |
| `docs/API_CONTRACTS.md` | Agent and admin API request/response shapes |
| `docs/PATH_UTILS.md` | Path normalization, conversion, and display rules |
| `docs/ARCHITECTURE.md` | Detailed architecture with networking model |
| `docs/DEPLOYMENT.md` | How each component deploys |
| `docs/WORKER_LOGIC.md` | Bridge Agent contract — what it must/must not do |
| `docs/MODEL_RULES.md` | AI model selection and prompting guidelines |
| `docs/ERP_ENRICHMENT_PLAN.md` | ERP sync and classification design |
| `docs/KNOWN_QUIRKS.md` | Why things look wrong but aren't |
