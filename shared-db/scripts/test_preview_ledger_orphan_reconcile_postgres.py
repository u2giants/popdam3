"""Disposable PostgreSQL rollback proof for preview ledger reconciliation."""
import os, pathlib, subprocess, sys, unittest
from unittest.mock import patch

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import preview_ledger_orphan_reconcile as reconcile

@unittest.skipUnless(os.environ.get('PREVIEW_LEDGER_RECONCILE_POSTGRES_TEST')=='1','disposable PostgreSQL only')
class PostgresRollback(unittest.TestCase):
    old='29990301000001'; replacement='29990301000002'; statements=['select 1']
    def psql(self,sql,ok=True):
        result=subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=sql,text=True,capture_output=True)
        self.assertEqual(result.returncode==0,ok,result.stderr); return result.stdout.strip()
    def url(self):
        return f"postgresql://{os.getenv('PGUSER','postgres')}@{os.getenv('PGHOST','127.0.0.1')}:{os.getenv('PGPORT','5432')}/{os.getenv('PGDATABASE','postgres')}"
    def setUp(self):
        self.psql(f"""create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version varchar primary key, statements text[], name text);
drop trigger if exists break_reconciliation on supabase_migrations.schema_migrations;
drop function if exists public.break_reconciliation();
delete from supabase_migrations.schema_migrations where version in ('{self.old}','{self.replacement}');
insert into supabase_migrations.schema_migrations values ('{self.old}',array['select 1'],'old'),('{self.replacement}',array['select 1'],'replacement');
create function public.break_reconciliation() returns trigger language plpgsql as $$begin
  if old.version='{self.old}' then delete from supabase_migrations.schema_migrations where version='{self.replacement}'; end if;
  return old; end$$;
create trigger break_reconciliation before delete on supabase_migrations.schema_migrations for each row execute function public.break_reconciliation();""")
    def test_in_lock_failure_rolls_back_both_deletes(self):
        args=type('A',(),{'orphan_version':self.old,'replacement_version':self.replacement,'mode':'apply'})()
        with self.assertRaises(RuntimeError):
            reconcile.reconcile(self.url(),os.environ.copy(),args,self.statements,self.statements,'replacement_already_applied')
        self.assertEqual(self.psql(f"select string_agg(version,',' order by version) from supabase_migrations.schema_migrations where version in ('{self.old}','{self.replacement}')"),f'{self.old},{self.replacement}')

    def test_byte_identical_rename_rolls_back_when_statements_change_after_initial_read(self):
        self.psql(f"""drop trigger if exists break_reconciliation on supabase_migrations.schema_migrations;
delete from supabase_migrations.schema_migrations where version in ('{self.old}','{self.replacement}');
insert into supabase_migrations.schema_migrations values ('{self.old}',null,'old');""")
        args=type('A',(),{
            'orphan_version':self.old,
            'replacement_version':self.replacement,
            'replacement_migration':pathlib.Path(f'{self.replacement}_replacement.sql'),
            'mode':'apply',
        })()
        initial=[{'version':self.old,'statements':['select 1'],'name':'old'}]
        with patch.object(reconcile,'ledger_rows',return_value=initial):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.url(),os.environ.copy(),args,self.statements,self.statements,'byte_identical_rename')
        self.assertEqual(
            self.psql(f"select version from supabase_migrations.schema_migrations where version in ('{self.old}','{self.replacement}')"),
            self.old,
        )
    def test_sandbox_orphan_delete_rolls_back_when_the_row_changes_mid_transaction(self):
        orphan='29990301000003'
        case={'project_ref':'xupnyeifmpsacrqahwwm','expected_name':'sandbox_orphan','expected_statements':['select 1','select 2'],'expected_other_versions':['29990301000001']}
        args=type('A',(),{'orphan_version':orphan,'mode':'apply'})()
        self.psql(f"""drop trigger if exists break_reconciliation on supabase_migrations.schema_migrations;
drop function if exists public.break_reconciliation();
delete from supabase_migrations.schema_migrations where version in ('{orphan}','29990301000001');
insert into supabase_migrations.schema_migrations values ('29990301000001',array['keep'],'keep'),('{orphan}',array['select 1','select 2'],'sandbox_orphan');
create function public.break_reconciliation() returns trigger language plpgsql as $$begin
  if old.version='{orphan}' then update supabase_migrations.schema_migrations set statements=array['changed'] where version='{orphan}'; end if;
  return old; end$$;
create trigger break_reconciliation before delete on supabase_migrations.schema_migrations for each row execute function public.break_reconciliation();""")
        with self.assertRaises(RuntimeError):
            reconcile.reconcile_sandbox(self.url(),os.environ.copy(),args,case)
        self.assertEqual(self.psql(f"select count(*) from supabase_migrations.schema_migrations where version='{orphan}' and statements=array['select 1','select 2']"),'1')
        self.psql(f"""drop trigger if exists break_reconciliation on supabase_migrations.schema_migrations;
drop function if exists public.break_reconciliation();
delete from supabase_migrations.schema_migrations where version='{orphan}';""")


