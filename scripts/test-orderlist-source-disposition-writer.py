#!/usr/bin/env python3
"""Offline tests for the read-only #277 exception-plan preflight."""

from __future__ import annotations

import hashlib
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).with_name("orderlist-source-disposition-writer.py")
MODULE_SPEC = importlib.util.spec_from_file_location("orderlist_source_disposition_writer", MODULE_PATH)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("could not load writer preflight")
writer = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = writer
MODULE_SPEC.loader.exec_module(writer)


def synthetic_plan():
    source_hashes = {
        "source_answer_resolution_packet_sha256": "1" * 64,
        "returned_workbook_sha256": "2" * 64,
        "latest_google_capture_sha256": "3" * 64,
    }
    active_rows = [1000 + i for i in range(123)]
    held_rows = [2000 + i for i in range(20)]
    skipped_rows = [3000 + i for i in range(7)]
    orders = []
    for i in range(76):
        if i < 40:
            po = f"D{i % 12:02d}"
            sid = f"order:po:{po.lower()}:group:{i:02d}"
            case_id = f"Conflicting orders:{i + 1}"
            disposition = {
                "original_normalized_header_source_id": f"order:po:{po.lower()}",
                "desired_internal_header_source_id": sid,
                "google_company_I_ignored_for_approved_conflicts": True,
                "source_row_evidence": [{"case_id": case_id}],
            }
        else:
            po = f"A{i:02d}"
            sid = f"order:po:{po.lower()}"
            disposition = {
                "original_normalized_header_source_id": sid,
                "desired_internal_header_source_id": sid,
                "source_row_evidence": [{"case_id": f"Rows needing correction:{i}"}],
            }
        orders.append({
            "source_id": sid,
            "po_normalized": po.lower(),
            "sheet_rows": [],
            "payload": {"production_order_number": po, "status": "Open"},
            "metadata": {"source_disposition": disposition},
            "quarantined": False,
            "quarantine_reasons": [],
        })
    for i in range(8):
        rownums = [held_rows[j] for j in range(i, len(held_rows), 8)]
        sid = f"order:po:parent{i:02d}"
        orders.append({
            "source_id": sid,
            "po_normalized": f"parent{i:02d}",
            "sheet_rows": rownums,
            "payload": {"production_order_number": f"PARENT{i:02d}", "status": "Open"},
            "metadata": {"source_disposition": {
                "original_normalized_header_source_id": sid,
                "desired_internal_header_source_id": sid,
                "source_row_evidence": [{"case_id": "Rows needing correction:parent"}],
            }},
            "quarantined": False,
            "quarantine_reasons": [],
        })

    lines = []
    row_ordinals = {}
    for i in range(296):
        row = active_rows[i % len(active_rows)]
        ordinal = row_ordinals.get(row, 0) + 1
        row_ordinals[row] = ordinal
        order = orders[i % 76]
        if row not in order["sheet_rows"]:
            order["sheet_rows"].append(row)
        lines.append({
            "source_id": f"order:row:{row}:component:{ordinal}",
            "order_source_id": order["source_id"],
            "sheet_row": row,
            "ordinal": ordinal,
            "payload": {"sku": f"SKU{row}-{ordinal}", "quantity_ordered": 1},
            "metadata": {"source_disposition": {
                "parent_only_assortment": False,
                "source_preimage_sha256": "a" * 64,
                "source_row_snapshot_exact": {"B": "D0001"},
            }},
        })
    for i, row in enumerate(held_rows):
        order = orders[76 + (i % 8)]
        lines.append({
            "source_id": f"order:row:{row}:parent",
            "order_source_id": order["source_id"],
            "sheet_row": row,
            "ordinal": None,
            "payload": {"sku": None, "quantity_ordered": 2},
            "metadata": {"source_disposition": {
                "parent_only_assortment": True,
                "source_preimage_sha256": "b" * 64,
                "source_row_snapshot_exact": {"B": "PARENT"},
            }},
        })
    unresolved = [
        {"source_row": row, "status": "identity_requires_existingColdmatch_disposition", "write_eligible": False}
        for row in held_rows
    ]
    skip_entries = [{"source_row": row, "existing_order_delete": False, "existing_line_delete": False} for row in skipped_rows]
    plan = {
        "artifact_type": writer.PLAN_ARTIFACT,
        "capture_source_sha256": source_hashes["latest_google_capture_sha256"],
        "source_hashes": source_hashes,
        "provenance": {
            "approved_case_count": 75,
            "source_rows_bound": 150,
            "canonical_importer_sha256": writer.sha256(
                (writer.ROOT / "shared-db" / "scripts" / "import-order-list-xlsx.py").read_bytes()
            ),
        },
        "source_disposition_counts": {
            "answer_cases": 75,
            "source_rows_bound": 150,
            "desired_headers": 84,
            "desired_lines": 316,
            "source_rows_skipped": 7,
            "rejected_rows": 0,
        },
        "orders": orders,
        "lines": lines,
        "skipped_rows": skip_entries,
        "rejected_rows": [],
        "unresolved_fields": unresolved,
    }
    return plan, source_hashes


class ExceptionWriterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan_doc, cls.source_hashes = synthetic_plan()
        cls.plan_bytes = json.dumps(cls.plan_doc, ensure_ascii=False, separators=(",", ":")).encode()
        cls.plan_sha = hashlib.sha256(cls.plan_bytes).hexdigest()
        cls.scope = writer.prepare_exception_scope(
            cls.plan_doc,
            plan_sha256=cls.plan_sha,
            expected_source_hashes=cls.source_hashes,
        )

    def test_scoped_plan_carries_the_exact_checked_importer_sha(self):
        expected = self.plan_doc["provenance"]["canonical_importer_sha256"]
        self.assertEqual(self.scope["canonical_importer_sha256"], expected)
        self.assertEqual(
            expected,
            writer.sha256((writer.ROOT / "shared-db" / "scripts" / "import-order-list-xlsx.py").read_bytes()),
        )

    def test_held_parent_lines_and_headers_are_excluded(self):
        self.assertEqual(len(self.scope["orders"]), 76)
        self.assertEqual(len(self.scope["lines"]), 296)
        self.assertEqual(len(self.scope["held_parent_only_rows"]), 20)
        self.assertEqual(len(self.scope["held_parent_only_headers"]), 8)
        self.assertEqual(len(self.scope["skipped_rows"]), 7)
        self.assertFalse(any(line["metadata"]["source_disposition"]["parent_only_assortment"] for line in self.scope["lines"]))

    def test_plan_and_answer_source_hash_mismatch_fail_closed(self):
        self.assertEqual(writer.verify_exact_plan_bytes(self.plan_bytes, self.plan_sha), self.plan_sha)
        with self.assertRaisesRegex(writer.PreflightError, "plan SHA-256 mismatch"):
            writer.verify_exact_plan_bytes(self.plan_bytes, "f" * 64)
        changed = dict(self.source_hashes)
        changed["returned_workbook_sha256"] = "e" * 64
        with self.assertRaisesRegex(writer.PreflightError, "source hash mismatch"):
            writer.prepare_exception_scope(self.plan_doc, plan_sha256=self.plan_sha, expected_source_hashes=changed)

    def test_canonical_importer_version_mismatch_fails_closed(self):
        changed = json.loads(json.dumps(self.plan_doc))
        changed["provenance"]["canonical_importer_sha256"] = "f" * 64
        with self.assertRaisesRegex(writer.PreflightError, "importer SHA-256 differs"):
            writer.prepare_exception_scope(
                changed, plan_sha256=self.plan_sha, expected_source_hashes=self.source_hashes
            )

    def test_changed_live_preimage_is_rejected(self):
        saved = {"orders": [{"id": "parent-1"}], "lines": []}
        current = {"orders": [{"id": "parent-2"}], "lines": []}
        with self.assertRaisesRegex(writer.PreflightError, "preimage changed"):
            writer.assert_preimage_unchanged(saved, current)
        writer.assert_preimage_unchanged(saved, saved)

    def test_existing_line_uuid_and_manual_accounting_item_fields_are_preserved(self):
        desired = {"sku": "SKU-1", "description": "Corrected source", "quantity_ordered": 999, "item_id": None, "status": "new", "metadata": {"source_disposition": {"approved": True}}}
        current = {"id": "line-uuid", "production_order_id": "parent-uuid", "quantity_ordered": 5, "quantity_shipped": 2, "unit_cost": 1.25, "status": "in_production", "item_id": "item-uuid", "master_data_match_status": "manual", "created_at": "created", "updated_at": "updated", "metadata": {"manual_note": "keep"}}
        merged = writer.preserved_existing_line(desired, current)
        for key in ("id", "production_order_id", "quantity_ordered", "quantity_shipped", "unit_cost", "status", "item_id", "master_data_match_status", "created_at", "updated_at"):
            self.assertEqual(merged[key], current[key])
        self.assertEqual(merged["description"], "Corrected source")
        self.assertEqual(merged["metadata"]["manual_note"], "keep")

    def test_existing_header_uuid_company_factory_and_metadata_are_preserved(self):
        merged = writer.preserved_existing_order(
            {"production_order_number": "D0001", "metadata": {"source": "Google"}},
            {"id": "header-uuid", "company_id": "company-uuid", "factory_id": "factory-uuid", "created_at": "created", "metadata": {"manual": "keep"}},
        )
        self.assertEqual(merged["id"], "header-uuid")
        self.assertEqual(merged["company_id"], "company-uuid")
        self.assertEqual(merged["factory_id"], "factory-uuid")
        self.assertEqual(merged["metadata"], {"manual": "keep", "source": "Google"})

    def test_duplicate_current_reference_mapping_is_rejected(self):
        order = self.scope["orders"][0]
        line = next(line for line in self.scope["lines"] if line["order_source_id"] == order["source_id"])
        preimages = {
            "order_refs": [
                {"source_system": writer.SOURCE_SYSTEM, "source_id": order["source_id"], "production_order_id": "parent-a"},
                {"source_system": writer.SOURCE_SYSTEM, "source_id": order["source_id"], "production_order_id": "parent-b"},
            ],
            "line_refs": [],
            "line_refs_by_uuid": [],
            "orders": [{"id": "parent-a"}, {"id": "parent-b"}],
            "lines": [],
        }
        with self.assertRaisesRegex(writer.PreflightError, "duplicate current header references"):
            writer.validate_source_ref_mappings(self.scope, preimages)

    def test_distinct_desired_headers_cannot_collapse_to_one_uuid(self):
        first, second = self.scope["orders"][0], self.scope["orders"][12]
        preimages = {
            "order_refs": [
                {"source_system": writer.SOURCE_SYSTEM, "source_id": first["source_id"], "production_order_id": "one-parent"},
                {"source_system": writer.SOURCE_SYSTEM, "source_id": second["source_id"], "production_order_id": "one-parent"},
            ],
            "line_refs": [],
            "line_refs_by_uuid": [],
            "orders": [{"id": "one-parent", "production_order_number": first["payload"]["production_order_number"]}],
            "lines": [],
        }
        with self.assertRaisesRegex(writer.PreflightError, "collapse onto one current UUID"):
            writer.validate_source_ref_mappings(self.scope, preimages)

    def test_apply_stops_until_historical_po_admission_is_reviewed(self):
        with self.assertRaisesRegex(writer.ApplyBlocked, "finite historical-PO UUID admission manifest"):
            writer.require_apply_admission()

    def test_private_output_rejects_broad_existing_directory_without_chmod(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "existing"
            output.mkdir(mode=0o700)
            output.chmod(0o755)
            with self.assertRaisesRegex(writer.PreflightError, "owned by this user and mode 0700"):
                writer.private_write(output / "report.json", {"ok": True})
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o755)
            self.assertFalse((output / "report.json").exists())

    def test_private_output_rejects_symlink_directory_and_file_targets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target_dir = root / "target"
            target_dir.mkdir(mode=0o700)
            (target_dir / "sentinel").write_text("keep")
            linked_dir = root / "linked-dir"
            linked_dir.symlink_to(target_dir, target_is_directory=True)
            with self.assertRaisesRegex(writer.PreflightError, "symlink"):
                writer.open_private_directory(linked_dir)
            target = target_dir / "sentinel"
            linked_file = target_dir / "linked-file"
            linked_file.symlink_to(target)
            with self.assertRaises(OSError):
                writer.private_write(linked_file, {"replace": True})
            self.assertTrue(linked_file.is_symlink())
            self.assertEqual(target.read_text(), "keep")
            with self.assertRaises(FileExistsError):
                writer.private_write(target, {"replace": True})
            self.assertEqual(target.read_text(), "keep")

    def test_private_output_fsyncs_file_and_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "private"
            output.mkdir(mode=0o700)
            with mock.patch.object(writer.os, "fsync", wraps=os.fsync) as fsync:
                writer.private_write(output / "report.json", {"ok": True})
            self.assertEqual(fsync.call_count, 2)

    def test_cli_error_payload_redacts_arbitrary_driver_and_source_details(self):
        secretish_error = RuntimeError("driver detail customer PO=D0623 licensed-source-row=7545")
        payload = json.dumps(writer.cli_error_payload(secretish_error))
        self.assertEqual(json.loads(payload), {
            "error_code": "read_only_preflight_failed",
            "apply_enabled": False,
        })
        self.assertNotIn("D0623", payload)
        self.assertNotIn("7545", payload)
        self.assertNotIn("driver detail", payload)

        stderr = io.StringIO()
        argv = [
            "writer", "--plan", "private.xlsx", "--expected-plan-sha256", "a" * 64,
            "--expected-answer-packet-sha256", "b" * 64,
            "--expected-returned-workbook-sha256", "c" * 64,
            "--expected-google-capture-sha256", "d" * 64,
            "--recovery-dir", "/private/recovery",
        ]
        with mock.patch.object(writer.sys, "argv", argv), mock.patch.object(
            writer, "run", side_effect=secretish_error
        ), contextlib.redirect_stderr(stderr):
            self.assertEqual(writer.main(), 2)
        self.assertEqual(json.loads(stderr.getvalue()), {
            "error_code": "read_only_preflight_failed",
            "apply_enabled": False,
        })
        self.assertNotIn("D0623", stderr.getvalue())
        self.assertNotIn("7545", stderr.getvalue())

    def test_read_only_target_proof_uses_live_identity_without_project_ref_file(self):
        expected = writer.IMPORTER.ServerIdentity(
            project_ref=writer.TARGET,
            host=writer.TARGET_HOST,
            port=5432,
            database="postgres",
            user=f"postgres.{writer.TARGET}",
            fingerprint=("postgres", "127.0.0.1", "2026-10-13 00:00:00+00"),
        )
        observed = {}

        def prove(connection, *, expected_ref, mode):
            observed.update(expected_ref=expected_ref, mode=mode, connection=connection)
            return expected

        sentinel_connection = object()
        with mock.patch.object(writer.IMPORTER, "assert_server_is_target", side_effect=prove):
            result = writer.proven_database_identity(sentinel_connection)
        self.assertEqual(observed["expected_ref"], writer.TARGET)
        self.assertEqual(observed["mode"], writer.READ_ONLY_MODE)
        self.assertIs(observed["connection"], sentinel_connection)
        self.assertEqual(result["fingerprint"], expected.fingerprint)
        self.assertEqual(result["user"], expected.user)

    def test_database_identity_requires_exact_virginia_endpoint(self):
        identity = {
            "project_ref": writer.TARGET,
            "host": writer.TARGET_HOST,
            "port": writer.TARGET_PORT,
            "database": writer.TARGET_DATABASE,
            "user": writer.TARGET_USER,
            "fingerprint": ["postgres", "127.0.0.1", "synthetic-start"],
        }
        writer.validate_database_identity(identity)
        for key, value in (
            ("host", f"{writer.TARGET_HOST}.attacker.invalid"),
            ("port", 6543),
            ("database", "other"),
            ("user", f"postgres.other-project"),
        ):
            altered = {**identity, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(writer.PreflightError, "Virginia target"):
                writer.validate_database_identity(altered)


if __name__ == "__main__":
    unittest.main(verbosity=2)
