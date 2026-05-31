# HYBRID SYSTEM ARCHITECTURE (Brain + Muscle)

This system is intentionally split so:
- the cloud never needs access to your NAS filesystem
- the browser never needs VPN routing to the NAS
- the NAS worker can run as a reliable "appliance"
- DevOps stays invisible for the human admin

---

## 1) Components

### A) Brain (Cloud)

Responsibilities:
- Web UI (browse/search/filter/tag) — React/Vite served via nginx in Docker on Coolify
- Authentication + roles (Authentik SSO for AD users; invitation-only for all other paths)
- Admin config + diagnostics
- API endpoints for agents and admins (`admin-api`, `agent-api`, `helper-api` Supabase edge functions)
- Scheduled maintenance (pg_cron: nightly SG crawl, nightly asset count reconcile, queue/history purge)

Runs on managed hosting (Supabase + Coolify on VPS). No SSH, no servers to maintain.

### B) Muscle (Bridge Agent on Synology NAS)

Responsibilities:
- Scan configured roots on disk
- Read timestamps from filesystem (mtime + birthtime when available)
- Compute quick hash for move detection
- Generate thumbnails (PSD via Sharp, AI via mupdf PDF-compat path)
- Detect `.ai` sentinel files (no PDF compat) and add to permanent ignore list
- Upload thumbnails to DigitalOcean Spaces
- Call agent API to ingest/update/move assets
- Send scan progress counters and logs
- Run PDF text sampling cascade (mupdf → Tesseract OCR → AI vision)
- Crawl PopSG style guide directories

Runs as a Docker container on Synology.

### C) Optional Muscle #2 (Windows Render Agent)

Only used when `.ai`/`.psd` thumbnails can't be reliably generated on the NAS, or when higher-quality renders are needed.
- Claims render jobs from `render_queue` or `style_guide_render_queue`
- Renders via Illustrator API (ExtendScript) for `.ai`, Sharp/Ghostscript/ImageMagick for others
- Uploads thumbnail to DigitalOcean Spaces (PopDAM) or Supabase Storage (PopSG)
- Reports completion via agent API

### D) POP DAM Helper (Desktop App)

Electron app for Windows and macOS. Enables the checkout/check-in workflow.

- Users click "Check Out & Open" in the web DAM. The web app calls `helper-api` to generate a short-lived `popdam://` token.
- The Helper validates the token, downloads the file from the NAS, and opens it in the native app.
- On check-in, the Helper uploads the modified file back to Synology and updates the cloud checkout record via `helper-api`.
- On the same machine, the `/files` directory browser probes `http://127.0.0.1:47380/status` on page load. If the Helper is running, directory listings go directly to it via `GET /browse?path=...` — no cloud roundtrip.

**Local HTTP server (port 47380):**
- `GET /status` — `{ ok, version, roots[] }`
- `GET /browse?path=X` — directory listing

### E) Railway Worker (Bulk Operation Runner)

Persistent Node.js process on Railway. Handles all batch operations too long-lived for edge functions.

Responsibilities:
- AI image tagging (`ai-tag-untagged`, `ai-tag-all`, `ai-tag-groups`)
- Style group rebuild, reconcile, cleanup-mega-group-tags, relink-orphaned-assets
- Tag propagation (`propagate-group-tags`)
- ERP enrichment and ERP AI classification (`erp-enrichment`, `erp-classify`)
- Metadata reprocessing, SKU backfill

How it works: polls `admin_config.BULK_OPERATIONS` every 5 seconds. When it finds an operation with `status: "running"`, it claims a batch, processes it, writes progress back, and loops.

---

## 2) Dual-Mode (PopDAM / PopSG)

**One Docker image, one Coolify app, one Supabase project.** Both `dam.designflow.app` and `sg.designflow.app` run from the same container.

```
window.location.host
  → "dam.designflow.app" → APP_MODE = "popdam", IS_POPDAG = true
  → "sg.designflow.app"  → APP_MODE = "popsg",  IS_POPSG = true
  → localhost with ?mode=popsg → IS_POPSG = true (sessionStorage override)
```

Mode detection is in `src/lib/app-mode.ts`. The same Supabase URL and anon key are used for both modes — mode controls routing and UI only, not which Supabase project to hit.

**PopDAM uses:** `assets`, `style_groups`, `erp_items_current`, `erp_items_raw`, `product_category_predictions`, render queues, the full filter sidebar.

**PopSG uses:** `style_guide_files`, `style_guide_crawl_runs`, `style_guide_render_queue`, the folder-tree UI. No SKUs, no ERP, no filter sidebar.

Route guards in `src/App.tsx` use `IS_POPSG` to render `PopSGLibraryPage` / `PopSGSettingsPage` instead of the PopDAM equivalents.

---

## 3) Communication Model (No Inbound NAS Networking)

