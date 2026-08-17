from pathlib import Path
import hashlib
import json
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from post_batch_app_verification import RETIRED_VERSION_REASONS, RETIRED_VERSIONS
from production_migration_guard import HARD_BLOCKED
import atomic_migration_apply as atomic


UNSAFE = ROOT / "supabase/migrations/20260816045130_popdam_orderlist_item_bridge_additive_cutover.sql"
SAFE = ROOT / "supabase/migrations/20260816110750_popdam_orderlist_item_bridge_safe_forward.sql"
ATOMIC_POLICY = ROOT / "config/atomic-migration-allowlist.json"
WORKFLOW = ROOT / ".github/workflows/shared-supabase-migrations.yml"


def executable_body(sql: str) -> str:
    start = sql.index("lock table plm.style_tracker_item_bridge")
    return sql[start:].removesuffix("\n\ncommit;\n").removesuffix("\ncommit;\n").rstrip()


class SafeForwardTests(unittest.TestCase):
    def test_preserves_exact_database_body_without_transaction_control(self):
        unsafe = UNSAFE.read_text(encoding="utf-8")
        safe = SAFE.read_text(encoding="utf-8")
        self.assertEqual(executable_body(safe), executable_body(unsafe))
        self.assertIn("\nbegin;\n", unsafe.lower())
        self.assertTrue(unsafe.rstrip().lower().endswith("commit;"))
        self.assertTrue(safe.lstrip().lower().splitlines()[0].startswith("--"))
        self.assertNotIn("\nbegin;\n", safe.lower())
        self.assertFalse(safe.rstrip().lower().endswith("commit;"))

    def test_unsafe_version_is_retired_and_hard_blocked_with_exact_reason(self):
        reason = RETIRED_VERSION_REASONS["20260816045130"]
        self.assertIn(
            "explicit COMMIT separates DDL from the Supabase migration ledger",
            reason,
        )
        self.assertIn("never apply production", reason)
        self.assertIn("20260816045130", RETIRED_VERSIONS)
        self.assertIn("20260816045130", HARD_BLOCKED)

    def test_safe_replacement_is_not_retired_or_blocked(self):
        self.assertNotIn("20260816110750", RETIRED_VERSIONS)
        self.assertNotIn("20260816110750", HARD_BLOCKED)

    def test_lock_and_temporary_snapshot_require_one_transaction(self):
        safe = SAFE.read_text(encoding="utf-8").lower()
        self.assertIn(
            "lock table plm.style_tracker_item_bridge in share row exclusive mode;",
            safe,
        )
        self.assertIn("create temporary table issue_853_bridge_before on commit drop", safe)
        self.assertLess(safe.index("lock table"), safe.index("create temporary table"))
        self.assertLess(
            safe.index("create temporary table"),
            safe.index("select * into before_state from issue_853_bridge_before"),
        )

    def test_governed_preview_and_production_route_exact_file_to_atomic_runner(self):
        policy = json.loads(ATOMIC_POLICY.read_text(encoding="utf-8"))
        entry = policy["migrations"]["20260816110750"]
        self.assertEqual(entry["targets"], ["preview", "production"])
        self.assertEqual(
            entry["sha256"],
            hashlib.sha256(atomic.canonical_migration_bytes(SAFE)).hexdigest(),
        )

        for target in entry["targets"]:
            with self.subTest(target=target):
                path, _, raw, statements = atomic.load_candidate(
                    SAFE.parent, "20260816110750", target
                )
                self.assertEqual(path, SAFE)
                wrapper = atomic.build_wrapper(
                    "20260816110750", path.stem.split("_", 1)[1], raw, statements
                )
                self.assertLess(wrapper.index("BEGIN;"), wrapper.index("lock table"))
                self.assertLess(
                    wrapper.index("select * into before_state"),
                    wrapper.index("INSERT INTO supabase_migrations.schema_migrations"),
                )
                self.assertLess(wrapper.index("INSERT INTO"), wrapper.index("COMMIT;"))

    def test_preview_workflow_cannot_fall_through_to_direct_cli_for_atomic_version(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertEqual(workflow.count('--classify-allowlist "$PREVIEW_ALLOWLIST"'), 2)
        self.assertEqual(workflow.count('if [ -n "$ATOMIC_VERSION" ]; then'), 4)
        self.assertIn("--target preview --expected-project-ref", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
