-- #5482: let claim_dam_search_embedding_documents read candidates in claim
-- order and stop after p_limit rows. The existing claim index lacks the
-- leading `(document_type = 'style_group') desc` sort key, so every call
-- fetched all eligible rows from the heap and sorted them (~19-21k blocks).
-- Key order mirrors the function's ORDER BY exactly; the partial predicate
-- matches its two static filters. Claim ordering and eligibility unchanged.

create index if not exists dam_search_embedding_claim_order_idx
  on public.dam_search_documents ((document_type = 'style_group') desc, indexed_at, document_type, entity_id)
  where embedding is null
    and embedding_error_category is distinct from 'permanent';
