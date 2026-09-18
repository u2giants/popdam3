# Intentional quirks

Moved verbatim from `AGENTS.md` on 2026-09-18 to keep the router under its size cap. Add new entries here, then add a one-line title to the index in `AGENTS.md` → Intentional quirks.

Use this exact shape for every new quirk:

- **Looks like:** the misleading symptom.
- **Actually:** the true behavior.
- **Why:** the reason this behavior exists.
- **Do not change because:** the failure mode if someone "cleans it up."

## Dual-mode (PopDAM / PopSG) via hostname detection

**Looks like:** Two separate Supabase projects, two separate deployments.
**Actually:** One Docker image, one Coolify app, one Supabase project (`qsllyeztdwjgirsysgai`). `src/lib/app-mode.ts` reads `window.location.host` and returns `"popdam"` or `"popsg"`. `IS_POPSG` guards routes, UI panels, and page components throughout `App.tsx` and the components tree.
**Do not change because:** Splitting the mode into two builds or two containers would double the deployment surface for no functional gain.
**Local testing:** Add `?mode=popsg` to any localhost URL — stored in `sessionStorage` for the tab.

## `asset_count` on `style_groups` is a cached field, not computed on read

**Looks like:** `style_groups.asset_count` should always be up to date — just query `COUNT(*) FROM assets WHERE style_group_id = ...`.
**Actually:** `asset_count` is a denormalized cache. It is maintained by:
1. A statement-level trigger `trg_refresh_sg_counts_on_asset_change` (migration `20260515080654`) — fires on INSERT/DELETE of `assets` and on UPDATE when `is_deleted` or `style_group_id` changes.
2. A pg_cron job `nightly-reconcile-sg-asset-counts` (migration `20260531142011`) running at 03:45 UTC daily — calls `refresh_style_group_counts_batch(array_agg(id))` over all groups to catch any drift the trigger missed.
3. The `reconcile-style-group-stats` Railway worker op — on-demand full reconcile.
**Why cached:** Computing `COUNT(*)` with a join on every library page load at the style_groups level is prohibitively slow at scale.
**Drift can occur when:** A bulk asset delete bypasses the trigger (e.g., direct SQL via service role without triggering the transition table logic), or the trigger fires but the DB rolls back after the count update. Before the nightly cron was added (2026-05-31), pre-existing drift from before 2026-05-15 was never cleaned up — 17 style groups had stale counts including 2 with `asset_count=1` but zero actual assets.
**Do not change because:** Use `reconcile-style-group-stats` op or the nightly cron to fix drift; computing live would reintroduce expensive page loads.

## Style-group SKU extraction must skip category folders but accept digit-leading SKUs

**Looks like:** The SKU folder regex should require a long code that starts with letters, such as `MQK8ASESC01`.
**Actually:** Real DAM SKU folders can start with digits and can be shorter, for example `3FZ93DYEC01`, `27W4AV4`, and `3DWC01JK`. The durable rule is: path segment is purely alphanumeric, length ≥ 7, contains at least one letter and one digit, and is not the filename segment. This skips category folders like `B3M_3FZ - 3D Lenticular framed` while still grouping real `3FZ...` art.
**Why:** On 2026-07-08, live production `rebuild_style_groups_batch` still used the old loose regex (`^[A-Za-z]{1,6}[0-9]` without an end anchor), so searching Style Groups for `3fz` returned one bogus category group with 2,234 assets. A preview-verified shared-db migration `20260708150000_dam_strict_style_group_sku_regex.sql` updates the DB rebuild RPC, and `supabase/functions/_shared/style-grouping.ts` matches it.
**Do not change because:** Tightening back to "starts with letters" or length ≥ 10 drops valid digit-leading/short SKUs; loosening back to prefix matching collapses category folders into giant bogus groups. If grouping looks wrong, compare app extractor and DB RPC first, then rebuild style groups after the migration is live.

## `supabase-popsg/` directory is dead code

**Looks like:** A separate Supabase project for PopSG with its own functions and workflow.
**Actually:** PopSG was originally on a separate project (`eeueczxhezfhyrhdmidg`). It was consolidated into the PopDAM project. The directory was never cleaned up.
**Do not change because:** `deploy-popsg-supabase.yml` is intentionally blocked; deploying from `supabase-popsg/` would target the old abandoned project.

## `.ai` "no PDF compatibility" ≠ empty — these files STILL contain real artwork (corrected 2026-07-03)

