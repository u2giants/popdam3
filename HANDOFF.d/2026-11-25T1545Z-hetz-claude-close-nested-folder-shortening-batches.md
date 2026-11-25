---
issue: 963
status: OPEN
owner: coordinator (close-nested)
---

# Handoff — folder shortening (#963): coordinator tree closed after pilot

Written 2026-11-25 10:45 AM EST by Claude on hetz (coordinator), on Albert's "/close-nested".

Issue: https://github.com/u2giants/popdam3/issues/963 · Plan (read its STATUS table first): https://github.com/u2giants/popdam3/blob/main/plan_folder_shortening_snapshot_restore.md

## 0. Owner decisions
- **Authority for the remaining batches (5.4–5.5).** Albert's original words were "do all the steps in https://github.com/u2giants/popdam3/issues/963 up to the point where we start renaming things". The pilot was then authorised separately ("can we do a small pilot?", "do those renames right now", 2026-11-24). The child handoff line 24 paraphrases the original authority without "up to the point where we start renaming things"; treat the batches beyond the pilot as needing Albert's yes. Ask him once, in plain words, before the Burlington batch.
- **Evening for the two top-folder renames** (5.6): ask only after 5.4/5.5 are done (child handoff §0 item 1).

## 1. Tree closed
| Session | Final state | Branch |
|---|---|---|
| Coordinator (this) | done | `claude/close-nested-963-2026-11-25` (this handoff) |
| fs-freeze — Phase 4.5 freeze → Phase 5 tool + pilot | done, wrapped up, no claims | all merged and deleted |
| fs-guard — Phase 6 guard | done, wrapped up, nothing to commit | all merged and deleted |

## 2. Landed (verified merged on GitHub 2026-11-25)
- Phase 4.5 rules frozen: https://github.com/u2giants/popdam3/pull/1005 (+ #1009, #1011, #1016)
- Phase 6 Folder Names admin screen: https://github.com/u2giants/popdam3/pull/1006, #1010, #1014
- Rename tool: https://github.com/u2giants/popdam3/pull/1308; pilot log #1326; STATUS #1353; child handoff #1355
- Older copies in style panel Files tab: https://github.com/u2giants/popdam3/pull/1331 (live-verified)
- Shared-db: https://github.com/popcre/shared-db/pull/7022 (live)
- Pilot `Desperate Signs` renamed 2026-11-24 3:12 PM EST; post-scan check (90 assets, 0 new, 0 retired) and backup/NAS-copy watch passed 2026-11-25.

## 3. Open tasks
### Task 1 — Phase 5.4–5.7 remaining renames
Follow https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-25T1511Z-hetz-claude-folder-shortening-phase5-batches.md §6. First get Albert's yes for batches beyond the pilot (§0 here). Then the Burlington batch (Customer Adopted/Burlington + _FINISHED/Burlington_finished) off-hours with `tools/folder-rename/execute.mjs`, dry run first; then the Concept Approved Designs batches; top folders last on Albert's chosen evening; then 5.7 close-out. Task class production. Done-when: each batch's run log OK and next scan shows 0 new / 0 retired with unchanged customer; plan 5.7 close-out proof posted on #963. Resume: fresh from main. Blockers: Albert's yes (batches), Albert's evening (top folders).

## 4. Child handoffs
- https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-25T1511Z-hetz-claude-folder-shortening-phase5-batches.md
- Previous coordinator handoff: https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-13T1645Z-hetz-claude-close-nested-folder-shortening.md

## 5. Constraints
Plan §11: feature branch + PR, AI merges; structure only via popcre/shared-db; write on edge1, read on edge2; ~20k-row batches; never weaken `#snapshot` scan exclusion; sign GitHub posts with $AI_GH_SIGNATURE; times in EST; ask Albert business questions only.

## Self-audit
A stranger can resume from this file and the linked URLs alone: yes. Owner decisions isolated in §0; the one task has next action, done-when, and blockers.
