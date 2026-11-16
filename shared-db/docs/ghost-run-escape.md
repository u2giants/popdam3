# Escaping a GitHub ghost run (issue #6426)

A **ghost run** is a GitHub Actions run record that GitHub created but never
dispatched: the runs listing shows it `queued` forever, it has zero jobs,
`GET`/`DELETE /actions/runs/{id}` return 404/403, and cancel is refused
("already completed"). Seen 2026-10-06 and 2026-11-11 (#6215). We cannot
prevent them; only GitHub Support can purge them.

The harm is that a ghost can hold a workflow's `concurrency` group, so every
later run of that workflow on that group waits forever.

## What protects us

- Read-only workflows with nothing to serialize carry no `concurrency` group
  (currently `generate-database-types.yml`), so a ghost has nothing to hold.
- Every remaining group ends in `-${{ vars.LANE_EPOCH || '0' }}`. One repository
  variable renames **all** groups at once, so files that share a group (for
  example `designflow-sandbox-migrations` across three workflows) always move
  together and never split into two parallel writers.
- Database mutations are fenced independently of Actions groups by the git-ref
  exclusive leases and DB advisory locks (`shared-supabase-migrations.yml`
  acquire/release, `recover-exclusive-db-lane.yml`, the ColdLion advisory lock).
  Rotating the epoch can reorder run starts; it cannot let two mutators write.
- `lane-watchdog.yml --sweep-ghosts` (every 10 minutes) reaps what it can and
  goes RED naming any ghost it cannot remove. The 30-minute floor stays: a run
  legitimately queued behind a long lane must not be deleted.

## Procedure when the sweep reports an UNREAPABLE ghost

1. Decide whether it blocks anything: a ghost on a merged/deleted branch blocks
   nothing; leave it for the support purge.
2. If it blocks a live lane, drain: confirm from the queued/in-progress run
   listing that no **non-ghost** run is queued or in progress in any group you
   are about to rotate (wait for live runs to finish; do not cancel them).
3. Bump the variable: `gh variable set LANE_EPOCH -R popcre/shared-db --body <current+1>`
   (unset means `0`).
4. Re-run or re-dispatch the blocked workflow and confirm it starts.
5. File the GitHub Support purge for the ghost IDs and record both on the issue.

Never edit one workflow's group name by hand to escape a ghost: that can split
a shared serialization group.
