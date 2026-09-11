# Historical item merch-group reclassification tooling

Implements steps 1 and 2 of section 9 of `plan_historical_mg_reclassification_apply.md`:
a private manifest builder, and a guarded executor with its tests, verifier and
rollback. Tracking issue: #1984.

**Nothing here has been run against preview or production.** Building and testing
this tooling is authorized; *running* `apply.mjs --apply` against any live
database is a separate, explicit owner authorization that has not been given.

## What is and is not in this repository

This repository is public. The candidate manifest and the abstention ledger both
carry licensed item identities, so they are written to the **private**
`u2giants/licensor-source-data` repository. Only counts and SHA-256 digests may
be quoted here or in an issue. Item descriptions are never read into a manifest
at all.

The tooling contains no database migration and touches no schema object. It
rewrites six existing columns on existing `dflow."itemHeader"` rows, which is
data-only work under `AGENTS.md` section 0.0-B.

## Locked rules the code enforces

- The May 14, 2025 historical cutoff is a constant, and `assertCutoff` throws on
  any other value. It cannot be passed in, configured, or relaxed.
- The first write batch contains **complete level-3 assignments only**. Every
  candidate needs an exact live, division-qualified, active MG01 to MG02 to MG03
  parent chain. Level-2, level-1 and partial rows abstain.
- Every write targets `item_id_pk` and carries all six before-values in the
  `WHERE` predicate. There is no partial apply: any drift, or any affected-row
  count other than the planned one, rolls back the whole transaction.
- The target is proved from the connection string that is about to be used,
  against an `--expect-project-ref` the operator states explicitly. There is
  deliberately no target-name-to-project-ref lookup table in this code.
- A production apply additionally requires an authorization artifact naming the
  exact manifest digest. Preview authorization can never satisfy production.

The three open section 8 decisions (partial level-2/level-1 application, EP001
treatment, and null-or-conflicting creation dates) are **unanswered owner
decisions**. Nothing here infers them; each simply abstains with its own reason.

## Commands

Dependencies: Node 20+. The repository has no `package.json`, so `pg` is resolved
at run time from an operator-supplied path.

```
MGRC_PG_MODULE=/path/to/node_modules/pg/lib/index.js
MGRC_DATABASE_URL=<connection string, never logged>
```

Build the manifest (read-only):

```
node build-manifest.mjs --source <private level-3 CSV> --target production \
  --expect-project-ref <ref> --out <private output dir>
```

Dry-run the executor (locks, revalidates, rolls back):

```
node apply.mjs --manifest <private manifest.json> --target preview \
  --expect-project-ref <ref> --expect-manifest-sha256 <digest> \
  --backup-out <private dir>
```

Record the untouched-rows baseline, then verify after an apply:

```
node verify.mjs --manifest <file> --target preview --expect-project-ref <ref> --baseline-only
node verify.mjs --manifest <file> --target preview --expect-project-ref <ref> \
  --expect-non-candidate <digest> --expect-non-candidate-rows <n>
```

Roll back (restores only rows still carrying exactly what this batch wrote):

```
node rollback.mjs --backup <file> --target preview --expect-project-ref <ref> \
  --expect-manifest-sha256 <digest>
```

Adding `--apply` to `apply.mjs` or `rollback.mjs` writes rows. Do not.

## Tests

```
node --test scripts/historical-item-mg-reclassification/*.test.mjs
```

45 tests, all offline, all synthetic, no secrets and no database. They cover the
19 cases required by section 10 of the plan. Each one feeds a guard a known-bad
input and asserts the specific refusal, so every guard in this directory has been
observed going red for the right reason rather than merely passing.

## The cutoff-retirement gate

`lib/retirement-gate.mjs` evaluates the seven conditions in section 13 of the
plan. It is expected to FAIL today: 127 live rows have a null creation date, and
condition 1 alone holds it closed. Removing the cutoff from
`api.resolve_item_mg_category(integer)` is a structural change and must be routed
fresh through the shared-db orchestrator after this gate passes.

## Review status

Both independent review slots for this pull request are re-drawn fresh at each
head; this line exists only to produce a clean head with zero recorded verdicts
after a reviewer-lease repair proved structurally blocked at a prior head.

## Review status (second refresh)

Slot 1's lease-repair path hit the same head-wide `hasVerdictForHead` block once
slot 2 recorded a verdict at the prior head (confirmed: the repair call reported
success but the reviewer's active lease ref did not move). This commit produces
another fresh head with zero recorded verdicts so both slots can be drawn before
either posts.
