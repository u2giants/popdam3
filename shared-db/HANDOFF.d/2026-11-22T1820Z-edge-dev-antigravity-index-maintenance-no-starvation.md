# Handoff: Prevent Index Maintenance from Starving Schema Promotions

- **Date (EST):** 2026-11-22 1:20 PM EST
- **Repository:** `popcre/shared-db` (`main` baseline `759bea851`)
- **Implementation Plan:** [`plan_index-maintenance-no-starvation.md`](../plan_index-maintenance-no-starvation.md)
- **Status:** Open plan created and debated with GLM-5.3; implementation not yet started.

## Context

On November 21, 2026 (9:30 PM – 10:01 PM EST), merged migration PR `#6939` (`20261225090102`) was starved in the automatic production promotion queue for >30 minutes by an unrelated index-maintenance operation (`repack-20261109-6c9d5541`) that reset its 3-attempt retry cap on every unrelated `main` commit and ran ahead of `Start the next automatic promotion`. PR `#6948` (`96784c24`) already fixed the review-finding check mismatch, but the SHA-scoped retry reset, abort-on-exhausted loop, and maintenance-before-migrations ordering remain open.

## Next Step

Follow [`plan_index-maintenance-no-starvation.md`](../plan_index-maintenance-no-starvation.md) starting at its STATUS table and Lead Launch Prompt.
