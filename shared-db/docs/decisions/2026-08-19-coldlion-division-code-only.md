---
summary: "ColdLion division codes (CW001, SP001, EH001, EP001) are canonical; DesignFlow numeric division IDs do not enter Supabase."
kind: decision
status: current
read-when: mapping or storing division identifiers across ColdLion and DesignFlow
---

# ColdLion division code is the only division; EP001 filtered from new ingest (§6.1b, §6.17)

**Decided by:** Albert Hazan, 2026-08-19

## Decision

Use ColdLion division codes exclusively; DesignFlow's legacy numeric division IDs (1, 2, 7, 9) are wrong and do not come to Supabase. Historical `EP001` rows remain as-is, while `EP001` is filtered out of new ingest.

> "Designflow's division numbers (1, 2, 7, 9) were wrong and will not be moving to the new Supabase db. Coldlion is correct"

## Why

Legacy DesignFlow numeric IDs disagreed with ERP divisions; standardizing on ColdLion codes eliminates cross-app division mismatches.

## Rejected

Importing DesignFlow numeric division IDs into Supabase or ingesting new `EP001` records.

## Source

Original record (left in place): [`docs/owner-rulings-part-3.md` §6.17](../owner-rulings-part-3.md#617-owner-ruling--designflows-numeric-division-ids-are-wrong-and-do-not-come-to-this-database-the-coldlion-division-code-is-the-only-division-there-is-albert-hazan-2026-08-19) and [§6.1b](../owner-rulings-part-1.md#61b-division-codes--two-encodings-and-the-one-that-will-bite-you-2026-08-17)
