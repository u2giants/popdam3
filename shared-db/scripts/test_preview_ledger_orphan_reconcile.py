import importlib.util, pathlib, sys, tempfile, unittest
from unittest.mock import patch

P=pathlib.Path(__file__).with_name('preview_ledger_orphan_reconcile.py'); sys.path.insert(0,str(P.parent))
S=importlib.util.spec_from_file_location('reconcile',P); M=importlib.util.module_from_spec(S); S.loader.exec_module(M)

class Tests(unittest.TestCase):
    def test_version_is_exact(self):
        self.assertEqual(M.version('20260817150944'),'20260817150944')
        for bad in ('', '123', '2026081715094x', '202608171509440'):
            with self.assertRaises(M.Refusal): M.version(bad)

    def test_issue_1439_recovery_tuple_is_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(1439,1488,1495)]
        self.assertEqual(case,{
            'mode':'replacement_pending',
            'orphan_version':'20260825102716',
            'replacement_version':'20260825110813',
            'orphan_run_head':'8db5074d814118311269d0d3ac04eb2f3ad40928',
        })
        workflow=(P.parent.parent/'.github/workflows/preview-ledger-orphan-reconciliation.yml').read_text(encoding='utf-8')
        self.assertIn('1439:1488:1495:20260825102716:20260825110813) ;;',workflow)

    def test_issue_1422_recovery_tuple_and_evidence_are_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(1422,1423,1424)]
        self.assertEqual(case,{
            'mode':'replacement_pending',
            'orphan_version':'20260824150630',
            'replacement_version':'20260824172136',
            'orphan_run_head':'12f104735379881e6ff90a00b090a65ab9e8d370',
            'preview_run_id':32746510664,
            'preview_artifact_id':9527303479,
            'preview_artifact_digest':'sha256:a2b4cf00749dc7ee7d8db10290650612c63fd5d15ed5e9c3ae6f60d7b58c3be2',
            'merged_source':True,
        })
        workflow=(P.parent.parent/'.github/workflows/preview-ledger-orphan-reconciliation.yml').read_text(encoding='utf-8')
        self.assertIn('1422:1423:1424:20260824150630:20260824172136) ;;',workflow)

    def test_issue_1422_evidence_pins_refuse_substitution(self):
        case=M.SUPPORTED_CASES[(1422,1423,1424)]
        args=type('A',(),{
            'preview_run_id':32746510664,
            'preview_artifact_id':9527303479,
            'preview_artifact_digest':'sha256:a2b4cf00749dc7ee7d8db10290650612c63fd5d15ed5e9c3ae6f60d7b58c3be2',
        })()
        M.validate_pinned_evidence(case,args)
        args.preview_artifact_id=1
        with self.assertRaises(M.Refusal):
            M.validate_pinned_evidence(case,args)

    def test_issue_1615_recovery_tuple_and_evidence_are_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(1615,1636,1637)]
        self.assertEqual(case,{
            'mode':'byte_identical_rename',
            'orphan_version':'20260827031236',
            'replacement_version':'20260827095753',
            'orphan_run_head':'9f0753c89d3bf1e64b52877400098f3cd086a9ea',
            'preview_run_id':33059235415,
            'preview_artifact_id':9640989399,
            'preview_artifact_digest':'sha256:d41f5cc6250eb783b4e17399e3927cd9ada32ac26a12adcc8124a1f5d3262d03',
            'merged_source':True,
            'issue_state':'open',
            'claim_state':'closed',
        })
        workflow=(P.parent.parent/'.github/workflows/preview-ledger-orphan-reconciliation.yml').read_text(encoding='utf-8')
        self.assertIn('1615:1636:1637:20260827031236:20260827095753) ;;',workflow)

    def test_issue_1615_evidence_pins_refuse_substitution(self):
        case=M.SUPPORTED_CASES[(1615,1636,1637)]
        args=type('A',(),{
            'preview_run_id':33059235415,
            'preview_artifact_id':9640989399,
            'preview_artifact_digest':'sha256:d41f5cc6250eb783b4e17399e3927cd9ada32ac26a12adcc8124a1f5d3262d03',
        })()
        M.validate_pinned_evidence(case,args)
        args.preview_run_id=1
        with self.assertRaises(M.Refusal):
            M.validate_pinned_evidence(case,args)

    def test_supported_cases_enforce_their_exact_issue_and_claim_states(self):
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1615,1636,1637)]),('open','closed'))
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1422,1423,1424)]),('closed','closed'))
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1439,1488,1495)]),('open','open'))

    def test_byte_identical_rename_refuses_different_migration_statements(self):
        case=M.SUPPORTED_CASES[(1615,1636,1637)]
        M.assert_case_statement_contract(case,['select 1'],['select 1'])
        with self.assertRaises(M.Refusal):
            M.assert_case_statement_contract(case,['select 1'],['select 2'])

    def test_byte_identical_rename_updates_only_the_exact_ledger_row(self):
        args=type('A',(),{
            'orphan_version':'20260827031236',
            'replacement_version':'20260827095753',
            'replacement_migration':pathlib.Path('20260827095753_crm_update_customer_clear_domain.sql'),
            'mode':'apply',
        })()
        before=[{'version':args.orphan_version,'name':'crm_update_customer_clear_domain','statements':['select 1']}]
        after=[{'version':args.replacement_version,'name':'crm_update_customer_clear_domain','statements':['select 1']}]
        with patch.object(M,'ledger_rows',side_effect=[before,after]), patch.object(M,'psql',return_value='') as execute:
            self.assertEqual(M.reconcile('url',{},args,['select 1'],['select 1'],'byte_identical_rename'),(before,after))
            sql=execute.call_args.args[2]
            self.assertIn(f"set version='{args.replacement_version}'",sql)
            self.assertIn(f"where version='{args.orphan_version}'",sql)
            self.assertIn('is distinct from',sql)
            self.assertNotIn('delete from supabase_migrations.schema_migrations',sql)
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

    def test_same_version_rehearsal_reset_removes_only_exact_row(self):
        args=type('A',(),{'orphan_version':'20260824004025','replacement_version':'20260824004025','mode':'apply'})()
        before=[{'version':'20260824004025','statements':['exact definition']}]
        with patch.object(M,'ledger_rows',side_effect=[before,[]]), patch.object(M,'psql',return_value='') as execute:
            self.assertEqual(M.reconcile('url',{},args,['exact definition'],['exact definition'],'rehearsal_reset'),(before,[]))
            sql=execute.call_args.args[2]
            self.assertIn("delete from supabase_migrations.schema_migrations where version='20260824004025'",sql)

    def test_same_version_rehearsal_reset_refuses_nonmatching_ledger_bytes(self):
        args=type('A',(),{'orphan_version':'20260824004025','replacement_version':'20260824004025','mode':'check'})()
        with patch.object(M,'ledger_rows',return_value=[{'version':'20260824004025','statements':['different']} ]):
            with self.assertRaises(M.Refusal):
                M.reconcile('url',{},args,['exact definition'],['exact definition'],'rehearsal_reset')

if __name__=='__main__': unittest.main()
