# Known Quirks — Why Things Look Wrong But Aren't

This document explains intentional code decisions that may appear like bugs or bad practices to an outside developer. Each entry explains **what it looks like**, **why it exists**, and **what would break if you "fixed" it**.

---

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

## 16. Migration History Is Partially Out of Sync with Git

**What it looks like**: The DB `supabase_migrations.schema_migrations` table contains versions that have no corresponding file in `supabase/migrations/`.

**Why**: This project's Supabase migration history accumulated drift from three sources:
1. Bootstrap migrations (`00001`–`00007`) applied before git-based migration tracking was in place.
2. Wrong-project migrations (`smon_*` prefixed) accidentally applied to popdam-prod.
3. MCP-only migrations applied via `execute_sql` or `apply_migration` during development without creating corresponding local files (or with mismatched timestamps).

**Current state**: These orphaned history entries were resolved in April 2026. The local files and DB history are now in sync.

**Prevention**: This repo no longer authors database migrations. New shared
Supabase migrations must go through canonical `u2giants/shared-db`, where the
complete remote migration history is present and the preview-first workflow can
validate it before production.

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

## 24. `supabase-popsg/` Directory Is Dead Code

**What it looks like**: A separate `supabase-popsg/` directory with its own functions and workflow.

**Why it's dead**: PopSG was originally deployed on a separate Supabase project (`eeueczxhezfhyrhdmidg`). It was later consolidated into the PopDAM project (`qsllyeztdwjgirsysgai`; previously `ryltkzzernhwnojzouyb` before the Virginia move). The directory was never cleaned up.

**What breaks if you deploy from it**: The `deploy-popsg-supabase.yml` workflow targets the old abandoned project — deploying would update a project that no client connects to.

---

## 25. Bridge Agent Imports `ws` and Polyfills `globalThis.WebSocket`

**File**: `apps/bridge-agent/src/realtime-watcher.ts`

**What it looks like**: A clumsy hack — `(globalThis as Record<string, unknown>).WebSocket = ws`.

**Why**: `@supabase/realtime-js` >= 2.11 throws a fatal error ("Node.js 20 detected without native WebSocket support") if `globalThis.WebSocket` is undefined. Node.js 20 has no native WebSocket implementation. Setting the polyfill at module initialization time satisfies the check for all subsequent code.

**What breaks if you remove it**: The bridge agent crash-loops every ~60 seconds on startup.

---

## 26. Bridge Agent Self-Update Uses `docker inspect` + `docker run`, Not `docker compose up`

**Files**: `apps/bridge-agent/src/index.ts`

**Why Compose alone fails**: The bridge agent runs inside a Docker container and has no access to the `docker-compose.yml` file that lives on the host filesystem.

**`POPDAM_CONTAINER_NAME` env var is critical**: Without this anchor, each update cycle inherits the mutated name from the previous cycle (e.g. `popdam-bridge-old-123-old-456`). The `deploy/synology/docker-compose.yml` sets `POPDAM_CONTAINER_NAME: popdam-bridge` explicitly.

**Build identity must NOT come from env vars (fixed 1.16.4)**: `recreateViaDockerRun` clones the *previous* container's entire `.Config.Env` as explicit `-e` flags onto the new container (to preserve `SUPABASE_URL`, `AGENT_KEY`, etc. on installs with no compose file). Explicit `-e` overrides the new image's baked `ENV`, so `POPDAM_BUILD_SHA`/`POPDAM_IMAGE_TAG` get **frozen at the first-ever image's values** and re-inherited every update — e.g. the agent reports `build_sha=8340ef9 / v1.16.0` while genuinely running `a35414d / 1.16.3`. This makes the admin "Build mismatch" badge (which compares reported `build_sha` to `BRIDGE_LATEST_BUILD.sha`) a **false positive**. Fix: build identity is now baked into an **immutable file** `/app/build-info.json` (Dockerfile) and read by `readBuildInfo()` in `index.ts` — a file in the image layer cannot be overridden by env-cloning, so the reported sha always matches the running image. Env vars remain only as a pre-1.16.4 / dev fallback. **Do not "simplify" this back to `process.env.POPDAM_BUILD_SHA`.** To verify an image's true build at any time: `docker inspect <img> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.

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

## 37. AI Vision Model Picker Fetches from OpenRouter Live

**File**: `src/components/settings/PdfTextSamplesTab.tsx`

**Why**: The `AI_MODELS` / `admin_config` approach required manually maintaining a list of OpenRouter models that support image input. OpenRouter's model catalog changes frequently. The `get-openrouter-vision-models` edge function calls `https://openrouter.ai/api/v1/models` and filters on image input support — no manual maintenance required.

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

