#!/usr/bin/env python3
"""Produce the durable live-proof file `--complete-outcome` re-derives (issue #2906).

WHY THIS EXISTS
---------------
`--complete-outcome` refuses to publish an outcome's completion record until it
can re-derive live proof from a successful Actions run in the outcome's
`application_return_to` repository, at `application_commit_sha`, carrying an
unexpired artifact named `shared-db-live-proof-<issue>-<sha>` that holds
`db-live-proof.json`. No workflow produced that artifact, so an outcome whose
application is shared-db itself (first live case: #2848) could never complete.

WHAT IT PROVES, AND WHAT IT REFUSES
----------------------------------
The live assertion is read verbatim from the issue's own `db-work-scope` block,
never from a workflow input, so a caller cannot restate it. The committed probe
`.github/live-proofs/<issue>.sql` is sent to production through the Management
API with `read_only: true`, so the server forbids a write. The proof is written
ONLY when the probe returns exactly one row whose `passed` is true. Any other
shape, an issue that does not return to shared-db, or an absent assertion is a
hard failure and no file is written.
"""
from __future__ import annotations

import argparse
import hashlib
import math
import time
import json
import re
import sys
import subprocess
from datetime import datetime, timezone
from pathlib import Path
try:  # run as scripts/<name>.py or imported as scripts.<name>
    from repository_identity import current_repository, is_this_repository_or_historical
except ImportError:  # pragma: no cover
    from scripts.repository_identity import current_repository, is_this_repository_or_historical

SHARED_DB = current_repository()  # never hard-coded (#2530)
PROJECT_REF = "qsllyeztdwjgirsysgai"
SHA = re.compile(r"^[0-9a-f]{40}$")
SCOPE_FENCE = re.compile(r"```db-work-scope\s*\n(.*?)```", re.S)


class LiveProofError(Exception):
    pass


def scope_field(body: str, name: str) -> str | None:
    blocks = SCOPE_FENCE.findall(body or "")
    if len(blocks) != 1:
        raise LiveProofError("issue must carry exactly one db-work-scope block")
    values = [line.split(":", 1)[1].strip() for line in blocks[0].splitlines()
              if line.startswith(f"{name}:")]
    if len(values) > 1:
        raise LiveProofError(f"db-work-scope repeats {name}")
    return values[0] if values and values[0] else None


def require_passed(rows):
    """The rehearsal and production result contract is deliberately identical."""
    if not (isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict)
            and set(rows[0]) == {"passed"} and rows[0]["passed"] is True):
        # Never echo returned rows: a malformed probe may return licensed data.
        raise LiveProofError("probe did not return exactly one row with passed = true")


def _timeout_ms(value):
    match = re.fullmatch(r"([0-9]+)(ms|s|min)", str(value))
    return int(match[1]) * {"ms": 1, "s": 1000, "min": 60000}[match[2]] if match else None


