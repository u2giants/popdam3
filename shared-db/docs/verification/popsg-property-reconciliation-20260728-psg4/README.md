# PSG-4 owner decision package: Batch 01 exact existing

**Status:** PENDING ALBERT'S EXPLICIT PSG-4 APPROVAL
**Scope:** 51 same-parent exact matches affecting 44,331 active files
**Frozen source SHA-256:** `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`
**Immutable package SHA-256:** `e4ad02fd19491cef12a9a78204e7fca457c0ebefcc5197099e30cd39a64e0f68`

## Business decision

The recommendation is to approve all 51 rows. Each observed PopSG Property value exactly matches
an existing canonical Property name or code under the same resolved Licensor. This package creates
nothing and changes nothing. Approval only records the bounded PSG-4 business decision for later,
separately authorized PSG-5 work.

## Totals

| Decision | Rows | Files |
|---|---:|---:|
| Approve `exact_existing` same-parent target | 51 | 44,331 |
| Reject | 0 | 0 |
| Defer inside this package | 0 | 0 |
| Canonical create | 0 | 0 |

## Highest-impact rows

| Licensor | Observed value | Existing Property | Files |
|---|---|---|---:|
| DISNEY | winnie the pooh | WP / WINNIE THE POOH | 6,887 |
| WARNER BROS | looney tunes | LT / LOONEY TUNES | 3,402 |
| VIACOM MULTI | spongebob | SB / SPONGEBOB | 2,868 |
| DISNEY | frozen | FZ / FROZEN | 2,692 |
| AARDMAN ANIMATIONS | shaun the sheep | SSE / SHAUN THE SHEEP | 2,657 |
| DISNEY | cars | CAR / CARS | 2,594 |
| NBC | gabbys dollhouse | GD / GABBY'S DOLLHOUSE | 1,902 |
| NBC | shrek | SH / SHREK | 1,692 |
| NBC | kung fu panda | KP / KUNG-FU PANDA | 1,325 |
| NBC | minions | MN / MINIONS | 1,284 |

## Parent proof

Every row fails closed unless its resolved Licensor ID exactly equals the target Property's parent
Licensor ID in the frozen PSG-2 evidence. All 51 rows passed. The package also requires an existing
target Property ID, an exact-name or exact-code reason, no fuzzy selection, no cross-parent flag,
and no already-effective proposal.

## Explicit exclusions

This package does not include or approve Batch 02, canonical creates, the 6,961 at-risk removals,
ambiguous or deferred rows, schema or migration work, RLS or RPC work, database writes, mapping
activation, tag rebuilds, deployment, production, or PSG-5.

## Exact owner approval language

Copy the single line from `approval-language.txt` exactly. The package remains pending until
Albert sends that exact bounded approval. The message timestamp becomes the owner decision
timestamp. Any changed decision row, source byte, or approval scope requires a new package and
new approval.

## Files and validation

- `decisions.csv`: one row per decision, including disposition, reason, parent evidence,
  evidence reviewer/time, and the pending owner reviewer/time contract.
- `manifest.json`: source binding, file hashes, exclusions, and immutable package hash.
- `approval-language.txt`: exact bounded words Albert must send.
- `node scripts/popsg-property-psg4-decision-package.test.cjs`: reproduces and verifies the
  source hash, 51 rows, 44,331 files, every parent edge, every exclusion, and all package hashes.
