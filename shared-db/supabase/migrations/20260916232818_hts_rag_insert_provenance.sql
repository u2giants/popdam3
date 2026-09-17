-- Issue #2866 (claim #2867): authenticate HTS RAG insert provenance.
--
-- The original worker policies were FOR ALL with WITH CHECK (true), which let
-- either worker label a new row as coming from the other environment. Split
-- each policy by operation so SELECT remains shared, UPDATE remains shared and
-- bounded by the existing column grants, and INSERT is bound to the role.
-- source_environment remains non-null, constrained and not updatable. DELETE
-- and TRUNCATE remain ungranted.

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_rulings;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_rulings;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_rulings for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_rulings for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_rulings for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_rulings for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_rulings for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_rulings for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_examples;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_examples;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_examples for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_examples for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_product_examples for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_product_examples for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_product_examples for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_product_examples for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_precedents;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_precedents;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_precedents for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_precedents for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_precedents for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_precedents for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_precedents for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_precedents for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_precedent_rulings;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_precedent_rulings;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_precedent_rulings for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_precedent_rulings for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_precedent_rulings for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_precedent_rulings for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_precedent_rulings for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_precedent_rulings for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_extraction_jobs;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_extraction_jobs;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_extraction_jobs for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_extraction_jobs for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_extraction_jobs for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_extraction_jobs for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_extraction_jobs for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_extraction_jobs for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_determinations;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_determinations;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_determinations for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_determinations for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_determinations for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_determinations for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_determinations for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_determinations for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_provider_responses;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_provider_responses;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_provider_responses for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_provider_responses for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_provider_responses for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_provider_responses for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_provider_responses for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_provider_responses for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_review_events;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_review_events;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_review_events for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_review_events for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_review_events for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_review_events for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_review_events for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_review_events for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_family_allowlist;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_family_allowlist;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_family_allowlist for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_family_allowlist for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_product_family_allowlist for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_product_family_allowlist for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_product_family_allowlist for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_product_family_allowlist for update to designflow_hts_alsand_worker using (true) with check (true);

drop policy hts_rag_prod_worker_access on hts_rag.hts_rag_debate_runs;
drop policy hts_rag_alsand_worker_access on hts_rag.hts_rag_debate_runs;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_debate_runs for select to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_debate_runs for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_debate_runs for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_debate_runs for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_debate_runs for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_debate_runs for update to designflow_hts_alsand_worker using (true) with check (true);

do $verify$
declare
  v_table text;
  v_role text;
  v_prefix text;
  v_environment text;
begin
  foreach v_table in array array[
    'hts_rag_rulings', 'hts_rag_product_examples', 'hts_rag_precedents',
    'hts_rag_precedent_rulings', 'hts_rag_extraction_jobs', 'hts_rag_determinations',
    'hts_rag_provider_responses', 'hts_rag_review_events',
    'hts_rag_product_family_allowlist', 'hts_rag_debate_runs'
  ] loop
    foreach v_role in array array['designflow_hts_prod_worker', 'designflow_hts_alsand_worker'] loop
      v_prefix := case v_role when 'designflow_hts_prod_worker' then 'hts_rag_prod_worker' else 'hts_rag_alsand_worker' end;
      v_environment := case v_role when 'designflow_hts_prod_worker' then 'production' else 'alsand' end;

      if not exists (
        select 1 from pg_policies where schemaname = 'hts_rag' and tablename = v_table
          and policyname = v_prefix || '_access' and cmd = 'SELECT'
          and roles = array[v_role]::name[] and qual = 'true' and with_check is null
      ) then
        raise exception 'VERIFY FAILED: % SELECT policy is wrong on hts_rag.%', v_role, v_table;
      end if;
      if not exists (
        select 1 from pg_policies where schemaname = 'hts_rag' and tablename = v_table
          and policyname = v_prefix || '_insert' and cmd = 'INSERT'
          and roles = array[v_role]::name[] and qual is null
          and with_check = format('(source_environment = %L::text)', v_environment)
      ) then
        raise exception 'VERIFY FAILED: % INSERT policy is wrong on hts_rag.%', v_role, v_table;
      end if;
      if not exists (
        select 1 from pg_policies where schemaname = 'hts_rag' and tablename = v_table
          and policyname = v_prefix || '_update' and cmd = 'UPDATE'
          and roles = array[v_role]::name[] and qual = 'true' and with_check = 'true'
      ) then
        raise exception 'VERIFY FAILED: % UPDATE policy is wrong on hts_rag.%', v_role, v_table;
      end if;
    end loop;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'hts_rag') <> 66 then
    raise exception 'VERIFY FAILED: hts_rag must have exactly 66 policies after provenance repair';
  end if;
end
$verify$;
