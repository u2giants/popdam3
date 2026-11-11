---
summary: New RPC dam_search_semantic_anchors (#5703) returning scores for one or two 768-dimension vectors; grants, errors and verification.
kind: spec
status: current
read-when: calling or changing the batched DAM semantic anchors RPC
---

# PopDAM bounded semantic anchors (#5703)

The new `public.dam_search_semantic_anchors(first vector, second vector default null, document_types text[] default null)` returns ordered `(query_index integer, score real)` rows for one or two inputs. First is required; both dimensions must be 768. Invalid dimensions/NULL first raise 22023. Malformed pgvector literals retain pgvector errors. NULL second requests one row. Empty scopes/model mismatch/empty eligible corpus retain NULL scores, which required semantic callers must reject rather than substitute keyword results.

This is a new RPC. Existing `dam_search_semantic_anchor` source, owner, settings and ACL are unchanged. Both authenticated and service_role retain execute; anon/PUBLIC have none. SECURITY DEFINER calls the existing DAM access helper exactly once before validation/data reads. The same scope gates, model, HNSW settings and independent maxima remain. Group-only exact scoring aggregates two independent MIN cosine distances in one dense-table pass, including original NaN ordering. It retains both original and corrected query variants.

The five-second setting matches the original; nested function settings are not proof of an independent hard deadline. Caller transport cancellation and the existing outer server deadline must remain. No global timeout changes. A local blocked-query drill verifies actual outer five-second cancellation with cleanup. Production latency remains an acceptance requirement, not inferred from local tests.

## Verification

`DAM_BATCH_ANCHOR_DOCKER=1 python3 -m unittest scripts/test_dam_batched_semantic_anchors.py` runs an isolated real pgvector PostgreSQL fixture. It compares original and batch for all scopes, zero vectors/all-NaN, empty/model mismatch, dimensions, roles/denied access, immutable original metadata, installed contract drift, and actual nested auto_explain proving one dense relation execution and one permission call. No production data or licensed vectors are committed.

Run `supabase/tests/dam_batched_semantic_anchors_contracts.sql` against the installed preview/production metadata through governed verification. Native preview must additionally prove current source, exact permissions, actual target data equivalence and bounded runtime before automatic promotion. Application consumer ships only after actual database delivery. This optimization alone does not prove the original search outage resolved.
