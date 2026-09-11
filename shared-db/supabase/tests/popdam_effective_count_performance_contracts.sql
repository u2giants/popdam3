begin;

-- #2138: the effective list function returns whole rows from an append relation
-- so PostgREST's outer LIMIT can stop it early. Comments are stripped and
-- whitespace folded first, so each pin is contiguous syntax in its real
-- position: a predicate that survives only inside a comment is not a predicate.
do $$
declare
  v_def text := pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure);
  v_body text := regexp_replace(regexp_replace(v_def, E'--[^\n]*', '', 'g'), '\s+', ' ', 'g');
  v_lower text := lower(v_body);
  v_pin text;
  v_arms int;
  v_gate int;
  v_language name;
  v_volatility "char";
  v_secdef boolean;
  v_config text[];
begin
  select l.lanname, p.provolatile, p.prosecdef, p.proconfig
    into v_language, v_volatility, v_secdef, v_config
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.oid = 'public.filter_effective_assets(jsonb)'::regprocedure;

  -- Only a STABLE SQL invoker function with no per-function SET is inlined; a
  -- PL/pgSQL RETURN QUERY of the same SELECT is not, and reproduces #1945.
  if v_language <> 'sql' or v_volatility <> 's' or v_secdef or v_config is not null then
    raise exception 'effective list function is not an inlinable stable invoker SQL function: language %, volatility %, security definer %, config %',
      v_language, v_volatility, v_secdef, v_config;
  end if;

  -- No CTE barrier, and no id self-join under any alias pair.
  if position('identity_asset_ids' in v_lower) > 0
     or position('as materialized' in v_lower) > 0
     or position('left join public.style_groups' in v_lower) > 0
     or position('filter_effective_assets_unchecked_1703' in v_lower) > 0
     or v_lower ~ '\m[a-z_][a-z0-9_]*\.id = [a-z_][a-z0-9_]*\.id\M' then
    raise exception 'effective list function reintroduced the materialised id set or its self-join';
  end if;

  -- Entitlement is invoked once, as the Var-free outer WHERE conjunct.
  v_gate := (length(v_lower) - length(replace(v_lower, 'public.require_dam_access()', '')))
              / length('public.require_dam_access()');
  if v_gate <> 1 then
    raise exception 'effective list function must invoke public.require_dam_access() exactly once, found %', v_gate;
  end if;
  if position(') a where public.require_dam_access()' in v_lower) = 0 then
    raise exception 'effective list function must gate on DAM entitlement in its outer WHERE clause';
  end if;

  -- Eight preserved fallback arms plus two exclusive narrow tag arms, each pinned by its leading guard.
  -- The bare equality tokens also occur as optional conjuncts on the licensor
  -- pair, so counting arms and pinning guards is what stops a deleted
  -- property- or customer-leading arm from passing while the DAM property and
  -- customer libraries silently return nothing.
  v_arms := (length(v_lower) - length(replace(v_lower, 'union all', ''))) / length('union all');
  if v_arms <> 9 then
    raise exception 'effective predicates must keep ten UNION arms, found % UNION ALLs', v_arms;
  end if;
  foreach v_pin in array array[
    'from public.assets a where nullif(p_filters ->> ''licensorid'', '''') is null and nullif(p_filters ->> ''propertyid'', '''') is null and nullif(p_filters ->> ''customerid'', '''') is null and nullif(p_filters ->> ''tagfilter'', '''') is null union all',
    'select distinct e.asset_id from public.asset_effective_tags e where nullif(p_filters ->> ''tagfilter'', '''') is not null and e.tag = p_filters ->> ''tagfilter''',
    'where nullif(p_filters ->> ''licensorid'', '''') is not null and a.style_group_id is null and a.licensor_id = (p_filters ->> ''licensorid'')::uuid',
    'from public.style_groups sg join public.assets a on a.style_group_id = sg.id where nullif(p_filters ->> ''licensorid'', '''') is not null and sg.licensor_id = (p_filters ->> ''licensorid'')::uuid',
    'and nullif(p_filters ->> ''propertyid'', '''') is not null and a.style_group_id is null and a.property_id = (p_filters ->> ''propertyid'')::uuid',
    'and nullif(p_filters ->> ''propertyid'', '''') is not null and sg.property_id = (p_filters ->> ''propertyid'')::uuid',
    'and nullif(p_filters ->> ''customerid'', '''') is not null and a.style_group_id is null and a.customer_id = (p_filters ->> ''customerid'')::uuid',
    'and nullif(p_filters ->> ''customerid'', '''') is not null and sg.customer_id = (p_filters ->> ''customerid'')::uuid'
  ] loop
    if position(v_pin in v_lower) = 0 then
      raise exception 'effective identity predicates lost an index-leading UNION arm: %', v_pin;
    end if;
  end loop;

  -- The three identity keys the DAM client sends, case-sensitively.
  foreach v_pin in array array['''licensorId''', '''propertyId''', '''customerId'''] loop
    if position(v_pin in v_body) = 0 then
      raise exception 'effective list function no longer reads the DAM identity key %', v_pin;
    end if;
  end loop;
