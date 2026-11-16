# Close-nested handoff: property names (#6269) and sandbox catch-up (#6356)

Written 2026-11-16 10:05 AM EST on edge-dev3 by the property-name-fields session
(local_88e1ebf4). It closes the whole session tree below and replaces every earlier
note about these two jobs. Read it cold. No chat context is needed.

## The two jobs, and why they looked tangled

There were two separate jobs in one family of sessions.

1. **Property names (#6269):** https://github.com/popcre/shared-db/issues/6269.
   Every Property (Coldlion MG06) carries four names on `core.property`: the Coldlion
   name, the exact licensor-submission name, a nickname, and a short name. The plan is
   `docs/plan_property-name-fields.md`.
2. **Sandbox catch-up (#6356):** https://github.com/popcre/shared-db/issues/6356.
   This copies production's database structure into the DesignFlow sandbox database
   (`xupnyeifmpsacrqahwwm`), which was far behind (63 recorded changes against
   production's 979). Albert approved it in the sandbox-parity-search session on
   2026-11-15 at 8:32 AM EST: "Yes, start the full sync but checking along the way that
   you're not breaking anything."

Job 2 began as a side question from job 1 ("was prod structure ever copied to the
sandbox?"). Its sessions therefore hang under job 1's session. The jobs share no
code.

## Overlaps and conflicts, resolved

- **Shared folder.** sandbox-parity-search ran in the same worktree as the
  property-name session (`.claude/worktrees/property-name-fields-001501`). Nothing
  was lost: no uncommitted work is left there. **Resolution:** every future session
  uses its own worktree.
- **Two routes for the sandbox schema.** Job 1 put the four columns and the view
  `api.property_names` on the sandbox through a sandbox-only migration,
  `20261113233345` (PRs #6290 and #6304; apply run 43536677547). When job 2 later
  replays production's `20261113183820`, that migration's `add column if not exists`
  and `create or replace view` are compatible with what is already there, and its
  triggers and back-fill are new. **Resolution:** no conflict. Job 2 must still
  include `20261113183820` once the scrape tables
  (`plm.opa_property`, `plm.pmt_trackerplus_submission_property`) exist on the
  sandbox. Until then the sandbox's submission name stays empty, as designed.
- **Stale task in job 2's report.** sandbox-parity-search listed "Unblock #6269 and
  PR #6290". That is already done by the sandbox-only route above. **Resolution:**
  the task is dropped. Job 2's only #6269 duty is the replay noted in the previous
  item.
- **Pause dispute (2026-11-15).** This session asked job 2 to pause because it could
  not see Albert's approval, then withdrew the request after the approval was shown.
  **Resolution:** the sync is approved. No pause is in force.
- **Sync sessions.** sandbox-sync, sandbox-sync-2 and sandbox-sync-3 ran one after
  another, never at the same time. Their branches are merged.

## Tree closed

| Session | Job | Final state | Branch |
|---|---|---|---|
| property-name-fields (local_88e1ebf4, this one) | 1 | closed | all PRs merged |
| sandbox-parity-search (local_5eec0045) | 2 coordinator | idle, closed | none of its own (shared folder) |
| sandbox-sync (local_1f422bbd) | 2, batches 1–2 | idle, closed | merged #6357, #6361, #6362 |
| sandbox-sync-2 (local_4783292a) | 2, batches 3–9 | idle, closed | merged #6371, #6378 |
| sandbox-sync-3 (local_7a9bc9c7) | 2, batch 10 | idle, closed | merged #6430, #6438 |

## Landed (verified on GitHub or in the database)

- **Job 1, production.** Migration `20261113183820` (#6280) is in the production
  ledger. `api.property_names` returns 837 rows, 31 of them with an exact
  submission name (checked 2026-11-15 8:39 AM EST). The plan's STATUS records this
  (#6358).
- **Job 1, sandbox.** Migration `20261113233345` is applied. DY/MM "MICKEY MOUSE"
  has nickname "Mickey Group" there, so the view shows "Mickey Group" as its
  display name.
- **Job 1, DesignFlow.** designflow-backend#416, designflow-frontend#585 and
  designflow-item-master#238 were all merged into develop by review on
  2026-11-13.
- **Job 2.** Sandbox batches 1–10 are applied. Each one's automatic after-check
  passed.

## Open tasks

### 1. Prove the nickname on screen and close #6269

- **State:** Steps 1–4 are done. Step 5 still needs the on-screen proof.
- **Next action:** sign in to https://alsand.designflow.app. Open a property picker
  (new art piece, new item, or item detail) and confirm Disney MM shows "Mickey Group".
  Then mark plan Steps 4–5 ✅ in `docs/plan_property-name-fields.md`, comment the
  evidence on #6269, and close the issue.
- **Done when:** a screenshot shows "Mickey Group" in the sandbox dropdown, and #6269
  is closed.
- **Blocker:** the AI cannot type a password. Use a sign-in route that does not need
  one, such as an existing browser session or the 1Password extension. Otherwise
  report it `Blocked —`.
- **Resume:** fresh from main.

### 2. Recount the sandbox test-data rows after batch 10

- **Next action:** compare the row counts against the before-image the sync recorded.
  It lives in the sandbox-parity-search notes, summarised on #6356.
- **Done when:** the counts are unchanged, or the differences are explained on #6356.
- **Resume:** fresh from main.

### 3. Finish the sandbox catch-up, batches 11 onward (after task 2)

- **Next action:** read the latest progress comment on #6356, then continue the batch
  route. Each batch goes through PR, merge, dry-run, apply, after-check.
- **Done when:** the production and sandbox structures match, except for groups the
  owner excludes, and every after-check passes.
- **Blocker:** a business call on whether the dam, hts_rag, archive and public table
  groups belong in the sandbox. Ask Albert in plain words.
- **Includes:** replaying `20261113183820` (see Overlaps and conflicts).
- **Resume:** fresh from main.

### 4. Recurring production-vs-sandbox drift check (after task 3)

- **Next action:** add a scheduled read-only workflow that reports structure drift
  on #6356.
- **Done when:** the workflow runs on schedule and posts a report.
- **Resume:** fresh from main.

## Child handoffs

The sync's own notes were kept locally by sandbox-parity-search, outside the repo.
Progress of record is on #6356. No other `HANDOFF.d` files exist for this tree.
