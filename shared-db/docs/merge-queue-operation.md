# Shared-db merge queue operation

Issue [#2530](https://github.com/popcre/shared-db/issues/2530) Phase C replaces first-come-first-served
merges with GitHub's native merge queue (earlier investigation: #1435, closed PR #1950 — studied as
design history, never cherry-picked). This is repository maintenance; it changes no database.

## Safety contract

- GitHub builds and merges one pull request at a time: ruleset `main merge queue`, `ALLGREEN`,
  `max_entries_to_build=1`, `max_entries_to_merge=1`, `min_entries_to_merge=1`, zero minimum wait,
  merge method `MERGE`, `check_response_timeout_minutes=90` (raised from 30 in issue #4746: the
  2026-10-23/24 Actions starvation starved three all-green entries to the 30-minute timeout behind
  one-at-a-time batching, so the window must absorb check-start delay, not just the check runtimes
  that sized the original 30; the 25-minute preview hold still fits inside it).
- The reviewed pull-request head is immutable. The queue tests a separate synthetic commit containing
  that exact head plus current `main`; `.github/workflows/merge-queue-gate.yml` proves the reviewed
  head is an ancestor of the group commit before anything passes.
- Migration PRs enter in ascending reserved-version order: `scripts/merge-queue-contract.mjs` refuses
  a candidate when another open non-draft migration PR starts at an earlier version, and refuses
  GitHub's 3,000-file coverage ceiling rather than judging a truncated file list.
- `guarded-migration-merge.yml` remains the SOLE admission path. It re-proves the exact head, review,
  claims, collisions, required checks and production lock, reads the live queue state under the merge
  lock, and then either merges directly (queue inactive) or enqueues with `--match-head-commit`
  (queue active). An unknown or mismatched active ruleset refuses before any merge attempt.
  It never uses `--admin`. After activation, GitHub is the sole merger.
