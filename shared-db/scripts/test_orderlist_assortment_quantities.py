"""Exercise the actual assortment reader in a disposable loopback database.

Owner: OrderList #4855. Reuses the SQL test convention from test_order_list_find_position.py.
Set TEST_DATABASE_URL to a local maintenance database; never accepts shared Supabase.
"""
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parsed = urlsplit(os.environ.get('TEST_DATABASE_URL', ''))
    if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('TEST_DATABASE_URL must name disposable loopback PostgreSQL')
    name = 'assortment_test_' + uuid.uuid4().hex
    base = urlunsplit(parsed)
    target = urlunsplit(parsed._replace(path='/' + name))

    def run(url, sql):
        p = subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', url], input=sql,
                           capture_output=True, text=True, timeout=60)
        if p.returncode:
            raise RuntimeError(p.stderr)

    run(base, f'create database {name}')
    try:
        run(target, """
create schema auth; create schema api; create schema plm; create schema coldlion;
create function auth.uid() returns uuid language sql stable as
 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
create table plm.production_order_line(id uuid primary key, assortment_id text, sku text, metadata jsonb);
create table plm.production_order_line_source_ref(production_order_line_id uuid, source_system text, source_id text, is_primary boolean);
create table public.order_fixture(order_line_id uuid primary key, assortment_id text, sku text, coldlion_source_id text);
create view api.dam_order_list as select * from public.order_fixture;
create table coldlion.intake_order_line(id uuid, company_code text, sales_order_no bigint, sales_order_line_no integer, master_item_no text);
create table coldlion.intake_order_component(line_id uuid, sub_item_no text, component_source_hash text, quantity numeric);
create table coldlion.item_detail(item_no text,company_code text,division_code text,pre_pack_code text);
create table coldlion.prepack_detail(company_code text,division_code text,prepack_code text,item_no text,quantity integer,detail_prepack text);
insert into public.order_fixture
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case when i=8 then null else 'PACK-'||i end,'SKU-'||i,
 case when i<=3 then 'coldlion:so:500:line:'||i||':component:1' end
from generate_series(1,9) i;
insert into plm.production_order_line select order_line_id,assortment_id,sku,
 case when coldlion_source_id is not null then jsonb_build_object('component_source_hash','exact-'||right(sku,1)) else '{}'::jsonb end
from public.order_fixture;
insert into plm.production_order_line_source_ref select order_line_id,'coldlion',coldlion_source_id,true from public.order_fixture where coldlion_source_id is not null;
-- Non-primary references must not duplicate or displace the authoritative source.
insert into plm.production_order_line_source_ref select order_line_id,'coldlion','coldlion:so:999:line:1:component:1',false from public.order_fixture where sku='SKU-1';
insert into coldlion.intake_order_line
select order_line_id,'EDGEHOME',500,i,assortment_id
from public.order_fixture cross join lateral (select right(sku,1)::integer i) v where i<=3;
insert into coldlion.intake_order_component
select order_line_id,sku,'exact-'||right(sku,1),case when sku='SKU-1' then 2 else null end from public.order_fixture where coldlion_source_id is not null;
-- Same SKU on another line and same line with a different hash must not bleed across.
insert into coldlion.intake_order_component select order_line_id,'SKU-1','wrong-hash',999 from public.order_fixture where sku='SKU-1';
insert into coldlion.intake_order_component select order_line_id,'SKU-1','exact-1',999 from public.order_fixture where sku='SKU-2';
-- An exact-source conflict must abstain even with a valid current catalog recipe.
insert into coldlion.intake_order_component select order_line_id,sku,'exact-3',3 from public.order_fixture where sku='SKU-3';
insert into coldlion.item_detail select assortment_id,'EDGEHOME','DIV-A','CODE-'||right(sku,1) from public.order_fixture where assortment_id is not null;
insert into coldlion.prepack_detail select 'EDGEHOME','DIV-A','CODE-'||right(sku,1),sku,
 case when sku='SKU-7' then 0 else 4 end, case when sku='SKU-9' then 'NESTED' else '' end
from public.order_fixture;
-- Multiple manifests remain ambiguous even when only one contains the requested SKU.
insert into coldlion.item_detail values ('PACK-5','EDGEHOME','DIV-B','OTHER');
-- Duplicate component records remain ambiguous.
insert into coldlion.prepack_detail values ('EDGEHOME','DIV-A','CODE-6','SKU-6',4,'');
""")
        run(target, (ROOT / 'supabase/migrations/20261027155655_orderlist_assortment_quantities.sql').read_text())
        run(target, """
do $$ begin
 if has_function_privilege('anon','public.get_dam_order_assortment_quantities(uuid[])','execute') then raise exception 'anonymous grant'; end if;
 if not has_function_privilege('authenticated','public.get_dam_order_assortment_quantities(uuid[])','execute') then raise exception 'missing authenticated grant'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
do $$ declare r record; n integer; ids uuid[]; begin
 select array_agg(('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid) into ids from generate_series(1,9) i;
 select count(*) into n from public.get_dam_order_assortment_quantities(ids);
 if n<>9 then raise exception 'row multiplicity %',n; end if;
 for r in select * from public.get_dam_order_assortment_quantities(ids) loop
   n:=right(r.order_line_id::text,1)::integer;
   if n=1 then
     if r.assortment_sku_quantity is distinct from 2::numeric or r.quantity_source is distinct from 'order_recipe' then raise exception 'exact source binding'; end if;
   elsif n=4 then
     if r.assortment_sku_quantity is distinct from 4::numeric or r.quantity_source is distinct from 'current_recipe' then raise exception 'current recipe'; end if;
   elsif r.assortment_sku_quantity is not null or r.quantity_source is not null then
     raise exception 'unknown/conflict/zero/nested quantity manufactured for %',n;
   end if;
 end loop;
 if exists(select from public.get_dam_order_assortment_quantities(array[]::uuid[])) then raise exception 'empty IDs'; end if;
 if exists(select from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-999999999999'::uuid])) then raise exception 'unknown ID'; end if;
 select count(*) into n from public.get_dam_order_assortment_quantities(array[ids[1],ids[1]]);
 if n<>1 then raise exception 'duplicate IDs'; end if;
 begin perform * from public.get_dam_order_assortment_quantities(null); raise exception 'null IDs accepted'; exception when invalid_parameter_value then null; end;
 begin perform * from public.get_dam_order_assortment_quantities(array[null::uuid]); raise exception 'null ID accepted'; exception when invalid_parameter_value then null; end;
 begin perform * from public.get_dam_order_assortment_quantities(array_fill(ids[1],array[1501])); raise exception 'oversize accepted'; exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub','',false);
 begin perform * from public.get_dam_order_assortment_quantities(ids); raise exception 'unsigned accepted'; exception when insufficient_privilege then null; end;
end $$;
""")
        print('PASS: assortment quantities, exact source isolation, catalog ambiguity, missing/zero/nested values, authentication and bounds')
    finally:
        run(base, f'drop database {name} with (force)')


if __name__ == '__main__':
    main()
