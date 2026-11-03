---
issue: 684
status: OPEN
owner: claude/eloquent-hawking-e98013
---
# Missing PDF records: finish after the rescan

## 0. Business decisions only the owner can make
None — nothing in this workstream needs the owner.

## 1. What this application is
PopDAM is POP Creations' digital asset manager for licensed product art. Source files sit on Synology NAS `edgesynology1`, share `/volume1/mac`. Web app: dam.designflow.app. Repo: https://github.com/u2giants/popdam3. Database: Supabase project `qsllyeztdwjgirsysgai`. The bridge agent scans the NAS; the Windows agent reads PDF text.

## 2. What we set out to do
Albert, 2026-11-03: "for these and any ones like this in the future spin up a nested subsession to SSH into edgesynology1 and find the new location". About a quarter of PDFs failed the Indra OCR rescan because they were not at their recorded path, and AI tagging uses this text.

## 3. Current state (2026-11-03, 5:06 PM EST)
- Done: file index of 1,845,411 PDFs; 6,137 of 24,777 PDF records not at their path. Index and classified list are on the NAS in `/volume1/docker/popdam/manual-scans/pdf-index-20261103/` (`index.tsv`, `missing-classified.csv`).
- Classified: 5,683 stale duplicates, 2 corrected (undo data in `asset_path_history`), 63 only in `_old` folders, 37 several copies, 178 same name but different size, 174 gone from `Decor/`.
- Merged: [PR 675](https://github.com/u2giants/popdam3/pull/675) (lookup query and quirk 81) and [PR 677](https://github.com/u2giants/popdam3/pull/677) (retirement and prevention, from a separate session). That session reports all 5,683 retired with a NAS backup. Live check at 12:54 PM EST: 19,094 active PDFs, 414 with a missing-file error.
- Running: rescan, status running, 12,696 remaining at 5:07 PM EST. The ETA of about 7:40 AM EST Nov 4 predates the retirement.
- Not done: prevention is not live on the NAS. The agent has not been updated.
- Not verified: the 2 corrected files have not yet been read by the rescan.

## 4. What did not work
- Treating every missing record as moved. Most targets already have their own record, and `relative_path` is unique, so repointing cannot work.
- Counting a match anywhere under the share. `#snapshot`, `Old`, `Archive` and `#recycle` hold copies, so only `Decor/` outside `#recycle` is current.
- `bin/ai-pr-wait` in this repo does not exist; the command is on PATH.

## 5. Root causes
See [quirk 81](https://github.com/u2giants/popdam3/blob/main/docs/KNOWN_QUIRKS.md). The move guard refuses ambiguous moves, so a new record is created, and nothing retired the old one. Rescan failures keep existing text and are stored in `indra_rescan_error`.

## 6. Exact next steps
1. Wait until `admin_config.PDF_BACKFILL.status` is `completed`. You'll know it worked when remaining is 0.
2. Confirm the 2 corrected assets, `60ee62d9-8b13-4510-b4b4-66c6794593c9` and `4ea328c8-95ad-4388-b416-0b3f18523949`, have `indra_rescan_outcome = 'replaced'`.
3. Request the bridge agent update: `admin_config` `AGENT_UPDATE_REQUEST` `{action:"apply"}`, per [AGENTS.md](https://github.com/u2giants/popdam3/blob/main/AGENTS.md). You'll know it worked when the agent reports the build containing PR 677.
4. Rerun [the lookup](https://github.com/u2giants/popdam3/blob/main/scripts/list-missing-pdfs.sql). You'll know it worked when no new stale duplicates appear after the next full scan.
5. Close issue 684 and delete this file.

## 7. Constraints
Do not press start or reset on `PDF_BACKFILL`: that clears rescan mode. Do not update the NAS agent during the rescan. Whether AI tagging starts belongs to the session that owns it. Follow the `synology-long-running-operations` skill for long NAS reads.

## 8. Access
SSH alias `edgesynology1` (read-only, no sudo, `scp` disabled). Database password: 1Password vault `vibe_coding`, item "Supabase DB Password - shared POP database". Run psql through `op run`, using the pooler form in the project notes.

## 9. Open questions and risks
- 2026-11-03: the 452 unresolved records were left unchanged on purpose; never guess a match. The count of 414 versus the cleanup session's 474 comes from different counting rules.
- The cleanup session was still active at 5:08 PM EST; read its PR before acting in case it has moved these steps on.
- PR 675's `lint-test-build` failed on an existing error in `src/pages/AiTaggingFailuresPage.tsx`, not caused by this work. Not fixed here.

Self-audit: passed. A newcomer has the context (1-2), state (3), dead ends (4), causes (5), gated steps (6) and access (8); sections 1-9 contain no owner decision, matching section 0.
