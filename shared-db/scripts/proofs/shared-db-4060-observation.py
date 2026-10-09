#!/usr/bin/env python3
"""Fixed #4060 duplicate-only proof. Owned by maintenance; retire with acceptance.

Never imports or relaxes a read-only runner. The reviewed workflow proves its
producer approval before supplying a credential. This client always rolls back.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CONTRACT = json.loads((HERE / "4060-contract.json").read_text())
WORKFLOW = ".github/workflows/shared-db-4060-observation.yml"
CA = ROOT / "scripts/certs/supabase-root-2021.crt"
CA_DIGEST = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
STATEMENT_MS = 8000
LOCK_MS = 1000
EXPECTED_COLUMNS = set("id name email level notes passw expire status adddate auditlog lastname phonenum subscription subleveladmin notificationsms notificationemail _airbyte_emitted_at _airbyte_users_hashid profile_photo graph_photo graph_photo_synced_at office_location preferred_language app_profile_id".split())
SNAPSHOT = """SELECT count(*), md5(coalesce(string_agg(md5(row_to_json(u)::text), '' ORDER BY id), ''))
 FROM ONLY dflow.users u"""
SEQUENCE = "SELECT last_value, is_called FROM ONLY dflow.users_id_seq"


class Refusal(Exception):
    pass


def require(value):
    if not value:
        raise Refusal("fixed duplicate proof refused")


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


DUPLICATES = "SELECT count(*) FROM (SELECT lower(btrim(email)) FROM ONLY dflow.users WHERE nullif(btrim(email), '') IS NOT NULL GROUP BY lower(btrim(email)) HAVING count(*) > 1) duplicates"
LEDGER = "SELECT count(*) = 1 FROM ONLY supabase_migrations.schema_migrations WHERE version = '20261009064439'"
INDEX_DEFINITION = "CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users USING btree (lower(btrim((email)::text))) WHERE (NULLIF(btrim((email)::text), ''::text) IS NOT NULL)"

def validate_catalog(c):
    require(isinstance(c, dict) and c.get("table_kind") == "r" and c.get("table_am") == "heap" and c.get("ledger_heap") is True and c.get("inheritance_edges") == 0 and isinstance(c.get("table_oid"), int))
    i = c.get("index")
    require(isinstance(i, dict) and all(i.get(k) is True for k in ["unique", "valid", "ready"]))
    require(i.get("table_oid") == c["table_oid"] and i.get("method") == "btree" and i.get("builtin_method") is True and i.get("keys") == 1 and i.get("attributes") == 1)
    # format_type adds text casts to varchar expression and predicate.
    require(i.get("expression") == "lower(btrim((email)::text))")
    require(i.get("predicate") == "(NULLIF(btrim((email)::text), ''::text) IS NOT NULL)")
    require(i.get("definition") == INDEX_DEFINITION and i.get("opclass_exact") is True and i.get("collation_exact") is True
            and i.get("options") == [0] and i.get("storage_options") is None
            and i.get("immediate") is True and i.get("primary") is False
            and i.get("exclusion") is False and i.get("nulls_not_distinct") is False)
    columns = c.get("columns")
    require(isinstance(columns, list) and len(columns) == len(EXPECTED_COLUMNS)
            and {a.get("name") for a in columns} == EXPECTED_COLUMNS)
    for a in columns:
        require(a.get("generated") == "" and a.get("default") is None)
        if a["name"] == "id":
            require(a.get("type") == "integer" and a.get("identity") == "a" and a.get("not_null") is True)
        else:
            require(a.get("identity") == "" and a.get("not_null") is False)
            require(a.get("type") in {"character varying(255)", "text", "timestamp with time zone", "uuid"})
    require(next(a for a in columns if a["name"] == "email")["type"] == "character varying(255)")
    require(next(a for a in columns if a["name"] == "app_profile_id")["type"] == "uuid")
    triggers = c.get("insert_triggers")
    require(isinstance(triggers, list) and len(triggers) <= 1)
    for t in triggers:
        # Duplicate btree insertion fails BEFORE this internal AFTER ROW FK
        # check can execute. Every BEFORE, statement, external or unknown trigger refuses.
        require(t.get("internal") is True and t.get("type") == 5
                and t.get("function_schema") == "pg_catalog" and t.get("function") == "RI_FKey_check_ins"
                and t.get("constraint_type") == "f" and t.get("constraint_table") == c["table_oid"]
                and isinstance(c.get("profile_oid"), int) and t.get("referenced_table") == c["profile_oid"]
                and t.get("key_columns") == ["app_profile_id"])
    require(c.get("rules") == 0 and c.get("checks") == 0 and c.get("unsafe_indexes") == 0)
    return columns


def sequence_state(cursor):
    # Explicit negative ID and OVERRIDING SYSTEM VALUE prevent nextval calls.
    cursor.execute("SELECT pg_get_serial_sequence('dflow.users', 'id')")
    require(cursor.fetchone() == ("dflow.users_id_seq",))
    cursor.execute(SEQUENCE)
    state = cursor.fetchone()
    require(isinstance(state, tuple) and len(state) == 2 and isinstance(state[0], int) and isinstance(state[1], bool))
    return state


def snapshot(cursor):
    cursor.execute(SNAPSHOT)
    row = cursor.fetchone()
    require(isinstance(row, tuple) and len(row) == 2 and isinstance(row[0], int)
            and row[0] > 0 and re.fullmatch(r"[0-9a-f]{32}", str(row[1])))
    return row


def prove(connection, sql_module):
    require(connection.autocommit and connection.info.transaction_status == 0)
    # Never COMMIT, including success. Shared lock keeps preconditions stable
    # until the failed duplicate statement and comparison have completed.
    with connection.transaction(force_rollback=True):
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '8000ms'")
            cursor.execute("SET LOCAL lock_timeout = '1000ms'")
            cursor.execute("SET LOCAL search_path = pg_catalog")
            cursor.execute("SELECT current_user, session_user, current_database(), current_setting('transaction_read_only'), current_setting('statement_timeout'), current_setting('lock_timeout')")
            require(cursor.fetchone() == ("postgres", "postgres", "postgres", "off", "8s", "1s"))
            cursor.execute("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user")
            require(cursor.fetchone() == (True, False))
            cursor.execute("LOCK TABLE ONLY dflow.users IN SHARE MODE")
            cursor.execute("LOCK TABLE ONLY supabase_migrations.schema_migrations IN ACCESS SHARE MODE")
            cursor.execute((HERE / "4060-catalog.sql").read_text(), prepare=True)
            metadata = cursor.fetchone()
            require(metadata and len(metadata) == 1 and cursor.fetchone() is None)
            columns = validate_catalog(metadata[0])
            cursor.execute(LEDGER)
            require(cursor.fetchone() == (True,))
            cursor.execute(DUPLICATES)
            require(cursor.fetchone() == (0,))
            before = snapshot(cursor)
            sequence_before = sequence_state(cursor)
            cursor.execute("SELECT id, email FROM ONLY dflow.users WHERE nullif(btrim(email), '') IS NOT NULL AND btrim(email) ~ '[A-Za-z]' ORDER BY id LIMIT 1")
            candidate = cursor.fetchone()
            require(candidate and isinstance(candidate[1], str))
            # Use the server's own upper/btrim rules, not Python Unicode rules.
            cursor.execute("SELECT upper(btrim(%s::text))", (candidate[1],))
            variant = " " + cursor.fetchone()[0] + " "
            cursor.execute("SELECT lower(btrim(%s::text)) = lower(btrim(%s::text)) AND %s::text <> %s::text", (variant, candidate[1], variant, candidate[1]))
            require(cursor.fetchone() == (True,))
            cursor.execute("SELECT NOT EXISTS(SELECT 1 FROM ONLY dflow.users WHERE id = -406001)")
            require(cursor.fetchone() == (True,))
            names = [a["name"] for a in columns]
            values = [{"id": -406001, "name": "issue-4060-rollback-proof", "email": variant}.get(n) for n in names]
            statement = sql_module.SQL("INSERT INTO dflow.users ({}) OVERRIDING SYSTEM VALUE VALUES ({})").format(
                sql_module.SQL(", ").join(map(sql_module.Identifier, names)),
                sql_module.SQL(", ").join(sql_module.Placeholder() for _ in names))
            cursor.execute("SAVEPOINT duplicate_only")
            rejected = False
            try:
                cursor.execute(statement, values)
            except Exception as exc:
                # No returned DB exception text enters output or artifacts.
                rejected = (getattr(exc, "sqlstate", None) == "23505"
                            and getattr(getattr(exc, "diag", None), "constraint_name", None) == "users_email_lower_uidx")
            finally:
                cursor.execute("ROLLBACK TO SAVEPOINT duplicate_only")
            require(rejected)
            require(snapshot(cursor) == before and sequence_state(cursor) == sequence_before)
    require(connection.info.transaction_status == 0)
    with connection.transaction(force_rollback=True):
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '8000ms'")
            cursor.execute("SET LOCAL lock_timeout = '1000ms'")
            require(snapshot(cursor) == before and sequence_state(cursor) == sequence_before)
    return {"index_exact": True, "duplicate_rejected": True, "sqlstate": "23505",
            "constraint": "users_email_lower_uidx", "case_variant": True,
            "users_unchanged": True, "sequence_unchanged": True, "forced_rollback": True,
            "row_count": before[0], "no_external_effects": True}


def context(env):
    require(env.get("GITHUB_REPOSITORY") == CONTRACT["source_repository"]
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_WORKFLOW_REF") == f"{CONTRACT['source_repository']}/{WORKFLOW}@refs/heads/main")
    for name in ["GITHUB_SHA", "APPLICATION_COMMIT_SHA"]:
        require(re.fullmatch(r"[0-9a-f]{40}", env.get(name, "")))
    for name in ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]:
        require(re.fullmatch(r"[1-9][0-9]*", env.get(name, "")))
    require(hashlib.sha256(CA.read_bytes()).hexdigest() == CA_DIGEST)


def main(env=os.environ):
    context(env)
    import psycopg
    from psycopg import sql
    require(bool(env.get("SUPABASE_DB_PASSWORD_PRODUCTION")))
    with psycopg.connect(host="aws-1-us-east-1.pooler.supabase.com", port=5432,
                          dbname="postgres", user="postgres." + CONTRACT["project_ref"],
                          password=env["SUPABASE_DB_PASSWORD_PRODUCTION"], sslmode="verify-full",
                          sslrootcert=str(CA), connect_timeout=10, autocommit=True) as connection:
        result = prove(connection, sql)
    observed = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    observation = {"schema_version": 1, "work_issue": CONTRACT["work_issue"],
                   "project_ref": CONTRACT["project_ref"], "live_assertion": CONTRACT["live_assertion"],
                   "observed_at": observed, "producer_repository": CONTRACT["source_repository"],
                   "producer_commit_sha": env["GITHUB_SHA"], "producer_workflow": WORKFLOW,
                   "producer_run_id": int(env["GITHUB_RUN_ID"]), "producer_run_attempt": int(env["GITHUB_RUN_ATTEMPT"]),
                   "application_repository": CONTRACT["application_repository"],
                   "application_commit_sha": env["APPLICATION_COMMIT_SHA"],
                   "sql_sha256": digest((HERE / "4060-catalog.sql").read_bytes()),
                   "contract_sha256": digest((HERE / "4060-contract.json").read_bytes()), "catalog": result}
    out = json.dumps(observation, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    require(len(out) <= 8192 and Path(env.get("RUNNER_TEMP", "")).is_absolute())
    directory = Path(env["RUNNER_TEMP"]) / "shared-db-4060-observation"
    directory.mkdir(mode=0o700)
    with (directory / "observation.json").open("xb") as file:
        file.write(out)
    print("PASS: exact duplicate rejected; users and sequence unchanged; transaction rolled back")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("REFUSED: fixed #4060 proof; no acceptance artifact", flush=True)
        raise SystemExit(1) from None
