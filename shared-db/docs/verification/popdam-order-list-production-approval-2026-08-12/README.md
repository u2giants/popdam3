# PopDAM OrderList production approval package

Prepared 2026-08-12. This package contains counts, hashes, object names, and workflow evidence only. It contains no workbook rows, customer data, vendor data, order text, SKU text, credentials, or licensed source content.

## Decision summary

- **Schema:** complete. The OrderList contract is already in production as part of atomic B9. Do not reapply it and do not approve an isolated OrderList migration.
- **Production data import:** not yet executable or approved. The checked-in importer deliberately refuses every non-preview write.
- **PopDAM `/orders` deployment:** not approved. The page is not built or preview-tested, and the canonical item bridge is not ready.

## Immutable source and preview baseline

The only approved source is:

- local workbook name: `OrderList.xlsx`;
- spreadsheet ID: `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`;
- tab: `Order`, gid `0`;
- SHA-256: `68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe`;
- populated rows: 12,354.

The preview proof in `docs/verification/popdam-order-list-preview-2026-08-12/README.md` is the production comparison baseline:

| Measure | Required result |
|---|---:|
| planned canonical orders | 3,225 |
| quarantined orders | 13 |
| orders inserted into an empty target | 3,212 |
| planned canonical lines | 24,151 |
| lines inserted into an empty target | 24,010 |
| lines skipped with quarantined orders | 141 |
| unique Master Data resolutions | 23,649 |
| ambiguous Master Data resolutions | 448 |
| unmatched SKU resolutions | 41 |
| no usable SKU/type resolutions | 13 |
| balance checks | 10 of 10 PASS |
| second identical run | 0 business rows changed |

Any different source hash or any unexplained count difference cancels approval.

## Schema evidence

The contract landed through PR #663 and consists of these migrations:

1. `20260810010000_popdam_order_list_contract.sql`
2. `20260810060000_popdam_order_list_source_pair_nulls_distinct.sql`
3. `20260810100000_link_dam_order_line_cross_item_ambiguity.sql`

They were rehearsed on preview with 86 object assertions and 38 behavior assertions. Production run `31620553795`, at exact reviewed commit `71ab704240ab73a51676a4c38d373cf625e144fe`, applied all 14 migrations in atomic B9. Its post-push ledger recorded all three OrderList versions. The run's final result was red only because the post-apply verifier incorrectly demanded already-applied companion migration `20260810180000`; PR #843 fixed that ledger-aware verifier after the database push. The successful push and after-ledger are the production evidence.

Do not run another migration for this import. Do not promote the three versions separately from B9.

## Required importer change before an approval can be exact

`scripts/import-order-list-xlsx.py` currently has no production mode. It requires `--preview`, proves project ref `rjyboqwcdzcocqgmsyel`, and refuses other real writes. This is a safety feature, not a command-line detail to bypass.

Before production import approval, a shared-db PR must add a fail-closed production path that:

1. requires an explicit `--production` flag that is mutually exclusive with `--preview` and `--replace-source`;
2. requires project ref `qsllyeztdwjgirsysgai` immediately before opening the transaction and again before every batch;
3. requires the exact workbook hash above;
4. requires an exact confirmation bound to the reviewed git SHA, source hash, and project ref;
5. keeps `--replace-source` impossible in production;
6. runs the same count assertions and secret-free report generation used in preview;
7. has focused tests proving wrong target, wrong hash, missing confirmation, `--replace-source`, and target drift all fail before a write;
8. is reviewed, merged, and green before a new immutable approval package names its commit SHA and exact command.

No manual SQL, altered local script, relaxed checksum, or direct database workaround is acceptable.

## Exact production run gates after that PR lands

The final approval package must substitute the merged importer commit SHA into the command and confirmation. Until then, the sequence is fixed but intentionally non-executable:

1. Confirm a clean checkout at the reviewed SHA and verify the workbook SHA-256.
2. Capture a fresh read-only production ledger and object proof for the three migrations and `api.dam_order_list` as `security_invoker`.
3. Capture safe counts showing whether any `google_order_list` source references already exist. An unexpected nonzero count stops the run.
4. Run the importer in `--dry-run` mode. It must reproduce every baseline count above and write nothing.
5. Obtain Albert's approval of the exact SHA-bound wording below.
6. Run once in production mode with the reviewed SHA, exact hash, exact production ref, bounded batch size 500, and no replace flag.
7. Re-run without replacement. It must change zero business rows.
8. Capture a secret-free production reconciliation report. Counts must equal the approved baseline, including 3,212 orders, 24,010 lines, 13 quarantined orders, 141 skipped lines, and all 10 balance checks.
9. Keep `/orders` disabled. A data import does not approve application deployment.

## Approval wording to use after the production importer PR exists

The placeholders below must be replaced with the merged importer commit and its exact tested command. Approval is invalid while either placeholder remains.

> I approve one production import of `OrderList.xlsx`, SHA-256 `68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe`, into Supabase project `qsllyeztdwjgirsysgai`, using reviewed shared-db commit `<IMPORTER_COMMIT_SHA>` and exact command `<EXACT_TESTED_COMMAND>`. Expected results are 3,212 inserted orders and 24,010 inserted lines from 12,354 populated source rows, with 13 quarantined orders, 141 skipped lines, all 10 balance checks passing, and a second identical run changing zero business rows. I do not approve `--replace-source`, any different workbook, any schema change, or deployment of PopDAM `/orders`.

## Item and style-bridge dependency ruling

The production import is structurally capable of retaining rows with nullable `plm.production_order_line.item_id`. Preview proved that behavior. It preserves the exact `unique`, `ambiguous`, `unmatched`, and unusable resolution evidence in metadata without inventing canonical items.

That does not make the product-linking feature complete:

- `plm.item` remains unpopulated by the active item relocation plan;
- `api.plm_item_list` still reads legacy `public.erp_items_current`;
- the style-item bridge has not completed the Phase 4 cutover to populated canonical item IDs;
- 23,649 preview lines had a unique Master Data resolution but could not receive `item_id`.

Therefore:

- a production historical seed may be considered after the guarded importer exists, with the pending links clearly accepted in the exact approval;
- `/orders` must not be approved for production until `fix_schema_for_api.md` Phases 2–4 populate `plm.item`, backfill and repoint the style bridge without orphaning rows, and the OrderList links are reconciled;
- do not add a second FK to `public.style_tracker_rows` and do not invent `plm.item` rows in the OrderList importer;
- do not invent a Coldlion line reconciliation key. Coldlion auto-claiming stays disabled for non-unique candidates until a real payload supports a reviewed key.

## Rollback and disable boundary

Before import, failure means no write and no rollback. During import, each 500-row batch is transactional; a failed batch rolls back as a unit and a later run safely resumes committed source refs.

After a successful production import, do not hard-delete imported rows. If the seed must be withdrawn before staff editing, keep `/orders` disabled and use a separately reviewed, target-proved corrective migration or RPC to mark the imported `google_order_list` records void/inactive. Any destructive removal needs its own explicit approval.

## Genuine blockers

1. The repository has no production-capable OrderList importer.
2. The exact production command and commit-bound confirmation cannot exist until that guarded change merges.
3. `/orders` is not built or authenticated-preview-tested.
4. `plm.item` population and the style-item bridge Phase 4 cutover are incomplete.

The schema itself and the preview reconciliation are not blockers. They are complete.
