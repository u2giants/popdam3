"""Comment-only migrations must be VERIFIED, not refused as "proved nothing".

Issue popcre/shared-db#5349 made a batch of only `comment on` statements derive
the objects it names (schema: presence and exact comment; relation/routine:
existence) instead of failing the post-apply check after a successful apply --
the false failure that marked production run 41265181704 (migration
20261031232334, ai-devops#2172 stage E) failed. This file pins that fix AND the
follow-up parser gaps inside the same promised coverage: the `is null` spelling
(schema comment removal), a final statement with no trailing semicolon, and a
paren-less routine name. Each of those named a readable object and still landed
in the refusal. The last two tests pin the boundaries that must NOT move: a
batch that mixes a comment with a statement deriving nothing still proves
nothing, and a comment on an object kind this lexer cannot read still proves
nothing.

WHY THIS IS A SEPARATE FILE. The same reason as
`test_production_catalog_verification_noop_narrowing.py`: the main suite is
edited by other sessions, and a self-contained module that imports the same
code is a copy to merge later, not a rewrite.

NO DATABASE. Everything here drives the pure derivation and reporting logic on
temporary files. The live end-to-end replay (real migration, real catalog) is
recorded on popcre/ai-devops#2172; these tests are the offline proof that both
cases -- a comment-only pass and a real verification failure -- hold.
"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    derive_targets,
    render_report,
)

REPO = Path(__file__).resolve().parents[1]
VERSION = "20260810140000"
PR5233_VERSION = "20261031232334"
PR5233_FILE = (
    REPO / "supabase" / "migrations" / "20261031232334_core_schema_comment_c2_proof.sql"
)
PR5233_COMMENT = (
    "Canonical shared business objects used by DAM, CRM, PM, and PLM."
)


def targets_for(sql: str):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        migrations = root / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / f"{VERSION}_test.sql"
        path.write_text(sql, encoding="utf-8")
        return derive_targets({VERSION: path}, [VERSION])


def render(targets, catalog):
    return render_report([VERSION], targets, catalog, None, [], True)


def real_5233_targets():
    return derive_targets({PR5233_VERSION: PR5233_FILE}, [PR5233_VERSION])


class CommentOnlyBatchVerifiesTheObjectsItNames(unittest.TestCase):
    """The false failure: comment-only must pass by CHECKING, not by silence."""

    def test_the_real_5233_migration_verifies_the_exact_core_comment(self):
        # The exact file that production run 41265181704 applied and then
        # refused to verify. It must derive the schema comment and pass.
        targets = real_5233_targets()
        self.assertFalse(targets.is_empty())
        self.assertEqual(targets.schema_comments, [("core", PR5233_COMMENT)])
        _, failures = render(
            targets,
            {"schemas": [{"name": "core", "exists": True, "comment": PR5233_COMMENT}]},
        )
        self.assertEqual(failures, [])

    def test_a_wrong_or_absent_comment_on_the_same_object_still_fails(self):
        # A REAL verification failure must still fail. Same migration, catalog
        # states that do not match what it applied.
        targets = real_5233_targets()
        for bad in (
            {"schemas": []},
            {"schemas": [{"name": "core", "exists": False, "comment": None}]},
            {"schemas": [{"name": "core", "exists": True, "comment": "other"}]},
        ):
            with self.subTest(bad=bad):
                _, failures = render(targets, bad)
                self.assertTrue(failures)

    def test_a_schema_comment_removal_is_verified_as_an_absent_comment(self):
        # `is null` is a comment statement too: it names the schema and its
        # exact (absent) comment. Previously it fell into "proved nothing".
        targets = targets_for("comment on schema core is null;")
        self.assertFalse(targets.is_empty())
        self.assertEqual(targets.schema_comments, [("core", None)])
        _, failures = render(
            targets, {"schemas": [{"name": "core", "exists": True, "comment": None}]}
        )
        self.assertEqual(failures, [])
        _, failures = render(
            targets,
            {"schemas": [{"name": "core", "exists": True, "comment": "leftover"}]},
        )
        self.assertTrue(failures)

    def test_a_final_schema_comment_without_a_trailing_semicolon_is_still_read(self):
        targets = targets_for(f"comment on schema core is '{PR5233_COMMENT}'")
        self.assertEqual(targets.schema_comments, [("core", PR5233_COMMENT)])
        _, failures = render(
            targets,
            {"schemas": [{"name": "core", "exists": True, "comment": PR5233_COMMENT}]},
        )
        self.assertEqual(failures, [])

    def test_a_parenless_routine_comment_still_derives_the_function(self):
        # `comment on function plm.f is 'x'` names `plm.f` without an argument
        # list. The argument list is optional in Postgres; refusing the
        # paren-less spelling was a parser gap, not a policy.
        targets = targets_for("comment on function plm.f is 'x';")
        self.assertEqual(targets.functions, ["plm.f"])
        _, failures = render(
            targets,
            {
                "functions": [{"name": "plm.f", "overloads": [{"oid": 1}]}],
                "relations": [],
            },
        )
        self.assertEqual(failures, [])
        _, failures = render(targets, {"functions": [{"name": "plm.f", "overloads": []}]})
        self.assertTrue(failures)

    def test_a_relation_comment_removal_is_verified_by_existence(self):
        # `is null` on a relation was already read (the matcher only needs
        # `is`); pinned so it cannot regress into "proved nothing".
        targets = targets_for("comment on table plm.a is null;")
        self.assertEqual(targets.required_relations, ["plm.a"])
        _, failures = render(
            targets, {"relations": [{"name": "plm.a", "to_regclass": "plm.a"}]}
        )
        self.assertEqual(failures, [])
        _, failures = render(
            targets, {"relations": [{"name": "plm.a", "to_regclass": None}]}
        )
        self.assertTrue(failures)


class CommentOnlyDoesNotLaunderAnythingElse(unittest.TestCase):
    """The refusal must survive everything the fix deliberately does not cover."""

    def test_a_comment_beside_a_statement_deriving_nothing_still_proves_nothing(self):
        targets = targets_for(
            "comment on schema core is 'x';\nupdate plm.widget set a = 1;"
        )
        self.assertTrue(targets.is_empty())
        _, failures = render(targets, {"schemas": [], "relations": []})
        self.assertEqual(len(failures), 1)
        self.assertIn("proved nothing", failures[0])

    def test_a_comment_on_an_unreadable_object_kind_still_proves_nothing(self):
        targets = targets_for("comment on policy p on plm.a is 'x';")
        self.assertTrue(targets.is_empty())
        _, failures = render(targets, {"schemas": [], "relations": []})
        self.assertEqual(len(failures), 1)
        self.assertIn("proved nothing", failures[0])

    def test_a_comment_only_batch_with_a_false_no_op_claim_still_fails(self):
        # A rejected `-- catalog-verification: no-op` claim is a false claim in
        # its own right; the comment-only pass must not launder it. (A claim is
        # rejected for comment statements because they are not data statements.)
        sql = (
            "-- catalog-verification: no-op this file changes nothing at all, "
            "honestly\n"
            "comment on schema core is 'x';\n"
        )
        targets = targets_for(sql)
        self.assertIsNotNone(targets.noop_declaration)
        self.assertFalse(targets.noop_declaration["accepted"])
        _, failures = render(targets, {"schemas": [], "relations": []})
        self.assertTrue(failures)


if __name__ == "__main__":
    unittest.main()
