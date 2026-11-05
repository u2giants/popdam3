"""Opt-in isolated real pgvector equivalence/permission/one-pass drills (#5703)."""
import json
import hashlib
import os
import pathlib
import re
import subprocess
import selectors
import time
import unittest
import uuid

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIGRATION=ROOT/'supabase/migrations/20261105150450_dam_batched_semantic_anchors.sql'

def vector(axis=None):
    return "'["+','.join('1' if i==axis else '0' for i in range(768))+"]'::extensions.vector"

@unittest.skipUnless(os.environ.get('DAM_BATCH_ANCHOR_DOCKER')=='1','explicit isolated Docker drill required')
class BatchedAnchors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container='vb-anchor-'+uuid.uuid4().hex[:12]
        subprocess.run(['docker','run','-d','--network','none','--cpus','1','--memory','512m','--name',cls.container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:0.8.0-pg17'],check=True,capture_output=True)
        cls.addClassCleanup(lambda:subprocess.run(['docker','rm','-f',cls.container],capture_output=True))
        subprocess.run(['docker','exec',cls.container,'sh','-c','until [ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres >/dev/null 2>&1; do sleep 0.1; done'],check=True,timeout=20)
        cls.sql("""CREATE SCHEMA extensions; CREATE EXTENSION vector WITH SCHEMA extensions; CREATE SCHEMA dam;
          CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
          -- Existing Supabase extension-schema usage; not a migration grant.
          GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;
          CREATE SEQUENCE public.permission_calls;
          CREATE FUNCTION public.require_dam_access() RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
          BEGIN PERFORM nextval('public.permission_calls');
            IF current_setting('test.dam_access',true)='deny' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DAM access denied'; END IF;
            RETURN current_setting('test.dam_access',true) IS DISTINCT FROM 'false'; END; $$;
          CREATE TABLE dam.search_group_vectors(document_type text,embedding extensions.vector(768),embedding_model text);
          CREATE TABLE public.dam_search_documents(document_type text,embedding extensions.vector(768),embedding_model text);
        """)
        for table,kind,axes in [('dam.search_group_vectors','style_group',[0,1,None]),('public.dam_search_documents','style_group',[0,1,None]),('public.dam_search_documents','asset',[2,3,None])]:
            cls.sql('INSERT INTO '+table+' VALUES '+','.join("('"+kind+"',"+vector(a)+",'google/siglip2-base-patch16-naflex')" for a in axes))
        cls.sql("INSERT INTO dam.search_group_vectors SELECT 'style_group',embedding,embedding_model FROM dam.search_group_vectors CROSS JOIN generate_series(1,30)")
        old=(ROOT/'supabase/migrations/20261102003027_dam_dense_group_vectors.sql').read_text()
        old=old[old.index('create or replace function public.dam_search_semantic_anchor('):]
        cls.sql(old)
        cls.sql("REVOKE ALL ON FUNCTION public.dam_search_semantic_anchor(extensions.vector,text[]) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.dam_search_semantic_anchor(extensions.vector,text[]) TO authenticated,service_role")
        cls.old_before=cls.sql("SELECT json_build_array(prosrc,proacl::text,proowner::text,proconfig) FROM pg_proc WHERE oid='public.dam_search_semantic_anchor(extensions.vector,text[])'::regprocedure").stdout
        cls.sql(MIGRATION.read_text())

    @classmethod
    def sql(cls,text,success=True):
        r=subprocess.run(['docker','exec','-i',cls.container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres'],input=text,text=True,capture_output=True,timeout=20)
        if success and r.returncode:raise AssertionError(r.stderr)
        return r

    def compare(self,scope,first=0,second=1,prefix=''):
        x,y=vector(first),vector(second)
        query="SELECT json_build_object('old1',public.dam_search_semantic_anchor("+x+","+scope+"),'old2',public.dam_search_semantic_anchor("+y+","+scope+"),'batch',(SELECT json_agg(row_to_json(b) ORDER BY query_index) FROM public.dam_search_semantic_anchors("+x+","+y+","+scope+")b))"
        result=self.sql(prefix+query+';ROLLBACK;' if prefix else query)
        values=json.loads(next(line for line in result.stdout.splitlines() if line.startswith('{')))
        self.assertEqual([r['query_index'] for r in values['batch']],[1,2])
        self.assertEqual([r['score'] for r in values['batch']],[values['old1'],values['old2']])

    def test_single_and_two_vector_all_scope_equivalence(self):
        for scope in ['NULL',"ARRAY['style_group']","ARRAY['asset']","ARRAY['asset','style_group']",'ARRAY[]::text[]',"ARRAY['unknown']","ARRAY['style_group','unknown']","ARRAY['style_group',NULL]"]:
            with self.subTest(scope=scope):self.compare(scope)
        x=vector(0)
        r=self.sql("SELECT json_agg(row_to_json(b)) FROM public.dam_search_semantic_anchors("+x+",NULL,ARRAY['style_group'])b")
        self.assertEqual(json.loads(r.stdout),[{'query_index':1,'score':1}])

    def test_zero_query_and_all_nan_distances_match_original(self):
        self.compare("ARRAY['style_group']",None,0)
        self.compare("ARRAY['style_group']",0,1,"BEGIN; DELETE FROM dam.search_group_vectors WHERE embedding OPERATOR(extensions.<>) "+vector(None)+";")

    def test_empty_and_model_mismatch_preserve_null_scores(self):
        self.compare("ARRAY['style_group']",prefix="BEGIN; DELETE FROM dam.search_group_vectors;")
        self.compare("ARRAY['style_group']",prefix="BEGIN; UPDATE dam.search_group_vectors SET embedding_model='other';")
        self.compare('NULL',prefix="BEGIN; DELETE FROM public.dam_search_documents;")

    def test_false_permission_prevents_both_data_legs(self):
        self.compare("ARRAY['style_group']",prefix="BEGIN; SET LOCAL test.dam_access='false';")
        self.compare('NULL',prefix="BEGIN; SET LOCAL test.dam_access='false';")

    def test_exact_old_source_owner_acl_and_settings_unchanged(self):
        after=self.sql("SELECT json_build_array(prosrc,proacl::text,proowner::text,proconfig) FROM pg_proc WHERE oid='public.dam_search_semantic_anchor(extensions.vector,text[])'::regprocedure").stdout
        self.assertEqual(after,self.old_before)

    def test_invalid_dimensions_and_null_first_raise_22023(self):
        for first,second in [('NULL',vector(0)),("'[1,0]'::extensions.vector",'NULL'),(vector(0),"'[1,0]'::extensions.vector")]:
            r=self.sql("\\set VERBOSITY verbose\nSELECT * FROM public.dam_search_semantic_anchors("+first+','+second+",ARRAY['style_group'])",False)
            self.assertNotEqual(r.returncode,0);self.assertIn('22023',r.stderr)

    def test_same_authenticated_service_acl_and_denied_access(self):
        for role in ['authenticated','service_role']:
            self.sql('SET ROLE '+role+'; SELECT * FROM public.dam_search_semantic_anchors('+vector(0)+",NULL,ARRAY['style_group'])")
        r=self.sql('SET ROLE anon; SELECT * FROM public.dam_search_semantic_anchors('+vector(0)+',NULL,NULL)',False)
        self.assertNotEqual(r.returncode,0);self.assertIn('permission denied for function',r.stderr)
        r=self.sql("SET ROLE authenticated; SET test.dam_access='deny'; SELECT * FROM public.dam_search_semantic_anchors("+vector(0)+',NULL,NULL)',False)
        self.assertNotEqual(r.returncode,0);self.assertIn('DAM access denied',r.stderr)

    def test_permission_once_and_actual_one_dense_plan(self):
        self.sql('ALTER SEQUENCE public.permission_calls RESTART WITH 1')
        query="LOAD 'auto_explain';SET client_min_messages=log;SET auto_explain.log_min_duration=0;SET auto_explain.log_nested_statements=on;SET auto_explain.log_analyze=on;SET auto_explain.log_format=json;SELECT * FROM public.dam_search_semantic_anchors("+vector(0)+','+vector(1)+",ARRAY['style_group'])"
        result=self.sql(query);decoder=json.JSONDecoder();plans=[]
        for match in re.finditer(r'\{',result.stderr):
            try:value,_=decoder.raw_decode(result.stderr[match.start():])
            except json.JSONDecodeError:continue
            if isinstance(value,dict)and'Plan'in value:plans.append(value['Plan'])
        def nodes(plan):
            yield plan
            for child in plan.get('Plans',[]):yield from nodes(child)
        dense=[p for plan in plans for p in nodes(plan)if p.get('Relation Name')=='search_group_vectors']
        self.assertEqual(len(dense),1,result.stderr[-1500:]);self.assertEqual(dense[0]['Actual Loops'],1)
        public=[p for plan in plans for p in nodes(plan)if p.get('Relation Name')=='dam_search_documents']
        self.assertTrue(all(p['Actual Loops']==0 for p in public))
        self.assertEqual(self.sql('SELECT last_value FROM public.permission_calls').stdout.strip(),'1')
        evidence=os.environ.get('DAM_BATCH_ANCHOR_EVIDENCE')
        if evidence:
            receipt={'migration_sha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),'dense_nodes':len(dense),'dense_actual_loops':dense[0]['Actual Loops'],'permission_calls':1,'ann_actual_loops':[p['Actual Loops'] for p in public],'synthetic_nested_plans':plans}
            fd=os.open(evidence,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as output:json.dump(receipt,output)


    def test_installed_contract_and_acl_security_mutations(self):
        contract=(ROOT/'supabase/tests/dam_batched_semantic_anchors_contracts.sql').read_text()
        self.sql(contract)
        for mutation in ["ALTER FUNCTION public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[]) SECURITY INVOKER", "GRANT EXECUTE ON FUNCTION public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[]) TO anon", "ALTER FUNCTION public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[]) SET statement_timeout='6s'"]:
            r=self.sql('BEGIN;'+mutation+';'+contract,False)
            self.assertNotEqual(r.returncode,0)
            self.assertIn('#5703 installed',r.stderr)

    def test_outer_existing_five_second_budget_cancels_blocked_batch(self):
        locker=subprocess.Popen(['docker','exec','-i',self.container,'psql','-X','-At','-q','-v','ON_ERROR_STOP=1','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            locker.stdin.write("BEGIN;LOCK dam.search_group_vectors IN ACCESS EXCLUSIVE MODE;SELECT 'lock-ready';\n");locker.stdin.flush()
            ready=selectors.DefaultSelector();buffer=b'';deadline=time.monotonic()+3
            try:
                os.set_blocking(locker.stdout.fileno(),False)
                ready.register(locker.stdout,selectors.EVENT_READ)
                while b'\n' not in buffer:
                    remaining=deadline-time.monotonic()
                    if remaining<=0 or not ready.select(timeout=remaining):self.fail('owned lock readiness deadline expired')
                    chunk=os.read(locker.stdout.fileno(),4096)
                    if not chunk:self.fail('owned locker exited before readiness')
                    buffer+=chunk
                self.assertEqual(buffer.split(b'\n',1)[0],b'lock-ready')
            finally:ready.close()
            r=self.sql("SET statement_timeout='5s';SELECT * FROM public.dam_search_semantic_anchors("+vector(0)+','+vector(1)+",ARRAY['style_group'])",False)
            self.assertNotEqual(r.returncode,0);self.assertIn('canceling statement due to statement timeout',r.stderr)
        finally:
            try:locker.stdin.write('ROLLBACK;\n');locker.stdin.flush()
            finally:locker.stdin.close()
            try:locker.wait(timeout=5)
            except subprocess.TimeoutExpired:locker.kill();locker.wait(timeout=2)
            locker.stdout.close();locker.stderr.close()

if __name__=='__main__':unittest.main()