**Looks like:** An `.ai` saved without "Create PDF Compatible File" is an empty placeholder containing "only Adobe's boilerplate warning" — junk that is safe to delete/hide. (The ".ai Sentinel Cleanup" feature and an earlier version of this quirk both assumed this. **It is wrong.**)
**Actually:** Such a file still contains **all of its native Illustrator artwork** (the PGF layer). Only the *embedded PDF preview* is a boilerplate stub. Tools that read the PDF layer — mupdf, Sharp, Ghostscript's PDF path, `isAiWithoutPdfCompat()`/`isAiSentinel()` — correctly see "no PDF content", but that is **not** the same as "no artwork". Evidence gathered 2026-07-03: of 140 flagged files, median size **745 KB** (up to 657 MB), each with a **unique `quick_hash`** (no empty-stub cluster), names like `spdrmn pth.ai` / `Pooh diecut block art-REV.ai`, and even 4–8 KB files render real art. A native renderer (**Inkscape/Ghostscript reading the native AI, not the PDF**) recovers the artwork — which is how the Windows agent's Inkscape path produces real thumbnails for these files.
**Do not repeat this mistake:** Do **not** delete or hide `.ai` files based on PDF-layer sentinel detection alone. The ".ai Sentinel Cleanup" card (`ai-sentinel-handlers.ts`) *soft-deletes* (`is_deleted=true`) + clears the thumbnail + adds to `scanner_ai_ignores` — the NAS source file is untouched (recoverable), but ~1,319 real artworks were already hidden from the catalog under the false "empty placeholder" premise. The reliable "has recoverable art" signal is a **non-blank native render**, surfaced by the compat-thumbnail audit (below), not a PDF-text match.
**Detection code:** `apps/bridge-agent/src/ai-sentinel-detect.ts` (`isAiSentinel`/`inspectAiPage`, added 2026-07-03) does marker-text + draw-op probe on page 0. This only inspects the PDF layer, so it does **not** distinguish "empty" from "native art present" — it agrees these are PDF-sentinels. `get_ai_sentinel_stats` (re-homed to `shared-db`, exact-phrase match) counts them; migration `supabase/migrations/20260702120000_*.sql` here is **orphaned** (app repos no longer run `db push`; the `forbid-shared-db-bypass.yml` guard even blocks deleting it — leave it inert).

## Compat-thumbnail audit = the real fix for `.ai` thumbnails (perceptual-hash, not OCR)

**Looks like:** "Audit AI Compat Thumbnails" (Settings → Windows Agent) OCRs thumbnails for the word "compatibility" to find the warning-page thumbnails.
**Actually (fixed 2026-07-03):** the OCR check matched the literal `"compatibility"`, but Adobe's warning says "PDF **Compatible** File" — so it flagged **0**, ran ~1 img/sec (≈12 h full-library), and died on a transient 502. `apps/windows-agent/src/compat-audit.ts` now detects via a **256-bit dHash** against a small reference set of the fixed warning image (threshold 30; validated: boilerplate hashes to distance 0, real art ≥53), with 16-way fetch concurrency + batch-fetch retry. It flags → clears (`thumbnail_url=null`) → re-queues for **native** render (Inkscape). A full 45,841-thumbnail scan takes ~8 min and found **547** boilerplate thumbnails.
**Do not change because:** reverting to OCR silently flags nothing. If you change the warning-page render, recompute the reference dHashes in `COMPAT_REF_HASHES`.

## Windows agent self-update was silently frozen (WINDOWS_LATEST_BUILD, fixed 2026-07-03)

**Looks like:** `publish-windows-agent.yml` "succeeds", so the Windows render agent is on the latest build.
**Actually:** the self-updater compares its version to `admin_config.WINDOWS_LATEST_BUILD`. That pointer was **frozen at `0.16.1.147` from 2026-06-20** because the publish step notified the cloud via the `notify-build` edge function using **`DEPLOY_WEBHOOK_KEY`** — a secret **not carried into the new Virginia project at the 2026-06-20 cutover** — and the step was `continue-on-error: true`, so it 401'd silently. The agent ran a **2-week-old build** the whole time. Fixed by rewriting the step to upsert `WINDOWS_LATEST_BUILD` via **PostgREST + `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`** (exactly how `publish-bridge-agent.yml` already does it — which is why the bridge never had this problem), dropping `continue-on-error`, and using `curl -sf`.
**Do not repeat this mistake:** the `notify-build`/`DEPLOY_WEBHOOK_KEY` path is still un-set in prod — do not route agent build notifications through it; use the PostgREST/service-role write. To push a Windows-agent build to a stuck agent immediately, upsert `WINDOWS_LATEST_BUILD` in prod `admin_config` with `{version, download_url, installer_url, checksum_sha256 (must match the release zip), commit_sha}`. See `docs/WINDOWS_AGENT_RUNBOOK.md`.

## ERP `product_category` cutoff date (2025-05-10)

**Looks like:** Some ERP items have no `product_category` even though they have valid MG codes.
**Actually:** Before 2025-05-10, the MG01 field from the ERP API used single-letter codes with unstable meanings. After that date the letters reliably map to categories. The worker (`apps/worker/src/handlers/erp.ts`) only uses `mg_category` to set `product_category` when `erp_updated_at >= 2025-05-10`. Items before that date fall through to the AI prediction path. About 5,500 style groups with pre-cutoff ERP data have null `product_category` and need AI classification.
**Do not change because:** Items before the cutoff would get wrong categories applied automatically.

