#!/usr/bin/env python3
"""Apply one exceptional migration and its Supabase ledger row atomically.

The normal migration lane remains Supabase CLI. This tool is fail-closed and only
accepts an exact version+SHA256 entry in config/atomic-migration-allowlist.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "config" / "atomic-migration-allowlist.json"
VERSION_RE = re.compile(r"^(\d{14})_(.+)\.sql$")
VERSION_VALUE_RE = re.compile(r"^\d{14}$")
TX_RE = re.compile(
    r"(?is)^\s*(begin|start\s+transaction|end|abort|commit(?:\s+prepared)?|"
    r"rollback(?:\s+prepared)?|prepare\s+transaction|savepoint|release\s+savepoint)\b"
)
EXPECTED_COLUMNS = {
    "version": ({"text", "character varying"}, "NO", {"text", "varchar"}),
    "statements": ({"ARRAY"}, "YES", {"_text"}),
    "name": ({"text", "character varying"}, "YES", {"text", "varchar"}),
}
LIBPQ_ENV_KEYS = frozenset({
    "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
    "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS",
    "PGAPPNAME", "PGSSLMODE", "PGSSLCERT", "PGSSLKEY", "PGSSLROOTCERT",
    "PGSSLCRL", "PGSSLPASSWORD", "PGSSLCERTMODE", "PGSSLMINPROTOCOLVERSION",
    "PGSSLMAXPROTOCOLVERSION", "PGCONNECT_TIMEOUT", "PGTARGETSESSIONATTRS",
    "PGCHANNELBINDING", "PGLOADBALANCEHOSTS", "PGGSSENCMODE",
    "PGSSLNEGOTIATION", "PGREQUIREAUTH", "PGCLIENTENCODING", "PGKRBSRVNAME",
    "PGREALM", "PGGSSLIB",
})


class Refusal(RuntimeError):
    pass


def canonical_migration_bytes(path: Path) -> bytes:
    """Return repository-canonical bytes regardless of checkout line endings."""
    raw = path.read_bytes()
    if b"\r" in raw.replace(b"\r\n", b""):
        raise Refusal(f"migration contains unsupported bare CR line endings: {path.name}")
    return raw.replace(b"\r\n", b"\n")


def validate_version(version: str) -> str:
    if not VERSION_VALUE_RE.fullmatch(version):
        raise Refusal("version must be an exact 14-digit migration version")
    return version


def read_policy() -> dict[str, dict[str, object]]:
    try:
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Refusal("atomic migration policy is missing or invalid") from exc
    if policy.get("schema_version") != 1 or not isinstance(policy.get("migrations"), dict):
        raise Refusal("atomic migration policy has an unsupported shape")
    migrations = policy["migrations"]
    for version, entry in migrations.items():
        validate_version(version)
        if not isinstance(entry, dict):
            raise Refusal(f"atomic policy entry {version} is not an object")
        if "strip_outer_transaction" in entry and not isinstance(entry["strip_outer_transaction"], bool):
            raise Refusal(f"atomic policy transaction flag is invalid for {version}")
    return migrations


def classify_allowlist(raw: str) -> str:
    """Return the sole atomic version, or an empty string for the normal CLI lane."""
    items = raw.split(",")
    if not items or any(not item.strip() for item in items):
        raise Refusal("allowlist contains an empty or malformed entry")
    versions = [validate_version(item.strip()) for item in items]
    atomic = sorted(set(versions) & set(read_policy()))
    if not atomic:
        return ""
    if len(versions) != 1 or len(atomic) != 1:
        raise Refusal(
            "an atomically authorized migration must be the only allowlisted version"
        )
    return atomic[0]


def validate_policy_bindings(migrations_dir: Path) -> None:
    """Prove every authorization is committed with exactly the bytes it names."""
    for version, entry in read_policy().items():
        matches = sorted(migrations_dir.glob(f"{version}_*.sql"))
        if len(matches) != 1:
            raise Refusal(
                f"atomic policy {version} must bind exactly one committed migration; "
                f"found {len(matches)}"
            )
        digest = hashlib.sha256(canonical_migration_bytes(matches[0])).hexdigest()
        if digest != entry.get("sha256"):
            raise Refusal(f"atomic policy SHA256 mismatch for {version}")
        targets = entry.get("targets")
        if not isinstance(targets, list) or not targets or not set(targets) <= {"preview", "production"}:
            raise Refusal(f"atomic policy targets are invalid for {version}")


def split_sql(raw: str) -> list[str]:
    """Split statements, keeping SQL-standard atomic function bodies intact."""
    out: list[str] = []
    start = 0
    i = 0
    state = "normal"
    dollar = ""
    block_comment_depth = 0
    single_escape = False
    prefix_words: list[str] = []
    create_routine = False
    previous_word = ""
    atomic_depth = 0
    case_depth = 0
    routine_body_closed = False

    def reset_statement() -> None:
        nonlocal prefix_words, create_routine, previous_word, atomic_depth, case_depth, routine_body_closed
        prefix_words = []
        create_routine = False
        previous_word = ""
        atomic_depth = 0
        case_depth = 0
        routine_body_closed = False

    while i < len(raw):
        c = raw[i]
        n = raw[i + 1] if i + 1 < len(raw) else ""
        if state == "normal":
            if routine_body_closed:
                if c.isspace():
                    i += 1
                    continue
                if c == "-" and n == "-":
                    state = "line"
                    i += 2
                    continue
                if c == "/" and n == "*":
                    state = "block"
                    block_comment_depth = 1
                    i += 2
                    continue
                if c != ";":
                    raise Refusal("unexpected tokens after SQL-standard atomic routine body")
            if c == "'":
                state = "single"
                single_escape = i > 0 and raw[i - 1] in "eE" and (
                    i == 1 or not (raw[i - 2].isalnum() or raw[i - 2] in "_$")
                )
                previous_word = ""
            elif c == '"':
                state = "double"
                previous_word = ""
            elif c == "-" and n == "-":
                state = "line"
                i += 1
            elif c == "/" and n == "*":
                state = "block"
                block_comment_depth = 1
                i += 1
            elif c == "$":
                m = re.match(r"\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$", raw[i:])
                if m:
                    dollar = m.group(0)
                    state = "dollar"
                    previous_word = ""
                    i += len(dollar) - 1
                else:
                    previous_word = ""
            elif c.isalpha() or c == "_":
                end = i + 1
                while end < len(raw) and (raw[end].isalnum() or raw[end] in "_$"):
                    end += 1
                word = raw[i:end].upper()
                if len(prefix_words) < 4:
                    prefix_words.append(word)
                    if prefix_words[:2] in (["CREATE", "FUNCTION"], ["CREATE", "PROCEDURE"]):
                        create_routine = True
                    elif prefix_words[:4] in (
                        ["CREATE", "OR", "REPLACE", "FUNCTION"],
                        ["CREATE", "OR", "REPLACE", "PROCEDURE"],
                    ):
                        create_routine = True

                if create_routine:
                    if atomic_depth == 0 and previous_word == "BEGIN" and word == "ATOMIC":
                        atomic_depth = 1
                    elif atomic_depth > 0:
                        if previous_word == "BEGIN" and word == "ATOMIC":
                            atomic_depth += 1
                        elif word == "CASE":
                            case_depth += 1
                        elif word == "END":
                            if case_depth:
                                case_depth -= 1
                            else:
                                atomic_depth -= 1
                                if atomic_depth == 0:
                                    create_routine = False
                                    routine_body_closed = True
                previous_word = word
                i = end
                continue
            elif c == ";" and atomic_depth == 0:
                statement = raw[start:i].strip()
                if statement: out.append(statement)
                start = i + 1
                reset_statement()
            elif not c.isspace():
                previous_word = ""
        elif state == "single":
            if single_escape and c == "\\" and n:
                i += 1
            elif c == "'" and n == "'":
                i += 1
            elif c == "'":
                state = "normal"
        elif state == "double":
            if c == '"' and n == '"':
                i += 1
            elif c == '"':
                state = "normal"
        elif state == "line":
            if c == "\n": state = "normal"
        elif state == "block":
            if c == "/" and n == "*":
                block_comment_depth += 1
                i += 1
            elif c == "*" and n == "/":
                block_comment_depth -= 1
                i += 1
                if block_comment_depth == 0:
                    state = "normal"
        elif state == "dollar" and raw.startswith(dollar, i):
            state = "normal"
            i += len(dollar) - 1
        i += 1
    if state not in {"normal", "line"}:
        raise Refusal(f"unterminated SQL lexical state: {state}")
    if atomic_depth:
        raise Refusal("unterminated SQL-standard atomic routine body")
    tail = raw[start:].strip()
    if tail: out.append(tail)
    return out


def control_tokens(statement: str) -> list[str]:
    """Return significant tokens, treating quoted text as opaque non-keywords."""
    tokens: list[str] = []
    i = 0
    state = "normal"
    dollar = ""
    comment_depth = 0
    single_escape = False
    while i < len(statement):
        c = statement[i]
        n = statement[i + 1] if i + 1 < len(statement) else ""
        if state == "normal":
            if c.isspace():
                i += 1
                continue
            if c == "-" and n == "-":
                state = "line"
                i += 2
                continue
            if c == "/" and n == "*":
                state = "block"
                comment_depth = 1
                i += 2
                continue
            if c == "'":
                tokens.append("<literal>")
                state = "single"
                single_escape = i > 0 and statement[i - 1] in "eE" and (
                    i == 1 or not (statement[i - 2].isalnum() or statement[i - 2] in "_$")
                )
                i += 1
                continue
            if c == '"':
                tokens.append("<identifier>")
                state = "double"
                i += 1
                continue
            if c == "$":
                match = re.match(r"\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$", statement[i:])
                if match:
                    tokens.append("<literal>")
                    dollar = match.group(0)
                    state = "dollar"
                    i += len(dollar)
                    continue
            if c.isalpha() or c == "_":
                end = i + 1
                while end < len(statement) and (statement[end].isalnum() or statement[end] in "_$"):
                    end += 1
                tokens.append(statement[i:end].upper())
                i = end
                continue
            tokens.append(c)
            i += 1
        elif state == "single":
            if single_escape and c == "\\" and n:
                i += 2
            elif c == "'" and n == "'":
                i += 2
            elif c == "'":
                state = "normal"
                i += 1
            else:
                i += 1
        elif state == "double":
            if c == '"' and n == '"':
                i += 2
            elif c == '"':
                state = "normal"
                i += 1
            else:
                i += 1
        elif state == "line":
            if c == "\n":
                state = "normal"
            i += 1
        elif state == "block":
            if c == "/" and n == "*":
                comment_depth += 1
                i += 2
            elif c == "*" and n == "/":
                comment_depth -= 1
                i += 2
                if comment_depth == 0:
                    state = "normal"
            else:
                i += 1
        elif state == "dollar":
            if statement.startswith(dollar, i):
                state = "normal"
                i += len(dollar)
            else:
                i += 1
    return tokens


def dollar_quote(value: str, seed: str) -> str:
    tag = f"$atomic_{seed}$"
    if tag in value:
        raise Refusal("generated dollar-quote tag collides with migration text")
    return f"{tag}{value}{tag}"


def load_candidate(migrations_dir: Path, version: str, target: str) -> tuple[Path, str, str, list[str]]:
    validate_version(version)
    entry = read_policy().get(version)
    if not entry or target not in entry.get("targets", []):
        raise Refusal(f"version {version} is not atomically authorized for {target}")
    matches = sorted(migrations_dir.glob(f"{version}_*.sql"))
    if len(matches) != 1:
        raise Refusal(f"expected exactly one migration for {version}; found {len(matches)}")
    path = matches[0]
    match = VERSION_RE.fullmatch(path.name)
    if not match or match.group(1) != version:
        raise Refusal("migration filename/version mismatch")
    raw_bytes = canonical_migration_bytes(path)
    digest = hashlib.sha256(raw_bytes).hexdigest()
    if digest != entry.get("sha256"):
        raise Refusal(f"SHA256 mismatch for {version}")
    raw = raw_bytes.decode("utf-8")
    statements = split_sql(raw)
    if not statements:
        raise Refusal("migration is empty")
    if entry.get("strip_outer_transaction", False):
        if len(statements) < 3 or control_tokens(statements[0]) != ["BEGIN"] or control_tokens(statements[-1]) != ["COMMIT"]:
            raise Refusal("opted-in migration must have one exact outer BEGIN and COMMIT")
        statements = statements[1:-1]
        if not statements:
            raise Refusal("opted-in migration has no body statements")
        raw = ";\n".join(statements) + ";\n"
    controls = [s for s in statements if TX_RE.match(" ".join(control_tokens(s)))]
    if controls:
        raise Refusal("migration contains forbidden transaction-control statements")
    return path, match.group(2), raw, statements


def linked_connection(linked_dir: Path, expected_ref: str) -> tuple[str, dict[str, str]]:
    if os.environ.get("EXPECTED_PROJECT_REF") != expected_ref:
        raise Refusal("EXPECTED_PROJECT_REF environment does not match requested ref")
    if not os.environ.get("SUPABASE_DB_PASSWORD"):
        raise Refusal("SUPABASE_DB_PASSWORD is missing")
    url_file = linked_dir / "supabase" / ".temp" / "pooler-url"
    if not url_file.is_file():
        raise Refusal("linked Supabase pooler-url is missing")
    url = url_file.read_text(encoding="utf-8").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise Refusal("linked pooler-url is malformed")
    if "#" in url:
        raise Refusal("linked pooler-url contains an unsupported fragment")
    if parsed.password is not None:
        raise Refusal("linked pooler-url unexpectedly contains a password")
    if not parsed.username or not parsed.username.endswith("." + expected_ref):
        raise Refusal("linked pooler-url user does not prove the expected project ref")
    if expected_ref not in url:
        raise Refusal("linked pooler-url does not contain the expected project ref")
    try:
        host = unquote(parsed.hostname)
        user = unquote(parsed.username or "")
        database = unquote(parsed.path.removeprefix("/"))
        port = parsed.port
        params = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except (ValueError, UnicodeDecodeError) as exc:
        raise Refusal("linked pooler-url has invalid connection fields") from exc
    if (not host or re.search(r"[\s@,]", host) or not user
            or not user.endswith("." + expected_ref) or not database):
        raise Refusal("linked pooler-url has invalid host, user, or database")
    if any(key != "sslmode" for key, _ in params) or len(params) > 1:
        raise Refusal("linked pooler-url has unsupported connection parameters")
    sslmode = params[0][1] if params else "require"
    if sslmode not in {"require", "verify-ca", "verify-full"}:
        raise Refusal("linked pooler-url has an unsafe sslmode")
    env = {key: value for key, value in os.environ.items() if key.upper() not in LIBPQ_ENV_KEYS}
    env.update(PGHOST=host, PGUSER=user, PGDATABASE=database, PGSSLMODE=sslmode)
    if port is not None:
        env["PGPORT"] = str(port)
    env["PGPASSWORD"] = env["SUPABASE_DB_PASSWORD"]
    return url, env


def redact_psql_error(stderr: str, url: str, env: dict[str, str]) -> str:
    text = stderr or ""
    secrets = [url, env.get("PGPASSWORD", ""), env.get("SUPABASE_DB_PASSWORD", "")]
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"postgres(?:ql)?://\S+", "[REDACTED_DATABASE_URL]", text, flags=re.I)
    text = re.sub(
        r'\b(host|user|database|password)\s*[=:]\s*(?:"[^"]*"|\S+)',
        lambda match: f"{match.group(1)}=[REDACTED]",
        text,
        flags=re.I,
    )
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines[:8]) or "psql returned no diagnostic text"


def psql(url: str, env: dict[str, str], sql: str, *, capture: bool = True) -> str:
    if shutil.which("psql") is None:
        raise Refusal("psql is not installed on this runner")
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At"],
        input=sql, text=True, env=env, capture_output=capture, check=False,
    )
    if result.returncode:
        raise Refusal("psql failed:\n" + redact_psql_error(result.stderr or "", url, env))
    return (result.stdout or "").strip()


def validate_remote(url: str, env: dict[str, str], version: str) -> None:
    validate_version(version)
    sql = """
