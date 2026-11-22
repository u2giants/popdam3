---
summary: "core.property is ColdLion's Property list, populated daily via ColdLion -> landing table -> app table."
kind: decision
status: current
read-when: loading, syncing, or modifying core.property
---

# core.property is ColdLion's Property list, filled daily from landing (§6.37)

**Decided by:** Albert Hazan, 2026-11-12

## Decision

`core.property` is populated daily from ColdLion through the established pipeline: ColdLion API → landing table → `core.property` used by the apps.

> "yes. all 3 should be filled from coldlion via the established path: coldlion to landing table, landing table to the table used by the apps."

## Why

Keeps the canonical property list synchronized automatically with ColdLion ERP.

## Rejected

Maintaining a separate manually-edited property list outside the ColdLion landing pipeline.

## Source

Original record (left in place): [`docs/owner-rulings-part-4.md` §6.37](../owner-rulings-part-4.md#637-owner-ruling--coreproperty-is-coldlions-property-list-filled-daily-from-the-landing-albert-hazan-2026-11-12)
