-- Isolated integration database only. Synthetic rows; always rolled back.
begin;
do $test$
begin
  if has_function_privilege('anon','public.link_dam_order_lines_scoped(uuid[])','execute')
    or has_function_privilege('authenticated','public.link_dam_order_lines_scoped(uuid[])','execute')
    or not has_function_privilege('service_role','public.link_dam_order_lines_scoped(uuid[])','execute') then
    raise exception 'Scoped intake linking must be service-only';
  end if;
  begin
    perform public.link_dam_order_lines_scoped(null);
    raise exception 'NULL scope accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.link_dam_order_lines_scoped('{}'::uuid[]);
    raise exception 'Empty scope accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.link_dam_order_lines_scoped(array_fill(gen_random_uuid(),array[501]));
    raise exception 'Oversized scope accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.link_dam_order_lines_scoped(array[null]::uuid[]);
    raise exception 'NULL entry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.link_dam_order_lines_scoped(array[gen_random_uuid()]);
    raise exception 'Missing line accepted';
  exception when no_data_found then null; end;
end;
$test$;

create temp table scoped_link_ids(key text primary key,id uuid default gen_random_uuid());
insert into scoped_link_ids(key) values
 ('item-a'),('item-b'),('item-conflict'),('order'),
 ('tracker-a'),('tracker-b'),('tracker-amb-a'),('tracker-amb-b'),('tracker-conf-a'),('tracker-conf-b'),
 ('eligible'),('generic'),('existing'),('manual'),('not-applicable'),('no-catalog'),('no-match'),('ambiguous'),('conflict'),('outside');
insert into plm.item(id,item_number,description,name,source_system,source_id)
select id,'TEST-SCOPED-4886-'||key,'Synthetic scoped linking test',key,'integration_test','scoped-4886-'||key
from scoped_link_ids where key like 'item-%';
insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,sku,row_data)
select id,'integration-scoped-4886',case when key='tracker-b' then 'Generic.Style' else 'License.Style' end,
  row_number() over(order by key)+950000,
  case when key='tracker-b' then 'generic' else 'licensed' end,
  case when key in ('tracker-a','tracker-b') then 'TEST-SCOPED-4886-EXACT'
       when key like 'tracker-amb-%' then 'TEST-SCOPED-4886-AMB' else 'TEST-SCOPED-4886-CONFLICT' end,
  jsonb_build_object('test_report',key<>'tracker-conf-b','professional_photos',false)
from scoped_link_ids where key like 'tracker-%';
insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id)
select s.id,r.source_workbook_id,r.source_sheet,r.tracker_type,i.id
from scoped_link_ids s join public.style_tracker_rows r on r.id=s.id
join scoped_link_ids i on i.key=case
  when s.key in ('tracker-a','tracker-amb-a') then 'item-a'
  when s.key in ('tracker-b','tracker-amb-b') then 'item-b' else 'item-conflict' end;
-- Item A would now have different workflows for two SKUs unless all its
-- licensed rows agree; both ambiguity rows deliberately carry the same facts.
insert into plm.production_order(id,production_order_number,source_system,source_id)
select id,'TEST-SCOPED-LINK-4886','integration_test','scoped-link-4886-order' from scoped_link_ids where key='order';
insert into plm.production_order_line(id,production_order_id,line_number,sku,source_style_type,item_id,master_data_match_status,metadata,source_system,source_id)
select s.id,o.id,s.key,
 case when s.key='no-match' then 'TEST-SCOPED-4886-NONE'
      when s.key='ambiguous' then 'TEST-SCOPED-4886-AMB'
      when s.key='conflict' then 'TEST-SCOPED-4886-CONFLICT'
      else ' TEST-SCOPED-4886-exact ' end,
 case when s.key='no-catalog' then null when s.key='generic' then 'generic' else 'licensed' end,
 case when s.key='existing' then (select id from scoped_link_ids where key='item-b')
      when s.key='manual' then (select id from scoped_link_ids where key='item-a') end,
 case s.key when 'existing' then 'matched' when 'manual' then 'manual'
      when 'not-applicable' then 'not_applicable' else 'unmatched' end,
 '{"preserved":"manual-and-source-evidence"}'::jsonb,'integration_test','scoped-4886-line-'||s.key
from scoped_link_ids s cross join scoped_link_ids o where o.key='order'
 and s.key in ('eligible','generic','existing','manual','not-applicable','no-catalog','no-match','ambiguous','conflict','outside');

do $test$
declare result jsonb; ids uuid[]; before_rows jsonb; after_rows jsonb;
begin
  select array_agg(id order by key) into ids from scoped_link_ids
   where key in ('eligible','generic','existing','manual','not-applicable','no-catalog','no-match','ambiguous','conflict');
  -- A caller failure after successful linking must roll its preceding mutation back.
  begin
    perform public.link_dam_order_lines_scoped(ids);
    raise exception 'forced caller failure' using errcode='P0001';
  exception when raise_exception then
    if sqlerrm <> 'forced caller failure' then raise; end if;
  end;
  if exists(select 1 from plm.production_order_line where id in (select id from scoped_link_ids where key in ('eligible','generic')) and item_id is not null) then
    raise exception 'Caller rollback leaked scoped links';
  end if;
  result:=public.link_dam_order_lines_scoped(ids||ids[1]);
  if result is distinct from '{"considered":9,"linked":2,"existing_preserved":2,"manual_or_not_applicable_preserved":1,"missing_catalog":1,"ambiguous":1,"no_candidate":1,"conflicting_workflow":1}'::jsonb then
    raise exception 'Unexpected scoped outcomes: %',result;
  end if;
  if (select item_id from plm.production_order_line where id=(select id from scoped_link_ids where key='eligible'))
       is distinct from (select id from scoped_link_ids where key='item-a')
    or (select item_id from plm.production_order_line where id=(select id from scoped_link_ids where key='generic'))
       is distinct from (select id from scoped_link_ids where key='item-b') then
    raise exception 'Explicit catalog failed to distinguish identical SKUs';
  end if;
  if exists(select 1 from plm.production_order_line where source_id like 'scoped-4886-line-%'
      and metadata->>'preserved' is distinct from 'manual-and-source-evidence')
    or (select item_id from plm.production_order_line where id=(select id from scoped_link_ids where key='outside')) is not null then
    raise exception 'Source evidence or out-of-scope row changed';
  end if;
  select jsonb_agg(to_jsonb(l) order by l.id) into before_rows from plm.production_order_line l where id=any(ids);
  result:=public.link_dam_order_lines_scoped(ids);
  select jsonb_agg(to_jsonb(l) order by l.id) into after_rows from plm.production_order_line l where id=any(ids);
  if (result->>'linked')::integer<>0 or before_rows is distinct from after_rows then
    raise exception 'Second identical relink changed links or provenance';
  end if;
end;
$test$;
rollback;
