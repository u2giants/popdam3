# PopSG Property reconciliation PSG-2 proposal evidence

**Phase:** PSG-2 deterministic proposals only
**Status:** DRAFT INCOMPLETE; second Grok review PASS; stopped at Albert's exact-hash gate
**Generated:** 2026-07-27
**Production:** `qsllyeztdwjgirsysgai` (read-only source evidence; no PSG-2 connection or write)
**Preview:** `rjyboqwcdzcocqgmsyel` (not changed)

## Result

- Every one of the 372 PSG-1 inventory rows has exactly one proposed disposition.
- The rows cover all 216,417 active file occurrences.
- The unresolved Licensor row has no Property proposal.
- No proposal crosses a canonical Licensor parent.
- No fuzzy score selected a target or disposition.
- Every row requires owner activation and no proposal is effective or activated.
- The immutable 6,961-row at-risk input still hashes to `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
- `proposals.csv` hashes to `cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4`.
- `owner-review-batches.csv` hashes to `78afa12f5edf4ac56f00d8fad592b6c6c2bcb128730ed5c837ad29270931976d`.

## Proposed dispositions

| Proposed disposition | Distinct rows | Active files | Meaning now |
|---|---:|---:|---|
| `exact_existing` | 51 | 44,331 | Deterministic same-parent baseline; owner activation still required |
| `non_property` | 36 | 20,309 | Structural/blank candidates; human approval required |
| `canonical_create_candidate` | 2 | 293 | Existing ColdLion Phase 5 overlaps; no create approved |
| `ambiguous` | 43 | 33,416 | Open; no target selected |
| `deferred` | 239 | 118,067 | Open; insufficient deterministic evidence |
| `licensor_unresolved` | 1 | 1 | Excluded from Property work |
| `alias_existing` | 0 | 0 | No approved Property alias source exists |
| `classics_cp` | 0 | 0 | No inventory value exactly equals an approved Classics title |
| `licensed_no_code` | 0 | 0 | No inventory value exactly equals a documented no-code title |

The Disney observation `the lion king` affects 521 files but does not exactly equal the owner
list's `lion king` text. It also has multiple PSG-1 same-parent reviewer candidates, so it is
`ambiguous`, not merely an exact-Classics miss. The engine did not infer that the article is
harmless or select among candidates.

## Strict proposal order

1. Fifty canonical-name matches became `exact_existing`.
2. One canonical-code match became `exact_existing`.
3. No approved Property alias exists.
4. No exact owner-list Disney Classics observation exists.
5. Fifteen blank observations and 21 PSG-1 structural-pattern rows became `non_property` candidates.
6. No exact documented no-code observation exists.
7. `CHEERS` / `CHR` and `THE EXORCIST` / `EX` exactly overlap the existing ColdLion
   Phase 5 candidate ledger. They are routed back to that gate. Their resolved PopSG Licensor is
   evidence only; ColdLion supplies no parent, and no canonical create is approved.
8. All other rows are `ambiguous` or `deferred`.

## Immutable owner-review batches

The exact batch hashes are in `owner-review-batches.csv`. Every proposal requires owner
activation even when its classification is automatic. The recommended first bounded decision
is `batch-01-exact-existing.csv`: 51 same-parent deterministic rows covering 44,331 files. Approval
must name that batch ID and exact SHA-256. It does not approve the 36 non-Property candidates, the
two create candidates, any of the 6,961 at-risk removals, a migration, a rebuild, or production.

`batch-02-non-property.csv` needs a separate business review. `batch-03-create-candidates.csv`
must use the existing ColdLion Phase 5 re-entry gate. `batch-04-open-review.csv` is not a mapping
batch. `batch-05-licensor-unresolved.csv` remains excluded from Property work.
`batch-06-at-risk-observation` is a non-approvable pointer to the immutable 6,961-row PSG-1
risk file and its signed hash. It is evidence only, never a removal approval.

## Files

- `proposals.csv`: complete one-row-per-observation proposal ledger.
- `owner-review-batches.csv`: exact immutable hashes and recommended action for each bounded set.
- `batch-*.csv`: the frozen row sets referenced by the batch index.
- `coldlion-phase5-create-candidate-diff.csv`: all six unique Phase 5 candidates and the two PSG-2 overlaps.
- `summary.json`: reconciliation totals and zero-write safeguards.
- `authority-source-hashes.json`: current hashes for all nine PSG authority files.
- `source-hashes.json`: output and input hashes.
- `scripts/popsg-property-psg2-proposals.cjs`: deterministic generator.
- `scripts/popsg-property-psg2-proposals.test.cjs`: ordering, hash, scope, and safety tests.

## Current Git, migration, and ColdLion checkpoint

- Shared-db started clean on `main` at `f530c424b00ddd91eef4c0f8d172eeb451551f82`.
- PopDAM was clean and fast-forwarded to `main` at `c8ce9624`; only its shared-db mirror changed.
- One unrelated docs-only shared-db PR was open: #238.
- No duplicate 14-digit migration version exists.
- ColdLion Phase 6 remains **IN PROGRESS** on preview.
- Accelerated readiness Steps 1 through 10 remain open; Phase 7 is forbidden.
- PSG-2 added no migration and made no database query or write.
- The PSG-1 worker authority hash used raw CRLF checkout bytes
  (`1fe0f7214cabf15bd0cd5035c95897d40f18c8990172fa394bfb654c796f2ce3`). The current canonical LF hash is
  `76579ecba08ae1a5207bbe2f2d3a4e23a8979ad050ceb69cff11dba29c75d255`; reconstructing CRLF
  reproduces the PSG-1 hash exactly, so this is line-ending encoding, not behavior drift. PSG-5
  must rebaseline if the worker behavior hash changes.

## Failures and corrections

- Windows checkout files use CRLF, so direct working-tree hashes differed from the signed LF
  manifest. All eight exact Git blobs matched PSG-1 `source-hashes.json`; the engine canonicalizes
  CRLF to LF before verifying immutable inputs.
- The first summary tried to infer the 6,961 at-risk relationship count from an inventory aggregate
  and got 7,182 because that field includes accepted relationships beyond the signed removal set.
  The final engine counts the immutable at-risk CSV rows directly.
- A first unit-test draft rebuilt from the wrong in-memory shape. It was corrected to rerun the
  generator from the signed inputs and compare deterministic output bytes.
- First Grok review rejected the draft because parent safety was asserted rather than computed,
  Phase-5 candidates accepted bare codes, the copied normalizer changed ampersand behavior,
  activation authority was unclear, and strict-order/frozen-hash fixtures were incomplete. The
  corrected draft now fails closed on authoritative parent/name/code proof, matches Phase-5 names
  only, reuses the PSG-1 normalizer and fixtures exactly, requires owner activation for every row,
  hard-locks all proposal/batch hashes, and tests every cited boundary.
- Second Grok review passed with no Critical, High, or Medium findings. Residual non-blocking
  notes are the intentional gates: every row still needs owner activation, PSG-2 remains
  incomplete until Albert names an exact batch hash, and PSG-3 remains forbidden.
- The first clean Windows post-merge test found that the byte-for-byte normalizer source test
  normalized CRLF only on the PSG-1 side. Proposal behavior and hashes were unchanged. The test
  now canonicalizes both source strings before comparison and passes from a clean checkout.

## PSG-3 through PSG-7 forward-impact audit

- PSG-3 must show the five immutable queues separately and must not treat `batch-04` as mappings.
- PSG-3 must route the two create candidates to ColdLion Phase 5 rather than create a second ledger.
- PSG-3 must expose `the lion king` as open because no exact Classics decision exists for it.
- PSG-4 must approve exact batch hashes. No current PSG-2 row authorizes any at-risk removal.
- PSG-5 cannot assert an approved 6,961-row removal delta until Albert approves the exact expected subset.
- PSG-5 still must resolve all eight hard-coded Licensor aliases; PSG-2 did not approve them.
- PSG-6 remains blocked by the moving ColdLion checkpoint, owner sign-off, and a production window.
- PSG-7 metrics must preserve zero-valued alias/Classics/no-code proposal categories honestly.
- No phase ordering, schema assumption, rollback rule, or production safety boundary otherwise drifted.

## Gate

The second Grok review passed. PSG-2 remains draft and incomplete at Albert's exact-hash gate.
Albert must approve or reject the proposed vocabulary/bounded batch by exact hash. Do not start
PSG-3, create schema, activate decisions, or infer approval from this evidence package.
