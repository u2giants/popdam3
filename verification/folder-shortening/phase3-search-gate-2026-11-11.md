# Phase 3 — search gate and live proof (2026-11-11)

Production project `qsllyeztdwjgirsysgai` (checked with `get_project_url` before every write).

## What shipped

| Piece | Where | Live |
|---|---|---|
| `infer_path_attrs`: `In Dev`→`In Development`, `Cust Adopted`, `Concept Approved`→`Concept Approved Designs`, year folders | popcre/shared-db#6079, migration `20261111215610` | production apply 8:00 PM EST (run 43130899404) |
| Program keeps the year when its folder name lacks it (found by this gate) | popcre/shared-db#6105, migration `20261112013144` | production apply ~9:20 PM EST |
| Workflow map `in dev`, `cust adopted`, `concept approved`; tag junk list; `STAGE_OPTIONS` comment | u2giants/popdam3 #967 (`04d457b`), #972 (`e8391b7`) | edge functions deployed at `e8391b7`; frontend build `eeb2cd2` contains both; Railway worker deployment `e8391b7` success |

Tests: `supabase/tests/dam_infer_path_attrs_short_names_contracts.sql` (shared-db, ephemeral DB, green), `supabase/functions/_shared/metadata-derivation.test.ts` (vitest, green). Root `npm test`: 1003 passed; 3 agent test files fail locally only because the generated `apps/*/src/common/` copy is absent in this worktree (unrelated; CI `lint-test-build` green). `npm run typecheck` green.

## Live function proof (production)

| Path under `____New Structure/` | stage / customer / program |
|---|---|
| `In Dev/Cust Adopted/Ross/2026/Wall/SKU/f.psd` | In Development / Ross / Wall 2026 |
| `In Development/Customer Adopted/Ross/2026/Ross Wall 2026/PQE8QMVAV01/f.psd` | In Development / Ross / Ross Wall 2026 |
| `In Development/Customer Adopted/Ross/Ross Wall 2026/PQE8QMVAV01/f.psd` | In Development / Ross / Ross Wall 2026 |
| `In Development/Customer Adopted/Dollar General/2027/Dollar General Harvest Coir/SKU/f.psd` | In Development / Dollar General / Dollar General Harvest Coir 2027 |
| `Concept Approved/Ross/f.psd` | Concept Approved Designs / – / – |

Plan 3.5 expected program `Wall` for the short-name example; it is `Wall 2026` by the O5 rule (derived program keeps the year so searches are unchanged).

## Re-backfill

Batches of 1,500–2,500 rows (5,000 timed out on the per-row search-index refresh). First pass: 35,899 assets + 2,111 style groups. Second pass after #6105: 14,389 assets + 913 style groups. Afterwards 0 rows differ from the function. Old values are recoverable: the only changed field was `program`, previously the bare year segment of the path.

## Search gate (same queries before and after)

| Check | Before (4:00 PM EST) | After (9:25 PM EST) |
|---|---:|---:|
| search `Ross Wall 2026` | 1510 | 1510 |
| search `Dollar General 2027` | 2288 | 2288 |
| search `Desperate` | 57 | 57 |
| assets stage = In Development | 78877 | 78877 |
| assets customer = Ross | 8976 | 8976 |
| assets with program = a bare year | 2455 (Ross) | 0 (intended fix) |
| assets program = `Ross Wall 2026` | 23 | 391 (intended fix) |
| style groups stage = In Development | 2752 | 2731 — equals the number of groups whose folder is under `In Development`; difference is normal group churn over 5 h |

Intermediate result (after #6079 only): `Ross Wall 2026` 1067, `Dollar General 2027` 2236 — ~15.9k files under year folders lost the year from search. #6105 fixed it.
