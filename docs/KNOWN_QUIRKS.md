---
summary: Numbered deep-dive encyclopedia of intentional quirks; fixed-entry history lives in docs/archive/quirks-fixed-history.md.
kind: living
status: current
read-when: investigating a quirk in depth or adding a new one
---

# Known Quirks — Why Things Look Wrong But Aren't

## Structured model compatibility is runtime data

**Looks like:** a new model needs another hard-coded exception.

**Actually:** the worker builds a capability profile from OpenRouter metadata and
`AI_MODEL_CAPABILITY_OVERRIDES`, then exhausts only compatible output methods.

**Why:** providers vary across strict schema, JSON object, and tool-choice modes.

**Do not change because:** model-name exceptions become stale and can silently
skip ERP items or falsely fail a usable vision model.

This document explains intentional code decisions that may appear like bugs or bad practices to an outside developer. Each entry explains **what it looks like**, **why it exists**, and **what would break if you "fixed" it**.

---

## Search needs the newer "dam" access row, not just the legacy "popdam" entry

Signing in and browsing are gated by the legacy `public.app_access` row
(`app='popdam'`). Search (`search_assets_full_text` -> `require_dam_access()`)
instead requires `app.has_app_access('dam')`: an `app.app_access` row with
`app='dam'`, or the administrator role. A user missing that row can browse but
every search returns 403 "DAM access is required" and the UI shows "No assets
found". On 2026-10-07 all 25 employees were granted the row by hand
(u2giants/popdam3#185, `docs/access-records/`). New employees do not get it
automatically yet. Check the 403 in the API logs before debugging search code.
When you test with `execute_sql`, run any write in its own call: a later
`begin ... rollback` in the same call undoes it.

## 1. Hardcoded Supabase URL and Anon Key

**File**: `src/lib/external-supabase.ts`

**What it looks like**: Security anti-pattern — credentials hardcoded in source code.

**Why**: PopDAM is built on Lovable, which auto-provisions its own Supabase project and auto-generates `.env` with that project's credentials. But our production database is on a *different* Supabase project. The `.env` file gets overwritten by Lovable on every deploy, so we can't rely on it. The anon key is a **publishable** key (equivalent to a Firebase web API key) — it's designed to be in client-side code. The service role key is never hardcoded.

**What breaks if you "fix" it**: All data queries, auth, and edge function calls would go to the wrong (empty) Lovable-managed project.

---

## 2. `client.ts` Re-Export Trick

**File**: `src/integrations/supabase/client.ts`

**What it looks like**: A file that should create a Supabase client instead just re-exports from somewhere else.

**Why**: Lovable auto-generates this file and overwrites it. By making it a one-line re-export of our external client, we ensure that every file importing from the "standard" path (`@/integrations/supabase/client`) gets the correct production client. When Lovable overwrites it, we restore the re-export.

**What breaks if you "fix" it**: Same as #1 — queries go to the wrong project.

---

## 3. `useAuth.tsx` Imports Directly from `external-supabase.ts`

**File**: `src/hooks/useAuth.tsx`

**What it looks like**: Inconsistent — other files import from `@/integrations/supabase/client`, but auth imports directly.

**Why**: The auth provider is the most critical piece. If the `client.ts` re-export is temporarily broken (Lovable overwrote it), auth would silently connect to the wrong project. By importing directly, auth always works even during the window between a Lovable overwrite and our fix.

---

## 4. `verify_jwt = false` on `admin-api`

**File**: `supabase/config.toml`

**What it looks like**: Security hole — admin API doesn't verify JWTs at the gateway level.

**Why**: CORS preflight (`OPTIONS`) requests don't carry authorization headers. If `verify_jwt = true`, Supabase's gateway rejects the preflight, and no browser can call the function at all. Instead, JWT verification happens **inside** the function (`authenticateAdmin()`), which skips the check for OPTIONS requests and validates the JWT manually for all other methods.

---

## 5. `admin-api` Is a 1,268-Line "Monolith"

**File**: `supabase/functions/admin-api/index.ts`

**What it looks like**: God function that should be split into separate edge functions.

**Why**: All admin actions share the same auth flow (JWT validation → admin role check → CORS headers → error handling). Creating 50+ separate edge functions would duplicate this boilerplate in each one, increase cold-start costs, and make deployment more complex. The actual business logic is extracted into `_shared/admin-handlers/` — the main file is essentially just a router.

---

## 6. `agent-api` Is Even Larger (~4,100 Lines)

**File**: `supabase/functions/agent-api/index.ts`

**Why**: Same rationale as admin-api but even more so — agent auth (SHA-256 key hashing + lookup) is non-trivial and must be consistent. The ingest, scan, render, hygiene, style-guide, PDF backfill, and check-in verification routes share substantial metadata derivation/config lookup logic that benefits from in-memory caches.

---

## 7. `useState(getPreferredPathMode)` Without Parentheses

**Pattern in**: `src/components/library/AssetDetailPanel.tsx` and others

**What it looks like**: Bug — calling `useState` with a function reference instead of a value.

**Why**: This is React's [lazy initializer pattern](https://react.dev/reference/react/useState#avoiding-recreating-the-initial-state). When you pass a function to `useState`, React calls it once on the first render to get the initial value. Adding `()` would also work but would call the function on every render.

---

## 8. Service Role Key as Bearer Token

**In**: `admin-api/index.ts` → `authenticateUser()`

**What it looks like**: Backdoor — accepting a raw key as an auth token.

**Why**: The Railway Cloud Worker needs to call admin-api for operations like ERP enrichment. It doesn't have a user JWT (it's a server process, not a browser). Instead of building a separate service-to-service auth system, admin-api accepts the Supabase service role key as a Bearer token, mapping it to a synthetic `userId: "system"`. This is safe because: (a) the service role key is already a root-level secret with full DB access, and (b) it's only used by our own worker process.

---

## 9. `@popdam/path-filters` Workspace Package

**Directory**: `packages/path-filters/`

**What it looks like**: A missing npm package that should be installed.

**Why**: This is a local monorepo package shared between the Bridge Agent, Windows Agent, and agent-api edge functions. It provides `shouldSkipPath()` — the canonical logic for filtering junk files (`.DS_Store`, `Thumbs.db`, `._*`) and excluded subdirectories.

---

## 10. Duplicate `JUNK_FILENAMES` Arrays

**In**: `supabase/functions/agent-api/index.ts`, `apps/bridge-agent/`, and `packages/path-filters/`

**What it looks like**: Copy-paste code that should be deduplicated.

**Why**: Known tech debt. Edge functions (Deno) can't import from Node.js packages, and the path-filters package is Node.js. The agent-api has its own copy because it needs to filter during ingest validation.

---

## 11. `Record<string, unknown>` Instead of Proper Types

**In**: `useAdminApi.ts`, admin-api handler parameters

**What it looks like**: Lazy typing that defeats TypeScript's purpose.

**Why**: Admin-api uses action-based routing where each action has different payload shapes. The `useAdminApi` hook is a generic caller. Zod validation on the edge function side provides runtime type safety.

---

## 12. Polling Instead of Realtime for Bulk Operations