Hard rule: The cloud backend does NOT "reach into" the NAS by IP.

**Outbound Only:** The Bridge Agent polls outward to the cloud. The Cloud never initiates a connection to the NAS.

Instead:
- The cloud sets work flags / queues work (DB)
- The Bridge Agent polls outward (HTTPS) to claim work
- The Bridge Agent reports progress outward (HTTPS)

Tailscale may be used for user remote access to NAS files (Synology Drive) and human admin, but it is NOT required for the core worker-to-cloud workflow.

---

## 4) API Boundaries

Three separate API surfaces:

### agent-api (verify_jwt = false)
- Auth: `x-agent-key` header (SHA-256 hashed and compared against `agent_registrations.agent_key_hash`)
- Routes for: ingest/update/move, progress, heartbeat, claim jobs, complete jobs, style guide crawl
- Strict request/response validation (Zod)

### admin-api (verify_jwt = false — JWT verified inside function)
- Auth: user JWT + admin role check inside function, **or** the Supabase service role key as Bearer token
- Routes for: config, invites, diagnostics, key generation, per-batch operations called by the Railway worker
- Service role key auth maps to `userId: "system"` — used by the Railway worker for server-to-server calls

### helper-api (verify_jwt = true — standard user JWT)
- Auth: user JWT (Bearer token) — the Helper authenticates as the logged-in user
- Routes for: device registration, token generation, checkout/checkin lifecycle, heartbeat, logs

Hard rule: never mix admin + agent routes in one function.

### Railway worker (server process, no HTTP listener)
- Auth: uses `SUPABASE_SERVICE_ROLE_KEY` env var to create a service role Supabase client directly
- For operations it cannot execute via DB RPC, it calls `admin-api` with the service role key as Bearer token
- Bypasses RLS entirely (service role)

---

## 5) Security Rules

- No endpoint accepts arbitrary shell commands or raw command strings.
- Agent keys: store only hashes; raw key shown once on creation; raw key never returned again.
- All edge functions use `corsServe()` from `supabase/functions/_shared/http.ts` — validates request `Origin` against allowlist (`*.designflow.app`, `*.lovable.app`, localhost).
- The `run-query` action in admin-api restricts queries to `SELECT` only.

---

## 6) Data Flow: Asset Ingestion

```
NAS disk (PSD/AI/PDF)
  → Bridge Agent scanner.ts (stat, hash, shouldSkipPath)
  → Bridge Agent thumbnailer.ts (Sharp/mupdf)
  → Bridge Agent uploader.ts (DigitalOcean Spaces)
  → agent-api /ingest → assets table (upsert by quick_hash or relative_path)
  → DB triggers:
      trg_compute_primary_sort_tier (sets primary_sort_tier)
      trg_sync_primary_on_thumbnail (updates style_group.primary_asset_id)
      trg_refresh_sg_counts_on_asset_change (updates style_group.asset_count)
```

If thumbnail generation fails:
```
  → assets.thumbnail_error set
  → trg_auto_queue_render inserts render_queue row
  → Windows Render Agent claims render_queue job
  → Windows Agent renders → uploads → calls complete-render
  → assets.thumbnail_url set
```

---

## 7) Data Flow: Style Group Rebuild

All triggered from admin UI → Railway worker:

```
Stage 1: clear_assets    → assets.style_group_id = NULL (in batches)
Stage 2: delete_groups   → style_groups rows deleted (in batches)
Stage 3: rebuild_assets  → rebuild_style_groups_batch() RPC (extracts SKU, upserts groups, sets style_group_id)
Stage 4: finalize_stats  → reconcile_style_group_stats_batch() in batches:
    - sub-stage "counts":    asset_count, latest_file_date per group
    - sub-stage "primaries": primary_asset_id per group (by primary_sort_tier)
```

Nightly reconcile (03:45 UTC daily, pg_cron):
```
refresh_style_group_counts_batch(array_agg(id))  ← all style_groups
```
This catches any drift that the INSERT/UPDATE/DELETE trigger missed.

---

## 8) Deployment (Non-Negotiable)

The bridge agent is published as a pre-built Docker image to GHCR (`ghcr.io/u2giants/popdam-bridge`). NAS install requires only a `.env` file and a three-line `docker-compose.yml`.

**Heartbeat Rule:** The cloud API tracks `last_heartbeat` from each agent. If it is older than 2 minutes, the admin UI displays a "Check Connection" warning.

**Image Appliance Mode:** The Bridge Agent is a read-only appliance by default. It should never have write permissions to source art folders unless explicitly configured for metadata embedding.

---

## 9) Golden Rule: File Date Preservation

The Bridge Agent must NEVER modify file timestamps (mtime/birthtime) on source art files. Before any file read, record original timestamps; after, verify and restore if changed. If restoration fails, halt processing and report a critical error. See `docs/PROJECT_BIBLE.md` §15.