**Why**: At crawl completion, `deactivate_stale_sg_files(root_label, run_id)` flips `is_active = false` for **every** file under that root whose `crawl_run_id != current run`. That is correct for normal deletes/renames, but a bad crawl can hide real files because the resolver and UI filter `is_active`. On 2026-06-10, an empty/inaccessible crawl was suspected while investigating PopSG's "No style guides yet" state.

**Current guard**: `supabase/functions/agent-api/index.ts` now treats a final `files_found = 0` style-guide crawl as failed and skips stale cleanup. It also excludes `inaccessible_roots` from stale cleanup. This prevents a fully empty/unmounted root from mass-deactivating the active library.

**Remaining watchout**: there is still no percentage/drop floor for suspiciously low but nonzero crawls. Do not assume a large inactive count means true deletions; compare `style_guide_crawl_runs.files_found` and active counts against the prior successful crawl before trusting stale cleanup.

---

## 47. Style Guide Sources (`sku_files_used`) Only Come From Licensing/Tech-Pack PDFs

**Why**: Looks like a bug that a SKU's `.ai` art files and most PDFs never populate "Style Guide Sources." Intentional (migration `20260610070731`, 2026-06-10): only a PDF whose filename contains `licensing sheet` / `license sheet` / `tech pack` / `techpack` may write `sku_files_used` rows, via `is_style_guide_source_pdf(file_type, filename)`. It gates all three write paths (`parse_pdf_files_used` trigger/RPC, the `agent-api/complete-pdf-backfill-batch` JS parser, and the `ai-tag` vision upsert) and the backfill claim scope. `.ai` files hold the same data but are far harder to extract. Pre-gating rows are stamped `source = 'legacy_ungated'`. Full detail + the fuzzy/continuous resolver: `docs/POPSG.md` → "Style Guide Sources".

**Do not "fix" this by re-broadening the parser to all files** — it would repopulate the garbage that was just cleaned out.

---

## 48. `normalize_for_sg_match()` Used to Delete Uppercase Letters (Fixed 2026-06-10)

**Why**: The function ran `regexp_replace(p, '[^a-z0-9]', '')` **before** `lower()`, so uppercase letters (not in `a-z`) were *stripped entirely* rather than lowercased: `2994221_BG101` → `2994221101` (the `BG` vanished). Any case difference between a files-used entry and the real style-guide filename therefore broke exact resolution silently. Fixed in `20260610100545` (lowercase first). Resolution is now also fuzzy (trigram, threshold 0.6) and continuous (nightly cron). 

**Do not reintroduce an unindexed per-row exact `normalize_for_sg_match(filename)` scan** in batch resolvers — it times out on the 214k-row library (that is why `resolve_sku_files_used_fuzzy` is trigram-only; migration `20260610100856`).

---

## 49. `get_filter_counts` Must Stay Index-Only — It Used to 500 the Library on Load (Fixed 2026-06-19)

**What it looks like**: The Library returns `500` from `rpc/get_filter_counts` (and, by knock-on contention, from the plain `assets` list/count queries) on a cold page load. Everything works once the DB is warm, so it looks intermittent.

