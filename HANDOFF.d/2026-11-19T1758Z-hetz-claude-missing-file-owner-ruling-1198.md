---
issue: 1198
status: OPEN
owner: claude session 7ddc40f2-f5bb-459f-9c2b-403fc04af29a (hetz)
---

# Deleted NAS artwork must stay in PopDAM; moves must be proven (issue 1198)

Written 2026-11-19, 1:00 PM EST. The work in this file is **not started**. This
session only reviewed, measured and recorded; it changed no code and no data.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

Put the one open question to Albert in a single message before building anything
that users will see. Steps 1 and 2 of section 6 do not depend on it.

**A wrong guess is recoverable, but rework is wasteful**

1. When artwork is gone from the NAS, should PopDAM show it exactly like any other
   artwork, or show it with a mark such as "no longer on the NAS"?
   Recommendation: show it with the mark, because staff will otherwise try to
   check out a file that is not there. Blocks section 6 step 4 only. Asked twice
   on 2026-11-19 (12:27 PM and 12:57 PM EST); not yet answered.

**Blocking:** none. **Outside this work and nobody is on it:** none.

**Already settled — do NOT re-ask**

- 2026-11-19, 12:27 PM EST, Albert's exact words: "artwork deleted from the NAS
  should not disappear from PopDAM automatically. But there must be a foolproof
  way to differentiate between 'disappear' and moved. we can't have duplicates".
  This **reverses** the line in section 0 of
  <https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-19T0400Z-hetz-claude-scan-1117-loose-ends.md>
  that says hiding missing files was settled. That line was an assumption; the
  owner has now ruled against it.

## 1. What this application is

PopDAM is POP Creations' digital asset manager: a web catalog of licensed
consumer-product design files (PSD, AI, PDF, images) that live on the company's
Synology NAS (`edgesynology1`). Staff browse and search it in a browser.

- Repository: <https://github.com/u2giants/popdam3>. Router:
  <https://github.com/u2giants/popdam3/blob/main/AGENTS.md>
- The **bridge agent** is a small program on the NAS. About every two hours it
  walks the design folders ("a scan"), tells the cloud which files are new or
  changed, and makes thumbnails. Source:
  <https://github.com/u2giants/popdam3/tree/main/apps/bridge-agent>
- The cloud side is the Supabase edge function `agent-api`:
  <https://github.com/u2giants/popdam3/blob/main/supabase/functions/agent-api/index.ts>
- Database: shared Supabase project `qsllyeztdwjgirsysgai` (Virginia). One row per
  file in `public.assets` (`relative_path` unique, `is_deleted` = hidden,
  `quick_hash` = cheap sampled fingerprint). `public.asset_path_history` records
  moves and retirements. Scan state is in `admin_config` rows `SCAN_PROGRESS`
  and `SCAN_HISTORY`.
- Behaviour contract for the bridge:
  <https://github.com/u2giants/popdam3/blob/main/docs/WORKER_LOGIC.md>

## 2. What we set out to do this session, and why

Albert asked on 2026-11-18: "is popdam's scanning/syncing system/process designed,
implemented and operating optimally?" The session reviewed the code and the live
system and filed <https://github.com/u2giants/popdam3/issues/1117> with four
findings. Another session fixed all four the same day. On 2026-11-19 Albert gave
the ruling quoted in section 0, which conflicts with how finding 2 was fixed. The
session recorded that in <https://github.com/u2giants/popdam3/issues/1198> and,
at Albert's request, wrote a prompt for a new session to do the work.

## 3. Current state — what is true right now

Verified live at 12:27–12:50 PM EST on 2026-11-19:

- Scanning is healthy. Bridge reports version 1.16.32, idle, heartbeat current.
  The scan that started 11:01 AM EST finished in about 8 minutes:
  `completed_with_warnings`, 164,558 files examined, 0 errors, 4 new, 102
  updated, `retired_missing` 0.