def execute_bounded_probe(connection, probe_sql, *, expected_role, statement_ms=8000,
                          lock_ms=1000, clock=time.monotonic):
    """Run on an authenticated psycopg connection owned by the trusted caller.

    The caller proves the connection belongs to the named rehearsal/production
    target; this helper cannot establish a Supabase project from a database name.
    A fresh, idle, autocommit connection is required so the transaction and rollback
    belong solely to this probe. Extended-query preparation rejects multiple SQL
    statements at the server; no second client-side SQL parser is introduced.
    """
    if not expected_role or not isinstance(expected_role, str):
        raise LiveProofError("an exact intended execution role is required")
    if (type(statement_ms) is not int or type(lock_ms) is not int
            or not 1 <= lock_ms <= statement_ms <= 30000):
        raise LiveProofError("require 1 <= lock timeout <= statement timeout <= 30000 ms")
    if not isinstance(probe_sql, str) or not probe_sql.strip():
        raise LiveProofError("probe SQL is empty")
    if not connection.autocommit or connection.info.transaction_status != 0:
        raise LiveProofError("probe requires a fresh idle autocommit connection")
    started = clock()
    try:
        # force_rollback also prevents transaction state surviving a successful run.
        with connection.transaction(force_rollback=True):
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute("SELECT set_config('statement_timeout', %s, true), "
                               "set_config('lock_timeout', %s, true)",
                               (f"{statement_ms}ms", f"{lock_ms}ms"))
                cursor.execute("SELECT current_user, session_user, current_database(), "
                               "current_setting('search_path'), "
                               "current_setting('transaction_read_only'), "
                               "current_setting('statement_timeout'), "
                               "current_setting('lock_timeout'), rolsuper, rolbypassrls "
                               "FROM pg_roles WHERE rolname = current_user")
                state = cursor.fetchone()
                if (not state or len(state) != 9 or state[0] != expected_role
                        or state[1] != expected_role or state[4] != 'on'
                        or state[7] is not False or state[8] is not False
                        or _timeout_ms(state[5]) != statement_ms
                        or _timeout_ms(state[6]) != lock_ms):
                    raise LiveProofError("execution role/read-only transaction is not qualified")
                cursor.execute(probe_sql, prepare=True)
                if (cursor.description is None or len(cursor.description) != 1
                        or cursor.description[0].name != 'passed'
                        or cursor.description[0].type_code != 16):
                    raise LiveProofError("probe must return only boolean passed")
                values = cursor.fetchmany(2)
                rows = [{"passed": row[0]} for row in values]
                require_passed(rows)
        duration = round((clock() - started) * 1000, 3)
        if duration < 0 or duration > statement_ms:
            raise LiveProofError("probe exceeded total qualification duration budget")
        return {"rows": rows, "execution_role": state[0], "session_role": state[1],
                "database": state[2], "search_path": state[3], "read_only": True,
                "statement_timeout": state[5], "lock_timeout": state[6],
                "statement_budget_ms": statement_ms, "lock_budget_ms": lock_ms,
                "duration_ms": duration}
    except LiveProofError:
        raise
    except Exception as exc:
        # Do not expose SQL, connection strings or returned private data.
        raise LiveProofError(f"probe execution refused ({type(exc).__name__})") from None


# Existing approved Management API identity, not a caller-selectable privilege
# exemption. Supabase's initial schema grants this read identity BYPASSRLS.
# This policy qualifies catalog/assertion probes, never simulates an app user's RLS.
MANAGEMENT_ROLE_POLICY = {
    "name": "supabase-management-read-only-v1",
    "execution_role": "supabase_read_only_user",
    "session_role": "supabase_read_only_user",
    "database": "postgres", "rolsuper": False, "rolbypassrls": True,
    "standard_conforming_strings": "on",
}


def validated_probe_statement(probe_sql):
    """Reuse the shared lexer; old lexers cannot activate the API adapter."""
    module = Path(__file__).with_name("check-live-proof-probe.mjs").resolve().as_uri()
    program = ("const m=await import(process.argv[1]);let s='';"
               "for await(const c of process.stdin)s+=c;"
               "if(m.PROBE_SQL_LEXER_VERSION!==2 || m.probeShapeProblem(s)!==null || "
               "typeof m.probeStatementText!=='function')process.exit(2);"
               "process.stdout.write(JSON.stringify({statement:m.probeStatementText(s)}))")
    try:
        checked = subprocess.run(["node", "--input-type=module", "-e", program, module],
                                 input=probe_sql, text=True, capture_output=True, timeout=15)
    except Exception as exc:
        raise LiveProofError(f"probe parser unavailable ({type(exc).__name__})") from None
    if checked.returncode != 0:
        raise LiveProofError("probe refused by qualified repository SQL lexer")
    try:
        statement = json.loads(checked.stdout)["statement"]
        if not isinstance(statement, str) or not statement.strip():
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise LiveProofError("qualified SQL lexer returned no statement") from None
    return statement


def validate_probe_with_repository_parser(probe_sql):
    validated_probe_statement(probe_sql)
    return True


