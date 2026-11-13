---
summary: Shorten NAS folder names and make restore-from-snapshot follow renames (#963); phases 1-4 landed, snapshot restore remains; read STATUS first.
kind: plan
status: open
read-when: continuing NAS folder shortening (#963)
---

# Plan — Shorten NAS folder names, and restore-from-snapshot that follows renames

Tracking issue: [u2giants/popdam3#963](https://github.com/u2giants/popdam3/issues/963)
Handoff for this plan: [HANDOFF.d/2026-11-11T1846Z-hetz-claude-folder-shortening-snapshot-restore.md](HANDOFF.d/2026-11-11T1846Z-hetz-claude-folder-shortening-snapshot-restore.md)
Written 2026-11-11 (New York time) by Claude on `hetz`, from a brainstorm with Albert Hazan (owner).

## STATUS — read this first

Phases 0–3 are done (restore from snapshot is live, admin only; PopDAM reads both old and short folder names). Next: Phase 4. Nothing on the NAS has been renamed.

| Step | State | Date | Evidence |
|---|---|---|---|
| Phase 0 — measure and verify assumptions (0.1–0.7) | ✅ done (0.3 in-container check deferred to 2.7) | 2026-11-11 | `verification/folder-shortening/path-length-baseline-2026-11-11.md` |
| Phase 1 — permanent rename record (1.1–1.4) | ✅ done | 2026-11-11 | popcre/shared-db#6078 (prod apply ~6:55 PM EST) + fixes #6097/#6102 (prod apply ~7:30 PM EST); purge now 400 days (~8k rows/month → ~100k rows, ~85 MB); docs `docs/PATH_ATTRIBUTES.md` §8, `docs/SCHEMA.md` 2.7a; types regenerate via the deploy-supabase job |
| Phase 2 — restore from snapshot (2.1–2.7) | ✅ done (2.3 fallback not built: candidates cover moves + renames) | 2026-11-11 | PR #971 (`baa75e2`); live proof `verification/folder-shortening/snapshot-restore-live-proof-2026-11-11.md` (0.3 in-container check also proven; scan ingested the restored copy as new asset 100fc69a on 2026-11-13) |
| Phase 3 — PopDAM understands old and new names (3.1–3.5) | ✅ done | 2026-11-11 | popcre/shared-db#6079, #6105, #6106 (prod apply verified); PRs #967, #972, #981, #982; live proof 2026-11-11 11:05 PM EST (reads `In Dev`, `Cust Adopted`, `Concept_Approved`, year folders) |
| Phase 4 — rename rules and full old-to-new list (4.1–4.5) | ✅ frozen: Albert's 21 customer short names (`customer-short-names_from_albert.csv`) in `rules.json`; owner-chosen names may be under 3 characters (VW); re-listed edgesynology2 2026-11-13: 4,157 renames, 43,985→6,097 over-limit, 3 needs-attention; a year shown by any higher folder is dropped (also FH2026→FH), dates kept; full customer names inside any folder name also become the short name (owner 2026-11-13: one spelling everywhere) | 2026-11-13 | `tools/folder-rename/` (`node --test tools/folder-rename/plan.test.mjs`), `verification/folder-shortening/summary.md`, `old-to-new.csv`, `needs-attention.csv` |
| Phase 5 — carry out the renames in stages (5.1–5.7) | ⬜ open | — | — |
| Phase 6 — guard against new long names (6.1–6.2) | ✅ built: live on-demand check (Settings → File Health → Folder Names), not nightly; same rule engine as the planner | 2026-11-13 | `supabase/functions/_shared/folder-rules/` (`node --test tools/folder-rename/`), `src/components/settings/FolderGuardTab.tsx` (checks in the admin's browser; the edge function's compute cap was too small for ~174k paths) |

Rule for this table: a row marked done cites something a reader can open (file path, commit SHA, CI run id, or exact command). Whoever executes a step updates this table in the same pull request.

Context cut points: end of Phase 0, end of Phase 2, end of Phase 4. At each cut, write a handoff (skill `handoff-writer`), start a fresh session (skill `fresh-session`), and **re-read every later phase before starting it** — Phase 0 findings are expected to change details downstream.

---

# Part 1 — Why

## 1. The ultimate goal

Designers at POP Creations work on Windows. The shared design drive has folder names that have grown long for no reason, and **some Windows programs cannot open files because the full location is too long**. Albert wants the folders shortened so every file opens, without doing thousands of renames by hand, without breaking anything that depends on the folder layout, and **without losing the ability to find and restore an older copy of a file from before the rename**.

When this is done:

1. Every file under the design tree has a full location short enough for Windows programs (target defined in §8, D6).
2. Albert can open any file in PopDAM, see the dates on which an older copy exists in the drive's snapshots, and restore one beside the current file — even when the folder was renamed in between.
3. PopDAM's Stage / Customer / Program filters and search return the same files as before.
4. No tags, AI metadata, thumbnails, or style-group links were lost.

**If a step in this plan conflicts with this goal, the goal wins — stop and flag it on issue #963.**

Albert's three constraints, in his words (2026-11-11):

> a) i can't change thousands of directories by hand
> b) i don't want to break any ups (including popdam agents) that utilize the directory structure
> c) i don't want to break connections between the files as they would exist after a mass change and how they appear in snapshots and backups.

His stated worry about restores: "If i look for a file that i want to restore from 6 months ago, it won't find it". His requirement: "i want that function to be able to see snapshots of that file on the server and be able to restore".

## 2. What this application is

