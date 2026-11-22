---
summary: "User administration, permissions, and roles live in one place: DesignFlow PLM; all other apps read from it."
kind: decision
status: current
read-when: designing or modifying user accounts, roles, or permissions in CRM, DAM, PIM, or PLM
---

# User administration lives in DesignFlow PLM (§6.33)

**Decided by:** Albert Hazan, 2026-10-28

## Decision

DesignFlow PLM is the single place that holds user data, roles, and permissions; CRM, DAM, and PIM pull user roles from there rather than maintaining separate user-admin stores.

> "this should be pulled from the roles set in designflow plm. there should be one place that holds all the user data/permissions/roles."

## Why

Prevents fragmented user provisioning and inconsistent permissions across POP Creations apps.

## Rejected

Building separate per-app user/role administration screens or tables.

## Source

Original record (left in place): [`docs/owner-rulings-part-4.md` §6.33](../owner-rulings-part-4.md#633-owner-ruling--user-administration-lives-in-designflow-plm-albert-hazan-2026-10-28)
