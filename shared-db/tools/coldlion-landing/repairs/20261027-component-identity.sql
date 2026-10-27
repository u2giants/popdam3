-- One-time repair: ColdLion component line identity (SO 7128092 incident,
-- 2026-10-26). Applied once to production qsllyeztdwjgirsysgai after the
-- identity-keyed writer merged. Recoverable: the full preimage of every row
-- this touches is stored on the repair's own coldlion.sync_run row
-- (request_params.preimage) inside the same transaction.
--
-- 1. 98 duplicate components: the real line was already moved onto an Import
--    PO, and the positional writer re-minted it on the placeholder under a
--    renumbered handle. Each duplicate is a placeholder line whose only ref is
--    that coldlion ref; it is deleted (ref cascades, snapshot link nulls).
-- 2. Every coldlion component ref gets its identity (master_item_no,
--    sub_item_no, sub_label_code) copied from its own line — every line's
--    metadata was verified to match its SKU (1,131/1,131) before this ran.
-- 3. SO 7128092 / customer PO 62004433 (Albert Hazan, 2026-10-27: "yes, fix
--    it"): the placeholder components merge onto D3691's Google rows (row
--    12613) the same way the 2026-10-13 consolidation merged AA063PFPF02 —
--    one line carrying both refs, ColdLion quantity filling a blank Google one.
-- 4. Orders that now lack a component are re-pended, so the next writer run
--    mints the missing lines under fresh, permanent handles.
begin;

create temp table dup_lines on commit drop as
with refs as (
  select r.source_id, pl.id as line_id, pl.metadata,
         (p.metadata ->> 'production_order_number_origin') is not distinct from 'coldlion_intake_placeholder' as on_placeholder,
         (select count(*) from plm.production_order_line_source_ref o where o.production_order_line_id = pl.id) as all_refs
  from plm.production_order_line_source_ref r
  join plm.production_order_line pl on pl.id = r.production_order_line_id
  join plm.production_order p on p.id = pl.production_order_id
  where r.source_system = 'coldlion'
    and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
),
grouped as (
  select split_part(source_id, ':', 3) as so, split_part(source_id, ':', 5) as ln,
         metadata ->> 'master_item_no' as m, metadata ->> 'sub_item_no' as s, metadata ->> 'sub_label_code' as l,
         array_agg(line_id) filter (where on_placeholder and all_refs = 1) as ph,
         count(*) as n, count(*) filter (where not on_placeholder) as moved
  from refs group by 1, 2, 3, 4, 5 having count(*) > 1
)
select unnest(ph) as line_id from grouped where n = 2 and moved = 1 and cardinality(ph) = 1;

do $$ begin
  -- 98 measured 2026-10-27; the positional writer may add a few before this
  -- lands, never hundreds, and nothing removes them — fewer means drift.
  if (select count(*) from dup_lines) not between 98 and 200 then
    raise exception 'expected ~98 duplicate placeholder lines, found %', (select count(*) from dup_lines);
  end if;
end $$;

create temp table merge_7128092 (placeholder_line uuid, google_line uuid, sku text) on commit drop;
insert into merge_7128092 values
  ('65dfc580-681d-4577-a894-f86aadcfefe7', 'a2f2ddd4-c13b-4637-837e-1c746a04d834', 'AA0631P1P02'),
  ('d0913b6c-6acd-4a09-b724-f02cb2007cb8', 'b8f254b3-8e1c-4e6e-bde6-136d77188b7c', 'AA063PFPF01'),
  (null,                                   '573e156f-420c-493e-8f68-bafe66652e4a', 'AA0631P1P01');

do $$ begin
  if (select count(*) from merge_7128092 m
        join plm.production_order_line g on g.id = m.google_line and g.sku = m.sku and g.customer_po_number = '62004433'
        join plm.production_order p on p.id = g.production_order_id and p.production_order_number = 'D3691') <> 3
  or (select count(*) from merge_7128092 m
        join plm.production_order_line pl on pl.id = m.placeholder_line and pl.sku = m.sku
        join plm.production_order p on p.id = pl.production_order_id and p.production_order_number = 'COLDLION-SO-7128092') <> 2
  or exists (select 1 from plm.production_order_line_source_ref
              where source_system = 'coldlion' and source_id = 'coldlion:so:7128092:line:1:component:5')
  or exists (select 1 from plm.production_order_line_source_ref r join merge_7128092 m on r.production_order_line_id = m.google_line
              where r.source_system = 'coldlion') then
    raise exception 'SO 7128092 rows are not in the verified shape; nothing written';
  end if;
