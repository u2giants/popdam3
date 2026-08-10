#!/usr/bin/env python3
"""Post-apply CATALOG verification for the bounded production migration lane.

WHY THIS EXISTS (issue #697, found by verifying the canary apply, issue #677)
----------------------------------------------------------------------------
`supabase db push` DISCARDS `RAISE NOTICE` and every other DO-block output, and
the only post-apply step the lane ever had was `supabase migration list
--linked` -- a LEDGER read. So the lane could prove that it WROTE. It could not
prove WHAT it wrote.

After the fully green canary apply only 2 of 5 basic checks were provable from
the artifacts. "The table exists", "it holds exactly one row" and "RLS is on
with zero policies" were all INFERENCE FROM READING THE SQL, not observation of
production. For a throwaway canary that is tolerable. For the Disney, Paramount,
NBCU and Warner batches -- which are largely ABOUT grants and RLS -- it is not:
whether a revoke actually took is a CATALOG FACT, and a self-asserting migration
whose assertion is wrong, or simply absent, looks IDENTICAL to one that is right.

This repo already carries that scar. A migration installed cleanly whose BEFORE
trigger read a `GENERATED ... STORED` column that Postgres populates AFTER
before-triggers, so the value was always NULL, the guard never fired, and no
error was ever raised. The rule written down afterwards -- assert the BEHAVIOUR,
and verify the OBJECT exists (`to_regclass`, `pg_trigger`, `pg_get_viewdef`),
never just the ledger row -- is the rule this module finally applies to the
production lane itself.


WHAT IT DOES
------------
1. DERIVES a target list from the allowlisted migration FILES (so it is general,
   not canary-specific): tables, views, RLS-bearing relations, functions,
   grant/revoke grantees, and tables that got an INSERT.
2. Runs a small number of STRICTLY READ-ONLY queries against production through
   the Supabase Management API `database/query` endpoint, with `read_only: true`.
3. Writes both a JSON payload and a human-readable Markdown report to disk, so
   the workflow can upload them into the 90-day run ARTIFACT. The job log gets
   scrolled past; the artifact is the evidence.


THE FAIL-vs-RECORD DECISION, AND WHY
------------------------------------
It is SPLIT, deliberately, and the split line is: FAIL only where the lane
KNOWS the expected answer; RECORD where it does not.

  * HARD FAIL -- a REQUIRED table or view whose `to_regclass` is NULL after a
    successful apply. There is exactly one correct answer here and the lane
    knows it. A migration that reported success and did not leave its table
    behind is a catastrophe, not a matter of taste. A relation named only by an
    `alter ... if exists` is NOT required: the SQL itself says absence is
    tolerated, and failing on it would be a false positive.
  * HARD FAIL -- a derived function or procedure with NO overload in `pg_proc`.
    The lane knows this expected answer identically to `to_regclass`; an applied
    `create or replace function` whose routine is not there is the same
    catastrophe as a missing table. (Warner derives 21 functions, Paramount 11.)
  * HARD FAIL -- the verification could not run at all (API error, empty result,
    unparseable payload) while there WAS something to verify. "No evidence" must
    never render as "evidence passed"; that is the precise failure mode #697 was
    opened about, and reproducing it inside the fix would be absurd.
  * HARD FAIL -- the derivation found NOTHING to check. A run in which this step
    proved nothing must not report itself green, for the same reason.
  * RECORD ONLY -- privileges (relation AND function), RLS flags, policy counts,
    function definitions, reloptions, row counts. The lane has no expected value for these. A grant may be
    intended; a policy count of 3 may be exactly right. Inventing an expectation
    here would manufacture FALSE POSITIVES that block correct promotions, and a
    gate that cries wolf is how approvers are trained to click through. These are
    published as EVIDENCE FOR A HUMAN, which is what the licensor batches
    actually need: a reviewable statement of what production now grants.

Failing cannot roll anything back -- by the time this runs, the write has
happened. That is not an argument for staying quiet. A red run is what makes a
human open the artifact, and the artifact is retained for 90 days.


WHAT THIS CANNOT PROVE -- read this before trusting it
------------------------------------------------------
  * The derivation is a LEXER over SQL text, and lexer bugs have twice been the
    cause of guard failures in this repo. It therefore UNDER-CLAIMS on purpose:
    only plainly-written `schema.object` identifiers are picked up. Anything
    reached through `execute format(...)`, a quoted or mixed-case identifier, a
    search_path-relative name, or `alter default privileges` is NOT in the target
    list and is NOT checked. A short target list is not a clean bill of health,
    and the report says so in its own text.
  * It observes the state AFTER the apply. It does not attribute that state to
    the apply, and it cannot distinguish an object this batch created from one
    that already existed.
  * The privilege matrix is effective privilege plus the raw ACL, for relations
    AND for functions. It says what production grants; it does not say what
    production SHOULD grant. For functions, `acl_is_default` (a NULL `proacl`)
    means EXECUTE TO PUBLIC -- the state a missing revoke leaves behind -- and
    is reported explicitly so it cannot be misread as "no grants". Argument
    defaults, `security definer` status and the function BODY are not compared
    against anything.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_migration_guard import (  # noqa: E402
    GuardError,
    local_migrations,
    parse_allowlist,
    strip_sql,
)

MANAGEMENT_API = "https://api.supabase.com"

# Postgres's seven table privilege bits. MAINTAIN is PG 17 and is the exact trap
# the canary was written to catch (#664: 39 `plm` tables carrying an unintended
# MAINTAIN grant). It is added CONDITIONALLY in SQL rather than unconditionally,
# because `has_table_privilege(..., 'MAINTAIN')` raises on PG < 17 and would take
# the whole report down with it on any older target.
BASE_PRIVILEGES = (
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
)
MAINTAIN_PRIVILEGE = "MAINTAIN"

# Always probed, whether or not the migrations mention them. These four are the
# ones that matter for the browser-facing surface, and their ABSENCE from a
# migration's text is not evidence they hold nothing -- `alter default privileges
# in schema plm grant all on tables to service_role` (20260710135975) fires at
# CREATE TABLE with nothing in the creating migration to hint at it.
ALWAYS_PROBED_ROLES = ("public", "anon", "authenticated", "service_role")

IDENT = r"[a-z_][a-z0-9_]*"
QUALIFIED = rf"({IDENT})\.({IDENT})"
ROLE_RE = re.compile(rf"^{IDENT}$")

# Every pattern below is anchored at the START of an already-split statement, so
# a keyword appearing mid-statement cannot be mistaken for a statement head.
CREATE_TABLE_RE = re.compile(
    rf"^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?{QUALIFIED}"
)
CREATE_VIEW_RE = re.compile(
    r"^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+|recursive\s+)?view\s+"
    rf"(?:if\s+not\s+exists\s+)?{QUALIFIED}"
)
CREATE_ROUTINE_RE = re.compile(
    rf"^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+{QUALIFIED}"
)
# `alter view` matters as much as `alter table` here: `alter view
# api.dam_order_list set (security_invoker = true)` (20260810110000) is a real
# security fix and the ONLY statement in that file outside a `do $$` block, so a
# table-only pattern derived nothing at all from it.
#
# `if exists` is CAPTURED SEPARATELY and the relation is NOT required to exist.
# `alter table if exists` says in the SQL itself that the author accepts its
# absence; hard-failing the job on a relation the migration explicitly tolerated
# missing is a false positive, and a gate that cries wolf trains approvers to
# click through.
ALTER_RELATION_RE = re.compile(
    r"^\s*alter\s+(table|view|materialized\s+view|foreign\s+table)\s+"
    rf"(if\s+exists\s+)?(?:only\s+)?{QUALIFIED}"
)
ROW_SECURITY_RE = re.compile(r"\brow\s+level\s+security\b")
CREATE_POLICY_RE = re.compile(rf"^\s*create\s+policy\b[\s\S]*?\bon\s+{QUALIFIED}")
INSERT_INTO_RE = re.compile(rf"^\s*insert\s+into\s+{QUALIFIED}")
GRANT_RE = re.compile(r"^\s*(grant|revoke)\b")
# The object of a GRANT/REVOKE. `all tables in schema` is DELIBERATELY NOT
# matched: it names a schema, not a relation, and guessing its membership is
# exactly the mis-parse this module refuses to make.
GRANT_OBJECT_RE = re.compile(
    rf"\bon\s+(?:table\s+|sequence\s+|view\s+)?{QUALIFIED}"
)
GRANT_ROLES_RE = re.compile(r"\b(?:to|from)\s+([a-z0-9_,\s]+?)(?:\bwith\b|$)")


class Targets:
    """The objects a batch of migration files says it touches.

    Every field is a sorted list so the report, and therefore the artifact, is
    byte-stable between runs of the same allowlist.
    """

    def __init__(
        self,
        tables: set[str],
        views: set[str],
        rls_relations: set[str],
        functions: set[str],
        roles: set[str],
        seeded: set[str],
        optional: set[str] | None = None,
    ) -> None:
        self.tables = sorted(tables)
        self.views = sorted(views)
        self.rls_relations = sorted(rls_relations)
        self.functions = sorted(functions)
        self.roles = sorted(roles)
        self.seeded = sorted(seeded)
        # Relations an `... if exists` statement named. Read if present, NEVER
        # required: the migration said in its own SQL that it tolerates absence.
        self.optional = sorted(set(optional or set()) - set(tables) - set(views))

    @property
    def required_relations(self) -> list[str]:
        """Relations whose absence is a hard failure."""
        return sorted(set(self.tables) | set(self.views))

    @property
    def relations(self) -> list[str]:
        """Everything to run `to_regclass` over, required or not."""
        return sorted(set(self.required_relations) | set(self.optional))

    def is_empty(self) -> bool:
        return not (
            self.relations or self.functions or self.seeded or self.rls_relations
        )

    def as_dict(self) -> dict[str, list[str]]:
        return {
            "tables": self.tables,
            "views": self.views,
            "optional_relations": self.optional,
            "rls_relations": self.rls_relations,
            "functions": self.functions,
            "roles": self.roles,
            "seeded": self.seeded,
        }


def split_statements(text: str) -> list[str]:
    """Split already-stripped SQL on `;`.

    Safe ONLY because `strip_sql` has already removed comments, blanked string
    literals and removed dollar-quoted bodies -- so no semicolon inside any of
    those survives to split on. Do not call this on raw SQL.
    """
    return [part for part in text.split(";") if part.strip()]


def _roles_in(statement: str) -> set[str]:
    match = GRANT_ROLES_RE.search(statement)
    if not match:
        return set()
    found: set[str] = set()
    for token in match.group(1).split(","):
        name = token.strip()
        # `group x`, `current_user`, `session_user` and anything that is not a
        # plain lowercase identifier are dropped rather than guessed at.
        if name.startswith("group "):
            name = name[len("group ") :].strip()
        if name in {"current_user", "session_user", ""}:
            continue
        if ROLE_RE.fullmatch(name):
            found.add(name)
    return found


def derive_targets(migrations: dict[str, Path], allowlist: list[str]) -> Targets:
    """Read the allowlisted migration files and list what to go and look at.

    CONSERVATIVE BY CONSTRUCTION. It recognises only plainly-written
    `schema.object` identifiers at the head of a statement. When it cannot tell,
    it stays silent -- a wrong object list that reads as verified is worse than
    a short one, and this repo has twice been bitten by a lexer that claimed too
    much (a `$$` inside a comment; prose inside a string literal).
    """
    tables: set[str] = set()
    views: set[str] = set()
    rls: set[str] = set()
    functions: set[str] = set()
    roles: set[str] = set(ALWAYS_PROBED_ROLES)
    seeded: set[str] = set()
    optional: set[str] = set()

    for version in allowlist:
        path = migrations.get(version)
        if path is None:
            raise GuardError(f"unknown migration version: {version}")
        text = strip_sql(path.read_text(encoding="utf-8"))
        for statement in split_statements(text):
            if match := CREATE_TABLE_RE.match(statement):
                tables.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := CREATE_VIEW_RE.match(statement):
                views.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := CREATE_ROUTINE_RE.match(statement):
                functions.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := CREATE_POLICY_RE.match(statement):
                rls.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := INSERT_INTO_RE.match(statement):
                seeded.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := ALTER_RELATION_RE.match(statement):
                kind, if_exists = match.group(1), match.group(2)
                name = f"{match.group(3)}.{match.group(4)}"
                if if_exists:
                    # The migration itself tolerates the relation being absent,
                    # so requiring it here would be a false positive. Read it if
                    # it happens to be there; never fail on it.
                    optional.add(name)
                elif kind == "table":
                    # An ALTER names a relation that must exist afterwards,
                    # whether or not this batch created it.
                    tables.add(name)
                else:
                    # A view is not a table: keeping the distinction stops the
                    # blanket "every relation gets an RLS reading" rule from
                    # claiming row security on something that cannot have it.
                    views.add(name)
                if kind == "table" and ROW_SECURITY_RE.search(statement):
                    rls.add(name)
                continue
            if GRANT_RE.match(statement):
                roles |= _roles_in(statement)
                if match := GRANT_OBJECT_RE.search(statement):
                    tables.add(f"{match.group(1)}.{match.group(2)}")

    # A view that also matched a table-shaped rule stays a view; `to_regclass`
    # covers both, and `relkind` in the report says which it really is.
    tables -= views
    # Every relation is worth an RLS reading -- RLS-on-with-zero-policies was the
    # single check the canary run could not confirm at all.
    rls |= tables
    return Targets(tables, views, rls, functions, roles, seeded, optional)


def _sql_array(values: list[str]) -> str:
    for value in values:
        # Everything reaching here came out of the regexes above, which accept
        # only `[a-z_][a-z0-9_]*`. Re-asserted rather than assumed: this string
        # is interpolated into SQL, and a silent change to a regex upstream must
        # not turn into an injection downstream.
        for part in value.split("."):
            if not ROLE_RE.fullmatch(part):
                raise GuardError(f"refusing to interpolate unsafe identifier: {value}")
    if not values:
        return "array[]::text[]"
    inner = ", ".join(f"'{value}'" for value in values)
    return f"array[{inner}]::text[]"


def build_catalog_sql(targets: Targets) -> str:
    """One read-only statement returning the whole catalog reading as JSON.

    Uses the CATALOGS (`pg_class`, `pg_policy`, `pg_proc`) rather than the
    information_schema or the `pg_policies` view, because the catalogs are not
    filtered by the caller's privileges and this report must not silently shrink.
    """
    relations = _sql_array(targets.relations)
    rls_relations = _sql_array(targets.rls_relations)
    roles = _sql_array(targets.roles)
    functions = _sql_array(targets.functions)
    return f"""
