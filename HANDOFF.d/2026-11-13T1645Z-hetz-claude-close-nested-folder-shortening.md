---
issue: 963
status: OPEN
owner: coordinator (close-nested)
---

# Handoff — folder shortening (#963): session tree closed after Phases 0–4.4

Written 2026-11-13 11:43 AM EST by Claude on hetz (coordinator). Albert asked: "pull the latest repo. do all the steps in https://github.com/u2giants/popdam3/issues/963 up to the point where we start renaming things", then "/close-nested".

Issue: https://github.com/u2giants/popdam3/issues/963 · Plan (authority, read its STATUS table first): https://github.com/u2giants/popdam3/blob/main/plan_folder_shortening_snapshot_restore.md

## 0. Business decisions only the owner can make
- **Customer short names** — sheet https://github.com/u2giants/popdam3/blob/main/verification/folder-shortening/customer-short-names.csv (column "NEW SHORT NAME"), posted on #963 2026-11-11 9:50 PM EST. Not answered as of 2026-11-13 11:43 AM EST. Blocks Phase 4.5 and everything after.
- **Evening for the two top-folder renames** (plan step 5.6) — Albert: "undecided". Needed only at 5.6.
- Already answered, do not re-ask: drop the repeated year = yes; `Concept Approved Designs` → `Concept_Approved`.

## 1. What this application is
PopDAM (u2giants/popdam3) catalogs design files on the edge1 Synology NAS. This work shortens long folder names under `Decor/Character Licensed/____New Structure` so Windows programs can open files (260-character limit), without losing PopDAM metadata or the ability to restore pre-rename versions from snapshots.

## 2. Tree closed
| Session | Final state | Branch |
|---|---|---|
| Coordinator (this) — Phase 0 | done | `claude/issue-963-phase0` merged (#966) |
| fs-restore — Phases 1–2 | done, no open tasks | landed (#971, #978, #996; shared-db #6078, #6097, #6102) |
| ↳ Why every PopDAM scan reprocesses all files | done | landed (#997) |
| fs-pathattrs — Phase 3 | done, no open tasks | landed (#967, #972, #981, #982; shared-db #6079, #6105, #6106) |
| fs-rules — Phase 4 | 4.1–4.4 done; 4.5 waits on owner | landed (#969, #983, #1002) |
No claims or locks held anywhere (shared-db closeout check ok; NAS docker access revoked).

## 3. Landed (verified on GitHub)
- Phase 0 baseline: https://github.com/u2giants/popdam3/blob/main/verification/folder-shortening/path-length-baseline-2026-11-11.md
- Phase 1 permanent rename log + `path_as_of`/`path_candidates`; move history kept 400 days.
- Phase 2 admin "Older copies" restore, live-proven: https://github.com/u2giants/popdam3/blob/main/verification/folder-shortening/snapshot-restore-live-proof-2026-11-11.md
- Phase 3 PopDAM reads old and new folder names; year-folder program bug fixed and backfilled; live-proven 2026-11-11 11:05 PM EST.
- Phase 4 rules tool and list: 4,106 folder renames; files over 200 chars 43,845 → ~6,105.
- Scan fix: scans no longer treat every file as changed (#997).

## 4. Open tasks
### Task 1 — Phase 4.5 freeze
Follow https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-13T1645Z-hetz-claude-folder-shortening-phase4-freeze.md §6 exactly. Starts only when Albert's filled sheet is on #963. Done-when: frozen rules.json + CSVs merged, STATUS Phase 4 ✅, short #963 comment. Resume: fresh from main.
### Task 2 — Phase 5 renames (after: Task 1)
Plan Phase 5 (5.1–5.7), task class production. Build `execute.mjs` + tests and run the 5.2 rehearsal first. Then pilot `Desperate Signs`, then the batches, with the top folders last on Albert's chosen evening. The Phase 0 baseline §0.4 lists every path-keyed table the executor must rewrite. Done-when: plan 5.7 close-out proof. Resume: fresh from main.
### Task 3 — Phase 6 guard (after: Task 2, or in parallel once rules are frozen)
Plan Phase 6.1–6.2. Done-when: admin screen shows over-length/rule-breaking folders live.

## 5. Child handoffs
- https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-13T1645Z-hetz-claude-folder-shortening-phase4-freeze.md
- Original planning handoff (superseded by this file): https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-11T1846Z-hetz-claude-folder-shortening-snapshot-restore.md

## 6. Constraints
Plan §11 applies: feature branch + PR, AI merges; structure only via popcre/shared-db; write on edge1, read on edge2; ~20k-row batches; never weaken `#snapshot` scan exclusion; sign GitHub posts with $AI_GH_SIGNATURE; times in EST; ask Albert business questions only.

## Self-audit
A stranger can resume from this file and the linked URLs alone: yes. Owner decisions are isolated in §0. Every task has a next action, a done-when condition and its dependency.
