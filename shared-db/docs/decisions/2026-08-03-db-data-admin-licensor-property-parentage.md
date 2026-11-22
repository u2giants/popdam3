---
summary: "DB Data Admin is the home for monitoring and establishing licensor-to-property parentage across all apps."
kind: decision
status: current
read-when: editing or designing licensor-to-property parentage UI or ownership
---

# DB Data Admin owns licensor-to-property parentage (§6.6, §6.12)

**Decided by:** Albert Hazan, 2026-08-03 (corrected 2026-08-07)

## Decision

DB Data Admin (hosted in `u2giants/popdam3`) is where licensor-to-property parent-child relationships are monitored and established, not inside a single downstream app.

> "DB Data Admin screen should be where we monitor and establish the licensor→property parent-child relationship. It sits in designflow now but we all agreed it should not be only in 1 particular application."

## Why

Licensor and property parentage is shared across CRM, DAM, PIM, and DesignFlow PLM, so it belongs in the shared Master Data admin surface.

## Rejected

Keeping licensor-to-property parentage management exclusively inside DesignFlow PLM.

## Source

Original record (left in place): [`docs/owner-rulings-part-2.md` §6.6](../owner-rulings-part-2.md#66-owner-ruling--db-data-admin-is-the-home-for-licensorproperty-parentage-albert-hazan-2026-08-03--this-reverses-the-previous-stance) and [§6.12](../owner-rulings-part-2.md#612-correction-to-66-rule-5--there-is-no-parentage-durability-migration-added-2026-08-07)
