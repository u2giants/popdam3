---
issue: 963
status: OPEN
owner: claude/folder-shortening-phase5 (next session)
---

# Handoff — Folder shortening, Phase 5.4 onward (rename the rest of the NAS folders)

Base URL for files: `https://github.com/u2giants/popdam3/blob/main/`. All paths below are relative to that.

## 0. ⚠️ Business decisions only the owner can make

**Blocking, but only for the last step (5.6, the two top folders):**
1. **Which evening to rename `Customer Adopted` → `Cust Adopted` and `In Development` → `In Dev`.** These change every designer's bookmarks and recent-file lists, so Albert must warn the designers. Recommendation: a Friday evening at least 3 days after you ask. Ask only once batches 5.4/5.5 are done.

**A wrong guess is recoverable (no need to ask unless you disagree with the recommendation):**
2. **The `Concept Approved Designs` area (2,570 of the 4,157 planned renames) is not mentioned in plan steps 5.4–5.6**, which only talk about customer folders. Recommendation: treat it as its own set of batches, one product-type folder at a time (e.g. `WALL ART/...`), after the customer batches and before 5.6. This is technical sequencing; just do it and note it on #963.

**Already settled — do NOT re-ask (dates EST):**
- Rename everything, not only too-long folders; one spelling per customer everywhere (Albert, 2026-11-13).
- Albert's 21 customer short names are final (`verification/folder-shortening/customer-short-names_from_albert.csv`, 2026-11-13).
- Drop a year already shown by a higher folder; keep the six customer+year folders (e.g. `Dollar_General/2026/Dollar_General 2026`) grouped and named as they are; folders under a different year keep their year (2026-11-13).
- Pilot authorised and done ("can we do a small pilot?", then "do those renames right now", 2026-11-24). The 24-hour watch was run early on Albert's request ("can we do it manually now so we can move this forward?", 2026-11-25 9:40 AM EST) and passed.
- Albert's original authority for this project: "do all the steps in https://github.com/u2giants/popdam3/issues/963". Renames are therefore authorised; technical steps need no approval.

Put items 1 and 2 to Albert together, in one plain-English message, only when you reach step 5.6. Item 2 needs no answer unless he objects.

## 1. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) is POP Creations' design-file library. It indexes every design file on the company Synology NAS (share `mac`, path `/volume1/mac`) into a Supabase Postgres database (project `qsllyeztdwjgirsysgai`). Designers browse, search, check files out, and open them from Windows. A scanner (the on-prem "bridge agent" helper) walks the NAS every 2 hours and keeps the database in sync. There are two NAS units: **edgesynology1 (edge1) is where all writes happen**; edgesynology2 (edge2) is a read-only copy kept up to date by Synology ShareSync.

## 2. What this work is and why

Designers on Windows can't open some files because the full path is too long. Project #963 shortens folder names by rule (customer short names, stage abbreviations, dropping repeated customer names and years) without losing history. The governing plan is `plan_folder_shortening_snapshot_restore.md`. Read its STATUS table (top) and Phase 5 (around line 374) in full before starting. Phases 0–4 and 6 are done. Phase 5.1–5.3 (rename tool, rehearsal, pilot) are done. **This handoff covers 5.4–5.7: running the remaining renames in batches and the close-out proof.**

## 3. Current state (verified 2026-11-25 ~10:00 AM EST)

