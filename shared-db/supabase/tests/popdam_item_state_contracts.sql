-- Issue #2644 contract: invented rows only; all writes roll back.

begin;

do $$
declare
  v_item uuid;
  v_deleted_item uuid;
  v_legacy uuid;
  v_prediction uuid;
  v_deleted_prediction uuid;
  v_count integer;
  v_columns text[];
  v_viewdef text;
  v_failed boolean;
begin
  select array_agg(column_name order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'api' and table_name = 'plm_item_list';

  if v_columns is distinct from array[
    'id','source_id','style_number','item_description','mg_category',
    'mg01_code','mg02_code','mg03_code','mg04_code','mg05_code','mg06_code',
    'size_code','licensor_code','property_code','division_code','prepack_code',
    'prepack_codes','dismissed','erp_updated_at','synced_at','source_system'
  ]::text[] then
    raise exception '#2644: api.plm_item_list column contract changed: %', v_columns;
  end if;

  select pg_get_viewdef('api.plm_item_list'::regclass, true) into v_viewdef;
  if v_viewdef not like '%popdam_item_state%'
     or v_viewdef like '%legacy.dismissed%'
     or v_viewdef like '%legacy_dismissed%' then
    raise exception '#2644: serving view does not use only the PopDAM-owned dismissal state';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'popdam_item_state'
      and c.relrowsecurity
  ) then
    raise exception '#2644: popdam_item_state lacks RLS';
  end if;
  if has_table_privilege('authenticated', 'public.popdam_item_state', 'select')
     or has_table_privilege('authenticated', 'public.popdam_item_state', 'insert')
     or has_table_privilege('anon', 'public.popdam_item_state', 'select') then
    raise exception '#2644: browser roles can access PopDAM item state directly';
  end if;
  if has_function_privilege('anon', 'public.set_popdam_item_dismissed(text[],boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_popdam_item_dismissed(text[],boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.set_popdam_item_dismissed(text[],boolean)', 'execute') then
    raise exception '#2644: dismissal RPC grants are not admin/service compatible';
  end if;

  insert into plm.item (
    item_number, description, source_system, source_id, raw
  ) values (
    'ZZ2644ITEM', 'ZZ2644 DESCRIPTION', 'coldlion', 'ZZCO|ZZ001|ZZ2644ITEM',
    '{"companyCode":"ZZCO","divisionCode":"ZZ001","itemNo":"ZZ2644ITEM"}'
  ) returning id into v_item;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_failed := false;
  begin
    perform public.set_popdam_item_dismissed(array['coldlion|ZZ001|ZZ2644ITEM'], true);
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '#2644: non-admin authenticated caller changed dismissal state';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select public.set_popdam_item_dismissed(array['coldlion|ZZ001|ZZ2644ITEM'], true)
    into v_count;
  if v_count <> 1
     or (select dismissed from api.plm_item_list where source_id = 'ZZ2644ITEM') is distinct from true then
    raise exception '#2644: dismiss -> fresh view read failed';
  end if;

  v_failed := false;
  begin
    perform public.set_popdam_item_dismissed(
      array['coldlion|ZZ001|ZZ2644ITEM', 'coldlion|ZZ001|ZZ2644MISSING'], false
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed
     or (select dismissed from api.plm_item_list where source_id = 'ZZ2644ITEM') is distinct from true then
    raise exception '#2644: missing identity did not fail the entire batch atomically';
  end if;

  v_failed := false;
  begin
    perform public.set_popdam_item_dismissed(
      array['coldlion|ZZ001|ZZ2644ITEM', 'coldlion|ZZ001|ZZ2644ITEM'], false
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed
     or (select dismissed from api.plm_item_list where source_id = 'ZZ2644ITEM') is distinct from true then
    raise exception '#2644: duplicate identities did not refuse without changing state';
  end if;

  insert into plm.item (
    item_number, description, source_system, source_id, raw
  ) values
    ('ZZ2644AMBIG', 'ZZ2644 AMBIGUOUS A', 'coldlion', 'ZZCO|ZZ001|ZZ2644AMBIG-A',
     '{"companyCode":"ZZCO","divisionCode":"ZZ001","itemNo":"ZZ2644AMBIG"}'),
    ('ZZ2644AMBIG', 'ZZ2644 AMBIGUOUS B', 'coldlion', 'ZZCO|ZZ001|ZZ2644AMBIG-B',
     '{"companyCode":"ZZCO","divisionCode":"ZZ001","itemNo":"ZZ2644AMBIG"}');

  v_failed := false;
  begin
    perform public.set_popdam_item_dismissed(
      array['coldlion|ZZ001|ZZ2644AMBIG'], true
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed or exists (
    select 1 from public.popdam_item_state where source_id = 'ZZ2644AMBIG'
  ) then
    raise exception '#2644: ambiguous dismissal identity did not refuse without creating state';
  end if;

  v_failed := false;
  begin
    insert into public.product_category_predictions (
      external_id, predicted_category, confidence, classification_source, status
    ) values ('coldlion|ZZ001|ZZ2644AMBIG', 'Unknown', 0, 'ai', 'unclassifiable');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '#2644: ambiguous canonical prediction identity did not refuse';
  end if;

  perform public.set_popdam_item_dismissed(array['coldlion|ZZ001|ZZ2644ITEM'], false);
  if (select dismissed from api.plm_item_list where source_id = 'ZZ2644ITEM') is distinct from false then
    raise exception '#2644: restore -> fresh view read failed';
  end if;
  if not exists (
    select 1 from public.popdam_item_state
    where item_id = v_item and updated_by = 'service_role' and updated_at >= created_at
  ) then
    raise exception '#2644: dismissal actor/timestamps were not retained';
  end if;

  insert into plm.legacy_erp_item_identity (id, external_id, division_code)
  values (gen_random_uuid(), 'ZZ2644ITEM', 'ZZ001') returning id into v_legacy;

  insert into public.product_category_predictions (
    erp_item_id, external_id, predicted_category, confidence,
    classification_source, status
  ) values (
    v_legacy, 'coldlion|ZZ001|ZZ2644ITEM', 'Wall', 0.9,
    'ai', 'approved'
  ) returning id into v_prediction;

  if not exists (
    select 1 from public.product_category_predictions
    where id = v_prediction and plm_item_id = v_item and item_identity_status = 'resolved'
  ) then
    raise exception '#2644: canonical prediction identity did not resolve';
  end if;

  delete from plm.legacy_erp_item_identity where id = v_legacy;
  if not exists (
    select 1 from public.product_category_predictions
    where id = v_prediction and plm_item_id = v_item and status = 'approved'
  ) then
    raise exception '#2644: removing a legacy ERP row deleted prediction history';
  end if;

  insert into plm.item (
    item_number, description, source_system, source_id, raw
  ) values (
    'ZZ2644DELETE', 'ZZ2644 DELETE HISTORY', 'coldlion', 'ZZCO|ZZ001|ZZ2644DELETE',
    '{"companyCode":"ZZCO","divisionCode":"ZZ001","itemNo":"ZZ2644DELETE"}'
  ) returning id into v_deleted_item;

  insert into public.product_category_predictions (
    external_id, predicted_category, confidence, classification_source, status
  ) values (
    'coldlion|ZZ001|ZZ2644DELETE', 'Wall', 0.8, 'ai', 'approved'
  ) returning id into v_deleted_prediction;

  delete from plm.item where id = v_deleted_item;
  if not exists (
    select 1 from public.product_category_predictions
    where id = v_deleted_prediction
      and plm_item_id is null
      and item_identity_status = 'unresolved'
      and status = 'approved'
  ) then
    raise exception '#2644: retiring a canonical item deleted or falsely resolved prediction history';
  end if;

  insert into public.product_category_predictions (
    erp_item_id, external_id, predicted_category, confidence,
    classification_source, status
  ) values (
    gen_random_uuid(), 'ZZ2644LEGACY-UNRESOLVED', 'Unknown', 0,
    'ai', 'unclassifiable'
  ) returning id into v_prediction;
  if not exists (
    select 1 from public.product_category_predictions
    where id = v_prediction and plm_item_id is null and item_identity_status = 'unresolved'
  ) then
    raise exception '#2644: unresolved legacy prediction history is not explicit and visible';
  end if;

  v_failed := false;
  begin
    insert into public.product_category_predictions (
      external_id, predicted_category, confidence, classification_source, status
    ) values ('coldlion|ZZ001|ZZ2644MISSING', 'Unknown', 0, 'ai', 'unclassifiable');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '#2644: missing canonical prediction identity did not refuse';
  end if;

  raise notice '#2644 PASSED: protected state, atomic dismiss/restore, 21-column view, canonical prediction identity and ERP/item retirement history preservation.';
end;
$$;

rollback;
