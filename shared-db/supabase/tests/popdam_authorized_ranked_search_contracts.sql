begin;

do $$
declare
  v_definition text;
begin
  if to_regprocedure(
       'public.search_dam_documents(text,integer,text[],extensions.vector)'
     ) is not null then
    raise exception 'legacy unfiltered ranked-search overload must not exist';
  end if;

  select pg_get_functiondef(
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)'::regprocedure
  ) into v_definition;

  if position('filter_effective_assets' in v_definition) = 0
     or position('visible_assets as materialized' in v_definition) = 0 then
    raise exception 'ranked search must establish the effective visible asset set first';
  end if;
  if position('offset (select page_offset from params)' in lower(v_definition)) = 0
     or position('from ranked_documents' in lower(v_definition)) = 0 then
    raise exception 'ranked search must paginate only after authorization and ranking';
  end if;
  if position('* 0.35' in v_definition) = 0 then
    raise exception 'hybrid search semantic weighting changed';
  end if;
  if position('total_count' in v_definition) = 0
     or position('has_more' in v_definition) = 0
     or position('facets' in v_definition) = 0 then
    raise exception 'paged search must return exact total, has_more, and facets';
  end if;

  if has_function_privilege('anon',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)', 'EXECUTE') then
    raise exception 'ranked search execute grants violate the authenticated boundary';
  end if;

  select pg_get_functiondef('public.search_style_groups_full_text(text,integer)'::regprocedure)
    into v_definition;
  if position('max(d.rank)*0.8' in replace(v_definition, ' ', '')) = 0 then
    raise exception 'style-group member-asset ranking rollup changed';
  end if;
end;
$$;

rollback;
