-- =====================================================================================
-- Assembled item description search contracts — migration 20261225130602 (dflow half),
-- issue #7041 (popcre/designflow-item-master#194 steps 3.1/3.2). Proves resolve_mg_path
-- (D3), product_type_search (approved only by default, per-division resolution, D2 no
-- MG03 / pick allow-list, words + search_terms + vector fusion, other-size vectors
-- ignored, empty query by use, limit) and embellishment_phrase_search, idempotent
-- re-apply, and no EXECUTE for public. Runs inside the caller's transaction (CI wraps it
-- in BEGIN ... ROLLBACK). EVERY VALUE IN THIS FILE IS INVENTED.
-- =====================================================================================
drop schema if exists dflow_prod cascade;
drop schema if exists dflow cascade;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create schema dflow;
create table dflow."itemHeader" (item_id_pk integer primary key);
create table dflow."merchGroup" (mg_id integer primary key, mg_code varchar, mg_desc varchar, "mgTypeCode" varchar,
  "divisionCode_fk" varchar, is_active boolean, parent_id integer, "mgCategory" varchar);

do $roles$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end
$roles$;
\i supabase/migrations/20261225091506_dflow_assembled_item_description.sql
\i supabase/migrations/20261225130602_dflow_assembled_description_search.sql
\i supabase/migrations/20261225130602_dflow_assembled_description_search.sql

do $t$
declare
  n int; v_root int; v_m2 int; v_m3 int; v_m3b int; v_m2x int;
  pt_canvas bigint; pt_mat bigint; pt_draft bigint; pt_pick bigint; m bigint; r record;
  e1 text := '[' || array_to_string(array_fill(0.0::float8, array[2]) || array[1.0::float8], ',') || ']';