end $$;

insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, notes)
select gen_random_uuid(), '/orderHistory', 'POP',
       jsonb_build_object('step', '20261027-component-identity', 'preimage', jsonb_build_object(
         'lines', (select jsonb_agg(to_jsonb(pl)) from plm.production_order_line pl
                    where pl.id in (select line_id from dup_lines)
                       or pl.id in (select placeholder_line from merge_7128092)
                       or pl.id in (select google_line from merge_7128092)),
         'component_refs', (select jsonb_agg(to_jsonb(r)) from plm.production_order_line_source_ref r
                    where r.source_system = 'coldlion'
                      and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'),
         'snapshots', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'production_order_line_id', s.production_order_line_id)), '[]')
                    from dam.production_order_snapshot s
                    where s.production_order_line_id in (select line_id from dup_lines)
                       or s.production_order_line_id in (select placeholder_line from merge_7128092)),
         'intake_states', (select jsonb_agg(to_jsonb(n)) from coldlion.intake_new_order n where n.state = 'created'))),
       'succeeded', 'coldlion-order-intake', now(), now(), 'component identity repair (SO 7128092 incident)';

-- 1. duplicates
delete from plm.production_order_line where id in (select line_id from dup_lines);

-- 2. identity onto every component ref
update plm.production_order_line_source_ref r
   set metadata = r.metadata || jsonb_build_object(
         'master_item_no', pl.metadata ->> 'master_item_no',
         'sub_item_no', nullif(pl.metadata ->> 'sub_item_no', ''),
         'sub_label_code', nullif(pl.metadata ->> 'sub_label_code', ''))
  from plm.production_order_line pl
 where pl.id = r.production_order_line_id
   and r.source_system = 'coldlion'
   and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
   and r.metadata ->> 'master_item_no' is null;

do $$ begin
  -- Never store an unmatchable identity: every line was verified to carry
  -- master_item_no (1,131/1,131); a null here means the data drifted.
  if exists (select 1 from plm.production_order_line_source_ref
              where source_system = 'coldlion'
                and source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
                and metadata ->> 'master_item_no' is null) then
    raise exception 'a coldlion component ref would keep a null identity; nothing written';
  end if;
end $$;

-- 3. SO 7128092 onto D3691
update plm.production_order_line g
   set quantity_ordered = coalesce(g.quantity_ordered, pl.quantity_ordered)
  from merge_7128092 m join plm.production_order_line pl on pl.id = m.placeholder_line
 where g.id = m.google_line;
update plm.production_order_line_source_ref r
   set production_order_line_id = m.google_line
  from merge_7128092 m
 where r.production_order_line_id = m.placeholder_line and r.source_system = 'coldlion';
delete from plm.production_order_line where id in (select placeholder_line from merge_7128092 where placeholder_line is not null);
insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary, metadata)
values ('573e156f-420c-493e-8f68-bafe66652e4a', 'coldlion', 'coldlion:so:7128092:line:1:component:5', true,
        '{"origin":"coldlion_intake","master_item_no":"AA06301","sub_item_no":"AA0631P1P01","sub_label_code":null}');
update plm.production_order_line g
   set quantity_ordered = coalesce(g.quantity_ordered, (
         select c.order_qty from coldlion.intake_order_component c
         join coldlion.intake_order_line l on l.id = c.line_id
         left join coldlion.sync_run sr on sr.id = l.last_seen_run
         where l.sales_order_no = 7128092 and l.sales_order_line_no = 1 and c.sub_item_no = 'AA0631P1P01'
         order by sr.started_at desc nulls last limit 1))
 where g.id = '573e156f-420c-493e-8f68-bafe66652e4a';

-- 4. re-pend orders that now miss a component (the writer mints them)
update coldlion.intake_new_order n
   set state = 'pending', state_changed_at = now()
 where n.state = 'created'
   and n.sales_order_no <> 7128092
   and n.sales_order_no in (
     select l.sales_order_no from coldlion.intake_order_line l
     join coldlion.intake_order_component c on c.line_id = l.id
     where not exists (
       select 1 from plm.production_order_line_source_ref r
       where r.source_system = 'coldlion'
         and r.source_id like 'coldlion:so:' || l.sales_order_no || ':line:' || l.sales_order_line_no || ':component:%'
         and r.metadata ->> 'master_item_no' = l.master_item_no
         and r.metadata ->> 'sub_item_no' is not distinct from nullif(c.sub_item_no, '')
         and r.metadata ->> 'sub_label_code' is not distinct from nullif(c.sub_label_code, '')));

commit;
