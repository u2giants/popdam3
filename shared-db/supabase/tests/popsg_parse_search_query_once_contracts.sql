begin;
-- Read-only post-apply search contract. Performance proof remains on #4210.
select exists (select 1 from pg_proc where oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)')
  and md5(prosrc) = '9d5dd045810fa3fce5cc3d508e1210ff' and proowner = 'postgres'::regrole and prosecdef and provolatile = 's'
  and proconfig @> array['search_path=pg_catalog, auth','work_mem=64MB'])
  and has_function_privilege('authenticated','public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)','execute')
  and to_regprocedure('public.has_app_access(uuid,public.app_name)') is not null
  and not exists (select 1 from (values
    ('public.style_guide_search_documents','r'),
    ('public.style_guide_files','r'),
    ('public.style_guide_render_queue','r'),
    ('public.style_guide_library_default_summary','m'),
    ('public.style_guide_library_default_guides','m')
  ) required(name,kind) where not exists (select 1 from pg_class c
    where c.oid=to_regclass(required.name) and c.relkind::text=required.kind))
  and not exists (select 1 from (values
    ('public.style_guide_search_documents','style_guide_file_id','uuid'),
    ('public.style_guide_search_documents','search_vector','tsvector'),
    ('public.style_guide_search_documents','tag_names','text[]'),
    ('public.style_guide_search_documents','is_active','boolean'),
    ('public.style_guide_files','id','uuid'),
    ('public.style_guide_files','thumbnail_url','text'),
    ('public.style_guide_files','is_active','boolean'),
    ('public.style_guide_render_queue','style_guide_file_id','uuid'),
    ('public.style_guide_render_queue','attempts','integer'),
    ('public.style_guide_library_default_summary','result_mode','text'),
    ('public.style_guide_library_default_summary','total','bigint'),
    ('public.style_guide_library_default_summary','facets','jsonb'),
    ('public.style_guide_library_default_guides','result','jsonb'),
    ('public.style_guide_library_default_guides','modified_at','timestamptz'),
    ('public.style_guide_library_default_guides','sort_name','text'),
    ('public.style_guide_library_default_guides','entity_key','text')
  ) required(relation_name,column_name,type_name) where not exists (
    select 1 from pg_attribute a where a.attrelid=to_regclass(required.relation_name)
      and a.attname=required.column_name and a.atttypid=to_regtype(required.type_name)
      and not a.attisdropped))
 as passed;

do $contract$
declare b text; passed boolean;
begin
 select exists (select 1 from pg_proc where oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)')
  and md5(prosrc) = '9d5dd045810fa3fce5cc3d508e1210ff' and proowner = 'postgres'::regrole and prosecdef and provolatile = 's'
  and proconfig @> array['search_path=pg_catalog, auth','work_mem=64MB'])
  and has_function_privilege('authenticated','public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)','execute')
  and to_regprocedure('public.has_app_access(uuid,public.app_name)') is not null
  and not exists (select 1 from (values
    ('public.style_guide_search_documents','r'),
    ('public.style_guide_files','r'),
    ('public.style_guide_render_queue','r'),
    ('public.style_guide_library_default_summary','m'),
    ('public.style_guide_library_default_guides','m')
  ) required(name,kind) where not exists (select 1 from pg_class c
    where c.oid=to_regclass(required.name) and c.relkind::text=required.kind))
  and not exists (select 1 from (values
    ('public.style_guide_search_documents','style_guide_file_id','uuid'),
    ('public.style_guide_search_documents','search_vector','tsvector'),
    ('public.style_guide_search_documents','tag_names','text[]'),
    ('public.style_guide_search_documents','is_active','boolean'),
    ('public.style_guide_files','id','uuid'),
    ('public.style_guide_files','thumbnail_url','text'),
    ('public.style_guide_files','is_active','boolean'),
    ('public.style_guide_render_queue','style_guide_file_id','uuid'),
    ('public.style_guide_render_queue','attempts','integer'),
    ('public.style_guide_library_default_summary','result_mode','text'),
    ('public.style_guide_library_default_summary','total','bigint'),
    ('public.style_guide_library_default_summary','facets','jsonb'),
    ('public.style_guide_library_default_guides','result','jsonb'),
    ('public.style_guide_library_default_guides','modified_at','timestamptz'),
    ('public.style_guide_library_default_guides','sort_name','text'),
    ('public.style_guide_library_default_guides','entity_key','text')
  ) required(relation_name,column_name,type_name) where not exists (
    select 1 from pg_attribute a where a.attrelid=to_regclass(required.relation_name)
      and a.attname=required.column_name and a.atttypid=to_regtype(required.type_name)
      and not a.attisdropped))
 into passed;
 if passed is distinct from true then raise exception 'Search identity, settings or grants changed'; end if;
 select prosrc into b from pg_proc where oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)');
 if position('execute $guides_query$' in b)=0
   or position('$guides_query$ into v_result using v_mode, p_query, p_licensors' in b)=0
   or position('page_children as materialized' in b)=0
   or position('page_metadata as materialized' in b)=0
   or position('page_tags as materialized' in b)=0 then
   raise exception 'Search must use bound guide planning and separate tag/page metadata';
 end if;
end
$contract$;
-- Full synthetic search/filter/paging/access contracts are exercised by the
-- existing popsg_search_style_guide_library_v2_contracts.sql suite. This test
-- pins the serving identity, settings, roles and exact dependencies separately.
rollback;