## PLM production PO sync has two auth layers, and browser JWTs are not durable

**Looks like:** `getProdOrderHeader` only needs the Cloud Run `Authorization` identity token and an `X-User-Authorization` value copied from the PLM web app.
**Actually:** Cloud Run auth and PLM app auth are separate. Cloud Run is handled server-side with `PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON` / service-account impersonation. The PLM app token (`X-User-Authorization`, stored as `PROD_ORDER_API_TOKEN_2`) is a short-lived browser JWT; one verified token expired on 2026-06-16 and later requests returned `403 Invalid Token`.
**Data shape gotcha:** the SKU is nested in `details[]` as `Item #` / `matchedItemNumber`; the production PO number is on the header as `Prod Reference #` / `Prod Order No`.
**Do not change because:** A copied browser token will keep expiring and breaking background sync. The durable fix is for the PLM/BFF developer to provide service-to-service auth: either trust the Cloud Run invoker service account, expose a client-credentials/token-refresh flow, or issue a long-lived read-only API token.

## Bridge agent defers thumbnails to Windows Render Agent for certain files

**Looks like:** Some `.ai` files get `thumbnail_error = "deferred_to_windows_agent"` even though the bridge agent could attempt to render them.
**Actually:** When `windows_render_mode = "primary"` or the `windows_render_policy` mode is set to `"shared"` with the file type in `shared_types`, the bridge agent intentionally skips local thumbnailing and queues a `render_queue` job for the Windows agent instead. The policy is set in `admin_config` and delivered via heartbeat response.
**Do not change because:** These are intentional deferrals, not errors. The Windows agent renders them via Illustrator (higher quality than the PDF-compat path).

## PDF text backfill runs on the Windows agent, not the bridge agent

**Looks like:** The bridge agent is the natural home for all NAS-side batch work, including the full-library PDF/.ai text extraction backfill.
**Actually:** `agent-api/handleHeartbeat()` routes `trigger_pdf_backfill` to the `windows-render` agent when a healthy Windows agent reports a **backfill-capable version (≥ 0.16.0)** — `windowsBackfillCapable` — and falls back to the `bridge` agent otherwise. This version/capability gate makes the cutover automatic and gap-free: the bridge keeps running the backfill until the Windows agent has self-updated to a build that actually contains the loop. The Windows agent (`apps/windows-agent/src/pdf-backfill.ts`) runs the same mupdf→OCR→AI extraction (reusing the `pdf-text-sampler` cascade) and shares the `claim-pdf-backfill-batch` / `complete-pdf-backfill-batch` endpoints, so all extraction CPU runs on the Windows VM instead of the Synology.
**Config-key gotcha:** the command only fires if `PDF_BACKFILL` is in the agent type's heartbeat config-key set (`getConfigKeysForAgent()` in `agent-api`). It must be present in `HEARTBEAT_CONFIG_KEYS_WINDOWS`, or the `windows-render` heartbeat never sees `configMap.PDF_BACKFILL` and the trigger is silently always-false.
**Handover gotcha:** the claim loop self-drives — once started it keeps claiming until `PDF_BACKFILL.status != "running"` or the queue is empty, independent of the heartbeat trigger. To hand the job from bridge → Windows cleanly, set `status=paused`, wait for the bridge to stop on its next claim, then `status=running`; otherwise both agents run concurrently (safe via `ON CONFLICT` dedupe, but wasteful).
**Status/UI gotcha:** the admin Backfill card reads `admin_config.PDF_BACKFILL` through `admin-api/get-pdf-backfill-status`, but the authoritative queue state is `count_pdf_backfill_remaining()`. Completion must be based on **remaining = 0**, not only `processed >= total`, because the initial total can become stale if files are sampled by another path while the job is running. The status route intentionally normalizes a stale `status="running"` row to `completed` when remaining is zero, so the UI shows a terminal result instead of silence or a forever-running state.
**Do not change because:** Reverting to bridge-only pushes heavy extraction onto the NAS CPU.

## Style Guide Sources (`sku_files_used`) only come from licensing/tech-pack PDFs; resolution is fuzzy + continuous