begin
  -- Tree, division ZZ1: A Wall Stretched > A2 Wall Canvas > {11 Wall Foil, 01 Workspace None}; V Floor > D1 Floor Door (no MG03).
  insert into dflow."merchGroup" (mg_id, mg_code, mg_desc, "mgTypeCode", "divisionCode_fk", is_active, parent_id, "mgCategory")
    overriding system value values
    (9100, 'A', 'Stretched/Box', '01', 'ZZ1', true, null, 'Wall'),
    (9101, 'A2', 'Canvas', '02', 'ZZ1', true, 9100, 'Wall'),
    (9102, '11', 'Foil', '03', 'ZZ1', true, 9101, 'Wall'),
    (9103, '01', 'None', '03', 'ZZ1', true, 9101, 'Workspace'),
    (9104, 'V', 'Floor coverings', '01', 'ZZ1', true, null, 'Floor'),
    (9105, 'D1', 'Door', '02', 'ZZ1', true, 9104, 'Floor'),
    (9200, 'A', 'Stretched/Box', '01', 'ZZ2', true, null, 'Wall'),
    (9201, 'A', 'Stretched/Box', '01', 'ZZ2', true, null, 'Wall');

  -- R. resolve_mg_path
  select * into r from dflow.resolve_mg_path('ZZ1', array['A','Wall','stretched/box '], array['A2','Wall','Canvas'], array['11','Wall','Foil']);
  if r.state <> 'resolved' or r.mg03_id <> 9102 or r.active_mg03 <> 2 then raise exception 'R1 fixed path did not resolve: %', r; end if;
  select * into r from dflow.resolve_mg_path('ZZ1', array['A','Wall','Stretched/Box'], array['A2','Wall','Canvas']);
  if r.state <> 'resolved' or r.mg03_id is not null or r.mg02_id <> 9101 then raise exception 'R2 two-level path: %', r; end if;
  select * into r from dflow.resolve_mg_path('ZZ1', array['A','Wall','Stretched/Box'], array['A2',null,'Canvas']);
  if r.state <> 'missing' or r.level <> 'MG02' then raise exception 'R3 category must match null-safely: %', r; end if;
  select * into r from dflow.resolve_mg_path('ZZ2', array['A','Wall','Stretched/Box'], array['A2','Wall','Canvas']);
  if r.state <> 'ambiguous' or r.level <> 'MG01' or r.match_ids <> array[9200, 9201] then raise exception 'R4 ambiguous MG01: %', r; end if;
  update dflow."merchGroup" set is_active = false where mg_id = 9102;
  select * into r from dflow.resolve_mg_path('ZZ1', array['A','Wall','Stretched/Box'], array['A2','Wall','Canvas'], array['11','Wall','Foil']);
  if r.state <> 'missing' or r.level <> 'MG03' then raise exception 'R5 inactive MG03 must not resolve: %', r; end if;
  update dflow."merchGroup" set is_active = true where mg_id = 9102;

  -- Catalog: approved canvas (fixed Foil), approved door mat (MG02 has no MG03 -> never offered),
  -- draft canvas, approved pick type whose allow-list resolves.
  insert into dflow.product_type (name, search_terms, source, status, approved_at) values ('ZZ Printed canvas art', 'stretched canvas picture', 'seed', 'approved', now()) returning id into pt_canvas;
  insert into dflow.product_type_mg (product_type_id, mg01_code, mg01_category, mg01_name, mg02_code, mg02_category, mg02_name, mg03_mode, mg03_code, mg03_category, mg03_name)
    values (pt_canvas, 'A','Wall','Stretched/Box','A2','Wall','Canvas','fixed','11','Wall','Foil');
  insert into dflow.product_type (name, source, status, approved_at) values ('ZZ Coir door mat', 'seed', 'approved', now()) returning id into pt_mat;
  insert into dflow.product_type_mg (product_type_id, mg01_code, mg01_category, mg01_name, mg02_code, mg02_category, mg02_name, mg03_mode)
    values (pt_mat, 'V','Floor','Floor coverings','D1','Floor','Door','pick');
  insert into dflow.product_type (name, source) values ('ZZ Canvas draft art', 'seed') returning id into pt_draft;
  insert into dflow.product_type_mg (product_type_id, mg01_code, mg01_category, mg01_name, mg02_code, mg02_category, mg02_name, mg03_mode, mg03_code, mg03_category, mg03_name)
    values (pt_draft, 'A','Wall','Stretched/Box','A2','Wall','Canvas','fixed','11','Wall','Foil');
  insert into dflow.product_type (name, source, status, approved_at) values ('ZZ Foil canvas wall piece', 'seed', 'approved', now()) returning id into pt_pick;
  insert into dflow.product_type_mg (product_type_id, mg01_code, mg01_category, mg01_name, mg02_code, mg02_category, mg02_name, mg03_mode)
    values (pt_pick, 'A','Wall','Stretched/Box','A2','Wall','Canvas','pick') returning id into m;
  insert into dflow.product_type_mg03_allowed (product_type_mg_id, mg03_code, mg03_category, mg03_name) values (m, '01', 'Workspace', 'None');

  -- S1 words only: approved rows that resolve; drafts excluded by default.
  select count(*) into n from dflow.product_type_search('canvas', null, 'ZZ1');
  if n <> 2 then raise exception 'S1 expected the 2 approved resolving canvas types, got %', n; end if;
  if exists (select 1 from dflow.product_type_search('canvas', null, 'ZZ1') s where s.product_type_id = pt_draft) then raise exception 'S2 draft offered to designers'; end if;
  -- S3 drafts only when asked (approver evaluation mode).
  select count(*) into n from dflow.product_type_search('canvas', null, 'ZZ1', array['approved','draft']);
  if n <> 3 then raise exception 'S3 evaluation mode should include the draft, got %', n; end if;
  -- S4 a type whose MG02 has no active MG03 is never offered (D2).
  if exists (select 1 from dflow.product_type_search('coir door mat', null, 'ZZ1') s where s.product_type_id = pt_mat) then raise exception 'S4 MG02 without MG03 offered'; end if;
  -- S5 another division where the path is ambiguous: nothing.
  select count(*) into n from dflow.product_type_search('canvas', null, 'ZZ2');
  if n <> 0 then raise exception 'S5 ambiguous division returned % rows', n; end if;
  -- S6 search_terms count: "picture" finds the canvas type.
  select s.product_type_id into m from dflow.product_type_search('picture', null, 'ZZ1') s limit 1;
  if m is distinct from pt_canvas then raise exception 'S6 search_terms not searched'; end if;
  -- S7 vector: the closest vector wins even with no shared word; a vector of another size is ignored.
  update dflow.product_type set embedding = cast('[0,0,1]' as extensions.vector), embedding_model = 'zz', embedding_dim = 3 where id = pt_pick;
  update dflow.product_type set embedding = cast('[1,0,0]' as extensions.vector), embedding_model = 'zz', embedding_dim = 3 where id = pt_canvas;
  select s.product_type_id into m from dflow.product_type_search('shiny metallic hanging', e1, 'ZZ1') s order by s.score desc limit 1;
  if m is distinct from pt_pick then raise exception 'S7 vector rank not fused'; end if;
  select count(*) into n from dflow.product_type_search('zzqx', '[1,0]', 'ZZ1');
  if n <> 0 then raise exception 'S8 vector of another size was used'; end if;
  -- S9 pick mode with an allow-list that no longer resolves is not offered.
  update dflow."merchGroup" set is_active = false where mg_id = 9103;
  if exists (select 1 from dflow.product_type_search('foil canvas', null, 'ZZ1') s where s.product_type_id = pt_pick) then raise exception 'S9 pick type with no resolving allowed MG03 offered'; end if;
  update dflow."merchGroup" set is_active = true where mg_id = 9103;
  -- S10 empty query returns the division's most-chosen types first.
  insert into dflow.product_type_search_log (division_code, query_text, result_count, chosen_product_type_id) values ('ZZ1', 'x', 1, pt_pick), ('ZZ1', 'x', 1, pt_pick);
  select s.product_type_id into m from dflow.product_type_search('', null, 'ZZ1') s limit 1;
  if m is distinct from pt_pick then raise exception 'S10 empty query not ordered by use'; end if;
  -- S11 limit is capped.
  select count(*) into n from dflow.product_type_search('canvas', null, 'ZZ1', array['approved'], 1);
  if n <> 1 then raise exception 'S11 limit ignored'; end if;

  -- E. embellishment phrases
  insert into dflow.embellishment_phrase (phrase, use_count) values ('zz embroidered applique', 3), ('zz glitter edge', 9), ('zz foil accents', 1);
  select e.phrase into r from dflow.embellishment_phrase_search('embroidrd patch', null) e limit 1;
  if r.phrase <> 'zz embroidered applique' then raise exception 'E1 misspelling not matched by trigram: %', r; end if;
  select e.phrase into r from dflow.embellishment_phrase_search('', null) e limit 1;
  if r.phrase <> 'zz glitter edge' then raise exception 'E2 empty query not ordered by use_count'; end if;
  select count(*) into n from dflow.embellishment_phrase_search('zz', null, 2);
  if n > 2 then raise exception 'E3 limit ignored'; end if;
  -- P. not executable by public
  if has_function_privilege('public', 'dflow.product_type_search(text, text, text, text[], integer)', 'EXECUTE') then raise exception 'P1 public can execute'; end if;
end
$t$;
