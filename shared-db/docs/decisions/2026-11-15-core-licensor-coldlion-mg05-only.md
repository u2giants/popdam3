---
summary: "core.licensor is a nightly copy of ColdLion MG05 only, written solely by plm.sync_core_licensor_from_coldlion."
kind: decision
status: current
read-when: reading, syncing, or writing core.licensor
---

# core.licensor comes only from ColdLion MG05 (§6.41)

**Decided by:** Albert Hazan, 2026-11-15 (issue #6440)

## Decision

There is no hand-maintained licensor list. `core.licensor` is a nightly copy of the ColdLion MG05 list written only by `plm.sync_core_licensor_from_coldlion`, enforced by a database trigger. Never read retired non-MG05 rows as a source or bypass the guard.

> "delete 'our own system's licensor list' so no future session can use it. the only thing to be using is the canonical MG05 list we build from what comes in on the API"

## Why

Eliminates dual-source licensor drift between hand-maintained lists and ERP MG05.

## Rejected

Hand-editing `core.licensor`, loading licensors from non-MG05 sources, or bypassing the write-guard trigger.

## Source

Original record (left in place): [`docs/owner-rulings-part-4.md` §6.41](../owner-rulings-part-4.md#641-owner-ruling--corelicensor-is-the-coldlion-mg05-list-only-no-hand-maintained-licensor-list-albert-hazan-2026-11-15)
