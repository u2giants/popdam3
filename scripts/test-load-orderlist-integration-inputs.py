import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid
import types


SCRIPT = Path(__file__).with_name("load-orderlist-integration-inputs.py")
loader = types.ModuleType("orderlist_aux_loader")
loader.__file__ = str(SCRIPT)
exec(compile(SCRIPT.read_text(), str(SCRIPT), "exec"), loader.__dict__)


def sample_source(depth=None, *, extra_depth_column=False, duplicate_depth=False,
                  duplicate_tracking=False, duplicate_po=False):
    order_id = str(uuid.UUID("43d53a47-c66e-45b8-8d51-3d6d16041d98"))
    tracking = {
        "order_id": order_id,
        "source_po": "PO-1001",
        "source_row": 12,
        "agent": None,
        "cbm": 0,
        "comment": "",
        "vessel": None,
        "sent_to_coldlion": False,
        "worksheet_done": None,
        "inspection_passed": "2024-02-29",
        "inspection_note": None,
        "document_invoice": True,
        "document_packing_list": None,
        "document_bill_of_lading": False,
        "document_tsca": None,
        "document_lacey_act": None,
        "document_telex": None,
        "request_wire": False,
        "payment_note": None,
    }
    depth_row = {
        "sku_normalized": "abc-1",
        "customer_normalized": "customer one",
        "depth_inches": depth,
        "depth_raw": "not numeric source text",
        "source_workbook_id": "source-book",
        "source_row_number": 5,
    }
    if extra_depth_column:
        depth_row["unexpected"] = "ignored by no one"
    source_depths = [depth_row, dict(depth_row)] if duplicate_depth else [depth_row]
    tracking_rows = [tracking, dict(tracking)] if duplicate_tracking else [tracking]
    if duplicate_po and len(tracking_rows) == 2:
        tracking_rows[1]["order_id"] = str(uuid.UUID("24a818e9-d3f4-4d0f-9ebc-80346c01bde3"))
    source = {
        "sample_depth": source_depths,
        "customer_settings": [{"customer_normalized": "customer one", "suffix": "C1"}],
        "tracking": tracking_rows,
        "held_tracking": [],
        "source_digests": {"capture": "fixed"},
        "selection_rule": "fixture",
    }
    raw = json.dumps(source, separators=(",", ":")).encode()
    counts = {"sample_depth": len(source_depths), "customer_settings": 1,
              "tracking": len(tracking_rows)}
    return raw, counts


class FakeResult:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return (self.value,)


class FakeLockConnection:
    def __init__(self, *, advisory=True, nonempty=False, fail_on_lock=False):
        self.advisory = advisory
        self.nonempty = nonempty
        self.fail_on_lock = fail_on_lock
        self.calls = []
        self.transaction_state = None

    class Transaction:
        def __init__(self, owner):
            self.owner = owner

        def __enter__(self):
            self.owner.transaction_state = "active"
            return self

        def __exit__(self, exception_type, _exception, _traceback):
            self.owner.transaction_state = "rolled_back" if exception_type else "committed"
            return False

    def transaction(self):
        return self.Transaction(self)

    def execute(self, statement):
        self.calls.append(statement)
        if self.fail_on_lock and statement.startswith("lock table"):
            raise RuntimeError("concurrent writer holds destination lock")
        if "pg_try_advisory_xact_lock" in statement:
            return FakeResult(self.advisory)
        if "select exists" in statement:
            return FakeResult(self.nonempty)
        return FakeResult(None)


class FakeConnectionInfo:
    host = loader.TARGET_HOST
    port = loader.TARGET_PORT
    user = "postgres." + loader.TARGET_PROJECT


class FakeTargetConnection:
    info = FakeConnectionInfo()

    def __init__(self, database="postgres"):
        self.database = database

    def execute(self, statement):
        if statement == "select current_database()":
            return FakeResult(self.database)
        raise AssertionError("Unexpected target proof query")


class FakeProofConnection(FakeLockConnection):
    info = FakeConnectionInfo()

    def __init__(self, database="postgres", **kwargs):
        super().__init__(**kwargs)
        self.database = database

    def execute(self, statement):
        if statement == "select current_database()":
            self.calls.append(statement)
            return FakeResult(self.database)
        return super().execute(statement)


class FakePsycopg:
    def __init__(self):
        self.kwargs = None

    def connect(self, **kwargs):
        self.kwargs = kwargs
        return object()


