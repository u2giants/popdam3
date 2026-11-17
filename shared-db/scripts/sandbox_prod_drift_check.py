#!/usr/bin/env python3
"""Read-only structure drift check: DesignFlow sandbox vs production (#6356).

Compares relations, columns, functions, constraints, indexes, policies, triggers and
RLS flags. Both sides are read through the Supabase Management API read-only query
endpoint; nothing is written anywhere. Differences matching the reviewed allowlist
(ALLOWLIST below) are ignored; anything else is reported.

Exit codes: 0 no drift outside the allowlist, 1 drift found, 2 the check could not run.
"""
from __future__ import annotations
import argparse, fnmatch, json, os, sys, urllib.request
from pathlib import Path

PROD = "qsllyeztdwjgirsysgai"
SANDBOX = "xupnyeifmpsacrqahwwm"
SYSTEM = "('pg_catalog','information_schema','pg_toast')"
# Reviewed exceptions (#6356). Sandbox-only objects are never drift. A schema listed in ignore_schemas is not
# compared at all; ignore_patterns are kind:schema.name globs. Every entry needs an owner decision on #6356.
ALLOWLIST = {
    "ignore_schemas": ["dflow_prod", "dflow_archive", "cron", "repack", "realtime", "temp_status_watch", "auth", "storage", "extensions", "vault", "graphql", "graphql_public", "net", "pgsodium", "pgsodium_masks", "supabase_functions", "supabase_migrations", "_realtime", "pgbouncer"],
    # Production-only items excluded by the coordinator on #6356 (2026-11-16): service logins' access rules,
    # retired/frozen backup tables, temp_status_watch triggers, and the packaging rule that names a person by
    # email. The two Coldlion sync functions are copied with dflow in place of production's dflow_prod.
    "ignore_patterns": [
        "*:core.merchGroup_retired_20261115*", "*:core.merchGroupHeaders_retired_20261115*",
        "*:plm.creative_submission_property_resolution_archive*", "*:plm.creative_submission_property_resolution_member_archive*",
        "policy:coldlion.item_detail.hts_evaluation_read", "policy:plm.customs_benchmark_*.hts_evaluation_read",
        "policy:coldlion.merch_group_event_log.merch_group_event_log_runtime_*",
        "policy:coldlion.*_history_line.coldlion_history_tracking_read",
        "policy:pim.ai_activity_triage*.pm_ai_activity_triage*_worker_all",
        "policy:plm.*.*_dflow_prod_tracking", "function:api.oracle_user_directory()",
        "trigger:core.licensor.licensor_status_*", "trigger:core.property.property_status_*",
        "policy:core.packaging_type.admin_or_packaging_manager_write", "policy:core.packaging_type.shared_read",
        "function:plm.sync_core_licensor_from_coldlion(*", "function:plm.sync_core_property_from_coldlion(*",
    ],
}

QUERIES = {
    "relation": f"select n.nspname||'.'||c.relname k, c.relkind::text v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in {SYSTEM} and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S','f') and not c.relispartition",
    "rls": f"select n.nspname||'.'||c.relname k, c.relrowsecurity::text||'/'||c.relforcerowsecurity::text v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in {SYSTEM} and c.relkind in ('r','p') and not c.relispartition",
    "column": f"select table_schema||'.'||table_name||'.'||column_name k, data_type||'/'||is_nullable||'/'||coalesce(column_default,'') v from information_schema.columns where table_schema not in {SYSTEM}",
    "function": f"select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k, md5(pg_get_functiondef(p.oid)) v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in {SYSTEM} and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')",
    "constraint": f"select n.nspname||'.'||c.relname||'.'||k.conname k, pg_get_constraintdef(k.oid) v from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not in {SYSTEM} and not c.relispartition",
    "index": f"select schemaname||'.'||tablename||'.'||indexname k, indexdef v from pg_indexes where schemaname not in {SYSTEM}",
    "policy": f"select schemaname||'.'||tablename||'.'||policyname k, cmd||'/'||roles::text||'/'||coalesce(qual,'')||'/'||coalesce(with_check,'') v from pg_policies",
    "trigger": f"select n.nspname||'.'||c.relname||'.'||g.tgname k, pg_get_triggerdef(g.oid) v from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where not g.tgisinternal and n.nspname not in {SYSTEM}",
}


