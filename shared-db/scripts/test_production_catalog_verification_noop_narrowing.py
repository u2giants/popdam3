"""Issue #805: the no-op claim check must look at the TARGET, not just the head.

WHY THIS IS A SEPARATE FILE. `scripts/test_production_catalog_verification.py`
is being edited concurrently by the owner of issue #702. Adding to it would mean
two sessions editing the same file at once, which is exactly what #805 itself
warns against for the source. These tests are self-contained and import the same
module, so merging them back into the main file later is a copy, not a rewrite.

WHAT #805 IS AND IS NOT. All three shapes below were LATENT, not exploitable:
checked read-only against production on 2026-08-11, the migration role is not
superuser and cannot write `pg_catalog.pg_class`, and `dblink` is available but
not installed (and `create extension` is rejected by this same check). Every one
of those mitigations is ENVIRONMENTAL -- none lives in this repository, none was
asserted by a test, and none would announce itself if it changed. That is the
argument for closing the gap, not against it.

NOTHING IS WIDENED. Every statement named here was ACCEPTED before and is
REJECTED now. The final class of tests pins that the legitimate data statements
still pass, because a narrowing that also rejects real no-ops would push authors
away from declaring them at all.
"""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    data_statement_rejection,
    read_noop_declaration,
)

DECLARATION = (
    "-- catalog-verification: no-op a sufficiently long stated reason here\n"
)


def claim(statement: str) -> dict:
    return read_noop_declaration(DECLARATION + statement, "20260101000000")


class TheThreeShapesFromIssue805(unittest.TestCase):
    """Each of these was reproduced against `eaacaa5` and ACCEPTED."""

    def test_writing_pg_class_is_REFUSED(self) -> None:
        """Writing `relacl` IS a privilege change, by effect."""
        result = claim("update pg_class set relacl = null where relname='t';")
        self.assertFalse(result["accepted"])
        self.assertIn("writes to the system catalog", result["rejected_because"])
        self.assertIn("pg_class", result["rejected_because"])

    def test_a_dblink_call_is_REFUSED(self) -> None:
        """A revoke, executed through a function call. The statement's head is
        `select`, which is why the head-only check waved it through."""
        result = claim("select dblink_exec('revoke all on t from public');")
        self.assertFalse(result["accepted"])
        self.assertIn("dblink", result["rejected_because"])

    def test_set_role_is_REFUSED(self) -> None:
        result = claim("set role service_role;")
        self.assertFalse(result["accepted"])
        self.assertIn("executing principal", result["rejected_because"])


class ResetRoleAgreesWithSetRole(unittest.TestCase):
    """#805: "whichever way the decision goes, the two should agree".

    They are both refused. `reset role` restores the session's ORIGINAL (higher)
    principal, so treating it more leniently than `set role` would leave the more
    privileged direction as the allowed one.
    """

    def test_reset_role_is_REFUSED(self) -> None:
        self.assertFalse(claim("reset role;")["accepted"])

    def test_reset_session_authorization_is_REFUSED(self) -> None:
        self.assertFalse(claim("reset session authorization;")["accepted"])

    def test_reset_all_is_REFUSED(self) -> None:
        """`reset all` resets `role` among everything else."""
        self.assertFalse(claim("reset all;")["accepted"])

    def test_set_session_authorization_is_REFUSED(self) -> None:
        self.assertFalse(claim("set session authorization postgres;")["accepted"])

    def test_set_local_role_is_REFUSED(self) -> None:
        """The `local` and `session` qualifiers must not be a way around it."""
        self.assertFalse(claim("set local role service_role;")["accepted"])
        self.assertFalse(claim("set session role service_role;")["accepted"])


class CatalogTargetsInEveryWriteShape(unittest.TestCase):
    def test_unqualified_catalog_names_are_REFUSED(self) -> None:
        """An unqualified `pg_class` resolves through search_path to
        `pg_catalog.pg_class`, so requiring the schema prefix would enforce
        nothing."""
        for statement in (
            "update pg_class set relacl = null;",
            "delete from pg_authid where rolname='x';",
            "insert into pg_shdepend values (1);",
        ):
            with self.subTest(statement=statement):
                self.assertFalse(claim(statement)["accepted"])

    def test_qualified_catalog_names_are_REFUSED(self) -> None:
        for statement in (
            "insert into pg_catalog.pg_class values (1);",
            "delete from information_schema.tables;",
            "update pg_toast.x set a = 1;",
        ):
            with self.subTest(statement=statement):
                self.assertFalse(claim(statement)["accepted"])

    def test_a_catalog_write_hidden_behind_a_CTE_is_REFUSED(self) -> None:
        """The head keyword here is `with`. Scanning only the head would let the
        whole class through, which is why the target scan is not head-anchored."""
        result = claim("with x as (select 1) update pg_class set relacl = null;")
        self.assertFalse(result["accepted"])
        self.assertIn("pg_class", result["rejected_because"])

    def test_merge_into_a_catalog_is_REFUSED(self) -> None:
        self.assertFalse(
            claim("merge into pg_class using t on true when matched then delete;")[
                "accepted"
            ]
        )


