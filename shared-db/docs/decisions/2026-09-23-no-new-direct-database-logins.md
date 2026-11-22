---
summary: "Do not create new direct Postgres database logins; use sanctioned service/application access paths."
kind: decision
status: current
read-when: provisioning database access, roles, or credentials
---

# No new direct database logins (§6.21)

**Decided by:** Albert Hazan, 2026-09-23

## Decision

Do not create new direct database login roles for users or ad-hoc workflows.

Recorded in §6.21 (2026-09-23): no new direct database logins.

## Why

Prevents credential sprawl and unmonitored bypass of application and RLS boundaries.

## Rejected

Issuing new direct Postgres login roles for individual users or scripts.

## Source

Original record (left in place): [`docs/owner-rulings-part-3.md` §6.21](../owner-rulings-part-3.md#621-owner-ruling--no-new-direct-database-logins-albert-hazan-2026-09-23)
