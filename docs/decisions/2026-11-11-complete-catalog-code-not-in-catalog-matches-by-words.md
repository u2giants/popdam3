---
summary: A complete item code in a catalog format that is not in the catalog returns word matches only, no picture guesses (owner reversal 2026-11-11).
kind: decision
status: current
read-when: changing how item-code or SKU queries combine picture and text search
---

# Unknown complete item codes match by words only

**Decided by:** the owner, 2026-11-11, reversing the 2026-11-03 ruling (D5, #689).

**Decision:** exact SKU and SKU-prefix queries skip the picture leg. So does a complete code in a catalog format that is not in the catalog (it returns no matches). Other unfamiliar text keeps its existing behavior.

**Why:** SQX26DYMM02 returned 450 groups that "look NOTHING like the item # i typed in".

**Rejected:** picture guesses for a complete item code missing from the catalog.

## Source

- [plan_vector_consolidation.md sections 7 and 8, D5](../../plan_vector_consolidation.md)
