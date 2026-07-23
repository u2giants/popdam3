# Sample Tracking quantity schema verification — 2026-07-22

## Scope

This evidence covers the additive Sample Tracking quantity contract in migrations
`20260722220200` through `20260722220700`. The earlier prerequisite migrations
`20260722220000` and `20260722220100` restore current box membership and enforce
membership uniqueness.

## Inventory decisions

- Preview had zero legacy sample, box, and membership rows.
- Production had three sample rows and no boxes; `dflow.sample_shipment_item` was
  absent before the prerequisite migration.
- The running service uses `sample_shipment_item` as current membership, so
  historical legs use additive `sample_shipment_line` rows.
- Existing quantities remain `quantity_migration_state='unknown'`; no legacy row
  is fabricated as quantity one.
- Box ownership uses the existing integer `dflow.vendor.vendor_id` identity.
- Ningbo and New York are stable `office` location IDs; retained units stay at
  their physical location and remain outstanding until an authorized closeout.
- Workbook binaries/images remain in private object storage; the database holds
  only references and audit metadata.

## Preview evidence

- Dry-run listed only migrations `20260722220200`–`20260722220600`.
- All five applied successfully to preview `rjyboqwcdzcocqgmsyel`.
- `supabase/tests/sample_tracking_quantity_contract.sql` completed and rolled back.
- Four-piece result: Ningbo 1, New York 2, customer 1, transit 0.
- Identical idempotency replay returned the original movement; conflicting reuse
  failed. Over-allocation and posted-row mutation both failed.
- Two concurrent three-unit requests against a four-unit source produced one
  successful movement and one rejection; no negative balance occurred.
- Existing tracking suite passed: 35 suites, 323 tests.

## Security and authority

`anon` and `authenticated` have no direct privileges on movement, shipment,
closeout, or import tables. The private tracking service authorizes actors and
posts through `dflow.post_sample_movement`. PostgreSQL serializes each sample
stream and independently rejects negative balances. Posted movements cannot be
updated or deleted; corrections are compensating movements.

## Rollback

The rollout is additive. Consumer usage can stop without dropping legacy columns.
Posted movements are audit history and must never be deleted for rollback.
