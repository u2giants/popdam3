-- #5244: DesignFlow HTS runtime roles read the product, heading-decision and vocabulary
-- tables the classifier joins (fixes "permission denied for table hts_rag.hts_rag_ruling_products").
-- Same runtime-read pattern as 20261030215400 (e.g. hts_rag_ruling_sentences): SELECT grant plus
-- one unscoped select policy per runtime role. Workers keep their existing grants and policies.
-- derived-from: none

grant select on hts_rag.hts_rag_ruling_products to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_ruling_products
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_products
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_heading_decisions to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_heading_decisions
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_heading_decisions
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_product_attributes to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_product_attributes
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_product_attributes
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_product_components to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_product_components
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_product_components
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_article_types to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_article_types
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_article_types
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_materials to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_materials
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_materials
  for select to designflow_hts_alsand_runtime using (true);

grant select on hts_rag.hts_rag_attribute_keys to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_attribute_keys
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_attribute_keys
  for select to designflow_hts_alsand_runtime using (true);
