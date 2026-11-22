---
summary: "ColdLion ERP data is canonical; follow ColdLion inactivations and removals rather than preserving stale raw records."
kind: decision
status: current
read-when: syncing or reconciling ColdLion vendors, properties, or licensors
---

# ColdLion ERP data is canonical (§6.3)

**Decided by:** Albert Hazan, 2026-07-31

## Decision

ColdLion ERP data is canonical. When ColdLion inactivates or removes a vendor, property, or licensor, follow it rather than keeping the old value active.

> **Coldlion ERP data is canonical.** When Coldlion inactivates or removes a vendor, property or licensor, **follow it** — do not preserve the old value on the grounds that the raw/bronze record is immutable. Ruled by Albert Hazan, 2026-07-31.

## Why

ColdLion is the operational ERP of record; preserving stale active rows after ColdLion retires them causes drift across apps.

## Rejected

Treating bronze/raw records as immutable active state that ignores ColdLion inactivations or removals.

## Source

Original record (left in place): [`docs/owner-rulings-part-1.md` §6.3](../owner-rulings-part-1.md#63-owner-ruling--coldlion-erp-data-is-canonical-albert-hazan-2026-07-31)
