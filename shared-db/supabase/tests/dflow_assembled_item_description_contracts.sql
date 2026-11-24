-- =====================================================================================
-- Assembled item description behavior contracts — migration 20261225091506 (dflow half),
-- issue #7041 (popcre/designflow-item-master#194). Proves the nine tables' rules:
-- live product-type names unique case-insensitively, un-sized vector with model
-- and dimension kept consistent, one default MG path per type, request outcomes,
-- one current convention per division, append-only item parts with one current
-- row, phrase uniqueness, display-name rules, trigram indexes and no vector index,
-- and that the migration is idempotent. Runs inside the caller's transaction
-- (CI wraps it in BEGIN ... ROLLBACK). EVERY VALUE IN THIS FILE IS INVENTED.
-- =====================================================================================

-- The CI ephemeral stack carries dflow_prod (production shape), on which the
-- sandbox half refuses by design; drop it inside the caller's transaction.
drop schema if exists dflow_prod cascade;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists dflow;
create table if not exists dflow."itemHeader" (item_id_pk integer primary key);

-- Fixture item (invented). OVERRIDING SYSTEM VALUE covers a GENERATED ALWAYS key.
insert into dflow."itemHeader" (item_id_pk) overriding system value values (987654321);

\i supabase/migrations/20261225091506_dflow_assembled_item_description.sql
\i supabase/migrations/20261225091506_dflow_assembled_item_description.sql