**In**: `src/hooks/usePersistentOperation.ts`

**What it looks like**: Should use Supabase Realtime instead of polling.

**Why**: `admin_config` is a key-value table where `BULK_OPERATIONS` is a single JSONB blob containing state for all operations. Realtime on this table would fire on every update to *any* config key. The polling approach (3s when active, 30s idle) is simpler.

---

## 13. `config.toml` Has `project_id` That Doesn't Match

**File**: `supabase/config.toml`

**What it looks like**: Config pointing to wrong project.

**Why**: The `project_id` in config.toml matches the **external** production project (`qsllyeztdwjgirsysgai`), not the Lovable-managed one. This is correct — the GitHub Actions deploy workflow uses this to target the right project.

---

## 14. No Landing Page at the Root URL

**File**: `src/App.tsx`

**What it looks like**: The root route (`/`) should show a landing page but instead shows the login page.

**Why**: The app is internal-only (invitation-based) — there's no marketing need for a public landing page. The `LandingPage` component is kept for potential future use.

---

## 15. Magic Numbers Throughout Agent Code

**In**: `apps/bridge-agent/`, `apps/windows-agent/`

**Why**: Known tech debt. These are documented in `docs/WORKER_LOGIC.md` but not extracted to named constants in code.

---

## 17. Both `ImpersonationContext.tsx` and `useImpersonation.tsx` Exist

**Files**: `src/contexts/ImpersonationContext.tsx`, `src/hooks/useImpersonation.tsx`

**Why**: Standard context/hook pair — the context provides the `ImpersonationProvider` wrapper, and the hook provides `useImpersonation()` for consuming components. The hook imports from the context.

---

## 18. `OPENROUTER_API_KEY` Lives in Two Places and They Don't Sync

**What it looks like**: You set the OpenRouter API key in the admin UI but AI tagging still fails.

**Why**: Two completely separate consumers read the key from different sources:

| Consumer | Where it reads the key | Set via |
|---|---|---|
| Bridge/Windows agents | `admin_config.OPENROUTER_API_KEY` | Admin UI → Settings → AI Models |
| Railway worker (`apps/worker/`) | `process.env.OPENROUTER_API_KEY` | Railway dashboard → Variables |

The admin UI only updates `admin_config`. The Railway worker reads from Railway ENV variables — setting the key in the UI does **not** make it available to the worker.

**Fix**: Set `OPENROUTER_API_KEY` in both places.

---

## 19. `bulk-job-runner` Edge Function Is a No-Op Stub

**What it looks like**: The `supabase/functions/bulk-job-runner/index.ts` file exists and is deployed, but it does nothing.

**Why**: Bulk batch processing was originally done by this edge function. It was replaced by the persistent Railway worker because the 60-second edge function timeout was too short. The stub is kept deployed so stale references return a clean 200 rather than 404.

**What breaks if you add real logic here**: The Railway worker and the edge function would conflict — both would try to process the same `BULK_OPERATIONS` state simultaneously.

---

## 20. `HEALTHCHECK NONE` on the Bridge Agent Docker Image

**File**: `apps/bridge-agent/Dockerfile`

**What it looks like**: Missing health check.

**Why**: Synology Container Manager polls the Docker daemon for container health status. Each poll creates a DSM CGI session owned by the container's user account that accumulates and is never explicitly closed, producing log floods (observed 9,997 times in 3.5 days). `HEALTHCHECK NONE` eliminates the session accumulation. The health check command (`node -e "process.exit(0)"`) always exits 0 and communicates nothing meaningful anyway.

---

## 21. Traefik Runs Inside `coolify-proxy` Docker Container

**What it looks like**: Writing a config file to `/traefik/dynamic/` on the VPS host should configure Traefik routing.

**Why it doesn't work**: Coolify installs Traefik inside a Docker container. Traefik reads its dynamic config from `/traefik/dynamic/` **inside the container**, not from the host filesystem.

**Correct mechanism**: Use `docker cp` to write config files into the running container.

---

## 22. Style Group Batch Functions Need `SET lock_timeout TO '0'`

**What it looks like**: Unnecessary SQL configuration.

**Why**: Supabase sets a default `lock_timeout` at the role/database level. When batch functions run `UPDATE` statements on `assets` and `style_groups`, they queue for row-level locks and hit this limit. Setting `lock_timeout = '0'` inside each function disables the lock wait limit for the duration of that call only. The `statement_timeout` is still respected.

---

## 23. PopSG Has a Render Pipeline, But Many Files Still Lack Previews

**What it looks like**: Many files in the PopSG library show a broken/placeholder image.

**Why**: Large batches of files fail for various reasons (unsupported extension, Windows MAX_PATH, CMYK/Lab color mode, missing files, Inkscape limitations). See KNOWN_QUIRKS.md #34 for the MAX_PATH detail.

---

## 25. Bridge Agent Imports `ws` and Polyfills `globalThis.WebSocket`

**File**: `apps/bridge-agent/src/realtime-watcher.ts`

**What it looks like**: A clumsy hack — `(globalThis as Record<string, unknown>).WebSocket = ws`.

**Why**: `@supabase/realtime-js` >= 2.11 throws a fatal error ("Node.js 20 detected without native WebSocket support") if `globalThis.WebSocket` is undefined. Node.js 20 has no native WebSocket implementation. Setting the polyfill at module initialization time satisfies the check for all subsequent code.

**What breaks if you remove it**: The bridge agent crash-loops every ~60 seconds on startup.

---

## 26. Bridge Agent Self-Update Must Remain Compose-Owned and Fail Closed

**Files**: `apps/bridge-agent/src/index.ts`

**Why**: A 2026-09-03 update incident proved that synthesizing a replacement with `docker run` is unsafe. A bad image first crash-looped; the fallback then detached the replacement from Compose, inherited host-specific configuration, and created repeated name conflicts. The recovery was prolonged further by a stale saved environment and an unsupported Synology CPU limit in the reference Compose file.

**Required contract**: self-update only runs through an existing Compose file. Missing Compose state or a Compose failure is reported and leaves the running container recoverable; it never falls back to `docker run`, renames containers, strips read-only flags, or prunes backups. The manual updater validates Compose first, never runs `compose down`, verifies stability for 45 seconds, and restores the prior image if verification fails.

**Compose must not run inside the bridge (fixed 1.16.16, 2026-10-01)**: run from inside the container, Compose sees `/app/compose` and derives project name `compose` instead of the host project `popdam`, so it tries to create a second `popdam-bridge` ("container name already in use"); it would also be killed when it stops its own container. The agent now launches a detached one-shot helper (`popdam-bridge-updater-<ts>`, from the pulled `:stable` image) that runs `docker compose -p <project>` against the host project dir mounted at the same path. If the running container is not Compose-owned, the helper renames it to `popdam-bridge-preupdate`, stops it, runs Compose, and restores it on failure. Live-proven on edgesynology1 via an in-app update.

**Build/runtime validation**: build identity remains baked into immutable `/app/build-info.json`. The Docker build must also import the compiled eligibility module from the clean runtime stage, so a missing JSON artifact cannot publish. Do not replace this with a host build or a test against a dirty local `dist/` directory.

