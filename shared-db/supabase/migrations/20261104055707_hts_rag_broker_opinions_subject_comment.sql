-- derived-from: none
-- Review finding #5569 on #5568 (designflow-backend#278): state the product subject key.
-- A product opinion is about one classifier determination; determination_id alone is the
-- subject (one authoritative opinion per determination per environment, enforced by
-- hts_rag_broker_opinions_product_auth_uq). rfq_item_id only records which RFQ line the
-- broker was looking at; it is not part of the key.
comment on column hts_rag.hts_rag_broker_opinions.determination_id is
  'Product subject key: the classifier determination the opinion is about. One authoritative opinion per determination per environment.';
comment on column hts_rag.hts_rag_broker_opinions.rfq_item_id is
  'Annotation only: the RFQ line the broker reviewed. Not part of the subject key.';
