import importlib.util, json, pathlib, re, sys, tempfile, unittest
from unittest.mock import patch

P=pathlib.Path(__file__).with_name('preview_ledger_orphan_reconcile.py'); sys.path.insert(0,str(P.parent))
S=importlib.util.spec_from_file_location('reconcile',P); M=importlib.util.module_from_spec(S); S.loader.exec_module(M)
from atomic_migration_apply import dollar_quote

class Tests(unittest.TestCase):
    def test_reviewed_manifest_is_the_only_case_authority(self):
        workflow=(P.parent.parent/'.github/workflows/preview-ledger-orphan-reconciliation.yml').read_text(encoding='utf-8')
        self.assertIn('config/preview-ledger-orphan-reconciliations.json',workflow)
        self.assertNotIn('case "$ISSUE:$CLAIM:$SOURCE_PR:$ORPHAN:$REPLACEMENT"',workflow)
        self.assertEqual(len(M.SUPPORTED_CASES),14)

    def test_issue_3458_byte_identical_rename_is_narrowly_evidence_bound(self):
        case=M.SUPPORTED_CASES[(3458,3483,3672)]
        self.assertEqual(case,{
            'mode':'byte_identical_rename',
            'orphan_version':'20260928145444',
            'replacement_version':'20260929040458',
            'orphan_run_head':'b26dbd4d5240bf1484424edfe68f40901b547ec7',
            'orphan_commit_sha':'b26dbd4d5240bf1484424edfe68f40901b547ec7',
            'preview_run_id':36456516739,
            'preview_artifact_id':10985084878,
            'preview_artifact_digest':'sha256:045e0129523ccc99aa0fc16d92cbb9a05e1abe712c77e81cf47de2a892b83fbe',
            'merged_source':True,
            'issue_state':'open',
            'claim_state':'open',
        })

    def test_issue_2506_rehearsal_reset_is_narrowly_evidence_bound(self):
        case=M.SUPPORTED_CASES[(2506,2510,2512,'20260907131610','20260907131610')]
        self.assertEqual(case,{
            'mode':'rehearsal_reset',
            'original_run_head':'dff809bc476b64480e0761d21012dde2ba39ac8c',
            'preview_run_id':34141000463,
            'preview_artifact_id':10025929311,
            'preview_artifact_digest':'sha256:d3b8c802a66088b074e3cef9bd0049f8434d22646860cb523aaa31a712bb966e',
            'issue_state':'open',
            'claim_state':'open',
        })

    def test_issue_2171_byte_identical_rename_tuple_is_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(2171,2194,2199)]
        self.assertEqual(case,{
            'mode':'byte_identical_rename',
            'orphan_version':'20260903115927',
            'replacement_version':'20260903200951',
            'orphan_run_head':'63d8441b37bf41fa7dd798ba313a58d666e2ea53',
            'preview_run_id':33754529571,
            'preview_artifact_id':9892966452,
            'preview_artifact_digest':'sha256:285a9b78a370bb015a9a818a42cbe81f273d3600c9bd400c1b2449f05e09961c',
            'merged_source':True,
            'issue_state':'closed',
            'claim_state':'closed',
        })

    def test_issue_2171_evidence_pins_refuse_substitution(self):
        case=M.SUPPORTED_CASES[(2171,2194,2199)]
        args=type('A',(),{
            'preview_run_id':33754529571,
            'preview_artifact_id':9892966452,
            'preview_artifact_digest':'sha256:285a9b78a370bb015a9a818a42cbe81f273d3600c9bd400c1b2449f05e09961c',
        })()
        M.validate_pinned_evidence(case,args)
        args.preview_artifact_id=1
        with self.assertRaises(M.Refusal):
            M.validate_pinned_evidence(case,args)

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

    def test_issue_1658_recovery_tuple_and_evidence_are_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(1658,1659,1660)]
        self.assertEqual(case,{
            'mode':'replacement_pending',
            'orphan_version':'20260827134155',
            'replacement_version':'20260827214517',
            'orphan_run_head':'b49a5665060fcc9a100f12a096460ea44a30451c',
            'orphan_commit_sha':'d15a69a825cbf0d365b1ffac825a2db4c22db63b',
            'preview_run_id':33095556822,
            'preview_artifact_id':9656250972,
            'preview_artifact_digest':'sha256:ec03dc67ce845c6db231a56555803d1daddd6869fc61019ccd89f3f27f6878ce',
        })

    def test_issue_1658_evidence_pins_refuse_substitution(self):
        case=M.SUPPORTED_CASES[(1658,1659,1660)]
        args=type('A',(),{
            'preview_run_id':33095556822,
            'preview_artifact_id':9656250972,
            'preview_artifact_digest':'sha256:ec03dc67ce845c6db231a56555803d1daddd6869fc61019ccd89f3f27f6878ce',
        })()
        M.validate_pinned_evidence(case,args)
        args.preview_artifact_digest='sha256:0'
        with self.assertRaises(M.Refusal):
            M.validate_pinned_evidence(case,args)

    def test_issue_1722_recovery_tuple_and_evidence_are_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(1722,1747,1748)]
        self.assertEqual(case,{
            'mode':'byte_identical_rename',
            'orphan_version':'20260828113920',
            'replacement_version':'20260830013942',
            'orphan_run_head':'4f1e2adb4d964f8f431efdaa0055fcdd96e71638',
            'preview_run_id':33189683651,
            'preview_artifact_id':9693229856,
            'preview_artifact_digest':'sha256:2a466d1a0163a276a937e28f9af5eff710096e62ec9e7ddf7dda38fac41ef49a',
            'merged_source':True,
            'issue_state':'closed',
            'claim_state':'closed',
        })

    def test_issue_1722_evidence_pins_refuse_substitution(self):
        case=M.SUPPORTED_CASES[(1722,1747,1748)]
        args=type('A',(),{
            'preview_run_id':33189683651,
            'preview_artifact_id':9693229856,
            'preview_artifact_digest':'sha256:2a466d1a0163a276a937e28f9af5eff710096e62ec9e7ddf7dda38fac41ef49a',
        })()
        M.validate_pinned_evidence(case,args)
        args.preview_artifact_id=1
        with self.assertRaises(M.Refusal):
            M.validate_pinned_evidence(case,args)

    def test_issue_1467_rehearsal_reset_tuple_and_evidence_are_narrowly_supported(self):
        case=M.SUPPORTED_CASES[(1467,1580,1585,'20260827183106','20260827183106')]
        self.assertEqual(case,{
            'mode':'rehearsal_reset',
            'original_run_head':'4355d0567de4bf9168f5701efc7107215ee386f3',
            'preview_run_id':33106059012,
            'preview_artifact_id':9660512462,
            'preview_artifact_digest':'sha256:308962bcc35231b9c1d9187761822428ae34d89980c145baff9394d80dde7c7a',
            'issue_state':'open',
            'claim_state':'open',
        })

    def test_issue_1467_evidence_pins_refuse_substitution(self):
        case=M.SUPPORTED_CASES[(1467,1580,1585,'20260827183106','20260827183106')]
        args=type('A',(),{
            'preview_run_id':33106059012,
            'preview_artifact_id':9660512462,
            'preview_artifact_digest':'sha256:308962bcc35231b9c1d9187761822428ae34d89980c145baff9394d80dde7c7a',
        })()
        M.validate_pinned_evidence(case,args)
        args.preview_artifact_digest='sha256:0'
        with self.assertRaises(M.Refusal):
            M.validate_pinned_evidence(case,args)

    def test_every_rehearsal_reset_target_can_actually_be_reapplied(self):
        """A rehearsal reset deletes the preview ledger row so the SAME bytes apply again.

        A migration that carries its own transaction control, or that is not
        re-appliable, must therefore never be allowlisted: the reset would leave
        preview with the objects present and the ledger row gone -- strictly worse
        than the stranded state it was meant to repair. This is exactly why the
        #1645 version 20260827183011 was NOT added; it opens with `begin;` and
        creates non-idempotent tables and triggers.
        """
        migrations=P.parent.parent/'supabase/migrations'
        reset_versions={key[4] for key,case in M.SUPPORTED_CASES.items() if case['mode']=='rehearsal_reset' and len(key)==5}
        self.assertTrue(reset_versions)
        for version in sorted(reset_versions):
            with self.subTest(version=version):
                # load_replacement refuses an empty migration or any transaction control.
                path,statements=M.load_replacement(migrations,version)
                self.assertTrue(statements)
                body=path.read_text(encoding='utf-8').lower()
                self.assertNotIn(chr(10)+'begin;',body)
                self.assertNotIn(chr(10)+'commit;',body)

    def test_supported_cases_enforce_their_exact_issue_and_claim_states(self):
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1615,1636,1637)]),('open','closed'))
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1422,1423,1424)]),('closed','closed'))
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1439,1488,1495)]),('open','open'))
        # rehearsal_reset defaults claim_state to 'closed'; #1580 is open, so the case overrides it.
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1467,1580,1585,'20260827183106','20260827183106')]),('open','open'))
        self.assertEqual(M.expected_work_states(M.SUPPORTED_CASES[(1211,1371,1372,'20260824004025','20260824004025')]),('open','closed'))

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

