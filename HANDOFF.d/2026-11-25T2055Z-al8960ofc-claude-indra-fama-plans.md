---
summary: Open plans for Indra provisioning review #1329 and factory approval form reader reviews #1341/#1346; nothing implemented.
kind: handoff
status: open
read-when: picking up issue 1329, 1341 or 1346, or the Windows agent's Indra provisioning or FAMA/LMS reader
---

# Handoff — Indra OCR and factory approval form reader plans (#1329, #1341, #1346)

Written 2026-11-25 3:55 PM EST by Claude on al8960ofc, as one group of the "plan every open issue" coordinator run. Plans only; no code changed.

## What is open

| Issue | Plan (read its STATUS table first) | State |
|---|---|---|
| https://github.com/u2giants/popdam3/issues/1329 | [docs/plans/issue-1329-indra-provisioning-lock-and-version-check.md](../docs/plans/issue-1329-indra-provisioning-lock-and-version-check.md) | all steps ⬜ open |
| https://github.com/u2giants/popdam3/issues/1341 and https://github.com/u2giants/popdam3/issues/1346 | [docs/plans/issue-1341-1346-factory-approval-form-reader.md](../docs/plans/issue-1341-1346-factory-approval-form-reader.md) | all steps ⬜ open |

## What was checked

- All three issues verified still present on `origin/main` `787c20b8`; the automatic fix PRs #1330 and #1347 were closed unmerged, so nothing from them is on `main`.
- #1329 finding 1 misquotes the lock wait (it is 50 min, not 450 s); the real defect is that the 45/50-min windows break the 30-minute owner rule — the plan replaces them with a heartbeat lock.
- #1341's `valueAfter` finding is wrong (later duplicate labels are scanned); the plan locks it with a test instead of a code change.
- #1341 and #1346 both target `packages/agent-common/src/factory-approval-parse.ts`, so they share one plan; neither issue was closed or folded.

## Next step

Start a fresh session on either plan with the lead launch prompt at the end of that plan. The two plans are independent and can run in parallel (different files, except both bump `apps/windows-agent/package.json` — the second to merge rebases its version bump).
