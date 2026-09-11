"""Synthetic SQL behavior/RLS tests in a uniquely created loopback database.

Set TEST_DATABASE_URL to a local maintenance database with CREATE DATABASE rights.
No shared Supabase access is accepted. Existing cluster roles are never altered.
"""
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20260911081204_dam_order_list_find_position.sql'


def main():
    url = os.environ.get('TEST_DATABASE_URL', '')
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('TEST_DATABASE_URL must name a disposable loopback PostgreSQL maintenance database')
    name = 'order_find_test_' + uuid.uuid4().hex
    test_url = urlunsplit(parsed._replace(path='/' + name))

    def run(dsn, sql):
        result = subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', dsn], input=sql,
                                capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError(result.stderr)

    migration = MIGRATION.read_text()
    columns = re.findall(r"'([a-z_]+)'", migration.split('allowed_columns constant text[] := array[')[1].split('];')[0])
    dates = {c for c in columns if c.endswith('_date')} | {'etd', 'eta'}
    numbers = {'quantity_ordered', 'quantity_shipped', 'unit_cost', 'order_depth_inches', 'cases_reported', 'case_pack', 'assortment_component_ordinal'}
    booleans = {'close_tracking', 'contractual_sample_reorder'}
    definitions = ','.join('"' + c + '" ' + ('uuid primary key' if c == 'order_line_id' else 'date' if c in dates else 'numeric' if c in numbers else 'boolean' if c in booleans else 'text') for c in columns)
    fixture = f"""
create schema auth; create schema api;
create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
create function auth.role() returns text language sql stable as 'select current_setting(''request.jwt.claim.role'',true)';
grant usage on schema auth,api to authenticated;
create table public.find_fixture(owner_id uuid not null, {definitions});
alter table public.find_fixture enable row level security;
create policy owner_rows on public.find_fixture for select to authenticated using(owner_id=auth.uid());
grant select on public.find_fixture to authenticated;
create view api.dam_order_list with (security_invoker=true) as select {','.join('"'+c+'"' for c in columns)} from public.find_fixture;
grant select on api.dam_order_list to authenticated;
insert into public.find_fixture(owner_id,order_line_id,order_date,sku,quantity_ordered,customer_name,vendor_name,snapshot_description)
values
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000001','2026-09-03','ALPHA',20,'North','V1','plain'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000002','2026-09-02','TARGET',10,'North','V2','literal 100% _ '||chr(92)),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000003','2026-09-02','target second',30,'South',null,'other'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000004',null,'ZETA',null,null,'V4',null),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000005','2026-09-04','TARGET hidden',1,'North','hidden','hidden');
"""
    checks = r"""
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
do $test$
declare r record; count_tests integer := 0; c record; expected uuid; expected_index bigint;
begin
  for c in select * from (values
    ('target','[]','[]',2,1),
    ('target','[]','[{"column":"quantity_ordered","ascending":false}]',3,0),
    ('target','[{"column":"customer_name","operator":"eq","value":"North"}]','[]',2,1),
    ('target','[{"column":"quantity_ordered","operator":"gte","value":25}]','[]',3,0),
    ('target','[{"column":"order_date","operator":"lte","value":"2026-09-02"}]','[]',2,0),
    ('target','[{"column":"vendor_name","operator":"is","value":null}]','[]',3,0),
    ('target','[{"column":"vendor_name","operator":"not.is","value":null}]','[]',2,1),
    ('target','[{"column":"sku","operator":"ilike","value":"target%"}]','[]',2,0),
    ('target','[{"column":"sku","operator":"not.ilike","value":"%second%"}]','[]',2,1),
    ('target','[{"column":"quantity_ordered","operator":"gt","value":10},{"column":"quantity_ordered","operator":"lt","value":31}]','[]',3,1),
    ('target','[{"column":"quantity_ordered","operator":"neq","value":20}]','[]',2,0),
    ('target','[]','[{"column":"order_date","ascending":true}]',2,0),
    ('%','[]','[]',2,1),
    ('_','[]','[]',2,1)
  ) as cases(search,filters,sort,id,idx) loop
    select * into r from public.find_dam_order_list_row(c.search,c.filters::jsonb,c.sort::jsonb);
    expected := ('00000000-0000-0000-0000-'||lpad(c.id::text,12,'0'))::uuid;
    if r.order_line_id is distinct from expected or r.row_index is distinct from c.idx::bigint then
      raise exception 'behavior case % failed', count_tests+1;
    end if;
    count_tests := count_tests+1;
  end loop;
  if (select row_index from public.find_dam_order_list_row(chr(92))) is distinct from 1::bigint then raise exception 'literal slash failed'; end if;
  if (select row_index from public.find_dam_order_list_row(chr(9)||'TARGET'||chr(160))) is distinct from 1::bigint then raise exception 'JS whitespace trim parity failed'; end if;
  if exists(select from public.find_dam_order_list_row(' ')) or exists(select from public.find_dam_order_list_row('no match'))
    or exists(select from public.find_dam_order_list_row(null)) or exists(select from public.find_dam_order_list_row('hidden')) then
    raise exception 'empty/no-match/RLS search failed';
  end if;
  -- Compare independently numbered unsearched view with every visible row's
  -- unique search term, under both directions and stable null-last ties.
  for c in select * from (values ('ALPHA'),('TARGET'),('second'),('ZETA')) t(term) loop
    select order_line_id,idx into expected,expected_index from (
      select d.*,row_number() over(order by order_date desc nulls last,order_line_id)-1 idx
      from api.dam_order_list d) ranked where sku ilike '%'||c.term||'%' order by idx limit 1;
    select * into r from public.find_dam_order_list_row(c.term);
    if r.order_line_id is distinct from expected or r.row_index is distinct from expected_index then raise exception 'independent ranking parity failed'; end if;
  end loop;
  for c in select * from (values
    ('[{"column":"sku; drop table public.find_fixture;--","operator":"eq","value":"x"}]','[]'),
    ('[{"column":"sku","operator":"eq) or true--","value":"x"}]','[]'),
    ('[]','[{"column":"sku","ascending":"desc;select 1"}]'),
    ('{}','[]'), ('[null]','[]'),
    ('[{"column":"sku","operator":"eq","value":{}}]','[]'),
    ('[{"column":"sku","operator":"is","value":"null"}]','[]')
  ) t(filters,sort) loop
    begin
      perform * from public.find_dam_order_list_row('target',c.filters::jsonb,c.sort::jsonb);
      raise exception 'invalid input was accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  if exists(select from public.find_dam_order_list_row('target','[{"column":"sku","operator":"eq","value":"x'' OR true --"}]')) then raise exception 'literal injection matched'; end if;
  perform set_config('request.jwt.claim.sub','',false);
  begin
    perform * from public.find_dam_order_list_row('target'); raise exception 'missing identity accepted';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
set role anon;
do $$ begin
  begin perform * from public.find_dam_order_list_row('target'); raise exception 'anon accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
"""
    created = False
    try:
        run(url, f'CREATE DATABASE "{name}";')
        created = True
        run(test_url, fixture + migration + (ROOT/'supabase/tests/dam_order_list_find_position.sql').read_text() + checks)
        print('OrderList Find: 14 expected-position cases, 4 independent ranking parity cases, wildcard/null/RLS/auth/injection contracts passed; 0 skipped.')
    finally:
        if created:
            run(url, f'DROP DATABASE "{name}";')


if __name__ == '__main__':
    main()
