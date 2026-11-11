<!-- generated split 2026-11-11: fixed-quirk history moved verbatim from docs/KNOWN_QUIRKS.md; that file keeps the living entries -->

# Fixed-quirk history (archive)

Resolved or superseded quirk write-ups, moved verbatim from `docs/KNOWN_QUIRKS.md`
on 2026-11-11 so the living registry stays small. Entry numbers are the original ones;
nothing was rewritten. New quirks go to `docs/KNOWN_QUIRKS.md` (deep dives) or
`docs/idiosyncrasies.md` (short registry entries indexed from `AGENTS.md`).

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

## 24. (Removed) `supabase-popsg/` Directory


The dead `supabase-popsg/` folder and `deploy-popsg-supabase.yml` were deleted in #221. PopSG runs on the main PopDAM project (`qsllyeztdwjgirsysgai`).

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
- Keep the expensive all-assets list query disabled while the library is in **Style Groups** mode. On 2026-07-08, opening the filter panel with Wall/`3FZ` filters active fired a background `assets` GET that returned 500 even though the visible style-group queries succeeded. Groups mode should use `style_groups` queries for visible rows, group counts, and filtered file totals; the all-assets query is only for Assets mode.

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

---

## 56. Manually Stopping a Scan Reported "Scan Failed Before Details Were Recorded" (Fixed 2026-07-09)


**What it looks like**: Settings → Scan Diagnostics shows a red "Scan failed before details were recorded" card after an admin uses the **Stop Scan** button — even though nothing actually crashed. The card's own copy blames a legacy pre-enforcement agent, which is misleading for a fresh, intentional stop.

**Why it happened**: Two different code paths write `SCAN_PROGRESS.status = "failed"`. The normal agent-crash path (`handleScanProgress` in `agent-api/index.ts`) always synthesizes a fallback `error` message via `synthesizeScanFailure()` when the agent didn't report one — so genuine crashes always carry a reason. But `handleStopScan()` (in `supabase/functions/_shared/admin-handlers/agent-handlers.ts`) force-writes `status: "failed"` directly into `admin_config.SCAN_PROGRESS` to break a stuck "running" state, and never went through that synthesis — it wrote no `error` field at all, so the UI fell through to its generic "before details were enforced" copy meant for old data, not for this live path.

**How it was fixed**: `handleStopScan()` now writes `error: "Scan stopped manually via the Stop Scan action."` alongside `status: "failed"`. `src/pages/ScanDiagnosticsPage.tsx`'s `explainScanError()` recognizes the phrase `"stopped manually"` and shows a calm, non-alarming "Scan stopped manually" card instead of the generic error explanation.

**Future sessions should**: If you add another place that force-sets `SCAN_PROGRESS.status = "failed"` outside the agent's own reporting path, always include an explicit `error` string — don't rely on `synthesizeScanFailure()`, which only runs inside `handleScanProgress`. The status is still literally `"failed"` (not a distinct `"stopped"` state) — introducing a real `"stopped"` status would touch more surfaces (badge color, any code branching on `status === "failed"`) and wasn't done here; the fix is message-only.

---

## 57. Vision Bake-Off Character Recognition Can Be Right While UUID Fields Are Empty (Fixed 2026-07-14)


**What it looks like**: A model names a character correctly in `ai_description`
or tags, but the Characters field is empty; or it describes the visible
character correctly while storing an obviously wrong property/character UUID.

**Why it happened**: The bake-off result columns store canonical UUID matches,
not free text. Older bake-off prompting asked the model to return
`character_ids` from a compact character list. That list used
`characters.is_priority=true` in several cases, and `is_priority` is only a
PopDAM usage shortcut computed by `rebuild-character-stats` from existing
`asset_characters` links. Rare/new-but-valid characters can be
`is_priority=false`, and missing taxonomy rows cannot be returned as UUIDs at
all. Example found on 2026-07-13: models could describe Poppy from Trolls, but
there was no Poppy row under the Trolls property; Frosty had a row but was not
priority. In broad no-property prompts, models also chose unrelated UUIDs such
as Woody Woodpecker, T.O.T.S., or Batman because the UUID list was too noisy.

**How it was fixed**: The bake-off worker now lets models return
`character_names` as well as `character_ids`, includes all characters for a
known property/licensor instead of only priority characters, resolves exact
character names after the model responds, rejects property/character UUIDs that
conflict with the selected/evidenced property, and records rejected/unresolved
taxonomy decisions under `raw_output._popdam_debug`. Stale `running` result rows
older than 10 minutes are marked failed instead of staying live forever. The
sampler also changed from latest-first to random UUID-pivot sampling with
dedupe by `quick_hash`, `sku + filename`, and filename, preferring non-TECHPACK
copies.

