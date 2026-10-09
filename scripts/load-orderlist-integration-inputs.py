#!/usr/bin/env python3
"""Guarded, one-time loader for the frozen OrderList auxiliary inputs.

The default mode validates only. Database access requires --apply, a private
password file, a private recovery directory, and an exact-head review report.
This loader never creates schema or changes canonical order or product rows.
"""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from typing import Any, Iterable
import uuid


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = "13bc64585bb5ec26e977fa948e6c59dfcf1b489e463fbe5e6151016ebd36fb4d"
SOURCE_COUNTS = {"sample_depth": 8257, "customer_settings": 38, "tracking": 3147}
HELD_TRACKING_COUNT = 71
CONTRACT_FILE = ROOT / "shared-db/supabase/migrations/20261009073649_popdam_orderlist_sheets_integration.sql"
CONTRACT_SHA256 = "bbe83b7db3ac4eb67a1468da83f32d1d9a5a75695decdf09a2957bcf6b31e590"
TARGET_PROJECT = "qsllyeztdwjgirsysgai"
TARGET_HOST = "aws-1-us-east-1.pooler.supabase.com"
TARGET_PORT = 5432
TARGET_DATABASE = "postgres"

SOURCE_KEYS = {"sample_depth", "customer_settings", "tracking", "held_tracking",
               "source_digests", "selection_rule"}
DEPTH_SOURCE_COLUMNS = {"sku_normalized", "customer_normalized", "depth_inches",
                        "depth_raw", "source_workbook_id", "source_row_number"}
SETTING_SOURCE_COLUMNS = {"customer_normalized", "suffix"}
TRACKING_SOURCE_COLUMNS = {
    "order_id", "source_po", "source_row", "agent", "cbm", "comment", "vessel",
    "sent_to_coldlion", "worksheet_done", "inspection_passed", "inspection_note",
    "document_invoice", "document_packing_list", "document_bill_of_lading",
    "document_tsca", "document_lacey_act", "document_telex", "request_wire",
    "payment_note",
}

DEPTH_COLUMNS = tuple(sorted(DEPTH_SOURCE_COLUMNS))
SETTING_COLUMNS = tuple(sorted(SETTING_SOURCE_COLUMNS))
TRACKING_COLUMNS = (
    "order_id", "agent", "cbm", "comment", "vessel", "sent_to_coldlion",
    "worksheet_done", "inspection_passed", "inspection_note", "document_invoice",
    "document_packing_list", "document_bill_of_lading", "document_tsca",
    "document_lacey_act", "document_telex", "request_wire", "payment_note",
)
TABLES = (
    ("dam.orderlist_sample_depth", DEPTH_COLUMNS, ("sku_normalized", "customer_normalized")),
    ("dam.orderlist_customer_settings", SETTING_COLUMNS, ("customer_normalized",)),
    ("dam.order_tracking_ext", TRACKING_COLUMNS, ("order_id",)),
)
TRACKING_BOOL_COLUMNS = {
    "sent_to_coldlion", "worksheet_done", "document_invoice", "document_packing_list",
    "document_bill_of_lading", "document_tsca", "document_lacey_act", "document_telex",
    "request_wire",
}
TRACKING_TEXT_COLUMNS = {"agent", "comment", "vessel", "inspection_note", "payment_note"}


def _sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _assert_contract() -> None:
    try:
        actual = _sha256_bytes(CONTRACT_FILE.read_bytes())
    except OSError:
        raise ValueError("Reviewed SQL contract is unavailable") from None
    if actual != CONTRACT_SHA256:
        raise ValueError("Reviewed SQL contract changed")


def _normalized(value: Any) -> str:
    return str(value).strip().casefold()


def _decimal_or_none(value: Any, *, positive: bool, label: str) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"Invalid {label}")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f"Invalid {label}") from None
    if not number.is_finite() or (number <= 0 if positive else number < 0):
        raise ValueError(f"Invalid {label}")
    return number


def _nullable_text(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"Invalid {label}")
    return value


def _strict_bool(value: Any, label: str) -> bool | None:
    if value is None or type(value) is bool:
        return value
    raise ValueError(f"Invalid {label}")