class OrderlistAuxLoaderTests(unittest.TestCase):
    def validate(self, raw, counts, held=0):
        digest = hashlib.sha256(raw).hexdigest()
        return loader.validate_source_bytes(raw, digest, counts, held)

    def test_accepts_finite_positive_or_null_depth_and_closed_tracking_fields(self):
        raw, counts = sample_source("2.75")
        result = self.validate(raw, counts)
        self.assertEqual(result["sample_depth"][0][loader.DEPTH_COLUMNS.index("depth_inches")],
                         loader.Decimal("2.75"))
        raw, counts = sample_source(None)
        result = self.validate(raw, counts)
        self.assertIsNone(result["sample_depth"][0][loader.DEPTH_COLUMNS.index("depth_inches")])
        self.assertEqual(result["tracking"][0][loader.TRACKING_COLUMNS.index("cbm")], loader.Decimal("0"))

    def test_rejects_changed_hash_and_unexpected_columns(self):
        raw, counts = sample_source("1")
        with self.assertRaisesRegex(ValueError, "checksum"):
            loader.validate_source_bytes(raw, "0" * 64, counts, 0)
        raw, counts = sample_source("1", extra_depth_column=True)
        with self.assertRaisesRegex(ValueError, "columns changed"):
            self.validate(raw, counts)

    def test_rejects_nonexact_source_counts(self):
        raw, counts = sample_source("1")
        counts["tracking"] += 1
        with self.assertRaisesRegex(ValueError, "row counts changed"):
            self.validate(raw, counts)

    def test_rejects_duplicate_auxiliary_and_tracking_identities(self):
        raw, counts = sample_source("1", duplicate_depth=True)
        with self.assertRaisesRegex(ValueError, "Duplicate sample-depth"):
            self.validate(raw, counts)
        raw, counts = sample_source("1", duplicate_tracking=True)
        with self.assertRaisesRegex(ValueError, "Duplicate tracking"):
            self.validate(raw, counts)
        raw, counts = sample_source("1", duplicate_tracking=True, duplicate_po=True)
        with self.assertRaisesRegex(ValueError, "Duplicate tracking"):
            self.validate(raw, counts)

    def test_rejects_nonfinite_and_nonpositive_depths(self):
        for value in ("NaN", "Infinity", "-Infinity", "-1", "0", "not a number"):
            with self.subTest(value=value):
                raw, counts = sample_source(value)
                with self.assertRaisesRegex(ValueError, "sample depth"):
                    self.validate(raw, counts)

    def test_rejects_invalid_date_and_string_boolean(self):
        raw, counts = sample_source("1")
        source = json.loads(raw)
        source["tracking"][0]["inspection_passed"] = "2023-02-29"
        raw = json.dumps(source, separators=(",", ":")).encode()
        with self.assertRaisesRegex(ValueError, "tracking date"):
            self.validate(raw, counts)
        source["tracking"][0]["inspection_passed"] = None
        source["tracking"][0]["sent_to_coldlion"] = "false"
        raw = json.dumps(source, separators=(",", ":")).encode()
        with self.assertRaisesRegex(ValueError, "sent_to_coldlion"):
            self.validate(raw, counts)

    def test_initial_load_requires_exclusive_locks_and_empty_tables(self):
        nonempty = FakeLockConnection(nonempty=True)
        with self.assertRaisesRegex(ValueError, "not empty"):
            loader._lock_and_assert_empty(nonempty)
        self.assertEqual(sum("lock table" in call for call in nonempty.calls), 3)

        concurrent = FakeLockConnection(advisory=False)
        with self.assertRaisesRegex(ValueError, "Another auxiliary"):
            loader._lock_and_assert_empty(concurrent)
        self.assertFalse(any("select exists" in call for call in concurrent.calls))

    def test_rollback_lock_step_refuses_an_active_writer_without_progress(self):
        concurrent = FakeLockConnection(fail_on_lock=True)
        with self.assertRaisesRegex(RuntimeError, "concurrent writer"):
            loader._lock_tables(concurrent)
        self.assertEqual(len(concurrent.calls), 1)
        self.assertIn("access exclusive mode nowait", concurrent.calls[0])

    def test_mocked_load_transaction_rolls_back_before_any_copy_if_lock_is_busy(self):
        raw, counts = sample_source("1")
        payload = self.validate(raw, counts)
        concurrent = FakeLockConnection(fail_on_lock=True)
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "recovery.json"
            with self.assertRaisesRegex(RuntimeError, "concurrent writer"):
                loader.load_transaction(concurrent, payload, evidence)
            self.assertEqual(concurrent.transaction_state, "rolled_back")
            self.assertFalse(evidence.exists())
            self.assertEqual(len(concurrent.calls), 1)

    def test_mocked_transaction_checks_live_target_before_copy(self):
        raw, counts = sample_source("1")
        payload = self.validate(raw, counts)
        wrong_target = FakeProofConnection(database="wrong_database")
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "recovery.json"
            with patch.object(loader, "_copy_rows") as copy_rows:
                with self.assertRaisesRegex(ValueError, "target proof"):
                    loader.load_transaction(wrong_target, payload, evidence)
                copy_rows.assert_not_called()
            self.assertEqual(wrong_target.transaction_state, "rolled_back")
            self.assertFalse(evidence.exists())

    def test_target_proof_checks_live_connection_metadata_and_database(self):
        loader._assert_target(FakeTargetConnection())
        with self.assertRaisesRegex(ValueError, "target proof"):
            loader._assert_target(FakeTargetConnection(database="wrong_database"))

    def test_connection_requires_tls_and_uses_fixed_project_target(self):
        fake = FakePsycopg()
        loader._connect_to_target(fake, "test-only-password")
        self.assertEqual(fake.kwargs["host"], loader.TARGET_HOST)
        self.assertEqual(fake.kwargs["port"], loader.TARGET_PORT)
        self.assertEqual(fake.kwargs["user"], "postgres." + loader.TARGET_PROJECT)
        self.assertEqual(fake.kwargs["dbname"], loader.TARGET_DATABASE)
        self.assertEqual(fake.kwargs["sslmode"], "require")

    def test_database_failure_message_never_includes_driver_detail(self):
        driver_error = type("CheckViolation", (Exception,), {"__module__": "psycopg.errors"})
        message = loader._safe_failure_message(driver_error("private source row value"))
        self.assertNotIn("private source row value", message)


if __name__ == "__main__":
    unittest.main()
