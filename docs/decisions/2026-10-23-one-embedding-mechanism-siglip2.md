---
summary: One embedding mechanism, SigLIP2 768, serves both the DAM and PopSG corpora (D1, #4664).
kind: decision
status: current
read-when: changing the embedding model or adding a second vector model
---

# One embedding mechanism: SigLIP2 768

**Decided:** D1 in the vector consolidation plan, 2026-10-23 (#4664). Marked locked, "do not relitigate".

**Decision:** one embedding mechanism, SigLIP2 768, for both corpora. Search stays on pgvector with HNSW; the viewer statement ceiling is a product rule.

**Why:** two models and two columns already caused "never mix gte-small with SigLIP2" guards, and no measured bottleneck needs a different engine at 150k to 235k rows.

**Rejected:** VectorChord, pgvecto.rs, Timescale vectorsearch or an external vector DB (not installable on hosted Supabase); raising `statement_timeout`; going back to gte-small/384 text embeddings; bigger claim batches (known to time out).

## Source

- [plan_vector_consolidation.md sections 7 and 8](../../plan_vector_consolidation.md)