**Looks like:** `.ai` files and ordinary PDFs should populate a SKU's "Style Guide Sources," and unresolved entries are garbage to delete.
**Actually:** Only PDFs whose filename contains `licensing sheet`/`license sheet`/`tech pack`/`techpack` write `sku_files_used` (gate `is_style_guide_source_pdf()`, migration `20260610070731`). Resolution against the 214k-row `style_guide_files` is trigram-fuzzy (`resolve_sku_files_used_fuzzy`, nightly cron `resolve-sku-files-used-nightly` 04:00 UTC) and **quarantine-model — never auto-deletes/unlinks**. Full detail: `docs/POPSG.md` → "Style Guide Sources"; quirks #46–#48.
**Do not change because:** Do NOT bulk-delete unresolved `sku_files_used` rows that look like filenames — PopSG is not a comprehensive ground truth (a stale crawl can mark real files inactive; see quirk #46), so "no match" ≠ "garbage." Only categorical non-filenames (style-guide titles, a SKU used as its own filename) are safe to delete. Files-used live in PopSG `style_guide_files`, **not** PopDAM `assets` — don't reconcile against `assets`.

## Master Data style tracker is temporary; companywide business rules own source authority

**Looks like:** `master.designflow.app/styles` can fuzzy-match customer-looking strings and treat those as canonical customers.
**Actually:** the Master Data style tracker is a temporary Google Sheet replica. Customer identity follows `shared-db/docs/shared-database-vision.md`. Licensor, Property, Character, Style Guide, Franchise, licensed-Asset, and licensing source authority follow `shared-db/docs/core-master-data-consolidation-aim.md`: authorized licensor sources own official names, ownership, and direct relationships; ColdLion controls Property Active/Inactive only; the stale DesignFlow pull has no authority. Email/domain noise belongs only in `crm.ingested_domain` and must never create, promote into, source-ref, FK to, or otherwise associate with customers.
**Why:** the tracker is a working surface over companywide Master Data, not an independent source of business truth.
**Do not change because:** do not write new canonical values from unreviewed tracker text, and do not restore the superseded rule that PLM APIs arbitrate licensing truth. Start at the [companywide application and task map](https://github.com/u2giants/shared-db/blob/main/docs/business-rules/application-map.md); use `docs/MASTER_DATA.md` only for DAM implementation details.

## Sibling file scans need a 10-minute lease/expiry

**Looks like:** `claimed` sibling scan requests should be treated exactly like `pending` requests until the Bridge Agent completes them.
**Actually:** The "Find Sibling Files" UI stores folder-scan jobs as `admin_config` rows named `sibling_scan_request_*`. The Bridge Agent claims a row, scans the NAS folder for sibling JPG/PNG/eligible PDF files, then reports completion through `complete-sibling-scan`. If the agent restarts or throws after claiming, the row can otherwise stay `claimed` forever and the UI will sit at "Waiting for Bridge Agent..." indefinitely.
**Do not change because:** `supabase/functions/_shared/admin-handlers/sibling-scan-handlers.ts` intentionally expires stale `claimed` rows after 10 minutes, and `supabase/functions/agent-api/index.ts` intentionally lets the Bridge Agent reclaim stale claims. `apps/bridge-agent/src/index.ts` also reports a failed scan when a per-request worker throws. Keep these together so a dead agent/request becomes a retryable failure instead of blocking future scans for the same folder.

## `app/` symlink at repo root

**Looks like:** An older version of the frontend code.
**Actually:** Dead symlink to an old build snapshot. Has no effect on the build or runtime.
**Do not change because:** Ignore entirely; it has no build/runtime role.

## `bulk-job-runner` edge function is a deployed no-op

**Looks like:** A real function that runs batch jobs.
**Actually:** Returns `{ ok: true, message: "replaced by railway worker" }`. All batch work runs in the Railway worker. The pg_cron schedule that used to call this was removed in migration `20260322000000`.
**Do not change because:** Adding logic here would conflict with the Railway worker.

## PopSG file tagging (`tag-popsg-files`) runs in the Railway worker, not an edge function

**Looks like:** A tagging/search feature, so it must live in `supabase/functions/`
alongside the other PopSG API routes.
**Actually:** The whole op is `apps/worker/src/handlers/popsg-tags.ts`. That file owns
both phases and writes the resume cursor. `supabase/functions/` only holds the
registry entry in `_shared/operation-constants.ts`. This is the general rule, not a
special case: **long-running batch/bulk operations are worker handlers; edge functions
are request-response only** (see the `bulk-job-runner` quirk above).
**Cursor detail:** two shapes, both accepted by `isResumableOperationCursor` in
`src/hooks/usePersistentOperation.ts`. Phase 1 (deterministic) uses a bare UUID.
Phase 2 (folder consensus) uses `consensus:<base64url>` — `base64url`, so the
alphabet is `A-Za-z0-9-_` with **no `=` padding**. Do not "fix" the validation regex
to allow `=`/`+`/`/`; that would be matching an encoding the writer never produces.
When the op is finished or has no next key, the worker writes `null`, never a bare
`consensus:`.
**Do not change because:** Adding a duplicate implementation under
`supabase/functions/` would fight the worker for the same `BULK_OPERATIONS` entry.

## `verify_jwt = false` on `admin-api` in `supabase/config.toml`

**Looks like:** Security hole — admin API doesn't verify JWTs at the gateway level.
**Actually:** CORS preflight (`OPTIONS`) carries no auth header; gateway-level JWT check rejects it. Verification happens inside the function. See `docs/KNOWN_QUIRKS.md` #4.

## Style group rebuild `finalize_stats` calls `reconcile_style_group_stats_batch` in a loop

**Looks like:** Should just call `run_full_reconcile_style_group_stats` once.
**Actually:** `run_full_reconcile_style_group_stats` has no `SET statement_timeout`, so after a full rebuild the DB-level role timeout kills it. The batched approach (100 groups/batch for counts, 25 for primaries) each has `SET statement_timeout = '120s'` and completes without hitting the limit.
**Do not change because:** "Start Fresh" rebuild reliably times out on "Compute counts" when there are many groups.

## `trg_sync_primary_on_thumbnail` fires on INSERT **and** UPDATE

**Looks like:** Overkill — why would an INSERT need to sync a cover?
**Actually:** The bridge agent sets `thumbnail_url` at insert time (single DB write). If the trigger only fired on UPDATE (which it did before migration `20260529132758`), those assets never triggered the sync, leaving `primary_asset_id = null`. A backfill in that migration fixed 482 affected groups.
**Do not change because:** Reverting to UPDATE-only would silently break cover assignment for any asset inserted with a thumbnail already set.

## Railway worker deploys on every push to `main`

**Looks like:** Wasteful — most pushes don't touch `apps/worker/`.
**Actually:** Railway doesn't support path filters. Every push triggers a Railway rebuild regardless of which files changed. This is a Railway platform constraint, not a bug.

## `admin_config.OPENROUTER_API_KEY` is the single source of the OpenRouter key

**Looks like:** Two places hold the key — `admin_config` and the Railway env var.
**Actually:** Since 2026-08-21 everything reads `admin_config.OPENROUTER_API_KEY`: bridge/windows agents via the heartbeat response, the edge functions directly, and the Railway worker via `apps/worker/src/openrouter-key.ts` (cached 60s). The Railway env var is a fallback only, used when the `admin_config` row is empty or unreadable, and the worker logs loudly when it falls back.
**Why it changed:** the worker used to read only the Railway env var, so rotating the key in Settings → APIs left the worker on the old key — the model list kept working (edge function) while every AI tagging and vision bake-off call failed with `OpenRouter 401: {"error":{"message":"User not found.","code":401}}`.

## A brand-new OpenRouter batch 404s on the first status poll

**Looks like:** The batch job was never created — `OpenRouter 404: Batch job batch-… not found.` on every `:batch` model (e.g. `google/gemini-3.7-flash:batch`).
**Actually:** Creation returns `202 validating` with a real batch ID, but the job is not readable for a few seconds. Measured live 2026-08-21: first GET 404, next GET 5s later `in_progress`. The worker used to treat any failed status poll as fatal, so every batch attempt died instantly.
**Now:** `apps/worker/src/openrouter.ts` retries through 404s for a 2-minute grace window (and through 429/5xx), logging each retry. A 404 after that window, or once the job has been seen, still fails loudly.

## `.mcp.json` carries no secrets — MCP tokens come from 1Password (do NOT re-hardcode)

**Looks like:** `devops-mcp`/`synology-monitor` in the root `.mcp.json` have `Bearer ${DEVOPS_MCP_TOKEN}` / `${NAS_MCP_TOKEN}` placeholders that "should" hold the actual token.
**Actually:** The tokens are injected from 1Password (`vibe_coding/designflow-mcp`) — on the VPS via a `~/.bashrc` `op read` block, elsewhere via `op run`. The old hardcoded tokens were exposed in git history and had to be rotated (2026-06-22).
**Do not change because:** pasting real tokens back into `.mcp.json` commits them to git and re-exposes them. Full model + rotation steps: `docs/MCP_SERVERS.md`.

## `supabase` MCP server needs its own explicit `env` block, unlike the `http`-type servers

**Looks like:** Since `devops-mcp`/`synology-monitor` resolve their `${VAR}` bearer-token placeholders automatically, the `supabase` entry (a local `npx` stdio server) should too.
**Actually:** `${VAR}` auto-resolution from 1Password (some hosting environments do this) has only been observed for `http`-type servers' `headers` block. The `supabase` entry originally had **no `env` key at all**, so it depended entirely on `SUPABASE_ACCESS_TOKEN` already being exported in the shell that launches the session (the `~/.bashrc` `op read` block) — which doesn't happen in every session type (confirmed 2026-07-08: a non-VPS session had the token unset, and `npx @supabase/mcp-server-supabase` failed instantly with "provide a personal access token"). Fixed by adding `"env": {"SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"}` to the `supabase` entry in `.mcp.json`, matching the placeholder pattern already used elsewhere in the file.
**Do not change because:** this still carries no literal secret (placeholder only). If `supabase` MCP tools are unavailable after a session restart, check whether the specific environment's launcher exports `SUPABASE_ACCESS_TOKEN` before starting Claude Code — see `docs/MCP_SERVERS.md`.

## `src/integrations/supabase/client.ts` is a one-line re-export

**Looks like:** Should create a Supabase client.
**Actually:** Re-exports from `external-supabase.ts` so that Lovable overwrites don't break production. See `docs/KNOWN_QUIRKS.md` #2.

## Supabase credentials hardcoded in `src/lib/app-mode.ts`

**Looks like:** Security anti-pattern.
**Actually:** The anon key is a publishable key (like a Firebase web API key); the service role key is never hardcoded. Lovable overwrites `.env` on every deploy, so env vars can't be trusted. See `docs/KNOWN_QUIRKS.md` #1.
**Do not change because:** Moving these to env vars would make all queries silently route to the empty Lovable-provisioned project.

## Helper storage provider is per-machine/region, not a global flag

**Looks like:** `admin_config.HELPER_SEAFILE_PREFERRED` should globally switch all designers to Seafile.
**Actually:** Transport is chosen **per machine by region** — Brazil (WFH) → Seafile/SeaDrive, USA → Synology `edgesynology1` over SMB. The Helper's local `config.preferredProvider` is the real lever (set at install); `HELPER_SEAFILE_LIBRARIES` + `HELPER_SYNOLOGY_FALLBACK_ALLOWED` flow from `admin_config` via `helper-api /config`. Brazil keeps a Synology fallback over Tailscale SMB. USA/Synology check-in first writes through the configured local NAS folder mapping with temp-copy-then-rename, then falls back to Synology File Station if the local SMB write fails. A library is matched by **longest path-prefix** on `relative_path` (a PopDAM root can hold multiple Seafile libraries as subfolders).
**Do not change because:** A single global flag breaks the region split; see `docs/SEAFILE_INTEGRATION.md`.

## SeaDrive installer is self-hosted and auto-mirrored by the worker

**Looks like:** The Downloads page should just link seafile.com for the SeaDrive client.
**Actually:** The Railway worker's `seadrive-mirror` handler runs weekly from `tick()`, scrapes the official SeaDrive download page, and mirrors the latest `.pkg`/`.msi` into the `popdam` Spaces bucket, recording `admin_config.SEADRIVE_LATEST` ({version, mac_url, win_url, mirrored, checked_at}). The Downloads page reads that and serves the pinned hosted version (fallback: official URLs). Spaces creds come from `admin_config.DO_SPACES_*` — the worker has no Spaces env var.
**Do not change because:** Removing the mirror reverts to an uncontrolled third-party download; the LRU cache/pinning is SeaDrive-native (not our code).

## Seafile check-ins park in `verifying` status before completing

**Looks like:** Check-in should immediately mark the checkout `complete` once the helper's upload returns, the same as a Synology direct upload.
**Actually:** For Seafile-sourced check-ins (`source_provider = 'seafile'`), the file travels designer → Seafile server → Synology NAS (extra hop). The helper's upload returning proves only that the file arrived on Seafile, not that it landed intact on the Synology. `helper-api/complete-checkin` parks these checkouts in `status: 'verifying'` (lock still held) instead of `complete`. The bridge agent (running on the Synology) claims pending verifications via `claim-checkin-verifications`, stat-checks the on-disk file for size match, then computes a quick-hash (SHA-256 of first 64 KB + last 64 KB + size — a ~128 KB read). On match it calls `report-checkin-verification` and the checkout advances to `complete`. Synology direct uploads bypass this entirely and complete immediately as before.
**Feature flag:** gated by `admin_config.CHECKIN_VERIFICATION_ENABLED` (read in `complete-checkin`). **Activated 2026-06-09.** When off/absent, Seafile check-ins complete immediately like before — set it to `false` for instant rollback, no redeploy. It was shipped *dark* first because helper-api and the bridge agent deploy via different pipelines; activating before the verifying-capable agent (≥ v1.16.0) is live would hang check-ins with nothing to confirm them.
**Why:** Releasing the lock before the file has synced defeats the checkout/check-in guarantee — a second designer could check out and overwrite a partially-synced file.
**Do not change because:** `verifying` is included in the `asset_checkouts_one_active_per_asset` partial unique index (same as `active`), so the lock is held throughout. Removing the step silently re-introduces a race condition for WFH Brazil check-ins.
**Timing / deadlines:** T1 = 30 min (`verify_deadline_at`) — flag surfaced to designer + admin, re-drive triggered. T2 = 2 hours (`verify_resolve_at`) — auto-resolve releases the lock into `error` with diagnostics. Both deadlines freeze when the bridge agent is offline (detected by a gap > 3 heartbeats in `verify_last_attempt_at`); see `handleReportCheckinVerification` in `supabase/functions/agent-api/index.ts`.
**Code:** `supabase/functions/helper-api/index.ts` (complete-checkin Seafile branch), `supabase/functions/agent-api/index.ts` (claim-checkin-verifications / report-checkin-verification), `apps/bridge-agent/src/checkin-verifier.ts`, migration `20260609120000_asset_checkouts_receipt_verification.sql`.

---

## Agent reported `version` can lie — the admin panel trusts `build_sha`, not the version string

**Looks like:** The Settings → Bridge Agents "Up to date ✅" badge means the agent is running the latest published code.
**Actually:** The agent reports three identity fields. `version` is read from `package.json` at **runtime** (a mutable, human-edited string). `image_tag` and `build_sha` identify the running image and — **as of bridge v1.16.4** — are read from an **immutable `/app/build-info.json` baked into the image** (`readBuildInfo()` in `apps/bridge-agent/src/index.ts`), **not** from env vars. This file-based source matters: the self-updater's `recreateViaDockerRun` clones the previous container's entire env as explicit `-e` flags, which **used to override the env-based `POPDAM_BUILD_SHA`/`POPDAM_IMAGE_TAG`** and freeze them at the first image's values even after a *successful* update (see Incidents 2026-06-21 + `docs/KNOWN_QUIRKS.md` #26). A file in the image layer can't be overridden by env-cloning, so the reported `build_sha` now always matches the running image. The panel compares the agent's `build_sha` against `BRIDGE_LATEST_BUILD.sha` (returned by admin-api `get-latest-agent-build`). "Up to date" is sha-based; a version-matches-but-build-differs state renders a red **"Build mismatch"** warning with the recovery command.
**Why:** On 2026-06-09 the panel showed v1.16.0 "up to date" while the NAS container ran v1.9.6 — the version string hid a failed update; `build_sha` exposed it. But the env-based `build_sha` then produced **false** "Build mismatch" alerts on every later (successful) update because the env-clone froze it — root-caused and fixed 2026-06-21 by moving build identity to the immutable file. Env vars remain only as a pre-1.16.4 / dev fallback.
**Do not change because:** The self-updater is fragile (see `docs/KNOWN_QUIRKS.md` #26 — ~50 iterations to stabilize) and was deliberately left untouched; the fix went into the build (file) + reader, not the recreate logic. **Do not "simplify" `readBuildInfo()` back to `process.env.POPDAM_BUILD_SHA`** — that re-introduces the env-clone freeze and the false alerts. Code: `apps/bridge-agent/{Dockerfile,src/index.ts}`, `src/pages/SettingsPage.tsx` (`AgentStatusSection`), `supabase/functions/admin-api/index.ts` (`handleGetLatestAgentBuild`).

---

## `stage` is not `workflow_status` (path-derived attributes)

**Looks like:** `assets.stage` and `assets.workflow_status` are redundant — both come from the folder path, so pick one.
**Actually:** They answer different questions. `stage` is **positional** — the folder directly under `____New Structure` (one of the 5 lifecycle buckets: In Development, Concept Approved Designs, Product Ideas, Freelancer art, Discontinued), set by a DB trigger. `workflow_status` is a **deepest-first scan** against `admin_config.WORKFLOW_FOLDER_MAP`, set by edge-function ingest code, and its values include adoption/approval states (`customer_adopted`, `licensor_approved`). For the same file, `stage="In Development"` while `workflow_status="customer_adopted"`. `customer`/`program` ride alongside `stage`, derived only in the In Development → Customer Adopted branch.
**Why:** `workflow_status` predates `____New Structure` and is ambiguous there (it conflates lifecycle with approval and deliberately drops the Concept-Approved signal). `stage` gives a clean lifecycle bucket for the new tree.
**Do not change because:** Filters, search (`Ross Wall 2026` → its files/groups), and `get_filter_counts`/`get_path_facets` all depend on these columns; the triggers keep them in sync on folder moves. Full rules: `docs/PATH_ATTRIBUTES.md`.

## `quick_hash` is NOT content-unique — move detection is guarded (fixed forward 2026-06-20)

**Looks like:** `quick_hash` should identify a file's contents, so matching it is enough to detect a move.
**Actually:** `quick_hash` = SHA-256(first 64KB + last 64KB + size), a *sampled* hash. Template-derived design files and all 0-byte files can collide, while byte-identical duplicate copies intentionally share a hash. Since bridge agent v1.16.2 and the matching `agent-api`, move detection is allowed only when the incoming path has no existing row, file size is nonzero, the candidate is unique by `(quick_hash, filename)`, and the bridge has not marked the file with `skip_move_detection`.
**Why:** The old hash-only logic flip-flapped one asset row between duplicate/colliding paths, hid the other real files from the Library, and grew `asset_path_history` to millions of rows. After v1.16.2 was deployed, a repair scan and verification scan completed; the verification scan saw `122,380` files, `81` moves, and `0` errors. Then `9,299,506` high-churn `asset_path_history` rows were pruned and `VACUUM (ANALYZE)` succeeded.
**Do not change because:** Reverting to hash-only move detection will regenerate path-history bloat and hide duplicate/colliding files again. Preserve the bridge's scan-wide `(quick_hash, filename)` seen set, the `check-changed.existing_content_identities` response, `skip_move_detection`, and the server-side uniqueness/0-byte/path guards. Full detail: `docs/KNOWN_QUIRKS.md` #51.

## Library list/facet queries must beat the 8s `authenticated` timeout (2026-06-19)

**Looks like:** `get_filter_counts` / `assets` count queries 500 intermittently on cold load; "works in SQL."
**Actually:** Direct SQL runs as `postgres` (no statement_timeout). The browser runs as `authenticated` (`statement_timeout=8s`, Supavisor-enforced — `SET LOCAL` can't raise it, see `docs/KNOWN_QUIRKS.md` #33). `get_filter_counts` was 14s (5 table scans); fixed to ~260ms via one materialized scan + the `idx_assets_facet_counts` covering index (index-only). `asset_path_history` reads needed `idx_asset_path_history_asset_id_detected_at` (30s→16ms).
**Do not change because:** Always size `assets`-aggregation RPCs against the 8s `authenticated` ceiling cold, never against `postgres` timings. Keep `get_filter_counts` reading only columns in `idx_assets_facet_counts`. In Style Groups mode, do not run the background all-assets list query just to populate counters; group counts and filtered file totals should come from `style_groups` (`useStyleGroupCount` / `useStyleGroupAssetCount`). This matters for legacy Wall/`3FZ` filters, where the group queries are valid but the unnecessary `assets` query can 500. Detail: `docs/KNOWN_QUIRKS.md` #49–#52.

## The `dam` schema is NOT exposed to PostgREST — reach `dam.*` via `public` RPCs (2026-07-15)

**Looks like:** `client.schema("dam").from(...)` from the worker/edge should work with the service-role key.
**Actually:** `dam` is not in `pgrst.db_schemas` (`public, graphql_public, api, crm, pim, core, app`), so any PostgREST call to `dam.*` returns **`Invalid schema: dam`** — even for `service_role`. This is deliberate: `dam` holds worker-internal tables (`sku_human_description`, `pdf_rich_extraction`) the frontend never queries.
**Do not change because:** Adding `dam` to the exposed list broadens the shared API surface for all apps and needs RLS on every `dam` table. Instead reach `dam.*` through `public` `SECURITY DEFINER` functions granted to `service_role` (e.g. `get_pdf_rich_extraction_hashes`, `upsert_pdf_rich_extraction`, `refresh_style_group_rich_metadata`). Full detail: `docs/KNOWN_QUIRKS.md` #64.

## Rich-PDF extraction uses DeepSeek's **direct** API, not OpenRouter (2026-07-15)

**Looks like:** all worker AI goes through OpenRouter/Exacto, so rich-PDF should too.
**Actually:** the `rich-pdf-extract` op calls DeepSeek directly (`apps/worker/src/deepseek.ts`, key `DEEPSEEK_API_KEY`) because it sends an identical instructions+schema prefix on every one of ~19k calls, and DeepSeek's **automatic prefix caching** bills cache hits at ~1/10 — a saving OpenRouter does not reliably pass through. The op puts the stable prompt in `system` and the variable PDF text in `user` to maximize cache hits, and normalizes extracted `materials` (uppercase) so the DAM Material facet doesn't split on casing.
**Do not change because:** routing this batch through OpenRouter loses the caching economics. General rule for future cacheable, high-volume LLM batches: prefer the direct provider API. Full detail: `docs/RICH_PDF_EXTRACTION.md`.

## Compact chrome duplicates its media query in TS **and** CSS on purpose (2026-07-29)

**Looks like:** `COMPACT_CHROME_QUERY` in `src/hooks/use-compact-chrome.ts` is the single source of truth for the short-screen library layout, so changing it is enough.
**Actually:** the same condition `(max-height: 1300px), (max-width: 1700px)` is written **twice** — once in that TS constant (drives React branching) and once as an `@media` block in `src/index.css` that flips `--pd-header-h` between `3.5rem` and `3rem`. A TypeScript constant cannot drive a CSS media query, so the duplication is unavoidable. The page shells in `Index.tsx` and `StylesPage.tsx` size themselves with `h-[calc(100vh-var(--pd-header-h))]`.
**Do not change because:** editing one and not the other yields a page shell 8px taller or shorter than the header, which shows up as a stray scrollbar or clipped pagination bar rather than an obvious break. Change both together. Also note the query is height-first, not the usual width breakpoint — the problem it solves is vertical space on wide-but-short screens like 1920x1200. Full detail: `docs/UI_OVERVIEW.md` → "Compact Chrome".