def execute_management_probe(query, probe_sql, *, expected_role, statement_ms=8000,
                             lock_ms=1000, validator=validated_probe_statement,
                             clock=time.monotonic):
    """One read-only simple-query message, never an explicit BEGIN.

    PostgreSQL implicitly rolls back a multi-statement simple Query on error;
    ROLLBACK closes the successful attempt. An explicit BEGIN would leave an
    aborted transaction when an error prevents reaching the final ROLLBACK.
    The role/settings assertion executes before the exact committed probe. The
    API returns the last nonempty result, so the guard deliberately has no
    `passed` column: an empty probe cannot inherit a successful guard result.
    """
    policy = dict(MANAGEMENT_ROLE_POLICY)
    if expected_role != policy["execution_role"]:
        raise LiveProofError("Management API requires its exact approved read-only role")
    if (type(statement_ms) is not int or type(lock_ms) is not int
            or not 1 <= lock_ms <= statement_ms <= 30000):
        raise LiveProofError("require 1 <= lock timeout <= statement timeout <= 30000 ms")
    statement = validator(probe_sql)
    if not isinstance(statement, str) or not statement.strip():
        raise LiveProofError("probe parser did not return the exact single statement")
    # All interpolated values are fixed policy constants or validated integers.
    guard = ("SELECT 1 / CASE WHEN current_user = 'supabase_read_only_user' "
             "AND session_user = 'supabase_read_only_user' AND pg_catalog.current_database() = 'postgres' "
             "AND pg_catalog.current_setting('transaction_read_only') = 'on' "
             "AND pg_catalog.current_setting('standard_conforming_strings') = 'on' "
             f"AND pg_catalog.current_setting('statement_timeout')::interval = interval '{statement_ms} milliseconds' "
             f"AND pg_catalog.current_setting('lock_timeout')::interval = interval '{lock_ms} milliseconds' "
             "AND (SELECT NOT rolsuper AND rolbypassrls FROM pg_catalog.pg_roles "
             "WHERE rolname = current_user) THEN 1 ELSE 0 END AS qualification_guard;")
    sql = ("SET TRANSACTION READ ONLY;\n"
           f"SET LOCAL statement_timeout = '{statement_ms}ms';\n"
           f"SET LOCAL lock_timeout = '{lock_ms}ms';\n" + guard + "\n" +
           "WITH qualification_result AS MATERIALIZED (\n" + statement + "\n)\n"
           "SELECT CASE WHEN pg_catalog.pg_typeof(q.passed) = 'boolean'::pg_catalog.regtype "
           "AND (SELECT pg_catalog.array_agg(key ORDER BY key) "
           "FROM pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(q)) AS key) = ARRAY['passed']::text[] "
           "THEN pg_catalog.to_jsonb(q)->'passed' ELSE 'null'::jsonb END AS passed "
           "FROM qualification_result AS q LIMIT 2;\nROLLBACK;")
    try:
        started = clock()
        rows = query(sql)
        duration = round((clock() - started) * 1000, 3)
        require_passed(rows)
        if not 0 <= duration <= statement_ms:
            raise LiveProofError("probe exceeded total qualification duration budget")
    except LiveProofError:
        raise
    except Exception as exc:
        raise LiveProofError(f"probe execution refused ({type(exc).__name__})") from None
    return {"rows": rows, "execution_role": policy["execution_role"],
            "session_role": policy["session_role"], "database": policy["database"],
            "read_only": True, "statement_timeout": f"{statement_ms}ms",
            "lock_timeout": f"{lock_ms}ms", "statement_budget_ms": statement_ms,
            "lock_budget_ms": lock_ms, "duration_ms": duration,
            "role_policy": policy, "role_policy_sha256": _digest(policy),
            "role_verification": "same-transaction-server-assertion",
            "result_contract": "postgres-boolean-sole-passed-one-row-v1"}


def _digest(value):
    try:
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                         allow_nan=False).encode("utf-8")).hexdigest()
    except (ValueError, TypeError):
        raise LiveProofError("qualification digest payload is invalid") from None


