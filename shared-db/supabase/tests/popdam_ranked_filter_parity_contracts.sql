begin;

do $$
declare v_filter text; v_search text; v_counts text;
begin
  select pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure) into v_filter;
  select pg_get_functiondef('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)'::regprocedure) into v_search;
  select pg_get_functiondef('public.get_effective_filter_counts(jsonb)'::regprocedure) into v_counts;

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
  if position('customerId' in v_search)=0 or position('contentType' in v_search)=0
     or position('productMaterial' in v_search)=0 or position('fileStatus' in v_search)=0
     or position('productCategory' in v_search)=0
     or position('page as materialized' in lower(v_search))=0
     or position('customerid' in lower(v_search)) > position('page as materialized' in lower(v_search)) then
    raise exception 'ranked filters are missing or occur after pagination';
  end if;
  if position('filter_effective_assets' in v_counts)=0 or position('require_dam_access' in v_counts)=0 then
    raise exception 'effective counts do not share the parity filter and DAM gate';
  end if;
  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)','EXECUTE') then
    raise exception 'anon gained access to a DAM filter contract';
  end if;
end;
$$;

rollback;