class NothingLegitimateIsRejected(unittest.TestCase):
    """The narrowing must not cost the real no-ops.

    A check that rejects genuine pure-data migrations pushes authors away from
    declaring them at all, which is worse than the gap it closed.
    """

    LEGITIMATE = (
        "update plm.widget set name = 'x' where id = 1;",
        "delete from plm.widget where id = 2;",
        "insert into plm.widget (id) values (1);",
        "insert into plm.t (a) values (1) on conflict (a) do update set a = 1;",
        "with x as (select 1) insert into plm.widget (id) select 1 from x;",
        "set local statement_timeout = 0;",
        "set search_path = plm, public;",
        "reset search_path;",
        "analyze plm.widget;",
        "select 1;",
        "values (1);",
        "merge into plm.widget using plm.src on true when matched then delete;",
    )

    def test_every_legitimate_data_statement_is_still_ACCEPTED(self) -> None:
        for statement in self.LEGITIMATE:
            with self.subTest(statement=statement):
                self.assertIsNone(data_statement_rejection(statement))

    def test_a_whole_legitimate_no_op_file_is_ACCEPTED(self) -> None:
        result = claim(
            "update plm.widget set name = 'x' where id = 1;\n"
            "delete from plm.widget where id = 2;\n"
        )
        self.assertTrue(result["accepted"], result.get("rejected_because"))
        self.assertEqual(result["statements_checked"], 2)

    def test_a_relation_merely_NAMED_like_a_catalog_column_is_ACCEPTED(self) -> None:
        """`plm.pg_import_log` is a user table. Only the SCHEMA `pg_*` and an
        UNQUALIFIED `pg_*` relation are catalog positions."""
        self.assertIsNone(
            data_statement_rejection("update plm.pg_import_log set a = 1;")
        )


class TheCheckStillFailsClosed(unittest.TestCase):
    """#805 is explicit: do not widen anything while narrowing this."""

    def test_ddl_is_still_refused(self) -> None:
        for statement in (
            "create table plm.t (id uuid);",
            "grant select on plm.t to authenticated;",
            "do $$ begin perform 1; end $$;",
            "create extension dblink;",
            "alter default privileges in schema plm grant select on tables to x;",
        ):
            with self.subTest(statement=statement):
                self.assertFalse(claim(statement)["accepted"])

    def test_a_short_reason_is_still_refused(self) -> None:
        result = read_noop_declaration(
            "-- catalog-verification: no-op meh\nupdate plm.widget set a = 1;",
            "20260101000000",
        )
        self.assertFalse(result["accepted"])

    def test_an_undeclared_file_still_returns_None(self) -> None:
        self.assertIsNone(
            read_noop_declaration("update plm.widget set a = 1;", "20260101000000")
        )

    def test_the_rejection_NAMES_what_it_found(self) -> None:
        """A refusal reading only "non-data statement" sends the author looking
        at the wrong keyword."""
        result = claim("update pg_class set relacl = null;")
        self.assertIn("[writes to the system catalog", result["rejected_because"])

    def test_one_bad_statement_condemns_a_file_of_good_ones(self) -> None:
        result = claim(
            "update plm.widget set a = 1;\n"
            "set role service_role;\n"
            "delete from plm.widget where id = 2;\n"
        )
        self.assertFalse(result["accepted"])
        self.assertIn("1 non-data statement", result["rejected_because"])


class NoExistingMigrationRegresses(unittest.TestCase):
    def test_no_migration_on_disk_changes_verdict(self) -> None:
        """Measured, not assumed. No file in supabase/migrations/ carries a
        `-- catalog-verification: no-op` declaration today, so this narrowing
        changes no existing file's result. If a declared file appears later and
        this fails, the migration is the thing to look at first.
        """
        repo = Path(__file__).resolve().parent.parent
        rejected = []
        for path in sorted((repo / "supabase" / "migrations").glob("*.sql")):
            result = read_noop_declaration(
                path.read_text(encoding="utf-8"), path.name[:14]
            )
            if result is not None and not result["accepted"]:
                rejected.append(f"{path.name}: {result['rejected_because']}")
        self.assertEqual(rejected, [])


if __name__ == "__main__":
    unittest.main()
