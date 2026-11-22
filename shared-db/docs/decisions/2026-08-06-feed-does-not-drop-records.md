---
summary: "Ingest feeds must not silently drop records; property codes are unique only per licensor (licensor_id, code)."
kind: decision
status: current
read-when: designing or modifying ColdLion/ERP ingest feeds or property uniqueness constraints
---

# Feeds must not drop records; property codes are unique per licensor (§6.10)

**Decided by:** Albert Hazan, 2026-08-06

## Decision

Ingest feeds must not drop records when codes collide across licensors (e.g., `CC` for Coco under Disney vs. Coca-Cola under Coca-Cola). Property codes are unique only per `(licensor_id, code)`.

> "If the CC is connected to a description that says Coco, it's Disney. If it says Coca Cola, it's under the Coca Cola licensor." — Albert Hazan, 2026-08-06

## Why

Different licensors legitimately reuse short property codes; global uniqueness on `code` causes silent data loss or ingest failures.

## Rejected

Enforcing global uniqueness on `core.property.code` or dropping unmatched/colliding rows during ingest.

## Source

Original record (left in place): [`docs/owner-rulings-part-2.md` §6.10](../owner-rulings-part-2.md#610-owner-rulings--the-licensorproperty-model-and-the-feed-should-not-drop-anything-albert-hazan-2026-08-06)