def qualification_bindings(*, work_issue, source_sha, source_pr, probe_sql,
                           migration_hashes, target, baseline_sha256, producer):
    """Validate trusted caller inputs; this is binding, not producer authentication.

    Producer provenance and target/role equivalence must be verified by the workflow
    consuming the artifact. A self-signed JSON digest is not an authorization.
    """
    if type(work_issue) is not int or work_issue <= 0 or type(source_pr) is not int or source_pr <= 0:
        raise LiveProofError("qualification requires work issue and source PR")
    if not SHA.fullmatch(source_sha or ""):
        raise LiveProofError("qualification requires exact source SHA")
    if not isinstance(probe_sql, str) or not probe_sql.strip():
        raise LiveProofError("qualification requires exact probe bytes")
    digest_pattern = re.compile(r"[0-9a-f]{64}")
    if not digest_pattern.fullmatch(baseline_sha256 or ""):
        raise LiveProofError("qualification requires baseline digest")
    if (not isinstance(migration_hashes, dict) or not migration_hashes
            or any(not re.fullmatch(r"[0-9]{14}", str(k))
                   or not isinstance(v, str) or not digest_pattern.fullmatch(v)
                   for k, v in migration_hashes.items())):
        raise LiveProofError("qualification requires exact migration closure hashes")
    if (not isinstance(target, dict) or set(target) != {"environment", "identity"}
            or target["environment"] not in {"preview", "isolated", "production"}
            or not isinstance(target["identity"], str) or not target["identity"].strip()):
        raise LiveProofError("qualification requires proven target identity")
    if (not isinstance(producer, dict) or set(producer) != {"repository", "run_id", "run_attempt", "workflow_sha"}
            or not isinstance(producer["repository"], str) or not producer["repository"].strip()
            or type(producer["run_id"]) is not int or producer["run_id"] <= 0
            or type(producer["run_attempt"]) is not int or producer["run_attempt"] <= 0
            or not SHA.fullmatch(producer["workflow_sha"] or "")):
        raise LiveProofError("qualification requires exact trusted producer reference")
    return {"work_issue": work_issue, "source_sha": source_sha, "source_pr": source_pr,
            "probe_sha256": hashlib.sha256(probe_sql.encode("utf-8")).hexdigest(),
            "migration_hashes": dict(migration_hashes), "target": dict(target),
            "baseline_sha256": baseline_sha256, "producer": dict(producer)}


