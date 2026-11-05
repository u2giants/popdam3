-- #5703 installed metadata contract; no application data reads.
do $contract$
declare f record; a text[];
begin
 select * into strict f from pg_proc where oid='public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[])'::regprocedure;
 if pg_get_userbyid(f.proowner)<>'postgres' or not f.prosecdef or f.provolatile<>'s'
    or not f.proretset or f.pronargdefaults<>2
    or not ('statement_timeout=5s'=any(f.proconfig))
    or not ('search_path=pg_catalog, public, extensions'=any(f.proconfig)) then
   raise exception '#5703 installed function metadata drift';
 end if;
 select array_agg(coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type order by coalesce(r.rolname,'PUBLIC'),x.privilege_type)
 into a from aclexplode(f.proacl) x left join pg_roles r on r.oid=x.grantee;
 if a is distinct from array['authenticated:EXECUTE','postgres:EXECUTE','service_role:EXECUTE'] then
   raise exception '#5703 installed execute ACL drift';
 end if;
 if (select md5(prosrc) from pg_proc where oid='public.dam_search_semantic_anchor(extensions.vector,text[])'::regprocedure)
    is distinct from 'dd26e420c8dbd998696b4db95d5d7091' then
   raise exception '#5703 original anchor source drift';
 end if;
end;
$contract$;