---

## 27. Bulk DELETE on Large Tables Must Use Service Role

**Pattern in**: `handleClearFailedSGRenders`, `handleClearFailedRenders`

**Why**: When an admin client runs a DELETE with an RLS policy, PostgreSQL evaluates the policy predicate for **every row** in the result set. On a table with 30,000+ failed rows this blows Supabase's default 8-second statement timeout. Route bulk deletes through an `admin-api` action that uses `serviceClient()` (service role bypasses RLS entirely).

---

## 28. `popdam-helper` Has a No-Op `postcss.config.js`

**File**: `apps/popdam-helper/postcss.config.js`

**Why**: Without this file, Vite finds the monorepo root's `postcss.config.js`, which loads Tailwind and errors on missing content paths. The stub shadows the parent config.

---

## 29. `safeStorage` Instead of `keytar` for Credential Storage

**File**: `apps/popdam-helper/src/main/credentials.ts`

**Why**: `keytar` is a native module requiring compilation. `safeStorage` is built into Electron (DPAPI on Windows, Keychain on macOS) and requires no compilation.

---

## 30. JSON File Upload Queue Instead of SQLite

**File**: `apps/popdam-helper/src/main/uploadQueue.ts`

**Why**: `better-sqlite3` is a native module requiring compilation. A JSON file is entirely sufficient for the sequential, short-lived upload queue use case.

---

## 31. Local Helper Detection Uses `AbortSignal.timeout(2000)`

**File**: `src/components/settings/DirectoryBrowserTab.tsx`