def build_qualification(*, connection=None, expected_role, bindings, probe_sql,
                        statement_ms=8000, lock_ms=1000, now=None, management_query=None):
    validated = qualification_bindings(probe_sql=probe_sql, **bindings)
    if (connection is None) == (management_query is None):
        raise LiveProofError("select exactly one qualification transport")
    runner = execute_management_probe if management_query is not None else execute_bounded_probe
    runtime = runner(management_query if management_query is not None else connection, probe_sql,
                     expected_role=expected_role, statement_ms=statement_ms, lock_ms=lock_ms)
    runtime.pop("rows")
    manifest = {"schema_version": 1, "kind": "acceptance-probe-qualification",
                **validated, "runtime": runtime, "result": "passed",
                "observed_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    manifest["manifest_sha256"] = _digest(manifest)
    return manifest


def verify_qualification(manifest, *, bindings, probe_sql, expected_role,
                         expected_role_policy=None, statement_ms=8000, lock_ms=1000):
    """Reject tampering and stale bindings AFTER authenticating artifact provenance."""
    expected = qualification_bindings(probe_sql=probe_sql, **bindings)
    if not isinstance(manifest, dict):
        raise LiveProofError("qualification manifest must be an object")
    payload = {k: v for k, v in manifest.items() if k != "manifest_sha256"}
    if manifest.get("manifest_sha256") != _digest(payload):
        raise LiveProofError("qualification manifest digest mismatch")
    if any(manifest.get(k) != v for k, v in expected.items()):
        raise LiveProofError("qualification binding changed")
    runtime = manifest.get("runtime", {})
    if not isinstance(runtime, dict):
        raise LiveProofError("qualification runtime is malformed")
    if expected_role_policy is not None:
        if (expected_role_policy != MANAGEMENT_ROLE_POLICY
                or runtime.get("role_policy") != expected_role_policy
                or runtime.get("role_policy_sha256") != _digest(expected_role_policy)
                or runtime.get("role_verification") != "same-transaction-server-assertion"
                or runtime.get("database") != expected_role_policy["database"]
                or runtime.get("result_contract") != "postgres-boolean-sole-passed-one-row-v1") :
            raise LiveProofError("qualification execution policy changed")
    elif "role_policy" in runtime:
        raise LiveProofError("qualification requires an independently selected execution policy")
    if (type(manifest.get("schema_version")) is not int or manifest.get("schema_version") != 1 or manifest.get("kind") != "acceptance-probe-qualification"
            or manifest.get("result") != "passed" or runtime.get("execution_role") != expected_role
            or runtime.get("session_role") != expected_role or runtime.get("read_only") is not True):
        raise LiveProofError("qualification role or result is invalid")
    duration = runtime.get("duration_ms")
    statement = runtime.get("statement_budget_ms")
    lock = runtime.get("lock_budget_ms")
    if (type(statement) is not int or type(lock) is not int
            or not 1 <= lock <= statement <= 30000
            or statement != statement_ms or lock != lock_ms
            or type(duration) not in {int, float} or not math.isfinite(duration)
            or not 0 <= duration <= statement
            or _timeout_ms(runtime.get("statement_timeout")) != statement
            or _timeout_ms(runtime.get("lock_timeout")) != lock):
        raise LiveProofError("qualification runtime limits are invalid")
    return manifest


def build_proof(*, issue: dict, work_issue: int, probe_sql: str, commit_sha: str,
                query, now=None) -> dict:
    if not isinstance(work_issue, int) or work_issue <= 0:
        raise LiveProofError("work_issue must be a positive integer")
    if int(issue.get("number", 0)) != work_issue:
        raise LiveProofError(f"issue payload is not #{work_issue}")
    if not SHA.match(commit_sha or ""):
        raise LiveProofError("commit sha must be an exact lowercase 40-character SHA")
    body = issue.get("body") or ""
    if scope_field(body, "work_type") != "structural":
        raise LiveProofError("only a structural outcome has a live proof")
    return_to = scope_field(body, "application_return_to")
    # Scopes written before a transfer carry the historical slug (#2530).
    if not return_to or not is_this_repository_or_historical(return_to, SHARED_DB):
        raise LiveProofError(f"application_return_to is not {SHARED_DB}; the owning application must prove it")
    assertion = scope_field(body, "live_assertion")
    if not assertion:
        raise LiveProofError("issue scope has no live_assertion")
    if not (probe_sql or "").strip():
        raise LiveProofError("probe SQL is empty")
    rows = query(probe_sql)
    require_passed(rows)
    observed = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "schema_version": 1,
        "work_issue": work_issue,
        "application_commit_sha": commit_sha,
        "live_assertion": assertion,
        "environment": "production",
        "result": "passed",
        "observed_at": observed,
    }


def management_query(project_ref, token, sql, *, timeout_seconds):
    """Reuse the approved request builder without its unbounded 120s HTTP wait."""
    import urllib.request
    try:
        from production_catalog_verification import build_query_request
    except ImportError:
        from scripts.production_catalog_verification import build_query_request
    try:
        request = build_query_request(project_ref, token, sql)
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body = response.read(65537)
            if len(body) > 65536:
                raise LiveProofError("probe response exceeded bounded result size")
            return json.loads(body.decode("utf-8"))
    except Exception as exc:
        raise LiveProofError(f"Management API probe refused ({type(exc).__name__})") from None


