"""Disposable PostgreSQL rollback proof for preview ledger reconciliation."""
import os, pathlib, subprocess, sys, unittest

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

if __name__=='__main__': unittest.main()
