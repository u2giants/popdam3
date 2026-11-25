---
issue: 1215, 1223, 1248, 1256
status: OPEN
owner: unassigned (plan written; implementation not started)
---

# Handoff — #1198 review findings plan (issues 1215, 1223, 1248, 1256)

Written 2026-11-25, 3:57 PM EST, by Claude on al8960ofc. Plan only; no code or
data was changed.

## What is open

The four `review-finding` issues on the #1198 missing-file work are planned in
one combined plan:
[docs/plans/issue-1215-1223-1248-1256-missing-file-review-findings.md](../docs/plans/issue-1215-1223-1248-1256-missing-file-review-findings.md).
Read its STATUS table first; every step is open. Start at Step 1.

## What a new session needs to know

- Owner ruling (locked, 2026-11-19): never lose a record; never duplicate on a
  move. The plan's §1 quotes it.
- All findings were re-checked on `origin/main` `787c20b8`. Still-real ones are
  plan §6.1; three findings (missing-column migration ×2, rollout ordering) are
  moot with evidence in §6.3 and are closed only at Step 14 with the rest.
- The 1223 review body is truncated at the source; plan §6.2 says what is and
  is not recoverable. Do not spend time reconstructing it.
- No schema change is needed.

## Issues

<https://github.com/u2giants/popdam3/issues/1215>,
<https://github.com/u2giants/popdam3/issues/1223>,
<https://github.com/u2giants/popdam3/issues/1248>,
<https://github.com/u2giants/popdam3/issues/1256> — each carries a comment
linking the plan.