**Future sessions should**: Do not treat `is_priority=false` as "invalid
character." It only means "not common enough for compact prompts." If a model
correctly names a character but no UUID is stored, first check whether
`public.characters` has the canonical row under the correct property. Missing or
corrective taxonomy data belongs in canonical `/worksp/shared-db` migrations,
not ad hoc Dashboard SQL or app-local migrations.

---

## 70. `.single()` on `user_roles` Silently Denies Admins Who Hold Two Roles (fixed 2026-07-26)


**File**: `supabase/functions/helper-api/index.ts` — `handleAdminForceDiscard()`

**What it looked like**: a normal admin check.

```ts
const { data: role } = await db.from("user_roles").select("role")
  .eq("user_id", userId).single();          // no .eq("role","admin")
if (!role || role.role !== "admin") return err("Admin only", 403);
```

**Why it was a bug**: `user_roles` is `UNIQUE(user_id, role)` — one row *per role* — so a
user may legitimately hold both `user` and `admin`. `.single()` returns a `PGRST116` **error
result** (it does not throw) when the query matches more than one row, and destructuring only
`data` discarded it, leaving `role === null`. Verified against production on 2026-07-26: one
of the three PopDAM admins had two `user_roles` rows and was getting **403 "Admin only"** on
force-discard. The other five admin checks in the codebase filtered with
`.eq("role","admin").maybeSingle()` and were unaffected — classic copy-paste drift.

**Fix**: all six admin checks now go through `_shared/admin-auth.ts` → `requireAdmin()`,
which fetches **every** role row for the user and decides with the pure
`rolesGrantAdmin(rows)` in `_shared/auth-policy.ts`. `.single()` is banned in this path.
Regression guard: `src/test/auth-policy.test.ts`, *"a user holding both 'user' and 'admin' is
an admin"*.

**What breaks if you "fix" it back**: filtering the query with `.eq("role","admin")` would
also be correct, but production would then never pass a multi-row array to the policy
function and that regression test would guard a dead path. Deleting the duplicate row is not
the fix either — the schema permits it.

---

## 71. Future NAS Dates Must Be Quarantined, Not Sorted as Newest (fixed 2026-08-02)


**Looks like:** two PopSG style guides are dated 22 years in the future.

**Actually:** 136 source files in two Trolls folders all had the same corrupt NAS mtime,
`2048-12-31 23:00:00 -0500`. The grouped PopSG view showed two cards because it displays
the newest member-file date. The file contents were intact and all 136 files contained valid
embedded Adobe/PDF modification dates, which were used to restore the authoritative files on
`edgesynology1`; ShareSync then carried the corrections to `edgesynology2`.

**Why:** the style-guide crawler previously copied `lstat().mtime` directly into
`style_guide_files.modified_at`, and `agent-api` accepted it without a plausibility check.

**Do not change because:** both layers now quarantine dates more than 24 hours ahead of the
current clock. The bridge sends `modified_at: null` and logs an error; `agent-api` repeats the
check before every upsert so an old or faulty agent cannot reintroduce the bad sort date. The
24-hour allowance protects against ordinary clock drift. Do not clamp a corrupt date to
`now()`, because that would still make the file look newly modified and hide the fault.

## 72. Asset Licensor and Property Never Come From Folder Position (fixed 2026-08-10)


**Files**: `supabase/functions/_shared/metadata-derivation.ts`,
`licensing-resolution.ts`, `sku-parser.ts`, `agent-api/index.ts`,
`admin-handlers/metadata-handlers.ts`, and the bridge scan counters.

**Looks like**: a licensed asset under
`Decor/Character Licensed/[Licensor]/[Property]/...` can safely inherit its
licensor and property from those two folder names.

**Actually**: that layout is obsolete. Production evidence showed 117,576 of
117,969 licensed assets under `____New Structure`, 9,973 licensor-ID/code
disagreements, and 73,476 licensed assets without a property. Folder position
is not licensing evidence and is never a fallback.

**The fixed contract**:

- Path metadata derives only `is_licensed` and `workflow_status`.
- Per-item licensor/property codes come from the ColdLion-backed
  `erp_items_current` mirror, not characters sliced from the filename.
- ColdLion source keys include company, division, MG type, and code. MG05/MG06
  are never treated as global code maps.
