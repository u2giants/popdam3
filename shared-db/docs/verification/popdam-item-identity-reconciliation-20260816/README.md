# PopDAM item identity reconciliation, counts-only

## Target and privacy

Production project `qsllyeztdwjgirsysgai` was read through
`https://qsllyeztdwjgirsysgai.supabase.co`. ColdLion was read through its
`/items` endpoint. No row values are recorded here. No database row was changed.

The repeatable checker is `tools/reconcile-coldlion-items.mjs`. It emits counts
and SHA-256 set fingerprints only. Credentials are fetched serially from
1Password and never printed or written.

## Live reconciliation

The ColdLion total advanced while this issue was waiting. The current full sweep
contains **19,315** rows, not the earlier 19,302:

| Check | Result |
|---|---:|
| ColdLion rows | 19,315 |
| Unique company + division + item keys | 19,315 |
| Duplicate full keys | 0 |
| Unique bare item numbers | 19,288 |
| CW001 | 12,911 |
| SP001 | 2,094 |
| EH001 | 3,859 |
| EP001 | 451 |

The legacy DesignFlow-backed mirror contains 17,703 rows and 17,703 unique bare
item numbers. Every legacy division remains null. Comparing those bare numbers
to ColdLion gives:

| Disposition | Legacy rows |
|---|---:|
| One ColdLion candidate | 17,445 |
| More than one division candidate | 17 |
| Absent from the current ColdLion sweep | 241 |

Ten of the 17 multi-division identities have one best candidate when the item
description and six merchandise-group fields are compared. Seven remain
ambiguous and must stay visibly unresolved. They are not guessed.

ColdLion has 1,834 rows whose bare item number is absent from the legacy mirror:
1,030 EH001, 475 CW001 and 329 SP001. EP001 has **zero** extra rows. This means
all 451 current EP001 identities are already represented by a legacy bare item
number, while the direct ColdLion load supplies their missing division.

## Preservation rule

The bridge changes while staff and scheduled jobs use it, so counts from separate
read requests are not a safe cutover proof. Migration `20260816110750` takes a
transaction-level table lock, fingerprints the exact legacy link set in one
snapshot, makes only additive safety changes, and refuses the transaction if
the legacy link set changes.

Migration `20260816045130` contains explicit transaction control that a pinned
CLI failure test proved can separate DDL from its migration-ledger row. It is
retired and hard-blocked from production; it remains on disk only because it was
already applied to preview. The safe replacement above carries the same database
body and leaves transaction ownership to Supabase CLI.

The cutover keeps `erp_item_id` for every row. It adds `plm_item_id` only when
there is one deterministic ColdLion destination:

- one full candidate for the item number, or
- for a repeated item number, one highest-scoring candidate based on the legacy
  description and merchandise-group fields.

Legacy identities absent from the current ColdLion sweep keep their existing
ERP link and a null canonical link. The same fail-loud unresolved state applies
to any tied or zero-evidence multi-division identity. The refresh function is
not allowed to replace a preserved link with null, and the canonical foreign key
uses `ON DELETE RESTRICT` so a later deletion fails rather than blanking links.
The retained legacy ERP foreign key uses the same fail-loud rule.

## Application-owned data

Loading the 19,315 ColdLion rows into the already-shipped `plm.item_import` and
`plm.item` structures is application-owned data work, not a new schema design.
It must run on preview first, followed by the bridge refresh and exact pre/post
link proof. Production follows only after the migration review, preview proof,
merge, and governed production gate.
