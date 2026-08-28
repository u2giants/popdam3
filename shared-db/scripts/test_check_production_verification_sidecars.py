import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from scripts.check_production_verification_sidecars import check
from scripts.production_catalog_verification import GuardError, dynamic_execution_marker_lines, DFLOW_BASELINE_INDEXES, DFLOW_BASELINE_RELATIONS, DFLOW_BASELINE_FOREIGN_KEYS, API_RLS_RELATIONS, API_REALTIME_RELATIONS, API_POLICY_GROUPS, DFLOW_SEQUENCE_TARGETS, DFLOW_SEQUENCE_CEILINGS_CONTRACT, API_RLS_REALTIME_CONTRACT, _validate_marker_reviews


class OfflineSidecarTests(unittest.TestCase):
    def test_migration_acceptance_does_not_read_sidecars_or_catalog_truth(self):
        source = (Path(__file__).parent / "production_migration_guard.py").read_text(encoding="utf-8")
        self.assertNotIn("production-verification-sidecars", source)
        self.assertNotIn("catalog-truth", source)

    def test_dflow_legacy_contract_covers_every_declared_relation_and_index(self):
        import re
        sql = next((Path(__file__).parents[1] / "supabase/migrations").glob("20260710135950*.sql")).read_text(encoding="utf-8")
        relations = {m.group(1) for m in re.finditer(r"(?im)^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|VIEW|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)", sql) if m.group(1).lower().startswith("dflow.")}
        indexes = {m.group(1).strip('"') for m in re.finditer(r"(?im)^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)", sql)}
        self.assertEqual(set(DFLOW_BASELINE_RELATIONS), relations)
        self.assertEqual(set(DFLOW_BASELINE_INDEXES), indexes)
        foreign_keys={(table,name.strip('"')) for table,name in re.findall(r'ALTER TABLE ONLY\s+(\S+)\s+ADD CONSTRAINT\s+("[^"]+"|\S+)\s+FOREIGN KEY',sql,re.I)}
        self.assertEqual(set(DFLOW_BASELINE_FOREIGN_KEYS),foreign_keys)

    def test_api_security_contract_covers_the_migration_rls_policy_and_realtime_sets(self):
        import re
        sql=next((Path(__file__).parents[1]/"supabase/migrations").glob("20260621151155*.sql")).read_text(encoding="utf-8")
        rls_block=sql[sql.index("foreach t in array array["):sql.index("create policy profile_select")]
        self.assertEqual(set(API_RLS_RELATIONS),set(re.findall(r"'([^']+)'::regclass",rls_block)))
        realtime=sql[sql.index("foreach table_name in array array["):sql.index("comment on view api.pm_product_board")]
        names={value for value in re.findall(r"'([^']+)'",realtime) if re.fullmatch(r"[a-z_]+\.[a-z_]+",value)}
        self.assertEqual(set(API_REALTIME_RELATIONS),names)
        covered={table for tables,_ in API_POLICY_GROUPS for table in tables}
        self.assertEqual(covered,set(API_RLS_RELATIONS)-{"app.profile","app.notification"})
        self.assertIn("p.roles=array['authenticated']::name[]",API_RLS_REALTIME_CONTRACT)
        self.assertIn("expected_policy.with_check",API_RLS_REALTIME_CONTRACT)

    def test_sequence_contract_covers_all_18_migration_targets_and_values(self):
        import re
        sql=next((Path(__file__).parents[1]/"supabase/migrations").glob("20260823233716*.sql")).read_text(encoding="utf-8")
        block=sql[sql.index("from (values"):sql.index(") as audited")]
        rows={(a,b,c,int(d),int(e)) for a,b,c,d,e in re.findall(r"\('([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+)::bigint\s*,\s*(\d+)::bigint\)",block)}
        self.assertEqual(set(DFLOW_SEQUENCE_TARGETS),rows)
        self.assertEqual(DFLOW_SEQUENCE_CEILINGS_CONTRACT.count("is_called then last_value + 1"),36)
        self.assertEqual(DFLOW_SEQUENCE_CEILINGS_CONTRACT.count("coalesce(max("),18)
        for sequence, table, column, floor, external in DFLOW_SEQUENCE_TARGETS:
            self.assertIn(sequence,DFLOW_SEQUENCE_CEILINGS_CONTRACT)
            self.assertIn(table,DFLOW_SEQUENCE_CEILINGS_CONTRACT)
            self.assertIn('max("%s")' % column,DFLOW_SEQUENCE_CEILINGS_CONTRACT)
            self.assertIn(str(max(floor,external)),DFLOW_SEQUENCE_CEILINGS_CONTRACT)

    def repo(self, sidecar=True, reviews=True):
        temp = tempfile.TemporaryDirectory(); root = Path(temp.name)
        migrations = root / "supabase/migrations"; migrations.mkdir(parents=True)
        store = root / "scripts/production-verification-sidecars"; store.mkdir(parents=True)
        sql = "do $$ begin execute 'create table public.x(id int)'; end $$;\n"
        migration = migrations / "20260101000000_x.sql"; migration.write_text(sql, encoding="utf-8")
        if sidecar:
            item = {"schema_version":1,"migration_version":"20260101000000","migration_sha256":hashlib.sha256(sql.encode()).hexdigest(),"checks":[]}
            if reviews: item.update(marker_schema_version=1, marker_reviews=[{"line_start":1,"line_end":1,"disposition":"no_durable_target","reason":"The synthetic object is intentionally removed before this migration commits."}])
            (store / "20260101000000.json").write_text(json.dumps(item), encoding="utf-8")
        return temp, root

    def test_detector_blanks_comments_strings_and_static_execute(self):
        sql = "-- execute x\nselect 'execute y'; grant execute on function f() to x; create trigger t after insert on x execute function f();\ndo $$ begin execute format('x'); end $$;"
        self.assertEqual(dynamic_execution_marker_lines(sql), [3])

    def test_detector_handles_escape_string_backslash_quotes_without_hiding_following_execute(self):
        sql="select E'quoted\\' execute hidden';\nexecute format('visible');\n"
        self.assertEqual(dynamic_execution_marker_lines(sql),[2])

    def test_detector_keeps_nested_block_comments_fully_blank(self):
        sql="/* outer /* inner */ execute hidden */\nexecute format('visible');\n"
        self.assertEqual(dynamic_execution_marker_lines(sql),[2])

    def test_detector_catches_quoted_dynamic_ddl_helper_names(self):
        sql='select pg_temp."apply_ddl"($ddl$create table public.x(id int)$ddl$);\n'
        self.assertEqual(dynamic_execution_marker_lines(sql),[1])

    def test_reviewed_empty_sidecar_passes(self):
        temp, root = self.repo(); self.addCleanup(temp.cleanup)
        self.assertEqual(check(root, ["20260101000000"])["status"], "OK")

    def test_missing_or_unreviewed_sidecar_fails_closed(self):
        temp, root = self.repo(sidecar=False); self.addCleanup(temp.cleanup)
        with self.assertRaises(GuardError): check(root, ["20260101000000"])
        temp2, root2 = self.repo(reviews=False); self.addCleanup(temp2.cleanup)
        with self.assertRaises(GuardError): check(root2, ["20260101000000"])

    def test_overlapping_marker_review_ranges_fail_even_between_markers(self):
        sql = "execute 'a';\nselect 1;\nexecute 'b';\n"
        item = {"marker_schema_version":1,"checks":[1],"marker_reviews":[
            {"line_start":1,"line_end":2,"disposition":"no_durable_target","reason":"This first dynamic statement creates no durable catalog object after commit."},
            {"line_start":2,"line_end":3,"disposition":"no_durable_target","reason":"This second dynamic statement creates no durable catalog object after commit."}]}
        with self.assertRaisesRegex(GuardError,"overlap"):
            _validate_marker_reviews(item,Path("fixture.json"),sql,set())

    def test_check_disposition_requires_marker_to_contract_rationale(self):
        item={"marker_schema_version":1,"checks":[1],"marker_reviews":[{"line_start":1,"line_end":1,"disposition":"checks","check_ids":["c"],"reason":"too short"}]}
        with self.assertRaisesRegex(GuardError,"rationale"):
            _validate_marker_reviews(item,Path("fixture.json"),"execute 'x';",{"c"})


if __name__ == "__main__": unittest.main()
