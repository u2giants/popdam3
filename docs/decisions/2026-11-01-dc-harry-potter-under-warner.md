---
summary: DC and Harry Potter are properties under the Warner Bros licensor, never licensors of their own (owner ruling 2026-11-01).
kind: decision
status: current
read-when: resolving licensor or property for DC or Harry Potter, or touching core.licensor DC/HP rows
---

# DC and Harry Potter belong to Warner Bros

**Decided by:** Albert Hazan, owner ruling, 2026-11-01.

> "DC and Harry Potter were not left out. they used to (Wrongly) be listed as their own licensors. that was wrong, they are properties under Warner Bros, which is how it is now."

**Decision:** DC and Harry Potter are properties under the Warner Bros licensor (`WB`). Character and property work resolves them through the Warner scrape. A `DC` or `HP` SKU code, or a `DC`/`HP` row in `core.licensor`, does not make either one a licensor.

**Why:** they were wrongly listed as separate licensors. As of 2026-11-01 the live `core.licensor` table still held active `DC` and `HP` rows with no characters, so data had not caught up. Re-measure before relying on those rows.

**Rejected:** treating them as excluded, or as separate licensors.

## Source

- [docs/idiosyncrasies.md, DC and Harry Potter belong to Warner Bros](../idiosyncrasies.md#dc-and-harry-potter-belong-to-warner-bros)
