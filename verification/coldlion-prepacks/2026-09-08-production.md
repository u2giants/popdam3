# ColdLion prepack production acceptance — 2026-09-08

Issue: `u2giants/popdam3#114`

Production target was verified as the Virginia shared POP database before the
write. The loader then completed one transaction from fresh ColdLion reads.

- `/items`: 19,404 source rows over 98 terminal pages; 18,953 loaded after the
  governed EP001 exclusion.
- `/itemDetails`: 26,752 source rows in the endpoint's complete bare array;
  26,156 loaded after EP001 exclusion.
- `/prepackDetail`: all 2,571 distinct nonblank codes were probed; 10,095
  component rows returned and zero codes returned an empty result.
- Direct detail coverage: 2,505 items, 2,571 distinct codes, 68 multi-code items,
  maximum four codes on one item.

Reconciliation against the frozen DesignFlow-fed item heads:

- Frozen heads with prepack: 1,454.
- Exact current ColdLion matches: 1,437.
- Conflicting current codes: zero.
- Frozen-only heads: 17; all 17 are absent from the current ColdLion item-header
  feed, rather than present with a different prepack.
- Current direct coverage exceeds the frozen coverage by 1,051 items.

The durable `coldlion.sync_run` ledger holds the three endpoint probes, row
counts, page count, aggregate response hash, and successful terminal status.
The load stores current item/header/detail rows; licensed source payloads and
item identifiers are not committed to this repository.
