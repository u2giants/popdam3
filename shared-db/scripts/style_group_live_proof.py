#!/usr/bin/env python3
"""Issue #2478's narrowly scoped privileged, read-only live proof.

The general live-proof route stays on the Management API. Its read-only role
cannot execute this deliberately restricted helper. This route accepts only
the reviewed #2478 probe bytes and runs them in a forced-rollback transaction.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

from shared_db_live_proof import LiveProofError, _timeout_ms, build_proof, require_passed, scope_field


ISSUE = 2478
PROJECT = "qsllyeztdwjgirsysgai"
HOST = "aws-1-us-east-1.pooler.supabase.com"
PORT = 5432  # Session pooler: prepared statements stay on one server connection.
USER = f"postgres.{PROJECT}"
ROLE = "postgres"
PROBE_SHA256 = "0000c8e58ecba4bb0a080cdf1e26829c433bf88f5a8dccc64646e33c0569ec74"
CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
CA_FILE = Path(__file__).resolve().parent / "certs" / "supabase-root-2021.crt"
STATEMENT_MS = 8000
LOCK_MS = 1000
PROBE_VERSION = re.compile(r"version\s*=\s*'(\d{14})'")


def assertion_names_probe_version(issue, sql: str) -> None:
    """Refuse to certify an issue assertion that names a different migration.

    build_proof copies live_assertion verbatim into the artifact, so the text
    must name the exact ledger version the pinned probe actually checks.
    """
    versions = set(PROBE_VERSION.findall(sql))
    if len(versions) != 1:
        raise LiveProofError("#2478 probe must assert exactly one migration version")
    assertion = scope_field(str((issue or {}).get("body") or ""), "live_assertion") or ""
    named = set(re.findall(r"\b\d{14}\b", assertion))
    if named != versions:
        raise LiveProofError("#2478 live_assertion does not name the probe's migration version")


def execute_style_group_probe(connection, sql: str, *, clock=time.monotonic):
    """Execute one reviewed statement as the exact production owner, read-only."""
    if hashlib.sha256(sql.encode("utf-8")).hexdigest() != PROBE_SHA256:
        raise LiveProofError("#2478 probe bytes differ from reviewed binding")
    if not connection.autocommit or connection.info.transaction_status != 0:
        raise LiveProofError("probe requires a fresh idle autocommit connection")
    started = clock()
    try:
        with connection.transaction(force_rollback=True):
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute("SELECT set_config('statement_timeout', %s, true), "
                               "set_config('lock_timeout', %s, true)", (f"{STATEMENT_MS}ms", f"{LOCK_MS}ms"))
                cursor.execute("SELECT current_user, session_user, current_database(), "
                               "current_setting('transaction_read_only'), "
                               "current_setting('statement_timeout'), "
                               "current_setting('lock_timeout'), rolsuper, rolbypassrls "
                               "FROM pg_roles WHERE rolname = current_user")
                state = cursor.fetchone()
                if (not state or len(state) != 8 or state[0] != ROLE or state[1] != ROLE
                        or state[2] != "postgres" or state[3] != "on"
                        or _timeout_ms(state[4]) != STATEMENT_MS or _timeout_ms(state[5]) != LOCK_MS
                        or state[6] is not False or state[7] is not True):
                    raise LiveProofError("#2478 production role/read-only transaction is not qualified")
                # A named extended-protocol statement rejects additional SQL statements.
                cursor.execute(sql, prepare=True)
                if (cursor.description is None or len(cursor.description) != 1
                        or cursor.description[0].name != "passed"
                        or cursor.description[0].type_code != 16):
                    raise LiveProofError("#2478 probe must return one boolean passed column")
                rows = [{"passed": row[0]} for row in cursor.fetchmany(2)]
                require_passed(rows)
        if not 0 <= (clock() - started) * 1000 <= STATEMENT_MS:
            raise LiveProofError("#2478 probe exceeded its time budget")
        return rows
    except LiveProofError:
        raise
    except Exception as exc:
        # Never echo a connection string, query text, or private returned data.
        raise LiveProofError(f"#2478 probe refused ({type(exc).__name__})") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work-issue", type=int, required=True)
    parser.add_argument("--issue-json", type=Path, required=True)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.work_issue != ISSUE or args.probe.resolve() != (Path.cwd() / ".github/live-proofs/2478.sql").resolve():
        raise LiveProofError("privileged route is limited to committed issue #2478 probe")
    if args.output.exists():
        raise LiveProofError("proof output already exists")
    if hashlib.sha256(CA_FILE.read_bytes()).hexdigest() != CA_SHA256:
        raise LiveProofError("pinned Supabase CA bytes changed")
    secret = os.environ.get("SUPABASE_DB_PASSWORD_PRODUCTION")
    if not secret:
        raise LiveProofError("production database password environment is absent")
    issue = json.loads(args.issue_json.read_text(encoding="utf-8"))
    sql = args.probe.read_bytes().decode("utf-8")
    if hashlib.sha256(sql.encode("utf-8")).hexdigest() != PROBE_SHA256:
        raise LiveProofError("#2478 probe bytes differ from reviewed binding")
    assertion_names_probe_version(issue, sql)
    try:
        import psycopg
        connection = psycopg.connect(host=HOST, port=PORT, dbname="postgres", user=USER,
                                     password=secret, sslmode="verify-full",
                                     sslrootcert=str(CA_FILE), connect_timeout=10,
                                     autocommit=True)
    except Exception as exc:
        raise LiveProofError(f"#2478 connection refused ({type(exc).__name__})") from None
    try:
        with connection:
            # Configuration guard only: these values echo the pinned kwargs above.
            # The endpoint itself is authenticated by sslmode=verify-full against
            # the pinned Supabase root CA, and role/database/read-only state is
            # observed server-side inside execute_style_group_probe.
            if (connection.info.host != HOST or connection.info.port != PORT
                    or connection.info.dbname != "postgres" or connection.info.user != USER):
                raise LiveProofError("#2478 connection parameters differ from pinned configuration")
            proof = build_proof(issue=issue, work_issue=ISSUE, probe_sql=sql,
                                commit_sha=args.commit_sha,
                                query=lambda text: execute_style_group_probe(connection, text))
    except LiveProofError:
        raise
    except Exception as exc:
        raise LiveProofError(f"#2478 proof refused after connecting ({type(exc).__name__})") from None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(proof, indent=2) + "\n")
    print("LIVE PROOF PASSED: #2478; read-only production transaction rolled back")


if __name__ == "__main__":
    try:
        main()
    except LiveProofError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(1)