end;
$$;

-- #2501: count wrappers keep the existing timeout and force a value-sensitive
-- plan for the private helper, so a broad tag does not inherit a generic
-- nested-loop plan chosen for a selective tag.
do $$
declare
  v_name text;
  v_config text[];
begin
  foreach v_name in array array['get_effective_filter_counts', 'get_filter_counts'] loop
    select p.proconfig into v_config
    from pg_proc p
    where p.oid = to_regprocedure(format('public.%I(jsonb)', v_name));
    if not ('statement_timeout=8s' = any(coalesce(v_config, '{}')))
       or not ('plan_cache_mode=force_custom_plan' = any(coalesce(v_config, '{}'))) then
      raise exception '% does not retain the 8s ceiling plus a custom plan: %', v_name, v_config;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_helper text := lower(pg_get_functiondef('public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure));
  v_legacy text := pg_get_functiondef('public.get_filter_counts(jsonb)'::regprocedure);
begin
  if position('left join public.style_groups' in v_helper) > 0
     or position('identity_asset_ids as' in v_helper) = 0
     or position('union all' in v_helper) = 0
     or position('select a.*' in v_helper) > 0 then
    raise exception 'effective count helper is not a narrow index-leading scan';
  end if;
  if position('get_effective_filter_counts_unchecked_1703' in v_legacy) = 0 then
    raise exception 'legacy filtered counts no longer share the effective count implementation';
  end if;
  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.filter_effective_assets(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_filter_counts(jsonb)','EXECUTE') then
    raise exception 'effective filter/count privileges changed';
  end if;
end;
$$;

do $$
declare
  v_licensor uuid := gen_random_uuid();
  v_property uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_filters jsonb;
  v_legacy jsonb;
  v_effective jsonb;
begin
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
     gen_random_uuid(), repeat('2',64), 'issue-2054-contract-test',
     array['name','code','status'], clock_timestamp() + interval '1 minute'),
    (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation',
     gen_random_uuid(), repeat('3',64), 'issue-2054-contract-test',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');

  insert into core.licensor (id,name,code,status)
  values (v_licensor,'ZZ2054 Licensor','ZZ2054L-'||txid_current(),'active');
  insert into core.property (id,licensor_id,name,code,status)
  values (v_property,v_licensor,'ZZ2054 Property','ZZ2054P-'||txid_current(),'potential');
  insert into core.customer (id,name,status)
  values (v_customer,'ZZ2054 Customer '||txid_current(),'active');
  insert into public.style_groups
    (id,sku,folder_path,licensor_id,property_id,customer_id,licensor_name,property_name)
  values (v_group,'ZZ2054-'||txid_current(),'ZZ2054',v_licensor,v_property,v_customer,
    'ZZ2054 Licensor','ZZ2054 Property');

  insert into public.assets
    (id,filename,relative_path,file_type,quick_hash,modified_at,style_group_id,
     licensor_id,property_id,customer_id,status,content_type,product_material,
     thumbnail_url,thumbnail_error,product_category,is_deleted)
  values
    (v_a1,'zz2054-a.ai','ZZ2054/a.ai','ai','zz2054-a-'||txid_current(),now(),v_group,
      null,null,null,'pending','source_art',array['cotton'],'https://example.invalid/a.png',null,'Wall',false),
    (v_a2,'zz2054-b.pdf','ZZ2054/b.pdf','pdf','zz2054-b-'||txid_current(),now(),v_group,
      null,null,null,'pending','source_art',array['cotton'],'https://example.invalid/b.png',null,'Wall',false),
    (v_a3,'zz2054-c.ai','ZZ2054/c.ai','ai','zz2054-c-'||txid_current(),now(),null,
      v_licensor,v_property,v_customer,'tagged','product_photo',array['metal'],null,null,'Other',false);

  -- Grouped rows take group identity; the ungrouped row takes its own identity.
  foreach v_filters in array array[
    jsonb_build_object('licensorId',v_licensor),
    jsonb_build_object('propertyId',v_property),
    jsonb_build_object('customerId',v_customer)
  ] loop
    v_effective := public.get_effective_filter_counts(v_filters);
    v_legacy := public.get_filter_counts(v_filters);
    if (v_effective->>'total')::int <> 3
       or v_effective->>'total' <> v_legacy->>'total'
       or (v_effective->>'total')::int <>
          (select count(*) from public.filter_effective_assets(v_filters)) then
      raise exception 'identity list/count parity failed for %: effective %, legacy %',
        v_filters,v_effective,v_legacy;
    end if;
  end loop;

  -- Legacy get_filter_counts excludes each facet's own selection. The newer
  -- effective API deliberately includes it; pin both live response contracts.
  v_filters := jsonb_build_object('licensorId',v_licensor,
    'fileType',jsonb_build_array('ai'),'status',jsonb_build_array('pending'));
  v_legacy := public.get_filter_counts(v_filters);
  v_effective := public.get_effective_filter_counts(v_filters);
  if v_legacy->>'total' <> '1'
     or v_legacy->'fileType'->>'ai' <> '1'
     or v_legacy->'fileType'->>'pdf' <> '1'
     or v_legacy->'status'->>'pending' <> '1'
     or v_legacy->'status'->>'tagged' <> '1'
     or v_effective->>'total' <> '1'
     or v_effective->'fileType' ? 'pdf'
     or v_effective->'status' ? 'tagged' then
    raise exception 'own-facet semantics changed: legacy %, effective %',v_legacy,v_effective;
  end if;

  v_filters := jsonb_build_object('customerId',v_customer,
    'contentType',jsonb_build_array('source_art'),
    'productMaterial',jsonb_build_array('cotton'),
    'fileStatus',jsonb_build_array('has_preview'),
    'productCategory',jsonb_build_array('Wall'));
  v_legacy := public.get_filter_counts(v_filters);
  v_effective := public.get_effective_filter_counts(v_filters);
  if v_legacy->>'total' <> '2' or v_effective->>'total' <> '2'
     or (select count(*) from public.filter_effective_assets(v_filters)) <> 2 then
    raise exception 'customer/content/material/file/category parity failed: legacy %, effective %',
      v_legacy,v_effective;
  end if;
end;
$$;

-- #2054: the no-identity-filter facet count must keep its own direct scan of
-- public.assets. Routing it through the identity candidates costs the covering
-- index-only plan, and running both arms at once would double every count.
do $$
declare
  v_helper text := lower(pg_get_functiondef(
    'public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure));
  v_arm1 int := position('-- arm 1: no identity filter' in v_helper);
  v_arm2 int := position('-- arm 2: an identity filter is present' in v_helper);
  v_unfiltered jsonb;
  v_listed bigint;
begin
  if v_arm1 = 0 or v_arm2 = 0 or v_arm2 < v_arm1 then
    raise exception 'effective count helper lost its two mutually exclusive matched arms';
  end if;
  if position('identity_asset_ids' in substr(v_helper, v_arm1, v_arm2 - v_arm1)) > 0 then
    raise exception 'unfiltered facet counts were routed back through identity candidates';
  end if;
  if position('from identity_asset_ids i' in substr(v_helper, v_arm2)) = 0 then
    raise exception 'identity-filtered facet counts no longer join the UNION candidates';
  end if;

  select count(*) into v_listed from public.filter_effective_assets('{}'::jsonb);
  v_unfiltered := public.get_effective_filter_counts('{}'::jsonb);
  if (v_unfiltered ->> 'total')::bigint <> v_listed then
    raise exception 'unfiltered count % disagrees with the listed rows %',
      v_unfiltered ->> 'total', v_listed;
  end if;
  if (select coalesce(sum(value::bigint), 0)
      from jsonb_each_text(v_unfiltered -> 'fileType')) <> v_listed then
    raise exception 'unfiltered fileType facet totals % disagree with the listed rows %',
      (select coalesce(sum(value::bigint), 0) from jsonb_each_text(v_unfiltered -> 'fileType')),
      v_listed;
  end if;
end;
$$;

-- #2242: the block above pins Arm 1 and Arm 2 by their comments only, and was
-- written when the helper had exactly two matched arms. It cannot see Arm 1T at
-- all: a later `create or replace` could delete the tag-leading scan, keep both
-- pinned comments, and this file would still pass while the tag facet returned
-- to the ~8.1s whole-table scan #2151 removed. Migration 20260904121037 pins the
-- three-arm shape in an apply-time DO guard, but that guard runs exactly once and
-- never again. This block is the durable copy of it.
--
-- Whitespace is folded before anything is inspected, so every pin below is a
-- contiguous piece of real syntax in its real position. Comments are NOT
-- stripped: two of the pins are deliberately the arm comments, and stripping
-- them would silently disarm those.
do $$
declare
  v_helper text := lower(regexp_replace(pg_get_functiondef(
    'public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure), '\s+', ' ', 'g'));
  v_arm1 int := position('-- arm 1: no identity filter' in v_helper);
  v_arm1t int := position('-- arm 1t: no identity filter, tag filter present' in v_helper);
  v_arm2 int := position('-- arm 2: an identity filter is present' in v_helper);
  v_arms int;
  v_pin text;
begin
  -- Three matched arms, in this order. Arm 1T sits between the two arms the
  -- older block already pins, so an edit that deletes it is visible here even
  -- though both surviving comments still match.
  if v_arm1t = 0 then
    raise exception 'effective count helper lost its tag-leading Arm 1T';
  end if;
  if v_arm1 = 0 or v_arm2 = 0 or not (v_arm1 < v_arm1t and v_arm1t < v_arm2) then
    raise exception 'effective count helper lost the arm 1 / arm 1T / arm 2 ordering';
  end if;

  -- Five identity arms plus three matched arms is seven UNION ALLs. Counting
  -- them is what stops a later edit from deleting the tag arm while every
  -- substring below still appears somewhere else in the body.
  v_arms := (length(v_helper) - length(replace(v_helper, 'union all', '')))
              / length('union all');
  if v_arms <> 8 then
    raise exception 'effective count helper must keep five identity unions and four matched arms (eight UNION ALLs), found %', v_arms;
  end if;

  foreach v_pin in array array[
    -- The tag is an index condition on asset_effective_tags, not one side of an
    -- OR, and the asset is then reached by primary key. This exact shape is what
    -- the (tag, asset_id) index can serve under the generic plan a bound
    -- PostgREST argument produces.
    'from ( select distinct e.asset_id from public.asset_effective_tags e where nullif(v_base_filters ->> ''tagfilter'','''') is not null and e.tag = v_base_filters ->> ''tagfilter'' ) t join public.assets a on a.id = t.asset_id',
    -- DISTINCT is a correctness pin, not a performance one: the projection is
    -- keyed (asset_id, tag, scope), so one asset can carry the same tag at both
    -- 'asset' and 'style_group' scope and would be counted twice without it.
    'select distinct e.asset_id',
    -- The exclusivity pair. Arm 1 runs only when no tag is supplied and Arm 1T
    -- only when one is; losing either half makes both arms match a tag-filtered
    -- call and doubles every count.
    'and nullif(v_base_filters ->> ''customerid'', '''') is null and nullif(v_base_filters ->> ''tagfilter'', '''') is null and a.is_deleted = false',
    'and nullif(v_base_filters ->> ''customerid'', '''') is null and nullif(v_base_filters ->> ''tagfilter'', '''') is not null and a.is_deleted = false',
    -- The identity arm keeps the tag as an EXISTS: it is already index-led
    -- there, and rewriting it would be a change nothing has measured.
    'and (nullif(v_base_filters ->> ''tagfilter'','''') is null or exists ( select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = v_base_filters ->> ''tagfilter''))'
  ] loop
    if position(v_pin in v_helper) = 0 then
      raise exception 'effective count helper lost a pinned Arm 1T property: %', v_pin;
    end if;
  end loop;

  -- Arm 1T must not be routed through the identity candidates: that is the
  -- whole-table self-join #2054 removed from Arm 1, and it would cost the
  -- index-only path here for the same reason.
  if position('identity_asset_ids' in substr(v_helper, v_arm1t, v_arm2 - v_arm1t)) > 0 then
    raise exception 'tag-filtered facet counts were routed back through identity candidates';
  end if;
  -- And Arm 1T is the only matched arm that may drive from the tag table.
  if position('from public.asset_effective_tags' in substr(v_helper, v_arm1, v_arm1t - v_arm1)) > 0 then
    raise exception 'the no-tag arm reintroduced a scan of public.asset_effective_tags';
  end if;
end;
$$;

-- #2242: the same asset carrying one tag at two scopes is what makes the
-- DISTINCT inside Arm 1T load-bearing. Nothing covered it: the parity test in
-- popdam_effective_asset_filter_contracts.sql only ever writes one scope, so a
-- dropped DISTINCT counts that asset twice and every check still passes.
do $$
declare
  v_licensor uuid := gen_random_uuid();
  v_property uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_tag text := 'zz2242-tag-' || txid_current();
  v_filters jsonb;
  v_counts jsonb;
  v_listed bigint;
  v_facet bigint;
begin
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
     gen_random_uuid(), repeat('4',64), 'issue-2242-contract-test',
     array['name','code','status'], clock_timestamp() + interval '1 minute'),
    (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation',
     gen_random_uuid(), repeat('5',64), 'issue-2242-contract-test',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');

  insert into core.licensor (id,name,code,status)
  values (v_licensor,'ZZ2242 Licensor','ZZ2242L-'||txid_current(),'active');
  insert into core.property (id,licensor_id,name,code,status)
  values (v_property,v_licensor,'ZZ2242 Property','ZZ2242P-'||txid_current(),'potential');
  insert into core.customer (id,name,status)
  values (v_customer,'ZZ2242 Customer '||txid_current(),'active');
  insert into public.style_groups
    (id,sku,folder_path,licensor_id,property_id,customer_id,licensor_name,property_name)
  values (v_group,'ZZ2242-'||txid_current(),'ZZ2242',v_licensor,v_property,v_customer,
    'ZZ2242 Licensor','ZZ2242 Property');

  insert into public.assets
    (id,filename,relative_path,file_type,quick_hash,modified_at,style_group_id,
     licensor_id,property_id,customer_id,status,content_type,product_material,
     thumbnail_url,thumbnail_error,product_category,is_deleted)
  values
    (v_a1,'zz2242-a.ai','ZZ2242/a.ai','ai','zz2242-a-'||txid_current(),now(),v_group,
      null,null,null,'pending','source_art',array['cotton'],'https://example.invalid/a.png',null,'Wall',false),
    (v_a2,'zz2242-b.pdf','ZZ2242/b.pdf','pdf','zz2242-b-'||txid_current(),now(),v_group,
      null,null,null,'pending','source_art',array['cotton'],'https://example.invalid/b.png',null,'Wall',false),
    (v_a3,'zz2242-c.ai','ZZ2242/c.ai','ai','zz2242-c-'||txid_current(),now(),null,
      v_licensor,v_property,v_customer,'tagged','product_photo',array['metal'],
      'https://example.invalid/c.png',null,'Other',false);

  -- v_a1 carries the tag twice, once per scope -- exactly what the unique index
  -- (asset_id, tag, scope) permits, and what the projection produces when an
  -- asset is tagged directly and also inherits the same tag from its style
  -- group. v_a2 carries it once. v_a3 does not carry it at all.
  insert into public.asset_effective_tags (asset_id, tag, scope)
  values (v_a1, v_tag, 'asset'),
         (v_a1, v_tag, 'style_group'),
         (v_a2, v_tag, 'asset');

  -- No identity filter and a tag filter: this is Arm 1T, alone.
  v_filters := jsonb_build_object('tagFilter', v_tag);
  v_counts := public.get_effective_filter_counts(v_filters);
  select count(*) into v_listed from public.filter_effective_assets(v_filters);

  if v_listed <> 2 then
    raise exception 'two-scope tag fixture listed % assets, expected 2', v_listed;
  end if;
  if (v_counts ->> 'total')::bigint <> 2 then
    raise exception 'tag-filtered total % double-counts the asset tagged at two scopes (expected 2); Arm 1T lost its DISTINCT',
      v_counts ->> 'total';
  end if;

  select coalesce(sum(value::bigint), 0) into v_facet
  from jsonb_each_text(v_counts -> 'fileType');
  if v_facet <> 2 then
    raise exception 'tag-filtered fileType facet totals % but only 2 assets carry the tag; Arm 1T lost its DISTINCT', v_facet;
  end if;
  if v_counts -> 'fileType' ->> 'ai' <> '1' or v_counts -> 'fileType' ->> 'pdf' <> '1' then
    raise exception 'tag-filtered fileType facet is %, expected one ai and one pdf', v_counts -> 'fileType';
  end if;

  -- The identity arm reaches the same asset through its EXISTS, which
  -- deduplicates implicitly. Pinning it keeps the two arms answering alike.
  v_filters := jsonb_build_object('licensorId', v_licensor, 'tagFilter', v_tag);
  v_counts := public.get_effective_filter_counts(v_filters);
  select count(*) into v_listed from public.filter_effective_assets(v_filters);
  if (v_counts ->> 'total')::bigint <> 2 or v_listed <> 2 then
    raise exception 'identity+tag arm disagrees with the tag arm: count %, listed %',
      v_counts ->> 'total', v_listed;
  end if;
end;
$$;

rollback;
