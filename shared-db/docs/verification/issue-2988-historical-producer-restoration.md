# Issue 2988: exact historical-restoration producer provenance

Production apply of version `20260916033914` correctly stopped before writes
when its original preview apply run 35060692115, dispatched at pre-merge main
commit `3fdd16effbd154e1602c29aa5610161910138d68`, produced evidence without
the preview-producer sidecar that merge commit
`86da2d44bcd390b3177f322f947b212c8dc9bbc9` of PR #3007 — the pull request that
authored the version — introduced. The gate's verbatim refusal was:

```
Production business-risk gate rejected evidence: original apply run 35060692115
dispatched at 3fdd16effbd154e1602c29aa5610161910138d68 produced evidence with
scripts/production-verification-sidecars/20260916033914.json absent where the
merge commit 86da2d44bcd390b3177f322f947b212c8dc9bbc9 of the pull request that
authored 20260916033914 has it present
```

A migration that ships a new sidecar can never rehearse on preview at a commit
that already has that sidecar on `main`, so the immutable original apply cannot
be replayed. It is rebound through the registered historical restoration route
rather than re-run. Producer mismatch stays the default refusal. It is accepted
only when the registry validates all of these together:

- version `20260916033914` and its one exact migration filename
  `supabase/migrations/20260916033914_dam_order_list_role_free_party_names.sql`;
- original apply run `35060692115`, dispatch commit
  `3fdd16effbd154e1602c29aa5610161910138d68`, and applied commit
  `bac58c5f49687c7911d013e1f392fcf5c356e626`;
- source PR 3007 and merge commit
  `86da2d44bcd390b3177f322f947b212c8dc9bbc9`;
- the artifact manifest digest and the current file and statement bytes.

## Evidence

Every value is read from the run, its artifact, the pull request, and the file
as it exists on `origin/main` at `86da2d44bcd390b3177f322f947b212c8dc9bbc9`.

| Field | Value | Source |
| --- | --- | --- |
| `previewApplyRun` | `35060692115` | run object: `workflow_dispatch`, `run_attempt` 1, conclusion `success` |
| `previewDispatchCommit` | `3fdd16effbd154e1602c29aa5610161910138d68` | run `head_sha` (branch `main`) |
| `previewAppliedCommit` | `bac58c5f49687c7911d013e1f392fcf5c356e626` | `preview-instance.json` `appliedCommit` in artifact `preview-migration-apply-bac58c5f49687c7911d013e1f392fcf5c356e626` |
| `previewProject` | `mvpkijzfmfcxhnzqogzs` | same binding, `previewProjectRef` |
| `sourcePr` | `3007` | merged pull request that authored the version |
| `sourceMergeCommit` | `86da2d44bcd390b3177f322f947b212c8dc9bbc9` | PR #3007 merge commit, current `origin/main` |
| `fileSha256` | `e8fbe0874fcb5289f1d60ec5a5c75c541fd234a3015458bb9d9ff26790ad65d0` | SHA-256 of the migration on `origin/main`; identical to the artifact `migration-content-manifest.json` digest for this version |
| `statementBytes` / `statementSha256` | `13874` / `568e72b43a86a70cc1001a52331615b8b7d13b5310567d2f29657e77bcc93723` | file with its single trailing newline removed |

That binding records `rehearsalMode: claim`, not `merged-main-rehearsal`, which
is why the gate's bound-mainline post-merge exception does not and must not
apply here.

The migration contains no CRLF, so the raw-byte manifest digest and the
newline-normalised registry digest are the same value, which is what the gate
compares.

## Validator output

The repository's own registry validator, run with exactly the evidence object
`prove_registered_historical_restoration_provenance` builds:

```
{"version":"20260916033914","fileSha256":"e8fbe0874fcb5289f1d60ec5a5c75c541fd234a3015458bb9d9ff26790ad65d0"}
```

`--allows-backdated` on the same file also exits 0. A negative control with the
run id changed by one digit refuses, as it must:

```
historical production provenance mismatch for previewApplyRun
```

`scripts/historical-migration-restorations.test.mjs` now pins this entry and the
issue 2863 entry field by field, including a negative control on `sourcePr`; the
suite passes 19 tests.

## Scope

No guard is weakened, relaxed, or special-cased. The source PR merge and its
ancestry to the promoted main commit remain proved by the existing gate. An
unregistered version, or a changed run, commit, source, merge, digest, filename
or byte, fails the registry check and returns to the ordinary producer-mismatch
refusal. This change dispatches no preview or production workflow and makes no
database change.