- Canonical IDs come through exact `core.taxonomy_source_ref` rows. A property
  is accepted only when `core.property.licensor_id` matches the resolved
  licensor.
- Missing authoritative data writes null. The bridge counts missing licensors
  and properties, marks the scan `completed_with_errors`, and shows the totals
  in Settings. Source/query failures throw and stop writes instead of looking
  like ordinary missing data.

**Do not change because**: adding path or fuzzy-name fallback recreates silent
compliance errors. Do not merge ColdLion codes across divisions, and do not
turn missing taxonomy into a best guess. Existing production data was not bulk
repaired by this change; that owner-gated cleanup remains sequenced in canonical
`u2giants/shared-db`.

**Release evidence**: PopDAM commit `9e0ec1d`; CI, edge-function deploy, bridge
image, frontend image, and both guards passed. `dam.designflow.app` and
`sg.designflow.app` served HTTP 200 with frontend build `9e0ec1d`.

---

## 73. Radix `ScrollArea` Sizes Its Content to `max-content` — It Pushed Filter Dropdowns Off-Screen (fixed 2026-08-17)


**File**: `src/components/library/FilterSidebar.tsx`.

**Looks like**: `<ScrollArea>` is a drop-in scroll container, so a fixed-width
panel can wrap its contents in one and rely on `text-overflow: ellipsis` to
keep long labels inside.

**Actually**: Radix wraps the viewport's children in a `display: table` box with
`min-width: 100%`. A table box is sized by its content's **max-content** width,
so a single `white-space: nowrap` label (a long licensor name, or the
"No preview — AI not PDF compatible" file-status row) made the sidebar's scroll
content 267px wide inside a 214px panel. `min-width: 0` on the flex text cells
does not help: table sizing ignores the child's ability to shrink.

**The visible bug**: opening a filter dropdown autofocused its search input,
the browser scrolled that hidden 53px of horizontal overflow into view, and the
whole dropdown slid past the **left** edge of the screen (measured left edge
`-21px`), showing only part of each value.

**The fix**: the sidebar and its dropdown lists use plain
`overflow-y: auto; overflow-x: hidden` scrollers instead of Radix `ScrollArea`.
That also restored the dropdown list's `max-height: 200px`, which `ScrollArea`
had been silently ignoring (the class landed on the Root, not the Viewport).

**Rule of thumb**: do not use Radix `ScrollArea` inside a fixed-width panel
whose children must truncate. Use a plain scroller. If you must use
`ScrollArea`, force the inner wrapper's width and verify with
`viewport.scrollWidth === viewport.clientWidth` in the browser, not by eye.

**Related**: the same panel now supports drag-to-resize (180-520px, persisted
in `localStorage` under `library-filter-sidebar-width`, double-click resets),
and values carry a tooltip only while they are actually cut off, measured live
from `scrollWidth > clientWidth`. Regression coverage:
`src/test/filter-sidebar-resize-tooltip.test.tsx`.

**Release evidence**: PopDAM commits `9fc434ea` (overflow fix) and `23f1c480`
(resize + tooltips); CI, both DB guards, and the frontend image build passed on
each.

---

## 74. OpenRouter Batch Jobs Must Resume by Saved ID (fixed 2026-08-20)


**Looks like**: Railway can simply repeat an image-tagging page after a deploy
because each result uses a stable asset ID.

**Actually**: OpenRouter may already be processing and billing the first job.
Repeating the page creates a second paid job. The worker therefore saves the
provider batch ID, page boundary, and result mapping before yielding. After a
restart it checks that same ID and advances the PopDAM cursor only after every
result is reconciled.

**Operator view**: Settings shows `Waiting for OpenRouter batch <short ID>` and
the last check time. Pending is normal. `ambiguous_submission` means a submission
lease expired before a provider ID was safely saved; do not restart or declare
that phase manually. Reconcile the provider job first. Stop prevents PopDAM from
checking or applying further results, but cannot cancel accepted provider work.

**Do not change because**: submitting from `ok = true`, dropping the saved job,
or treating `ambiguous_submission` as proof can create duplicate charges or
apply results to the wrong page. Only `lease_receipt_issued = true` with its
receipt authorizes submission. OpenRouter retains batch inputs and outputs for
30 days and is checked no faster than every 10 seconds.

---

## 75. Signed-in Requests Die at 8 Seconds — Never Ask for Rows and an Exact Count Together (fixed 2026-08-26)


