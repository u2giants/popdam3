# Product-type reader

`read_product_type(description)` reads physical product wording deterministically.
It does not read MG codes, query a database, use a model, or write application rows.
The returned fields match the Phase A plan; `matched_wording` is audit evidence
and is not a database column. Empty facts are empty strings. Multiple explicitly
stated facts use a semicolon separator. No unstated material is supplied.

`legacy.py` is a standalone fork of the historical MG-era ruleset in
`docs/verification/item-mg-reclassification-20260814/product_type_dictionary.py`;
nothing re-exports it and the two copies are not kept in sync.  The historical
copy stays frozen for reproducing the 2026-08-14 work.  `reader.py` seeds part of
its product vocabulary from `legacy.LEGACY_PATTERNS` (filtered), so the new
reader does depend on that historical table; use the package API for new work. `baseline.py` adapts that unchanged
historical API for comparison against the same independent gold evidence.

## Reproduce evaluation

The complete catalog, exact-description assignments, review notes and unreadable
list are private evidence in `u2giants/licensor-source-data`, under
`product-type-reader/2026-09-20/`. They must never be copied into this repository.
The gold labels (`labels.csv`) and the reviewed real-description fixture
(`reviewed-description-fixture.csv`) are private too: both carry catalog wording,
and licensed catalog wording must never enter this public repository.

Run from the repository root with Python, pandas and pytest installed:

```sh
python -m pytest -q docs/verification/item-mg-reclassification-20260814 tools/product_type_reader
PRODUCT_TYPE_READER_PRIVATE_FIXTURE=PRIVATE/reviewed-description-fixture.csv python -m pytest -q tools/product_type_reader/test_catalog_fixture.py
python tools/product_type_reader/gold/coverage.py --corpus PRIVATE/catalog.json --labels PRIVATE/labels.csv --assignments PRIVATE/assignments.csv
python tools/product_type_reader/evaluate.py --corpus PRIVATE/catalog.json --manifest PRIVATE/manifest.json --labels PRIVATE/labels.csv --assignments PRIVATE/assignments.csv --live-recheck docs/verification/product-type-reader/live-recheck-2026-09-24.json --strict
```

Add `--reader legacy` for the baseline and `--report REPORT.md` for an aggregate
report. `--private-details PRIVATE/details.json` writes source-bearing exceptions
only outside public shared-db checkouts. Reports bind the source bytes, gold,
assignments and implementation hashes. The manifest records the source row count,
capture time (with timezone) and source table; the evaluator checks exactly these, not the project. Null and empty descriptions remain distinct.

Expected answers are independently reviewed source facts, never reader output.
Private assignments bind each exact source-description hash to a public label.
Group review and individual review are distinguished in the private evidence.
Strict mode fails on wrong answers, readable descriptions incorrectly abandoned,
unreviewed coverage, invalid predictions, errors or changed source evidence.
Prediction counts alone are not accuracy evidence. A passing test suite alone is
not full-catalog acceptance.

Albert's Phase A ruling: descriptions explicitly mixing different products are
unreadable, with **mixed products** recorded as the private review reason. A single
constructed product with accessories is not automatically a mixed assortment.
Database population remains Phase B and requires Albert's acceptance on #3024
(non-orchestrator work).

Strict mode also requires `--live-recheck FILE`: a public aggregate JSON
(`checked_at` with timezone, `sha256`, `source_row_count`, `distinct_descriptions`,
`source`) that must match the corpus exactly and be taken at or after capture.
The accuracy claim is snapshot-bound: a changed catalog changes the sha and the
gate refuses until the new rows are labelled and rechecked.