- **Rename tool** `tools/folder-rename/execute.mjs` is merged (PR #1308, commit `305e6a9f`). Tests: `node --test tools/folder-rename/*.test.mjs` (25 pass; the directory form `node --test tools/folder-rename/` fails on this Node version, so use the glob).
- **Pilot done**: the Desperate Signs tree was renamed on 2026-11-24 at 3:12 PM EST, batch id `6859574e-0221-4e07-8c79-d278c5c7b948`, run log `verification/folder-shortening/run-pilot-desperate-6859574e.md` (PR #1326, `c3a3424a`). Locked snapshot `GMT-05-2026.11.24-15.12.21`.
  - `Customer Adopted/Desperate Signs` → `Desperate` (with `Shane Desperate Signs SS24` → `SS24`).
  - `Customer Adopted/_FINISHED/Desperate Signs_finished` → `Desperate` (with three children shortened).
  - **The pilot did 5.4 and 5.5 together for that customer** (program folders and the customer folder in one batch). That worked well, and the recommended batch unit going forward is one whole customer subtree, plus its `_FINISHED/<Customer>_finished` twin, per batch.
- **Pilot watch results** (posted on #963):
  - Scan: 0 new and 0 retired assets; customer is still "Desperate Signs".
  - ShareSync replayed the change as renames within a minute.
  - Both Hyper Backup tasks ran clean afterwards: Backblaze 8:20–9:26 PM EST, and edge1→bac at 1:05 AM EST.
  - "Older copies" shows the pre-rename version.
  - Not checked: Synology Drive on a designer PC.
- **Customer-name fix**: popcre/shared-db PR #7022 is live in production. It adds table `dam.customer_folder_alias` (21 rows), and `infer_path_attrs` maps a short customer folder back to the full customer name. So a renamed customer folder keeps its stored customer value (database rule D8: stored values stay the long canonical names).
- **UI**: PR #1331 (`a33a2379`) shows "Older copies" in the style panel's Files tab. Verified live as `ai-admin`.
- **Plan STATUS**: the Phase 5 row was updated by PR #1353 (merged).
- **Scanning**: automatic scanning is ON (`admin_config.AUTO_SCAN_CONFIG = {"enabled": true, "interval_hours": 2}`).
- Nothing else has been renamed. The frozen list `verification/folder-shortening/old-to-new.csv` is from a 2026-11-13 listing of edge2.

Remaining renames by area (rows in the frozen list):

| Area | Rows |
|---|---|
| `Concept Approved Designs` (incl. the stage folder itself → `Concept_Approved`) | 2,570 |
| Burlington (incl. `_FINISHED`) | 428 |
| Ross | 274 |
| Dollar General | 119 |
| Ollies | 102 |
| Hobby Lobby | 107 |
| Box Lunch | 74 |
| Gabes | 58 |
| Long tail of ~40 more customers | 1–30 each |
| `In Development` level | 33 |
| `Product Ideas` | 21 |
| `Discontinued` | 6 |

## 4. What did NOT work (do not repeat)

- **Killing a helper with `pkill -f "<pattern>"`** when the calling shell's own command line contains the pattern kills your own shell (exit 144). Use a pattern that doesn't match itself, e.g. `pkill -f "http.server 879[9]"`.
- **`op run` masks secret values in stdout, even when stdout is redirected to a file.** A credentials file written that way contains `<concealed by 1Password>`. Use `op run --no-masking` only when writing to a private scratch file you delete right after.
- **Injecting a Supabase session into localStorage (`sb-popdam-auth-token`) no longer logs you in.** The working route is to fill the login form with Playwright: serve the credentials JSON from a private scratch dir on a localhost port for under a minute, read it with `page.request.get`, then delete the file. Port 8765 was already occupied on hetz, so use another port.
- **Waiting on "scan not running" with a loop that treats any non-`running` output as finished** exited early when one `op run` call returned empty. Require a non-empty value.
- **The DSM ShareSync API on edge2 reports `err_local_initialization_failed`** for connection id 3, yet syncing works (fresh edge1 files appear on edge2). Don't treat that label as proof of failure. Compare file lists on both units instead.
- **Shared-db migration versions**: a version must be reserved (`node scripts/check-dispatch-collision.mjs --objects ... --reserve-version --future-minutes 30`) and be later than every migration touching the same object. Otherwise you get a "backdated migration" refusal.

## 5. Key findings

- How the executor picks rows: `--match <old_path prefix>` (repeatable) filters the frozen list. `planSteps` (`execute.mjs` ~line 79) rebuilds each step from where the parent is **now** on disk, using `dam.folder_rename_log`, so earlier batches don't break later ones. Steps run deepest first.
- Preconditions (all must pass, or the batch aborts untouched):
  - automatic scan disabled and no scan running;
  - no active checkouts under the batch;
  - every source folder exists;
  - every target name is free.
  - **Folders that disappeared since 2026-11-13 make the whole batch abort.** In that case, re-list and regenerate (step 6.2) or narrow the `--match`.
- Each rename is one transaction: insert the log row, then rewrite every path column in `PATH_COLUMNS` (`execute.mjs` ~line 29) in 20,000-row chunks. If the database step fails, the folder is renamed back.
- Postconditions: asset counts are equal under the old and new names, nothing is left under the old name, and 20 sampled files exist on disk.
- Undo: `--revert <batch_id>`. A locked DSM snapshot is taken before every real batch.
- Customer value after a rename comes from `dam.customer_folder_alias` (shared-db). A customer whose short folder name is **not** in that table would get a new customer value. Before each customer batch, check that its short name is in the table, or that the short name equals the long name.
- A pre-existing deleted asset under a folder (`is_deleted = true`) is not counted by the executor. The pilot had one (`SQZ26MV tech pack.ai`); that is not a loss.
- A full scan pass takes about 1.5 hours. The 2-hour interval means a scan is running most of the day. Pause it first, then wait for the running pass to end.

## 6. Exact next steps

Work on a feature branch in your own worktree. Task class `production`. Run batches New York evenings or weekends; each batch so far took about 2 minutes.

1. **Set up the environment files** (scratch dir, deleted at the end):
   - `prod.env` with `PGPASSWORD=op://vibe_coding/246sf23gymd64yudpmhswcnyle/password`
   - `exec-prod.env` with that line plus `DSM_PW=op://vibe_coding/qenqbypaap6shcjdkeaamjtnce/password`

   Database connection: `host=aws-1-us-east-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.qsllyeztdwjgirsysgai sslmode=require`. Run `select current_database(), inet_server_addr()` before writes.
   *Worked when:* `op run --env-file=prod.env -- psql "<conn>" -Atc "select 1"` prints 1.
2. **Regenerate the list** if any batch precondition says a source is missing:
   - List folders and files on **edge2** (read-only) under `/volume1/mac`, excluding `#snapshot` and `@eaDir`.
   - Run `node tools/folder-rename/plan.mjs --rules tools/folder-rename/rules.json --dirs <dirs> --files <files> --out verification/folder-shortening`.
   - Commit the result by PR.

   *Worked when:* the precondition passes on a dry run.
3. **Each customer batch** (largest first: Burlington, Ross, Dollar General, Ollies, Hobby Lobby, Box Lunch, Gabes, then the rest):
   1. Save `AUTO_SCAN_CONFIG`, then set `enabled` to false.
   2. Wait until `SCAN_PROGRESS.status` is not `running`. Wait in the background; never poll by hand.
   3. Check that edge2 matches edge1 for the subtree (`find` on both, ignore `Thumbs.db`/`.DS_Store`/`@eaDir`).
   4. Dry run: `op run --env-file=exec-prod.env -- node tools/folder-rename/execute.mjs --db prod --batch-label <customer> --match "Decor/Character Licensed/____New Structure/In Development/Customer Adopted/<Customer>" --match "Decor/Character Licensed/____New Structure/In Development/Customer Adopted/_FINISHED/<Customer>_finished" --dry-run`
   5. The same command without `--dry-run`.
   6. Restore `AUTO_SCAN_CONFIG`.
   7. After the next scan, confirm 0 new and 0 retired assets under the new names, and that the customer value is unchanged.
   8. Commit the run log by PR and comment on #963.

   Several small customers can share one evening, as separate batches.
   *Worked when:* the run log says `result: OK` and the post-scan check shows no new or retired assets.
4. **`Concept Approved Designs`**: same procedure. Batch by product-type subfolder (e.g. `--match ".../Concept Approved Designs/WALL ART"`). Keep batches to a few hundred renames. Leave the stage folder itself (`Concept Approved Designs` → `Concept_Approved`) until all its children are done.
5. **Remaining levels**: `Product Ideas`, `Discontinued`, and the `In Development` children, same procedure.
6. **5.6 Top folders**: ask Albert item 0.1 first. On the agreed evening, rename `Customer Adopted` → `Cust Adopted`, then `In Development` → `In Dev`. These touch every file: expect the path rewrite to run in 20k chunks for minutes.
7. **5.7 Close-out** (plan §5.7):
   - Re-measure path lengths: zero over the target.
   - Re-run the search counts.
   - Totals (assets, tagged, style groups, thumbnails) unchanged.
   - Restore one file from the oldest snapshot through PopDAM.
   - Update docs (`docs/PATH_ATTRIBUTES.md`, `docs/KNOWN_QUIRKS.md`, `AGENTS.md`).
   - Fill in the STATUS table, delete this handoff file, and close #963 with links.
8. **At the end of each phase step, re-read every later step of plan Phase 5 and the §13 definition of done**, and report on #963 anything you did or learned that changes them.

## 7. Constraints and gotchas

- Write on edge1 only; never write to edge2.
- Never push to `main`. Use branch + PR; you merge (auto-merge is disabled on this repo, so use `gh pr merge --squash` after checks).
- Database writes in ≤20k-row chunks, off-hours.
- Never weaken the scanner's `#snapshot` exclusion.
- Secrets only through `op run`; never in arguments, logs or chat.
- Sign GitHub posts with `$AI_GH_SIGNATURE`.
- Times to people in EST, from `TZ=America/New_York date`.
- `LIKE` patterns: `_` is a wildcard (`____New Structure`). Escape it, or use `left()` prefix compares.
- Replies to Albert: plain words, no jargon, ≤120 words, with a "Still open" block.
- Login for visual checks: admin tester item `7s5uzpbjenka4fpvrqogh44bre` (`ai-admin@designflow.app`). Do not screenshot Settings pages that show NAS credentials.

## 8. Access

- `gh` is authenticated as `u2giants`.
- SSH aliases `edgesynology1` / `edgesynology2` (user `ai`, key auth). The `ai` user is an administrator on edge1, which is enough for renames and DSM API snapshots. DSM API calls run on the NAS against `http://127.0.0.1:5000/webapi/entry.cgi`, logged in as `ai` with `DSM_PW` piped on stdin (see `snapshot()` in `execute.mjs`).
- 1Password vault `vibe_coding`:
  - production database: item `246sf23gymd64yudpmhswcnyle`
  - DSM: item `qenqbypaap6shcjdkeaamjtnce`
  - preview database: item `qbvfk7umc3n75ejekd65zwd4ty`, field `DB_PASSWORD`, project `mvpkijzfmfcxhnzqogzs` via the `aws-0-us-east-1` pooler
  - Supabase publishable key: item `3hhxwrljnaq2tykxi7hplq5ryi`
- Playwright MCP for UI checks.

## 9. Open questions and risks

- Synology Drive client behaviour on a designer PC was never observed (2026-11-25). Low risk, since ShareSync replayed renames as renames. Note it on #963 if a designer reports a re-download.
- edge2's ShareSync status label `err_local_initialization_failed` is misleading (2026-11-25). It is a candidate for a separate look; it didn't block the pilot.
- The big top-folder renames (5.6) rewrite paths on every asset (~hundreds of thousands of rows). Watch the database for slowness (2026-11-05 I/O-cap incident) and run late evening.
- The frozen list is aging (2026-11-13). Expect to regenerate it before the larger batches.

## Self-audit (2026-11-25)

1. Could a newcomer continue without asking? Yes. §1 explains the app, §3 the exact state with ids, §6 gives ordered commands with "worked when" checks, and §8 gives access.
2. Could they continue as well as this session? Yes. The non-obvious lessons (masking, pkill, scan-wait, the misleading ShareSync label, the batch unit, the alias table) are in §4–§5.
3. Is every needed detail included? Yes. It covers goals (§2), state (§3), failures (§4), decisions (§0), constraints (§7), risks (§9), next steps (§6), and evidence (the run logs and PRs in §3).
4. Does §0 hold every owner decision? Yes, after re-reading §1–§9: the top-folder evening (5.6) and the Concept Approved sequencing. No technical approval is listed.
