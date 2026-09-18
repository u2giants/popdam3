"""Self-service additive lane (#3199 Phase B1): tokenizer output modes.

The lane classifier consumes sql_top_level_statements in two views — the
default folded view (ALLOWLIST shapes) and the keep_dollar_quoted view
(schema-reference scanning inside routine bodies) — plus raw statement spans.
These tests pin the three properties those views must keep holding, because a
drift in either view is silently a different boundary.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import sql_top_level_statements  # noqa: E402


FUNCTION_SQL = (
    "-- header comment\n"
    "create table crm.foo (id uuid primary key, note text);\n"
    "create function crm.f() returns void language sql security invoker\n"
    "as $$ select 1 from crm.foo where note <> 'x;y' $$;\n"
    "insert into crm.foo values ('a;b');"
)


class SpansTest(unittest.TestCase):
    def test_spans_align_with_returned_statements(self):
        spans: list[tuple[int, int]] = []
        statements = sql_top_level_statements(FUNCTION_SQL, spans=spans)
        self.assertEqual(len(statements), len(spans))
        # Every span slices back to raw text whose folded form matches the
        # returned statement: same statement, not an off-by-one neighbour.
        for statement, (start, end) in zip(statements, spans):
            raw_slice = FUNCTION_SQL[start:end]
            refolded = sql_top_level_statements(raw_slice)
            self.assertEqual(refolded, [statement], raw_slice[:60])

    def test_dropped_empty_statements_drop_their_spans(self):
        text = "create table crm.a (id uuid);;\n;create table crm.b (id uuid);"
        spans: list[tuple[int, int]] = []
        statements = sql_top_level_statements(text, spans=spans)
        self.assertEqual(statements, ["create table crm.a (id uuid)", "create table crm.b (id uuid)"])
        self.assertEqual(len(spans), 2)

    def test_default_view_is_unchanged_by_the_new_parameters(self):
        # The production ALLOWLIST consumes exactly this shape: dollar-quoted
        # bodies emptied, string literals emptied. Passing no new arguments
        # must keep returning it byte-for-byte.
        self.assertEqual(
            sql_top_level_statements(FUNCTION_SQL),
            [
                "create table crm.foo (id uuid primary key, note text)",
                "create function crm.f() returns void language sql security invoker as $$ $$",
                "insert into crm.foo values ('')",
            ],
        )


class KeepDollarQuotedTest(unittest.TestCase):
    def test_body_content_is_preserved_for_reference_scanning(self):
        kept = sql_top_level_statements(FUNCTION_SQL, keep_dollar_quoted=True)
        self.assertIn("from crm.foo", kept[1])
        # A semicolon inside a quoted literal still cannot split a statement.
        self.assertEqual(len(kept), 3)

    def test_string_literals_stay_neutralised_in_the_kept_view(self):
        # A literal OUTSIDE any dollar-quoted body is still emptied; the 'x;y'
        # inside the body is body CONTENT and stays (that is the point of the
        # view), so the assertion is made on a separate statement.
        text = "comment on table crm.foo is 'a;b';\n" + FUNCTION_SQL
        kept = sql_top_level_statements(text, keep_dollar_quoted=True)
        self.assertIn("comment on table crm.foo is ''", kept[0])
        self.assertIn("'x;y'", kept[2], "body content is the thing this view exists to keep")

    def test_untokenisable_text_still_returns_none(self):
        self.assertIsNone(sql_top_level_statements("select 'unterminated", keep_dollar_quoted=True))
        spans: list[tuple[int, int]] = []
        self.assertIsNone(sql_top_level_statements("/* unterminated", spans=spans))
        self.assertEqual(spans, [])


if __name__ == "__main__":
    unittest.main()