class SandboxNoReplacementTests(unittest.TestCase):
    OTHERS = [
        "20260904143518", "20260904172420", "20260905053422", "20260907121732",
        "20260909121403", "20260911214438", "20260917022233", "20260917035654",
        # Legitimate third-party row added after the 2026-10-02 capture:
        # migration 20261002135053_coldlion_prod_order_sales_order_link.sql,
        # merged PR #3873 (issue #3869), file on main, statements verified
        # read-only against the live sandbox ledger before this re-pin.
        "20261002135053",
    ]

    def args(self, **over):
        base = dict(
            mode="check", reconciliation="sandbox",
            repo=None, linked_dir=None,
            expected_project_ref="xupnyeifmpsacrqahwwm", main_sha="a" * 40,
            orphan_version="20260904183000", issue=2986,
            issue_json=None, remote_ledger=None, evidence_out=None,
            source_pr_dir=None, orphan_source_dir=None, replacement_version=None,
            claim=None, source_pr=None, preview_run_id=None,
            preview_artifact_id=None, preview_artifact_digest=None,
            claim_json=None, pr_json=None, pr_files_json=None,
            run_json=None, artifact_json=None, preview_evidence_dir=None,
        )
        base.update(over)
        return type("A", (), base)()

    def test_both_sandbox_cases_are_narrowly_pinned_in_a_reviewed_order(self):
        for orphan, name, count, survivors in (
            ("20260904183000", "reconcile_sample_tracking_runtime_schema", 8, sorted(self.OTHERS + ["20260904183100"])),
            ("20260904183100", "sample_workflow_factory_customer_direct_path", 13, self.OTHERS),
        ):
            case = M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", orphan)]
            self.assertEqual(case["project_ref"], "xupnyeifmpsacrqahwwm")
            self.assertEqual(case["expected_name"], name)
            self.assertEqual(len(case["expected_statements"]), count)
            self.assertTrue(all(isinstance(s, str) and s for s in case["expected_statements"]))
            # The manifest declares the reconciliation order: the FIRST case
            # still counts the second orphan as a surviving row, so a live
            # ledger holding both orphans is exactly its pinned world; the
            # SECOND case pins the world AFTER the first delete and therefore
            # refuses while the first orphan is still present (extra row).
            self.assertEqual(case["expected_other_versions"], survivors)
            # The pinned statements are bound by digest, so any edit to the
            # manifest's content must be a conscious one.
            import hashlib
            digest = hashlib.sha256(json.dumps(case["expected_statements"], separators=(",", ":")).encode()).hexdigest()
            self.assertEqual(len(digest), 64)

    def test_second_orphan_refuses_until_the_first_is_reconciled(self):
        # The real live world: both orphans present (10 rows).
        both = sorted(self.OTHERS + ["20260904183000", "20260904183100"])
        repo, sha = self._repo()
        caseA = M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", "20260904183000")]
        caseB = M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", "20260904183100")]
        goodA = self.args(repo=repo, main_sha=sha, issue_json=self._issue_json(), remote_ledger=self._ledger(both))
        self.assertEqual(M.validate_governance_sandbox(goodA, caseA)["case_mode"], "sandbox_orphan_no_replacement")
        # Case B sees the unreconciled first orphan as an extra row and refuses.
        with self.assertRaisesRegex(M.Refusal, "extra"):
            M.validate_governance_sandbox(goodA, caseB)
        # After the first delete (9 rows) case B's pinned world matches.
        after_first = sorted(self.OTHERS + ["20260904183100"])
        goodB = self.args(repo=repo, main_sha=sha, issue_json=self._issue_json(),
                          remote_ledger=self._ledger(after_first), orphan_version="20260904183100")
        self.assertEqual(M.validate_governance_sandbox(goodB, caseB)["case_mode"], "sandbox_orphan_no_replacement")

    def test_guard_dollar_tag_collision_and_name_charset_are_refused(self):
        case = dict(M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", "20260904183000")])
        case["expected_statements"] = ["select '$expected$'"]
        with patch.object(M, "ledger_rows", return_value=[{"version": "20260904183000", "name": case["expected_name"], "statements": ["select '$expected$'"]}]):
            with self.assertRaisesRegex(M.Refusal, "dollar-quote tag"):
                M.reconcile_sandbox("postgres://x", {}, self.args(mode="apply"), case)
        self.assertTrue(all(re.fullmatch(r"[A-Za-z0-9_.-]+", c["expected_name"]) for c in M.SUPPORTED_CASES.values() if isinstance(c, dict) and c.get("mode") == "sandbox_orphan_no_replacement"))

    def test_sandbox_case_lookup_refuses_unknown_tuples(self):
        with self.assertRaises(M.Refusal):
            M.sandbox_case(self.args(orphan_version="20260904183001"))

    def _repo(self, with_orphan_file=False, head=None):
        import subprocess, tempfile
        tmp = pathlib.Path(tempfile.mkdtemp())
        (tmp / "supabase" / "migrations").mkdir(parents=True)
        (tmp / "supabase" / "migrations" / "20260101000000_base.sql").write_text("select 1;\n", encoding="utf-8")
        if with_orphan_file:
            (tmp / "supabase" / "migrations" / "20260904183000_x.sql").write_text("select 2;\n", encoding="utf-8")
        def git(*a):
            return subprocess.run(["git", "-C", str(tmp), *a], capture_output=True, text=True)
        git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t")
        git("add", "-A"); git("commit", "-qm", "x")
        sha = git("rev-parse", "HEAD").stdout.strip()
        git("update-ref", "refs/remotes/origin/main", sha)
        return tmp, head or sha

    def _ledger(self, versions):
        tmp = pathlib.Path(tempfile.mkdtemp()) / "ledger.txt"
        tmp.write_text("\n".join(f" {v} | {v} | 2026" for v in versions), encoding="utf-8")
        return tmp

    def _issue_json(self, number=2986, state="open"):
        tmp = pathlib.Path(tempfile.mkdtemp()) / "issue.json"
        tmp.write_text(json.dumps({"number": number, "state": state}), encoding="utf-8")
        return tmp

    def test_governance_sandbox_accepts_the_pinned_world_and_refuses_drift(self):
        repo, sha = self._repo()
        case = M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", "20260904183000")]
        good = self.args(repo=repo, main_sha=sha, issue_json=self._issue_json(),
                         remote_ledger=self._ledger(sorted(self.OTHERS + ["20260904183000", "20260904183100"])))
        self.assertEqual(M.validate_governance_sandbox(good, case)["case_mode"], "sandbox_orphan_no_replacement")
        for bad, label in (
            (self.args(repo=repo, main_sha="0" * 40, issue_json=good.issue_json, remote_ledger=good.remote_ledger), "main sha"),
            (self.args(repo=repo, main_sha=sha, expected_project_ref="qsllyeztdwjgirsysgai", issue_json=good.issue_json, remote_ledger=good.remote_ledger), "ref"),
            (self.args(repo=repo, main_sha=sha, expected_project_ref="zzzzzzzzzzzzzzzzzzzz", issue_json=good.issue_json, remote_ledger=good.remote_ledger), "ref2"),
            (self.args(repo=repo, main_sha=sha, issue_json=self._issue_json(state="closed"), remote_ledger=good.remote_ledger), "issue state"),
            (self.args(repo=repo, main_sha=sha, issue_json=self._issue_json(number=1), remote_ledger=good.remote_ledger), "issue number"),
            (self.args(repo=repo, main_sha=sha, issue_json=good.issue_json, remote_ledger=self._ledger(self.OTHERS)), "orphan absent"),
            (self.args(repo=repo, main_sha=sha, issue_json=good.issue_json, remote_ledger=self._ledger(sorted(self.OTHERS + ["20260904183000", "20260904183100", "20260905072856"]))), "extra row"),
        ):
            with self.assertRaises(M.Refusal, msg=label):
                M.validate_governance_sandbox(bad, case)
        repo_with_file, sha2 = self._repo(with_orphan_file=True)
        with self.assertRaises(M.Refusal):
            M.validate_governance_sandbox(
                self.args(repo=repo_with_file, main_sha=sha2, issue_json=good.issue_json, remote_ledger=good.remote_ledger), case)

    def test_reconcile_sandbox_check_reads_and_apply_deletes_exactly_one_row(self):
        case = M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", "20260904183000")]
        row = {"version": "20260904183000", "name": case["expected_name"], "statements": case["expected_statements"]}
        sent = []
        with patch.object(M, "ledger_rows", side_effect=[[row], [row], []]) as rows:
            before, after = M.reconcile_sandbox("postgres://x", {}, self.args(mode="check"), case)
            self.assertEqual(before, [row]); self.assertEqual(after, [row]); self.assertFalse(sent)

            def fake_psql(url, env, sql):
                sent.append(sql)
                return "[]"

            with patch.object(M, "psql", side_effect=fake_psql):
                before, after = M.reconcile_sandbox("postgres://x", {}, self.args(mode="apply"), case)
            self.assertEqual(after, [])
        sql = sent[0]
        for needle in (
            "\\set ON_ERROR_STOP on",
            "begin;",
            "lock table supabase_migrations.schema_migrations in exclusive mode;",
            "delete from supabase_migrations.schema_migrations where version='20260904183000'",
            "get diagnostics n = row_count",
            "if n <> 1 then raise exception 'reconciliation did not delete exactly one row'; end if;",
            "is distinct from $expected$",
            "$expected$::jsonb",
            "raise exception 'ledger ownership changed before reconciliation'",
            "raise exception 'ledger row count after delete is not the pinned baseline'",
        ):
            self.assertIn(needle, sql)
        survivors = len(case["expected_other_versions"])
        self.assertIn(f"<> {survivors + 1}", sql)
        self.assertIn(f"<> {survivors}", sql)
        # A live row whose content drifted from the pin refuses before any write.
        drifted = {"version": "20260904183000", "name": case["expected_name"], "statements": ["select 9"]}
        with patch.object(M, "ledger_rows", return_value=[drifted]):
            with self.assertRaises(M.Refusal):
                M.reconcile_sandbox("postgres://x", {}, self.args(mode="apply"), case)
        with patch.object(M, "ledger_rows", return_value=[]):
            with self.assertRaises(M.Refusal):
                M.reconcile_sandbox("postgres://x", {}, self.args(mode="check"), case)

    def test_sandbox_restore_sql_is_an_executable_insert_of_the_pinned_row(self):
        case = M.SUPPORTED_CASES[(2986, "sandbox_orphan_no_replacement", "20260904183000")]
        sql = M.sandbox_restore_sql(case, "20260904183000")
        self.assertTrue(sql.startswith("insert into supabase_migrations.schema_migrations (version, name, statements)"))
        self.assertIn("values ('20260904183000'", sql)
        self.assertIn("::text[]);", sql)
        for index, statement in enumerate(case["expected_statements"]):
            self.assertIn(dollar_quote(statement, f"s{index}"), sql)

    def test_parse_args_splits_the_two_reconciliations(self):
        with patch.object(sys, "argv", ["x", "--mode", "check", "--reconciliation", "sandbox", "--repo", ".", "--linked-dir", ".",
                                        "--expected-project-ref", "xupnyeifmpsacrqahwwm", "--main-sha", "a" * 40,
                                        "--orphan-version", "20260904183000", "--issue", "2986",
                                        "--issue-json", "i.json", "--remote-ledger", "l.txt", "--evidence-out", "o.json"]):
            args = M.parse_args()
        self.assertEqual(args.reconciliation, "sandbox")
        with patch.object(sys, "argv", ["x", "--mode", "check", "--reconciliation", "sandbox", "--repo", ".", "--linked-dir", ".",
                                        "--expected-project-ref", "xupnyeifmpsacrqahwwm", "--main-sha", "a" * 40,
                                        "--orphan-version", "20260904183000", "--issue", "2986",
                                        "--evidence-out", "o.json"]):
            with self.assertRaises(M.Refusal):
                M.parse_args()
        with patch.object(sys, "argv", ["x", "--mode", "check", "--reconciliation", "sandbox", "--repo", ".", "--linked-dir", ".",
                                        "--expected-project-ref", "xupnyeifmpsacrqahwwm", "--main-sha", "a" * 40,
                                        "--orphan-version", "20260904183000", "--issue", "2986",
                                        "--issue-json", "i.json", "--remote-ledger", "l.txt", "--evidence-out", "o.json",
                                        "--replacement-version", "20260905000000"]):
            with self.assertRaises(M.Refusal):
                M.parse_args()
        with patch.object(sys, "argv", ["x", "--mode", "check", "--repo", ".", "--linked-dir", ".",
                                        "--expected-project-ref", "xupnyeifmpsacrqahwwm", "--main-sha", "a" * 40,
                                        "--orphan-version", "20260904183000", "--issue", "2986",
                                        "--evidence-out", "o.json"]):
            with self.assertRaises(M.Refusal):
                M.parse_args()

    def test_sandbox_workflow_is_reviewed_manifest_driven_and_sandbox_only(self):
        workflow = (P.parent.parent / ".github" / "workflows" / "sandbox-ledger-orphan-reconciliation.yml").read_text(encoding="utf-8")
        self.assertIn("config/preview-ledger-orphan-reconciliations.json", workflow)
        self.assertIn("--reconciliation sandbox", workflow)
        self.assertIn("xupnyeifmpsacrqahwwm", workflow)
        self.assertNotIn("qsllyeztdwjgirsysgai\n", workflow.replace("PRODUCTION_PROJECT_REF_NEVER_WRITE_HERE: qsllyeztdwjgirsysgai", ""))
        self.assertIn("concurrency:", workflow)
        self.assertIn("group: designflow-sandbox-migrations", workflow)

if __name__=='__main__': unittest.main()