def qualification_main(argv=None, *, connector=None, environ=None) -> int:
    """Trusted-workflow entrypoint; bindings are not self-authenticating evidence.

    Only a protected environment variable carries the connection secret. The
    consuming production gate must authenticate the Actions artifact and derive
    bindings independently before calling verify_qualification. This command
    alone never authorizes promotion or creates a production outcome.
    """
    parser = argparse.ArgumentParser(description="Run an exact bounded acceptance probe")
    parser.add_argument("--bindings-json", type=Path, required=True)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--expected-role", required=True)
    parser.add_argument("--transport", choices=("psycopg", "management-api"), default="psycopg")
    parser.add_argument("--expected-host")
    parser.add_argument("--expected-database")
    parser.add_argument("--project-ref")
    parser.add_argument("--connection-env")
    parser.add_argument("--statement-ms", type=int, default=8000)
    parser.add_argument("--lock-ms", type=int, default=1000)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    import os
    environment = os.environ if environ is None else environ
    secret = environment.get(args.connection_env or ("SUPABASE_ACCESS_TOKEN"
                             if args.transport == "management-api" else "SHARED_DB_PROBE_DSN"))
    if not secret:
        raise LiveProofError("qualification connection environment variable is absent")
    if args.output.exists():
        raise LiveProofError("qualification output already exists; use a fresh attempt path")
    try:
        bindings = json.loads(args.bindings_json.read_text(encoding="utf-8"))
        # Read bytes without newline normalization: the digest is of committed bytes.
        sql = args.probe.read_bytes().decode("utf-8")
        qualification_bindings(probe_sql=sql, **bindings)
        if args.transport == "management-api":
            if (not re.fullmatch(r"[a-z]{20}", args.project_ref or "")
                    or bindings["target"]["identity"] != args.project_ref
                    or bindings["target"]["environment"] not in {"preview", "production"}):
                raise LiveProofError("Management API target must match independently proven project")
            manifest = build_qualification(
                management_query=lambda text: management_query(
                    args.project_ref, secret, text, timeout_seconds=args.statement_ms / 1000 + 10),
                expected_role=args.expected_role, bindings=bindings, probe_sql=sql,
                statement_ms=args.statement_ms, lock_ms=args.lock_ms)
        else:
            if not args.expected_host or not args.expected_database:
                raise LiveProofError("direct qualification requires trusted endpoint and database")
            if connector is None:
                import psycopg
                connector = psycopg.connect
            with connector(secret, autocommit=True, connect_timeout=10) as connection:
                if (connection.info.host != args.expected_host
                        or connection.info.dbname != args.expected_database):
                    raise LiveProofError("connection endpoint does not match the trusted target")
                manifest = build_qualification(
                    connection=connection, expected_role=args.expected_role,
                    bindings=bindings, probe_sql=sql,
                    statement_ms=args.statement_ms, lock_ms=args.lock_ms)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents stale evidence from being silently replaced.
        with args.output.open("x", encoding="utf-8") as output:
            output.write(json.dumps(manifest, indent=2) + "\n")
    except LiveProofError:
        raise
    except Exception as exc:
        # Driver/configuration errors may contain DSNs or private query text.
        raise LiveProofError(f"qualification refused ({type(exc).__name__})") from None
    print("ACCEPTANCE PROBE QUALIFIED; production acceptance remains separate")
    return 0


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "qualify":
        return qualification_main(argv[1:])
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work-issue", type=int, required=True)
    parser.add_argument("--issue-json", type=Path, required=True)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bounded-management-api", action="store_true")
    args = parser.parse_args(argv)
    import os
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from production_catalog_verification import run_query

    token = os.environ.get("SUPABASE_ACCESS_TOKEN") or ""
    if not token:
        raise LiveProofError("SUPABASE_ACCESS_TOKEN is not set")
    if not args.probe.is_file():
        raise LiveProofError(f"no committed probe at {args.probe}")
    proof = build_proof(
        issue=json.loads(args.issue_json.read_text(encoding="utf-8")),
        work_issue=args.work_issue,
        probe_sql=args.probe.read_bytes().decode("utf-8"),
        commit_sha=args.commit_sha,
        query=(lambda sql: execute_management_probe(
            lambda text: management_query(PROJECT_REF, token, text, timeout_seconds=18),
            sql, expected_role=MANAGEMENT_ROLE_POLICY["execution_role"])["rows"])
        if args.bounded_management_api else lambda sql: run_query(PROJECT_REF, token, sql),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(f"LIVE PROOF PASSED: #{proof['work_issue']} at {proof['application_commit_sha']} observed_at {proof['observed_at']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LiveProofError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(1)