def _strict_date(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Invalid tracking date")
    from datetime import date

    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError("Invalid tracking date") from None
    if parsed.isoformat() != value:
        raise ValueError("Invalid tracking date")
    return parsed


def _check_closed(row: dict[str, Any], expected: set[str], label: str) -> None:
    if not isinstance(row, dict) or set(row) != expected:
        raise ValueError(f"{label} columns changed")


def _ensure_unique(rows: Iterable[tuple[Any, ...]], label: str) -> None:
    seen: set[tuple[Any, ...]] = set()
    for identity in rows:
        if identity in seen:
            raise ValueError(f"Duplicate {label} identity")
        seen.add(identity)


def validate_source_bytes(raw: bytes, expected_sha256: str = SOURCE_SHA256,
                          expected_counts: dict[str, int] = SOURCE_COUNTS,
                          expected_held: int = HELD_TRACKING_COUNT) -> dict[str, Any]:
    """Validate and normalize the immutable payload without opening a database."""
    if _sha256_bytes(raw) != expected_sha256:
        raise ValueError("Source checksum mismatch")
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("Source JSON is invalid") from None
    if not isinstance(data, dict) or set(data) != SOURCE_KEYS:
        raise ValueError("Source envelope changed")
    groups = {key: data[key] for key in SOURCE_COUNTS}
    if any(not isinstance(rows, list) or len(rows) != expected_counts[key]
           for key, rows in groups.items()):
        raise ValueError("Source row counts changed")
    if not isinstance(data["held_tracking"], list) or len(data["held_tracking"]) != expected_held:
        raise ValueError("Held source count changed")
    if not isinstance(data["source_digests"], dict) or not isinstance(data["selection_rule"], str):
        raise ValueError("Source provenance changed")

    depth_rows: list[tuple[Any, ...]] = []
    for row in groups["sample_depth"]:
        _check_closed(row, DEPTH_SOURCE_COLUMNS, "Sample depth")
        sku, customer = row["sku_normalized"], row["customer_normalized"]
        if not isinstance(sku, str) or not sku or sku != sku.strip().casefold():
            raise ValueError("Invalid sample-depth style identity")
        if not isinstance(customer, str) or not customer or customer != customer.strip().casefold():
            raise ValueError("Invalid sample-depth customer identity")
        depth = _decimal_or_none(row["depth_inches"], positive=True, label="sample depth")
        raw_depth = _nullable_text(row["depth_raw"], "raw sample depth")
        workbook = _nullable_text(row["source_workbook_id"], "sample-depth source")
        source_row = row["source_row_number"]
        if type(source_row) is not int or source_row <= 0:
            raise ValueError("Invalid sample-depth source row")
        depth_rows.append({"sku_normalized": sku, "customer_normalized": customer,
                           "depth_inches": depth, "depth_raw": raw_depth,
                           "source_workbook_id": workbook, "source_row_number": source_row})
    _ensure_unique(((r["sku_normalized"], r["customer_normalized"]) for r in depth_rows), "sample-depth")

    setting_rows: list[tuple[Any, ...]] = []
    for row in groups["customer_settings"]:
        _check_closed(row, SETTING_SOURCE_COLUMNS, "Customer settings")
        customer, suffix = row["customer_normalized"], row["suffix"]
        if not isinstance(customer, str) or not customer or customer != customer.strip().casefold():
            raise ValueError("Invalid customer-settings identity")
        if not isinstance(suffix, str) or not 1 <= len(suffix.strip()) <= 50 or suffix != suffix.strip():
            raise ValueError("Invalid customer suffix")
        setting_rows.append({"customer_normalized": customer, "suffix": suffix})
    _ensure_unique(((r["customer_normalized"],) for r in setting_rows), "customer-settings")

    tracking_rows: list[tuple[Any, ...]] = []
    tracking_po_by_id: dict[str, str] = {}
    for row in groups["tracking"]:
        _check_closed(row, TRACKING_SOURCE_COLUMNS, "Tracking")
        try:
            order_id = str(uuid.UUID(row["order_id"]))
        except (ValueError, TypeError, AttributeError):
            raise ValueError("Invalid tracking order identity") from None
        po = row["source_po"]
        if not isinstance(po, str) or not po.strip():
            raise ValueError("Invalid tracking PO identity")
        source_row = row["source_row"]
        if type(source_row) is not int or source_row <= 0:
            raise ValueError("Invalid tracking source row")
        normalized_po = _normalized(po)
        if order_id in tracking_po_by_id or normalized_po in tracking_po_by_id.values():
            raise ValueError("Duplicate tracking identity")
        tracking_po_by_id[order_id] = normalized_po
        values: dict[str, Any] = {"order_id": uuid.UUID(order_id)}
        for key in TRACKING_COLUMNS[1:]:
            value = row[key]
            if key == "cbm":
                values[key] = _decimal_or_none(value, positive=False, label="tracking CBM")
            elif key == "inspection_passed":
                values[key] = _strict_date(value)
            elif key in TRACKING_BOOL_COLUMNS:
                values[key] = _strict_bool(value, key)
            elif key in TRACKING_TEXT_COLUMNS:
                values[key] = _nullable_text(value, key)
            else:
                raise ValueError("Unexpected tracking column")
        tracking_rows.append(tuple(values[column] for column in TRACKING_COLUMNS))
    _ensure_unique(((str(row[0]),) for row in tracking_rows), "tracking")

    return {
        "source_sha256": expected_sha256,
        "counts": {key: len(rows) for key, rows in groups.items()},
        "held_tracking": len(data["held_tracking"]),
        "sample_depth": [tuple(row[column] for column in DEPTH_COLUMNS) for row in depth_rows],
        "customer_settings": [tuple(row[column] for column in SETTING_COLUMNS) for row in setting_rows],
        "tracking": [tuple(row) for row in tracking_rows],
        "tracking_po_by_id": tracking_po_by_id,
    }


def _private_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if (path.is_symlink() or not stat.S_ISDIR(info.st_mode) or
            info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("Recovery directory must be private")


def _write_new_private(path: Path, content: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    directory_fd = os.open(path.parent, directory_flags)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _read_private_json(path: Path) -> dict[str, Any]:
    info = path.lstat()
    if (stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or
            info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("Recovery evidence must be private")
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        raise ValueError("Recovery evidence is invalid") from None
    if not isinstance(value, dict):
        raise ValueError("Recovery evidence is invalid")
    return value


def _digest(value: Any) -> str:
    packed = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    return _sha256_bytes(packed)


def _row_json(row: tuple[Any, ...], columns: tuple[str, ...]) -> dict[str, Any]:
    return {column: value for column, value in zip(columns, row, strict=True)}


def _identity_key(row: dict[str, Any], identity: tuple[str, ...]) -> str:
    return json.dumps([row[key] for key in identity], separators=(",", ":"), default=str)


def _assert_target(conn: Any) -> None:
    info = conn.info
    database = conn.execute("select current_database()").fetchone()[0]
    if (info.host != TARGET_HOST or info.port != TARGET_PORT or
            info.user != "postgres." + TARGET_PROJECT or database != TARGET_DATABASE):
        raise ValueError("Database target proof failed")


def _lock_and_assert_empty(conn: Any) -> None:
    _lock_tables(conn)
    if not conn.execute("select pg_try_advisory_xact_lock(852000728)").fetchone()[0]:
        raise ValueError("Another auxiliary-data load is active")
    for table, _, _ in TABLES:
        if conn.execute(f"select exists(select 1 from {table} limit 1)").fetchone()[0]:
            raise ValueError("Initial-load destination is not empty")


def _lock_tables(conn: Any) -> None:
    for table, _, _ in TABLES:
        conn.execute(f"lock table {table} in access exclusive mode nowait")


def _validate_po_pairs(conn: Any, expected: dict[str, str]) -> None:
    ids = [uuid.UUID(value) for value in expected]
    found = conn.execute(
        "select id, customer_po_number from plm.production_order where id = any(%s) for share",
        (ids,),
    ).fetchall()
    actual = {str(order_id): _normalized(po) for order_id, po in found}
    if actual != expected:
        raise ValueError("Canonical PO identity validation failed")


def _copy_rows(conn: Any, table: str, columns: tuple[str, ...], rows: list[tuple[Any, ...]]) -> int:
    from psycopg import sql

    schema, name = table.split(".", 1)
    statement = sql.SQL("copy {}.{} ({}) from stdin").format(
        sql.Identifier(schema), sql.Identifier(name),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
    )
    with conn.cursor().copy(statement) as copy:
        for row in rows:
            copy.write_row(row)
    return len(rows)


def _current_row_hash(conn: Any, table: str, identity: tuple[str, ...], payload: dict[str, Any]) -> str | None:
    from psycopg import sql

    schema, name = table.split(".", 1)
    where = sql.SQL(" and ").join(sql.SQL("{} = %s").format(sql.Identifier(key)) for key in identity)
    select = sql.SQL("select to_jsonb(t) from {}.{} t where {}").format(
        sql.Identifier(schema), sql.Identifier(name), where,
    )
    found = conn.execute(select, tuple(payload[key] for key in identity)).fetchall()
    return _digest(found[0][0]) if len(found) == 1 else None


def _capture_full_row_hashes(conn: Any) -> dict[str, dict[str, str]]:
    hashes: dict[str, dict[str, str]] = {}
    for table, _, identity in TABLES:
        rows = conn.execute(f"select to_jsonb(t) from {table} t").fetchall()
        table_hashes = {}
        for (row,) in rows:
            key = _identity_key(row, identity)
            if key in table_hashes:
                raise ValueError("Inserted row identity was duplicated")
            table_hashes[key] = _digest(row)
        hashes[table] = table_hashes
    return hashes


def rollback_inserted_rows(conn: Any, evidence: dict[str, Any]) -> dict[str, int]:
    """Delete only exact rows recorded by this loader after confirming equality."""
    expected_counts = {TABLES[0][0]: SOURCE_COUNTS["sample_depth"],
                       TABLES[1][0]: SOURCE_COUNTS["customer_settings"],
                       TABLES[2][0]: SOURCE_COUNTS["tracking"]}
    if (set(evidence) != {"format", "source_sha256", "held_tracking_count", "inserted_counts", "inserted_rows",
                          "inserted_rows_sha256", "row_hashes", "row_hashes_sha256"} or evidence.get("format") != 1 or
            evidence.get("source_sha256") != SOURCE_SHA256 or
            evidence.get("held_tracking_count") != HELD_TRACKING_COUNT or
            evidence.get("inserted_counts") != expected_counts):
        raise ValueError("Rollback evidence is not recognized")
    inserted_rows = evidence.get("inserted_rows")
    row_hashes = evidence.get("row_hashes")
    if (not isinstance(inserted_rows, dict) or set(inserted_rows) != set(expected_counts) or
            any(not isinstance(inserted_rows[table], list) or
                len(inserted_rows[table]) != expected_counts[table]
                for table in expected_counts) or
            _digest(inserted_rows) != evidence.get("inserted_rows_sha256") or
            not isinstance(row_hashes, dict) or set(row_hashes) != set(expected_counts) or
            _digest(row_hashes) != evidence.get("row_hashes_sha256")):
        raise ValueError("Rollback evidence checksum mismatch")
    from psycopg import sql

    deleted: dict[str, int] = {}
    for table, columns, identity in reversed(TABLES):
        rows = inserted_rows.get(table)
        expected_hashes = row_hashes.get(table)
        if (not isinstance(rows, list) or not isinstance(expected_hashes, dict) or
                set(expected_hashes) != {_identity_key(row, identity) for row in rows}):
            raise ValueError("Rollback evidence is incomplete")
        for payload in rows:
            if (set(payload) != set(columns) or
                    _current_row_hash(conn, table, identity, payload) != expected_hashes[_identity_key(payload, identity)]):
                raise ValueError("Rollback row no longer matches inserted identity")
        schema, name = table.split(".", 1)
        where = sql.SQL(" and ").join(sql.SQL("{} = %s").format(sql.Identifier(key)) for key in identity)
        delete = sql.SQL("delete from {}.{} where {}").format(sql.Identifier(schema), sql.Identifier(name), where)
        removed = 0
        for payload in rows:
            cursor = conn.execute(delete, tuple(payload[key] for key in identity))
            removed += cursor.rowcount
        if removed != len(rows):
            raise ValueError("Rollback identity count changed")
        deleted[table] = removed
    return deleted


def load_transaction(conn: Any, payload: dict[str, Any], evidence_path: Path) -> dict[str, Any]:
    """Lock, re-prove target, COPY the three tables, and commit exactly once."""
    expected = {TABLES[0][0]: SOURCE_COUNTS["sample_depth"],
                TABLES[1][0]: SOURCE_COUNTS["customer_settings"],
                TABLES[2][0]: SOURCE_COUNTS["tracking"]}
    inserted_rows = {
        TABLES[0][0]: [_row_json(row, DEPTH_COLUMNS) for row in payload["sample_depth"]],
        TABLES[1][0]: [_row_json(row, SETTING_COLUMNS) for row in payload["customer_settings"]],
        TABLES[2][0]: [_row_json(row, TRACKING_COLUMNS) for row in payload["tracking"]],
    }
    evidence = {
        "format": 1,
        "source_sha256": SOURCE_SHA256,
        "held_tracking_count": payload["held_tracking"],
        "inserted_counts": expected,
        "inserted_rows": inserted_rows,
        "inserted_rows_sha256": _digest(inserted_rows),
    }
    recovery_written = False
    try:
        with conn.transaction():
            _lock_and_assert_empty(conn)
            _assert_target(conn)
            _validate_po_pairs(conn, payload["tracking_po_by_id"])
            # Re-prove the target and empty-table contract directly before the first COPY.
            _assert_target(conn)
            for table, _, _ in TABLES:
                if conn.execute(f"select exists(select 1 from {table} limit 1)").fetchone()[0]:
                    raise ValueError("Initial-load destination changed before write")
            counts = {}
            rows_by_table = (payload["sample_depth"], payload["customer_settings"], payload["tracking"])
            for (table, columns, _), rows in zip(TABLES, rows_by_table, strict=True):
                counts[table] = _copy_rows(conn, table, columns, rows)
            actual = {table: conn.execute(f"select count(*) from {table}").fetchone()[0]
                      for table, _, _ in TABLES}
            if counts != expected or actual != expected:
                raise ValueError("Inserted row counts do not match the frozen source")
            row_hashes = _capture_full_row_hashes(conn)
            if any(len(row_hashes[table]) != expected[table] for table in expected):
                raise ValueError("Inserted row identity counts changed")
            evidence["row_hashes"] = row_hashes
            evidence["row_hashes_sha256"] = _digest(row_hashes)
            _write_new_private(evidence_path, json.dumps(evidence, sort_keys=True, default=str).encode())
            recovery_written = True
    except Exception:
        # A failed commit can have an unknown server outcome; retain evidence
        # once it has been fully written so rollback can verify actual rows.
        if not recovery_written:
            evidence_path.unlink(missing_ok=True)
        raise
    return {"source_sha256": SOURCE_SHA256, "inserted_counts": expected}


def _read_password(path: Path) -> str:
    info = path.stat()
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or mode & 0o077:
        raise ValueError("Password file must be private")
    return path.read_text().rstrip("\r\n")


def _connect_to_target(psycopg_module: Any, password: str) -> Any:
    return psycopg_module.connect(
        host=TARGET_HOST,
        port=TARGET_PORT,
        user="postgres." + TARGET_PROJECT,
        dbname=TARGET_DATABASE,
        password=password,
        connect_timeout=15,
        sslmode="require",
    )


def _safe_failure_message(error: Exception) -> str:
    if type(error).__module__.startswith("psycopg"):
        return ("Database operation failed safely (" + type(error).__name__ +
                "). Check the protected recovery evidence and database state before retrying.")
    if isinstance(error, (OSError, ValueError, subprocess.CalledProcessError)):
        return str(error)
    return "Loader failed safely (" + type(error).__name__ + ")"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--recovery-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="perform the guarded one-time transaction")
    parser.add_argument("--rollback", action="store_true", help="remove only exact rows from loader recovery evidence")
    parser.add_argument("--rollback-evidence", type=Path)
    parser.add_argument("--password-file", type=Path)
    parser.add_argument("--reviewer-approval", type=Path)
    args = parser.parse_args(argv)

    _assert_contract()
    raw = args.source.read_bytes()
    payload = validate_source_bytes(raw)
    if args.apply and args.rollback:
        raise ValueError("Apply and rollback are separate actions")
    if args.rollback:
        if args.rollback_evidence is None or not args.password_file or not args.reviewer_approval:
            raise ValueError("Rollback requires exact recovery evidence and guarded access")
        subprocess.run(["ai-task-gates", "check", "--before", "database",
                        "--reviewer-approval", str(args.reviewer_approval)], check=True)
        evidence = _read_private_json(args.rollback_evidence)
        import psycopg

        conn = _connect_to_target(psycopg, _read_password(args.password_file))
        try:
            with conn.transaction():
                _lock_tables(conn)
                _assert_target(conn)
                deleted = rollback_inserted_rows(conn, evidence)
        finally:
            conn.close()
        print(json.dumps({"rolled_back_counts": deleted, "database_touched": True}))
        return 0
    if not args.apply:
        print(json.dumps({"source_sha256": SOURCE_SHA256, "counts": payload["counts"],
                          "held_tracking": payload["held_tracking"], "database_touched": False}))
        return 0
    if not args.password_file or not args.reviewer_approval:
        raise ValueError("Apply requires protected credentials and exact-head review")
    _private_directory(args.recovery_dir)
    evidence_path = args.recovery_dir / "orderlist-auxiliary-load-recovery.json"
    if evidence_path.exists():
        raise ValueError("Recovery evidence already exists")
    subprocess.run(["ai-task-gates", "check", "--before", "database",
                    "--reviewer-approval", str(args.reviewer_approval)], check=True)
    import psycopg

    conn = _connect_to_target(psycopg, _read_password(args.password_file))
    try:
        result = load_transaction(conn, payload, evidence_path)
    finally:
        conn.close()
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(_safe_failure_message(exc), file=sys.stderr)
        raise SystemExit(2)
