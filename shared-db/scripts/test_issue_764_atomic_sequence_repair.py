from pathlib import Path
import hashlib
import json
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import atomic_migration_apply as atomic


VERSION = "20260817041506"
MIGRATION = ROOT / "supabase/migrations/20260817041506_repair_stale_dflow_sequences.sql"
POLICY = ROOT / "config/atomic-migration-allowlist.json"


class AtomicSequenceRepairTests(unittest.TestCase):
    def test_exact_migration_routes_through_one_atomic_wrapper(self):
        entry = json.loads(POLICY.read_text(encoding="utf-8"))["migrations"][VERSION]
        self.assertEqual(entry["targets"], ["preview", "production"])
        self.assertEqual(
            entry["sha256"],
            hashlib.sha256(atomic.canonical_migration_bytes(MIGRATION)).hexdigest(),
        )

        for target in entry["targets"]:
            with self.subTest(target=target):
                path, _, raw, statements = atomic.load_candidate(
                    MIGRATION.parent, VERSION, target
                )
                wrapper = atomic.build_wrapper(
                    VERSION, path.stem.split("_", 1)[1], raw, statements
                )
                self.assertEqual(wrapper.count("BEGIN;"), 1)
                self.assertEqual(wrapper.count("COMMIT;"), 1)
                self.assertLess(wrapper.index("BEGIN;"), wrapper.index("lock table"))
                self.assertLess(
                    wrapper.index("raise exception 'properties_and_characters"),
                    wrapper.index("INSERT INTO supabase_migrations.schema_migrations"),
                )
                self.assertLess(wrapper.index("INSERT INTO"), wrapper.index("COMMIT;"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