**Why**: Without the explicit 2-second abort, the `fetch()` call hangs for ~30 seconds (browser's default TCP connection timeout to a closed port) before failing. `helperAvailable` starts as `null` (not `false`) to prevent the auto-load `useEffect` from firing before the probe completes.

---

## 32. `popdam-helper` Local Server Port 47380 Is Fixed, Not Random

**File**: `apps/popdam-helper/src/main/localServer.ts`

**Why**: The web app needs a fixed port to probe at startup. A random port would require an OS-level mechanism to advertise it that a web page can't read. `EADDRINUSE` is handled gracefully — the Helper logs a warning and continues without the local server rather than crashing.

---

## 33. Supabase Proxy Enforces Statement Timeout — `SET LOCAL` Is Invisible to It

**What it looks like**: You add `SET LOCAL statement_timeout = 0;` inside a PL/pgSQL function to bypass Supabase's statement timeout. The query still times out.

**Why**: Supabase routes all client connections through a connection proxy (Supavisor/PgBouncer). The proxy enforces its own statement timeout on the wire — it cuts the connection from the outside if the query runs too long. `SET LOCAL` changes the PostgreSQL session parameter for that transaction only, but the proxy never sees that change.

**Fix**: Batch bulk operations at the client layer with `p_limit` parameters and loop until done.

---

## 34. Windows MAX_PATH (260-char) Limit in the Windows Render Agent

**What it looks like**: The Windows Render Agent logs `render_failed: …ENOENT…` for files the bridge agent found just fine.

**Why**: The bridge agent runs on Linux (no path length limit). The Windows agent maps the same NAS share as a drive letter. Windows Win32 APIs have a MAX_PATH limit of 260 characters. The `withLongPathPrefix(p)` helper in `apps/windows-agent/src/renderer.ts` prepends `\\?\` to any path longer than 230 chars to bypass this limit.

---

## 35. "Retry All" Count and Loop — Two Separate Concerns

**Why**: The display table fetches with `.limit(500)` for performance. The button label reads from `previewStats.render_errored` (actual total). `retry_sg_render_errors()` accepts `p_limit int DEFAULT 500` per call; the client loops until it returns 0.

---

## 36. `renderNativeImage` Uses Temp-Copy for Long Paths, Not `\\?\` Prefix

**File**: `apps/windows-agent/src/renderer.ts`

**Why**: Sharp/libvips does **not** reliably support the `\\?\` extended-length path prefix on Windows. Even though `\\?\` works for Win32 `fs` calls, Sharp's underlying C++ (libvips) uses its own file I/O which does not honour the prefix. The temp-copy pattern copies the source to a short temp path, renders from there, and then cleans up.

---

## 37. AI Model Pickers Fetch Guardrailed OpenRouter Models Live

**Files**: `src/components/settings/ApisTab.tsx`, `src/components/settings/AiTagBakeoffTab.tsx`, `src/components/settings/PdfTextSamplesTab.tsx`, `supabase/functions/admin-api/index.ts`

**What it looks like**: The dropdowns should just list every OpenRouter model that supports the task.

**Why**: They must use the OpenRouter key-scoped `/api/v1/models/user` response, not the public `/api/v1/models` catalog. The user endpoint reflects the account's model guardrails/policy. The public catalog can include providers and aliases that are not allowed for this PopDAM key.

**Extra filter rules**: Image Tagging and Vision Bake-Off are stricter than "vision capable" but share the same contract. Options must support image input plus tool calling, OpenRouter `response_format` JSON-schema structured outputs, or JSON mode (`response_format: { "type": "json_object" }`). The worker tries the structured `tag_asset` tool path first, falls back to the same schema through `response_format`, then falls back to JSON mode with explicit schema instructions and one JSON repair retry. Production Image Tagging additionally retries the same model once when the whole ladder fails with intermittent OpenRouter routing/structured-output symptoms (`No endpoints found`, OpenRouter 404, tool-use support errors, malformed tool JSON, no parsable JSON); that retry is intentionally not used for content-inspection failures, missing thumbnails, or DB writes. All paths must parse as JSON and include the required `tags`, `ai_description`, and `scene_description` fields before the worker stores a result. OpenRouter can also return unavailable placeholder aliases with negative pricing (for example `-1000000` per token); those are filtered out everywhere and their prices are not displayed.

**What breaks if you "fix" it**: Switching back to the public catalog, or listing vision models without checking image input plus structured-output support/availability, lets users queue production tagging or bake-off runs against models that OpenRouter will reject or that return prose the worker cannot safely apply.

---

## 38. Nightly Crawl Cron Is Scheduled in UTC, Not ET

**DB object**: `pg_cron` job `nightly-sg-crawl` (`20260507154819_schedule_nightly_sg_crawl.sql`)

**Why**: The `cron.timezone` GUC on this Supabase version cannot be changed without a server restart (not possible on managed Supabase). `02:00 UTC = 9pm EST`. In EDT (summer), `02:00 UTC = 10pm EDT` — a 1-hour drift. Acceptable for a nightly maintenance job.

---

## 39. `ensureRootMarkers` Refuses to Write to Synology Internal Directories

**File**: `apps/bridge-agent/src/index.ts`

**Why**: If an `agent_root_mappings` record has a `server_path` that resolves to a Synology internal data store (`@synologydrive`, `@SynologyDriveShareSync`, `@appdata`, `@docker`), writing a marker file and traversing the directory would be catastrophic — these contain millions of opaque internal files. A recursive scan here ran for 4+ days on production. The guard is a hard stop, not a warning.

---

## 40. `bulk_insert_pdf_text_samples` Bypasses Per-Row Trigger via Session Variable

**Why**: The per-row trigger calls `parse_pdf_files_used(NEW.asset_id)` — a PL/pgSQL function that queries `assets` and scans `pdf_text_samples`. With 25 rows being inserted sequentially, the total time exceeded the Supabase 120s statement timeout. The RPC sets `SET LOCAL app.skip_parse_pdf_trigger = '1'`, inserts all rows in one statement, then calls `parse_pdf_files_used()` once per unique `asset_id` after all rows are visible.

---

## 41. Coolify Container Name Changes on Every Deploy; Traefik Service Name Does Not

**Why**: Coolify appends a timestamp to the container name on each deploy. However, the Traefik **service** name is derived from the Coolify app UUID (`qxj8a0j3tpa9lq4q5rs6pezy`) and is stable across redeploys: `https-0-qxj8a0j3tpa9lq4q5rs6pezy@docker`. The `sg.designflow.app` file provider references this stable service name. The `@docker` provider suffix is required.

---

## 42. nginx Must Listen on `[::]:80` for Coolify Health Check to Pass

**File**: `nginx.conf`

**Why**: Coolify's default container health check runs `wget -q --spider http://localhost/ || exit 1` inside the container. On a host with IPv6 enabled, `localhost` resolves to `::1` (IPv6 loopback). nginx's `listen 80;` directive only binds to `0.0.0.0:80` (IPv4). The connection attempt is refused, health check fails, and Traefik excludes the container from routing.

**What breaks if you remove `listen [::]:80;`**: The container becomes unhealthy immediately after startup and `dam.designflow.app` becomes unreachable within seconds of a deploy.

---

## 43. Style Group `finalize_stats` Calls `reconcile_style_group_stats_batch` in a Loop

**Why**: `run_full_reconcile_style_group_stats` has no `SET statement_timeout` or `SET lock_timeout`, so it inherits the DB-level role timeout. After a full "Start Fresh" rebuild, the function's Phase 1 UPDATE+JOIN across all groups gets killed by the timeout before it finishes. The batched approach (100/25 groups per call) each have `SET statement_timeout = '120s'` and complete reliably at any scale.

---

## 44. `style_groups.asset_count` Is a Cached Field, Not Computed on Read

**Why**: Computing `COUNT(*) FROM assets WHERE style_group_id = ...` on every library page load would be prohibitively slow at scale. `asset_count` is maintained by:
1. A statement-level trigger `trg_refresh_sg_counts_on_asset_change` (migration `20260515080654`) — fires on INSERT/DELETE of assets and on UPDATE when `is_deleted` or `style_group_id` changes.
2. A pg_cron job `nightly-reconcile-sg-asset-counts` (migration `20260531142011`) at 03:45 UTC daily — calls `refresh_style_group_counts_batch(array_agg(id))` over all style groups to catch any drift the trigger missed.

**Background:** Before the nightly cron was added (2026-05-31), 17 style groups had stale counts from pre-2026-05-15 operations. Two showed `asset_count=1` but had zero actual assets. These were bulk-corrected and the nightly job added to prevent future drift.

**Do not compute live in queries:** Use `reconcile-style-group-stats` op or wait for the nightly cron to fix drift.

---

## 45. `trg_sync_primary_on_thumbnail` Fires on INSERT **and** UPDATE

**Why**: The bridge agent sets `thumbnail_url` at insert time (single DB write). If the trigger only fired on UPDATE (which it did before migration `20260529132758`), those assets never triggered the sync, leaving `primary_asset_id = null` and no cover image in the library grid even when assets had thumbnails. A backfill in that migration fixed 482 affected groups.

**Do not revert to UPDATE-only**: It would silently break cover assignment for any asset inserted with a thumbnail already set.

---

## 46. PopSG Stale Cleanup Is Guarded for Zero-File Crawls, But Not Low Counts

**Why**: At crawl completion, `reconcile_stale_sg_files_batch(root_label, run_id, batch_size, min_ratio)` (the bounded, ratio-guarded replacement for the dropped `deactivate_stale_sg_files` wrapper, shared-db #2934) flips `is_active = false` for file under that root whose `crawl_run_id != current run`. That is correct for normal deletes/renames, but a bad crawl can hide real files because the resolver and UI filter `is_active`. On 2026-06-10, an empty/inaccessible crawl was suspected while investigating PopSG's "No style guides yet" state.

**Current guard**: `supabase/functions/agent-api/index.ts` now treats a final `files_found = 0` style-guide crawl as failed and skips stale cleanup. It also excludes `inaccessible_roots` from stale cleanup. This prevents a fully empty/unmounted root from mass-deactivating the active library.

**Remaining watchout**: there is still no percentage/drop floor for suspiciously low but nonzero crawls. Do not assume a large inactive count means true deletions; compare `style_guide_crawl_runs.files_found` and active counts against the prior successful crawl before trusting stale cleanup.

---

## 47. Style Guide Sources (`sku_files_used`) Only Come From Licensing/Tech-Pack PDFs

**Why**: Looks like a bug that a SKU's `.ai` art files and most PDFs never populate "Style Guide Sources." Intentional (migration `20260610070731`, 2026-06-10): only a PDF whose filename contains `licensing sheet` / `license sheet` / `tech pack` / `techpack` may write `sku_files_used` rows, via `is_style_guide_source_pdf(file_type, filename)`. It gates all three write paths (`parse_pdf_files_used` trigger/RPC, the `agent-api/complete-pdf-backfill-batch` JS parser, and the `ai-tag` vision upsert) and the backfill claim scope. `.ai` files hold the same data but are far harder to extract. Pre-gating rows are stamped `source = 'legacy_ungated'`. Full detail + the fuzzy/continuous resolver: `docs/POPSG.md` → "Style Guide Sources".

**Do not "fix" this by re-broadening the parser to all files** — it would repopulate the garbage that was just cleaned out.

---

## 53. PopSG Guides/Folders Are Materialized Views — Refresh-Driven, and Matviews Bypass RLS (2026-06-19)

**What changed**: `style_guide_file_groups` and `style_guide_folders` were plain views that re-aggregated all ~214k active `style_guide_files` rows on **every** PopSG page load (guides grid + folder tree; ~250–425ms warm, ~2–3s cold, fired concurrently). They are now **materialized views** (migration `popsg_aggregation_matviews`). Guides query ~425ms → ~28ms. Also added partial index `idx_style_guide_files_active_modified` for the files-mode list (~489ms → ~35ms).

**How they stay fresh**: `refresh_style_guide_matviews()` (SECURITY DEFINER) is called (a) by `agent-api` at the end of each crawl (`complete-style-guide-crawl`, after stale cleanup finalizes `is_active`) and (b) by a pg_cron job **every 15 min** (`refresh-style-guide-matviews`). The cron exists because `style_guide_files.thumbnail_url` changes *between* crawls as the render queue fills in thumbnails — without it, a group's representative `sample_thumbnail_url` would lag until the next nightly crawl. The groups matview refreshes `CONCURRENTLY` (no read lock; needs the unique index `sgfg_group_key_uidx`); the 361-row folders matview uses a plain refresh.

**The trap that bit this change — matviews bypass RLS + Supabase default privileges grant `anon`.** The old views used `security_invoker`, so `style_guide_files` RLS (no `anon` policy) blocked `anon`. **Materialized views do NOT honor RLS** — and Supabase's `ALTER DEFAULT PRIVILEGES` auto-granted `anon` SELECT on the new matviews, exposing the licensed-art catalog (licensor/property/style-guide names) to the **public anon key**. Caught and fixed by migration `restrict_style_guide_matviews_to_authenticated` (`REVOKE ALL ... FROM anon, PUBLIC`).

**Future sessions should**:
- After creating ANY matview/table that should not be public, **explicitly `REVOKE ... FROM anon, PUBLIC`** and verify with `has_table_privilege('anon', '<rel>', 'SELECT')` — default privileges silently grant `anon`. Never rely on RLS to protect a materialized view; it does not apply.
- Remember the PopSG matviews are **eventually consistent** (≤15 min + per-crawl), not live. If you add a code path that mutates `style_guide_files` outside a crawl and needs to show immediately, call `refresh_style_guide_matviews()` or query the base table.
- A new column on the matview must be added to the view definition AND any matview index that needs it; bump via a new migration (matviews can't be `CREATE OR REPLACE`d — drop+recreate).

---

## 58. Some Vision Models Skip the Tool-Call Leg in AI Tagging (2026-07-13)

**File**: `apps/worker/src/handlers/ai-tagging-shared.ts`
(`modelSupportsTools`, `callTagAssetModel`)

**What it looks like**: `callTagAssetModel` attempts three output strategies in
order — tool call, `json_schema`, then `json_object` — but for Gemma and Llama 4
Scout models the tool-call leg is skipped entirely and it goes straight to JSON.
Looks like an inconsistent special case.

**Why**: Gemma models on OpenRouter (e.g. `google/gemma-4-31b-it`) do not
support OpenAI-style function/tool calling. Running the tool leg for them always
fails over, but only after burning a full request that has its own 60s timeout
budget. Llama 4 Scout is image-capable, but some OpenRouter-routed endpoints
reject the image + function-calling combination even when the model can succeed
with structured JSON output. Because the legs run sequentially, a known-brittle
tool leg materially increases
the chance the whole call trips `AI_TIMEOUT_MS` (60s in `ai-tag-bakeoff.ts` and
`ai-tagging.ts`). `modelSupportsTools()` matches `/(^|\/)gemma/i` so both
`gemma-4-31b-it` and `google/gemma-4-31b-it` resolve the same, and
`/(^|\/)llama-4-scout/i` for Scout. Add other non-tool-calling or
endpoint-brittle families to `NON_TOOL_CALLING_MODEL_PATTERNS` only after
observing repeatable failures.

**Root cause of the "operation was aborted due to timeout" errors**: That exact
string is Node's `AbortSignal.timeout()` DOMException — a **client-side** abort
at 60s, not an OpenRouter error. `google/gemma-4-31b-it` is a real, working model
(observed ~7.9s avg, 25s worst across 21 bake-off successes); the 2 failures
were provider-side stalls that blew past 60s. Skipping the tool leg reduces but
does not eliminate these — a genuinely stalled provider can still exceed 60s on
the JSON leg. If you need to absorb that too, raise `AI_TIMEOUT_MS`.

**Future sessions should**: Do not "restore consistency" by making these models
run the tool leg — it only adds latency and timeout risk. This does not weaken
the production Image Tagging contract: the JSON/schema legs still require
`tags`, `ai_description`, and `scene_description` before storing a result. Verify
a model actually supports image + tool calling on the routed endpoint before
removing it from the skip list.

---

## 59. AI Tag Bake-Off Stores Provider Metadata in `raw_output` (2026-07-14)

**File**: `apps/worker/src/openrouter.ts`,
`apps/worker/src/handlers/ai-tag-bakeoff.ts`,
`src/components/settings/AiTagBakeoffTab.tsx`

**What changed**: OpenRouter calls request router metadata
(`X-OpenRouter-Metadata: enabled`), capture `X-Generation-Id`/provider headers,
parse success and error-body `openrouter_metadata`, enrich from
`/api/v1/generation` when possible, and store that under
`ai_tag_bakeoff_results.raw_output._popdam_provider`. The bake-off UI shows
provider/endpoint next to time, tokens, and cost, and summarizes provider
success/failure patterns per run.

**Why**: The same OpenRouter model ID can route to different provider endpoints,
and failures such as image + function-calling rejection can be endpoint-specific.
The bake-off needs to evaluate production Image Tagging behavior, so provider
route evidence must be visible alongside quality/cost/timing.

**Future sessions should**: Keep this metadata best-effort. OpenRouter may omit
headers or generation metadata; OpenRouter cache hits intentionally omit router
metadata; and old rows will show `unknown`. That is missing evidence, not proof
there was no provider route. Avoid adding a shared-db migration for provider
columns unless the app needs filtering/reporting on this metadata outside the
bake-off UI.

**⚠️ Verified caveat (2026-07-14): the `openrouter_metadata.attempts[]` /
`endpoints.available` path likely never populates — treat "which endpoints
failed" as UNSUPPORTED by OpenRouter's API until proven otherwise.** A session
investigating "the same model sometimes fails, sometimes succeeds" checked this
end to end:

- **OpenRouter's own docs** (`/docs/features/provider-routing`,
  `/docs/api-reference/*`) document **no** `openrouter_metadata` object, **no**
  `attempts[]` array, **no** `endpoints.available` array, and **no**
  `X-OpenRouter-Metadata` request header. Those field names appear to be
  assumed, not real. The only documented route attribution is the response
  `model` field and the `/api/v1/generation` endpoint — **both name only the
  endpoint that ultimately *served* the call, never the failed legs of a
  fallback chain.**
- **Production data agrees**: at the time of the check, **0 of 251**
  `ai_tag_bakeoff_results` rows had ever stored a `_popdam_provider` blob, even
  though 143 carried the sibling `_popdam_output_mode` (written in the same
  object spread). Only one bake-off run postdated the tracking commit
  (`ff84eeb`, deploy-window), so this is *partly* "no data yet" — but combined
  with the docs it strongly suggests the metadata never arrives.
- **Could not be confirmed live**: the PopDAM OpenRouter account's
  privacy/data-policy blocks bare text completions (`No endpoints available
  matching your guardrail restrictions and data policy`), so a from-scratch
  probe couldn't capture a real 200 body. Not worth flipping the account
  setting (outward-facing prod config) to test.

**The reliable way to detect a bad endpoint is quirk #60 (pin +
`allow_fallbacks: false`)** — a hard failure then names the exact provider. The
parser is defensively null-safe, so leaving the `attempts[]` code in place is
harmless; just don't expect the failed-leg list to fill in. To close the open
question, run **one** bake-off on the deployed tracking code and check whether a
single `_popdam_provider` blob ever contains a `routerMetadata.attempts` array.

## 60. Pinning an OpenRouter Endpoint to Force One Provider (2026-07-14)

**File**: `apps/worker/src/openrouter.ts` (`buildProviderPin`),
`apps/worker/src/handlers/ai-tagging-shared.ts` (`callTagAssetModel` `provider`
param), `apps/worker/src/handlers/ai-tagging.ts` (config read),
`src/components/settings/ApisTab.tsx` (admin field).

**What it is**: Optional `admin_config.AI_TASK_MODELS.vision_tagging_provider` —
one or more comma-separated OpenRouter provider slugs (e.g. `anthropic` or
`anthropic,amazon-bedrock`). When set, the production Image Tagging worker sends
`provider: { only: [...slugs], allow_fallbacks: false }` on every OpenRouter
leg, forcing the call to those endpoints and **disabling silent fallback**.
Blank = normal routing. Set it in Settings → AI Models → Image Tagging → "Pin
OpenRouter endpoint (optional)".

**Why**: The same model ID load-balances across upstream endpoints (Anthropic
direct, Bedrock, Vertex, DeepInfra, …) that differ in tool-call fidelity,
JSON-schema support, and content filtering — so "sometimes fails" is usually
*which endpoint got picked*. `{only, allow_fallbacks:false}` is exactly
OpenRouter's documented pin structure (verified against
`/docs/features/provider-routing`). With fallbacks off, a flaky endpoint
**hard-fails visibly** instead of silently rerouting, which both stabilizes
production on a known-good endpoint and turns endpoint flakiness into a
deterministic, attributable error.