**Looks like**: the `/orders` grid loads fine in local development against the
same production database, then fails on the live site with
`canceling statement due to statement timeout` and shows no rows at all.

**Actually**: the `authenticated` Postgres role carries
`statement_timeout = 8s` (`anon` gets 3s). PostgREST computes an exact count in
the **same statement** that returns the rows, so one `select(..., { count:
"exact" })` pays for both. Returning 100 rows from `api.dam_order_list` costs
~50 ms; counting all 24,486 exactly costs seconds as `authenticated`. Combined,
one request sat close enough to the 8 s ceiling that a cold cache or a busy
moment tipped it over — and the entire screen died over one number.

**Correction, 2026-08-27 (issue #100): the count is not slow because of RLS.**
This quirk originally blamed the security-invoker view re-checking every row
against RLS. Re-measured on production as `authenticated`, that is wrong — every
policy on the joined tables is `using (true)` and folds away, and a warm count is
161 ms. The real cost is **cold-cache sequential IO**: 24,835 shared buffers
(~194 MB) per count, 16,943 of them a full scan of `plm.style_tracker_item_bridge`
(132 MB of heap for ~24 MB of live data), because that table has no index on
`plm_item_id` — the column `api.dam_order_list` joins it on — and the join cannot
be pruned, since the bridge genuinely fans out. Fixed in `u2giants/shared-db`
issue #1657 by adding that index plus a count-covering index on
`plm.production_order_line`.

**Resolved. Verified in production 2026-08-30**, after shared-db #1657 and
#1722 both merged:

| | before | after |
|---|---|---|
| cold `count(*)` | 3,365 ms | **107 ms** |
| warm `count(*)` | 161 ms | **52-76 ms** |
| cold buffer reads | 24,835 (194 MB) | **969 (~8 MB)** |

Both big tables are now Index Only Scans; the bridge reports `Heap Fetches: 0`.
The exact total is ~1.5% of the 8 s ceiling instead of 42% of it.

Two things worth carrying forward. **Fewer buffers is not automatically faster**
— the intermediate state after #1657 alone read 5x fewer buffers yet measured
*slower* cold (1,481 ms), because a plain index scan turned a prefetched
sequential scan into 3,910 random reads into a bloated heap. Only the covering
index, which removed the heap visits entirely, converted the buffer saving into
a time saving.

**Correction, 2026-08-30:** this entry briefly claimed
`plm.style_tracker_item_bridge` was ~5x bloated and that autovacuum could not
reclaim it. That was read off a single `n_dead_tup = 0` sample taken before
autovacuum had run. It ran on 2026-08-29 and took the heap from 132 MB to
**53 MB** against ~25 MB of live data — about 2.1x, which is ordinary. No
repack is needed. The durable point is the one that survived: these tables do
**0% HOT updates** (`fillfactor` is the default 100), so every update rewrites
every index entry, which is what inflates them in the first place. Tracked in
shared-db #1966, not urgent, and it no longer affects `/orders`.

**Measure this class of problem with `explain (analyze, buffers)` and read the
buffer counts; "it must be RLS" cost a
day here.**

**Operator view**: before the 2026-09-11 fix, the grid could show the timeout
while summary counts were also running. That concurrency was the tell.

**Do not change because**: visible blocks make no exact-count request
(`src/hooks/useOrderList.ts`). Summary counts wait until rows render and run
sequentially. Putting a count beside the row request, even as a separate HTTP
call, reintroduces production contention. The same trap applies to any large
view in this app: measure the count separately as the `authenticated` role, not
as `postgres`, which has no such timeout.

---

## 76. A Lenient Parser Turns "I Can't Read This" Into "The User Cleared It" (fixed 2026-08-26)


**Looks like**: a staff member types something wrong into an OrderList date or
number cell, the toast says **"Order saved"**, and the value that was there is
now gone. No error, no rollback, nothing in the logs to suggest a problem.

**Actually**: `parseOrderDate` and `parseOrderNumber` in `src/lib/order-list.ts`
return `null` for anything they cannot parse — and `null` is also exactly how
"the user cleared this field" is expressed. `coerceFieldValue` handed that `null`
to `update_dam_order`, which dutifully wrote a deliberate-looking erasure. The
save genuinely succeeded, so every honesty mechanism in the page (the failure
toast, the visible rollback) correctly stayed quiet. Reproduced end to end
against production during the 2026-08-26 human pass: a real date was set, then
`not-a-date` was typed over it, and the date was gone after a reload.

**Operator view**: the only symptom is missing data noticed later. There is no
error to search for, which is what makes this class of bug expensive.

**Do not change because**: `coerceFieldValueStrict` now refuses non-empty input
it cannot parse, naming the column in the message, and the grid turns the refusal
into a toast and rolls the cell back without sending a request. Clearing a cell
to empty still writes `null`, because that is a real edit and must keep working.
Any new OrderList write path must use `coerceFieldValueStrict`, never the lenient
`coerceFieldValue`. The general rule: **a parser that returns the same value for
"empty" and "unreadable" must never feed a write.**

---

## 77. A Field the Grid Needs but Never Displays Is Not Fetched (fixed 2026-08-26)


**Looks like**: voiding an order reports success and the database really does
record the void, but the row keeps rendering as a live order and reopening it
offers **Void** again instead of **Restore**. The feature looks half-built when
the write side is entirely correct.

**Actually**: `ORDER_LIST_SELECT` in `src/hooks/useOrderList.ts` is built from
the GRID's column list plus a handful of named extras, to keep each block small
(the full view is ~2.2 KB per row). `order_voided_at` drives row styling and the
editor's Void/Restore choice but is not a displayed column, so it was never
requested — `getRowStyle` and `isVoided` were reading `undefined` on every row.

**Operator view**: a voided order is indistinguishable from a live one in the
grid. Since `api.dam_order_list` deliberately does **not** filter voided rows
out, that is a business-data hazard, not a cosmetic one.

**Do not change because**: both void columns are now named explicitly in the
select list and a test asserts they stay there. More generally, anything the grid
*reasons about* has to be in that list, not just what it *shows* — and component
tests will not catch the omission, because they hand the grid a row object that
already carries every field.

## 79. Replacing an ID-less Ambiguous Meta Request Must Be Explicit (fixed 2026-10-15)


**Looks like**: A new explicit-list Meta tagging operation stays at zero progress even though it has its own operation key.

**Actually**: The worker reserves the Meta response slot across all operations while any request may still be active. An interrupted `ambiguous_submission` without a saved provider ID keeps that reservation. Stopping it does not prove the provider rejected it or cancel work already accepted by Meta.

**Operator view**: The normal behavior remains blocked. The exception is limited to the explicitly running `ai-tag-all` replacement with a unique run ID and a non-empty, unique list of UUID asset IDs. Its marker names both the old operation and the replacement run. While the marker matches, the freed capacity stays reserved for that replacement alone. If any provider ID value exists in the old row, worker memory, or a durable receipt, or the old submission is still in progress in the worker, supersession is refused and the worker remains blocked.

**Do not change because**: The durable replacement marker `params.meta_reservation_supersedes = { op_key, run_id, state_revision, interruption_reason_code, replacement_run_id }` is an explicit operator decision to let a new request proceed while the old request may still finish and incur duplicate cost. The worker only honors it while every named field still matches, the old run remains interrupted for a non-transient reason with no auto-resume time, it has no provider ID value in storage or worker memory and no submission still in progress, and the replacement is the matching, uniquely identified, running `ai-tag-all` operation with a non-empty list of unique UUID asset IDs. The freed capacity stays reserved for the replacement alone and returns to the old ambiguous operation when the marker stops matching. This does not change, clear, recover, or cancel the old operation. Never add this marker without the owner's recorded direction; never use it to supersede an operation with a saved provider ID. This logic does not modify the provider key or model; the run plan must verify the existing key and exact configured model before dispatch.

## 80. ColdLion Prepack Lines Carry Several Items on One Order Line (found 2026-10-26)


**Symptom:** Orders received 2026-10-23 (62012010, 62011865, 62012009,
62012011, 62012012, 62012008, 62011483) showed only 1–2 of their 4 SKUs in
OrderList.

**Cause:** A prepack is one ERP sales-order line that holds several distinct
items (e.g. 62012010 line 1 = BRG62SESR01, BRG62SESR02, BRG62NBSF01,
BRG62NBSF02). ColdLion sends every item, and all reach the ColdLion order
intake staging table. The promotion into OrderList treated rows sharing an
order + line number as successive versions of one row and kept only one, so
the other items were discarded (9 lines affected).

**Rule:** An ERP order line number is not unique per item. Identify a line by
order + line + item, and give each prepack item its own position. Never
dedupe staging rows by order + line alone.

**Fix:** shared-db promotion change plus a re-run of promotion for the
affected orders (tracked in `popcre/shared-db`). Re-running corrects existing
rows in place and adds the missing items.
