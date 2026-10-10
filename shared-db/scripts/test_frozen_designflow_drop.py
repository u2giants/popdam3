#!/usr/bin/env python3
"""Synthetic tests for issue #2110 frozen-schema drop migration.

Parses the migration SQL and asserts structural properties that would make
the drop incorrect or unsafe. Each test can fail on the property it guards.
"""
import re
import sys
from pathlib import Path

MIGRATION = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "20261010033616_drop_frozen_designflow_schema.sql"

TABLES = ["Factory", "Roles", "art_piece", "artists", "comments", "customers", "product_category"]
SEQUENCES = ["Factory_id_seq", "Roles_Id_seq", "StandardizedVersionDetail_id_seq",
             "StandardizedVersion_id_seq", "art_piece_id_seq", "artists_id_seq",
             "comments_id_seq", "customers_customers_id_seq", "product_category_id_seq"]

def read_migration() -> str:
    return MIGRATION.read_text(encoding="utf-8")

def strip_comments(sql: str) -> str:
    return "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))

def test_migration_exists():
    assert MIGRATION.exists(), f"Migration not found: {MIGRATION}"

def test_single_transaction():
    sql = strip_comments(read_migration())
    assert sql.count("BEGIN;") == 1, "Expected exactly one BEGIN"
    assert sql.count("COMMIT;") == 1, "Expected exactly one COMMIT"

def test_no_cascade():
    for line in read_migration().splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        assert "CASCADE" not in line, f"CASCADE found in SQL line: {line}"

def test_all_drops_use_restrict():
    clean = strip_comments(read_migration())
    drops = re.findall(r"DROP\s+(?:TABLE|SEQUENCE|SCHEMA)[^;]+;", clean, re.IGNORECASE | re.DOTALL)
    assert len(drops) >= 3, f"Expected at least 3 DROP statements, found {len(drops)}"
    for d in drops:
        assert "RESTRICT" in d, f"DROP without RESTRICT: {d[:80]}"

def test_drop_table_lists_all_seven():
    clean = strip_comments(read_migration())
    match = re.search(r"DROP\s+TABLE\s+(.+?)\s+RESTRICT;", clean, re.IGNORECASE | re.DOTALL)
    assert match, "No DROP TABLE ... RESTRICT found"
    body = match.group(1)
    for t in TABLES:
        assert f'"{t}"' in body or f'.{t}' in body or f'.{t}\n' in body or f'.{t},' in body or f'.{t} ' in body, f"Table {t} not in DROP TABLE list"

def test_drop_sequence_lists_all_nine():
    clean = strip_comments(read_migration())
    match = re.search(r"DROP\s+SEQUENCE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+RESTRICT;", clean, re.IGNORECASE | re.DOTALL)
    assert match, "No DROP SEQUENCE ... RESTRICT found"
    body = match.group(1)
    for s in SEQUENCES:
        assert f'designflow_frozen_20260710.{s}' in body or f'designflow_frozen_20260710."{s}"' in body, f"Sequence {s} not schema-qualified in DROP SEQUENCE"

def test_drop_schema_restrict():
    clean = strip_comments(read_migration())
    assert re.search(r"DROP\s+SCHEMA\s+designflow_frozen_20260710\s+RESTRICT", clean, re.IGNORECASE), "Expected DROP SCHEMA ... RESTRICT"

def test_inventory_checks_collate_c():
    sql = read_migration()
    collate_count = sql.count('COLLATE "C"')
    assert collate_count >= 2, f"Expected at least 2 COLLATE \"C\" in inventory ORDER BY, found {collate_count}"

def test_timeouts_set():
    sql = read_migration()
    assert "SET LOCAL lock_timeout = '10s'" in sql, "Missing or wrong lock_timeout"
    assert "SET LOCAL statement_timeout = '120s'" in sql, "Missing or wrong statement_timeout"

def test_guard_precedes_lock():
    sql = read_migration()
    guard_pos = sql.find("to_regnamespace('designflow_frozen_20260710') IS NULL")
    lock_pos = sql.find("LOCK TABLE")
    assert guard_pos < lock_pos, "Guard must precede LOCK TABLE"

def test_relkind_guard_present():
    sql = read_migration()
    assert "relkind NOT IN" in sql, "Missing relkind guard"

def test_drop_targets_schema_qualified():
    clean = strip_comments(read_migration())
    match = re.search(r"DROP\s+TABLE\s+(.+?)\s+RESTRICT;", clean, re.IGNORECASE | re.DOTALL)
    assert match, "No DROP TABLE found"
    body = match.group(1)
    assert "designflow_frozen_20260710." in body, "DROP TABLE targets must be schema-qualified"

def test_clean_already_applied_exit():
    sql = read_migration()
    assert "to_regnamespace('designflow_frozen_20260710') IS NULL" in sql, "Missing already-applied guard"
    assert "RETURN;" in sql, "Missing RETURN for clean exit"

def test_fk_definiton_pins_present():
    sql = read_migration()
    # Both FK checks must contain full definition pins
    fk_blocks = re.findall(r"art_piece_attachment_art_piece_id_fkey.*?RAISE EXCEPTION", sql, re.DOTALL)
    fk_blocks += re.findall(r"RolePermissions_RoleId_fkey.*?RAISE EXCEPTION", sql, re.DOTALL)
    assert len(fk_blocks) >= 2, "Expected 2 FK precondition blocks"
    for block in fk_blocks:
        for prop in ["convalidated", "array_length(con.conkey, 1) = 1", "array_length(con.confkey, 1) = 1",
                     "confupdtype = 'a'", "confdeltype = 'a'", "confmatchtype = 's'"]:
            assert prop in block, f"Missing FK pin in block: {prop}"

def test_function_set_assertion():
    sql = read_migration()
    assert "get_child_id" in sql, "Missing get_child_id in function assertion"
    assert "get_parent_id" in sql, "Missing get_parent_id in function assertion"
    assert "prokind = 'f'" in sql, "Missing prokind filter"

def test_inbound_fk_precondition():
    sql = read_migration()
    assert "inbound foreign key" in sql.lower(), "Missing inbound FK precondition"

def test_postcondition():
    sql = read_migration()
    assert "to_regnamespace('designflow_frozen_20260710') IS NOT NULL" in sql, "Missing schema-absent postcondition"

def test_derived_from_header():
    sql = read_migration()
    assert "-- derived-from: none" in sql, "Missing derived-from header"

def test_schema_name_correct():
    sql = read_migration()
    assert "designflow_frozen_20260710" in sql, "Missing frozen schema name"
    # No reference to the old pre-rename name
    assert "designflow_frozen" not in sql.replace("designflow_frozen_20260710", ""), "Unexpected partial schema name"

if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
