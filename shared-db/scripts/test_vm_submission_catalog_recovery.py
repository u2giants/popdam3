"""Current #2599 postconditions; only synthetic labels enter disposable tests."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from production_catalog_verification import CATALOG_CONTRACTS, build_behavior_sql, load_behavior_sidecars
from production_migration_guard import GuardError

ROOT = Path(__file__).resolve().parents[1]
VERSION = '20261026150931'
MIGRATION = ROOT / 'supabase/migrations/20261026150931_curated_vm_trackerplus_submission_properties.sql'
NAME = 'vm_submission_properties_current_v1'
CONTRACT = CATALOG_CONTRACTS[NAME]
CAPTURE = '36fb2b6d-a728-4bf4-bb4c-d04b03125a2b'
VM = '5f951f5e-aaee-4add-bb51-fea888951405'
MANIFEST = '263eccc71645bf9c63e658d8521cba1706f965dd256f47360b6cb63db1c97b6b'
WORKBOOK = '32917567f1f57c78346922361faf0792e4a1fc3142c1bb82747141f4278ee724'
MAP = re.findall(r"\['([^']*)','([^']*)'\]", MIGRATION.read_text())


def quote(value):
    if value is None:
        return 'NULL'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, dict):
        return quote(json.dumps(value)) + '::jsonb'
    return "'" + str(value).replace("'", "''") + "'"


def synthetic_fixture():
    labels = ['Synthetic Property %02d' % i for i in range(40)]
    keys = [hashlib.sha256(label.encode()).hexdigest() for label in labels]
    manifest = hashlib.sha256('\n'.join(sorted(keys)).encode()).hexdigest()
    original_keys = sorted({key for _, key in MAP})
    translated = dict(zip(original_keys, keys[:32]))
    contract = CONTRACT.replace(MANIFEST, manifest)
    for original, replacement in translated.items():
        contract = contract.replace(original, replacement)
    sql = '''
create schema core; create schema plm; create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text);
create table core.licensor(id uuid,code text,name text);
create table core.property(id uuid,licensor_id uuid,name text);
create table plm.pmt_trackerplus_submission_capture(id uuid,capture_key text,status text,
 expected_property_count int,observed_property_count int,
 expected_property_manifest_sha256 text,observed_property_manifest_sha256 text,
 load_completed_at timestamptz,errors jsonb);
create table plm.pmt_trackerplus_submission_property(capture_id uuid,property_local_key text,
 exact_label text,identity_method text,ordinal int);
create table core.taxonomy_source_ref(entity_schema text,entity_table text,entity_id uuid,
 source_system text,source_table text,source_id text,source_code text,source_name text,
 source_licensor_id uuid,confidence text,raw jsonb);
'''
    sql += "insert into supabase_migrations.schema_migrations values('" + VERSION + "');\n"
    sql += "insert into core.licensor values('" + VM + "','VM','VIACOM MULTI');\n"
    sql += "insert into plm.pmt_trackerplus_submission_capture values(" + ','.join(map(quote, [CAPTURE,
        'paramount-trackerplus-2026-10-25-4bb087a7bb2514a0', 'complete', 40, 40,
        manifest, manifest])) + ",now(),'[]'::jsonb);\n"
    for i, (label, key) in enumerate(zip(labels, keys)):
        entity = str(uuid.UUID(int=i + 1))
        sql += 'insert into core.property values(' + ','.join(map(quote, [entity, VM, label])) + ');\n'
        sql += 'insert into plm.pmt_trackerplus_submission_property values(' + ','.join(map(quote,
            [CAPTURE, key, label, 'exact-label-sha256', i])) + ');\n'
        sql += 'insert into core.taxonomy_source_ref values(' + ','.join(map(quote, ['core', 'property',
            entity, 'paramount_trackerplus', 'plm.pmt_trackerplus_submission_property', key, None,
            label, VM, 'verified', {'authorising_issue': 2599, 'capture_id': CAPTURE,
                'identity_method': 'exact_label_sha256'}])) + ');\n'
    for code, old_key in MAP:
        key = translated[old_key]
        entity = str(uuid.UUID(int=keys.index(key) + 1))
        sql += 'insert into core.taxonomy_source_ref values(' + ','.join(map(quote, ['core', 'property',
            entity, 'licensing_mg06_submission_mapping', 'mg06-to-submissions-mapping-20261015',
            'VM/' + code, code, None, VM, 'verified', {'authorising_issue': 2599, 'related_issue': 2541,
                'workbook_sha256': WORKBOOK, 'property_local_key': key}])) + ');\n'
    return sql, contract, keys


class VmSubmissionCatalogRecoveryTests(unittest.TestCase):
    def synthetic_sidecar(self, root):
        directory = root / 'scripts/production-verification-sidecars'
        directory.mkdir(parents=True)
        value = dict(schema_version=1, migration_version=VERSION,
            migration_sha256=hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
            checks=[dict(id='vm_submission_current', kind='catalog_contract', contract=NAME, expected_count=1)])
        (directory / (VERSION + '.json')).write_text(json.dumps(value))

    def test_original_source_pins_every_code_mapping_and_expected_capture(self):
        self.assertEqual(hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
            'd5615451699a6cee5997e6e8be6e1280c58f4a02d37f368bcf302f20f964a187')
        self.assertEqual(len(MAP), 37)
        self.assertEqual(len({key for _, key in MAP}), 32)
        actual = re.findall(r"\('([^']*)','([a-f0-9]{64})'\)", CONTRACT)
        self.assertEqual(actual, MAP)
        for pin in [VM, CAPTURE, MANIFEST, WORKBOOK, VERSION]:
            self.assertIn(pin, CONTRACT)
        self.assertEqual(CONTRACT.count('bool_and(('), 4)
        self.assertEqual(CONTRACT.count(') IS TRUE)'), 4)
        self.assertIn("sha256(convert_to(s.exact_label,'UTF8'))", CONTRACT)
        self.assertIn("lower(p.name)=lower(s.exact_label)", CONTRACT)

    def test_existing_provenance_trigger_derives_property_licensor(self):
        source = next((ROOT / 'supabase/migrations').glob('20260911152203_*.sql')).read_text()
        self.assertIn("new.source_licensor_id := v_derived", source)
        self.assertIn("new.source_licensor_id is null", source)
        self.assertRegex(source, r"(?is)when 'property' then\s+select p\.licensor_id into v_derived from core\.property p where p\.id = new\.entity_id")
        self.assertIn('r.source_licensor_id=e.vm', CONTRACT)

    def test_inert_contract_uses_existing_typed_sidecar_route(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.synthetic_sidecar(root)
            checks = load_behavior_sidecars(root, {VERSION: MIGRATION}, [VERSION])
            self.assertEqual(checks[0]['contract'], NAME)
            self.assertIn('case when (' + CONTRACT + ') then 1 else 0 end', build_behavior_sql(checks))
            changed = root / MIGRATION.name
            changed.write_bytes(MIGRATION.read_bytes() + b'\n-- changed\n')
            with self.assertRaisesRegex(GuardError, 'migration hash mismatch'):
                load_behavior_sidecars(root, {VERSION: changed}, [VERSION])

    def test_activation_is_exact_hash_bound_and_does_not_rewrite_business_history(self):
        sidecar = ROOT / 'scripts/production-verification-sidecars' / (VERSION + '.json')
        value = json.loads(sidecar.read_text())
        self.assertEqual(value, dict(schema_version=1, migration_version=VERSION,
            migration_sha256=hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
            checks=[dict(id='vm_submission_current', kind='catalog_contract', contract=NAME, expected_count=1)]))
        checks = load_behavior_sidecars(ROOT, {VERSION: MIGRATION}, [VERSION])
        self.assertEqual(len(checks), 1)
        self.assertIn('case when (' + CONTRACT + ') then 1 else 0 end', build_behavior_sql(checks))
        registry = json.loads((ROOT / 'config/production-verification-sidecar-registry.json').read_text())
        self.assertEqual([r for r in registry['sidecars'] if r['version'] == VERSION],
            [dict(version=VERSION, issue=4878)])
        self.assertNotIn('potential', CONTRACT)
        self.assertNotIn('updated_at', CONTRACT)

    def test_activation_rejects_weakened_count_unknown_contract_and_registry_drift(self):
        from check_production_verification_sidecars import check_registry
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.synthetic_sidecar(root)
            path = root / 'scripts/production-verification-sidecars' / (VERSION + '.json')
            original = json.loads(path.read_text())
            for field, changed, error in [('expected_count', 0, 'expected_count must be 1'),
                    ('contract', 'unknown_vm_contract', 'unsupported catalog contract')]:
                value = json.loads(json.dumps(original))
                value['checks'][0][field] = changed
                path.write_text(json.dumps(value))
                with self.assertRaisesRegex(GuardError, error):
                    load_behavior_sidecars(root, {VERSION: MIGRATION}, [VERSION])
            config = root / 'config/production-verification-sidecar-registry.json'
            config.parent.mkdir()
            config.write_text(json.dumps(dict(schema_version=1, sidecars=[])))
            with self.assertRaisesRegex(GuardError, 'not declared'):
                check_registry(root, [VERSION])
            config.write_text(json.dumps(dict(schema_version=1,
                sidecars=[dict(version=VERSION, issue=4878)])))
            check_registry(root, [VERSION])
            with self.assertRaisesRegex(GuardError, 'whose files do not exist'):
                check_registry(root, [])

    @unittest.skipUnless(os.environ.get('VM_SUBMISSION_CATALOG_DOCKER') == '1',
        'set VM_SUBMISSION_CATALOG_DOCKER=1 for the isolated PostgreSQL mutation fixture')
    def test_pg16_current_state_rejects_identity_preserving_count_mutations(self):
        container = 'vm2599-catalog-' + uuid.uuid4().hex[:12]
        def run(args, **kwargs):
            return subprocess.run(args, capture_output=True, text=True, check=True, timeout=45, **kwargs)
        def psql(sql):
            return run(['docker', 'exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1',
                '-At', '-U', 'postgres'], input=sql).stdout
        fixture, contract, keys = synthetic_fixture()
        run(['docker', 'run', '--rm', '--network', 'none', '--memory', '512m', '--name', container,
            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-d', 'postgres:16'])
        try:
            for _ in range(40):
                if subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres'],
                        capture_output=True).returncode == 0:
                    break
                time.sleep(.25)
            else:
                self.fail('owned disposable PostgreSQL16 did not become ready')
            psql(fixture)
            def passes(mutation=''):
                output = psql("begin;\n" + mutation + "\nselect case when " + contract +
                    " then 'RESULT:true' else 'RESULT:false' end;\nrollback;")
                return 'RESULT:true' in output.splitlines()
            self.assertTrue(passes())
            tp = "source_system='paramount_trackerplus'"
            mp = "source_system='licensing_mg06_submission_mapping'"
            one = tp + " and source_id='" + keys[0] + "'"
            code = mp + " and source_id='VM/" + MAP[0][0] + "'"
            mutations = {
                'missing_ref': 'delete from core.taxonomy_source_ref where ' + one + ';',
                'extra_ref': "insert into core.taxonomy_source_ref select entity_schema,entity_table,entity_id,source_system,source_table,'extra',source_code,source_name,source_licensor_id,confidence,raw from core.taxonomy_source_ref where " + one + ';',
                'same_count_replaced_identity': "update core.taxonomy_source_ref set source_id='" + 'f'*64 + "' where " + one + ';',
                'swapped_canonical_entities': "update core.taxonomy_source_ref set entity_id=case when entity_id='00000000-0000-0000-0000-000000000001'::uuid then '00000000-0000-0000-0000-000000000002'::uuid else '00000000-0000-0000-0000-000000000001'::uuid end where " + tp + " and entity_id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');",
                'wrong_target_type': "update core.taxonomy_source_ref set entity_table='character' where " + one + ';',
                'null_confidence': "update core.taxonomy_source_ref set confidence=null where " + one + ';',
                'null_source_name': "update core.taxonomy_source_ref set source_name=null where " + one + ';',
                'wrong_source_name': "update core.taxonomy_source_ref set source_name='different' where " + one + ';',
                'wrong_licensor': "update core.taxonomy_source_ref set source_licensor_id='00000000-0000-0000-0000-000000000099' where " + one + ';',
                'missing_raw_identity': "update core.taxonomy_source_ref set raw=raw-'identity_method' where " + one + ';',
                'wrong_raw_capture': "update core.taxonomy_source_ref set raw=jsonb_set(raw,'{capture_id}','\"other\"') where " + one + ';',
                'wrong_provenance_json_type': "update core.taxonomy_source_ref set raw=jsonb_set(raw,'{authorising_issue}','\"2599\"') where " + one + ';',
                'renamed_canonical': "update core.property set name='other' where id='00000000-0000-0000-0000-000000000001';",
                'null_canonical_name': "update core.property set name=null where id='00000000-0000-0000-0000-000000000001';",
                'duplicate_casefold_name': "insert into core.property values('00000000-0000-0000-0000-000000000099','"+VM+"','SYNTHETIC PROPERTY 00');",
                'incomplete_capture': "update plm.pmt_trackerplus_submission_capture set status='loading';",
                'wrong_capture_manifest': "update plm.pmt_trackerplus_submission_capture set observed_property_manifest_sha256='"+'0'*64+"';",
                'null_capture_completion': "update plm.pmt_trackerplus_submission_capture set load_completed_at=null;",
                'capture_errors': "update plm.pmt_trackerplus_submission_capture set errors='[\"error\"]';",
                'changed_source_label_same_key': "update plm.pmt_trackerplus_submission_property set exact_label='other' where ordinal=39;",
                'replaced_unmapped_source': "update plm.pmt_trackerplus_submission_property set exact_label='Replacement',property_local_key=encode(sha256(convert_to('Replacement','UTF8')),'hex') where ordinal=39;",
                'duplicate_source_ordinal': "update plm.pmt_trackerplus_submission_property set ordinal=0 where ordinal=39;",
                'wrong_existing_mapping_entity': "update core.taxonomy_source_ref set entity_id=case when entity_id='00000000-0000-0000-0000-000000000001'::uuid then '00000000-0000-0000-0000-000000000002'::uuid else '00000000-0000-0000-0000-000000000001'::uuid end where " + code + ';',
                'wrong_mapping_entity': "update core.taxonomy_source_ref set entity_id='00000000-0000-0000-0000-000000000099' where " + code + ';',
                'wrong_mapping_key': "update core.taxonomy_source_ref set raw=jsonb_set(raw,'{property_local_key}','\"other\"') where " + code + ';',
                'wrong_mapping_workbook': "update core.taxonomy_source_ref set raw=jsonb_set(raw,'{workbook_sha256}','\"other\"') where " + code + ';',
                'wrong_mapping_source_code': "update core.taxonomy_source_ref set source_code='other' where " + code + ';',
                'wrong_mapping_source_name': "update core.taxonomy_source_ref set source_name='other' where " + code + ';',
                'null_mapping_confidence': "update core.taxonomy_source_ref set confidence=null where " + code + ';',
                'wrong_mapping_related_issue': "update core.taxonomy_source_ref set raw=jsonb_set(raw,'{related_issue}','0') where " + code + ';',
                'missing_mapping': 'delete from core.taxonomy_source_ref where ' + code + ';',
                'same_count_replaced_mapping': "update core.taxonomy_source_ref set source_id='VM/extra' where " + code + ';',
                'extra_mapping': "insert into core.taxonomy_source_ref select entity_schema,entity_table,entity_id,source_system,source_table,'VM/extra',source_code,source_name,source_licensor_id,confidence,raw from core.taxonomy_source_ref where " + code + ';',
                'missing_ledger': "delete from supabase_migrations.schema_migrations;",
            }
            for label, mutation in mutations.items():
                with self.subTest(mutation=label):
                    self.assertFalse(passes(mutation))
            self.assertTrue(passes("insert into core.property values('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000099','Synthetic Property 00');"))
            self.assertTrue(passes())
            self.assertEqual(psql('select count(*) from core.taxonomy_source_ref;').strip(), '77')
        finally:
            subprocess.run(['docker', 'stop', container], capture_output=True, timeout=30)


if __name__ == '__main__':
    unittest.main()
