-- #5730: actual installed source/wire/auth contract and real RPC summary envelope.
begin;
set local search_path=pg_catalog,public,extensions;
do $test$
declare f pg_proc; n integer; total bigint; facets_present boolean;
begin
 select * into strict f from pg_proc where oid='public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)'::regprocedure;
 -- #5747 superseded the #5730 body (exact-count fast path); the dedup expression must survive.
 if position('array(select distinct q.tsq from queries q)' in f.prosrc)=0 then
   raise exception '#5730 installed function differs beyond the one FTS expression';
 end if;
 if pg_get_function_arguments(f.oid)<>'p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding vector DEFAULT NULL::vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real'
    or pg_get_function_result(f.oid)<>'TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)'
    or not f.prosecdef or f.provolatile<>'s' or not f.proretset
    or pg_get_userbyid(f.proowner)<>'postgres'
    or f.proconfig<>ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
    or f.proacl::text<>'{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' then
   raise exception '#5730 original owner/ACL/runtime contract changed';
 end if;
 if has_function_privilege('anon',f.oid,'EXECUTE')
    or not has_function_privilege('authenticated',f.oid,'EXECUTE')
    or not has_function_privilege('service_role',f.oid,'EXECUTE') then
   raise exception '#5730 role access changed';
 end if;
 select count(*),min(total_count),bool_and(facets is not null)
 into n,total,facets_present
 from public.search_dam_documents('zzzz5730-unmatched-qqqq','{}',10,0,ARRAY['asset'],NULL,0,NULL);
 if n<>1 or total<>0 or facets_present is distinct from true then
   raise exception '#5730 actual no-match summary contract failed';
 end if;
end;
$test$;
rollback;
