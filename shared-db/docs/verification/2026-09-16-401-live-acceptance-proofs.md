# #401 live acceptance proofs — Steps 1, 2, 2A, 3, 4, 6, 7 (issue #3027)

Collected 2026-09-16 from live GitHub records only (workflow runs, commits, issue
comments, refs). Read-only: no migration, claim, dispatch, production write or
setting change was made. Unit/fixture test output is not counted as live proof.
No credentials or private data appear below.

| Step | Verdict |
|---|---|
| 1 | Refusal path PROVEN; fully-qualified automatic promotion NOT PROVEN |
| 2 | Re-reservation PROVEN; named lease/conflict hold and no-unrelated-production-hold NOT PROVEN |
| 2A | NOT PROVEN |
| 3 | NOT PROVEN |
| 4 | NOT PROVEN (alarm not installed) |
| 6 | NOT PROVEN |
| 7 | NOT PROVEN |

## Step 1 — automatic promotion (#2716)

**Refusal path — proven live.**
- Run [35067685382](https://github.com/u2giants/shared-db/actions/runs/35067685382) (2026-09-16T07:16Z, main `9fe6f0bb`, allowlist `20260916033914`), job "Automatic production qualification and dispatch", 07:18:42Z: `Fully qualified production apply dispatched. It remains queued behind the global workflow serialization ...`
- The dispatched run [35067878423](https://github.com/u2giants/shared-db/actions/runs/35067878423) (triggering actor `github-actions[bot]`), 07:20:13Z: `Production business-risk gate rejected evidence: ENGINEER ACTION REQUIRED: automatic production promotion is not fully machine-qualified: access or permissions materially change; ...` Nothing applied; the apply was later dispatched by the owner account as run 35068100581 (success).
- Same refusal shape: 35056110797 → 35056268596 (04:36Z).

**Fully-qualified automatic promotion — not proven.** Every bot-dispatched production run since 2026-09-10 failed: 34987389408, 34989644100, 35052182196, 35056268596, 35061726161, 35067878423. Two (35052182196, 35061726161) refused on evidence drift (`produced evidence with a different scripts/manage-migration-author-lanes.mjs than the merge commit ...`; sidecar `20260916033914.json absent`), not on risk. Blocked on real traffic: needs a low-risk migration that is fully machine-qualified to flow; manufacturing one would be a new migration and a production write.

## Step 2 — admission, re-reservation, stage-scoped holds

- **Safe re-reservation without closing the PR — proven.** Commit `7700029e` "migration: re-reserve 20260916001923 as 20260916033914" (2026-09-16T03:39Z) on PR #3007, which stayed open and merged 05:50Z. Earlier: `de2aa334` (PR #2815), `9b975d86` (PR #2814).
- **Named lease/conflict hold — not proven.** Of 953 comments since 2026-09-12, the only machine hold (#2866, comment 5658428628, 2026-09-14T03:07Z) names no holder: "all safe author capacity is occupied or object-protected". No hold naming a lease holder, and no refused unrelated-production hold, exists.
- **No unrelated production hold — not proven.** No record of a merge-ready PR clearing while another item's production ran.
- Blocked: needs real concurrent structural traffic (a lease collision and a production run).

## Step 2A — no-database-preview fast lane

Not proven. `select-preview-route` runs only in tests; no workflow emits a live `NO_DATABASE_PREVIEW` decision and no canary tool exists. Docs PR #3025 merged ~20 minutes after opening via the documents-only check, with no route decision in its logs. #2912 closed on code merge (PR #2795, `585a9d2b`). Blocked: the classifier must be wired into a live check before a canary PR can prove anything; no database write is needed.

## Step 3 — owner dispatches live proof within 30 minutes

Not proven. Closest records predate PR #2861 and were produced by the database author, not the application owner:
- #2860: `production_applied` 2026-09-15T13:50:08Z; popdam3 live-proof run [34977491562](https://github.com/u2giants/popdam3/actions/runs/34977491562) dispatched 13:49:16Z by the owner account; `live_verified` 13:51:59Z, actor `shared-db.orch#2927/author-2792b`.
- #2792: `production_applied` 12:55:37Z, `live_verified` 13:51:43Z (56 minutes).
- Production applies 35068100581 (#2988) and 35056756909 (#2863) have no outcome events after `preview_ready`. "Shared DB Live Proof" last ran 2026-09-14T22:17Z (34903365304, failed).
Blocked: needs the next real production apply on an outcome with owner-dispatched proof.

## Step 4 — successor resume and two-hour alarm

- **Successor resume — not proven.** Marker issues #2927 (closed) and #3004 (open) and closeout PR #3022 cite no `--orchestrator-snapshot` hash. `scripts/orchestrator-snapshot.mjs` exists on main but no live use is recorded.
- **Two-hour no-progress alarm — not installed.** No workflow or skill on shared-db main references `stalled_outcomes` or a no-progress alarm; on ai-devops main it appears only in the plan. Blocked: needs a PR installing the alarm (skill or schedule), then a real stall.

## Step 6 — migration train

Not proven. `git ls-remote origin 'refs/db-migration-trains/*'` returns nothing: no train was ever proposed, dispatched or refused. Blocked: a live train needs at least two approved compatible migrations applied to production; no dry-run canary mode exists.

## Step 7 — reviewer/runner non-start reroute

Not proven. `refs/db-start-reroutes` is empty (the 540 `refs/db-review-replacements` are the older replacement flow). Queue-Sensitive Checks Aggregate: 107 runs since 2026-09-15, all pull-request triggered, none a replacement run on another lane. Blocked: needs a real (or deliberately staged) reviewer or runner non-start; no harness exists to stage one.
