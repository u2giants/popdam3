-- #3725: plm.wb_validate_normalized_row(text,jsonb) was declared IMMUTABLE, but
-- for asset rows it casts source_created_at / source_modified_at text to
-- timestamptz, which depends on the session TimeZone. The strongest correct
-- volatility is STABLE. ALTER FUNCTION changes only the volatility flag: the
-- body and search_path (last defined in 20260825201330) and the grants
-- (installed in 20260813231000) are left exactly as they are.
alter function plm.wb_validate_normalized_row(text, jsonb) stable;

do $postapply$
declare p record;
begin
  select provolatile, proconfig, prosecdef, prorettype, md5(prosrc) as body_md5
    into p from pg_proc
   where oid = to_regprocedure('plm.wb_validate_normalized_row(text,jsonb)');
  if not found then
    raise exception '#3725 post-apply: plm.wb_validate_normalized_row(text,jsonb) is missing';
  end if;
  if p.provolatile <> 's'
     or p.proconfig is distinct from array['search_path=pg_catalog']
     or p.prosecdef
     or p.prorettype <> 'void'::regtype
     or p.body_md5 <> 'e28fedd3c0534399a3d890f5cf69a9ec' then
    raise exception '#3725 post-apply: unexpected catalog state %', row_to_json(p);
  end if;
end
$postapply$;
