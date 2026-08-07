# Master Data and DesignFlow read-only comparison

Captured: 2026-08-07T22:38:30.987Z

## Baseline

Production shared Supabase was queried read-only. DesignFlow production remains Cloud SQL by configuration; the Supabase dflow tables are a mirror. Counts: packaging 19, product size absent, creative designers 3 assignments, factories 93, itemDepth 121, item headers 19462.

## Packaging Type

All 8 hard-coded values and all 19 core rows are accounted for. 0 normalized exact, 1 alias candidate, 7 DesignFlow-only. Live item usage is effectively empty: 19,461 blank and one “Cardboard corners”. Phase 2 exception list is in comparison-summary.json.

## Product Size / MG04

The direct ColdLion header call returned a paged envelope with 37/37 rows and `totalPages=1`. It identified MG04 Size for SP001, EH001, and CW001. Detail calls are documented plain arrays: SP001 187, EH001 156, CW001 187; total 530, each with a SHA-256 hash. Authoritative Cloud SQL has 661 legacy MG04 rows. The 17 direct-feed gaps are resolved: 8 are inactive historical Size rows with zero current item-code usage, and 9 are EP001 values whose MG04 header means Pages, not Size. The 11 normalized label differences retain the same division-plus-code identity; ColdLion supplies the current label and the legacy label remains in source history. Production has no `core.product_size` table and no matching applied migration-ledger entry. Full evidence: `cloudsql-depth-mg04-resolution.md`.

## Creative Designer

There are 3 creative_designer assignments across 3 items, all for one DesignFlow user. That person has no exact canonical core.creative_designer match. Two creative_director assignments were correctly excluded. Phase 2 needs one owner-approved person mapping.

## Vendor / Factory

The mirror has 169 legacy Factory rows, core has 93, and 14 match by normalized exact name. ItemHeader contains no nonblank vendor reference, so no currently mirrored item is blocked by a Vendor FK. The remaining name-only mappings are Phase 2 review candidates and must be reconciled through ColdLion/source codes before cutover.

## Depth

Authoritative production Cloud SQL has 121 lookup rows and 98 distinct stored Item Header text values. Its 121 lookup rows match the Supabase mirror exactly across legacy ID, code, title, status, and audit text. All nonblank usage totals also match; Cloud SQL has 209 newer Item Headers, all with blank Depth. `0.63` is present. The Cloud SQL snapshot hashes and access evidence are recorded in `cloudsql-depth-mg04-resolution.md`.

## Cut Point A result

All six read-only domains were compared. No schema or business data was changed. The Cloud SQL and MG04 evidence gaps are closed. Implementation remains unstarted: `core.product_size` and `core.product_depth` do not yet exist, and the guarded importer has not been built. Packaging, Creative Designer, and Vendor/Factory remain Phase 2.
