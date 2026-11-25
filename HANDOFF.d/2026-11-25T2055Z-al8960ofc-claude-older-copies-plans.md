---
summary: "Registers the combined Older copies review-findings plan (issues 1332, 1338, 1339, 1344, 1352, 1357); nothing implemented yet."
kind: handoff
status: open
read-when: "picking up any Older copies fix (snapshot restore, saved-by names, Seafile/NAS-log lookups)"
---

# Handoff: Older copies review-findings plan (2026-11-25, al8960ofc, Claude)

## What this session did

Planning only. Read the six open `review-finding` issues on the admin
"Older copies" section and checked each against `origin/main` at `787c20b8`
(bridge 1.17.3). None is fixed or moot; none is a duplicate of another (they
review six different PRs), so all six are covered by one combined plan:

- Plan: [docs/plans/issue-1332-older-copies-review-findings.md](../docs/plans/issue-1332-older-copies-review-findings.md)
- Issues: u2giants/popdam3#1332, #1338, #1339, #1344 (with folded #1349), #1352, #1357.

Already fixed in code but untested (the plan adds the tests): #1344 finding 1
(NaN window) and #1349's original shadowing case.

## What is left

Everything in the plan's STATUS table (steps 1–10). Start at step 1; read the
plan's STATUS first and do not re-plan. Locked decisions L1–L9 stand.

## Gotchas

- The review texts on #1332, #1339, #1352, #1357 are truncated at the source;
  the fixer comments on each issue summarise the rest.
- The Drive `action` values and the `nas-api` contract are unverified; step 6
  of the plan gets a real sample first.
- Bridge changes ship only with a version bump (1.17.3 → 1.17.4).
