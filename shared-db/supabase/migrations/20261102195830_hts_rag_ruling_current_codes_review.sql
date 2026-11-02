-- Review finding #5457 on 20261102165731 (issue #5454, designflow-backend#278), fixed forward.
-- 1. Workers can correct renumbering provenance (source_url, is_partial) on their own rows.
-- 2. The sandbox runtime reads only sandbox rows, like the production runtime.
-- 3. Codes follow the schema's canonical shape: chapter 98/99 and 8-digit lines are legal
--    current codes, and every candidate is checked too.
-- 4. Shape is exact: unmapped carries no candidates; current/mapped name a code among them.

grant update (source_url, is_partial) on hts_rag.hts_rag_hts_renumbering
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_hts_renumbering
  for update to designflow_hts_prod_worker
  using (source_environment = 'production') with check (source_environment = 'production');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_hts_renumbering
  for update to designflow_hts_alsand_worker
  using (source_environment = 'alsand') with check (source_environment = 'alsand');

drop policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_current_codes;
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_current_codes
  for select to designflow_hts_alsand_runtime using (source_environment = 'alsand');

alter table hts_rag.hts_rag_ruling_current_codes drop constraint hts_rag_ruling_current_codes_code_check;
alter table hts_rag.hts_rag_ruling_current_codes add constraint hts_rag_ruling_current_codes_code_check
  check ((current_code is null or current_code ~ '^[0-9]{4}(\.[0-9]{2}){0,3}$')
         and array_to_string(candidate_codes, ',') ~ '^([0-9]{4}(\.[0-9]{2}){0,3}(,|$))*$');

alter table hts_rag.hts_rag_ruling_current_codes drop constraint hts_rag_ruling_current_codes_shape_check;
alter table hts_rag.hts_rag_ruling_current_codes add constraint hts_rag_ruling_current_codes_shape_check check (
  (state in ('current', 'mapped') and current_code is not null and current_code = any (candidate_codes))
  or (state = 'split' and current_code is null and cardinality(candidate_codes) > 1)
  or (state = 'unmapped' and current_code is null and cardinality(candidate_codes) = 0));
