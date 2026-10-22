# Legacy SHA-release call-site audit (plan step 8a, first landing)

Issue [#3779](https://github.com/popcre/shared-db/issues/3779),
`plan_shared_release_hold_reduction.md` step 8a. Audited on protected main
`9bc253224f00` (October 21, 2026 EDT). Public-safe: file paths and line
shapes only.

## What was wrong

`scripts/manage-migration-author-lanes.mjs` had two handlers for
`--release-<lane>`. The first one won: it called `releaseOwnedRef` directly with
the caller's `--owner-sha`, **outside the coordination mutex** and without
reading the lease's holder or generation. The identity-aware
`releaseExclusive` handler further down was unreachable. Every workflow release
site therefore ran the unserialized SHA path, and a lease recovered to a new
generation could be released by the holder it replaced whenever the ref sha
happened to match the caller's expectation.

## Call sites found (all five pass only `--owner-sha`)

| Site | Flag | Owner sha source |
|---|---|---|
| `.github/workflows/guarded-migration-merge.yml` "Release the exclusive merge lane with ownership proof" | `--release-merge` | `steps.merge_lock.outputs.owner_sha` |
| `.github/workflows/merge-queue-gate.yml` "Release the exclusive merge lane with ownership proof" | `--release-merge` | `steps.merge_lock.outputs.owner_sha` |
| `.github/workflows/shared-supabase-migrations.yml` "Release the exclusive preview lane with ownership proof" | `--release-preview` | `steps.preview_lock.outputs.owner_sha` |
| `.github/workflows/shared-supabase-migrations.yml` "Release the exclusive production lane with ownership proof" | `--release-production` | `steps.production_lock.outputs.owner_sha` |
| `.github/workflows/preview-ledger-orphan-reconciliation.yml` "Release preview recovery lock" | `--release-preview-recovery` | `preview-lock.json` `ownerSha` |

`scripts/manage-preview-maintenance-lock.mjs --release --owner-sha` is a
separate maintenance ref with its own exact-sha contract and is out of scope
for the stage-lease change. `recover-exclusive-db-lane.yml` uses
`--recover-exclusive`, not a release.

## What this landing changes (backward compatible)

- The direct `releaseOwnedRef` CLI path is removed. Every `--release-<lane>`
  call reaches `releaseExclusive`, which takes the coordination mutex, re-reads
  the lease under it, and releases only the exact current owner.
- A legacy SHA caller is resolved under the mutex: the holder id and generation
  are parsed from the acquisition commit the caller named, then asserted
  against the current lease, and the current ref sha must still equal that
  acquisition sha. A recovered or otherwise moved lease refuses and the
  successor is untouched. A pre-fencing (legacy header) lease still needs its
  exact sha and is never upgraded or taken over.
- `--holder-id` plus `--generation` is accepted on every `--release-<lane>`
  flag for modern callers. Acquisition already prints `holderId` and
  `generation` next to `ownerSha`.
- An absent ref releases idempotently. After a delete, only absence proves our
  release; a different sha is reported as unproven, never as success.

Tests: `scripts/release-hold-ownership.test.mjs`
(`stale_generation_cannot_write_or_release`, `two_recoverers_only_one_wins`,
`release_recovery_interleaving_preserves_successor`,
`legacy_sha_release_is_serialized_and_owner_bound`, the five-lane CLI sweep),
The deletion-selector guard for `refs/db-release-evidence/*` lands with plan
step 2 (`scripts/lib/release-hold-evidence.mjs`).

## Still open in 8a (second landing)

- Workflow callers still pass `--owner-sha` only; the five sites above should
  also export and pass `holder_id` / `generation` from their acquisition JSON.
- Point-of-use `--assert-exclusive` before each mutation (preview and
  production `supabase db push`, atomic apply, preview-ledger reconciliation
  apply, protected final merge / queue authorization), sourced from acquisition
  outputs (`every_mutating_workflow_asserts_acquired_identity`).
- Before enabling any strict modern-only mode, prove no old active writer or
  attempt remains and revalidate queued candidates.
