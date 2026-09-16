# Live acceptance evidence — popcre/ai-devops#401 Steps 2, 2A, 4, 7

- Issue: u2giants/shared-db#3027 (process half: Steps 2, 2A, 4, 7). Steps 1/3/6 are recorded separately.
- Collected: 2026-09-16, against `u2giants/shared-db` main `4e290252`.
- Method: harvest existing live records first (coordination refs, claim issues, PRs, workflow runs);
  where none existed, run a read-only or no-database live canary. No migration, schema change,
  database write, preview/production workflow dispatch, lease release, or cancellation was performed.
- Rule: every PROVEN line below quotes a live record. Anything not backed by one is NOT PROVEN.

## Summary

| Step | Requirement | Verdict |
|---|---|---|
| 2 | Safe version re-reservation without closing a PR | PROVEN (live, 2026-09-16) |
| 2 | Named lease/conflict admission; no unrelated production hold | NOT PROVEN — `hold_reason` is not implemented on main |
| 2A | Authenticated sender-to-receiver no-database-preview canary | PROVEN (live, PR #3022, 26 s) |
| 2A | Ten-minute target | PROVEN for prose PRs (7 m 13 s, 59 s); not measured for no-DB code PRs |
| 4 | Successor verifies and resumes from a live snapshot | PROVEN (live read-only canary) |
| 4 | Two-hour no-progress alarm fires | PROVEN (fires on live state when run) |
| 4 | Alarm is installed (runs without being invoked by hand) | NOT PROVEN — no scheduler or skill invokes it |
| 7 | Reviewer non-start rerouted within the 10-minute start SLO | NOT PROVEN — zero live start-reroute records |
| 7 | Runner non-pickup rerouted to another lane | NOT PROVEN — zero lane-reroute dispatch runs |
| 7 | (supporting) terminal non-verdict rerouted at the same head | live, 36 s |

## Step 2 — two-sided admission, re-reservation, stage-scoped holds

### Re-reservation without closing the PR — PROVEN

Live record: coordination ref `refs/db-claim-supersessions/3005-20260916001923` (object `b02e78d2`), dated 2026-09-16T03:39:27Z:

```
db-coordination claim-version-superseded issue=2988 claim=3005 pr=3007 old=20260916001923 new=20260916033914 old-ref=921fef3a0e47f01bc5af73a667f2932d7a33d988 head=7700029e3b32e66a4970e813652546676373cc8e
```

- Same claim kept: claim issue [#3005](https://github.com/u2giants/shared-db/issues/3005) was created 2026-09-16T00:19:30Z and has exactly one `closed` timeline event, at 2026-09-16T07:26:40Z (after merge). It was never closed and replaced during the renumber.
- Both permanent reservations exist live: `refs/db-claims/20260916001923` and `refs/db-claims/20260916033914`.
- Same PR kept: [PR #3007](https://github.com/u2giants/shared-db/pull/3007) created 2026-09-16T00:31:52Z, carries commit [`7700029e`](https://github.com/u2giants/shared-db/commit/7700029e) `migration: re-reserve 20260916001923 as 20260916033914`, and merged 2026-09-16T05:50:29Z.

Note: the supersession operation (`--supersede-active-claim-version`) dates from `efd03e2a` (2026-08-17), not from #2738. The live behavior is proven; which PR introduced it is not the acceptance question.

### Named lease/conflict hold and no unrelated production hold — NOT PROVEN

- The plan's Step 2 addition requires an explicit `hold_reason` naming the blocking lease holder or conflicting claim/object. A search of `scripts/` and `.github/` on main `4e290252` for `hold_reason`, `holdReason`, and `unrelated pipeline` returns no match. The code requirement is absent, so no live proof is possible yet.
- The named object-collision refusal exists (`object collision with ${holder.label}: …` in `scripts/manage-migration-author-lanes.mjs`), but the only issues quoting it were last updated 2026-09-11 or earlier, before #2738 merged (`5d89c5e2`, 2026-09-12T00:33:24Z). No post-merge live refusal was found.
- Needed: implement `hold_reason` (repository tooling, no database change), then capture one live hold that names its lease holder while an unrelated green PR merges concurrently. Running a genuine conflicting claim needs a real structural claim, which this session was not authorized to create.

## Step 2A — no-database-preview fast lane

### Authenticated sender-to-receiver canary — PROVEN (live; no database touched)

- Sender: popcre/ai-devops `origin/main` `tools/ci/classify-database-preview.mjs --manifest <m>`, run against the live git objects.
- Receiver: `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch 3027 --issue 3027 --pr <n> --database-preview-classification-file <sender output>`.
- The receiver ran only after an in-process pre-check of `databasePreviewAdmission` returned `NO_DATABASE_PREVIEW`, because any other decision continues into the mutating prepare-preview path.

Target: open prose-only [PR #3022](https://github.com/u2giants/shared-db/pull/3022) (single file `HANDOFF.d/2026-09-16T0730Z-edge-dev-2-claude-orch-3004-closeout.md`). The canary only read the PR and did not change it.

```
2026-09-16T11:57:15Z sender  NO_DATABASE_PREVIEW proven_non_database_change 887fa5d4d785090c1d14935f72e9c33a39f6ecd8 0065a2b25cf66dc0f6f38572856d3bfc45f9099794b506bfeed1cc49f3733747 [["HANDOFF.d/2026-09-16T0730Z-edge-dev-2-claude-orch-3004-closeout.md","documentation"]]
2026-09-16T11:57:37Z receiver start
2026-09-16T11:57:40Z receiver exit 0
  "decision": "NO_DATABASE_PREVIEW", "next_action": "return-to-natural-owner", "issue": 3027, "pr": 3022,
  "base_sha": "9fe6f0bbf6d5f1f2332aaf0af5501816729ccf8d", "head_sha": "887fa5d4d785090c1d14935f72e9c33a39f6ecd8",
  "bundle_id": "75fadb648a4f0b521e66b11e6d603967e47343cfd3d560a2063a15916e88d1f9",
  "classification_digest": "2d440b1b43e5585ec9fb6340028587c15c2f309736f772c546d3bd5ec7337f72",
  "applicable_checks": ["exact-head-review","full-ci"]
```

The complete loop took 26 s. The receiver re-read the live PR base, head, and files before admitting.

Negative control (live, in-process, nothing written): the same sender output with `head_sha` replaced by forty zeros was refused with:

```
LaneError: database preview evidence does not match the authenticated live pull request repository, base, and head
```

### Finding — this repository's verification evidence is not fast-lane eligible

The sender run on this PR (#3040, head `6bf3c93a`) returned:

```
2026-09-16T11:57:14Z DATABASE_PREVIEW_REQUIRED impact_ambiguous 6bf3c93a4bfee4ae5bb5b5eff22f75fab717d17b [["tests/verification/shared-db-throughput/2026-09-16-live-acceptance-steps-2-2a-4-7.md","ambiguous"]]
```

The sender's safe-documentation allowlist is `docs/*.md|txt`, `HANDOFF.d/*.md`, `plan_*.md`, and `README.md`. Prose under `tests/verification/` classifies as `ambiguous`, and the fail-closed result is correct. The receiver was deliberately not run for this PR. Widening the allowlist is a sender change in popcre/ai-devops and needs no database change.

### Ten-minute target — PROVEN for two live prose PRs (checks only)

| PR | head pushed | last check completed | elapsed | result |
|---|---|---|---|---|
| #3022 | 2026-09-16T11:14:30Z (commit `887fa5d4`) | 2026-09-16T11:21:43Z | 7 m 13 s | SUCCESS 19, SKIPPED 6 |
| #3040 (this PR, first head) | 2026-09-16T11:56:34Z | 2026-09-16T11:57:33Z | 59 s | SUCCESS 17, SKIPPED 6, `Migration guarded merge authorization` SUCCESS |

Limit: these are check-completion times for prose PRs. No live measurement exists yet for a non-documentation, no-database code PR routed by `return-to-natural-owner`.

## Step 4 — resumable snapshots and the no-progress alarm

### Successor resume — PROVEN (live read-only canary)

Procedure (read-only; `scripts/orchestrator-snapshot.mjs` never writes to GitHub):

1. "Predecessor" process: `gatherLiveInput('u2giants/shared-db')` then `buildOrchestratorSnapshot` → sealed snapshot A.
2. 30 s later a separate "successor" process gathered live input again into a trusted current-state file.
3. Successor ran the supported verifier: `ORCHESTRATOR_CURRENT_STATE_FILE=<file> node scripts/orchestrator-flow/orchestrator-snapshot.mjs --verify <snapshot A>`.

Live results (UTC):

```
predecessor snapshot 126af2627a3aa813d8286e4a3e7a579bb189edb69be9ea0dfca234d0e5dfb089 2026-09-16T11:50:26.888Z marker {"issue":3004,"status":"active","route_id":"local_2cc03038-ae17-4092-b2ce-564e3b501771"}
6 11:51:02 {"status":"CURRENT","snapshot_id":"126af2627a3aa813d8286e4a3e7a579bb189edb69be9ea0dfca234d0e5dfb089"}
```

Fail-closed behavior was also observed live. Attempts 1–5 were refused because the live repository moved between the two reads, for example:

```
REFUSED: snapshot is stale: current state digest is b5691829e47477fda7753f5a1f5e55b2a02c7d3c282f440c0d6c8f184d7ad621
```

The first refusal was traced to real movement: PR #3033 checks went from `IN_PROGRESS 9 / SUCCESS 9` to `IN_PROGRESS 7 / SUCCESS 12`, and PR #3031 went from no checks to `QUEUED 17`.

Limit: this proves that the snapshot reconstructs and verifies the live active map for a successor. It is not a recorded real orchestrator handover, because none has happened since the code landed.

### Two-hour alarm fires — PROVEN

A live run at 2026-09-16T11:45:51Z (`node scripts/orchestrator-snapshot.mjs --orchestrator-snapshot`, snapshot `01c42d41…`) emitted:

```
"wakes": [ {"wake":"state_changed"}, {"wake":"outcome_stalled","work_issue":2866}, {"wake":"outcome_stalled","work_issue":2870}, {"wake":"zero_closures_4h"} ]
"stalled_outcomes": [ {"work_issue":2866,"state":"dispatched","last_transition_at":"2026-09-14T02:54:54.466Z","minutes_since_transition":3410},
                      {"work_issue":2870,"state":"dispatched","last_transition_at":"2026-09-14T03:23:57.094Z","minutes_since_transition":3381} ]
"closures_in_window": 0, "zero_closures_4h": true
```

Both alarm conditions fire on live data: an outcome idle for more than 120 minutes, and zero closures in four hours.

### Alarm installed — NOT PROVEN

- No workflow in `.github/workflows/` references `orchestrator-snapshot`.
- The canonical `skills/shared/shared-db-orchestrator/` files in popcre/ai-devops (`SKILL.md`, `operating-manual.md`, `sub-agent-brief-template.md`, `incident-ledger.md`) contain no reference to `orchestrator-snapshot` or `stalled_outcomes`.
- No installed Claude skill or scheduled task on this machine references it.
- Two outcomes have been stalled for more than 56 hours (#2866, #2870) and nothing surfaced it, which is consistent with the alarm not running.
- Needed: a scheduled read-only runner (for example an hourly workflow with `read` scopes, following the `Author Lane Abandonment Audit` pattern) or a mandatory skill step, followed by one captured automatic firing. This is repository/skill tooling and needs no database change.

## Step 7 — bounded reviewer and runner start waits

### Reviewer non-start reroute — NOT PROVEN

- The start SLO is implemented (`START_SLO_MS=10*60*1000` and `REROUTE_REF_PREFIX='refs/db-start-reroutes'` in `scripts/orchestrator-flow/start-reroute.mjs`, used by `scripts/run-governed-review.mjs`).
- `git ls-remote origin 'refs/db-start-reroutes*'` returns 0 refs, so no live start reroute was ever recorded.
- All 948 reviewer failure/replacement refs were fetched. Their failure codes are `insufficient_quota` 313, `local_dependency_unavailable` 80, `provider_unavailable` 26, `review_target_superseded` 9, `reviewer_cannot_read_repository` 26, `turn_limit_cancelled` 107, and `wrapper_terminal_failure` 391. None is a not-started code.

### Runner non-pickup reroute — NOT PROVEN

- `scripts/orchestrator-flow/runner-lanes.json` registers five qualified lanes, and the `Queue-sensitive checks (aggregate)` workflow runs on PRs. Example: run 35092689708, `success`, 2026-09-16T11:52:44Z.
- `gh run list --event workflow_dispatch` for `coldlion-promotion-contract-tests.yml` and `tools-offline-tests.yml` returns no runs, so no replacement lane run has ever been dispatched.

### Supporting live evidence (not the acceptance event)

After #2984 merged (`1f7dbe47`, 2026-09-15T21:30:19Z), a terminal non-verdict was rerouted at the same head in 36 s:

```
2026-09-16T02:08:29Z db-coordination reviewer-failure-release reviewer=grok-4.6 issue=2863 pr=3008 head=1595aec05565b1a138b6f40e09bda8191fa40acf failed-sequence=2904 code=turn_limit_cancelled verdict=none artifact=none replacement=none
2026-09-16T02:09:05Z db-coordination reviewer-replacement sequence=2909 reviewer=muse-spark-1.3-contributor issue=2863 pr=3008 head=1595aec05565b1a138b6f40e09bda8191fa40acf slot=1 failed-sequence=2904 prior-sequence=2906 failure-ref=1733ec08fb2e777b1b94eb9a49340f65ef26f88a
```

The same pattern appears on PR #3016 (`turn_limit_cancelled` → replacement, sequences 2915, 2918, 2921). These are started-then-terminated reviews, not non-starts, and they do not show whether a concurrent healthy slot was left intact.

Needed for acceptance: one organic or injected reviewer assignment that never starts, producing a `refs/db-start-reroutes/*` record within 10 minutes while the other slot's lease stays live, plus one runner job left unpicked past the SLO that produces exactly one `workflow_dispatch` lane run and a green aggregate. A reviewer canary needs a real governed review assignment on a database PR, which is outside this session's authority. Neither step needs a schema change.
