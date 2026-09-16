---
issue: 3026
status: OPEN
owner: claude/orch-3004-closeout
---

# Orchestrator marker #3004 closeout — all nine assigned outcomes live in production

## 1. What this session was asked to do
Albert appointed this session successor shared-db orchestrator (route_id
`local_2cc03038-ae17-4092-b2ce-564e3b501771`, marker issue #3004) and gave one
task: "complete through to production: #2987, #2863, #2988, #2792, #2860, #2576,
#2706, #2704, #2169".

## 2. What was actually done
All nine are closed and their migrations are applied on production. The last one,
**#2988**, was finished in this window:

- PR [#3021](https://github.com/u2giants/shared-db/pull/3021) registered
  `20260916033914` as an exact historical restoration in
  `scripts/historical-migration-restorations.mjs`, with pinning tests for both the
  #2863 and #2988 entries and a verification document. Governed APPROVE from
  `muse-spark-1.3-contributor` at head `5d4122ad`; carried forward across a
  merge from main. Merged through `guarded-migration-merge.yml` as
  **9fe6f0bbf6d5f1f2332aaf0af5501816729ccf8d**.
- Manual v1 production review evidence: run 35066943827,
  digest `sha256:ba9ba7cc77dd08d40c21f7b93000fb0eeeb4172414e4a870a223fc4f79095e54`.
- Historical preview recovery re-rehearsed at the current main tip: run
  35067685382, artifact `preview-migration-apply-9fe6f0bb…`, digest
  `sha256:87dbf9510a162f2a586da2f18c7bf5292df50f2d433afec4be617aa817248874`.
- Production apply: run **35068100581**, success. Post-apply catalog verification
  printed `20260916033914 | catalog:dam_order_list_role_free_party_names_v1 | 1 | 1 | PASS`,
  and the production migration ledger shows version `20260916033914`.

Issues closed by this session in this window: **#2988**, **#3020**, and claim
**#3005** (released with owner `claude-author-2988`).

## 3. Preview and production state
- Preview project `mvpkijzfmfcxhnzqogzs` carries `20260916033914` twice-applied
  evidence (original claim run 35060692115 and recovery run 35067685382). Nothing
  else was written to preview by this session.
- Production project `qsllyeztdwjgirsysgai` now carries `20260916033914`. Main tip
  at write time (2026-09-16T07:30Z): `9fe6f0bb`.

## 4. Half-finished or abandoned
Nothing. No migration is part-applied, no PR of this session is open.

## 5. What this session owns
- Worktrees that can be swept once nothing else holds them: `w2988hr`,
  `issue-2988-gen2`, `issue-2988`, `review-2988-9ca05bdd-s1`,
  `review-2988-bac58c5f`, and this closeout worktree
  `shared-db-orchestrator-handoff-8e0984`.
- `refs/rescue/issue-2988-preclean` holds preserved pre-clean worktree state for
  #2988 and can be deleted once the sweep above is done.
- Contract generations `refs/db-contracts/2988/4` and `/5` are immutable and stay.

## 6. What was about to happen next
Nothing. The assigned workstream is complete. The next orchestrator picks up the
30 open `db-work` issues from the live queue, not from this file.

## 7. Blocked on
Nothing, and nothing is waiting on Albert.

## 8. What was tried that did NOT work — read this before re-treading it
- **Re-dispatching the production apply with a different `preview_run_id` does not
  re-point the original-apply map.** `prove_historical_original_apply_runs` reads
  `originalApplyRuns` from `historical-preview-source.json` inside the supplied
  run's own artifact, so the map is baked into the artifact. Run 35062445322 failed
  this way.
- **The bound-mainline exception cannot rescue #2988.** Run 35060692115's
  `preview-instance.json` says `rehearsalMode: "claim"`, and
  `prove_bound_mainline_post_merge_original` requires `merged-main-rehearsal`.
  Correctly inapplicable — do not try to make it apply.
- **The producer pin refuses any pre-merge preview apply for a migration that ADDS
  a sidecar.** It can never be replayed; the registry is the only sanctioned route.
- **The first guarded merge (run 35063976510) failed** because main moved past the
  dispatched base with non-documentation changes. Fix is a MERGE from main (never a
  rebase — that voids the approval), then re-dispatch.
- **After that merge the Agent work contract check failed twice**: first
  `checked PR base is not an ancestor of the reported implementation head` (fix:
  bump the contract generation, set `base_sha` to the new main, republish, and set
  `completion.head_sha` to the merge commit); then a `files_changed` mismatch —
  the error message's "expected"/"got" labels are inverted, `expected` is what Git
  actually shows. `.agent/contract.json` and `.agent/completion.json` must be
  listed in `files_changed` whenever they differ from the PR base.
- **The first governed review attempt was REFUSED** with "review wrapper did not
  produce a recordable terminal verdict". Cause: the wrapper args carried only
  `--prompt-file`. `ai-muse` needs its subcommand and a session name, i.e.
  `-- new <session-name> --prompt-file <windows path>`, with `AI_MUSE_CALLER=claude`
  set. A wrapper refusal consumes no allocation, so the same sequence is re-run
  without `--replacement-sequence`.
- **The second production apply (run 35067239002) was refused** with
  `preview run checked out at bac58c5f… produced evidence with a different
  scripts/manage-migration-author-lanes.mjs than exact main`. That is the
  preview-vs-current-main producer pin, a different check from the original-run
  pin the registry clears. Fix: re-rehearse on preview at the current main tip
  through the historical-recovery lane, then promote with that new run.
- **`--release-claim` refuses the orchestrator route_id as owner.** The owner is
  the value in the claim issue's own `owner:` line (here `claude-author-2988`).
- **`production-apply-review-evidence.yml` takes `reviewed_main_sha`,
  `ordered_allowlist`, `verdict`, `reviewer_label`** — not `pull_request` or
  `work_issue`; the latter is HTTP 422.

## 9. Facts that may already be stale
Everything time-sensitive here was re-read at 2026-09-16T07:30Z: main tip
`9fe6f0bb`, 30 open `db-work` issues, marker #3004 the only open one, 41 files in
`HANDOFF.d/`. The production migration count and maximum version were not
re-counted after the apply; the ledger line for `20260916033914` was read directly
from run 35068100581's log.
