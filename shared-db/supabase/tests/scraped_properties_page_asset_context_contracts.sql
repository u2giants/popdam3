-- #2744 contract: the Scraped Properties listing resolves style guides from the
-- page's retained assets only, while its security surface stays exactly as it was.
-- Output parity (asset_count, style_guide_count, style_guide_names, paging) is
-- asserted by supabase/tests/db_data_admin_scraped_properties.sql fixtures.
do $$
declare
  v_fn regprocedure := to_regprocedure('api.db_data_admin_scraped_properties(text,text,integer)');
  v_src text;
  v_secdef boolean;
  v_volatile "char";
  v_config text[];
  v_rettype text;
begin
  if v_fn is null then
    raise exception 'missing api.db_data_admin_scraped_properties(text,text,integer)';
  end if;

  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig, format_type(p.prorettype, null)
    into v_src, v_secdef, v_volatile, v_config, v_rettype
  from pg_proc p where p.oid = v_fn;

  if not v_secdef then
    raise exception 'scraped Properties function must remain SECURITY DEFINER';
  end if;
  if v_volatile <> 's' then
    raise exception 'scraped Properties function must remain STABLE, got %', v_volatile;
  end if;
  if v_config is distinct from array['search_path=app, public'] then
    raise exception 'scraped Properties function settings changed: %', v_config;
  end if;
  if v_rettype <> 'jsonb' then
    raise exception 'scraped Properties function must return jsonb, got %', v_rettype;
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon can execute scraped Properties function';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'authenticated cannot execute scraped Properties function';
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute scraped Properties function';
  end if;

  if position('perform app.require_licensing_manager_access();' in v_src) = 0 then
    raise exception 'licensing-manager gate is missing';
  end if;
  if v_src ~ 'dcp_asset_context' then
    raise exception 'whole-catalog DCP asset context CTE is back';
  end if;
  if position('page_dcp_retained_assets as not materialized' in v_src) = 0
     or position('page_lucasfilm_dcp_retained_assets as not materialized' in v_src) = 0 then
    raise exception 'page retained-asset CTEs must be inlined';
  end if;
  if position('join plm.dcp_asset a on a.id=r.asset_id' in v_src) = 0
     or position('join plm.lucasfilm_dcp_asset a on a.id=r.asset_id' in v_src) = 0 then
    raise exception 'style guides must resolve from the page retained assets by asset primary key';
  end if;
  if v_src ~* 'work_mem|statement_timeout' then
    raise exception 'scraped Properties function must not change memory or timeout settings';
  end if;
end
$$;