select coalesce(jsonb_object_agg(
  column_name,
  jsonb_build_object('data_type', data_type, 'udt_name', udt_name, 'is_nullable', is_nullable)
), '{}'::jsonb)::text
from information_schema.columns
where table_schema='supabase_migrations' and table_name='schema_migrations'
  and column_name in ('version', 'statements', 'name');
select count(*) from supabase_migrations.schema_migrations where version = '""" + version + "';\n"
    lines = psql(url, env, sql).splitlines()
    if len(lines) != 2:
        raise Refusal("unexpected migration-ledger catalog result")
    try:
        actual = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise Refusal("unexpected migration-ledger catalog result") from exc
    if not isinstance(actual, dict) or set(actual) != set(EXPECTED_COLUMNS):
        raise Refusal("required migration-ledger columns are missing")
    for column, (data_types, nullable, udt_names) in EXPECTED_COLUMNS.items():
        metadata = actual[column]
        if not isinstance(metadata, dict) or (
            metadata.get("data_type") not in data_types
            or metadata.get("is_nullable") != nullable
            or metadata.get("udt_name") not in udt_names
        ):
            raise Refusal(f"migration-ledger column {column} has an incompatible type")
    if lines[1] != "0":
        raise Refusal(f"version {version} is already applied")


def build_wrapper(version: str, name: str, raw: str, statements: list[str]) -> str:
    validate_version(version)
    values = ",\n".join(dollar_quote(s, f"s{i}") for i, s in enumerate(statements))
    return (
        "\\set ON_ERROR_STOP on\nBEGIN;\n" + raw.rstrip() + "\n"
        "INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES (\n"
        + dollar_quote(version, "version") + ", ARRAY[\n" + values + "\n]::text[], "
        + dollar_quote(name, "name") + ");\nCOMMIT;\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations-dir", type=Path, required=True)
    parser.add_argument("--classify-allowlist")
    parser.add_argument("--linked-dir", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--target", choices=["preview", "production"])
    parser.add_argument("--expected-project-ref")
    parser.add_argument("--mode", choices=["check", "apply"])
    args = parser.parse_args()
    try:
        if args.classify_allowlist is not None:
            print(classify_allowlist(args.classify_allowlist))
            return 0
        missing = [
            flag
            for flag, value in (
                ("--linked-dir", args.linked_dir),
                ("--version", args.version),
                ("--target", args.target),
                ("--expected-project-ref", args.expected_project_ref),
                ("--mode", args.mode),
            )
            if value is None
        ]
        if missing:
            raise Refusal("missing required apply arguments: " + ", ".join(missing))
        validate_version(args.version)
        path, name, raw, statements = load_candidate(args.migrations_dir, args.version, args.target)
        url, env = linked_connection(args.linked_dir, args.expected_project_ref)
        validate_remote(url, env, args.version)
        print(f"ATOMIC PREFLIGHT OK: target={args.target} version={args.version} sha256={hashlib.sha256(path.read_bytes()).hexdigest()} statements={len(statements)}")
        if args.mode == "check":
            return 0
        wrapper = build_wrapper(args.version, name, raw, statements)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".sql", delete=False) as handle:
            handle.write(wrapper)
            temp_name = handle.name
        try:
            result = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", temp_name], env=env, text=True, capture_output=True)
            if result.returncode:
                raise Refusal(
                    "atomic apply failed; PostgreSQL rolled back DDL and ledger together:\n"
                    + redact_psql_error(result.stderr or "", url, env)
                )
        finally:
            Path(temp_name).unlink(missing_ok=True)
        verify = psql(
            url,
            env,
            "select count(*)||'|'||coalesce(max(cardinality(statements)),-1)||'|'||"
            "coalesce(max(name),'') from supabase_migrations.schema_migrations where version='"
            + args.version
            + "';\n",
        )
        expected = f"1|{len(statements)}|{name}"
        if verify != expected:
            raise Refusal("post-commit ledger verification failed")
        print(f"ATOMIC APPLY OK: target={args.target} version={args.version} ledger_row=1 statements={len(statements)}")
        return 0
    except Refusal as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
