#!/usr/bin/env python3
"""Issue #4761: `alter function ... set|reset` is derived and checked."""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import build_catalog_sql, derive_targets, render_report  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
VERSION = "20261025121119"
FAMILY = "public.search_style_guide_library_v2"
SIGNATURE = FAMILY + "(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)"


def catalog(config, oid="42"):
    return {
        "functions": [{"name": FAMILY, "overloads": [
            {"identity": SIGNATURE, "oid": "42", "prokind": "f", "has_definition": True, "config": config}]}],
        "function_setting_signatures": [{"signature": SIGNATURE, "oid": oid}],
    }


class RoutineSettingTests(unittest.TestCase):
    def setUp(self):
        migrations = {p.name[:14]: p for p in (REPO / "supabase" / "migrations").glob("*.sql")}
        self.targets = derive_targets(migrations, [VERSION])

    def render(self, data):
        return render_report([VERSION], self.targets, data, None, [], True)

    def test_real_migration_is_no_longer_empty(self):
        self.assertFalse(self.targets.is_empty())
        self.assertEqual(self.targets.functions, [FAMILY])
        self.assertEqual(self.targets.function_settings, [(FAMILY, SIGNATURE, "statement_timeout", "set")])
        self.assertIn("function_setting_signatures", build_catalog_sql(self.targets))
        self.assertIn("'config'", build_catalog_sql(self.targets))

    def test_successful_install_passes(self):
        md, failures = self.render(catalog(["search_path=pg_catalog, auth", "statement_timeout=30s", "work_mem=64MB"]))
        self.assertEqual(failures, [])
        self.assertIn("Routine settings", md)

    def test_setting_missing_fails(self):
        _, failures = self.render(catalog(["search_path=pg_catalog, auth", "work_mem=64MB"]))
        self.assertTrue(any("statement_timeout" in f for f in failures))

    def test_unresolved_signature_fails(self):
        _, failures = self.render(catalog(["statement_timeout=30s"], oid=None))
        self.assertTrue(any("exactly one overload" in f for f in failures))

    def test_missing_routine_fails(self):
        _, failures = self.render({"functions": [{"name": FAMILY, "overloads": []}], "function_setting_signatures": []})
        self.assertGreaterEqual(len(failures), 2)

    def _derive(self, sql):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "20990101000000_x.sql"
            path.write_text(sql)
            return derive_targets({"20990101000000": path}, ["20990101000000"])

    def test_reset_and_last_statement_wins(self):
        targets = self._derive(
            "alter function app.f(integer) set work_mem = '1MB';\n"
            "alter function app.f(integer) reset work_mem;\n")
        self.assertEqual(targets.function_settings, [("app.f", "app.f(integer)", "work_mem", "reset")])

    def test_reset_all_requires_empty_proconfig(self):
        targets = self._derive(
            "alter function app.f(integer) set work_mem = '1MB';\n"
            "alter function app.f(integer) reset all;\n")
        self.assertEqual(targets.function_settings, [("app.f", "app.f(integer)", "all", "reset")])
        overload = {"identity": "app.f(integer)", "oid": "7", "prokind": "f", "has_definition": True}
        for config, failed in (([], False), (["work_mem=1MB"], True)):
            data = {"functions": [{"name": "app.f", "overloads": [dict(overload, config=config)]}],
                    "function_setting_signatures": [{"signature": "app.f(integer)", "oid": "7"}]}
            _, failures = render_report(["20990101000000"], targets, data, None, [], True)
            self.assertEqual(bool(failures), failed, config)

    def test_later_create_or_replace_drops_setting_expectation(self):
        targets = self._derive(
            "alter function app.f() set work_mem = '1MB';\n"
            "create or replace function app.f() returns int language sql as $$select 1$$;\n")
        self.assertEqual(targets.function_settings, [])
        self.assertEqual(targets.functions, ["app.f"])

    def test_unparseable_routine_alter_is_noted(self):
        targets = self._derive("alter function app.f(numeric(10,2)) owner to postgres;\n")
        self.assertTrue(any("not safely parseable" in n for n in targets.notes))


if __name__ == "__main__":
    unittest.main()
