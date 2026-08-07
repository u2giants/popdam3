# Master Data and DesignFlow read-only comparison

Captured: 2026-08-07T22:38:30.987Z

## Baseline

Production shared Supabase was queried read-only. DesignFlow production remains Cloud SQL by configuration; the Supabase dflow tables are a mirror. Counts: packaging 19, product size absent, creative designers 3 assignments, factories 93, itemDepth 121, item headers 19462.

## Packaging Type

All 8 hard-coded values and all 19 core rows are accounted for. 0 normalized exact, 1 alias candidate, 7 DesignFlow-only. Live item usage is effectively empty: 19,461 blank and one “Cardboard corners”. Phase 2 exception list is in comparison-summary.json.

## Product Size / MG04

The direct ColdLion header call returned a paged envelope with 37 rows on page 0 and terminal-page metadata. It identified MG04 Size for SP001, EH001, and CW001. Detail calls are documented plain arrays: SP001 187, EH001 156, CW001 187; total 530, each with a SHA-256 hash. The dflow mirror has 661. Composite matches: 644; mirror-only: 17; direct-only: 0; label conflicts: 11. The mirror includes EP001 (9) although the current direct header feed does not advertise it. Therefore the direct feed is proven not to be a complete replacement for all mirrored/live identities, and the importer must not be built yet. Production has no core.product_size table and no matching applied migration-ledger entry.

## Creative Designer

There are 3 creative_designer assignments across 3 items, all for one DesignFlow user. That person has no exact canonical core.creative_designer match. Two creative_director assignments were correctly excluded. Phase 2 needs one owner-approved person mapping.

## Vendor / Factory

The mirror has 169 legacy Factory rows, core has 93, and 14 match by normalized exact name. ItemHeader contains no nonblank vendor reference, so no currently mirrored item is blocked by a Vendor FK. The remaining name-only mappings are Phase 2 review candidates and must be reconciled through ColdLion/source codes before cutover.

## Depth

The mirror has 121 lookup rows (121 active) and 98 distinct stored item text values. 49 nonblank stored values do not exactly normalize to one lookup title; 5 map to multiple lookup rows. 0.63 is in the mirrored lookup. The newest Airbyte timestamp recorded on itemDepth is 2021-08-19T18:37:18.583Z, so this copy cannot prove the authoritative current Cloud SQL snapshot. The comparison therefore accounts for the mirror and all mirrored item values, but production authority remains a blocking evidence gap before import.

## Cut Point A result

All six read-only domains were compared. No schema or business data was changed. Size is blocked by direct-feed incompleteness and absent core.product_size. Depth is blocked by the stale/unproven Cloud SQL mirror. Packaging, Creative Designer, and Vendor/Factory remain Phase 2.