def read_only_query(ref: str, token: str, sql: str) -> list[dict]:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query/read-only",
        data=json.dumps({"query": "set timezone = 'UTC'; " + sql}).encode(),  # same rendering of timestamp defaults on both sides
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "sandbox-drift-check/1"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        rows = json.load(resp)
    if not isinstance(rows, list):
        raise RuntimeError("unexpected query response")
    return rows


def snapshot(ref: str, token: str, query=read_only_query) -> dict[str, dict[str, str]]:
    return {kind: {r["k"]: r["v"] for r in query(ref, token, sql)} for kind, sql in QUERIES.items()}


def allowed(kind: str, key: str, allowlist: dict) -> bool:
    schema = key.split(".", 1)[0]
    if schema in allowlist.get("ignore_schemas", []):
        return True
    full = f"{kind}:{key}"
    return any(fnmatch.fnmatchcase(full, pat) for pat in allowlist.get("ignore_patterns", []))


# Production's DesignFlow schema is dflow_prod; the sandbox's is dflow (#6356). A definition that differs
# only by that schema name is the same object, not drift.
def same_definition(prod_value: str, sandbox_value: str) -> bool:
    return prod_value == sandbox_value or prod_value.replace("dflow_prod.", "dflow.") == sandbox_value


# Production service logins excluded from the sandbox (#6356, 2026-11-16). A policy that applies only to these
# roles is production-only by that decision and is not drift.
EXCLUDED_ROLES = {
    "dam_image_embed_login", "dam_image_embed_worker", "designflow_hts_alsand_runtime", "designflow_hts_alsand_worker",
    "designflow_hts_evaluation_read", "designflow_hts_evaluation_reader", "designflow_hts_prod_runtime",
    "designflow_hts_prod_worker", "designflow_prod_backend_grants", "designflow_prod_backend_runtime",
    "designflow_prod_data_sync_grants", "designflow_prod_data_sync_runtime", "designflow_prod_item_master_grants",
    "designflow_prod_item_master_runtime", "designflow_prod_tracking_grants", "designflow_prod_tracking_runtime",
    "oracle_directory_reader", "pm_jev_triage_worker", "poppim_readonly_jcortazar",
}


def excluded_role_policy(kind: str, value: str) -> bool:
    if kind != "policy":
        return False
    parts = value.split("/", 2)
    if len(parts) < 2 or not parts[1].startswith("{"):
        return False
    roles = {r.strip('"') for r in parts[1].strip("{}").split(",") if r}
    return bool(roles) and roles <= EXCLUDED_ROLES


def compare(prod: dict, sandbox: dict, allowlist: dict) -> dict[str, list[str]]:
    """Return {category: [message]} for drift outside the allowlist. Sandbox-only objects are not drift."""
    out: dict[str, list[str]] = {}
    for kind in QUERIES:
        p, s = prod[kind], sandbox[kind]
        for key in sorted(p):
            if allowed(kind, key, allowlist):
                continue
            if excluded_role_policy(kind, p[key]):
                continue
            if key not in s:
                out.setdefault(f"missing {kind}", []).append(key)
            elif not same_definition(p[key], s[key]):
                out.setdefault(f"changed {kind}", []).append(key)
    return out


def render(drift: dict[str, list[str]], limit: int = 25) -> str:
    if not drift:
        return "No drift outside the allowlist: sandbox structure matches production."
    lines = ["Sandbox structure differs from production outside the reviewed allowlist:"]
    for cat in sorted(drift):
        items = drift[cat]
        lines.append(f"- {cat}: {len(items)}" + (" (first %d: %s)" % (limit, ", ".join(items[:limit])) if items else ""))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        print("UNVERIFIABLE: SUPABASE_ACCESS_TOKEN is not set", file=sys.stderr)
        return 2
    try:
        drift = compare(snapshot(PROD, token), snapshot(SANDBOX, token), ALLOWLIST)
    except Exception as exc:  # noqa: BLE001 - any failure means the check did not run
        print(f"UNVERIFIABLE: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    text = render(drift)
    print(text)
    if args.output:
        args.output.write_text(text + "\n")
    return 1 if drift else 0


if __name__ == "__main__":
    raise SystemExit(main())
