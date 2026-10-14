#!/usr/bin/env python3
"""Show Yuchen's 20 confirmed special-assortment pairs once (#277).

Each pair is one purchase recorded twice: a Google Order row whose special
assortment the importer cannot expand, and the ColdLion line for the same
customer PO, assortment, production PO and quantity. Yuchen (2026-10-14):
keep each pair once as a special assortment entry, quantity counted once,
Google order and tracking details kept, factory PO groups D3682-D3689 separate.

For each entry this moves the existing ColdLion line under its existing Google
production-order header, copies the Google line dates, and adds the Google
line source ref. Nothing is deleted; ColdLion refs and raw source stay intact.

Dry-run is the default. --apply needs the pinned plan SHA and an exact-head
AI reviewer report accepted by `ai-task-gates check --before database`.
The database password is read from stdin, never from arguments.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.parse
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = "qsllyeztdwjgirsysgai"
POOLER_HOST = "aws-1-us-east-1.pooler.supabase.com"
CA_FILE = ROOT / "shared-db" / "scripts" / "certs" / "supabase-root-2021.crt"
PLAN_SCHEMA = "popdam-assortment20-plan/v1"
EXPECTED_ENTRIES = 20
SET_FIELDS = ("start_ship_date", "start_ship_raw", "cancel_date", "cancel_raw", "cargo_forecast_date")
DATE_FIELDS = {"start_ship_date", "cancel_date", "cargo_forecast_date"}
GOOGLE = "google_order_list"


class Refused(RuntimeError):
    pass


def google_ref_uuid(source_id: str) -> str:
    # Same deterministic identity the #367 consolidation used for missing Google refs.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "popdam-orderlist-google-line-ref:" + source_id))


def load_plan(path: Path, expected_sha: str) -> dict:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha:
        raise Refused("plan checksum mismatch")
    plan = json.loads(raw)
    entries = plan.get("entries")
    if plan.get("schema") != PLAN_SCHEMA or not isinstance(entries, list) or len(entries) != EXPECTED_ENTRIES:
        raise Refused("plan must hold exactly 20 entries of the pinned schema")
    seen = set()
    for e in entries:
        if set(e) != {"target_po", "customer_po", "coldlion_so", "sku", "google_source_id", "quantity", "set"} or set(e["set"]) != set(SET_FIELDS):
            raise Refused("plan entry has unexpected fields")
        for field in DATE_FIELDS:
            date.fromisoformat(e["set"][field])
        key = (e["customer_po"], e["sku"])
        if key in seen or e["google_source_id"] in seen:
            raise Refused("plan entries are not one-to-one")
        seen.update({key, e["google_source_id"]})
    return plan


def read_state(conn, plan: dict) -> list[dict]:
    """Resolve and validate every entry against live rows; refuse on any doubt."""
    state = []
    for e in plan["entries"]:
        lines = conn.execute(
            """select l.id::text, l.production_order_id::text, o.production_order_number, l.quantity_ordered
               from plm.production_order_line l join plm.production_order o on o.id = l.production_order_id
               where o.production_order_number = %s and l.sku = %s and l.customer_po_number = %s""",
            (e["coldlion_so"], e["sku"], e["customer_po"]),
        ).fetchall()
        if len(lines) != 1:
            raise Refused(f"expected one ColdLion line for {e['customer_po']} {e['sku']}, found {len(lines)}")
        line_id, from_order, _, qty = lines[0]
        if qty is None or Decimal(qty) != Decimal(str(e["quantity"])):
            raise Refused(f"quantity for {e['customer_po']} {e['sku']} differs from Yuchen's confirmed {e['quantity']}")
        refs = conn.execute(
            "select source_system, source_id from plm.production_order_line_source_ref where production_order_line_id = %s",
            (line_id,),
        ).fetchall()
        if [r[0] for r in refs] != ["coldlion"]:
            raise Refused(f"line {line_id} is not an unmerged ColdLion-only line")
        if conn.execute("select count(*) from plm.production_order_line_source_ref where source_system = %s and source_id = %s",
                        (GOOGLE, e["google_source_id"])).fetchone()[0]:
            raise Refused(f"Google ref {e['google_source_id']} already exists")
        targets = conn.execute(
            """select o.id::text from plm.production_order o
               where o.production_order_number = %s
                 and exists (select 1 from plm.production_order_source_ref r where r.production_order_id = o.id and r.source_system = %s)""",
            (e["target_po"], GOOGLE),
        ).fetchall()
        if len(targets) != 1:
            raise Refused(f"expected one Google header {e['target_po']}")
        state.append({"entry": e, "line_id": line_id, "from_order": from_order, "to_order": targets[0][0], "quantity": str(qty)})
    if len({s["line_id"] for s in state}) != EXPECTED_ENTRIES:
        raise Refused("two entries resolved to the same line")
    return state


def apply(conn, state: list[dict]) -> None:
    from psycopg.types.json import Jsonb

    lines_before = conn.execute("select count(*) from plm.production_order_line").fetchone()[0]
    refs_before = conn.execute("select count(*) from plm.production_order_line_source_ref").fetchone()[0]
    for s in state:
        e = s["entry"]
        cur = conn.execute(
            "update plm.production_order_line set production_order_id = %s, "
            + ", ".join(f"{f} = %s" for f in SET_FIELDS)
            + ", updated_at = now() where id = %s and production_order_id = %s",
            (s["to_order"], *[e["set"][f] for f in SET_FIELDS], s["line_id"], s["from_order"]),
        )
        if cur.rowcount != 1:
            raise Refused(f"line {s['line_id']} changed during apply")
        conn.execute(
            "insert into plm.production_order_line_source_ref (id, production_order_line_id, source_system, source_id, is_primary, metadata) "
            "values (%s, %s, %s, %s, true, %s)",
            (google_ref_uuid(e["google_source_id"]), s["line_id"], GOOGLE, e["google_source_id"],
             Jsonb({"origin": "issue277-assortment-pair", "owner_decision": "Yuchen 2026-10-14"})),
        )
    if conn.execute("select count(*) from plm.production_order_line").fetchone()[0] != lines_before:
        raise Refused("line count changed")
    if conn.execute("select count(*) from plm.production_order_line_source_ref").fetchone()[0] != refs_before + EXPECTED_ENTRIES:
        raise Refused("line ref count is not exactly +20")
    for s in state:
        e = s["entry"]
        row = conn.execute(
            "select production_order_id::text, " + ", ".join(f"{f}::text" for f in SET_FIELDS) + ", quantity_ordered::text "
            "from plm.production_order_line where id = %s", (s["line_id"],)
        ).fetchone()
        if row[0] != s["to_order"] or list(row[1:6]) != [e["set"][f] for f in SET_FIELDS] or row[6] != s["quantity"]:
            raise Refused(f"readback mismatch for line {s['line_id']}")


def check_gate(report: Path) -> None:
    result = subprocess.run(["/usr/local/bin/ai-task-gates", "check", "--before", "database", "--reviewer-approval", str(report)],
                            cwd=ROOT, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise Refused("database task gate refused")


def connect(password: str):
    import psycopg

    conn = psycopg.connect(
        f"postgresql://postgres.{TARGET}:{urllib.parse.quote(password, safe='')}@{POOLER_HOST}:5432/postgres"
        f"?sslmode=verify-full&sslrootcert={urllib.parse.quote(str(CA_FILE))}",
        connect_timeout=15,
    )
    if conn.info.host != POOLER_HOST or conn.info.user != f"postgres.{TARGET}":
        raise Refused("connection is not the Virginia production pooler")
    return conn


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--plan", type=Path, required=True)
    ap.add_argument("--plan-sha256", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--reviewer-approval", type=Path)
    args = ap.parse_args(argv)
    plan = load_plan(args.plan, args.plan_sha256)
    if args.apply:
        if not args.reviewer_approval:
            raise Refused("--apply needs --reviewer-approval")
        check_gate(args.reviewer_approval)
    conn = connect(sys.stdin.readline().rstrip("\n"))
    try:
        conn.execute("set transaction isolation level serializable")
        conn.execute("set local statement_timeout = '20s'")
        conn.execute("set local lock_timeout = '5s'")
        state = read_state(conn, plan)
        summary = [{"line": s["line_id"][:8], "to": s["entry"]["target_po"], "sku": s["entry"]["sku"], "qty": s["quantity"]} for s in state]
        if args.apply:
            apply(conn, state)
            conn.commit()
        else:
            conn.rollback()
        print(json.dumps({"mode": "applied_with_readback" if args.apply else "dry-run", "entries": len(state), "lines": summary}))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(2)