do $t$
declare n int; pt bigint; pt2 bigint; ptm bigint; conv bigint; p1 bigint;
begin
  -- A. product types: name unique case-insensitively among non-retired.
  insert into dflow.product_type (name, source) values ('ZZ Canvas Wall Art', 'seed') returning id into pt;
  begin
    insert into dflow.product_type (name, source) values (' zz canvas wall art ', 'manual');
    raise exception 'A1 duplicate live name was accepted';
  exception when unique_violation then null; end;
  update dflow.product_type set status = 'retired' where id = pt;
  insert into dflow.product_type (name, source) values ('zz canvas wall art', 'manual') returning id into pt;
  begin
    update dflow.product_type set status = 'approved' where id = pt;
    raise exception 'A2 approved without approved_at';
  exception when check_violation then null; end;
  update dflow.product_type set status = 'approved', approved_at = now() where id = pt;

  -- B. un-sized vector with model + dimension beside it (D5).
  update dflow.product_type set embedding = '[1,2,3]'::extensions.vector,
    embedding_model = 'zz-model', embedding_dim = 3 where id = pt;
  begin
    update dflow.product_type set embedding_dim = 4 where id = pt;
    raise exception 'B1 wrong embedding_dim accepted';
  exception when check_violation then null; end;
  insert into dflow.product_type (name, source, embedding, embedding_model, embedding_dim)
    values ('ZZ Other', 'seed', '[1,2,3,4,5]'::extensions.vector, 'zz-model-b', 5) returning id into pt2;

  -- C. MG path: one default row per type, division overrides, fixed needs MG03.
  insert into dflow.product_type_mg (product_type_id, mg01_code, mg01_name, mg02_code, mg02_name,
    mg03_mode, mg03_code, mg03_name)
    values (pt, 'ZZ1', 'ZZ ONE', 'ZZ2', 'ZZ TWO', 'fixed', 'ZZ3', 'ZZ THREE');
  begin
    insert into dflow.product_type_mg (product_type_id, mg01_code, mg01_name, mg02_code, mg02_name, mg03_mode)
      values (pt, 'ZZ1', 'ZZ ONE', 'ZZ2', 'ZZ TWO', 'pick');
    raise exception 'C1 second default path accepted';
  exception when unique_violation then null; end;
  insert into dflow.product_type_mg (product_type_id, division_code, mg01_code, mg01_name, mg02_code, mg02_name, mg03_mode)
    values (pt, 'ZZ001', 'ZZ1', 'ZZ ONE', 'ZZ2B', 'ZZ TWO B', 'pick') returning id into ptm;
  begin
    insert into dflow.product_type_mg (product_type_id, division_code, mg01_code, mg01_name, mg02_code, mg02_name, mg03_mode)
      values (pt2, 'ZZ001', 'ZZ1', 'ZZ ONE', 'ZZ2', 'ZZ TWO', 'fixed');
    raise exception 'C2 fixed without MG03 accepted';
  exception when check_violation then null; end;
  insert into dflow.product_type_mg03_allowed (product_type_mg_id, mg03_code, mg03_name) values (ptm, 'ZZ3A', 'ZZ FOIL');
  begin
    insert into dflow.product_type_mg03_allowed (product_type_mg_id, mg03_code, mg03_name) values (ptm, 'ZZ3A', 'ZZ FOIL');
    raise exception 'C3 duplicate allow-list row accepted';
  exception when unique_violation then null; end;

  -- D. requests resolve to exactly one outcome.
  insert into dflow.product_type_request (requested_text, item_draft) values ('zz rope bin', '{"a":1}');
  begin
    insert into dflow.product_type_request (requested_text, status) values ('zz x', 'approved');
    raise exception 'D1 approved request without a product type accepted';
  exception when check_violation then null; end;
  begin
    insert into dflow.product_type_request (requested_text, status, resolved_at) values ('zz x', 'rejected', now());
    raise exception 'D2 rejection without a reason accepted';
  exception when check_violation then null; end;

  -- E. one current convention per division.
  insert into dflow.description_convention (division_code, version, template, is_current)
    values ('ZZ001', 1, '{"parts":[]}', true) returning id into conv;
  begin
    insert into dflow.description_convention (division_code, version, template, is_current)
      values ('ZZ001', 2, '{"parts":[]}', true);
    raise exception 'E1 second current convention accepted';
  exception when unique_violation then null; end;
  insert into dflow.description_convention (division_code, version, template, is_current)
    values ('ZZ002', 1, '{"parts":[]}', true);

  -- F. item parts are append-only with one current row per item.
  insert into dflow.item_description_parts (item_fk, product_type_id, convention_id, assembled_description)
    values (987654321, pt, conv, 'ZZ one') returning id into p1;
  begin
    insert into dflow.item_description_parts (item_fk, product_type_id, convention_id, assembled_description)
      values (987654321, pt, conv, 'ZZ two');
    raise exception 'F1 second current parts row accepted';
  exception when unique_violation then null; end;
  begin
    update dflow.item_description_parts set assembled_description = 'ZZ edited' where id = p1;
    raise exception 'F2 in-place edit accepted';
  exception when check_violation then null; end;
  update dflow.item_description_parts set is_current = false where id = p1;
  insert into dflow.item_description_parts (item_fk, product_type_id, convention_id, assembled_description)
    values (987654321, pt, conv, 'ZZ two');
  begin
    update dflow.item_description_parts set is_current = true where id = p1;
    raise exception 'F3 re-current of an old row accepted';
  exception when check_violation then null; end;
  select count(*) into n from dflow.item_description_parts where item_fk = 987654321;
  if n <> 2 then raise exception 'F4 expected 2 parts rows, got %', n; end if;

  -- G. phrases unique case-insensitively; search log.
  insert into dflow.embellishment_phrase (phrase) values ('ZZ glitter');
  begin
    insert into dflow.embellishment_phrase (phrase) values ('zz GLITTER');
    raise exception 'G1 duplicate phrase accepted';
  exception when unique_violation then null; end;
  insert into dflow.product_type_search_log (query_text, result_count, chosen_product_type_id) values ('zz canvas', 1, pt);

  -- H. display names: omit_reason only when omitted; groups only on MG06.
  insert into dflow.mg_display_name (division_code, mg_level, mg_code, display_name, omit_from_name, omit_reason)
    values ('ZZ001', 'MG05', 'ZZL', 'ZZ Licensor', true, 'few_properties');
  insert into dflow.mg_display_name (division_code, mg_level, mg_code, parent_mg_code, display_name, property_group)
    values ('ZZ001', 'MG06', 'ZZP', 'ZZL', 'ZZ Property', 'ZZ Group');
  begin
    insert into dflow.mg_display_name (division_code, mg_level, mg_code, display_name, omit_reason)
      values ('ZZ001', 'MG05', 'ZZM', 'ZZ M', 'obvious');
    raise exception 'H1 omit_reason without omit accepted';
  exception when check_violation then null; end;
  begin
    insert into dflow.mg_display_name (division_code, mg_level, mg_code, display_name, property_group)
      values ('ZZ001', 'MG05', 'ZZN', 'ZZ N', 'ZZ Group');
    raise exception 'H2 group on a licensor accepted';
  exception when check_violation then null; end;
  begin
    insert into dflow.mg_display_name (division_code, mg_level, mg_code, display_name)
      values ('ZZ001', 'MG05', 'ZZL', 'ZZ dup');
    raise exception 'H3 duplicate code accepted';
  exception when unique_violation then null; end;

  -- I. no vector index; trigram indexes present.
  select count(*) into n from pg_indexes where schemaname = 'dflow'
    and indexname in ('product_type_name_trgm','product_type_search_terms_trgm','embellishment_phrase_phrase_trgm');
  if n <> 3 then raise exception 'I1 expected 3 trigram indexes, got %', n; end if;
  select count(*) into n from pg_indexes where schemaname = 'dflow'
    and tablename in ('product_type','embellishment_phrase')
    and (indexdef ilike '%hnsw%' or indexdef ilike '%ivfflat%');
  if n <> 0 then raise exception 'I2 a vector index exists'; end if;
end
$t$;