@unittest.skipUnless(os.environ.get('PREVIEW_LEDGER_RECONCILE_POSTGRES_TEST')=='1','disposable PostgreSQL only')
class ConditioningExecutionTests(unittest.TestCase):
    """Issue #2986: EXECUTED proof that the schema-conditioned bounded bytes work.

    The conditioner rewrites migration text; no textual assertion can substitute
    for running the adapted bytes against a live PostgreSQL in both schema
    states. These run in Database Contract Tests on every pull request.
    """

    LIVE_WITHOUT_DFLOW_PROD = ["api","app","auth","dflow","extensions","plm","public","storage","supabase_migrations"]
    ROOT = pathlib.Path(__file__).resolve().parents[1]

    def psql(self, sql):
        result = subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=sql,text=True,capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def migration(self, version):
        # Database Contract Tests MOVES every migration out of supabase/migrations
        # before starting the ephemeral database; look there too.
        candidates = [self.ROOT / 'supabase' / 'migrations']
        runner_temp = os.environ.get('RUNNER_TEMP')
        if runner_temp:
            candidates.append(pathlib.Path(runner_temp) / 'migrations')
        for directory in candidates:
            matches = sorted(directory.glob(f'{version}_*.sql'))
            if matches:
                return matches[0]
        raise AssertionError(f'migration {version} not found under {candidates}')

    def adapted(self, version):
        import sys
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import sandbox_migration_preflight as sp
        path = self.migration(version)
        raw = path.read_text(encoding='utf-8')
        wraps = sp.condition_plan(raw, self.LIVE_WITHOUT_DFLOW_PROD, ['dflow_prod'], version)
        return sp.apply_conditioning(raw, wraps), len(wraps)

    def test_phrase_file_applies_without_dflow_prod_and_guards_apply_once_it_exists(self):
        adapted, wraps = self.adapted('20260928182014')
        self.assertEqual(wraps, 2)
        self.psql('drop schema if exists plm cascade; drop schema if exists dflow_prod cascade; create schema plm;')
        self.psql('create table plm."itemHeader"(id int); create table plm."RFQItem"(id int);')
        self.psql(adapted)
        self.assertEqual(self.psql("select count(*) from information_schema.columns where table_schema='plm' and column_name like 'hts\_product\_phrase%'"), '6')
        # The SAME adapted bytes, once the schema exists, apply the guarded
        # statements: the guard is a live condition, not a deletion.
        self.psql('create schema dflow_prod; create table dflow_prod."itemHeader"(id int); create table dflow_prod."RFQItem"(id int);')
        self.psql(adapted)
        self.assertEqual(self.psql("select count(*) from information_schema.columns where table_schema='dflow_prod' and column_name like 'hts\_product\_phrase%'"), '6')

    def test_cutover_file_no_ops_without_dflow_prod_and_applies_with_it(self):
        adapted, wraps = self.adapted('20260917013422')
        self.assertEqual(wraps, 5)
        self.psql('drop schema if exists dflow_prod cascade;')
        self.psql(adapted)  # begin/commit pass through; every guarded statement skips
        self.assertEqual(self.psql("select count(*) from pg_namespace where nspname='dflow_prod'"), '0')
        self.psql('create schema dflow_prod; create table dflow_prod.users(id uuid); create table dflow_prod.comments(id uuid);')
        self.psql(adapted)
        self.assertEqual(self.psql("select count(*) from information_schema.columns where table_schema='dflow_prod' and column_name in ('app_profile_id','app_comment_id') and data_type='uuid' and is_nullable='YES' and column_default is null"), '2')

    @classmethod
    def setUpClass(cls):
        cls._psql('drop schema if exists plm cascade; drop schema if exists dflow_prod cascade;')

    @classmethod
    def tearDownClass(cls):
        # This job's ephemeral database is SHARED with the migration replay and
        # the contract files that follow; every schema these tests create must
        # be gone before they run, or the replay sees a plm/dflow_prod world it
        # did not build and the downstream contracts fail on our residue.
        cls._psql('drop schema if exists plm cascade; drop schema if exists dflow_prod cascade;')

    @classmethod
    def _psql(cls, sql):
        result = subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=sql,text=True,capture_output=True)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()


if __name__=='__main__': unittest.main()
