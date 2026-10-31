begin;

do $$
declare v_filter text; v_search text; v_counts text; v_helper text; v_scan_zone text;
begin
  select pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure) into v_filter;
  select pg_get_functiondef('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)'::regprocedure) into v_search;
  select pg_get_functiondef('public.get_effective_filter_counts(jsonb)'::regprocedure) into v_counts;
  -- #4508 (20261029161104): the ranked search's per-asset parity predicates
  -- moved into the planner-opaque helper dam_asset_matches_filters (its
  -- per-function SET search_path blocks SQL inlining, which is what keeps the
  -- search's planning cost at ~14 ms instead of ~2.2 s); the search body must
  -- delegate every pre-pagination consumer to that helper (summary probe, page EXISTS, #5053 exact_docs).
  select pg_get_functiondef('public.dam_asset_matches_filters(uuid, boolean, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, public.file_type, text, text[], public.asset_status, public.workflow_status, text, boolean, public.asset_type, public.art_source, text, text, text, text, text, jsonb, timestamptz)'::regprocedure) into v_helper;

  if position('customerId' in v_filter)=0 or position('a.customer_id' in v_filter)=0
     or position('sg.customer_id' in v_filter)=0 or position('a.customer = p_filters' in v_filter)=0 then
    raise exception 'canonical customerId or legacy customer compatibility is missing';
  end if;
  if position('contentType' in v_filter)=0 or position('productMaterial' in v_filter)=0
     or position('fileStatus' in v_filter)=0 or position('productCategory' in v_filter)=0
     or position('no_preview_renderable' in v_filter)=0 or position('no_pdf_compat' in v_filter)=0
     or position('no_preview_unsupported' in v_filter)=0 or position('WALL ART' in v_filter)=0
     or position('3FZ' in v_filter)=0 then
    raise exception 'one or more PopDAM parity predicates are missing';
  end if;
  -- every parity predicate key ever regressed must live in the helper
  if position('licensorId' in v_helper)=0 or position('propertyId' in v_helper)=0
     or position('customerId' in v_helper)=0 or position('tagFilter' in v_helper)=0
     or position('fileType' in v_helper)=0 or position('contentType' in v_helper)=0
     or position('productMaterial' in v_helper)=0 or position($q$->'status'$q$ in v_helper)=0
     or position('workflowStatus' in v_helper)=0 or position($q$->'stage'$q$ in v_helper)=0
     or position('isLicensed' in v_helper)=0 or position('assetType' in v_helper)=0
     or position('artSource' in v_helper)=0 or position('fileStatus' in v_helper)=0
     or position('productCategory' in v_helper)=0
     or position('no_preview_renderable' in v_helper)=0
     or position('no_pdf_compat' in v_helper)=0
     or position('no_preview_unsupported' in v_helper)=0
     or position('WALL ART' in v_helper)=0 or position('3FZ' in v_helper)=0
     or position($q$->>'customer'$q$ in v_helper)=0 or position($q$->>'program'$q$ in v_helper)=0
     or position('p_modified_at >= p_min_date' in v_helper)=0
     or position('not p_is_deleted' in v_helper)=0 then
    raise exception 'ranked filters are missing from the shared per-asset predicate helper';
  end if;
  if position('page as materialized' in lower(v_search))=0
     -- #5053: exact_docs is the third pre-pagination consumer of the helper
     -- (summary probe, page EXISTS, exact_docs EXISTS ... LIMIT 1).
     or (length(v_search) - length(replace(v_search, 'dam_asset_matches_filters', '')))
        / length('dam_asset_matches_filters') <> 3
     or position('dam_asset_matches_filters' in v_search)
        > position('page as materialized' in lower(v_search))
     or position(reverse('dam_asset_matches_filters') in reverse(v_search))
        <= position(reverse('page as materialized') in reverse(lower(v_search))) then
    raise exception 'ranked search must filter through the shared predicate helper in every pre-pagination consumer';
  end if;
  -- per-asset predicate keys must NOT be inlined in the scan zone. The facet
  -- builder in the summary CTE legitimately reuses names like 'fileType', so
  -- the scan zone ends where 'summary as materialized' begins.
  v_scan_zone := substring(v_search from 1 for position('summary as materialized' in lower(v_search)) - 1);
  if position('licensorId' in v_scan_zone) > 0 or position('propertyId' in v_scan_zone) > 0
     or position('customerId' in v_scan_zone) > 0 or position('tagFilter' in v_scan_zone) > 0
     or position('fileType' in v_scan_zone) > 0 or position('contentType' in v_scan_zone) > 0
     or position('productMaterial' in v_scan_zone) > 0 or position('workflowStatus' in v_scan_zone) > 0
     or position('isLicensed' in v_scan_zone) > 0 or position('assetType' in v_scan_zone) > 0
     or position('artSource' in v_scan_zone) > 0 or position('fileStatus' in v_scan_zone) > 0
     or position('productCategory' in v_scan_zone) > 0
     or position($q$->'status'$q$ in v_scan_zone) > 0 or position($q$->'stage'$q$ in v_scan_zone) > 0
     or position($q$->>'customer'$q$ in v_scan_zone) > 0 or position($q$->>'program'$q$ in v_scan_zone) > 0
     or position('WALL ART' in v_scan_zone) > 0 or position('3FZ' in v_scan_zone) > 0 then
    raise exception 'ranked search inlined per-asset filter predicates instead of delegating to the helper';
  end if;
  if position('get_effective_filter_counts_unchecked_1703' in v_counts)=0 or position('require_dam_access' in v_counts)=0 then
    raise exception 'effective counts do not share the parity filter and DAM gate';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'public.dam_asset_matches_filters(uuid, boolean, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, public.file_type, text, text[], public.asset_status, public.workflow_status, text, boolean, public.asset_type, public.art_source, text, text, text, text, text, jsonb, timestamptz)'::regprocedure
      and proconfig is not null
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'predicate helper lost its per-function SET search_path: without it PostgreSQL inlines the predicate back into the search body and the ~2.2 s planning regression returns';
  end if;
  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.dam_asset_matches_filters(uuid, boolean, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, public.file_type, text, text[], public.asset_status, public.workflow_status, text, boolean, public.asset_type, public.art_source, text, text, text, text, text, jsonb, timestamptz)','EXECUTE')
     or has_function_privilege('anon','public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)','EXECUTE') then
    raise exception 'anon gained access to a DAM filter contract';
  end if;
end;
$$;

rollback;
