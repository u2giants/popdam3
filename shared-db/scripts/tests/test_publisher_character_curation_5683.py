"""Run only against a dedicated disposable local PostgreSQL17 t2_curation DB."""
import json
import os
from pathlib import Path
import re
import subprocess
import unittest

SQL = (Path(__file__).resolve().parents[2] / 'supabase/migrations/20261105142616_publisher_character_curation.sql').read_text()
URL = os.environ.get('T2_CURATION_TEST_DATABASE_URL', '')
if not re.fullmatch(r'postgres(?:ql)?://postgres@127\.0\.0\.1:\d+/t2_curation', URL):
    raise RuntimeError('Dedicated localhost t2_curation database required')
IDS = list(dict.fromkeys(re.findall(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', SQL)))
HASHES = list(dict.fromkeys(re.findall(r"'([a-f0-9]{32})'", SQL)))

def query(sql, ok=True):
    result = subprocess.run(['psql', URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

class Curation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        version = int(query('show server_version_num').stdout.strip())
        assert 170000 <= version < 180000
        query('''create schema if not exists app; do $$begin create type app.entity_status as enum ('active','inactive','archived','deleted','potential'); exception when duplicate_object then null;end$$;create schema core;
        create table core.licensor(id uuid primary key,name text,code text,status app.entity_status,metadata jsonb,created_at timestamptz,updated_at timestamptz);
        create table core.character(id uuid primary key default gen_random_uuid(),licensor_id uuid references core.licensor,name text,code text,status app.entity_status,metadata jsonb);
        create unique index character_licensor_code_key on core.character(licensor_id,code) nulls not distinct where code is not null;
        create table core.character_alias(character_id uuid,licensor_id uuid,alias text,normalized_alias text);
        create table core.taxonomy_source_ref(id uuid primary key default gen_random_uuid(),entity_schema text,entity_table text,entity_id uuid,source_system text,source_table text,source_id text,source_name text,source_code text,confidence text,source_licensor_id uuid,raw jsonb,unique(source_system,source_table,source_id));''')

    def setUp(self):
        query('truncate core.character_alias,core.character,core.taxonomy_source_ref,core.licensor cascade')
        for n, lic in enumerate([IDS[1], IDS[3]]):
            query(f"insert into core.licensor values('{lic}','Synthetic parent {n}','S{n}','active','{{}}','2020-01-01','2020-01-01');")
            for index in range(2):
                query(f"insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,confidence,raw) values('core','licensor','{lic}','coldlion','fixture','synthetic-{n}-{index}','verified','{{}}');")
        self.sql = SQL
        for n, lic in enumerate([IDS[1], IDS[3]]):
            parent = query(f"select md5(to_jsonb(l)::text) from core.licensor l where id='{lic}'").stdout.strip()
            refs = query(f"select md5(jsonb_agg(to_jsonb(r) order by id)::text) from core.taxonomy_source_ref r where entity_id='{lic}'").stdout.strip()
            self.sql = self.sql.replace(HASHES[n*2],parent).replace(HASHES[n*2+1],refs)
        self.before = self.snapshot()

    def snapshot(self):
        return query("select jsonb_build_object('parents',(select jsonb_agg(to_jsonb(l) order by id) from core.licensor l),'refs',(select jsonb_agg(to_jsonb(r) order by id) from core.taxonomy_source_ref r),'chars',(select jsonb_agg(to_jsonb(c) order by id) from core.character c),'aliases',(select jsonb_agg(to_jsonb(a) order by alias) from core.character_alias a))").stdout.strip()

    def apply(self):
        return query('begin;'+self.sql+'commit;',ok=False)

    def assert_abstain(self, reason='Existing or conflicting identity'):
        before=self.snapshot()
        result=self.apply()
        self.assertNotEqual(result.returncode,0)
        self.assertIn(reason,result.stderr)
        self.assertEqual(self.snapshot(),before)

    def test_exact_two_and_unchanged_authority(self):
        self.assertEqual(self.apply().returncode,0)
        rows=json.loads(query('select jsonb_agg(to_jsonb(c) order by name) from core.character c').stdout)
        self.assertEqual([r['name'] for r in rows],['Chase','Cheer Bear'])
        self.assertTrue(all(r['code'] is None and r['status']=='active' for r in rows))
        before=json.loads(self.before);after=json.loads(self.snapshot())
        self.assertEqual(after['parents'],before['parents'])
        self.assertEqual([r for r in after['refs'] if r['entity_table']=='licensor'],before['refs'])
        self.assertEqual(len(after['refs']),6)
        self.assertIsNone(after['aliases'])
        self.assert_abstain()

    def test_native_typed_sidecar_executes_against_real_enum_column_contract(self):
        self.assertEqual(self.apply().returncode,0)
        sys=__import__('sys');sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
        import production_catalog_verification as native
        root=Path(__file__).resolve().parents[2];version='20261105142616'
        checks=native.load_behavior_sidecars(root,{version:root/'supabase/migrations'/f'{version}_publisher_character_curation.sql'},[version])
        result=query(native.build_behavior_sql(checks))
        rows=json.loads(result.stdout)['behavior_checks']
        self.assertEqual(len(rows),4)
        self.assertTrue(all(row['actual_count']==row['expected_count']==1 for row in rows))
        # Prior text descriptor passes offline shape validation but fails actual enum equality.
        wrong=__import__('copy').deepcopy(checks)
        for check in wrong:
            for filt in check['filters']:
                if filt['column']=='status':filt['type']='text'
        rejected=query('\\set VERBOSITY verbose\n'+native.build_behavior_sql(wrong),ok=False)
        self.assertNotEqual(rejected.returncode,0)
        self.assertIn('42883',rejected.stderr)

    def test_inactive_normalized_name_abstains_all(self):
        query(f"insert into core.character values(gen_random_uuid(),'{IDS[3]}','CHEER-BEAR',null,'inactive','{{\"keep\":true}}')")
        self.assert_abstain()

    def test_inactive_code_collision_abstains_all(self):
        query(f"insert into core.character values(gen_random_uuid(),'{IDS[1]}','Unrelated','Chase','inactive','{{}}')")
        self.assert_abstain()

    def test_alias_collision_abstains_all(self):
        query(f"insert into core.character_alias values(gen_random_uuid(),'{IDS[1]}','Chase','chase')")
        self.assert_abstain()

    def test_global_source_identity_conflict_abstains_both_names_across_system_licensor_and_status(self):
        query("insert into core.licensor values('00000000-0000-4000-8000-000000000099','Other','OT','active','{}','2020-01-01','2020-01-01');insert into core.character values('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000099','Unrelated',null,'inactive','{}')")
        for source in ['https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/#chase','https://www.carebears.com/#cheer-bear']:
            with self.subTest(source=source):
                query(f"insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,source_licensor_id) values('core','character','00000000-0000-4000-8000-000000000098','foreign','other','{source}','00000000-0000-4000-8000-000000000099')")
                self.assert_abstain()
                query("delete from core.taxonomy_source_ref where source_system='foreign'")

    def test_global_metadata_conflict_abstains_both_names_under_unrelated_inactive_character(self):
        query("insert into core.licensor values('00000000-0000-4000-8000-000000000099','Other','OT','active','{}','2020-01-01','2020-01-01')")
        for source in ['https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/#chase','https://www.carebears.com/#cheer-bear']:
            with self.subTest(source=source):
                metadata=json.dumps({'source_id':source,'source_system':'foreign'})
                query(f"insert into core.character values('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000099','Unrelated',null,'inactive','{metadata}')")
                self.assert_abstain()
                query("delete from core.character where id='00000000-0000-4000-8000-000000000098'")

    def test_source_name_code_and_metadata_keys_each_abstain(self):
        for key in ['source_name','source_code']:
            query(f"insert into core.taxonomy_source_ref(entity_table,entity_id,source_system,source_table,source_id,source_licensor_id,{key}) values('character',gen_random_uuid(),'other','other','synthetic-conflict','{IDS[3]}','CHEER-BEAR')")
            self.assert_abstain()
            query("delete from core.taxonomy_source_ref where source_id='synthetic-conflict'")
        query(f"insert into core.character values(gen_random_uuid(),'{IDS[1]}','Other',null,'inactive','{{\"source_id\":\"https://www.carebears.com/#cheer-bear\"}}')")
        self.assert_abstain()

    def test_changed_parent_and_authority_each_abstain(self):
        query(f"update core.licensor set name='Changed' where id='{IDS[1]}'")
        self.assert_abstain('Unchanged approved parent/source witness')
        self.setUp()
        query(f"update core.taxonomy_source_ref set confidence='unknown' where entity_id='{IDS[3]}'")
        self.assert_abstain('Unchanged approved parent/source witness')

    def test_unrelated_same_name_under_other_parent_preserved(self):
        query("insert into core.licensor values('00000000-0000-4000-8000-000000000099','Other','OT','active','{}','2020-01-01','2020-01-01');insert into core.character values('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000099','Chase','old','inactive','{\"keep\":true}')")
        before=query("select to_jsonb(c) from core.character c where code='old'").stdout
        self.assertEqual(self.apply().returncode,0)
        self.assertEqual(query("select to_jsonb(c) from core.character c where code='old'").stdout,before)

if __name__ == '__main__': unittest.main()