**Why it happened**: The original `get_filter_counts(jsonb)` ran **five separate full scans** of the 114k-row `assets` table — one per facet (fileType, status, workflowStatus, stage, isLicensed). Cold, that was ~14.2s; the `authenticated` role has `statement_timeout = 8s` (verify: `select rolconfig from pg_roles where rolname='authenticated'`), so PostgREST returns 500. Direct SQL as `postgres` "worked" only because that role has no statement timeout — **do not use a direct-SQL timing to judge whether an API call will pass; always compare against the 8s authenticated ceiling.** Per `docs/KNOWN_QUIRKS.md` #33, `SET LOCAL statement_timeout` cannot raise this — the Supavisor proxy enforces it on the wire.

**How it was fixed** (migrations `20260619130501`, then `20260619131907`):
1. Collapsed the five scans into **one** `MATERIALIZED` CTE over the visible + common-filtered set, then derived all five facet aggregations from that in-memory result. Each facet still excludes its own filter (so selecting one value keeps the other facets' counts visible) by applying the *other* toggle predicates over the CTE.
2. Added a **partial covering index** `idx_assets_facet_counts ON assets (is_deleted) INCLUDE (file_type, status, workflow_status, stage, is_licensed, modified_at, file_created_at, thumbnail_url, style_group_id) WHERE is_deleted = false`. The base scan and the `useTotalAssetCount` / `useUngroupedCount` exact counts now run **index-only** (read the ~20MB index, not the 271MB heap). `get_filter_counts` dropped to **~260ms**; the counts to ~70ms.
3. An interim version (`20260619130501`) instead forced a seq scan via `set_config('enable_indexscan','off',true)`. That was superseded by the covering index in `20260619131907`, which removes the hint so the planner can choose the index-only scan. The seq-scan hint is gone on purpose — **do not re-add it**; it would prevent the covering index from being used.

**Future sessions should**:
- Keep `get_filter_counts` reading only columns present in `idx_assets_facet_counts`. If you add a facet, add its column to the index `INCLUDE` list or you reintroduce a 271MB heap scan and the cold 500.
- After large ingests, the index-only scan's `Heap Fetches` climbs until `VACUUM` runs; a one-off `VACUUM (ANALYZE) assets` clears it. autovacuum normally handles this.
- Judge any `assets`-aggregation RPC against the **8s `authenticated`** ceiling, cold, not against `postgres` timings.

---

## 50. `asset_path_history` Needs Its `asset_id` Index — Detail Panel Used to 500 (Fixed 2026-06-19)

**What it looks like**: Opening an **asset** detail panel 500s on `asset_path_history?...&asset_id=eq.<id>&order=detected_at.desc&limit=10`.

**Why**: `asset_path_history` had only a PK on `id`. Before the duplicate-copy cleanup in #51, the table had grown to millions of rows, so `WHERE asset_id=? ORDER BY detected_at DESC LIMIT 10` did a **full parallel seq scan + top-N sort** (~30.5s) and blew the 8s `authenticated` timeout. Fixed by migration `20260619131239`: `CREATE INDEX idx_asset_path_history_asset_id_detected_at ON asset_path_history (asset_id, detected_at DESC)`. **30,534ms → 16ms.**

**Future sessions should**: Keep the composite index. The 2026-06-20 prune removed the known high-churn rows, but `asset_path_history` can grow again if move detection regresses or if a real large folder reorganization happens.

---

## 51. `quick_hash` Collisions and Duplicate Copies Can Make Assets "Flip-Flap" Between Folders (Fixed Forward + Cleaned 2026-06-20)

**What it looked like**: `asset_path_history` had millions of rows and grew every scan. In the original investigation, **15,151 assets had 100+ path-history rows**; the worst single asset had **18,216 "moves" across 72 distinct paths** and was still moving during that session. The sync pill showed constant "moved" activity. It looked like files were physically bouncing around the NAS; **they were not**.

**Root cause (two halves — investigated for this issue):**
- **The hash collides.** `quick_hash` is `SHA-256(first 64KB + last 64KB + file_size)` (`apps/bridge-agent/src/hasher.ts`, spec in `PROJECT_BIBLE.md §9`). It is intentionally a *sampled* hash, not full content. It produces the **same value for genuinely different files** whenever they share the sampled regions: (a) **0-byte files** (all hash identically — 2 in the DB but many on the NAS), and dominantly (b) **template-derived design files** that have identical headers + footers + identical `file_size` but differ only in the unsampled middle. Confirmed example: one 1.24MB asset's history cycles through **15 different SKUs' `sewn-in label.ai` files** (`EGP66DYWP01 sewn-in label.ai`, `HGB73DYWP01 sewn-in label.ai`, …) — all Illustrator label templates of identical size. **15,099 of the 15,151 heavy flip-floppers are >128KB files** (middle unsampled); only 2 are 0-byte.
- **Old move detection trusted the hash alone.** Before the 2026-06-20 guard, `agent-api` `process-asset` did: *"find one existing non-deleted asset with the same `quick_hash` but a different `relative_path` → treat the incoming file as that asset **moved**"*. It did **not** compare filename, re-verify with a full hash, or check that the old path no longer existed. So when N physical files shared a `quick_hash`, the single deduped asset row was reassigned to whichever colliding file each scan happened to process, writing a spurious `asset_path_history` row each time. Next scan it saw a sibling and "moved" it back — an infinite flip-flap.

**Two consequences (both real):**
1. **Bloat + churn**: `asset_path_history` grows unbounded; every scan issues thousands of pointless `assets` UPDATEs and re-runs `assignToStyleGroup`, churning style-group membership.
2. **Silent data loss / hidden files**: because move-detection *dedups* on `quick_hash`, a cluster of N distinct colliding files is represented by **one** asset row. The other N−1 real files (e.g. 14 of the 15 SKU label files) were never inserted as separate assets and **do not appear in the Library at all**. This is the more dangerous half.

**Fix status (updated 2026-06-20):**
- ✅ **DONE — move-detection guard** (`agent-api` `process-asset`): a move now requires the candidate to match on `quick_hash` **AND filename** AND be the **unique** such row, move detection is **skipped for 0-byte files**, and the incoming path must not already have an asset row. A same-hash file with a *different* filename now falls through to be inserted as its own asset instead of "moving" the shared row.
- ✅ **DONE — same-filename duplicate-copy guard** (bridge agent v1.16.2 + `agent-api`): the bridge collects scan candidates first, `check-changed` returns unchanged existing `(quick_hash, filename)` identities across the scan, the bridge tracks identities before ingesting changed/new files, and later files with the same identity send `skip_move_detection=true`. That lets byte-identical copied files such as repeated `tech pack.pdf` or `prop65sticker_MDF.ai` settle into one asset row per live path instead of flip-flapping one row forever.
- ✅ **DONE — deploy + verify**: commit `0fc3fc1` deployed `agent-api` and bridge agent v1.16.2. A repair scan completed with `122,380` files checked, `12,673` new rows, `9,092` repaired moves, `87,207` updates, and `0` errors. A second verification scan completed with `122,380` files checked, `114` new rows, only `81` moves, `108,782` updates, and `0` errors. The low second-scan move count is the evidence that the flip-flap generator stopped.
- ✅ **DONE — path-history prune**: after verification, `15,155` high-churn assets with `>= 100` history rows were targeted and `9,299,506` rows were deleted from `asset_path_history` in 50k-row batches. The scratch table was dropped and `VACUUM (ANALYZE) public.asset_path_history` succeeded. Post-analyze estimate was about `82,349` rows remaining.
- ⏳ **DEFERRED — heavier-sample hash** (`apps/bridge-agent/src/hasher.ts`): the residual gap is two *different* files that share BOTH a sampled `quick_hash` AND a filename (e.g. two `logo.ai` of identical size). Only a stronger hash distinguishes those. **This is NOT a casual change**: `quick_hash` is computed identically by the bridge AND the desktop Helper (`apps/popdam-helper/src/main/hash.ts`) and is the `expected_hash` for check-in integrity verification (`checkin-verifier.ts`). Changing it requires a **synchronized bridge + Helper release**, a `quick_hash_version` bump, a **full re-scan** to migrate stored hashes, and handling in-flight checkouts (expected_hash computed under the old version). Do it as its own coordinated release, not bundled.

**Future sessions should**: Do **not** treat `quick_hash` as a content-unique key. Do **not** reintroduce hash-only dedupe or hash-only move detection. Preserve the bridge's two-phase scan, `check-changed.existing_content_identities`, per-scan `(quick_hash, filename)` seen set, `skip_move_detection`, and server-side uniqueness/0-byte/path guards. If history grows again, first verify the guard is still live with a clean second full scan before pruning rows.

---

## 52. `asset_checkouts` Cannot Embed `profiles` via PostgREST (Fixed 2026-06-19)

**What it looks like**: The checkout bar / asset detail panel 400s on `asset_checkouts?select=id,status,checked_out_at,profiles(full_name,email)...`.

**Why**: `asset_checkouts.user_id` references `auth.users`, **not** `public.profiles`, and `profiles` links to the user via its own `user_id` column (there is no FK path `asset_checkouts → profiles`). PostgREST therefore cannot resolve the `profiles(...)` embed and returns 400 ("could not find a relationship"). It had nothing to do with the `checked_out_at` column (which does exist).

**How it was fixed**: `src/hooks/useAssetCheckout.ts` now selects `user_id` and looks up the owner's profile in a **second query** (`profiles` where `user_id = checkout.user_id`), attaching it as `profiles` so `CheckoutBar` is unchanged. No schema change.

**Future sessions should**: Don't add `profiles(...)` embeds to any table whose `user_id` points at `auth.users`. Either do the two-step lookup (as here) or add an explicit FK to `profiles` if you want PostgREST embedding. Verify FK paths with `information_schema.table_constraints` before writing embedded selects.

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

## 54. PopDAM Helper (Windows) Uninstall Failed With "NSIS Error: Error launching installer" — CI Cached the NSIS Toolchain (Fixed 2026-06-25)

**What it looked like**: On Windows, uninstalling the Helper failed **every time** with a dialog reading `NSIS Error — Error launching installer`. It reproduced via both **Settings → Apps → POP DAM Helper → Uninstall** and double-clicking the uninstaller directly, and quitting the Helper from the tray first did not help. The install itself worked; only uninstall was broken. (This is distinct from the unsigned-installer first-launch warnings — those are Gatekeeper/SmartScreen *reputation* prompts and are the accepted permanent UX; this was a hard failure of the uninstaller.)

**What the error actually means**: an electron-builder NSIS uninstaller does not delete itself in place — it copies itself into `%TEMP%` and relaunches that copy so it can remove its own install directory. "Error launching installer" is NSIS's message when that temp relaunch fails. Two root causes produce it deterministically: (1) a **malformed uninstaller stub baked in at build time**, or (2) **Windows blocking the unsigned temp copy** (SmartScreen / Win11 Smart App Control / AV refusing to execute a freshly-written unsigned exe). Cause (2) is only truly fixable by code signing (permanently abandoned here — see `HANDOFF.md` §5.3); **this incident was cause (1)** and was fully fixed in CI.

**Why (root cause)**: `.github/workflows/publish-popdam-helper.yml` cached **`~\AppData\Local\electron-builder\Cache`** in the Windows job. That directory holds the NSIS toolchain — the uninstaller stub, NSIS plugins, and `winCodeSign` — that electron-builder uses to **stamp the installer and uninstaller**. The `actions/cache` key was `electron-win-${hashFiles(package-lock.json)}`, so the cached toolchain only changed when `package-lock.json` changed. Once that cache entry held a corrupted/partial toolchain, **every subsequent build restored the same bad toolchain and shipped the same broken uninstaller** — which is exactly why it failed 100% of the time on a clean machine. The build logs confirmed `Cache hit for: electron-win-` / `Cache restored successfully` and a normal-sized (78 MB) installer, so the build "succeeded" while quietly emitting a broken uninstaller.

**How it was fixed** (commit `d7a1133`): the Windows job now caches **only the immutable Electron binary download** (`~\AppData\Local\electron\Cache`) and **no longer caches `~\AppData\Local\electron-builder\Cache`** — the NSIS toolchain is re-downloaded fresh (and integrity-checked) on every run. The cache key prefix was changed `electron-win-` → `electron-bin-win-` so the old combined cache (which still contains the suspect toolchain) is never restored via `restore-keys`. Verified: the rebuilt Helper installs over the old one (writing a fresh, valid uninstaller) and uninstalls cleanly.

**Future sessions should**:
- **Never cache `~\AppData\Local\electron-builder\Cache`** (or its macOS/Linux equivalents `~/Library/Caches/electron-builder`, `~/.cache/electron-builder`) in CI. It is a *mutable build toolchain*, not an immutable dependency; caching it risks shipping corrupted installers/uninstallers that pass the build but fail at install/uninstall time. Cache only the Electron **binary** download (`electron/Cache`), which is per-version and immutable.
- If a Windows uninstall fails with "Error launching installer" again, first rule out the toolchain (already done here): trigger a clean build and reinstall. If a freshly-built uninstaller **still** fails, it is cause (2) — Windows blocking the unsigned temp copy — and the only clean fix is code signing. Do **not** switch the Windows target to MSI to dodge it: the Helper auto-updates via `electron-updater`, which only supports the NSIS target, so MSI would break auto-update.
- To recover a machine whose currently-installed uninstaller is the broken one, you do **not** need manual file deletion — running a corrected installer over the top overwrites in place and writes a new, working uninstaller.

---

## 55. Supabase Auth "500: Database Error Granting User" Can Hide DB Trigger or Sequence Failures (Fixed 2026-07-01)

**What it looks like**: The first Microsoft/Azure login attempt redirects back to `dam.designflow.app` with `500: Database error granting user`. A second attempt may work, making it look like a flaky OAuth/front-end problem.

**What it actually means**: Supabase GoTrue is wrapping a database failure that happened while creating/granting the Auth session. The browser message is generic; the useful detail is in Supabase Auth logs plus Postgres logs for the same timestamp/request.

**Two separate PopDAM causes were found and fixed**:
1. **PopDAM auth trigger was clobbered by shared CRM provisioning**. The shared migration `20260621162220_crm_auth_provision` in `/worksp/shared-db` used the generic trigger name `on_auth_user_created` on `auth.users`, dropping/replacing PopDAM's original trigger. New Azure users were created in `auth.users` and `app.profile`, but missing PopDAM `public.profiles`, `public.user_roles`, and `public.app_access('popdam')`. Fixed by PopDAM migration `20260630173500_restore_popdam_auth_trigger.sql`, which adds `on_auth_user_created_popdam` and backfills managed SSO users.
2. **`auth.refresh_tokens_id_seq` was behind the imported rows**. Postgres logged `duplicate key value violates unique constraint "refresh_tokens_pkey"` at the exact failed `/callback` request. The sequence was at `281` while `auth.refresh_tokens.max(id)` was `3518`, so token creation hit duplicate IDs. Fixed live and committed as migration `20260701114000_repair_auth_refresh_token_sequence.sql`.

**How to diagnose next time**:
- Query the live Virginia project `qsllyeztdwjgirsysgai`, not the old Ohio project.
- In Supabase logs, look in `auth_logs` for `Database error granting user`, note the timestamp/request ID, then search `postgres_logs` around that time for `duplicate key`, `violates`, `handle_new_user`, `trigger`, or `refresh_tokens_pkey`.
- Verify both auth triggers exist:

```sql
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND NOT tgisinternal
ORDER BY tgname;
```

- Verify the refresh token sequence is not behind:

```sql
SELECT max(id) FROM auth.refresh_tokens;
SELECT last_value, is_called FROM auth.refresh_tokens_id_seq;
```

**Future sessions should**: Keep PopDAM's trigger name app-specific (`on_auth_user_created_popdam`). Shared app migrations may add their own `auth.users` triggers, but they must not drop PopDAM's trigger. After imports/restores/cutovers, check sequence alignment for Auth-owned serial tables before blaming OAuth.
