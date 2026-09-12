"""Exercise picker identity and inherited RLS in an isolated loopback database."""
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = os.environ.get('TEST_DATABASE_URL', '')
    parsed = urlsplit(source)
    if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('TEST_DATABASE_URL must point to a disposable loopback PostgreSQL cluster')
    name = 'pim_picker_' + uuid.uuid4().hex
    target = urlunsplit(parsed._replace(path='/' + name))

    def run(dsn, sql):
        result = subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', dsn], input=sql,
                                text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)

    fixture = """
create schema plm; create schema api;
create table plm.item(id uuid primary key,source_system text,source_id text,item_number text,description text,raw jsonb);
insert into plm.item values
('00000000-0000-0000-0000-000000000001','coldlion','C1/D1/SAME','SAME','First','{"companyCode":"C1","divisionCode":"D1"}'),
('00000000-0000-0000-0000-000000000002','coldlion','C2/D2/SAME','SAME','Second','{"companyCode":"C2","divisionCode":"D2"}'),
('00000000-0000-0000-0000-000000000003','coldlion','unknown',null,null,'{}'),
('00000000-0000-0000-0000-000000000004','other','not-coldlion','OTHER',null,'{}');
alter table plm.item enable row level security;
create policy fixture_read on plm.item for select to authenticated using(true);
grant usage on schema api,plm to authenticated,anon;
grant select on plm.item to authenticated;
"""
    run(source, 'create database ' + name)
    try:
        run(target, fixture)
        run(target, (ROOT / 'supabase/migrations/20260911170650_pim_canonical_item_picker.sql').read_text())
        run(target, (ROOT / 'supabase/tests/pim_item_picker_contract.sql').read_text())
        run(target, """
set role authenticated;
do $$ begin
 if (select count(*) from api.pim_item_picker)<>3 then raise exception 'authenticated coverage'; end if;
 if (select count(distinct item_id) from api.pim_item_picker where item_number='SAME')<>2 then raise exception 'duplicate number lost'; end if;
 if (select count(distinct (company_code,division_code)) from api.pim_item_picker where item_number='SAME')<>2 then raise exception 'source identity lost'; end if;
end $$;
reset role;
create policy fixture_restrict on plm.item as restrictive for select to authenticated using(source_id<>'C2/D2/SAME');
set role authenticated;
do $$ begin
 if (select count(*) from api.pim_item_picker)<>2 then raise exception 'invoker bypassed inherited RLS'; end if;
 begin
  update api.pim_item_picker set description='unauthorized';
  raise exception 'unexpected write access';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
 begin
  perform * from api.pim_item_picker;
  raise exception 'anonymous read succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
""")
    finally:
        run(source, 'drop database ' + name)
    print('PASS: canonical identity, duplicate-number distinction, null preservation, authenticated read, inherited RLS, anonymous denial and write denial; 0 skipped')


if __name__ == '__main__':
    main()