- Since bridge 1.16.27 every complete scan hides (soft-deletes) any live record
  whose file is not on disk. It does **not** check whether the file moved or was
  deleted. Code:
  <https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/src/missing-file-reconciliation.ts>,
  called from `reconcileCatalogWithDisk` in
  <https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/src/index.ts>;
  cloud side `handleRetireMissingAssets` in `agent-api` (route
  `retire-missing-assets`). Each hidden record gets an `asset_path_history` row
  whose `new_relative_path` starts `retired-missing-from-nas`.
- 17,684 distinct records carry that marker (first 3:29 PM EST Nov 18, latest
  10:39 AM EST Nov 19). 17,683 are still hidden.
- In an arbitrary (not random) sample of 400 of them, 202 have a live record
  elsewhere with the same filename, size and `quick_hash`, and 198 have none.
  So roughly half are moves or copies and roughly half are artwork that is
  simply gone and is hidden against the ruling. The exact split is **not** known.
- Nothing is half-done. No code was written. The only repository change from this
  session is this file. No pull request other than the one adding this file. No
  database claim is held: `ai-shared-db-closeout-check` for session
  `7ddc40f2-f5bb-459f-9c2b-403fc04af29a` returned `ok: true`, zero blocking
  claims, at about 1:00 PM EST.

