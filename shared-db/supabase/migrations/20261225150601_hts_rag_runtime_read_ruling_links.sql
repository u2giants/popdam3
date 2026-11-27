-- #7184 (designflow-backend#278 step 4.3a): DesignFlow HTS runtime roles read the ruling precedent
-- graph hts_rag.hts_rag_ruling_links (revokes/modifies/cites/follows/distinguishes), today worker-only.
-- Same runtime-read pattern as 20261101000731 (#5244): SELECT grant plus one unscoped select policy
-- per runtime role. No write grant. Workers keep their existing grants and policies.
-- derived-from: none

grant select on hts_rag.hts_rag_ruling_links to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_ruling_links
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_links
  for select to designflow_hts_alsand_runtime using (true);