**Future sessions should**: Use the Vision Bake-Off to discover which provider
slug wins/fails for a given model (its per-run provider success/failure table),
then pin the winner. The bake-off itself is intentionally left **unpinned** — it
must observe natural routing to be a discovery tool. Only Image Tagging reads the
pin today; ERP classification and PDF extraction do not (add a sibling
`*_provider` key + thread `buildProviderPin` if that need appears).

## 61. Vision Bake-Off Uses Hi-Res PDF Pages, but Production Tagging Still Uses 800px Thumbnails (2026-07-14)

**File**: `apps/worker/src/handlers/ai-tag-bakeoff.ts`.

**What it looks like**: Running a Vision Bake-Off on PDF assets should behave exactly like production Image Tagging because both use the shared `tag_asset` contract.

**Actually**: The contract is shared, but the image rendition can differ. Bake-off now prefers the latest 1500px PDF page image stored on `pdf_text_samples.thumbnail_url` and records `raw_output._popdam_image_rendition = "pdf_hires_1500"`. If no PDF page image exists, or for raster/non-PDF assets, it falls back to the 800px `assets.thumbnail_url` and records `"thumbnail_800"`.

**Why**: The render agents already upload 1500px PDF page images to Spaces for PDF text sampling, so the Railway worker can use them without new storage, schema, or agent work. Raster originals are not uploaded to cloud storage; the worker can only reach the 800px thumbnail unless agents create and upload a new hi-res raster rendition.

