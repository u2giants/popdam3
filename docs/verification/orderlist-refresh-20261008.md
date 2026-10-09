# Current Google OrderList refresh — reviewed operation

Owner request is quoted on PopDAM issue #277. This is an application row-data
refresh of Google OrderList, not a shared schema or curated Master Data change.

## Source and target

- Target: production `qsllyeztdwjgirsysgai`, session pooler port 5432, verified
  from the actual connection immediately before writing.
- Google workbook: `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`, `Order` tab.
- Exact selection: `A1:AV12925`, 12,925 physical rows by 48 columns.
- Input JSON SHA-256:
  `589a8bac85fdab123860feeb8f63afdc770372c12518e21e23a0b67dce3d776c`.
- Acquisition: anonymous read-only Google Sheets browser, exact named range,
  native Copy. Plain clipboard TSV broke 42 multiline cells; structured HTML
  clipboard preserved the full rectangular selection. Streaming HTML extraction
  validated every row's 48 cells and the total against Google metadata. The
  unaltered structured source and export are retained privately.

The historical first-import CLI's pinned workbook and production replacement
refusal remain intact. `scripts/refresh-google-orderlist-rows.py` is a separate,
reviewed refresh reusing that importer's pure parser, field contract, normalization,
component expansion, and source-reference identities. No legacy production CLI
flag or refusal is changed. No DDL or canonical lookup/Item Master writes occur.

## Safety and resulting behavior

A dry run produces source-bound plans and complete protected preimages of the
four OrderList tables. Apply requires the installed `ai-task-gates check --before
database --reviewer-approval` check and unchanged source, database, catalog,
desired-output, and recovery fingerprints. An actual repeatable-read connection
locks the four target tables before its first SELECT establishes the snapshot;
a nonblocking transaction advisory lock refuses a competing import.

Headers and lines are located by existing Google source references. Missing
Google identities are inserted with UUIDs and separate source refs; existing
ones are refreshed only when changed. No existing line, order, or source ref is
deleted. Historical Google references absent from today's sheet remain.
Confirmed item links survive unchanged SKU identity; a changed SKU is rematched
without copying its old link. Header customer/vendor links survive unchanged
source identity. Original import snapshots remain separately preserved alongside
the latest Google snapshot; prior operational metadata is retained.

All 462 ColdLion lines and their headers must remain exactly unchanged. A new
Google line whose customer PO, exact normalized style, and numeric quantity match
a ColdLion line is held rather than inserted or merged. That tuple is not a
universal order identity: different documents, stages, or order numbers can
share it. Albert has been asked the genuine business question of whether 60 new
matching lines are repeated entries or additional orders. This package performs
neither interpretation and changes none of those dependent records.

Source header conflicts remain held unless their only difference is case.
Malformed assortments and incomplete rows are retained privately for correction,
not coerced into real order lines. The preliminary source profile contains
12,523 populated rows, 12 conflicting order groups covering 79 rows, 58 rejected
rows, and 24,538 planned direct/component lines. Preview against the pre-refresh
catalog predicts 100 new headers, 344 new lines, 3,060 updated headers, and
24,002 updated lines, with 60 new overlapping lines held. The catalog is expected
to change when the separately reviewed Master Data refresh completes; regenerate
the private dry-run plan then, and bind apply to that exact current plan.

The transaction verifies every desired field and parent association, inserted
row counts, unchanged ColdLion lines and headers, and commits once. Any pre-commit
failure rolls back. A lost commit acknowledgement requires readback before any
rerun. A second dry run must predict no additional writes for the same input.

## Acceptance and remaining source corrections

Fresh Google rows produce 308 possible ColdLion overlaps; 150 have equal
quantities. The private comparison workbook includes these candidates, the
12 conflicting order groups, and the 58 malformed/incomplete source rows.
These counts are a comparison, not authorization to delete or merge history.
No salesperson field is presented as evidence of entry authorship.

After apply, verify the live signed-in OrderList page, bounded first rows and
source filtering, current imported values, and unchanged ColdLion population.
Track source corrections and the 60 identity decisions on the same issue #277;
no leftover-proof or duplicate work issue is created.

## Executed result and pre-apply review conditions

October 8, 2026: the approved operation inserted 100 orders and 344 lines,
updated 3,060 orders and 24,002 lines, and preserved all 462 ColdLion lines
and their headers exactly. Sixty new matching Google lines remain held.
Before apply, full existing-ref comparison found 128 blank-PO placeholder
parents now assigned, five same-order cancellation renames, and two changed
assortment components within the same source row/assortment. There were no
unexplained parent changes and no typed numeric or date values converted to
NULL. This discharged the review's mandatory identity/fidelity conditions.

The catalog intentionally treats multiple tracker rows linked to the same
non-null canonical item as one candidate; different items or any unlinked
tracker row retain ambiguity. This is an explicit application refresh rule,
not an alteration of the historical importer's pure matching implementation.

A post-commit dry run exposed redundant original-snapshot metadata on newly
inserted lines. The refresh now saves an original snapshot only when the
source snapshot actually changes; rerunning the same source performs no writes.
Current apply must always repeat the per-ref identity and typed-value checks,
including dates, before any database gate; do not infer safety from totals.
