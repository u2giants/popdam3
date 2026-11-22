---
summary: "A structural claim or session idle for 10 days may be taken over by a fresh session."
kind: decision
status: current
read-when: handling a stale structural claim or abandoned workstream
---

# Claims idle for 10 days may be taken over (§6.35)

**Decided by:** Albert Hazan, 2026-11-02

## Decision

If a session holding a claim has been idle for 10 days, a fresh session may take it over rather than waiting indefinitely.

> "If a session is idle for 10 days it obviously is not coming back. spin up a nested session to take it over"

## Why

Prevents permanently wedged object claims when an earlier session dies without releasing its lock.

## Rejected

Leaving 10+-day-idle claims blocked indefinitely waiting for the original session.

## Source

Original record (left in place): [`docs/owner-rulings-part-4.md` §6.35](../owner-rulings-part-4.md#635-owner-ruling--a-claim-idle-for-10-days-may-be-taken-over-albert-hazan-2026-11-02)
