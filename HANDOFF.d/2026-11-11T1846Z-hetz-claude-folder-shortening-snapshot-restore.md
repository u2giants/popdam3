---
issue: 963
status: OPEN
owner: claude/directory-structure-optimization-51bb7e
---

# Handoff — NAS folder shortening and restore-from-snapshot: plan written, nothing built

Written 2026-11-11 about 1:50 PM EST by Claude (hetz). This session was a brainstorm
with Albert followed by writing a plan. No code was written and nothing on the NAS
was changed. The plan is the brief:
[plan_folder_shortening_snapshot_restore.md](../plan_folder_shortening_snapshot_restore.md)
(GitHub, once merged:
https://github.com/u2giants/popdam3/blob/main/plan_folder_shortening_snapshot_restore.md).
Tracking issue: https://github.com/u2giants/popdam3/issues/963.

## 0. Business decisions only the owner can make

Put the whole list to Albert in ONE message, in plain English, at plan step 4.4 —
not earlier, not one at a time. Nothing here blocks Phases 0–3.

**A wrong guess is recoverable, but ask before Phase 5 (the renames):**

1. Short name for each customer folder that the customer master data does not
   settle. Recommendation: propose one per customer; he answers only the ones he
   disagrees with. Blocks plan step 5.5.
2. Also remove the repeated year from program folders
   (`Ross/2026/Ross Wall 2026` → `Ross/2026/Wall`)? Recommendation: yes. Blocks
   finalising the rename list (step 4.5).
3. Only if plan step 0.6 finds many design documents whose links to other files
   would break: accept that, or leave those folders unrenamed? Recommendation
   depends on the count. Blocks Phase 5.
4. Which evening the two top folders get renamed, so he can tell designers.
   Recommendation: a Friday evening. Blocks step 5.6.

**Not part of this work and nobody is on it:** none found.

**Already settled — do NOT re-ask (all Albert, 2026-11-11):**

- Restore puts the old copy beside the current file, never over it.
- Only Albert restores files; the feature is admin-only.
- The complaining designers are on Windows.
- `In Development` → `In Dev`; `Customer Adopted` → `Cust Adopted`; customer
  `Desperate Signs` → `Desperate`; customer names come out of subfolder names.
- The pain is the long folders on the drive itself, not how PopDAM displays them.
- The old-to-new list must live in the system, not as paperwork.

## 1. What this application is

PopDAM (https://dam.designflow.app) indexes POP Creations' design files on a
Synology NAS: thumbnails, AI tags, SKU grouping, search. Repo
https://github.com/u2giants/popdam3 (React/Vite frontend, Supabase project
`qsllyeztdwjgirsysgai`, a "bridge agent" container on NAS `edgesynology1`).
Database structure lives in `popcre/shared-db`. Full description: plan §2.

## 2. What we set out to do, and why

Albert reported folder names under
`Decor/Character Licensed/____New Structure` growing long for no reason
(repeated customer names, fluff, no abbreviations) and designers' Windows programs
failing to open some files. He cannot rename thousands of folders by hand, does not
want anything that reads the folder layout to break, and does not want to lose the
ability to restore older copies from snapshots and backups. He then asked for a
PopDAM function that shows a file's snapshot copies and restores one, and for a
plan plus a GitHub issue.

## 3. Current state

- Issue created: https://github.com/u2giants/popdam3/issues/963 (checklist of the
  seven phases).
- Plan written and committed on branch
  `claude/directory-structure-optimization-51bb7e`, published by the pull request
  that adds this file. Its STATUS table is all open.
- Not started: everything. Start at plan Phase 0, step 0.1.
- Nothing deployed. Nothing on either NAS was modified; only read-only listings
  over SSH were run on `edgesynology1`.

## 4. What we tried that did NOT work

Nothing was attempted, so nothing failed. Ideas raised and dropped during the
brainstorm, with reasons, are in plan §7 — most importantly: relying on a full
PopDAM rescan to pick up the renames (it would lose metadata for duplicate
files), using the existing per-file move history as the rename record (purged at
90 days, wrong grain), and hiding the clutter in PopDAM only (does not help
Windows programs).

## 5. Root causes and key findings

Full list with code references in plan §5–§6. The ones that cost time:

- PopDAM's stage/customer/program rule compares folder names as exact strings:
  https://github.com/u2giants/popdam3/blob/main/shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql#L5182-L5242
- Move detection needs exactly one same-hash, same-filename candidate:
  https://github.com/u2giants/popdam3/blob/main/supabase/functions/agent-api/index.ts#L1119-L1131
- Per-file move history is purged after 90 days:
  https://github.com/u2giants/popdam3/blob/main/supabase/migrations/20260506110948_queue_and_history_retention_crons.sql#L24-L33
- The admin-to-helper request pattern to reuse:
  https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/admin-handlers/dir-browse-handlers.ts
- The helper mounts the whole share, so snapshot folders should be visible to it:
  https://github.com/u2giants/popdam3/blob/main/deploy/synology/docker-compose.yml#L29
- On edge1, `/volume1/mac/#snapshot` holds 55 snapshots, oldest 2026-05-29; the
  oldest still contains the `Desperate Signs` folder under its old name.
- 228 of 1,537 year/program-level folders under `Customer Adopted` repeat their
  customer's name. Year folders exist (`Ross/2026/…`), which the documented
  program rule does not account for — possibly an existing bug (plan finding 6.7).

## 6. Exact next steps

Follow the plan in order. First three:

1. Plan step 0.1 — measure path lengths. Worked when
   `verification/folder-shortening/path-length-baseline-<date>.md` exists with
   bucket counts. If no file is near the Windows limit, stop and tell Albert.
2. Plan step 0.2 — compare the live path function with the mirror and settle the
   year-folder question. Worked when the baseline file records the answer.
3. Plan step 0.3 — confirm from inside the running helper container that
   `/mnt/nas/mac/#snapshot` lists `GMT-…` names.

Then steps 0.4–0.7 and onward. Update the plan's STATUS table in each pull request.

## 7. Constraints and gotchas

Plan §11 has the full list. In short: branch + pull request, the AI merges;
structure changes only through `popcre/shared-db`; write on edge1, read on edge2;
database rewrites in batches of about 20,000 rows; never loosen the scanner's
`#snapshot` exclusion; never ask Albert for a technical approval; all progress
stays on issue 963.

## 8. Access and environment

Plan §12. `gh` is authenticated as `u2giants`; SSH aliases `edgesynology1` and
`edgesynology2` work from hetz as user `ai`; tester logins are in 1Password vault
`vibe_coding` (administrator tester item for admin-only screens). The `railway`
and `tokensave` MCP servers failed to connect in this session; neither is needed.

## 9. Open questions and risks

Plan §13. Biggest unknowns, all dated 2026-11-11: whether path length really is
why files will not open (step 0.1 decides); whether design documents link to other
files by full path (step 0.6); how ShareSync, Hyper Backup, and Synology Drive
react to mass renames (pilot, step 5.3); whether the helper container itself can
see the snapshot folders (step 0.3 — seen from the host and the compose file only).

## Self-audit

1. Newcomer can pick up without a question — yes: this file plus the plan (§2, §5,
   §9, §12 of the plan).
2. Could continue as well as I could — yes: every finding from the session is in
   plan §5–§7 with references; §5 here lists the costly ones.
3. Every detail for execution included — yes: goals (§2), state (§3), dead ends
   (§4), decisions (§0 settled list, plan §8), risks (§9), next actions with gates
   (§6).
4. Section 0 sweep — walked §1–§9 and the plan's §8/§13: the four owner questions
   there all appear in §0; no technical approval is listed.