- After a migration-bearing merge, the next merge group waits until that exact `main` commit carries
  `Post-merge preview rehearsal: success`, posted only by a successful post-merge rehearsal run of
  `.github/workflows/shared-supabase-migrations.yml` (never on failure, never manually). A success
  recorded on a later `main` commit that contains it also releases the hold (#4782/#4787): a
  rehearsal on a later tip replays the same pending migration, so it proves at least as much. This
  covers the case where non-migration merges advanced `main` while the target's own rehearsal was
  blocked and the rehearsal workflow (correctly) refuses any tip that is no longer current — the
  exact-SHA-only wait deadlocked every migration group on 2026-10-25.
- **Queue interlock through the mutation** (issue #3421). The preview hold can wait 25 minutes after
  the gate first reads authorization, and a production freeze in that window revokes the PR-head
  status and takes the production lane. A stale pre-wait read must never authorize the merge. The
  `authorize` job (`Queue interlock`) therefore owns the asynchronous mutation, not merely the status
  posting: it acquires the exclusive merge lane, re-reads PR-head authorization and the production
  interlock under that lock (`merge-queue-contract.mjs --recheck-interlock`), posts group-SHA success
  only when both are live and clear, and **holds the lane until GitHub lands the actual merge**.
  Failure after posting revokes the group-SHA status (fail-closed). The `authorize` job is
  intentionally not a required check-run — a required check still running would deadlock the group.
  This does not activate the merge queue.
- Every required context reports on `merge_group`. Checks whose PR-only payload is absent either
  re-resolve the one queued PR through the queue ref (agent work contract, handoff contract) or defer
  their event-specific operation to `Merge queue gate` (cross-PR object collision, migration author
  lease), which performs the equivalent proof itself. `scripts/check-merge-queue-workflows.test.mjs`
  is the machine proof that no required context lacks merge-group coverage.

The queue does not change review strength: the durable reviewer assignment and verdict remain
exact-head evidence governed by AGENTS.md §4. Queue admission continues to require the operator to
supply that exact reviewed head; the queue proves the head did not move.

## Activation sequence (Step 8)

Activation must happen only after the implementation PR is merged and green on `main`:

1. Add `Merge queue gate` to required contexts with the additive-only
   `scripts/update-required-checks.mjs --add "Merge queue gate" --apply`. Preserve all existing
   contexts and `strict: false`; the tool reads back and rewrites
   `docs/verification/main-required-status-checks.json` — commit that mirror through the ordinary
   guarded path.
2. Run `node scripts/configure-merge-queue.mjs`. Default is a read-only dry run that refuses unless
   the owner is an organization, the repository is public, the immutable repository ID matches the
   transfer baseline artifact, the queue workflow is on `main`, every required context including
   `Merge queue gate` is live, no mutation lane is held, and a migration-bearing main tip already
   carries its exact-SHA rehearsal status. For an existing named ruleset, the dry run requires its
   full detail and carries its exact `bypass_actors` into the proposed update; a new ruleset starts
   with no bypass actors. Save the dry-run JSON as evidence.
3. Inspect the proposed payload independently, then re-run with `--apply`. The tool creates (or
   idempotently updates) exactly the ruleset `main merge queue`. Before updating an existing ID it
   re-reads that ruleset and refuses if its identity or `bypass_actors` changed since planning.
   Its write read-back must match the exact planned `bypass_actors` and all other payload fields.
4. Read back the ruleset by ID and the branch protection: bypass actors match the preserved plan,
   all prior contexts plus `Merge queue gate` remain required, `strict` remains false, and
   administrator enforcement is unchanged.
5. Prove with one documents-only canary PR (Step 9): one synthetic merge group, all required contexts
   green on the group SHA, GitHub — not the guarded lane — performs the merge.

Do not activate the ruleset from the implementation branch: GitHub would request `merge_group`
checks from `main`, where the workflows did not exist yet, and the queue would correctly deadlock.

## Changing queue parameters (issue #4746)

The guarded lane pins the live ruleset's exact shape to `QUEUE_RULE` in
`scripts/merge-queue-contract.mjs`; a live ruleset edit that does not move the pin makes every lane
run refuse (`not the exact approved one-PR queue`) — observed 2026-10-23 when a direct 30→90 edit
was reverted within minutes. A parameter change therefore lands as ONE PR, in this order:

1. The PR updates `QUEUE_RULE` (pin), its test fixtures, and this document together.
2. The PR merges through the queue while the live ruleset still matches the OLD pin — the lane
   reads its policy from `main`, not the PR head, so admission and the group run stay green.
3. Immediately after the merge lands, run `node scripts/configure-merge-queue.mjs` (dry run, saved
   as evidence), then `--apply` from the merged `main`: it updates the recorded ruleset in place,
   carrying forward its exact `bypass_actors`, and read-back must match the new pin. Between the
   merge and the apply the lane refuses (fail-closed, minutes only) — apply promptly.

## Observing the queue

- `gh api repos/popcre/shared-db/rulesets` lists the ruleset; read it back by ID for full rules.
- A queued PR shows `Merge queue gate` and every other required context running on the synthetic
  `gh-readonly-queue/main/pr-<n>-<sha>` ref. Removing a PR from the queue is done from the GitHub UI
  (the PR's merge-queue box) — never by deleting refs or cancelling someone else's group.
- If `Merge queue gate` fails on the preview hold, the preceding migration's exact merge SHA needs
  its post-merge rehearsal: dispatch `shared-supabase-migrations.yml` with `target=preview`,
  `mode=apply`, `merged_preview_source_pr` (or the map form) and `commit_sha` = that merge commit,
  under the existing preview lock. If that commit is no longer the current tip (non-migration
  merges advanced `main` past it), dispatch the rehearsal against the current tip instead; the gate
  releases the next group on the success status posted on the exact SHA or on any later `main`
  commit that contains it.
- If the merged-main apply is REFUSED because preview already holds every allowlisted version
  (the claim lane applied it pre-merge; the hard guard's own directive), dispatch the
  historical-recovery lane instead — `mode=apply`, `historical_preview_source_pr` (single version)
  or `historical_preview_source_pr_map` (several), `historical_preview_original_run_map` naming the
  run that originally applied each version, and `commit_sha` = the merge commit or a later tip.
  Since #5086 the successful recovery posts the same exact-SHA `Post-merge preview rehearsal`
  status (description marked "historical recovery … already applied; no database write"), so the
  hold releases and, in the single-PR form, automatic production qualification still runs. Never
  hand-record the status.

## Bounded failures

- The gate's preview hold waits 25 minutes (`PREVIEW_HOLD_MAX_SECONDS`), inside the ruleset's
  90-minute check-response timeout. A group that times out is removed by GitHub and can be
  re-queued after the hold clears; nothing is merged partially.
- **Merge-lane contention waits instead of ejecting** (2026-10-28). When another PR's queue run or
  guarded merge holds `refs/db-coordination/merge`, the `Queue interlock` acquisition retries every
  15 seconds for up to 900 seconds (`scripts/acquire-merge-lane-waiting.mjs`), logging each wait with
  the current holder. Every retry is a complete, fresh `--acquire-merge` (all proofs re-run, atomic
  create-only ref); only the "merge is occupied" refusal is retried — production active, promotion
  freeze, moved head or a stuck author mutex still fail on the first attempt. Past the budget the job
  fails closed and posts the failure status as before. Do not time dispatches around other merges.
- A failed rehearsal means the next group stays blocked. Recover preview through the existing
  governed procedures; never post the status manually and never bypass with `--admin`.
- If the queue mutation does not land within the `authorize` job's hold budget, the job revokes the
  group-SHA `Migration guarded merge authorization` status and releases the merge lane. Re-run the
  guarded lane after the cause clears; never post the group status manually.

## Queue-only rollback

If the queue itself misbehaves, disable ONLY the new ruleset — never branch protection, required
contexts, or the guarded lane:

1. `node scripts/configure-merge-queue.mjs --rollback` — dry run naming exactly one target: the
   recorded `main merge queue` ruleset ID.
2. `node scripts/configure-merge-queue.mjs --rollback --apply --expect-id <id>` — deletes that one
   ruleset and verifies it is gone.
3. The guarded merge lane's `--queue-mode` read then reports `inactive` and direct guarded merges
   resume unchanged. The `merge_group` trigger support and the additive `Merge queue gate` context
   stay in place (its `pull_request` form keeps ordinary merges green); remove the context later
   only through a reviewed settings change if it ever obstructs direct mode.

Rollback never reverses the `popcre` organization transfer; that is a separate owner decision with
its own authorization (plan §13).
