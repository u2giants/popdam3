-- Follow-up to 20261027-component-identity (SO 7128092). That repair attached
-- coldlion:so:7128092:line:1:component:5 to D3691's Google row for
-- AA0631P1P01 with sub_label_code null; ColdLion stages it as 'RS' (like the
-- order's three other components), so the guard reported it missing and an
-- hourly writer run could mint a duplicate placeholder line for it. This sets
-- the identity to the staged label and removes such a duplicate if one was
-- minted before this landed (only a placeholder line whose sole ref is a
-- coldlion ref for that same identity). Preimage on its own sync_run row.
begin;

do $$ begin
  if not exists (select 1 from plm.production_order_line_source_ref r
                 join plm.production_order_line pl on pl.id = r.production_order_line_id
                 join plm.production_order p on p.id = pl.production_order_id
                 where r.source_system = 'coldlion'
                   and r.source_id = 'coldlion:so:7128092:line:1:component:5'
                   and pl.sku = 'AA0631P1P01' and p.production_order_number = 'D3691')
  or (select count(distinct c.sub_label_code) from coldlion.intake_order_component c
        join coldlion.intake_order_line l on l.id = c.line_id
       where l.sales_order_no = 7128092 and c.sub_item_no = 'AA0631P1P01') <> 1
  or not exists (select 1 from coldlion.intake_order_component c
        join coldlion.intake_order_line l on l.id = c.line_id
       where l.sales_order_no = 7128092 and c.sub_item_no = 'AA0631P1P01' and c.sub_label_code = 'RS') then
    raise exception 'SO 7128092 AA0631P1P01 is not in the verified shape; nothing written';
  end if;
end $$;

create temp table dup_p01 on commit drop as
select pl.id as line_id
from plm.production_order_line_source_ref r
join plm.production_order_line pl on pl.id = r.production_order_line_id
join plm.production_order p on p.id = pl.production_order_id
where r.source_system = 'coldlion'
  and r.source_id like 'coldlion:so:7128092:line:1:component:%'
  and r.source_id <> 'coldlion:so:7128092:line:1:component:5'
  and r.metadata ->> 'sub_item_no' = 'AA0631P1P01'
  and p.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder'
  and (select count(*) from plm.production_order_line_source_ref o where o.production_order_line_id = pl.id) = 1;

insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, notes)
select gen_random_uuid(), '/orderHistory', 'POP',
       jsonb_build_object('step', '20261027-component-identity-label', 'preimage', jsonb_build_object(
         'refs', (select jsonb_agg(to_jsonb(r)) from plm.production_order_line_source_ref r
                   where r.source_system = 'coldlion' and r.source_id like 'coldlion:so:7128092:%'),
         'lines', (select coalesce(jsonb_agg(to_jsonb(pl)), '[]') from plm.production_order_line pl
                   where pl.id in (select line_id from dup_p01)))),
       'succeeded', 'coldlion-order-intake', now(), now(), 'component identity label repair (SO 7128092)';

delete from plm.production_order_line where id in (select line_id from dup_p01);

update plm.production_order_line_source_ref
   set metadata = metadata || '{"sub_label_code":"RS"}'::jsonb
 where source_system = 'coldlion'
   and source_id = 'coldlion:so:7128092:line:1:component:5';

commit;