**Do not change because**: Treat this as a bake-off measurement path, not a silent production behavior change. Production Image Tagging still uses `assets.thumbnail_url`; moving production to hi-res raster inputs requires an agent-side rendition/backfill plan and, likely, a shared-db column for the new URL.

## 62. Every OpenRouter Call Is Routed Through Exacto by Default (2026-07-14)

**File**: `apps/worker/src/openrouter.ts` (`withExactoRouting`, applied inside `chatCompletion`).

**What it looks like**: The worker configures bare model slugs (e.g. `qwen/qwen3-vl-32b-instruct`) in `admin_config.AI_TASK_MODELS`, but the model string actually sent to OpenRouter has a `:exacto` suffix appended.

**Actually**: `chatCompletion()` rewrites every request's model through `withExactoRouting()`, which appends OpenRouter's `:exacto` routing variant. Exacto routes each call to the upstream provider endpoint with the best measured tool-calling accuracy for that model. It is a **free virtual variant** — no separate endpoint pool, no price premium.

**Why**: OpenRouter maps one model ID to many upstream providers whose tool-calling / JSON-schema / content-filter behavior differs, which is what makes the same model flip pass/fail per call (see #58, #59). Exacto is the routing-layer fix for that, replacing reliance on the client's `tool_choice`/malformed-JSON fallback ladders. Confirmed via OpenRouter docs: Exacto is a model-slug suffix, not a request field.

**Future sessions should**: Leave it on by default for models that benefit, but see the regression note below — it is NOT safe for every model. To opt a specific model out, either add a `MODEL_ROUTING_OVERRIDES` entry (below) or pin an explicit `:variant` suffix in its `AI_TASK_MODELS` slug (e.g. `:nitro`, `:floor`) — `withExactoRouting` is idempotent and leaves any slug that already carries a `:variant` untouched. Exacto composes with the endpoint pin (#60): a hard `provider.only` pin still wins. This applies to **all** OpenRouter calls (tagging, bake-off, ERP), because it lives in the shared client, not per-handler.

**⚠️ Exacto is NOT safe for every model — regression + exception (2026-07-14/15):** Exacto optimizes for *tool-calling* accuracy, so it pins a model to whatever endpoint OpenRouter scored highest for tool use. For `minimax/minimax-m3` that backfired: **8 of its 9 OpenRouter endpoints don't support function-calling at all**, and the one that does (AtlasCloud) returns **truncated tool-call JSON** → MiniMax failures jumped from ~14% (default routing) to **~89%** the moment Exacto deployed (measured from `ai_tag_bakeoff_results`). Fix (commit `f532c08`): `MODEL_ROUTING_OVERRIDES` in `openrouter.ts` hard-pins `minimax/minimax-m3` to the first-party `minimax` provider (`allow_fallbacks:false`) and skips Exacto for it; it's also on the `modelSupportsTools` skip list so it uses the `response_format`/JSON-schema path (which the MiniMax endpoint supports) instead of the tool leg. **Lesson: before trusting Exacto for a model, check that model's endpoints (`GET /api/v1/models/<id>/endpoints`) actually support `tools` and don't truncate; add a `MODEL_ROUTING_OVERRIDES` entry for any model that regresses.** Impact of the fix is to be confirmed by a post-`f532c08` bake-off (MiniMax should return toward ~14%).

## 63. `GOOGLE_AI_API_KEY` Is Still Live — Do Not Treat It as Dead (2026-07-14)

**Files**: `apps/worker/src/gemini-batch.ts`, `apps/worker/src/google-ai-key.ts`, bridge/windows PDF samplers, `agent-api` `google_ai_api_key` passthrough, and the ApisTab "Google AI API Key" field.

**What it looks like**: The old direct-Gemini `ai-tag` edge function was deleted, so the Google key can look obsolete.

**Actually**: The on-prem agents call Google directly for PDF text extraction. The Railway worker also calls Google's multimodal Batch API when Image Tagging explicitly selects a `google-direct/*:batch` model. Its durable state stores only the provider name, batch ID, and item mapping—not prompts or image bytes.

**Future sessions should**: Keep `GOOGLE_AI_API_KEY`, the worker resolver, agent passthrough, ApisTab field, and Google model entries. Removing them breaks the selected direct-batch route and agent PDF extraction. Never silently fall back between Google and OpenRouter after a non-idempotent batch submission. Only a parsed provider 400/422 error envelope may consume the submission receipt (worker → `reset_bulk_operation_submission_lease`, shared-db #3418); timeouts, disconnects, 5xx and other statuses stay ambiguous. A failed/cancelled/expired provider batch fails the operation once; temporary poll failures keep polling the same saved batch ID with backoff. Any `:batch` model (OpenRouter or direct) is valid only as the primary Image Tagging model — never a fallback, PDF or bake-off model. The direct route sends thumbnails and asset metadata to Google Batch, which stores batch results for 6 weeks by default before deleting them (Google Batch API docs); the Image Tagging selector discloses this.

## 64. The `dam` Schema Is NOT Exposed to PostgREST — Reach `dam.*` via `public` RPCs (2026-07-15)

**Files**: `supabase/functions/_shared/*` and worker handlers that touch `dam.*` (`apps/worker/src/handlers/rich-pdf.ts`, `ai-tagging-shared.ts`); shared-db migration `20260715210000_dam_rich_pdf_rpc_access.sql`.

**What it looks like**: A worker/edge call like `client.schema("dam").from("pdf_rich_extraction").upsert(...)` fails at runtime with **`Invalid schema: dam`**, even with the service-role key. It works fine in local SQL, so it looks like a permissions or migration bug.

**Actually**: PostgREST only routes to schemas in its exposed list. On the shared backend that list is `public, graphql_public, api, crm, pim, core, app` (from `authenticator`'s `pgrst.db_schemas` role config) — **`dam` is deliberately not in it**, because `dam` holds worker-internal tables (`sku_human_description`, `pdf_rich_extraction`) that the frontend never queries. Every other app exposes its own schema (`crm`/`pim`/`core`) because those apps query them from the browser; DAM queries `public` (`assets`, `style_groups`), so `dam` stays unexposed on purpose. The service role still goes through PostgREST, so it hits the same wall.

**Why**: Keeping `dam` unexposed means those tables aren't reachable from the API at all (no RLS surface to get wrong). The tradeoff is that server-side code can't use `.schema("dam").from(...)`.

**Future sessions should**: Access `dam.*` from the worker/edge through **`public` `SECURITY DEFINER` functions** (granted to `service_role`), never a direct PostgREST table call. Existing examples: `public.get_pdf_rich_extraction_hashes(uuid[])`, `public.upsert_pdf_rich_extraction(...)`, and the `public.refresh_dam_search_*` / `refresh_style_group_rich_metadata` rollups. Do **not** "fix" this by adding `dam` to `pgrst.db_schemas` — that broadens the shared API surface for all apps and would need RLS on every `dam` table. Note: the two-level tagging path's `dam.sku_human_description` read hits the same wall but has a working fallback to `style_groups.item_description`, so it degrades silently rather than erroring — if you rely on that read, route it through an RPC too.

## 65. Shared-db Migrations May Already Be Applied When You Push; Out-of-Order Needs `--include-all` (2026-07-15)

**What it looks like**: After merging a `shared-db` PR you run `supabase db push` against prod and it says **"Remote database is up to date"** even though you never manually applied it; or a plain `supabase db push` refuses with **"Found local migration files to be inserted before the last migration on remote database."**

**Actually**: Two things, both normal on the shared backend. (1) A merged migration can already be on prod by the time you push (merge-triggered apply and/or a concurrent app session applied theirs) — so **always `supabase db push --dry-run` first** and trust it; don't assume your local file is still pending. (2) Because CRM/DAM/PM/PLM sessions land migrations concurrently, your timestamp can end up **earlier** than migrations already applied by another app (e.g. this session's DAM `20260715183000` was pending after CRM/ERP `…184500`/`…193000` were already on prod). Plain `db push` blocks out-of-order inserts; apply yours with **`supabase db push --include-all`** after confirming the dry-run lists only your file.

**Why**: Migration ordering is global across all apps sharing `qsllyeztdwjgirsysgai`, but each app authors on its own branch/timeline, so out-of-order is expected, not a mistake. `--include-all` is safe **only** when your change is additive and independent of the concurrently-applied ones (verify via the dry-run showing just your migration).

**Future sessions should**: Dry-run before every prod push; use `--include-all` for a legitimately out-of-order additive migration; never renumber a migration that is already merged to `shared-db` `main` to "fix" ordering (that desyncs the ledger). See §8 project refs and the `shared-db-change` skill.

## 66. SeaDrive Folder Selection Must Not Scan Synchronously on Electron's Main Thread (2026-07-16)

**Files**: `apps/popdam-helper/src/main/seafileAdapter.ts`, `ipc.ts`, `main.ts`,
and `localServer.ts`. Fixed in Helper v1.4.13, commit `4301a34`.

**Looks like**: On macOS, the user chooses the SeaDrive mount folder in Helper
Settings and the Helper immediately beachballs; macOS then says **Application
Not Responding**. It can look like the user selected the wrong directory or the
SeaDrive installation is corrupt.

**Actually**: Saving the folder immediately refreshes storage health. Through
v1.4.12, that refresh called synchronous `readdirSync()` / `statSync()` scans
from Electron's main process. SeaDrive is a cloud-backed virtual filesystem, so
directory metadata calls can pause while its provider responds. Blocking the
main process blocks window painting and event handling, which is exactly what
macOS detects as a non-responsive application. Startup library warnings and the
Helper's local `GET /status` route used the same synchronous health path.

**Why the fix has two discovery paths**: Checkout resolution still has a
synchronous compatibility path used inside the existing checkout flow, while
UI/status health polling uses `getSeafileHealthAsync()`. The async path mirrors
the supported layouts and bounded fallback search, including account/category
folders and `Shared with groups/<group>/<library>`. It returns the same
`SeafileHealth` contract, but slow filesystem operations yield instead of
blocking Electron's event loop.

**Do not change because**: Do not “simplify” the async health path back to the
synchronous discovery helpers, and do not remove nested/group discovery just to
make scans fast. Either change reintroduces a known failure: the former freezes
Macs; the latter falsely reports valid shared libraries as missing. If checkout
resolution itself is later observed freezing on a slow mount, migrate that
caller to the same async discovery model rather than adding a timeout around a
synchronous filesystem call (a timeout cannot interrupt a blocked sync call).

**Verification**: `npm run typecheck` and `npm run build` passed in
`apps/popdam-helper`; GitHub Actions run `29508527851` built and published the
v1.4.13 Apple Silicon, Intel Mac, and Windows installers successfully. Final
device verification is: select the SeaDrive folder on a physical Mac and confirm
the status may take time but the window remains interactive.

## 67. A Mounted SeaDrive Library Can Still Miss a File, and Synology Fallback Can Hide Why (2026-07-16)

**Files**: `apps/popdam-helper/src/main/checkoutManager.ts`
(`resolveCopyAndOpen`), `seafileAdapter.ts` (`resolveSeafileTarget`,
`ensureHydrated`).

**Looks like**: Helper Settings shows SeaDrive installed/running, a valid macOS
File Provider root, and `Character Licensed` under both discovered and
configured libraries. Checkout still reports `File not found locally:` followed
by a `Character Licensed/____New Structure/...` path. It looks like the mount is
wrong or SeaDrive needs hours to build a local file database.

**Actually**: The status proves that the mount and library folder are visible,
not that the requested deep path exists in the Mac's File Provider listing or
on the Seafile server. SeaDrive exposes placeholders and hydrates contents on
demand. After 20 minutes, stop treating this as normal initial-list latency and
compare the exact path in Finder and Seafile web.

There is also an error-reporting defect. When Seafile is preferred,
`resolveCopyAndOpen()` stores its failure in `seafileIssue` and, when allowed,
falls back to Synology. If `resolveAssetPath()` returns a Synology path but
`existsSync(sourcePath)` is false, the final generic error includes only that
fallback path. It omits `seafileIssue`, hiding the primary provider's real
failure and potentially showing a relative-looking fallback path.

**Diagnostic decision tree**:

1. Missing in Finder and Seafile web → investigate the NAS-to-Seafile mirror or
   account permissions; local waiting cannot create server content.
2. Present on the web but absent in Finder → restart/activate SeaDrive's macOS
   File Provider and verify account/category selection.
3. Present as a Finder placeholder → click its cloud icon/open it, then retry
   after hydration.
4. Openable in Finder but Helper still fails → inspect the Helper log and compare
   the resolved library root plus `pathInLib` with the Finder path.

**Future sessions should**: Fix the final dual-provider error so it reports both
attempts: the SeaDrive path/reason and Synology fallback path/reason. Do not
remove fallback, and do not tell users to wait indefinitely without checking
server-side existence. No code fix was made in the docs-only follow-up.

## 68. `seafile-ignore.txt` Is Another Application's Canary — Never Crawl or Touch It (2026-07-23)

`seafile-ignore.txt` is a **canary file owned by a different application**. PopDAM/PopSG
must never crawl, record, process, render, open, or modify it. This is permanent — do not
"clean up" the skip entries.

It is filtered in four places, which must stay in sync:

- `supabase/functions/_shared/path-filters.ts` → `JUNK_FILENAMES` (canonical)
- `apps/bridge-agent/src/style-guide-crawler.ts` → `SKIP_NAMES`
- `apps/bridge-agent/src/scanner.ts` → `JUNK_FILENAMES`
- `supabase/functions/_shared/admin-handlers/agent-handlers.ts` → `JUNK_FILENAMES`

**Why it was noticed:** it sat at the root of the `styleguides` share and surfaced as a
*licensor* in PopSG tag reconciliation. That is because
`style_guide_files.licensor_name` is a **generated column**:

```sql
licensor_name GENERATED ALWAYS AS (split_part(relative_path, '/', 1))
```

It is only ever "the first path segment" — it is not validated against any licensor table.
A root-level file therefore contributes its own filename as a licensor. See quirk #69.

## 69. `style_guide_files.licensor_name` Is Not a Licensor — It Is `split_part(relative_path,'/',1)` (2026-07-23)

`licensor_name` is a generated column equal to the **first folder of the path**. Nothing
validates it against `core.licensor`. The same applies to `property_folder` /
`style_guide_folder`, which the bridge crawler fills from `segments[1]` / `segments[2]`.

Consequences seen in production:

- Top-level folders that are **not licensors** appear as licensors: `Spirit Halloween`
  (a customer), `CAA` (a talent agency — its files are actually `CAA/Ford/*`, i.e. Ford),
  `____New Structure`, `seafile-ignore.txt`.
- Folder depth is **not** a reliable indicator of licensor/property. The tree layout varies.

Therefore PopSG tagging (`apps/worker/src/handlers/popsg-tags.ts`) must resolve licensor and
property **by value** against `core.licensor` (name + merch-group `code`) and `core.property`
— never by folder position — and only emits those facets on an exact match or curated alias.

---

## 78. Re-running a PDF text sample on a missing file erases its stored text

**What it looks like**: A targeted `PDF_TEXT_SAMPLE_REQUEST` re-run turns a good `pdf_text_samples` row into `extraction_method = 'failed'`, `extracted_text = null`, `extraction_error = 'ENOENT…'`.
**Why**: The result upsert replaces the whole row. If the file has moved on disk since the asset was indexed, the failure overwrites the earlier text.
**What to do**: Back up the rows (asset_id, extracted_text, char_count, extraction_method, sampled_at) before any bulk re-run, and restore failed rows from the backup afterwards. Done this way in #410 (Indra OCR re-run, 2026-10-14): 3 of 899 files were missing and kept their old text.

## 81. PDFs missing at their recorded path are mostly stale duplicate records (2026-11-03)

**Looks like**: A PDF rescan reports thousands of `ENOENT` failures, as if the files were lost.

**Actually**: A file index of edgesynology1 on 2026-11-03 checked all 24,777 live PDF records. 6,137 were not at their recorded path. 5,683 of those had a filename, size and `quick_hash` match at a path that already has its own live record, and that record had text. They are old records left behind by folder reorganizations, so their content is not unread. The remaining 454: 2 unique and corrected, 63 found only in an `_old` folder (superseded, not repointed), 37 with several copies, 178 with the same name but a different size, and 174 gone from `Decor/`.

**Why**: The move guard in `agent-api` (#51) refuses a move when two records share `(quick_hash, filename)`, and the bridge sends `skip_move_detection` for repeated copies. The new path then gets a new record. Nothing retires a record whose path has vanished, so the old one stays live.

**Prevention (bridge 1.16.20)**: When ingest creates a record, `agent-api` returns other live records with the same filename, `quick_hash` and size. The bridge checks each path on disk and calls `retire-stale-asset` only on a real `ENOENT` while the new file and the stale path's top-level folder are readable. The server repeats the identity checks, refuses open checkouts, copies AI data the survivor lacks, writes an `asset_path_history` row whose new path starts `retired-stale-duplicate:`, then soft-deletes. It never moves a record, so #51 stands. A file that returns to that path revives the record. It runs only after the agent is updated. A file returning under a purge's soft delete is unchanged.

**What to do**: Run `scripts/list-missing-pdfs.sql` (PDFs only; it filters `file_type = 'pdf'`, because `pdf_text_samples` also holds `.ai` rows — 60 of 498 rows in the 2026-11-03 list — which this repoint workflow does not touch), then start a nested session that builds one index, following the `synology-long-running-operations` skill: `nice -n 19 find /volume1/mac -type d -name '@*' -prune -o -type f -iname '*.pdf' -printf '%s\t%T@\t%p\n'`. Only `Decor/` outside `#recycle` is live; `#snapshot`, `Old` and `Archive` are not current locations. Check `/volume1/docker/popdam/manual-scans/pdf-index-20261103/` for the format. Repoint a record only for one match by name, size and `quick_hash` whose target path has no record, and write `asset_path_history` so it can be undone. Never repoint onto a path that has a record: `relative_path` is unique, and that record is the real one. A repointed record that has `indra_rescan_at` set needs that per-row gate cleared to be read again during a rescan; do this before the rescan run completes, because a completed run does not restart by itself. `PDF_BACKFILL` (`admin_config`, the run-control object with status and totals) is a different thing: never reset it; pause and resume it instead.
