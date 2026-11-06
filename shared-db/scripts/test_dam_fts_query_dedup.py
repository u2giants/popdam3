"""Opt-in real PG17 complete search-output parity for #5730."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261106042721_dam_fts_query_dedup.sql'
BASE = ROOT / 'supabase/migrations/20261105023330_dam_search_no_short_word_substring.sql'
SIGNATURE = 'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)'


def original_definition():
    s = BASE.read_text()
    start = s.index('CREATE OR REPLACE FUNCTION')
    return s[start:s.index('$function$;', start) + len('$function$;')]


class SourceContract(unittest.TestCase):
    def test_only_one_expression_changes_and_atomic_policy_is_exact(self):
        old = original_definition()
        source = MIGRATION.read_text()
        start = source.index('CREATE OR REPLACE FUNCTION')
        new = source[start:source.index('$function$;', start) + len('$function$;')]
        self.assertEqual(new, old.replace('array(select q.tsq from queries q)', 'array(select distinct q.tsq from queries q)'))
        policy = json.loads((ROOT / 'config/atomic-migration-allowlist.json').read_text())['migrations']['20261106042721']
        self.assertEqual(policy, {'sha256': hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), 'targets': ['preview', 'production'], 'strip_outer_transaction': True})
        for budget in ["lock_timeout='500ms'", "statement_timeout='2500ms'", "transaction_timeout='3s'"]:
            self.assertIn(budget, source)


@unittest.skipUnless(os.environ.get('DAM_FTS_DEDUP_DOCKER') == '1', 'explicit isolated PG17 drill required')
class FullSearchParity(unittest.TestCase):
    @classmethod
    def sql(cls, text, check=True):
        r = subprocess.run(['docker', 'exec', '-i', cls.container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], input=text, text=True, capture_output=True, timeout=30)
        if check and r.returncode:
            raise AssertionError(r.stderr)
        return r

    @classmethod
    def setUpClass(cls):
        cls.container = 'vb-fts-full-' + uuid.uuid4().hex[:10]
        subprocess.run(['docker', 'run', '-d', '--network', 'none', '--cpus', '1', '--memory', '512m', '--name', cls.container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:0.8.0-pg17'], check=True, capture_output=True)
        cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', cls.container], capture_output=True))
        subprocess.run(['docker', 'exec', cls.container, 'sh', '-c', 'until [ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres >/dev/null 2>&1; do sleep 0.1; done'], check=True, timeout=20)
        cls.sql("""CREATE SCHEMA extensions; CREATE EXTENSION vector WITH SCHEMA extensions; CREATE SCHEMA dam;
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        GRANT USAGE ON SCHEMA extensions TO authenticated,service_role;
        CREATE TYPE file_type AS ENUM('ai','psd'); CREATE TYPE asset_status AS ENUM('ready','pending');
        CREATE TYPE workflow_status AS ENUM('approved'); CREATE TYPE asset_type AS ENUM('art'); CREATE TYPE art_source AS ENUM('original');
        CREATE TABLE style_groups(id uuid primary key,licensor_id uuid,property_id uuid,customer_id uuid);
        CREATE TABLE assets(id uuid primary key,is_deleted bool,modified_at timestamptz,file_created_at timestamptz,thumbnail_url text,style_group_id uuid,licensor_id uuid,property_id uuid,customer_id uuid,file_type file_type,content_type text,product_material text[],status asset_status,workflow_status workflow_status,stage text,is_licensed bool,asset_type asset_type,art_source art_source,thumbnail_error text,product_category text,relative_path text,customer text,program text);
        CREATE TABLE asset_effective_tags(asset_id uuid,tag text);
        CREATE TABLE dam_search_keys(document_type text,entity_id uuid,asset_id uuid,style_group_id uuid,title text,path text,customer text,program text,title_key text,title_tsv tsvector,search_tsv tsvector);
        CREATE TABLE dam_search_documents(document_type text,entity_id uuid,asset_id uuid,style_group_id uuid,embedding extensions.vector(768),embedding_model text);
        CREATE TABLE dam.search_group_vectors(LIKE dam_search_documents INCLUDING ALL);
        CREATE FUNCTION require_dam_access() RETURNS bool LANGUAGE plpgsql STABLE AS $$ BEGIN IF current_setting('test.access',true)='deny' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='denied'; END IF; RETURN current_setting('test.access',true) IS DISTINCT FROM 'false'; END $$;
        CREATE FUNCTION assets_thumbnail_min_date() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT '2020-01-01'::timestamptz$$;
        CREATE FUNCTION expand_dam_search_queries(p text) RETURNS TABLE(query_text text) LANGUAGE sql STABLE AS $$ SELECT v FROM unnest(CASE p WHEN 'dup' THEN ARRAY['needle','needle'] WHEN 'mixed' THEN ARRAY['needle','common','needle'] ELSE ARRAY[p] END) v $$;
        """)
        helper = (ROOT / 'supabase/migrations/20261030224046_dam_search_exact_totals.sql').read_text()
        start = helper.index('CREATE FUNCTION public.dam_asset_matches_filters(')
        cls.sql(helper[start:helper.index('$fn$;', start) + len('$fn$;')])
        cls.sql(original_definition())
        cls.sql('REVOKE ALL ON FUNCTION ' + SIGNATURE + ' FROM PUBLIC; GRANT EXECUTE ON FUNCTION ' + SIGNATURE + ' TO service_role,authenticated;')
        cls.sql("""INSERT INTO style_groups(id) VALUES('10000000-0000-0000-0000-000000000001');
        INSERT INTO assets(id,is_deleted,modified_at,thumbnail_url,style_group_id,file_type,status,workflow_status,stage,is_licensed,customer,program) VALUES
        ('20000000-0000-0000-0000-000000000001',false,now(),'fixture','10000000-0000-0000-0000-000000000001','ai','ready','approved','approved',true,'customerA','programA'),
        ('20000000-0000-0000-0000-000000000002',false,now(),'fixture',NULL,'psd','pending','approved','draft',false,'customerB','programB'),
        ('20000000-0000-0000-0000-000000000003',true,now(),'fixture','10000000-0000-0000-0000-000000000001','ai','ready','approved','approved',true,'customerA','programA');
        INSERT INTO dam_search_keys SELECT 'asset',a.id,a.id,a.style_group_id,CASE WHEN a.file_type='ai' THEN 'needle' ELSE 'common' END,'fixture',a.customer,a.program,CASE WHEN a.file_type='ai' THEN 'needle' ELSE 'common' END,to_tsvector('simple',CASE WHEN a.file_type='ai' THEN 'needle' ELSE 'common' END),to_tsvector('simple',CASE WHEN a.file_type='ai' THEN 'needle' ELSE 'common' END) FROM assets a;
        INSERT INTO dam_search_keys SELECT 'style_group',id,NULL,id,'needle','fixture','customerA','programA','needle',to_tsvector('simple','needle'),to_tsvector('simple','needle') FROM style_groups;
        CREATE INDEX ON dam_search_keys USING gin(search_tsv);
        """)
        vector = "'[" + ','.join(['1'] + ['0'] * 767) + "]'::extensions.vector"
        cls.vector = vector
        cls.sql("INSERT INTO dam_search_documents SELECT document_type,entity_id,asset_id,style_group_id," + vector + ",'google/siglip2-base-patch16-naflex' FROM dam_search_keys; INSERT INTO dam.search_group_vectors SELECT * FROM dam_search_documents WHERE document_type='style_group';")
        cls.before = cls.metadata()
        cls.cases = []
        for query in ['dup', 'mixed', 'unmatched']:
            for scope in ['NULL', "ARRAY['asset']", "ARRAY['style_group']", "ARRAY['asset','style_group']", "ARRAY['unknown']"]:
                for embedding in ['NULL', vector]:
                    cls.cases.append((query, scope, embedding, '{}', 100, 0))
        cls.cases += [('mixed', "ARRAY['asset']", 'NULL', '{"stage":["approved"]}', 1, 0), ('mixed', 'NULL', vector, '{}', 1, 1)]
        cls.original_outputs = [cls.output(*case) for case in cls.cases]
        cls.sql(MIGRATION.read_text())
        cls.sql((ROOT / "supabase/tests/dam_fts_query_dedup_contracts.sql").read_text())

    @classmethod
    def metadata(cls):
        return cls.sql("SELECT json_build_array(proowner,proacl::text,proconfig,prosecdef,provolatile,proretset,proargtypes::text,proallargtypes::text,proargmodes,proargnames,proargdefaults::text) FROM pg_proc WHERE oid='" + SIGNATURE + "'::regprocedure").stdout

    @classmethod
    def output(cls, query, scope, embedding, filters, limit, offset, role='authenticated'):
        call = "public.search_dam_documents('" + query + "','" + filters + "'::jsonb," + str(limit) + ',' + str(offset) + ',' + scope + ',' + embedding + ',0,NULL)'
        return cls.sql('SET ROLE ' + role + "; SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY rank DESC NULLS LAST,document_type,entity_id),'[]'::jsonb) FROM " + call + ' t;').stdout.splitlines()[-1]

    def test_complete_outputs_ranks_totals_facets_visibility_and_paging_match(self):
        for case, expected in zip(self.cases, self.original_outputs):
            with self.subTest(query=case[0], scope=case[1], has_embedding=case[2] != 'NULL'):
                self.assertEqual(self.output(*case), expected)
        visible = json.loads(self.output('mixed', "ARRAY['asset']", 'NULL', '{}', 100, 0))
        self.assertEqual(len(visible), 2)
        self.assertTrue(all(row['total_count'] == 2 for row in visible))
        self.assertNotIn('20000000-0000-0000-0000-000000000003', json.dumps(visible))

    def test_existing_owner_acl_settings_and_wire_contract_are_unchanged(self):
        self.assertEqual(self.metadata(), self.before)
        self.assertEqual(self.output('dup', "ARRAY['asset']", 'NULL', '{}', 100, 0, 'service_role'), self.original_outputs[2])
        denied = self.sql('SET ROLE anon; SELECT * FROM ' + SIGNATURE.split('(')[0] + "('dup','{}',100,0);", False)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('permission denied', denied.stderr)
        denied = self.sql("SET test.access='deny'; SELECT * FROM public.search_dam_documents('dup','{}',100,0);", False)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('denied', denied.stderr)

    def test_original_access_and_runtime_drift_are_refused(self):
        for mutation in [
            'ALTER FUNCTION ' + SIGNATURE + ' SECURITY INVOKER',
            'ALTER FUNCTION ' + SIGNATURE + " SET statement_timeout='31s'",
            'REVOKE EXECUTE ON FUNCTION ' + SIGNATURE + ' FROM authenticated',
        ]:
            result = self.sql('BEGIN;' + original_definition() + ';' + mutation + ';' + MIGRATION.read_text(), False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('original search contract differs', result.stderr)
        self.assertEqual(self.metadata(), self.before)

    def test_existing_ranked_guard_accepts_dedup_and_refuses_missing_dedup_or_maxrank(self):
        source = (ROOT / 'supabase/tests/popdam_authorized_ranked_search_contracts.sql').read_text()
        start = source.index("  if position('d.search_tsv @@ any(array(")
        guard = source[start:source.index('  end if;', start) + len('  end if;')]
        actual = self.sql("SELECT pg_get_functiondef('" + SIGNATURE + "'::regprocedure)").stdout
        variants = [
            (actual, True),
            (actual.replace('array(select distinct q.tsq from queries q)', 'array(select q.tsq from queries q)'), False),
            (actual.replace('(select max(', '(select sum(', 1), False),
        ]
        for definition, accepted in variants:
            result = self.sql('DO $guard_test$ DECLARE v_definition text := $candidate$' + definition + '$candidate$; BEGIN ' + guard + ' END $guard_test$;', False)
            self.assertEqual(result.returncode == 0, accepted)
            if not accepted:
                self.assertIn('ranked search must retain the measured indexable scan and maximum synonym rank', result.stderr)

    def test_replay_or_source_drift_is_refused(self):
        refused = self.sql(MIGRATION.read_text(), False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('original search contract differs', refused.stderr)

    def test_z_default_only_drift_refuses_atomically_without_overwriting_preimage(self):
        drifted = original_definition().replace('p_min_rank real DEFAULT 0,', 'p_min_rank real DEFAULT 0.1,')
        self.assertNotEqual(drifted, original_definition())
        try:
            self.sql(drifted)
            before = self.metadata()
            self.assertEqual(self.sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='" + SIGNATURE + "'::regprocedure").stdout.strip(), '5ad9960f79ef20074b0f93e2b589caf2')
            refused = self.sql(MIGRATION.read_text(), False)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn('original search contract differs', refused.stderr)
            self.assertEqual(self.metadata(), before)
            arguments = self.sql("SELECT pg_get_function_arguments('" + SIGNATURE + "'::regprocedure)").stdout
            self.assertIn('0.1', arguments)
        finally:
            self.sql(original_definition())
            self.sql(MIGRATION.read_text())


if __name__ == '__main__':
    unittest.main()
