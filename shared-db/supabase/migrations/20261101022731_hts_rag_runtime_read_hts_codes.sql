-- #5260: DesignFlow HTS runtime roles read the HTS code and renumbering tables the classifier
-- resolves held codes against. Same runtime-read pattern as 20261101000731 (#5244): SELECT grant
-- plus one unscoped select policy per runtime role. Workers keep their grants and policies.
-- derived-from: none

grant select on hts_rag.hts_rag_hts_codes to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_hts_codes
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_hts_codes
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_hts_renumbering to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_hts_renumbering
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_hts_renumbering
  for select to designflow_hts_alsand_runtime using (true);
