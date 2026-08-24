import importlib.util, pathlib, sys, tempfile, unittest
from unittest.mock import patch

P=pathlib.Path(__file__).with_name('preview_ledger_orphan_reconcile.py'); sys.path.insert(0,str(P.parent))
S=importlib.util.spec_from_file_location('reconcile',P); M=importlib.util.module_from_spec(S); S.loader.exec_module(M)

class Tests(unittest.TestCase):
    def test_version_is_exact(self):
        self.assertEqual(M.version('20260817150944'),'20260817150944')
        for bad in ('', '123', '2026081715094x', '202608171509440'):
            with self.assertRaises(M.Refusal): M.version(bad)
    def test_replacement_loader_is_unique_and_rejects_transaction_control(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory); migration=root/'20260817124545_safe.sql'; migration.write_text('select 1;\n',encoding='utf-8')
            self.assertEqual(M.load_replacement(root,'20260817124545')[1],['select 1'])
            migration.write_text('begin; select 1; commit;\n',encoding='utf-8')
            with self.assertRaises(M.Refusal): M.load_replacement(root,'20260817124545')
            migration.write_text('select 1;\n',encoding='utf-8'); (root/'20260817124545_duplicate.sql').write_text('select 2;\n',encoding='utf-8')
            with self.assertRaises(M.Refusal): M.load_replacement(root,'20260817124545')
    def test_check_requires_exact_two_rows_and_statements(self):
        args=type('A',(),{'orphan_version':'20260817150944','replacement_version':'20260817124545','mode':'check'})()
        rows=[{'version':'20260817150944','statements':['select 1']},{'version':'20260817124545','statements':['select 1']}]
        with patch.object(M,'ledger_rows',return_value=rows):
            self.assertEqual(M.reconcile('url',{},args,['select 1'],['select 1'],'replacement_already_applied'),(rows,rows))
        rows[0]['statements']=['different']
        with patch.object(M,'ledger_rows',return_value=rows):
            with self.assertRaises(M.Refusal): M.reconcile('url',{},args,['select 1'],['select 1'],'replacement_already_applied')
        duplicate=[{'version':'20260817150944','statements':['select 1']},{'version':'20260817150944','statements':['select 1']},{'version':'20260817124545','statements':['select 1']}]
        with patch.object(M,'ledger_rows',return_value=duplicate):
            with self.assertRaises(M.Refusal): M.reconcile('url',{},args,['select 1'],['select 1'],'replacement_already_applied')
    def test_apply_is_transactional_exact_delete_and_readback(self):
        args=type('A',(),{'orphan_version':'20260817150944','replacement_version':'20260817124545','mode':'apply'})()
        before=[{'version':'20260817150944','statements':['select 1']},{'version':'20260817124545','statements':['select 1']}]
        after=[{'version':'20260817124545','statements':['select 1']}]
        with patch.object(M,'ledger_rows',side_effect=[before,after]), patch.object(M,'psql',return_value='') as call:
            self.assertEqual(M.reconcile('url',{},args,['select 1'],['select 1'],'replacement_already_applied'),(before,after))
            sql=call.call_args.args[2]
            self.assertIn('begin;',sql); self.assertIn('lock table supabase_migrations.schema_migrations in exclusive mode',sql)
            self.assertIn("delete from supabase_migrations.schema_migrations where version='20260817150944'",sql)
            self.assertNotIn("delete from supabase_migrations.schema_migrations where version='20260817124545'",sql)
            self.assertIn('commit;',sql)
    def test_database_failure_stops_before_post_commit_readback(self):
        args=type('A',(),{'orphan_version':'20260817150944','replacement_version':'20260817124545','mode':'apply'})()
        before=[{'version':'20260817150944','statements':['select 1']},{'version':'20260817124545','statements':['select 1']}]
        with patch.object(M,'ledger_rows',return_value=before) as reads, patch.object(M,'psql',side_effect=RuntimeError('transaction rolled back')):
            with self.assertRaises(RuntimeError): M.reconcile('url',{},args,['select 1'],['select 1'],'replacement_already_applied')
            self.assertEqual(reads.call_count,1)
    def test_reconciliation_is_preview_only(self):
        self.assertEqual(M.version('20260817124545'),'20260817124545')
        source=P.read_text(encoding='utf-8')
        self.assertIn('args.expected_project_ref == "qsllyeztdwjgirsysgai"',source)
        self.assertNotIn('SUPABASE_DB_PASSWORD_PRODUCTION',source)

    def test_pending_replacement_removes_only_exact_orphan(self):
        args=type('A',(),{'orphan_version':'20260824002102','replacement_version':'20260824004025','mode':'apply'})()
        before=[{'version':'20260824002102','statements':['old definition']}]
        with patch.object(M,'ledger_rows',side_effect=[before,[]]), patch.object(M,'psql',return_value='') as call:
            self.assertEqual(M.reconcile('url',{},args,['old definition'],['corrected definition'],'replacement_pending'),(before,[]))
            sql=call.call_args.args[2]
            self.assertIn("delete from supabase_migrations.schema_migrations where version='20260824002102'",sql)
            self.assertNotIn("delete from supabase_migrations.schema_migrations where version='20260824004025'",sql)
            self.assertIn("<> 0",sql)

    def test_pending_replacement_refuses_wrong_orphan_bytes(self):
        args=type('A',(),{'orphan_version':'20260824002102','replacement_version':'20260824004025','mode':'check'})()
        before=[{'version':'20260824002102','statements':['unexpected']}]
        with patch.object(M,'ledger_rows',return_value=before):
            with self.assertRaises(M.Refusal):
                M.reconcile('url',{},args,['old definition'],['corrected definition'],'replacement_pending')

if __name__=='__main__': unittest.main()
