---
summary: The Railway worker is the only claimer of search-embedding leases; dam-search-ai embeds only a lease it is handed.
kind: decision
status: current
read-when: changing who claims or embeds search documents
---

# Worker is the sole embedding lease claimer

**Decided:** 2026-08-24, locked in the hybrid search rollout plan.

**Decision:** the worker claims atomically with real leases. `dam-search-ai` embeds an explicitly leased batch and refuses a missing, foreign, expired or stale lease. Telemetry stays off until Albert approves retention; hybrid search edge responses return only authorized entity IDs.

**Why:** two independent claimers can select the same rows, causing duplicate compute and repeated errors.

**Rejected:** pg_cron plus a worker loop on the pseudo-claim RPC; both layers claiming; launching telemetry with search; image embeddings in that plan; returning full documents from the edge function; direct dashboard SQL.

## Source

- [plan_hybrid_search_rollout.md section 7 and locked decisions](../../plan_hybrid_search_rollout.md)
