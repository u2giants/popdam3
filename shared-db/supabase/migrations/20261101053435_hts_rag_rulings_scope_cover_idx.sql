-- Covering index for the ruling search chapter-scope probes (issue #5284, claim #5285).
-- derived-from: none
-- The chapter-scoped search drives 948 scope probes through the non-covering
-- hts_rag_rulings_ruling_number_key index, heap-fetching each ruling to
-- re-evaluate the similarity filter (~5.9 ms each, 5.6 s total — profile on
-- issue #5188 comment 6553758780). This covering index makes those probes
-- index-only. It is the first half of the #5283 tuning; the trigram-pass
-- narrowing (issue #5283) follows separately, its function claims being held
-- by another session.
create index if not exists hts_rag_rulings_scope_cover_idx
  on hts_rag.hts_rag_rulings (ruling_number)
  include (subject, ruling_date, effective_status, operationally_revoked);