Loose ends of the older handoff (linked in section 0), re-checked: A is closed
(<https://github.com/u2giants/popdam3/issues/1195>); B is now seen live
(`completed_with_warnings` above); C is down to 3 rows. D (about 500 duplicate
history rows) and E (look at the settings screen with the new label) were not
re-checked and stay with that file's owner.

## 4. Everything we tried that did NOT work

- **Exact count of moved versus gone in one query.** Joining all 17,684 hidden
  records to live `assets` on filename, size and `quick_hash` hit the statement
  timeout twice (error `57014`), including a version with materialized steps.
  A 400-row sample using a per-row `exists` on `quick_hash` ran in seconds. Do
  the full count in batches of a few hundred to a few thousand ids.
- **Using `last_seen_at` to find vanished files.** Since
  <https://github.com/u2giants/popdam3/pull/825> it only advances when a file
  changes, so an old value does not mean the file is gone.
- **Reading the first oversized `admin_config` query.** A `key ilike '%scan%'`
  filter pulled 690 large `sibling_scan_request_*` rows (750 KB). Select named
  keys only.
- The Railway and tokensave MCP servers failed to connect in this session; neither
  was needed.

## 5. Root causes and key findings

- **The current check cannot tell a move from a delete.** It asks only "is this
  path absent?" A record is hidden either way. Where the file moved, a new record
  already exists at the new path, so hiding the old one happened to remove a
  duplicate. Where the file was deleted, the only record is now hidden.
- **`quick_hash` is not proof of identity.** It is SHA-256 of the first 64 KB, the
  last 64 KB and the size. Template-derived files collide. See quirk 51 and
  quirk 81 in
  <https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md>. The
  existing move detection in `agent-api` ingest requires exactly one other live
  record with the same `(quick_hash, filename)` and gives up when there are two,
  which is why reorganised folders produced duplicates in the first place.
- **A candidate for foolproof identity** (not built, not tested): the NAS file
  identity, device number plus inode, which stays the same when a file is renamed
  or moved within one volume. `fs.stat` already returns both in the scanner
  (<https://github.com/u2giants/popdam3/blob/main/apps/bridge-agent/src/scanner.ts>).
  A copy, or a move to another volume, gets a new inode, so a full-content hash is
  needed as the fallback proof. An application that saves by writing a new file
  and renaming it over the old one also changes the inode; path match must stay
  the first test.
- **Restoring blindly would create duplicates.** About half the hidden records
  have a live twin. Un-hiding those breaks "we can't have duplicates".
- The older stale-record path (`retireConfirmedStaleRecords`, marker
  `retired-stale-duplicate:`) already hides only when a same-identity survivor
  exists. It is the model for step 1, with the identity proof strengthened.

## 6. Exact next steps

1. **Stop hiding files that have no surviving copy.** Change the missing-file step
   so a record is hidden only when the same file is proven live at another path;
   otherwise leave the record alone. Bump `apps/bridge-agent/package.json` so the
   NAS sees an update, and apply it with the in-app Update button
   (`AGENT_UPDATE_REQUEST`). You'll know it worked when a file deleted from a
   test folder on the NAS is still a live record after the next complete scan,
   and `SCAN_HISTORY` shows that scan.
2. **Count, then restore.** In batches, split the 17,683 hidden marker records
   into "has a live record with the same filename, size and `quick_hash`" and "has
   none". Restore (`is_deleted = false`) only the second group, and add an
   `asset_path_history` row for each so it can be undone. Check each restored
   path is not already taken by a live record. You'll know it worked when the
   restored count equals the "has none" count and no `(filename, size,
   quick_hash)` group gained a second live record from the restore.
3. **Make move detection foolproof.** Store device and inode per record (new
   columns go through `popcre/shared-db`; load the `shared-db-change` skill
   first), backfill them from a scan, and match a newly seen path to a vanished
   record on inode first and full-content hash second. On a proven move, repoint
   the existing record and write history; never create a second one. You'll know
   it worked when moving a test file to another folder leaves exactly one live
   record, at the new path, with its tags intact.
4. **Show the difference to users** as Albert answers question 1 in section 0.
   You'll know it worked when the live site shows the agreed treatment on a
   record whose file is gone.
5. **Correct the documents:** section 4 of `docs/WORKER_LOGIC.md` (link in section
   1) and add a quirk entry. Tell the owner of the older handoff file that its
   "already settled" line is reversed; do not edit that file.
6. **Post live proof on issue 1198** and close it; then delete this file under
   the successor rule.

## 7. Constraints and gotchas in force

- Never push to protected `main`; branch, pull request, merge it yourself. Edge
  functions deploy on merge; the bridge ships only with a version bump.
- Database structure changes start in `popcre/shared-db`, never here. Restoring
  rows in `assets` is application data and belongs to this repository's session.
- Production is read-only by default; the restore in step 2 is a production data
  write, so make it reversible first (the history rows are the undo list).
- Updates to `assets` fire per-row search triggers. Batches of 100 timed out on
  Nov 18; the retire path now uses 10-row statements. Use the same size.
- Bridge rule: never change a file's timestamps on the NAS.
- Sign everything posted to GitHub with `$AI_GH_SIGNATURE`. Quote times in EST.
- Do not edit another session's `HANDOFF.d/` file.

## 8. Access and environment

- GitHub CLI authenticated as `u2giants` on machine `hetz`.
- Supabase MCP (`mcp__supabase__*`) is connected to `qsllyeztdwjgirsysgai`;
  `execute_sql` and `query_logs` both worked. Queries over about 60 seconds are
  cancelled.
- Bridge container logs on the NAS need the docker sudo window (see the
  `synology-long-running-operations` skill); not used in this session.
- Secrets are in the 1Password vault `vibe_coding`. None appeared in this session.

## 9. Open questions and risks

- 2026-11-19: the half-and-half split comes from a non-random sample; the true
  share of deleted artwork could differ. Count before restoring.
- 2026-11-19: a "live twin" by filename, size and `quick_hash` can be a
  different file that happens to collide. For the restore decision this errs
  toward leaving a record hidden, which is the wrong direction under the ruling.
  Consider a full-content check for records in the twin group before treating
  them as moves, at least on a sample.
- 2026-11-19: until step 1 ships, every scan keeps hiding newly deleted files.
  The 11:01 AM scan hid none, so the rate is low, but it is not zero.
- 2026-11-19: inode identity has not been tested on this NAS, on SMB saves from
  Mac design applications, or across the Seafile check-in path.
- Decision 2026-11-19: this session did not stop the live hiding or restore
  anything, because the owner asked for the work to go to a new session.

## Self-audit (passed)

1. Newcomer can continue cold: sections 1, 3 and 6 give the system, the exact
   state and ordered steps with gates.
2. As effective as this session: sections 4 and 5 carry the failed queries, the
   identity analysis and the duplicate risk.
3. Every relevant detail: goals (2), state (3), failures (4), findings (5),
   actions (6), constraints (7), access (8), risks and dated decisions (9).
4. Owner decisions: walked sections 1–9; the only sentence needing Albert is the
   display question (section 6 step 4), and it is in section 0 with a
   recommendation. No technical approval is listed.
