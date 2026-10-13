#!/usr/bin/env python3
"""Synthetic tests for the frozen settled-exception executor."""

from __future__ import annotations

from decimal import Decimal
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).with_name("orderlist-settled-exception-executor.py")
SPEC = importlib.util.spec_from_file_location("settled_exception_executor_tested", MODULE_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("executor module could not be loaded")
executor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = executor
SPEC.loader.exec_module(executor)


def snapshot(rows, pairs=None):
    return {
        "schema": executor.CATALOG_SNAPSHOT_SCHEMA,
        "target": executor.TARGET,
        "requested_pairs": pairs or [{"sku_normalized": "sku-1", "style_type": "licensed"}],
        "rows": rows,
    }


CATALOG_LINE = {"source_id": "line:one", "payload": {"sku": "SKU-1", "source_style_type": "licensed"}}


class FakeConnection:
    def __init__(self, rows):
        self.rows = rows
        self.query = None
        self.params = None

    def execute(self, query, params):
        self.query = query
        self.params = params
        return self

    def fetchall(self):
        return self.rows


class FakeTransaction:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    def execute(self, *_args):
        return None

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def fake_postimage():
    orders = [{"id": f"header-{i}", "source_id": f"h:{i}", "action": "insert", "assert_fields": {"id": f"header-{i}"}} for i in range(76)]
    lines = [{"id": f"line-{i}", "source_id": f"l:{i}", "action": "insert", "assert_fields": {"id": f"line-{i}"}} for i in range(296)]
    order_refs = {row["source_id"]: {"id": f"href-{i}", "production_order_id": row["id"], "source_system": "google_order_list", "source_id": row["source_id"], "is_primary": True, "metadata": {}} for i, row in enumerate(orders)}
    line_refs = {row["source_id"]: {"id": f"lref-{i}", "production_order_line_id": row["id"], "source_system": "google_order_list", "source_id": row["source_id"], "is_primary": True, "metadata": {}} for i, row in enumerate(lines)}
    catalog = {"schema": executor.CATALOG_SNAPSHOT_SCHEMA, "target": executor.TARGET, "requested_pairs": [], "rows": [], "po_reuse_guard_state": {"status": "absent", "objects": {}}}
    return {
        "orders": orders, "lines": lines,
        "order_source_ref_assertions": order_refs, "line_source_ref_assertions": line_refs,
        "order_source_refs_insert": list(order_refs.values()), "line_source_refs_insert": list(line_refs.values()),
        "tracking_assertions": [], "snapshot_assertions": [], "catalog_snapshot": catalog,
        "catalog_snapshot_sha256": executor.digest(catalog),
    }


class FakeGateway:
    def __init__(self, preimages, postimage, *, guard=None, catalog=None, preimage_drift=False, bad_readback=False):
        self.connection = FakeTransaction()
        self.preimages = preimages
        self.postimage = postimage
        self.guard = guard or {"status": "absent", "objects": {}}
        self.catalog = catalog or postimage["catalog_snapshot"]
        self.preimage_drift = preimage_drift
        self.bad_readback = bad_readback
        self.applied = False

    def lock(self, _preimages):
        pass

    def read_preimages(self):
        if self.preimage_drift:
            return {"changed": True}
        return self.preimages

    def guard_state(self):
        return self.guard

    def current_catalog_snapshot(self, _postimage):
        return self.catalog

    def apply(self, _postimage):
        self.applied = True

    def readback(self, postimage):
        if self.bad_readback:
            return {"orders": [], "lines": []}
        return {
            "orders": [row["assert_fields"] for row in postimage["orders"]],
            "lines": [row["assert_fields"] for row in postimage["lines"]],
            "order_refs": list(postimage["order_source_ref_assertions"].values()),
            "line_refs": list(postimage["line_source_ref_assertions"].values()),
            "tracking": [], "snapshots": [],
        }


class SettledExceptionExecutorTests(unittest.TestCase):
    def test_capture_queries_only_missing_line_sku_and_type(self):
        lines = [{"source_id": "line:one", "payload": {"sku": "SKU-1", "source_style_type": "licensed"}}]
        preimages = {"lines": []}
        connection = FakeConnection([("tracker-id", "sku-1", "licensed", "item-id")])
        result = executor.build_catalog_snapshot(connection, lines, preimages, {"line:one": "line-uuid"})
        self.assertEqual(connection.params, ["sku-1", "licensed"])
        self.assertIn("public.style_tracker_rows", connection.query)
        self.assertIn("plm.style_tracker_item_bridge", connection.query)
        self.assertNotIn("description", connection.query.lower())
        self.assertEqual(result["rows"], [{"id": "tracker-id", "sku_normalized": "sku-1", "style_type": "licensed", "plm_item_id": "item-id"}])

    def test_canonical_match_uses_exact_type_and_unique_candidate_only(self):
        candidate = {"id": "tracker-1", "sku_normalized": "sku-1", "style_type": "licensed", "plm_item_id": "item-1"}
        catalog = executor._master_data_catalog(snapshot([candidate]), [CATALOG_LINE], {"lines": []}, {"line:one": "new-line"})
        exact = executor.IMPORTER.resolve_match("sku-1", "licensed", catalog)
        wrong_type = executor.IMPORTER.resolve_match("sku-1", "generic", catalog)
        wrong_sku = executor.IMPORTER.resolve_match("sku-1-extra", "licensed", catalog)
        self.assertEqual((exact.status, exact.item_id), ("matched", "item-1"))
        self.assertEqual(wrong_type.status, "unmatched")
        self.assertEqual(wrong_sku.status, "unmatched")

        duplicate = dict(candidate, id="tracker-2", plm_item_id="item-2")
        ambiguous_catalog = executor._master_data_catalog(snapshot([candidate, duplicate]), [CATALOG_LINE], {"lines": []}, {"line:one": "new-line"})
        ambiguous = executor.IMPORTER.resolve_match("sku-1", "licensed", ambiguous_catalog)
        self.assertEqual((ambiguous.status, ambiguous.item_id, ambiguous.candidate_count), ("ambiguous", None, 2))

    def test_catalog_snapshot_rejects_out_of_scope_candidates(self):
        wrong = {"id": "tracker-x", "sku_normalized": "other", "style_type": "licensed", "plm_item_id": None}
        with self.assertRaisesRegex(executor.ExecutorError, "outside the exact requested"):
            executor._master_data_catalog(snapshot([wrong]), [CATALOG_LINE], {"lines": []}, {"line:one": "new-line"})

    def test_catalog_scope_must_match_the_actual_missing_lines(self):
        lines = [{"source_id": "line:one", "payload": {"sku": "SKU-1", "source_style_type": "licensed"}}]
        bad = snapshot([], pairs=[{"sku_normalized": "other", "style_type": "licensed"}])
        with self.assertRaisesRegex(executor.ExecutorError, "exact missing-line SKU/type scope"):
            executor._master_data_catalog(bad, lines, {"lines": []}, {"line:one": "new-line-uuid"})

    def test_new_line_match_uses_canonical_metadata_semantics(self):
        post = {"sku": "SKU-1", "source_style_type": "licensed", "metadata": {"source_disposition": {"approved": True}}}
        audit = {"matched": 0, "unmatched": 0, "ambiguous": 0, "not_applicable": 0, "existing_link_checks": 0}
        candidate = {"id": "tracker-1", "sku_normalized": "sku-1", "style_type": "licensed", "plm_item_id": "item-1"}
        catalog = executor._master_data_catalog(snapshot([candidate]), [CATALOG_LINE], {"lines": []}, {"line:one": "new-line"})
        executor._apply_master_data_match(post, catalog, audit)
        self.assertEqual(post["item_id"], "item-1")
        self.assertEqual(post["master_data_match_status"], "matched")
        self.assertEqual(post["metadata"]["source_disposition"]["approved"], True)
        self.assertEqual(post["metadata"]["master_data_resolution"], "unique")
        self.assertEqual(audit["matched"], 1)

    def test_existing_line_keeps_live_match_provenance_over_empty_catalog_placeholder(self):
        current = {
            "master_data_resolution": "unique",
            "item_link_pending_reason": "plm_item_unpopulated",
            "master_data_candidate_count": 1,
            "manual_note": "preserve",
        }
        desired = {
            "source_disposition": {"approved": True},
            "master_data_resolution": "unmatched",
            "item_link_pending_reason": None,
        }
        merged = executor._merge_existing_line_metadata(current, desired)
        self.assertEqual(merged["master_data_resolution"], "unique")
        self.assertEqual(merged["item_link_pending_reason"], "plm_item_unpopulated")
        self.assertEqual(merged["master_data_candidate_count"], 1)
        self.assertEqual(merged["manual_note"], "preserve")
        self.assertEqual(merged["source_disposition"]["approved"], True)

    def test_outer_metadata_is_authoritative_and_payload_conflicts_fail_closed(self):
        outer = {
            "customer_name": "Synthetic customer",
            "order_vendor_name": "Synthetic vendor",
            "ordering_company": "Synthetic company",
            "source_disposition": {"case": "approved"},
            "raw_evidence": {"raw_number": "0007"},
        }
        payload = {"production_order_number": "D0007"}
        self.assertEqual(executor._entry_metadata({"metadata": outer}, payload), outer)
        with self.assertRaisesRegex(executor.ExecutorError, "metadata conflict"):
            executor._entry_metadata({"metadata": outer}, {**payload, "metadata": {"source_disposition": {}}})

    def test_numeric_schema_fields_roundtrip_as_strings_and_compare_to_postgres_numbers(self):
        postimage = fake_postimage()
        postimage["lines"][0]["assert_fields"].update({
            "quantity_ordered": Decimal("600.0"),
            "order_depth_inches": Decimal("4.50"),
            "assortment_component_ordinal": 2,
            "line_number": "0007",
            "metadata": {"raw_evidence": {"source_numeric_text": "0007"}},
        })
        serialized = json.dumps(postimage, default=str, sort_keys=True)
        loaded = json.loads(serialized)
        self.assertEqual(executor.digest(postimage), executor.digest(loaded))
        readback = {
            "orders": [row["assert_fields"] for row in loaded["orders"]],
            "lines": [dict(row["assert_fields"]) for row in loaded["lines"]],
            "order_refs": list(loaded["order_source_ref_assertions"].values()),
            "line_refs": list(loaded["line_source_ref_assertions"].values()),
            "tracking": [], "snapshots": [],
        }
        readback["lines"][0].update({
            "quantity_ordered": 600.0,
            "order_depth_inches": 4.5,
            "assortment_component_ordinal": 2,
            "line_number": "0007",
        })
        executor.validate_readback(loaded, readback)
        self.assertEqual(readback["lines"][0]["metadata"]["raw_evidence"]["source_numeric_text"], "0007")
        readback["lines"][0]["line_number"] = "7"
        with self.assertRaisesRegex(executor.ExecutorError, "readback differs"):
            executor.validate_readback(loaded, readback)

    def test_numeric_database_adaptation_never_coerces_raw_metadata_or_line_number(self):
        self.assertEqual(executor._db_value("quantity_ordered", "600.0"), Decimal("600.0"))
        self.assertEqual(executor._db_value("assortment_component_ordinal", "2"), 2)
        self.assertEqual(executor._db_value("line_number", "0007"), "0007")
        metadata = {"raw_quantity": "600.0", "raw_line_number": "0007"}
        self.assertEqual(executor._db_value("metadata", metadata), metadata)

    def test_schema_numeric_freeze_is_json_stable_and_metadata_stays_raw(self):
        row = {
            "quantity_ordered": Decimal("600.0"),
            "order_depth_inches": Decimal("4.50"),
            "assortment_component_ordinal": 2,
            "line_number": "0007",
            "metadata": {"raw_quantity": "600.0", "raw_line_number": "0007"},
        }
        before = executor.digest(row)
        executor._freeze_schema_numeric_columns(row)
        encoded = json.dumps(row, default=str)
        loaded = json.loads(encoded)
        self.assertEqual(row["quantity_ordered"], "600.0")
        self.assertEqual(row["order_depth_inches"], "4.50")
        self.assertEqual(row["assortment_component_ordinal"], 2)
        self.assertEqual(row["line_number"], "0007")
        self.assertEqual(row["metadata"], {"raw_quantity": "600.0", "raw_line_number": "0007"})
        self.assertEqual(before, executor.digest(loaded))

    def test_readback_allows_only_triggered_updated_at_at_transaction_time(self):
        postimage = fake_postimage()
        stamp = "2026-10-13T14:00:00+00:00"
        prior = "2026-10-01T12:00:00+00:00"
        row = postimage["orders"][0]
        row.update({
            "action": "update",
            "database_generated_fields": ["updated_at"],
            "assert_fields": {"id": row["id"], "created_at": prior, "updated_at": prior, "status": "in_production"},
        })
        readback = {
            "transaction_timestamp": stamp,
            "orders": [item["assert_fields"] for item in postimage["orders"]],
            "lines": [item["assert_fields"] for item in postimage["lines"]],
            "order_refs": list(postimage["order_source_ref_assertions"].values()),
            "line_refs": list(postimage["line_source_ref_assertions"].values()),
            "tracking": [], "snapshots": [],
        }
        readback["orders"][0] = {**row["assert_fields"], "updated_at": stamp}
        executor.validate_readback(postimage, readback)

        for field, value in (("updated_at", prior), ("created_at", stamp), ("status", "cancelled")):
            bad = json.loads(json.dumps(readback))
            bad["orders"][0][field] = value
            with self.subTest(field=field), self.assertRaises(executor.ExecutorError):
                executor.validate_readback(postimage, bad)

    def test_readback_checks_insert_defaults_and_preserved_timestamps(self):
        postimage = fake_postimage()
        stamp = "2026-10-13T14:00:00+00:00"
        prior = "2026-10-01T12:00:00+00:00"
        insert = postimage["orders"][0]
        insert["database_default_fields"] = ["created_at", "updated_at"]
        insert["assert_fields"] = {"id": insert["id"], "created_at": stamp, "updated_at": stamp}
        preserve = postimage["orders"][1]
        preserve.update({"action": "preserve", "assert_fields": {"id": preserve["id"], "created_at": prior, "updated_at": prior}})
        readback = {
            "transaction_timestamp": stamp,
            "orders": [row["assert_fields"] for row in postimage["orders"]],
            "lines": [row["assert_fields"] for row in postimage["lines"]],
            "order_refs": list(postimage["order_source_ref_assertions"].values()),
            "line_refs": list(postimage["line_source_ref_assertions"].values()),
            "tracking": [], "snapshots": [],
        }
        executor.validate_readback(postimage, readback)
        readback["orders"][1] = {**preserve["assert_fields"], "updated_at": stamp}
        with self.assertRaisesRegex(executor.ExecutorError, "readback differs"):
            executor.validate_readback(postimage, readback)

    def test_database_identity_fingerprint_tuple_survives_private_json_roundtrip(self):
        identity = {
            "project_ref": executor.TARGET,
            "host": executor.PREFLIGHT.TARGET_HOST,
            "port": executor.PREFLIGHT.TARGET_PORT,
            "database": executor.PREFLIGHT.TARGET_DATABASE,
            "user": executor.PREFLIGHT.TARGET_USER,
            "fingerprint": ("postgres", "127.0.0.1", "synthetic-start"),
        }
        frozen = json.loads(json.dumps(identity))
        self.assertIsInstance(frozen["fingerprint"], list)
        self.assertEqual(executor.PREFLIGHT.digest(identity), executor.PREFLIGHT.digest(frozen))
        altered = {**frozen, "host": f"{executor.PREFLIGHT.TARGET_HOST}.attacker.invalid"}
        with self.assertRaisesRegex(executor.PREFLIGHT.PreflightError, "Virginia target"):
            executor.PREFLIGHT.validate_database_identity(altered)

    def test_task_gate_uses_managed_absolute_path_when_path_is_hijacked(self):
        report_digest = "a" * 64
        managed = executor.validated_task_gate_identity()
        binding = {
            "task_gate_launcher_path": managed["path"],
            "task_gate_launcher_sha256": managed["sha256"],
            "report_sha256": report_digest,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            hijack_dir = Path(temp_dir) / "bin"
            hijack_dir.mkdir()
            hijack = hijack_dir / "ai-task-gates"
            hijack.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
            hijack.chmod(0o755)
            report = Path(temp_dir) / "review.txt"
            report.write_text("synthetic report", encoding="utf-8")
            report.chmod(0o644)
            binding["report_sha256"] = executor.sha256_bytes(report.read_bytes())
            with mock.patch.dict(os.environ, {"PATH": str(hijack_dir)}), mock.patch.object(
                executor.subprocess, "run", return_value=mock.Mock(returncode=0)
            ) as run:
                executor.check_task_gate(report, binding)
            command = run.call_args.args[0]
            self.assertEqual(command[0], managed["path"])
            self.assertNotEqual(command[0], str(hijack))

    def test_task_gate_hash_mismatch_blocks_before_execution(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            report = Path(temp_dir) / "review.txt"
            report.write_text("synthetic report", encoding="utf-8")
            report.chmod(0o644)
            binding = {
                "task_gate_launcher_path": executor.validated_task_gate_identity()["path"],
                "task_gate_launcher_sha256": "0" * 64,
                "report_sha256": executor.sha256_bytes(report.read_bytes()),
            }
            with mock.patch.object(executor.subprocess, "run") as run:
                with self.assertRaisesRegex(executor.ApplyBlocked, "differs from the reviewed bundle"):
                    executor.check_task_gate(report, binding)
            run.assert_not_called()

    def test_review_report_safe_reader_accepts_readonly_modes_and_rejects_symlinks_or_writes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            report = directory / "review.txt"
            report.write_text("synthetic report", encoding="utf-8")
            report.chmod(0o644)
            self.assertEqual(executor._safe_read_review_report(report), b"synthetic report")
            report.chmod(0o600)
            self.assertEqual(executor._safe_read_review_report(report), b"synthetic report")
            report.chmod(0o666)
            with self.assertRaisesRegex(executor.ApplyBlocked, "permissions or ownership"):
                executor._safe_read_review_report(report)
            report.chmod(0o600)
            link = directory / "review-link.txt"
            link.symlink_to(report)
            with self.assertRaisesRegex(executor.ApplyBlocked, "unavailable"):
                executor._safe_read_review_report(link)

    def test_review_approval_bundle_pins_launcher_path_and_hash(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            report = Path(temp_dir) / "review.txt"
            report.write_text("synthetic reviewer report", encoding="utf-8")
            report.chmod(0o644)
            launcher = executor.validated_task_gate_identity()
            bundle = {
                "artifact_type": executor.REVIEW_BUNDLE_TYPE,
                "verdict": "APPROVE",
                "target": executor.TARGET,
                "review_plan_sha256": "1" * 64,
                "source_preimages_file_sha256": "2" * 64,
                "source_preimages_semantic_sha256": "3" * 64,
                "postimage_sha256": "4" * 64,
                "executor_sha256": executor.sha256_bytes(Path(executor.__file__).read_bytes()),
                "preflight_sha256": executor.sha256_bytes(executor.PREFLIGHT_PATH.read_bytes()),
                "reviewer_report_sha256": executor.sha256_bytes(report.read_bytes()),
                "task_gate_launcher_path": launcher["path"],
                "task_gate_launcher_sha256": launcher["sha256"],
                "po_reuse_guard_status_at_review": "absent",
            }
            binding = executor.require_review_approval(
                bundle, report_path=report, review_plan_sha256="1" * 64,
                preimages_file_sha256="2" * 64, preimages_semantic_sha256="3" * 64,
                postimage_sha256="4" * 64,
            )
            self.assertEqual(binding["task_gate_launcher_path"], launcher["path"])
            altered = {**bundle, "task_gate_launcher_sha256": "0" * 64}
            with self.assertRaisesRegex(executor.ApplyBlocked, "does not bind"):
                executor.require_review_approval(
                    altered, report_path=report, review_plan_sha256="1" * 64,
                    preimages_file_sha256="2" * 64, preimages_semantic_sha256="3" * 64,
                    postimage_sha256="4" * 64,
                )

    def test_parent_only_or_missing_sku_does_not_invent_catalog_lookup(self):
        lines = [{"source_id": "line:parent", "payload": {"sku": None, "source_style_type": "licensed"}}]
        connection = FakeConnection([])
        result = executor.build_catalog_snapshot(connection, lines, {"lines": []}, {"line:parent": "line-id"})
        self.assertIsNone(connection.query)
        self.assertEqual(result["requested_pairs"], [])
        self.assertEqual(result["rows"], [])

    def test_guard_state_requires_exact_absence(self):
        executor.require_guard_absent({"status": "absent", "objects": {"trigger": False}})
        with self.assertRaises(executor.AdmissionRequired):
            executor.require_guard_absent({"status": "present_or_partial", "objects": {"trigger": True}})

    def test_generated_ids_are_deterministic_and_source_bound(self):
        one = executor.deterministic_uuid("production_order_line", "order:row:42")
        self.assertEqual(one, executor.deterministic_uuid("production_order_line", "order:row:42"))
        self.assertNotEqual(one, executor.deterministic_uuid("production_order_line", "order:row:43"))
        with self.assertRaisesRegex(executor.ExecutorError, "collides with a frozen preimage"):
            executor._assert_no_preimage_uuid_collision([one], {one})

    def test_transaction_commits_only_after_complete_count_and_reference_readback(self):
        preimages = {"orders": [{"id": "old"}], "lines": []}
        postimage = fake_postimage()
        gateway = FakeGateway(preimages, postimage)
        executor.apply_transaction(gateway, postimage, preimages)
        self.assertTrue(gateway.applied)
        self.assertTrue(gateway.connection.committed)
        self.assertFalse(gateway.connection.rolled_back)

    def test_transaction_rolls_back_on_preimage_or_catalog_drift(self):
        preimages = {"orders": [{"id": "old"}], "lines": []}
        postimage = fake_postimage()
        for gateway in (
            FakeGateway(preimages, postimage, preimage_drift=True),
            FakeGateway(preimages, postimage, catalog={"changed": True}),
        ):
            with self.assertRaises(executor.ExecutorError):
                executor.apply_transaction(gateway, postimage, preimages)
            self.assertFalse(gateway.applied)
            self.assertTrue(gateway.connection.rolled_back)
            self.assertFalse(gateway.connection.committed)

    def test_transaction_rolls_back_on_partial_guard_or_failed_readback(self):
        preimages = {"orders": [{"id": "old"}], "lines": []}
        postimage = fake_postimage()
        for gateway in (
            FakeGateway(preimages, postimage, guard={"status": "present_or_partial", "objects": {"trigger": True}}),
            FakeGateway(preimages, postimage, bad_readback=True),
        ):
            with self.assertRaises(executor.ExecutorError):
                executor.apply_transaction(gateway, postimage, preimages)
            self.assertTrue(gateway.connection.rolled_back)
            self.assertFalse(gateway.connection.committed)


if __name__ == "__main__":
    unittest.main()
