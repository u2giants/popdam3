# Issue 2863: exact historical-restoration producer provenance

Production apply of version `20260916001944` correctly stopped before writes
when its original preview apply run 35047947727, dispatched at main commit
`0a11c42d3e373fe9b45e826a3015c93bb7cf4704`, carried a different
`scripts/manage-migration-author-lanes.mjs` than merge commit
`6c9b149d8747293cdb306a73262bd341873bc682` of PR #3008, the pull request that
authored the version. The gate's verbatim refusal was:

```
Production business-risk gate rejected evidence: original apply run 35047947727
dispatched at 0a11c42d3e373fe9b45e826a3015c93bb7cf4704 produced evidence with a
different scripts/manage-migration-author-lanes.mjs than the merge commit
6c9b149d8747293cdb306a73262bd341873bc682 of the pull request that authored
20260916001944
```

The immutable original apply cannot be replayed, so it is rebound through the
registered historical restoration route rather than re-run. Producer mismatch
stays the default refusal. It is accepted only when the registry validates all
of these together:

- version `20260916001944` and its one exact migration filename
  `supabase/migrations/20260916001944_coldlion_prepack_and_prod_detail_landing.sql`;
- original apply run `35047947727`, dispatch commit
  `0a11c42d3e373fe9b45e826a3015c93bb7cf4704`, and applied commit
  `1595aec05565b1a138b6f40e09bda8191fa40acf`;
- source PR 3008 and merge commit
  `6c9b149d8747293cdb306a73262bd341873bc682`;
- the artifact manifest digest and the current file and statement bytes.

## Evidence

Every value is read from the run, its artifact, the pull request, and the file
as it exists on `origin/main` at `6c9b149d8747293cdb306a73262bd341873bc682`.

| Field | Value | Source |
| --- | --- | --- |
| `previewApplyRun` | `35047947727` | run object: `workflow_dispatch`, `run_attempt` 1, conclusion `success` |
| `previewDispatchCommit` | `0a11c42d3e373fe9b45e826a3015c93bb7cf4704` | run `head_sha` (branch `main`) |
| `previewAppliedCommit` | `1595aec05565b1a138b6f40e09bda8191fa40acf` | `preview-instance.json` `appliedCommit` in artifact `preview-migration-apply-1595aec05565b1a138b6f40e09bda8191fa40acf` |
| `previewProject` | `mvpkijzfmfcxhnzqogzs` | same binding, `previewProjectRef` |
| `sourcePr` | `3008` | merged pull request that authored the version |
| `sourceMergeCommit` | `6c9b149d8747293cdb306a73262bd341873bc682` | PR #3008 merge commit, current `origin/main` |
| `fileSha256` | `c79374a85369589e3a5ed6e5f58b5ccf495e0ba1ad420f9e589b7bd1dba6aec9` | SHA-256 of the migration on `origin/main`; identical to the artifact `migration-content-manifest.json` digest for this version |
| `statementBytes` / `statementSha256` | `13890` / `f54b6ffb87a38c11201fb61a80c6af61bead7399f41c410a629d02500cee1c91` | file with its single trailing newline removed |

The migration contains no CRLF, so the raw-byte manifest digest and the
newline-normalised registry digest are the same value, which is what the gate
compares.

## Validator output

The repository's own registry validator, run with exactly the evidence object
`prove_registered_historical_restoration_provenance` builds:

```
{"version":"20260916001944","fileSha256":"c79374a85369589e3a5ed6e5f58b5ccf495e0ba1ad420f9e589b7bd1dba6aec9"}
```

`--allows-backdated` on the same file also exits 0. A negative control with the
run id changed by one digit refuses, as it must:

```
historical production provenance mismatch for previewApplyRun
```

## Scope

No guard is weakened, relaxed, or special-cased. The source PR merge and its
ancestry to the promoted main commit remain proved by the existing gate. An
unregistered version, or a changed run, commit, source, merge, digest, filename
or byte, fails the registry check and returns to the ordinary producer-mismatch
refusal. This change dispatches no preview or production workflow and makes no
database change.
