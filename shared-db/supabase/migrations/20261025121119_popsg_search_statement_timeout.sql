-- Issue #4210; exact-object claim #4701.
-- Owner decision (Albert, 2026-10-23): "don't let it fail. if it takes 8 seconds, it takes
-- 8 seconds." Broad Guides searches run ~3 s idle and ~8 s under load on this compute, so
-- the authenticated role's 8 s statement_timeout intermittently cancels them (SQLSTATE
-- 57014). PostgREST applies a function-level statement_timeout to RPC calls; give this one
-- read-only search function 30 s. The role default stays 8 s for everything else.
do $guard$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)')
    and md5(prosrc) = '4cdde9e8fed849a203374f7e93139afd'
    and (select coalesce(array_agg(setting order by setting), '{}') from unnest(coalesce(proconfig, '{}'::text[])) setting) = array['search_path=pg_catalog, auth','work_mem=64MB']) then
    raise exception 'PopSG search timeout change requires the exact live function and settings';
  end if;
end
$guard$;

alter function public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer) set statement_timeout = '30s';

do $verify$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)')
    and md5(prosrc) = '4cdde9e8fed849a203374f7e93139afd'
    and (select coalesce(array_agg(setting order by setting), '{}') from unnest(coalesce(proconfig, '{}'::text[])) setting) = array['search_path=pg_catalog, auth','statement_timeout=30s','work_mem=64MB']) then
    raise exception 'PopSG search timeout change did not install the expected settings';
  end if;
end
$verify$;

notify pgrst, 'reload config';
