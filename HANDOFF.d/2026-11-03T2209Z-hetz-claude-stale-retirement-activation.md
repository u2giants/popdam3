---
issue: 681
status: OPEN
owner: claude/stale-retirement-activation
---
# Activate stale-record retirement on the NAS agent

## 0. Business decisions only the owner can make
None — nothing in this workstream needs the owner. Already settled: DO NOT reset PDF_BACKFILL, start AI tagging early, or restart NAS containers during the rescan (task brief, 2026-11-03).

## 1. What this application is
PopDAM is POP Creations' digital asset library. A bridge agent in Docker on the Synology NAS `edgesynology1` scans design files and reports to Supabase edge functions. A PDF "Indra OCR" rescan is running; a paid AI tagging run waits for it.

## 2. What we set out to do
Stop moved files leaving stale live records, and retire the 5,683 existing ones before paying to tag them.

## 3. Current state
Done and verified 2026-11-03: [PR 677](https://github.com/u2giants/popdam3/pull/677) merged; edge functions deployed; bridge image 1.16.20 published. All 5,683 records soft-deleted; 0 still live; 5,683 `asset_path_history` markers; report `https://github.com/u2giants/popdam3/blob/main/scripts/list-missing-pdfs.sql` went 6,137 → 474; live PDFs 24,777 → 19,094. No tagged stale record has an untagged survivor.
NOT active: the running agent has old code, so new moves still leave stale records until it updates.
Rescan at 5:09 PM EST: running, 12,676 remaining.

## 4. What did not work
- Batch numbers computed before DISTINCT ON ran past the batch ranges: the first pass retired 4,170 and skipped copies. Fixed by numbering after the DISTINCT; second pass finished, and copying was idempotent.
- A misnamed SQL alias (`char`) stopped pass one after copies, losing its list of copied character links. Copied tags are recoverable by file; character links are listed as a superset.
- Server-only absence detection was rejected: `last_seen_at` is not stamped for unchanged files, and stamping would fire heavy triggers.

## 5. Findings
- Publishing a bridge image does NOT update running agents; only an in-app update does (https://github.com/u2giants/popdam3/blob/main/docs/deployment.md).
- Rescan pace dipped during the bulk cleanup and recovered.
- Prevention fires only when ingest CREATES a record. Design notes: https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md section 81.
- The 474 remaining are other categories (moved copies needing judgement, gone files) and are out of scope.
- Backup and undo: `/volume1/docker/popdam/manual-scans/pdf-index-20261103/stale-retirement-backup/` on `edgesynology1` (NAS path, not in GitHub); start with UNDO.sql.

## 6. Exact next steps
1. Wait until `admin_config` key PDF_BACKFILL has status completed (expected about 7:40 AM EST Nov 4, possibly sooner). You'll know when status reads completed.
2. Trigger the agent update (`UPDATE_REQUEST`, the Settings → Agents → Update path in the deployment doc). You'll know it worked when `synology-bridge-1` reports 1.16.20 and keeps heartbeating.
3. Prove it: on the NAS copy a test PDF to two folders, let a scan ingest, move one to a new folder, scan. You'll know it worked when the old record has is_deleted=true and a `retired-stale-duplicate:` history row. Remove test files.
4. Fix the existing lint error at https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/pdf-sheet-fields.ts#L135 (needless escape), which fails CI on main.
5. Close issue 681 and delete this file.

## 7. Constraints
Branch and PR only; never push main. Do not modify the self-updater. Data retirement never bypasses the #51 move guard.

## 8. Access
DB password: 1Password vault `vibe_coding`, item "Supabase DB Password - shared POP database". NAS: ssh host `edgesynology1`. `gh` authenticated.

## 9. Open questions and risks
`quick_hash` is sampled, so two different same-name, same-size files could rarely collide; absence on disk plus backup limits harm (decided 2026-11-03). Character links copied cannot be exactly separated on undo.