**PopDAM** is POP Creations' digital asset manager: a web app (https://dam.designflow.app) that indexes the design files stored on the company's Synology NAS, shows thumbnails, tags them with AI, groups them by SKU ("style groups"), and lets designers search and filter. A sister app, **PopSG** (https://sg.designflow.app), covers licensor style guides from a different share and is not touched by this plan.

- Repo: `u2giants/popdam3` (this repo). Git remote is named `github`, not `origin`. Protected `main`; work on a branch and open a pull request.
- Frontend: React + Vite in `src/`, deployed as a container via Coolify.
- Server: Supabase project `qsllyeztdwjgirsysgai` (Postgres + edge functions in `supabase/functions/`). The two that matter here: `admin-api` (browser → server, admin-only actions) and `agent-api` (NAS helper → server).
- **Bridge agent** (`apps/bridge-agent/`, called "the helper" when talking to Albert): a Node container running on the NAS `edgesynology1`. It scans the drive, makes thumbnails, and verifies check-ins. Image `ghcr.io/u2giants/popdam-bridge:stable`, published by `.github/workflows/publish-bridge-agent.yml`. Compose reference: `deploy/synology/docker-compose.yml`.
- Database structure is owned by a separate repo, `popcre/shared-db` (mirrored read-only into `shared-db/` here). **Never add a migration under this repo's `supabase/migrations/`.**
- Read `AGENTS.md` first; it routes to everything else.

The NAS:

- Two Synology units, `edgesynology1` and `edgesynology2`. **Write on edge1, read on edge2.** Sync is one-way: edge2 pulls from edge1 (Synology ShareSync). A write to edge2 is lost. See `AGENTS.md` → "NAS topology".
- The design share is `mac`, at `/volume1/mac` on the NAS, filesystem btrfs. Windows users see it as `\\edgesynology1\mac\...` or via Synology Drive at `{their sync root}\mac\...` (see `docs/PATH_UTILS.md` §3).
- The tree this plan concerns: `/volume1/mac/Decor/Character Licensed/____New Structure/` (four leading underscores). Its children are the lifecycle stages: `In Development`, `Concept Approved Designs`, `Product Ideas`, `Freelancer art`, `Discontinued`.
- Under `In Development/Customer Adopted/` there are 37 customer folders (`Ross`, `Dollar General`, `Desperate Signs`, …) plus bucket folders starting with `_` (`_FINISHED`, `_NOT APPROVED`, `_NOT SUBMITTED`, `_No Customer`, `_REJECTED`). Under a customer there are year folders (`2025`…`2028`) and/or program folders, then SKU folders (e.g. `PQE8QMVAV01`), then files.

## 3. What triggered this work

Albert's request on 2026-11-11, with two examples:

- `/mac/Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Dollar General/2027/Dollar General POP 4PKCanvas Set 2027`
- `\mac\Decor\Character Licensed\____New Structure\In Development\Customer Adopted\Desperate Signs\Shane Desperate Signs SS24\PQE8QMVAV01`

His three complaints:

1. Customer names repeated in subfolders (`Dollar General/2027/Dollar General POP …`).
2. Useless additions to customer names — the customer is "Desperate"; the folders say "Desperate Signs" and "Shane Desperate Signs".
3. Easy abbreviations not used — `In Dev` instead of `In Development`, `Cust Adopted` instead of `Customer Adopted`.

The practical pain: designers (on **Windows**, confirmed by Albert) complained that "something couldn't open some of the files". Albert does not remember which program. The working assumption is the classic Windows 260-character full-path limit; Phase 0 measures whether that fits the facts.

## 4. Scope

**In scope**

- An admin-only restore-from-snapshot feature in PopDAM that follows folder renames and individual file moves.
- A permanent, queryable record of folder renames.
- Making PopDAM's path-derived Stage / Customer / Program logic accept both old and new folder names.
- A rule-driven tool that produces the full old-to-new folder list and then executes it in stages on edge1.
- Updating PopDAM's stored paths to match, without losing metadata.
- A recurring check that flags new folders breaking the naming rules or files over the length limit.

**NOT in this plan**

- Renaming files. Only folders are renamed. (This is what keeps a file findable by name in any old snapshot.)
- Renaming `Decor`, `Character Licensed`, or `____New Structure`. Albert did not ask for it; `____New Structure` is a hard-coded anchor in the database function. Phase 0 reports how many characters it would save so Albert can decide later.
- Anything outside `Decor/Character Licensed/____New Structure`.
- Restoring from Hyper Backup archives through PopDAM. The feature reads **snapshots** only. Backups are covered by the rename record (a person can translate a path), not by a button.
- Restoring whole folders. One file at a time.
- Giving designers the restore feature. Admin only.
- Having PopDAM create new program folders. Discussed as an idea only; Phase 6 is a check, not a folder-creation feature.
- The PopSG share (`/volume1/styleguides`).
- Changing how long snapshots are kept.

---

# Part 2 — What we already know

## 5. Current state of the code and the drive

Nothing for this plan is built. All references below are to `main` at commit `288478ba` plus the 2026-11-11 fast-forward.

**How PopDAM reads folder names today**

- `public.infer_path_attrs(p_path text) returns jsonb` derives `stage`, `customer`, `program` from a path. Definition as mirrored: `shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql:5182-5242` (an older identical-looking copy at `:3274`). Original app migration: `supabase/migrations/20260608110025_add_path_attrs_customer_program_stage.sql`. Explained in `docs/PATH_ATTRIBUTES.md`.
  - It finds the segment `____New Structure`; `stage` = the next segment, verbatim.
  - Only when `stage = 'In Development'` **and** the next segment `= 'Customer Adopted'` (exact, case-sensitive string compares) does it set `customer` = next segment and `program` = the one after.
- Triggers `trg_set_path_attrs` on `assets` (on `relative_path`) and `style_groups` (on `folder_path`) call it on insert/update (`010_pre_adoption_baseline.sql:6186`, `:4292`).
- `workflow_status` is a second, separate derivation done in the edge function: `supabase/functions/_shared/metadata-derivation.ts:16-25` holds `DEFAULT_WORKFLOW_FOLDER_MAP` with lower-cased folder names (`"in development"`, `"customer adopted"`, …); it can be overridden by the `admin_config` row `WORKFLOW_FOLDER_MAP` (`metadata-derivation.ts:72-74`).
- The Stage filter's options are a hard-coded list of folder names: `src/types/assets.ts:38-44` (`STAGE_OPTIONS`).
- A comment-level mention in `apps/worker/src/handlers/popsg-tags.ts:419`.
- Canonical stored path format: `assets.relative_path`, POSIX, relative to the share root, e.g. `Decor/Character Licensed/____New Structure/In Development/…` (`docs/PATH_UTILS.md` §1).

**How PopDAM follows a moved file today**

- On ingest, `agent-api` looks for an existing asset with the same `quick_hash` **and** filename at a different path, and only treats it as a move if there is **exactly one** candidate: `supabase/functions/agent-api/index.ts:1119-1131`. It then updates `relative_path` and writes a history row (`:1173-1177`).
- `quick_hash` is a *sampled* hash (first 64 KB + last 64 KB + size) — distinct files can collide, and identical copies are common (`index.ts:1099-1117`).
- History table as the app uses it: `public.asset_path_history (id, asset_id, old_relative_path, new_relative_path, detected_at)` — `supabase/migrations/20260220125350_1b4ac457-e648-499a-a8e7-a6f6e01eb542.sql:123-129`. Other writers: stale-asset retirement (`index.ts:1398`) and the explicit `move-asset` action (`handleMoveAsset`, `index.ts:1464`, insert at `:1508`).
- **History is deleted after 90 days** by cron job `purge-asset-path-history-old-rows` (`supabase/migrations/20260506110948_queue_and_history_retention_crons.sql:24-33`). The table once reached ~4.7M rows (`supabase/migrations/20260619131239_…sql:1`).
- The shared-db mirror also shows a differently shaped `dam.asset_path_history (old_path, new_path, changed_at, source_system, metadata)` at `shared-db/supabase/migrations/20260621151024_domain_tables.sql:289-297`. **Which object is live, and whether `public.asset_path_history` is now a view over it, is unverified — step 0.2.**
- The only reader in the UI: `src/components/library/AssetDetailPanel.tsx:240-253` (last 10 moves).

**How an admin asks the helper to do something today (the pattern to reuse)**

- Browser calls `admin-api` action `request-dir-browse` (`supabase/functions/admin-api/index.ts:2073-2076`) → `handleRequestDirBrowse` writes an `admin_config` row `DIR_BROWSE_REQUEST` with `status: "pending"` (`supabase/functions/_shared/admin-handlers/dir-browse-handlers.ts:5-25`).
- The helper's next heartbeat response carries the pending request (`supabase/functions/agent-api/index.ts:534-556`; key allow-list at `:210-211`).
- The helper handles it (`apps/bridge-agent/src/handlers/path-tools.ts:55`, wired in `apps/bridge-agent/src/index.ts:40,331`) and posts back with action `report-dir-browse` (`agent-api/index.ts:2110`, routed at `:5008`), which writes `DIR_BROWSE_RESULT`.
- Browser polls `get-dir-browse-result`.
- This is a **single-slot** mechanism (one request at a time per key). Acceptable for an admin-only, one-user feature.

**Safety helpers that already exist**

- `packages/agent-common/src/path-containment.ts` — `assertSafeRelativePath` rejects empty, NUL, absolute, drive-letter, UNC, and `..` paths, then re-checks the resolved path against the root. Use it for every server-supplied path.
- `apps/bridge-agent/src/handlers/path-tools.ts:76` — `isInsideAllowedRoots`.
- `#snapshot`, `#snapshots`, `#recycle`, `@eaDir` are excluded from scanning: `packages/path-filters/index.ts:24-26`, `packages/agent-common/src/ingestion-rules.ts:35-37`, `supabase/functions/_shared/ingestion-rules.ts:35-37`. **These exclusions must stay** — the snapshot feature reads `#snapshot` through its own narrow code path, never by loosening the scanner.

**The drive, observed read-only over SSH on 2026-11-11 (about 1:00–1:50 PM New York time)**

- `/volume1/mac` is btrfs, 57% used.
- `/volume1/mac/#snapshot/` is visible as an ordinary directory and holds 55 snapshots named like `GMT-04-2026.05.29-18.15.01`. Oldest: 2026-05-29. Spacing: one each for May, June, July; 3 in August; 5 in September; 17 in October; 8 so far in November.
- The oldest snapshot contains `…/____New Structure/In Development/Customer Adopted/Desperate Signs` — i.e. old snapshots keep old folder names, as expected.
- The helper mounts the **whole** share read-write: `/volume1/mac:/mnt/nas/mac` (`deploy/synology/docker-compose.yml:29`). So `/mnt/nas/mac/#snapshot` should be visible inside the container. **Confirmed from the compose file and from the host, not yet from inside the running container — step 0.3.**
- Synology packages present on edge1: `HyperBackup` and `SnapshotReplication` (seen under `/volume1/@appdata`). Their task configuration has not been read — step 0.5.
- Under `In Development/Customer Adopted`, folders at depth 2–3 (year/program level): 1,537. Of those, **228 contain their own customer's name** (case-insensitive substring). Examples under `Ross/2026/`: `Ross Wall 2026`, `Ross Coir 2026`, `Ross - Valentines Day MDF Block 26`, `RossHalloween Wall Tabletop Porchleaner`. Note the year is *also* repeated (`Ross/2026/Ross Wall 2026`).
- `Desperate Signs/` contains `2025`, `2026`, `2027`, `2028`, `Shane Desperate Signs SS24`.

## 6. Key findings

1. **Renaming folders does not destroy history.** A btrfs snapshot is frozen; every snapshot taken before a rename still holds the file at its old path. The only thing lost is *discoverability*: Synology's built-in "browse previous versions" on a renamed folder only reaches back to rename day, because it looks for the same path in each snapshot. Fix = translate the path, which needs a rename record.
2. **File names do not change**, so a file is always findable in an old snapshot by name. The rename record makes it exact and fast instead of a search.
3. **The existing move history cannot serve as the rename record.** It is per-asset (millions of rows for a mass rename — this table already hit 4.7M rows and had to be pruned) and is purged after 90 days, while snapshots go back about 5.5 months. A folder-level record is thousands of rows and can be kept forever.
4. **The 90-day purge also hurts the restore feature for ordinary moves.** A file that a designer moved 4 months ago cannot be traced to its older location today. Step 1.3 addresses this.
5. **A full rescan is NOT a safe way to update PopDAM after a mass rename.** Albert's instinct was "popdam is easy, it'll all be updated once a full scan completes". But move detection requires exactly one asset with the same sampled hash and filename (`agent-api/index.ts:1119-1131`). Duplicate copies and hash collisions fall through, get ingested as **new** assets, and the old rows are later retired — losing their tags, AI metadata, and style-group links. PopDAM's stored paths must therefore be rewritten directly, folder by folder, in step with the renames (D4).
6. **The Stage/Customer/Program rule uses exact string compares**, so renaming `In Development` or `Customer Adopted` today would silently blank `customer` and `program` on every file under them and change the `stage` value, emptying the Stage filter. PopDAM must be taught both spellings and deployed **before** any rename (Phase 3).
7. **Possible existing bug to check first:** many customers now have a year folder (`Ross/2026/Ross Wall 2026`). By the mirrored function, `program` would be `2026` for those, not `Ross Wall 2026`. Either the live function is newer than the mirror, or programs are already wrong for year-foldered customers. Step 0.2 settles it; Phase 3 fixes it either way.
8. **Path-length arithmetic.** Windows' classic limit is 260 characters including the terminator, so 259 usable. The prefix a designer adds in front of `relative_path` is `\\edgesynology1\mac\` (19) by network path, or about 35–50 via Synology Drive (`C:\Users\<name>\SynologyDrive\mac\`). Fixed overhead inside the tree: `Decor/Character Licensed/____New Structure/In Development/Customer Adopted/` is 76 characters; with `In Dev/Cust Adopted` it is 64 (saves 12 on every file). The larger savings come from program folders that repeat the customer and year, and from the same repetition in deeper subfolders.
9. **Windows-only complaints fit the path-limit theory** (Macs have no such limit). Unproven until step 0.1 shows files actually over the limit.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Hide the clutter only in PopDAM (show short names, leave the drive alone) | Albert: "the pain is the long folders on the drive itself and some applications not being able to read the whole thing". Display-only does nothing for a Windows program opening a file. |
| Keep the old-to-new list as a spreadsheet / document | Albert asked whether it "exists in the system" or is "paperwork that has to be handled manually". Paperwork gets lost and cannot drive an automatic restore. It lives in the database. |
| Leave old names behind as shortcuts (symlinks) so nothing breaks | Symlinks behave inconsistently over Windows file sharing and Synology Drive, would be scanned as clutter, and leave the long names visible — the thing being removed. Not pursued. |
| Let a full PopDAM rescan pick up the renames | Finding 5: duplicates and hash collisions become new assets and lose metadata; and it would write millions of history rows. |
| Use `asset_path_history` as the rename record | Finding 3: wrong grain, purged at 90 days. |
| A "restore" button for designers | Albert: only he restores files. Admin-only. |
| Restore over the current file | Albert chose "restore beside the current file" (2026-11-11). |
| Rename everything in one night | No way to observe ShareSync, backup, and Synology Drive behaviour before committing. Staged with a pilot instead (Phase 5). |
| Enable Windows long-path support on every designer PC | Many programs still ignore that setting (the complaint is about programs, not Windows itself), and it leaves the clutter. Not a substitute; may be noted as a side remedy in Phase 0's report. |
| Search each snapshot for the file by name instead of keeping a record | Walking 55 snapshots of a multi-terabyte share per request is far too slow and ambiguous for duplicate filenames. Kept only as an optional, bounded fallback (step 2.3). |

Nothing has been tried and failed — no code was written and no folder was renamed.

## 8. Design decisions

**Locked (do not relitigate):**

- **D1 — Restore places the old copy beside the current file, never over it.** Albert, 2026-11-11: "restore beside the current file".
- **D2 — Admin only.** Albert, 2026-11-11: "only me."
- **D3 — Folders are renamed; files never are.** Planner decision 2026-11-11, basis of the snapshot story Albert accepted.
- **D4 — PopDAM's stored paths are rewritten directly, prefix by prefix, in the same operation that renames each folder; the rescan is not relied on.** Planner decision 2026-11-11, from finding 5. Reopen only with evidence that move detection is safe for duplicates.
- **D5 — The rename record is a permanent database table, folder-level, never purged.** Planner decision 2026-11-11, from Albert's "exists in the system?" question.
- **D6 — Abbreviations Albert named:** `In Development` → `In Dev`, `Customer Adopted` → `Cust Adopted`. Customer `Desperate Signs` → `Desperate`. Customer names are removed from the names of folders beneath that customer.
- **D7 — PopDAM learns both spellings and is deployed before any folder is renamed.** Planner decision 2026-11-11, from finding 6.
- **D8 — Database values stay canonical.** After the rename, `stage` is still stored and shown as `In Development` (not `In Dev`), so filters, saved searches, and existing rows do not change. The folder name is an input; the stored value is the business term.

**Open (implementer's judgment, with criteria):**

- **O1 — The length target.** Proposed: `relative_path` (including file name) ≤ 200 characters, leaving 59 for the Windows prefix. Decide after step 0.1 shows the real distribution and step 0.6 shows which prefix designers use. Criterion: every file opens via the longest prefix actually in use.
- **O2 — Whether to also strip the repeated year** (`Ross/2026/Ross Wall 2026` → `Ross/2026/Wall`). Same kind of duplication Albert described but he did not name it. Include it as a *proposed* rule in the Phase 4 list for his yes/no; do not apply without it.
- **O3 — Canonical short customer names.** Take them from the customer master data in the shared database where a customer exists there (step 4.1); only the leftovers go to Albert.
- **O4 — How long per-file move history is kept** once the purge is changed (step 1.3). Criterion: at least as long as the oldest snapshot retained (step 0.5), with measured row growth acceptable.
- **O5 — What the program value should be after renaming** (`Wall` vs `Ross Wall 2026`). Criterion: a PopDAM search for `Ross Wall 2026` must return the same files before and after (step 3.4 gate). If the short value breaks that, derive a display program of `<customer> <program> <year>` in the function rather than keeping long folder names.

---

# Part 3 — How to build it

## 9. The plan

Before any edit: `ai-task-gates start --class <class>` for the work at hand (`code` for app code, `shared-db` for structure, `production` before NAS writes), and recheck before a stronger gate. Each write-capable task uses its own git worktree. Post progress as comments on issue #963, signed with `$AI_GH_SIGNATURE`.

### Phase 0 — Measure and verify (read-only; no approvals needed)

**0.1 Measure path lengths.**
Count assets under `Decor/Character Licensed/____New Structure/` by `length(relative_path)` in buckets (≤180, 181–200, 201–220, 221–240, >240), plus the 50 longest. Query the database in id-range batches of about 20,000 rows — a single full-table statement has timed out on this project before, and the first call after idle is slow. Save the result to `verification/folder-shortening/path-length-baseline-<date>.md`.
*Worked when:* the file exists with bucket counts and the longest examples, and states how many files exceed 240 and 200.
*If zero files are near the limit:* stop and tell Albert on #963 — the Windows-limit theory is wrong and the cause of "couldn't open" must be found before renaming anything.

**0.2 Verify the live path function and history table.**
Run `select pg_get_functiondef('public.infer_path_attrs(text)'::regprocedure)` and compare with `shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql:5182`. Check `select customer, program, count(*) from assets where relative_path like '%/Customer Adopted/Ross/2026/%' group by 1,2` to see whether `program` is `2026` (finding 7). Determine whether `public.asset_path_history` is a table or a view and which columns are live; confirm cron job `purge-asset-path-history-old-rows` still exists (`select * from cron.job where jobname like 'purge-asset-path%'`).
*Worked when:* the baseline file records the live function text hash, the answer to finding 7, the real shape of the history object, and the purge job's schedule.

**0.3 Confirm the helper container sees snapshots.**
On edge1, inside the running bridge container: `ls /mnt/nas/mac/#snapshot | head`. Container commands need docker sudo for user `ai` on the NAS; the standing ritual is to enable it at the start of a block of container work and revoke it at the end (do not leave it on).
*Worked when:* the listing shows `GMT-…` names. If not visible, record why (mount option or Synology "make snapshot visible" setting) — do not change NAS settings in Phase 0.

**0.4 Inventory everything that reads the folder names.**
`grep -rn -E "In Development|Customer Adopted|____New Structure|_FINISHED" --include=*.ts --include=*.tsx --include=*.sql --include=*.py --include=*.json` across `src/`, `supabase/functions/`, `apps/`, `packages/`, `tools/`, `scripts/`, and the same in sibling repos that touch this share (check `AGENTS.md` and `docs/INFRASTRUCTURE.md` for the list; at minimum the PopSG crawler in `apps/bridge-agent/src/style-guide-crawler.ts` and `apps/windows-agent/`). Also list `admin_config` rows whose value contains these names: scan roots (`get-scan-roots`), `WORKFLOW_FOLDER_MAP`, and any path filter config. Also list active rows in the checkout table (designers with files checked out) and how they store paths.
*Worked when:* the baseline file has a table of every consumer: file:line or config key, what it does with the name, and whether Phase 3 must change it.

**0.5 Read the snapshot and backup setup on edge1.**
Record the snapshot schedule and retention rule for share `mac` (Snapshot Replication), and each Hyper Backup task that includes `mac` (destination, schedule, versioning/rotation). Read-only. If a read would exceed 25 seconds, load skill `synology-long-running-operations`.
*Worked when:* the baseline file states how far back snapshots are kept by policy (not just observed) and how backups version files.

**0.6 Check the "connections between files" risk.**
Design documents (Illustrator, InDesign, Photoshop) can link to other files by full path. If links point **into other folders** by absolute path, a rename breaks them. Sample 30 `.ai`/`.indd` files across five customers; for each, list linked-file paths (for `.ai`, XMP `stRef:filePath` / `%%DocumentFiles`; for `.indd`, the Links XMP). Classify: link inside the same SKU folder (safe — Adobe apps look beside the document first), or elsewhere under the tree (at risk), or outside the tree (unaffected).
Also record which Windows prefix designers actually use (network path vs Synology Drive) — check `USER_SYNC_ROOT` usage in the Path Tester (`src/pages/settings/PairingAndPaths.tsx:156`) and ask no one; infer from helper/agent registrations if available, otherwise assume the longer Synology Drive prefix.
*Worked when:* the baseline file gives the share of sampled documents with at-risk links. **If more than a few percent are at risk, stop before Phase 5 and raise it to Albert on #963 as a business question** (accept broken links in older documents, or keep those folders unrenamed).

**0.7 Report.**
Post one plain-English summary comment on #963: how many files are over the limit, what shortening is needed, the snapshot horizon, and any finding that changes this plan. Update the STATUS table. **Context cut.**

### Phase 1 — Permanent rename record

All structure changes go through `popcre/shared-db` (load skill `shared-db-change` first; claim the exact objects on the existing issue; never a migration in this repo). They reach production only through shared-db's automatic promotion workflow.

**1.1 Table `dam.folder_rename_log`** (name and schema to follow shared-db conventions found in step 0.2):

| Column | Meaning |
|---|---|
| `id` | bigint identity — also the execution order |
| `share` | text, `'mac'` |
| `old_path` | text — folder's share-relative POSIX path before, no trailing slash |
| `new_path` | text — after |
| `renamed_at` | timestamptz — when the rename happened on the NAS |
| `batch_id` | uuid — one per execution run |
| `rule` | text — which rule produced it |
| `reverted_at` | timestamptz null — set if rolled back |

Unique on `(share, old_path, renamed_at)`. Readable by admins only; written only by the service role. No purge job, ever — add a comment on the table saying so and why (issue #963).

**1.2 Function `dam.path_as_of(p_share text, p_path text, p_at timestamptz) returns text`.**
Takes a *current* path and walks the log **newest to oldest**; for each entry with `renamed_at > p_at` and `reverted_at is null`, if the path equals `new_path` or starts with `new_path || '/'`, replace that prefix with `old_path`. Returns the path as it was at `p_at`. Prefix match must be on whole segments (`Ross` must not match `Ross Stores`).
Also `dam.path_candidates(p_share, p_asset_id)` returning the distinct set of every path the asset has had: current path, each older path from the per-file move history, and each of those passed back through every rename boundary.
*Worked when:* shared-db tests (see §10) pass on the preview database.

**1.3 Keep per-file move history long enough.**
Change the purge so genuine move rows survive at least as long as the snapshot horizon from step 0.5 (O4). First measure current row count and rows/day; if the volume is dominated by a known churn pattern (see `AGENTS.md:267` — "high-churn rows were pruned"), purge only that pattern on the short schedule and keep the rest. The purge job was created by an app migration; changing it is a structure change → shared-db.
*Worked when:* a move row older than 90 days demonstrably survives a purge run on preview, and projected table size is recorded in the STATUS evidence.

**1.4 Types and docs.** Regenerate `src/integrations/supabase/types.ts` the way the repo does it (see `docs/development.md`), add a section to `docs/PATH_ATTRIBUTES.md` describing the log and `path_as_of`, and add the table to `docs/SCHEMA.md`.

### Phase 2 — Restore from snapshot (admin only)

Can be built and shipped **before** any rename; it is useful on its own and it is the safety net for Phase 5.

**2.1 Server: request/response actions in `admin-api`.**
New file `supabase/functions/_shared/admin-handlers/snapshot-handlers.ts`, modelled on `dir-browse-handlers.ts`, routed from `supabase/functions/admin-api/index.ts` next to `request-dir-browse` (`:2073`). All four sit behind the existing `requireAdmin` (`admin-api/index.ts:166`).

- `request-snapshot-versions { asset_id }` — loads the asset, computes candidate paths with `dam.path_candidates`, writes `admin_config` key `SNAPSHOT_VERSIONS_REQUEST` `{ request_id, asset_id, candidates[], status: "pending", requested_by, requested_at }`.
- `get-snapshot-versions-result { request_id }` — returns the result only if `request_id` matches.
- `request-snapshot-restore { asset_id, snapshot, source_path }` — re-validates that `source_path` is one of the asset's candidates and `snapshot` matches `^GMT[+-]\d{2}-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$`; writes `SNAPSHOT_RESTORE_REQUEST` including the asset's **current** folder as destination.
- `get-snapshot-restore-result { request_id }`.

Add the two request keys to the heartbeat allow-list and delivery block in `supabase/functions/agent-api/index.ts:210-211` and `:534-556`; add agent actions `report-snapshot-versions` and `report-snapshot-restore` beside `report-dir-browse` (`:2110`, `:5008`), each clearing its request only when `request_id` matches.
The destination for a restore is computed **on the server from the asset row**, never taken from the browser.

**2.2 Helper: list versions.** New `apps/bridge-agent/src/handlers/snapshot-tools.ts`, wired in `apps/bridge-agent/src/index.ts` like `handleDirBrowse` (`:40`, `:331`).
For each directory in `{NAS mount root}/#snapshot/` whose name matches the snapshot regex, and for each candidate path (each checked with `assertSafeRelativePath`), `lstat` `{mount}/#snapshot/{snapshot}/{candidate}`. Accept regular files only (no symlinks, no directories). Collect `{ snapshot, taken_at (parsed from the name, with its GMT offset), source_path, size, mtime }`. Collapse consecutive snapshots where size and mtime are identical into one version showing first-seen and last-seen dates — the list should show *distinct versions*, not 55 identical rows. Cap at 200 entries. 55 snapshots × a handful of candidates is a few hundred `lstat` calls: fast.

**2.3 Optional bounded fallback.** If no snapshot has the file at any candidate path, search only the snapshot copies of the asset's SKU folder name (by the SKU directory's name, within `____New Structure`), with a hard time limit of 20 seconds and a result cap. Label such results "found by name — confirm before restoring". Build only if step 0.2/1.3 shows history gaps make it necessary.

**2.4 Helper: restore.**
Validate the snapshot name and source path again. Destination directory = the asset's current folder (must be inside the NAS root and must exist; if the asset's folder no longer exists, fail with a clear message — do not create folder trees). Destination name = `<name> (restored <YYYY-MM-DD of the snapshot>)<.ext>`; if that exists, append ` 2`, ` 3`, …. Copy with exclusive-create so nothing is ever overwritten (`fs.copyFile` with `COPYFILE_EXCL`), preserve the modified time, then verify size and a full hash of source vs destination; on mismatch delete the partial copy and report failure. Refuse if free space is below a safety margin. Report `{ ok, restored_relative_path, size }`.
Writes happen on edge1 (the helper runs there) — correct per the write-on-edge1 rule.

**2.5 Make sure the restored copy is ingested as a new file, not mistaken for a move.**
The restored copy may be byte-identical to another asset. Move detection (`agent-api/index.ts:1119-1131`) requires same hash **and same filename**; the restored name differs (suffix), so it will be ingested as a new asset. Add a test that pins this (see §10) rather than relying on the observation.

**2.6 UI.** In `src/components/library/AssetDetailPanel.tsx`, beside the existing path-history block (`:240`), add an "Older copies" section rendered only for admins (use the same admin check the panel/settings already use — find it via `user_roles` usage in `src/`). A "Find older copies" button → request → poll every 2 s up to 60 s → table of versions (date range, size, modified time, old folder if different from today's) → "Restore beside current file" with a confirm step → success message naming the new file. Show clear states for: helper offline (no heartbeat), no older copies found, file unchanged in all snapshots.

**2.7 Live proof.** As the admin tester (see §12), on https://dam.designflow.app: pick a real file known to have changed in the last months; list versions; restore one; confirm on edge1 that the new file exists beside the original with the right size, the original is untouched (same size, mtime, hash as before), and after the next scan the restored file appears in PopDAM as its own asset. Screenshot the versions list and the success state (verify UI visually). Record in STATUS. **Context cut.**

**Adversarial cases (trust boundary: paths and names crossing browser → server → helper → filesystem). Every row must have its named test before Phase 2 is complete.**

| # | Input | Hostile / broken case | Expected | Test (file → name) |
|---|---|---|---|---|
| A1 | `snapshot` | `../../etc`, `GMT-04-2026.05.29-18.15.01/..`, empty, 300 chars | rejected before any filesystem call | `apps/bridge-agent/src/handlers/snapshot-tools.test.ts` → "rejects snapshot names that are not GMT-stamped" |
| A2 | `source_path` | absolute, `..` segment, NUL, drive letter, UNC | rejected by `assertSafeRelativePath` | same file → "rejects unsafe source paths" |
| A3 | `source_path` | valid path of a **different** asset | server refuses: not in this asset's candidates | `supabase/functions/_shared/admin-handlers/snapshot-handlers.test.ts` → "restore source must be one of the asset's candidate paths" |
| A4 | caller | signed-in non-admin calls any of the four actions | 403 | same file → "non-admin cannot list or restore" |
| A5 | snapshot entry | candidate is a symlink or a directory inside the snapshot | skipped in listing; restore refuses | snapshot-tools test → "only regular files are listed or restored" |
| A6 | destination | restored name already exists | new numbered name; existing file untouched | snapshot-tools test → "never overwrites an existing file" |
| A7 | destination | current file is the same name as source | still writes a suffixed copy; current file's hash unchanged | snapshot-tools test → "current file is byte-identical after restore" |
| A8 | copy | source vanishes or copy is short (disk full) | partial file removed, failure reported | snapshot-tools test → "cleans up a failed copy" |
| A9 | `request_id` | stale or foreign result posted by helper | ignored; pending request not cleared | `supabase/functions/agent-api` test → "snapshot report with wrong request_id is ignored" |
| A10 | browser | supplies its own destination folder in the body | ignored; destination derived from the asset row | snapshot-handlers test → "destination is never taken from the request" |
| A11 | rename log | `new_path` `Ross` vs a folder `Ross Stores` | no prefix bleed | shared-db test → "path_as_of matches whole segments only" |
| A12 | rename log | folder renamed twice, and a rename later reverted | correct path at each point in time; reverted entries ignored | shared-db test → "path_as_of across chained and reverted renames" |
| A13 | file name | contains `%`, `_`, `#`, quotes, trailing space, non-ASCII | listed and restored correctly; no pattern-matching surprises | snapshot-tools test → "handles special characters in names" |
| A14 | scanner | `#snapshot` contents | still never ingested | existing path-filter tests stay green + new "snapshot handler does not widen scan exclusions" |

### Phase 3 — PopDAM understands old and new folder names (ship before any rename)

**3.1 `infer_path_attrs` (shared-db).** New migration replacing the function so that:
- stage folder `In Dev` is treated as `In Development`, and the stored `stage` value is always the canonical long form (D8);
- `Cust Adopted` is accepted wherever `Customer Adopted` is;
- under a customer, a segment matching `^20\d\d$` is a year folder: the program is the segment after it (fixes finding 7 if step 0.2 confirmed it);
- the `_FINISHED/<Customer>_finished/…` and `_`-bucket rules are unchanged;
- existing program guards (looks like a filename / looks like a SKU) are unchanged.
The function is `IMMUTABLE` and used by triggers; keep the signature. Follow with a **batched re-backfill** (about 20,000 rows per batch — larger batches have crashed the database compute) of `assets` and `style_groups` only if step 0.2 showed values that change (the year-folder fix).

**3.2 Workflow status.** Add `"in dev": "in_development"` and `"cust adopted": "customer_adopted"` to `DEFAULT_WORKFLOW_FOLDER_MAP` (`supabase/functions/_shared/metadata-derivation.ts:16-25`). If an `admin_config` `WORKFLOW_FOLDER_MAP` override exists (step 0.4), add the same two keys there through the admin API — it replaces the default entirely.

**3.3 Every other consumer from the step 0.4 inventory.** Fix each. `STAGE_OPTIONS` (`src/types/assets.ts:38-44`) needs no change because stored values stay canonical — add a comment there saying folder names and stage values are deliberately decoupled, pointing at `docs/PATH_ATTRIBUTES.md`.

**3.4 Search gate.** Before and after deploying 3.1–3.3, run the same searches as the admin tester and record result counts: `Ross Wall 2026`, `Dollar General 2027`, `Desperate`, plus the Stage = In Development, Customer = Ross, Program filters. Counts must match (except where the year-folder fix intentionally corrects a program). If PopDAM search reads a derived search-document table, find where program/customer feed it (start at `docs/SEARCH_PERFORMANCE.md`) and decide O5.

**3.5 Deploy and prove.** Merge through the normal path; confirm the edge functions and frontend are live at the merged commit (see `AGENTS.md` → Deployment; the green GitHub "production" badge is the Railway worker only and does **not** prove the frontend updated). On the preview database, insert test paths using `In Dev/Cust Adopted/Ross/2026/Wall/SKU/file.psd` and confirm stage = `In Development`, customer = `Ross`, program = `Wall`.
*Worked when:* old-style and new-style paths give the same stage/customer, in production, with the tests in §10 green.

### Phase 4 — Rules and the full old-to-new list (no NAS writes)

**4.1 Rules file** `tools/folder-rename/rules.json`, human-readable, containing:
- `stage_abbreviations`: `{ "In Development": "In Dev", "Customer Adopted": "Cust Adopted" }` (D6).
- `customer_aliases`: folder name → short name, e.g. `"Desperate Signs": "Desperate"`. Seed from the shared database's customer master data (find the table via `docs/MASTER_DATA.md`); leftovers are proposed by the tool and marked "needs owner".
- `strip_from_descendants`: for each customer, the strings to remove from folder names beneath it — the customer name, its aliases, and known fluff words attached to it (e.g. `Shane` in `Shane Desperate Signs SS24`). Fluff words are per-customer and must be listed explicitly, never guessed by pattern.
- `strip_year_under_year_folder`: proposed, default **off** until Albert says yes (O2).
- Tidy-up after stripping: collapse repeated spaces, trim spaces and leading/trailing `-`/`_`, never touch folders that start with `_` (bucket folders) or look like SKU codes (same test as the function's SKU guard), never touch `@eaDir`/`#recycle`/`#snapshot`.

**4.2 Dry-run tool** `tools/folder-rename/plan.mjs` (Node, no dependencies beyond the repo's). Input: a directory listing of folders only (produced on **edge2**, the read side, with a single `find -type d`; use `synology-long-running-operations` if it runs long) plus a file listing with path lengths from step 0.1. Output:
- `old-to-new.csv`: `depth, old_path, new_path, rule, chars_saved`;
- `needs-attention.csv`: collisions (two folders that would get the same new name in one parent — **never merged automatically**), names that would become empty (`Ross 2026` under `Ross/2026`), names where stripping leaves a fragment under 3 characters, case-only renames, and names with trailing dots or spaces (illegal on Windows);
- `summary.md`: folders to rename, files over the limit before and after, the 50 longest remaining paths.
The tool must be deterministic and idempotent: running it on an already-renamed listing yields zero renames.

**4.3 Fix what the summary shows.** If files remain over the O1 target after the rules, list which deeper folders cause it and propose additional per-customer rules. Iterate until zero files exceed the target or the remainder is a short named list for Albert.

**4.4 Owner sign-off on rules, not rows.** Post to #963 one plain-English comment: the rule list (short), the customer short-name table, the yes/no on the year rule (O2), totals from `summary.md`, and the `needs-attention` count with a recommendation for each *kind* of case. Attach the CSVs as files in `verification/folder-shortening/`. Albert answers business questions only — he never reviews code or the full list unless he chooses to.

**4.5 Freeze.** Commit the approved `rules.json` and the generated CSV (the exact list to execute). **Context cut.**

### Phase 5 — Carry out the renames, in stages

Task class `production` (NAS writes + production data). Production is read-only by default; this phase is the authorised exception once 4.4 is answered. No human approval is requested for technical steps.

**5.1 Executor** `tools/folder-rename/execute.mjs`, run on a machine with SSH to **edge1** and database access. For one batch (a list of rows from the frozen CSV):
1. Preconditions, all must pass or the batch aborts untouched: the helper's scan is paused/idle; no active checkout has a path under any folder in the batch (step 0.4 table); every `old_path` exists and every `new_path` does not; ShareSync is healthy and idle.
2. Take a named snapshot of share `mac` (label `pre-folder-rename-<batch_id>`) and lock it from automatic deletion.
3. For each row, **deepest folders first**: rename on edge1 with a no-clobber rename (`mv -n` semantics; verify the source is gone and the target exists); immediately insert the `folder_rename_log` row with the actual time; then update PopDAM's stored paths in one transaction per folder — `assets.relative_path` and `style_groups.folder_path`, replacing the leading `old_path || '/'` with `new_path || '/'` (and exact matches for `folder_path`), in chunks of about 20,000 rows. Use `left()`/`substr()` prefix arithmetic, **not** `LIKE` with the raw path — folder names contain `_` and `%`. The path triggers recompute stage/customer/program automatically. Do **not** write per-asset history rows for these (the folder log is the record).
4. Update every other stored path from the step 0.4 inventory (checkout records, scan roots, render queues, any path-keyed table) the same way.
5. Postconditions: count of assets under `new_path` equals the count that was under `old_path`; zero remain under `old_path`; sample 20 assets and confirm the file exists on edge1 at the new location.
The executor writes a run log to `verification/folder-shortening/run-<batch_id>.md`. A `--revert <batch_id>` mode replays the batch's log rows in reverse (new → old), reverses the path updates, and sets `reverted_at`.

**5.2 Rehearsal.** Run the executor end to end against a scratch folder tree on edge1 outside the scanned area (or under a clearly named test customer folder inside `_No Customer` if the scan must see it) and against the preview database. Prove rename, log, path rewrite, restore-across-rename (Phase 2 feature finds the pre-rename version), and revert.
*Worked when:* all five are shown in a run log.

**5.3 Pilot: `Desperate Signs`.** Small and Albert's own example. Run off-hours (New York evening or weekend). Then watch for 24 hours: ShareSync edge1→edge2 (does it replay as renames or as delete-and-recopy? load skill `synology-sharesync-triage` if it stalls), the next Hyper Backup run (size and duration vs normal), Synology Drive on one designer machine, the next PopDAM scan (zero new assets created, zero retired under the pilot folder), and Phase 2's "older copies" on a pilot file (must show pre-rename versions under the old folder name).
*Worked when:* all of those are recorded as fine in the run log, and a designer-side open of a previously-too-long file succeeds if one existed there.
*If ShareSync or backup treats renames as full re-copies:* that is a capacity and time question, not a blocker by itself — size the remaining batches to what the pilot showed and say so on #963.

**5.4 Program-level folders, customer by customer.** One customer per batch, largest savings first.

**5.5 Customer folders** (`Desperate Signs` → `Desperate`, etc.), including the matching `_FINISHED/<Customer>_finished` folders so the two stay consistent.

**5.6 The two top folders last:** `Customer Adopted` → `Cust Adopted`, then `In Development` → `In Dev`. These touch every file and every designer's bookmarks, pinned folders, and recent-files lists; do them in one evening, and tell Albert the date beforehand so he can tell designers (business communication is his).

**5.7 Close-out proof.** Re-run step 0.1: zero files over the target. Re-run the step 3.4 searches: counts match. Compare totals before/after: asset count, tagged-asset count, style-group count, thumbnails present — unchanged. Restore an old version of a file from the oldest snapshot via PopDAM. Update `docs/PATH_ATTRIBUTES.md` examples, `AGENTS.md:270` area (anchor folder notes), and `docs/KNOWN_QUIRKS.md` with anything learned.

### Phase 6 — Keep it clean

**6.1 Nightly check.** Reuse the existing hygiene-scan channel if it fits (`claim-hygiene-scan` / `report-hygiene-findings`, `supabase/functions/agent-api/index.ts:5035-5038`; read the handler before deciding) to report: files whose path exceeds the target, and new folders under a customer that contain the customer's name or an un-aliased customer folder. Otherwise a small scheduled query over `assets.relative_path` using the same `rules.json`.

**6.2 Surface it** on an existing admin screen as a short list with the suggested name. No automatic renaming. Renames from that list go through the Phase 5 executor so they are logged.

## 10. Tests required

Must stay green: `npm test` (vitest) and `npm run typecheck` at the repo root; the bridge agent's and `packages/*` own test commands as defined in their `package.json`; edge-function Deno tests as run by CI; shared-db's test suite on its preview database.

To add (names are the behaviours; files as in the adversarial table):

- shared-db: `path_as_of` — whole-segment matching; chained renames; reverted renames ignored; a path untouched by any rename returns unchanged; rename dated after `p_at` is undone, before `p_at` is not.
- shared-db: `path_candidates` — includes current path, per-file older paths, and their pre-rename forms; no duplicates.
- shared-db: `infer_path_attrs` — table-driven: every example in `docs/PATH_ATTRIBUTES.md` gives the same answer as before; `In Dev/Cust Adopted/Ross/Wall/SKU/f.psd` → `In Development` / `Ross` / `Wall`; year folder `Ross/2026/Wall/…` → program `Wall`; `_FINISHED/Ross_finished/…` unchanged; `_NOT APPROVED` → null customer; SKU-looking and filename-looking program slots → null.
- `metadata-derivation` — `In Dev` → `in_development`; `…/In Dev/Cust Adopted/…` → `customer_adopted` (deepest match wins, as today).
- Bridge agent `snapshot-tools.test.ts` — rows A1, A2, A5–A8, A13 plus: versions are collapsed when size+mtime are identical; snapshot timestamp parsed with its GMT offset; cap of 200 respected.
- Admin handlers `snapshot-handlers.test.ts` — rows A3, A4, A10.
- `agent-api` — row A9; and "a restored copy with a suffixed name is ingested as a new asset, not as a move" (step 2.5).
- `tools/folder-rename/plan.test.mjs` — strips customer name and aliases; leaves `_` buckets and SKU-looking folders alone; flags collisions, empty results, and Windows-illegal names; idempotent on its own output; never proposes a file rename.
- `tools/folder-rename/execute.test.mjs` (against a temp directory and a stubbed database) — aborts untouched when a precondition fails; deepest-first order; prefix replacement is literal for names containing `_` and `%`; `--revert` restores the exact original tree and paths.
- A frontend test that the "Older copies" section does not render for a non-admin.

## 11. Constraints, standing rules, and gotchas

- **Branch and merge:** never push to `main`; feature branch + pull request; the AI merges (Albert does not). AI review in CI is advice only and never blocks. Wait on CI with `bin/ai-pr-wait <pr>` run in the background — never a hand-written sleep loop.
- **Database structure** changes only via `popcre/shared-db`, claim-first on the existing issue, preview first, automatic promotion to production. No manual production SQL for structure. Data rewrites of PopDAM's own rows (step 5.1) are application data and belong to this repo's session, but still batch them.
- **Batch size ~20,000 rows.** Larger backfills have crashed the database compute. The database also had an I/O ceiling incident on 2026-11-05; run heavy batches off-hours and watch for slowness.
- **Write on edge1, read on edge2.** Never write to edge2.
- **NAS container commands** need docker sudo for `ai`: enable at the start of a block, revoke at the end.
- **Never weaken the scanner's `#snapshot` exclusion.**
- **Do not modify the bridge's self-updater** while adding handlers; a "Build mismatch" message after publishing can be a false alarm (see `docs/KNOWN_QUIRKS.md`).
- **Secrets** stay in 1Password vault `vibe_coding`; never in chat, arguments, logs, or commits.
- **Never ask Albert to approve, click, type, or run anything.** Ask him only business-meaning questions, all together, in plain English. Everything else: do it, or report it `Blocked —` with an owner.
- **Times quoted to people are New York time**, computed from the system clock.
- **Sign everything posted to GitHub** with `$AI_GH_SIGNATURE`.
- **No band-aids, no silent failures, nothing hard-coded** that belongs in `rules.json` or config. UI work is verified visually.
- **One issue:** all progress, proofs, and leftovers stay on #963 as checklist items — do not open follow-up tickets for unproven steps.
- **Gotcha — single-slot requests:** two admins clicking at once would overwrite each other's pending request; always match on `request_id` and show "another request is running" rather than a wrong result.
- **Gotcha — `LIKE` and folder names:** `_` and `%` are wildcards; `____New Structure` alone has four. Use literal prefix comparison.
- **Gotcha — case-only and trailing-space renames** behave differently on Windows clients than on the NAS; the plan tool flags them.
- **Gotcha — Thumbs.db / `@eaDir`** inside renamed folders move with the folder; ignore them.
- **Gotcha — open files:** renaming a folder while a designer has a file open inside it leaves their program pointing at a path that no longer exists; hence off-hours and the checkout precondition.
- **Gotcha — the docs may be stale on year folders** (`docs/PATH_ATTRIBUTES.md` shows `Ross/Ross Wall 2026`, the drive has `Ross/2026/Ross Wall 2026`). Trust step 0.2, then fix the doc.

## 12. Access and environment

- **GitHub:** `gh` CLI is authenticated for `u2giants`. Repo `u2giants/popdam3`; remote name `github`.
- **NAS:** SSH aliases `edgesynology1` and `edgesynology2` in the working machine's SSH config (user `ai`, key-based; Albert refers to edge1 as "edge1"). Example read: `ssh edgesynology1 'ls "/volume1/mac/#snapshot" | head'`. Keep single reads under about 25 seconds or use skill `synology-long-running-operations`.
- **Database:** Supabase project `qsllyeztdwjgirsysgai` (US East). Beware: a default Supabase MCP connection may point at a retired project — confirm the project ref before trusting a result. If the MCP is unauthorised, the fallback credential paths are documented in `docs/1password.md` and the shared-db `AGENTS.md` credential runbook.
- **Test login:** 1Password vault `vibe_coding`, the PopDAM **administrator** tester item (account `ai-admin@designflow.app`; it has the `admin` role). Viewer and designer tester items exist in the same vault for the non-admin test. Never print values. Do not screenshot Settings pages that display NAS credentials.
- **Run locally:** `npm install` then `npm run dev` — the frontend talks to the production Supabase project directly; no `.env.local` needed. Tests: `npm test`. Types: `npm run typecheck`.
- **Deploy paths:** frontend via `.github/workflows/publish-frontend.yml` → Coolify; edge functions via `.github/workflows/deploy-supabase.yml` (triggers on `supabase/functions/**`); bridge agent image via `.github/workflows/publish-bridge-agent.yml`, picked up by the helper's self-update. See `docs/deployment.md`.
- **MCP servers that failed to connect in the planning session** (`railway`, `tokensave`) are not needed for this plan.

---

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

**Done when all of these are true and cited in the STATUS table:**

- [ ] Zero files under `____New Structure` exceed the agreed length target (re-run of step 0.1).
- [ ] `folder_rename_log` holds every rename; `path_as_of` returns the true pre-rename path for sampled files, checked against the oldest snapshot on edge1.
- [ ] Albert-visible proof: in PopDAM, an older copy of a renamed-folder file from the oldest snapshot was listed and restored beside the current file.
- [ ] Stage / Customer / Program filters and the step 3.4 searches return the same counts as the baseline.
- [ ] Asset, tagged-asset, style-group, and thumbnail totals unchanged across the rename.
- [ ] All tests in §10 exist and pass; CI green; every pull request merged; deployed versions verified live (frontend build SHA, edge functions, bridge image).
- [ ] ShareSync healthy and edge2 matches edge1; a Hyper Backup run completed after the last batch.
- [ ] Docs updated (`docs/PATH_ATTRIBUTES.md`, `docs/SCHEMA.md`, `docs/KNOWN_QUIRKS.md`, `AGENTS.md` pointers); this plan's STATUS all done; the handoff file deleted in the finishing commit; issue #963 closed with the proof links.

**Risks and rollback**

| Risk | Likelihood | Mitigation / rollback |
|---|---|---|
| Linked files inside design documents break | unknown until 0.6 | Measured before any rename; owner decision if material; `--revert` restores names exactly. |
| ShareSync or Hyper Backup re-copies everything | medium | Pilot observes it; batch sizes follow; off-hours. |
| Synology Drive clients re-download large trees | medium | Seen in the pilot on one machine before wider batches. |
| PopDAM loses metadata | low with D4 | Direct prefix rewrite, pre/post counts, no reliance on move detection; pre-batch snapshot; `--revert`. |
| A consumer of folder names was missed | medium | Step 0.4 inventory; Phase 3 deployed and proven before renames; pilot on one small customer. |
| Designers' bookmarks and recent-file lists break | certain for the two top folders | Done last, in one evening, with Albert told the date in advance. |
| The cause of "couldn't open" is not path length | possible | Step 0.1 gate stops the project early if no files are near the limit. |
| Database load during rewrites | medium | 20k batches, off-hours, per-folder transactions. |

Rollback at any point: the executor's `--revert <batch_id>` (names and stored paths), with the locked pre-batch snapshot as the last resort. Phases 1–3 are additive and safe to leave in place.

**Open questions (also in §8):** O1 length target (after 0.1/0.6); O2 strip repeated year (Albert, yes/no, asked once in step 4.4); O3 customer short names (master data first, leftovers to Albert in 4.4); O4 move-history retention (after 0.5); O5 program value vs search (after 3.4).

**Questions for Albert — ask together, once, at step 4.4, in plain English:**
1. The short name for each customer the master data did not settle.
2. Also drop the repeated year from program folders? (Recommended: yes.)
3. If step 0.6 finds many documents with links that would break: accept, or leave those folders alone? (Recommendation depends on the count.)
4. Which evening for the two top-folder renames (step 5.6).

---

## Self-audit (run 2026-11-11 before first publication)

1. *Could a brand-new session execute this without asking anything?* Yes. §2 defines the app, hosts, shares, and vocabulary; §5 gives file:line for every mechanism reused; §9 gives ordered steps with gates; §12 gives access. Where facts are unverified the plan says so and makes verification the first steps (0.2, 0.3, 0.5, 0.6) rather than assuming.
2. *Does it carry all background and what was ruled out?* Yes. Albert's words are quoted in §1 and §3; every option raised in the brainstorm and why it was dropped is in §7; findings that contradict Albert's own assumption (full rescan) are in §6.5 with the code reference and locked as D4.
3. *Is the goal clear enough for a judgment call?* Yes. §1 states the business outcome and the "goal wins" rule; §8 separates locked from open decisions and gives criteria for each open one; step 0.1 has an explicit stop condition if the premise is wrong.

Gaps found and fixed during the audit: added the year-folder finding (6.7) after sampling the drive; added step 2.5 after reading the move-detection condition; added the `LIKE`-wildcard gotcha because the anchor folder name itself contains underscores.