with rel as (
  select n as name, to_regclass(n) as oid from unnest({relations}) as n
),
rls as (
  select n as name, to_regclass(n) as oid from unnest({rls_relations}) as n
),
privs as (
  select unnest(
    array{list(BASE_PRIVILEGES)}::text[]
    || case when current_setting('server_version_num')::int >= 170000
            then array['{MAINTAIN_PRIVILEGE}']::text[]
            else array[]::text[] end
  ) as priv
),
probe_roles as (
  select r as role from unnest({roles}) as r
  where r = 'public' or exists (select 1 from pg_roles where rolname = r)
)
select jsonb_build_object(
  'server_version', current_setting('server_version'),
  'maintain_probed', current_setting('server_version_num')::int >= 170000,
  'checked_at', now(),
  'relations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rel.name,
      'to_regclass', rel.oid::text,
      'relkind', (select c.relkind::text from pg_class c where c.oid = rel.oid),
      'reloptions', (select to_jsonb(c.reloptions) from pg_class c where c.oid = rel.oid)
    ) order by rel.name) from rel), '[]'::jsonb),
  'row_security', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rls.name,
      'exists', rls.oid is not null,
      'relrowsecurity', (select c.relrowsecurity from pg_class c where c.oid = rls.oid),
      'relforcerowsecurity', (select c.relforcerowsecurity from pg_class c where c.oid = rls.oid),
      'policy_count', (select count(*) from pg_policy p where p.polrelid = rls.oid),
      'policies', (select coalesce(jsonb_agg(p.polname::text order by p.polname), '[]'::jsonb)
                     from pg_policy p where p.polrelid = rls.oid)
    ) order by rls.name) from rls), '[]'::jsonb),
  'effective_privileges', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rel.name, 'role', probe_roles.role, 'privilege', privs.priv,
      'held', has_table_privilege(probe_roles.role, rel.oid, privs.priv)
    ) order by rel.name, probe_roles.role, privs.priv)
    from rel cross join probe_roles cross join privs
    where rel.oid is not null
      and has_table_privilege(probe_roles.role, rel.oid, privs.priv)), '[]'::jsonb),
  'acl', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rel.name,
      -- aclexplode returns OID 0 for PUBLIC, never NULL, and `0::regrole::text`
      -- renders as a bare `-`. A grant to PUBLIC is exactly the drift class of
      -- #664/#649, so it must be searchable by name in the artifact.
      'grantee', case when a.grantee = 0 then 'PUBLIC'
                      else a.grantee::regrole::text end,
      'privilege', a.privilege_type,
      'grantor', case when a.grantor = 0 then 'PUBLIC'
                      else a.grantor::regrole::text end
    ) order by rel.name, a.grantee, a.privilege_type)
    from rel
    join pg_class c on c.oid = rel.oid
    cross join lateral aclexplode(c.relacl) a), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', f,
      'overloads', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'identity', p.oid::regprocedure::text,
          'prokind', p.prokind::text,
          'has_definition', pg_get_functiondef(p.oid) is not null,
          -- FUNCTION PRIVILEGES (issue #697 review, H1). Without these the
          -- report showed a function existing with a readable definition and
          -- said NOTHING about whether its revoke took -- while a section
          -- headed "Functions" invites the reader to assume it was checked.
          -- 20260810090000's ENTIRE privilege payload is
          -- `revoke all on function plm.load_pmt_capture_chunk(...) from
          -- public, anon, authenticated`. 20260810020000 carries 14 more of
          -- the same shape, and 20260810030000 / 20260810130000 likewise.
          -- Whether a revoke took is a catalog fact -- that is the whole
          -- thesis of #697.
          --
          -- `proacl is null` means DEFAULT privileges, which for a function
          -- is `EXECUTE to PUBLIC`. That is the opposite of "no grants", and
          -- it is precisely the state a missing revoke leaves behind, so it
          -- is reported explicitly rather than rendered as an empty list.
          'acl_is_default', p.proacl is null,
          'acl', coalesce((
            select jsonb_agg(jsonb_build_object(
              'grantee', case when a.grantee = 0 then 'PUBLIC'
                              else a.grantee::regrole::text end,
              'privilege', a.privilege_type,
              'grantor', case when a.grantor = 0 then 'PUBLIC'
                              else a.grantor::regrole::text end
            ) order by a.grantee, a.privilege_type)
            from aclexplode(p.proacl) a), '[]'::jsonb),
          'execute_held_by', coalesce((
            select jsonb_agg(probe_roles.role order by probe_roles.role)
            from probe_roles
            where has_function_privilege(probe_roles.role, p.oid, 'EXECUTE')
          ), '[]'::jsonb)
        ) order by p.oid::regprocedure::text), '[]'::jsonb)
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = split_part(f, '.', 1)
          and p.proname = split_part(f, '.', 2)
          and p.prokind in ('f', 'p')
      )
    ) order by f) from unnest({functions}) as f), '[]'::jsonb)
) as report
""".strip()


def build_row_count_sql(seeded: list[str]) -> str:
    """Row counts for seeded relations.

    A SEPARATE query on purpose. `select count(*) from sch.tab` cannot be driven
    off an array without dynamic SQL, so each name is emitted literally -- and a
    single missing relation would then take the WHOLE report down with a 42P01.
    Isolating it means a missing table costs the row counts, not the privileges
    and RLS readings, which are the evidence the licensor batches actually need.
    """
    if not seeded:
        return ""
    _sql_array(seeded)  # identifier safety re-assertion
    branches = " union all ".join(
        f"select '{name}'::text as name, (select count(*) from {name})::bigint as rows"
        for name in seeded
    )
    return f"select jsonb_agg(x order by x->>'name') as report from ({branches}) x"


def run_query(project_ref: str, token: str, sql: str, api: str = MANAGEMENT_API):
    """POST a single read-only statement to the Management API query endpoint.

    `read_only: true` is sent so the server, not this script's good intentions,
    is what forbids a write. If the endpoint rejects the field the caller is told
    LOUDLY -- it is never quietly dropped.
    """
    url = f"{api.rstrip('/')}/v1/projects/{project_ref}/database/query"
    body = json.dumps({"query": sql, "read_only": True}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_report(payload: object) -> object:
    """Pull the single `report` value out of whatever row shape comes back."""
    rows = payload
    if isinstance(rows, dict):
        for key in ("result", "data", "rows"):
            if isinstance(rows.get(key), list):
                rows = rows[key]
                break
    if not isinstance(rows, list) or not rows:
        raise GuardError("catalog query returned no rows")
    first = rows[0]
    if not isinstance(first, dict) or "report" not in first:
        raise GuardError(f"catalog query returned an unexpected shape: {first!r}")
    return first["report"]


def render_report(
    allowlist: list[str],
    targets: Targets,
    catalog: object,
    row_counts: object,
    errors: list[str],
    enforcing: bool,
) -> tuple[str, list[str]]:
    """Render the Markdown artifact and return the HARD FAILURES it found.

    Only two things go in the failure list -- see the module docstring. A missing
    relation, and an absence of evidence. Everything else is printed for a human
    and returned to nobody.
    """
    failures: list[str] = []
    lines: list[str] = []
    add = lines.append
    add("# Production catalog verification")
    add("")
    add(f"Allowlist: `{', '.join(allowlist)}`")
    add("")
    add(
        "Mode: **"
        + ("ENFORCING" if enforcing else "RECORD ONLY")
        + "**. Enforcing fails the job on a missing relation or on missing "
        "evidence; record-only is used when the apply itself did not succeed, "
        "where a missing object is already explained."
    )
    add("")
    add("## What this can and cannot prove")
    add("")
    add(
        "- It reads the CATALOG after the apply. It does not attribute that "
        "state to the apply, and cannot tell an object this batch created from "
        "one that already existed."
    )
    add(
        "- The target list is derived by a conservative LEXER over the migration "
        "text. Objects named only through `execute format(...)`, quoted or "
        "mixed-case identifiers, search_path-relative names, or `alter default "
        "privileges` are NOT listed and NOT checked. **A short list is not a "
        "clean bill of health.**"
    )
    add(
        "- Privileges, RLS flags, policy counts and row counts are EVIDENCE, not "
        "assertions. The lane has no expected value for them; a human reads them."
    )
    add(
        "- **Function privileges are the raw `proacl` plus an `EXECUTE` probe of "
        "the derived roles.** `acl_is_default = true` means `proacl` is NULL, "
        "which for a function is **`EXECUTE` to `PUBLIC`** — the state a missing "
        "revoke leaves behind, NOT \"no grants\". Privileges on arguments, "
        "argument defaults, `security definer` status and the function BODY are "
        "not compared against anything."
    )
    add("")
    add("## Derived targets")
    add("")
    for label, values in targets.as_dict().items():
        add(f"- **{label}** ({len(values)}): " + (", ".join(f"`{v}`" for v in values) or "_none_"))
    add("")

    if errors:
        add("## Errors")
        add("")
        for error in errors:
            add(f"- {error}")
        add("")

    if targets.is_empty():
        # ISSUE #697 EXISTS BECAUSE A GREEN TICK WAS MISTAKEN FOR EVIDENCE.
        # A run where this step proved nothing must therefore not end green in
        # enforcing mode. `20260810110000` lands exactly here: its only
        # statement outside a `do $$` block is an `alter view`, and before the
        # review fix even that derived nothing. The remedy for a genuinely
        # unverifiable migration is to say so on the issue, not to let the lane
        # report a verification it did not perform.
        failures.append(
            "the allowlisted migrations named NO catalog object this lexer can "
            "read, so this step proved nothing. That may be legitimate (a "
            "pure-data migration), but a run that verified nothing must not "
            "report itself green. Record the reason on the issue."
        )

    if catalog is None:
        if not targets.is_empty():
            failures.append(
                "the catalog query produced NO evidence while there were "
                f"{len(targets.relations)} relation(s), "
                f"{len(targets.functions)} function(s) and "
                f"{len(targets.seeded)} seeded relation(s) to check. "
                "Absence of evidence is not evidence."
            )
        add("_No catalog evidence was produced._")
        return "\n".join(lines) + "\n", failures

    data = catalog if isinstance(catalog, dict) else {}
    add(
        f"Server: `{data.get('server_version')}` — MAINTAIN probed: "
        f"`{data.get('maintain_probed')}` — read at `{data.get('checked_at')}`"
    )
    add("")

    add("## Relations (`to_regclass`)")
    add("")
    add("| name | required | to_regclass | relkind | reloptions |")
    add("| --- | --- | --- | --- | --- |")
    required = set(targets.required_relations)
    for row in data.get("relations") or []:
        resolved = row.get("to_regclass")
        name = row.get("name")
        options = ", ".join(f"`{o}`" for o in (row.get("reloptions") or [])) or "_none_"
        add(
            f"| `{name}` | {name in required} | `{resolved or 'NULL'}` | "
            f"`{row.get('relkind') or ''}` | {options} |"
        )
        if resolved is None and name in required:
            failures.append(
                f"{name}: to_regclass is NULL — the apply reported "
                "success and the object is not there"
            )
    add("")

    add("## Row-level security")
    add("")
    add("| name | exists | relrowsecurity | forced | policies | policy names |")
    add("| --- | --- | --- | --- | --- | --- |")
    for row in data.get("row_security") or []:
        names = ", ".join(f"`{p}`" for p in (row.get("policies") or [])) or "_none_"
        add(
            f"| `{row.get('name')}` | {row.get('exists')} | "
            f"{row.get('relrowsecurity')} | {row.get('relforcerowsecurity')} | "
            f"{row.get('policy_count')} | {names} |"
        )
    add("")

    add("## Effective privileges held (`has_table_privilege`)")
    add("")
    add(
        "Only privileges that ARE held are listed. An empty table means the "
        "probed roles hold nothing on the derived relations."
    )
    add("")
    add("| name | role | privilege |")
    add("| --- | --- | --- |")
    for row in data.get("effective_privileges") or []:
        add(f"| `{row.get('name')}` | `{row.get('role')}` | `{row.get('privilege')}` |")
    add("")

    add("## Raw ACL (`aclexplode`) — every grantee, including roles nobody named")
    add("")
    add(
        "This is the section that catches a grant to a role the migrations never "
        "mention, which the effective-privilege matrix above cannot see."
    )
    add("")
    add("| name | grantee | privilege | grantor |")
    add("| --- | --- | --- | --- |")
    for row in data.get("acl") or []:
        add(
            f"| `{row.get('name')}` | `{row.get('grantee')}` | "
            f"`{row.get('privilege')}` | `{row.get('grantor')}` |"
        )
    add("")

    add("## Functions (`pg_get_functiondef`)")
    add("")
    add("| name | overload | kind | definition readable |")
    add("| --- | --- | --- | --- |")
    for row in data.get("functions") or []:
        overloads = row.get("overloads") or []
        if not overloads:
            add(f"| `{row.get('name')}` | **NOT FOUND** | | |")
            # Same class of catastrophe as a missing table, and the lane knows
            # the expected answer identically: an applied `create or replace
            # function` with nothing in pg_proc. Warner derives 21 functions and
            # Paramount 11; any of them silently vanishing used to pass green.
            failures.append(
                f"{row.get('name')}: no function or procedure of that name "
                "exists in pg_proc — the apply reported success and the "
                "routine is not there"
            )
            continue
        for overload in overloads:
            add(
                f"| `{row.get('name')}` | `{overload.get('identity')}` | "
                f"`{overload.get('prokind')}` | {overload.get('has_definition')} |"
            )
    add("")

    add("## Function privileges (`proacl` + `has_function_privilege`)")
    add("")
    add(
        "**`acl default` = true means `proacl` is NULL, which for a function is "
        "`EXECUTE` to `PUBLIC`** — the state a missing revoke leaves behind, not "
        "an absence of grants. Read that column first."
    )
    add("")
    add("| overload | acl default | grantee | privilege | grantor |")
    add("| --- | --- | --- | --- | --- |")
    for row in data.get("functions") or []:
        for overload in row.get("overloads") or []:
            identity = overload.get("identity")
            default = overload.get("acl_is_default")
            acl = overload.get("acl") or []
            if not acl:
                add(f"| `{identity}` | {default} | _no explicit ACL entry_ | | |")
                continue
            for entry in acl:
                add(
                    f"| `{identity}` | {default} | `{entry.get('grantee')}` | "
                    f"`{entry.get('privilege')}` | `{entry.get('grantor')}` |"
                )
    add("")
    add("| overload | roles effectively holding EXECUTE |")
    add("| --- | --- |")
    for row in data.get("functions") or []:
        for overload in row.get("overloads") or []:
            holders = ", ".join(f"`{r}`" for r in (overload.get("execute_held_by") or []))
            add(f"| `{overload.get('identity')}` | {holders or '_none_'} |")
    add("")

    add("## Row counts for seeded relations")
    add("")
    if row_counts:
        add("| name | rows |")
        add("| --- | --- |")
        for row in row_counts:
            add(f"| `{row.get('name')}` | {row.get('rows')} |")
    else:
        add("_Nothing seeded, or the row-count query did not run (see Errors)._")
    add("")
    return "\n".join(lines) + "\n", failures


def verify(
    repo: Path,
    raw_allowlist: str,
    output_dir: Path,
    project_ref: str,
    token: str,
    enforcing: bool,
    api: str = MANAGEMENT_API,
) -> int:
    allowlist = parse_allowlist(raw_allowlist)
    targets = derive_targets(local_migrations(repo), allowlist)

    errors: list[str] = []
    catalog: object = None
    row_counts: object = None

    if targets.is_empty():
        errors.append(
            "the allowlisted migrations named no catalog object this lexer can "
            "read. That may be legal (a pure-data migration), but it means THIS "
            "STEP PROVED NOTHING, so enforcing mode fails rather than letting a "
            "green tick stand in for evidence it never gathered."
        )
    else:
        try:
            catalog = extract_report(
                run_query(project_ref, token, build_catalog_sql(targets), api)
            )
        except (urllib.error.URLError, GuardError, ValueError, OSError) as exc:
            errors.append(f"catalog query failed: {exc}")

    if targets.seeded:
        try:
            row_counts = extract_report(
                run_query(project_ref, token, build_row_count_sql(targets.seeded), api)
            )
        except (urllib.error.URLError, GuardError, ValueError, OSError) as exc:
            errors.append(
                f"row-count query failed (recorded, not fatal on its own): {exc}"
            )

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "production-catalog-verification.json").write_text(
        json.dumps(
            {
                "allowlist": allowlist,
                "targets": targets.as_dict(),
                "catalog": catalog,
                "row_counts": row_counts,
                "errors": errors,
                "enforcing": enforcing,
            },
            indent=2,
            sort_keys=True,
            default=str,
        ),
        encoding="utf-8",
    )
    markdown, failures = render_report(
        allowlist, targets, catalog, row_counts, errors, enforcing
    )
    (output_dir / "production-catalog-verification.md").write_text(
        markdown, encoding="utf-8"
    )
    print(markdown)

    if not failures:
        print("CATALOG VERIFICATION: no hard failure found.")
        return 0
    for failure in failures:
        print(f"CATALOG VERIFICATION FAILURE: {failure}", file=sys.stderr)
    if not enforcing:
        print(
            "Record-only mode: the failures above are reported, not enforced, "
            "because the apply step did not succeed.",
            file=sys.stderr,
        )
        return 0
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--project-ref", required=True)
    # The token comes from the ENVIRONMENT, never argv. Process arguments are
    # visible in OS process listings, and the rest of this lane already passes
    # SUPABASE_ACCESS_TOKEN by env.
    parser.add_argument(
        "--token-env",
        default="SUPABASE_ACCESS_TOKEN",
        help="name of the env var holding the Management API token",
    )
    parser.add_argument(
        "--mode",
        choices=("enforce", "record"),
        default="enforce",
        help="enforce fails the job on a missing relation or missing evidence",
    )
    args = parser.parse_args()
    token = os.environ.get(args.token_env, "")
    if not token:
        print(
            f"CATALOG VERIFICATION BLOCKED: {args.token_env} is empty. Failing "
            "rather than reporting a verification that could never have run.",
            file=sys.stderr,
        )
        return 1
    try:
        return verify(
            args.repo.resolve(),
            args.allowlist,
            args.output_dir,
            args.project_ref,
            token,
            enforcing=args.mode == "enforce",
        )
    except (GuardError, OSError) as exc:
        print(f"CATALOG VERIFICATION BLOCKED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
