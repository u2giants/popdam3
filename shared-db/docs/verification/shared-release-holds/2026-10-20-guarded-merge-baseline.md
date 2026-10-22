# Guarded merge hold baseline — October 20, 2026

Issue [#3779](https://github.com/popcre/shared-db/issues/3779), plan
`plan_shared_release_hold_reduction.md` step 1 (merge stage only) and step 3.
Source: public GitHub Actions step timings of `Guarded Merge`
(`guarded-migration-merge.yml`) runs on `main`, read with the Actions API on
October 20, 2026 at 8:00 PM EDT. No lease was acquired to collect this. Times are
UTC as the API reports them; no private log content is reproduced.

## Shape before the split (one job, one workflow-wide group)

Every dispatch, including one that only needed to wait on API quota or on a
required-check preflight, occupied the single `shared-db-guarded-merge`
scheduling group for its whole run. The lease itself was taken only at
`Acquire the exclusive merge lane`.

| Run | Outcome | Preflight (unlocked) | Quota wait (unlocked) | Lease held (acquire start → release end) | Notes |
|---|---|---|---|---|---|
| [39452653048](https://github.com/popcre/shared-db/actions/runs/39452653048) | success | 15:54:38–15:54:44 (6 s) | 15:54:48–15:54:49 (1 s) | 15:54:49 → 15:56:56 (**127 s**) | the only successful merge in this window; re-prove under lock 15:55:50–15:56:52 |
| [39448371439](https://github.com/popcre/shared-db/actions/runs/39448371439) | failure at acquisition | 15:26:38–15:26:45 | 15:26:56–15:26:57 | acquisition refused 15:26:57–15:27:23 (26 s, nothing held) | refusal at the lease, not at the group |
| [39506640548](https://github.com/popcre/shared-db/actions/runs/39506640548) | failure before lock | 22:14:58–22:15:04 | skipped | none | refused at the self-service classifier |
| [39449594051](https://github.com/popcre/shared-db/actions/runs/39449594051) | failure before lock | 15:34:24–15:34:30 | skipped | none | refused before the quota step |
| [39447270515](https://github.com/popcre/shared-db/actions/runs/39447270515) | failure before lock | 15:19:31–15:19:38 | skipped | none | refused before the quota step |
| [39444072292](https://github.com/popcre/shared-db/actions/runs/39444072292) | failure before lock | 14:58:36–14:58:41 | skipped | none | refused before the quota step |
| [39515502849](https://github.com/popcre/shared-db/actions/runs/39515502849) | failure at preflight | 23:31:12–23:31:17 | skipped | none | preflight refusal |
| [39514880592](https://github.com/popcre/shared-db/actions/runs/39514880592) | failure before preflight | skipped | skipped | none | bind/checkout refusal |

Across the last 60 runs on `main`: 24 success, 34 failure, 2 cancelled. Most
refusals happen before any lease exists, yet each of those runs still queued
behind, or made others queue behind, the single workflow-wide group. Per-run
checkout and tool setup (roughly 25–40 s per run from run start to the first
named step) also happened inside that group.

## Known gaps in this baseline

- Group WAIT time (dispatch to job start while another run held the group) is
  not exposed per step by the API; only run `created_at` versus first step
  `started_at` bounds it. It is not claimed here.
- No quota-exhausted run (a 900-second wait) occurred in this window, so the
  worst case the split removes from the shared queue is documented from the
  workflow text (`GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '900'` in the unlocked
  preflight and quota steps), not from a measured sample.
- Production and preview stages are not covered here; plan step 1 for those
  stages remains open.

## Shape after the split (this change)

- `prepare` job: per-request group `shared-db-guarded-merge-prepare-<pr>`,
  read-only permissions, carries checkout, tool setup, trusted-source binding,
  required-check preflight (bounded wait), self-service classifier and the
  quota wait. Holds no lease, writes nothing, outputs identities only.
- `merge` job: `needs: prepare`, group `shared-db-guarded-merge`, re-binds
  protected main itself, acquires the owner-bound generation-fenced lease, and
  re-proves exact head, current main, effective required checks, approval,
  claims/collisions, freeze and queue mode under it, with every wait set to 0.

Deterministic proofs: `scripts/guarded-merge-preparation-split.test.mjs`
(`preparation_wait_does_not_block_independent_merge`,
`pending_group_job_is_not_a_durable_fifo_and_authorizes_nothing`,
`simultaneous_merges_admit_one_writer`,
`merge_versus_production_race_admits_only_the_authorized_writer`,
`expired_timestamp_alone_does_not_authorize_stealing_a_live_lock`).

Live proof after the merged workflow executes is recorded on #3779, not here,
until it exists.
