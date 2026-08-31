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
  * HARD FAIL -- a PRIVILEGE ASSERTION that did not hold (issue #790). A
    `grant`, a `revoke` or an `alter default privileges` states an expected end
    state, and that state is a catalog fact: `relacl`, `proacl`,
    `pg_default_acl`. Before this the lane printed the ACL and left a human to
    read it; 20260810180000 asserts its own outcome internally, and the lane can
    now make the same assertion externally. Where the catalog cannot answer --
    an owner, who holds everything regardless of ACL; a grant that cannot be
    attributed to one of several overloads -- the row is RECORDed WITH ITS
    REASON, never silently dropped.
  * HARD FAIL -- a routine whose `proacl` IS NULL where a revoke was expected.
    NULL is the DEFAULT acl, and for a function the default is EXECUTE TO
    PUBLIC. It is the state a MISSING revoke leaves behind; reading it as "no
    grants, therefore safe" is the inversion #790 point 4 names. The same trap
    applies to an ABSENT `pg_default_acl` row for object type `f`.
  * RECORD ONLY -- privileges nobody named, RLS flags, policy counts,
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
    reached through `execute format(...)`, a quoted or mixed-case identifier or
    a search_path-relative name is NOT in the target list and is NOT checked.
    A short target list is not a clean bill of health, and the report says so in
    its own text. `alter default privileges` and plain `grant`/`revoke` ARE read
    (issue #790); a privilege statement the lexer cannot read is listed under
    `unassertable_statements` with its reason rather than dropped.
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
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_migration_guard import (  # noqa: E402
    GuardError,
    local_migrations,
    parse_allowlist,
    parse_remote_versions,
    strip_sql,
)

MANAGEMENT_API = "https://api.supabase.com"

# Cloudflare sits in front of api.supabase.com and BANS the default
# `Python-urllib/3.x` signature at the edge with HTTP 403 / error 1010, before
# Supabase ever sees the token (issue #709). An explicit, descriptive
# User-Agent is therefore load-bearing, not cosmetic. Do not remove it.
USER_AGENT = "shared-db-catalog-verification/1.0"

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
ALTER_SCHEMA_RENAME_RE = re.compile(
    rf"^\s*alter\s+schema\s+({IDENT})\s+rename\s+to\s+({IDENT})\s*$"
)
COMMENT_SCHEMA_RE = re.compile(
    rf"^\s*comment\s+on\s+schema\s+({IDENT})\s+is\s+'((?:''|[^'])*)'\s*;",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)
ROW_SECURITY_RE = re.compile(r"\brow\s+level\s+security\b")
CREATE_POLICY_RE = re.compile(rf"^\s*create\s+policy\b[\s\S]*?\bon\s+{QUALIFIED}")
INSERT_INTO_RE = re.compile(rf"^\s*insert\s+into\s+{QUALIFIED}")
CREATE_INDEX_HEAD_RE = re.compile(r"^\s*create\s+(?:unique\s+)?index\b")
CREATE_INDEX_RE = re.compile(
    rf"^\s*create\s+(unique\s+)?index\s+(concurrently\s+)?"
    rf"(?:if\s+not\s+exists\s+)?({IDENT})\s+on\s+(?:only\s+)?{QUALIFIED}\b"
)
GRANT_RE = re.compile(r"^\s*(grant|revoke)\b")
# The object of a GRANT/REVOKE. `all tables in schema` is DELIBERATELY NOT
# matched: it names a schema, not a relation, and guessing its membership is
# exactly the mis-parse this module refuses to make.
GRANT_OBJECT_RE = re.compile(
    rf"\bon\s+(?:table\s+|sequence\s+|view\s+)?{QUALIFIED}"
)
GRANT_ROLES_RE = re.compile(r"\b(?:to|from)\s+([a-z0-9_,\s]+?)(?:\bwith\b|$)")

# ---------------------------------------------------------------------------
# PRIVILEGE-SHAPED MIGRATIONS (issue #790)
#
# `20260810180000` is `alter default privileges` plus conditional revokes, so
# the lexer above derived NOTHING from it and the step correctly refused to
# report green on zero evidence -- failing a CORRECT apply. The remedy is not to
# soften the gate; it is to make the derivation able to read this shape. Every
# batch from B3 to B10 carries grant/revoke-only files that hit the same wall.
#
# The catalog already holds the evidence: `pg_default_acl.defaclacl` for default
# privileges, `pg_class.relacl` for relations, `pg_proc.proacl` for routines. So
# these statements now produce ASSERTIONS -- an expected end state with a
# pass/fail -- rather than an ACL string for a human to squint at.
# ---------------------------------------------------------------------------

# `alter default privileges [for role r] [in schema s] {grant|revoke} <privs>
#  on {tables|sequences|functions|routines|types|schemas} {to|from} <roles>`
ALTER_DEFAULT_PRIVILEGES_RE = re.compile(r"^\s*alter\s+default\s+privileges\b")
ADP_FOR_ROLE_RE = re.compile(r"\bfor\s+(?:role|user)\s+([a-z0-9_,\s]+?)\s+(?=in\s+schema\b|grant\b|revoke\b)")
ADP_IN_SCHEMA_RE = re.compile(r"\bin\s+schema\s+([a-z0-9_,\s]+?)\s+(?=grant\b|revoke\b)")
ADP_ACTION_RE = re.compile(
    r"\b(grant|revoke)\s+(?:grant\s+option\s+for\s+)?(.*?)\s+on\s+"
    r"(tables|sequences|functions|routines|types|schemas)\b\s+(to|from)\s+(.*)$"
)
# A whole GRANT/REVOKE statement, split into privileges / object list / roles.
GRANT_STATEMENT_RE = re.compile(
    r"^\s*(grant|revoke)\s+(?:grant\s+option\s+for\s+)?(.*?)\s+on\s+(.*?)\s+(to|from)\s+(.*)$"
)
ROUTINE_OBJECT_RE = re.compile(r"^\s*(?:function|procedure|routine)\s+(.*)$")
ROUTINE_NAME_RE = re.compile(rf"{QUALIFIED}\s*(\([^)]*\))?")
PLAIN_OBJECT_RE = re.compile(rf"^\s*(?:table\s+|view\s+)?{QUALIFIED}\s*$")

# `alter default privileges ... on <what>` -> the pg_default_acl `defaclobjtype`
# code, and the privileges `all` expands to for that object type.
DEFACL_OBJTYPES = {
    "tables": "r",
    "sequences": "S",
    "functions": "f",
    "routines": "f",
    "types": "T",
    "schemas": "n",
}
SEQUENCE_PRIVILEGES = ("USAGE", "SELECT", "UPDATE")
ALL_PRIVILEGES_BY_OBJTYPE = {
    "r": BASE_PRIVILEGES,          # MAINTAIN added at assert time, PG >= 17 only
    "S": SEQUENCE_PRIVILEGES,
    "f": ("EXECUTE",),
    "T": ("USAGE",),
    "n": ("USAGE", "CREATE"),
}
# What a NEW object gets when pg_default_acl holds NO row for it -- i.e. the
# built-in Postgres default. For a FUNCTION that is `EXECUTE to PUBLIC`, which is
# the exact trap issue #790 point 4 names: the absence of a row reads as "no
# grants" and is nothing of the sort.
BUILTIN_DEFAULT_ACL = {
    "r": {},
    "S": {},
    "f": {"PUBLIC": {"EXECUTE"}},
    "T": {"PUBLIC": {"USAGE"}},
    "n": {},
}

# A migration that genuinely names no catalog object must SAY SO, in itself, and
# the claim is then CHECKED -- it is not taken on trust and it is not a bypass
# flag on this script. See `noop_declaration` below.
NOOP_DECLARATION_RE = re.compile(
    r"^\s*--\s*catalog-verification:\s*no-op\s*[-—:]*\s*(?P<reason>.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
# Statement heads a pure-DATA migration is allowed to contain. Anything else --
# any DDL, any `do $$` block, any grant -- means the file is NOT a no-op and the
# declaration is rejected.
DATA_STATEMENT_RE = re.compile(
    r"^\s*(insert|update|delete|merge|with|select|values|set|reset|analyze)\b"
)

# ---------------------------------------------------------------------------
# NARROWING THE DATA-STATEMENT ALLOWANCE (issue #805)
#
# `DATA_STATEMENT_RE` matches on the HEAD KEYWORD ONLY and never looks at the
# target, so three shapes passed the no-op claim check while doing exactly what
# the check exists to forbid:
#
#   update pg_class set relacl = null where relname='t';   <- a privilege change
#   select dblink_exec('revoke all on t from public');     <- a revoke, via a call
#   set role service_role;                                 <- changes the principal
#
# THESE WERE LATENT, NOT EXPLOITABLE, AND THAT IS THE ARGUMENT FOR FIXING THEM
# RATHER THAN AGAINST IT. Checked read-only against production on 2026-08-11:
# the migration role is not superuser and cannot UPDATE pg_catalog.pg_class, and
# dblink is available but NOT INSTALLED (and a migration cannot install it --
# `create extension` is rejected by this same check). So all three died at apply
# time. But EVERY ONE of those mitigations is ENVIRONMENTAL: none lives in this
# repository, none is asserted by a test, and none would announce itself if it
# changed. Someone installing dblink for an unrelated feature, or a platform
# change to what the migration role may write, converts a theoretical gap into a
# real one with no diff and no failing check anywhere here.
#
# NOTHING IS WIDENED. Every statement these patterns name was ACCEPTED before
# and is REJECTED now; no statement that was rejected becomes accepted. The
# no-op accept path stays fail-closed, which #805 is explicit about.
# ---------------------------------------------------------------------------

# A statement that changes the EXECUTING PRINCIPAL. `set role` alone creates no
# catalog object, so declaring it a no-op is not strictly a false claim -- but a
# file that switches principal is not a "pure data" file in any sense a reviewer
# would recognise, and the claim is a REVIEWER-FACING promise.
#
# `reset role` IS HANDLED WITH IT, which is the half #805 calls out. `reset role`
# restores the session's ORIGINAL (higher) principal, so treating it differently
# from `set role` would leave the more privileged direction as the allowed one.
# `reset all` is included because it resets `role` among everything else.
PRINCIPAL_CHANGE_RE = re.compile(
    r"^\s*(?:set|reset)\s+(?:local\s+|session\s+)*"
    r"(?:role\b|session\s+authorization\b|authorization\b|all\b)"
)

# Write targets, found ANYWHERE in the statement rather than only at its head --
# `with x as (...) update pg_class ...` leads with `with`, and a head-only check
# would wave it through.
_NOOP_TARGET = r"(?:\"?([a-z_][a-z0-9_$]*)\"?\s*\.\s*)?\"?([a-z_][a-z0-9_$]*)\"?"
WRITE_TARGET_RE = re.compile(
    r"\b(?:insert\s+into|update|delete\s+from|merge\s+into)\s+(?:only\s+)?"
    + _NOOP_TARGET
)
# Every system catalog relation is named `pg_*`, and every system catalog schema
# is `pg_catalog` / `pg_toast` / `pg_temp*`. An UNQUALIFIED `pg_class` resolves
# through search_path to `pg_catalog.pg_class`, which is exactly the shape #805
# reproduced, so the unqualified form must be caught too.
CATALOG_SCHEMAS = {"pg_catalog", "information_schema"}

# A function call that executes arbitrary SQL over a connection is not a data
# statement, whatever keyword the statement leads with. Matched by name prefix so
# `dblink_exec`, `dblink_send_query` and `dblink_open` are all covered.
REMOTE_EXEC_RE = re.compile(r"\bdblink\w*\s*\(")


def data_statement_rejection(statement: str) -> str | None:
    """Why this statement is NOT a pure-data statement, or None if it is.

    Returns a REASON rather than a bool so the refusal names what it found. A
    rejection that says only "non-data statement" sends the author looking at
    the wrong keyword.
    """
    if not DATA_STATEMENT_RE.match(statement):
        return "not a data statement"
    if PRINCIPAL_CHANGE_RE.match(statement):
        return (
            "changes the executing principal (set/reset role or session "
            "authorization), so the file is not pure data"
        )
    if REMOTE_EXEC_RE.search(statement):
        return (
            "calls a dblink function, which executes arbitrary SQL over a "
            "connection -- a grant, revoke or DDL can hide inside it"
        )
    for match in WRITE_TARGET_RE.finditer(statement):
        schema, relation = match.group(1), match.group(2)
        target = f"{schema}.{relation}" if schema else relation
        if schema:
            if schema in CATALOG_SCHEMAS or schema.startswith("pg_"):
                return f"writes to the system catalog ({target})"
        elif relation.startswith("pg_"):
            # Unqualified, so it resolves through search_path to pg_catalog.
            return f"writes to the system catalog ({target})"
    return None

BEHAVIOR_SIDECAR_DIR = Path("scripts/production-verification-sidecars")
BEHAVIOR_SIDECAR_KEYS = {
    "schema_version", "migration_version", "migration_sha256", "checks"
}
BEHAVIOR_SIDECAR_MARKER_KEYS = BEHAVIOR_SIDECAR_KEYS | {
    "marker_schema_version", "marker_reviews"
}
MARKER_SCHEMA_VERSION = 1
MARKER_REVIEW_CHECK_KEYS = {"line_start", "line_end", "disposition", "check_ids", "reason"}
MARKER_REVIEW_EMPTY_KEYS = {"line_start", "line_end", "disposition", "reason"}
BEHAVIOR_ROW_COUNT_KEYS = {"id", "kind", "relation", "filters", "expected_count"}
BEHAVIOR_CATALOG_CONTRACT_KEYS = {"id", "kind", "contract", "expected_count"}
BEHAVIOR_FILTER_KEYS = {"column", "type", "equals"}
BEHAVIOR_ENUM_VALUES = {
    "app.entity_status": {"active", "inactive", "archived", "deleted", "potential"},
}
BEHAVIOR_TYPES = {"uuid", "text", "integer", "boolean", *BEHAVIOR_ENUM_VALUES}
DFLOW_BASELINE_RELATIONS = (
    'dflow."AdditionalUserEmail"','dflow."AuditLog"','dflow."ContainerHeader"','dflow."DesignTeamTime"','dflow."DesignTeamTime_id_seq"','dflow."DesignTeamTimes"','dflow."FOBCountry"','dflow."Factory"','dflow."FactoryTime"','dflow."FactoryTime_id_seq"','dflow."FactoryTimes"','dflow."GridAccessLevel"','dflow."GridChildrenLayout"','dflow."GridChildrenLayoutOrder"','dflow."GridLayout"','dflow."GridViewState"','dflow."LicenseFeedBacks"','dflow."LicensingTime"','dflow."LicensingTime_id_seq"','dflow."LicensingTimes"','dflow."OrderLeadTime"','dflow."ProdOrderDetail"','dflow."ProdOrderHeader"','dflow."ProdPaymentTerms"','dflow."ProdShipmentTransitTime"','dflow."ProductNickname"','dflow."RFQContainer"','dflow."RFQGroup"','dflow."RFQItem"','dflow."RFQItemDivision"','dflow."RFQItemStatus"','dflow."RFQStep"','dflow."RFQVendor"','dflow."RFQWhse"','dflow."RolePermissions"','dflow."Roles"','dflow."SeasonCode"','dflow."ShippingPort"','dflow."StandardizedDetail"','dflow."StandardizedGroup"','dflow."StandardizedProductElement"','dflow."StandardizedProductElementValue"','dflow."StandardizedProductType"','dflow."StandardizedSize"','dflow."StandardizedVendor"','dflow."StandardizedVersion"','dflow."StandardizedVersionDetail_id_seq"','dflow."StandardizedVersion_id_seq"','dflow."UDFComponent"','dflow."UDFElement"','dflow."UDFElementType"','dflow."UDFGroup"','dflow."UDFQuery"','dflow."UDFTable"','dflow."UIElements"','dflow."companyCode"','dflow."deliveryLocation"','dflow."divisionCode"','dflow."externalApi"','dflow."externalCustomer"','dflow."externalVendor"','dflow."itemAttachment"','dflow."itemDepth"','dflow."itemDetail"','dflow."itemHeader"','dflow."itemLicenseImage"','dflow."itemSize"','dflow."itemType"','dflow."licenseList"','dflow."licensingFeedbackReply"','dflow."licensingFeedbackReply_id_seq"','dflow."licensingMilestone"','dflow."licensingMilestone_id_seq"','dflow."licensingStatus"','dflow."merchGroup"','dflow."merchGroupHeaders"','dflow."merchGroupMaster"','dflow."merchGroupRelations"','dflow."productUserAssignment"','dflow."vendorGroup"','dflow."vendorGroup_id_seq"','dflow.age_group','dflow.age_group_id_seq','dflow.ai_cache_events','dflow.app_settings','dflow.art_piece','dflow.art_piece_attachment','dflow.art_piece_attachment_id_seq','dflow.art_piece_id_seq','dflow.art_types','dflow.art_types_id_seq','dflow.artist_types','dflow.artist_types_id_seq','dflow.artists','dflow.artists_id_seq','dflow.auth_token','dflow.comments','dflow.customers','dflow.email_logs','dflow.grid_cell_notes','dflow.groups','dflow.groups_id_seq','dflow.item_character_associations','dflow.item_character_associations_id_seq','dflow.item_prod_order_detail_associations','dflow.product_category','dflow.product_category_id_seq','dflow.properties_and_characters','dflow.properties_and_characters_id_seq','dflow.property_character_associations','dflow.quote_auth_token','dflow.user_notification','dflow.users','dflow.vendor'
)
DFLOW_BASELINE_INDEXES = (
    'GridLayout_pkey','GridViewState_user_grid_view','ProdOrderDetail_pkey','RolePermissions_ElementId_fkey','RolePermissions_RoleId_fkey','RolePermissions_UserId_fkey','RolePermissions_unique_role_user_element','StandardizedVersionDetail_pkey','UIElements_ParentId_fkey','age_group_created_by_fkey','age_group_updated_by_fkey','ai_cache_events_created_at_idx','ai_cache_events_feature_created_at_idx','art_piece_attachment_art_piece_id_fkey','art_piece_attachment_company_code_fkey','art_piece_attachment_created_by_fkey','art_piece_attachment_divisioncode_id_fkey','art_piece_attachment_updated_by_fkey','art_piece_created_by_fkey','art_piece_divisioncode_id_fkey','art_piece_updated_by_fkey','art_types_created_by_fkey','art_types_divisioncode_id_fkey','art_types_updated_by_fkey','artist_types_created_by_fkey','artist_types_updated_by_fkey','artists_art_source_id_fkey','artists_artist_type_id_fkey','artists_created_by_fkey','artists_divisioncode_id_fkey','artists_updated_by_fkey','fki_art_piece_artist_id_fkey','grid_cell_notes_grid_row_col_uq','grid_cell_notes_grid_type_idx','idx_itemLicenseImage_item','idx_item_character_associations_character_id','idx_itemlicenseimage_item','idx_licensing_feedback_reply_status','idx_properties_licensor_id','idx_properties_name','idx_property_character_associations_character_id','idx_property_character_associations_licensor_id','idx_property_character_associations_property_id','idx_relations_child','idx_relations_grand_parent','idx_relations_parent','idx_rfqItem_copied_from_id','idx_rfqitem_choosen_vendor','idx_rfqitem_container','idx_rfqitem_customer','idx_rfqitem_delivery_loc','idx_rfqitem_divcode','idx_rfqitem_home_list','idx_rfqitem_rfq_group','idx_rfqitem_step','idx_rfqvendor_item_fk','idx_rfqvendor_vendor_archived','itemType_name_key','itemType_status_idx','item_prod_order_detail_associations_item_header_idx','item_prod_order_detail_associations_matched_item_number_idx','item_prod_order_detail_associations_prod_detail_idx','item_prod_order_detail_associations_unique_pair','productUserAssignment_user_idx','product_category_created_by_fkey','product_category_updated_by_fkey','quote_auth_token_pkey','uniq_grand_parent_parent_child','uniq_parent_child_no_grand','unique_character_entity','unique_item_stage','unique_property_entity'
)
DFLOW_BASELINE_CONTRACT = "not exists (select 1 from unnest(array[" + ",".join(
    "'" + value.replace("'", "''") + "'" for value in DFLOW_BASELINE_RELATIONS
) + "]::text[]) as expected(name) where to_regclass(expected.name) is null) and not exists (select 1 from unnest(array[" + ",".join(
    "'" + value.replace("'", "''") + "'" for value in DFLOW_BASELINE_INDEXES
) + "]::text[]) as expected(name) where to_regclass(format('dflow.%I', expected.name)) is null) and to_regprocedure('dflow.get_parent_id(character varying,character varying,integer)') is not null and to_regprocedure('dflow.get_child_id(character varying,character varying,character varying,character varying,character varying,integer)') is not null"
DFLOW_BASELINE_FOREIGN_KEYS = (
('dflow."RolePermissions"','RolePermissions_ElementId_fkey'),('dflow."RolePermissions"','RolePermissions_RoleId_fkey'),('dflow."RolePermissions"','RolePermissions_UserId_fkey'),('dflow."UIElements"','UIElements_ParentId_fkey'),
('dflow.age_group','age_group_created_by_fkey'),('dflow.age_group','age_group_updated_by_fkey'),('dflow.art_piece','art_piece_age_group_id_fkey'),('dflow.art_piece','art_piece_art_source_id_fkey'),('dflow.art_piece','art_piece_art_type_id_fkey'),('dflow.art_piece','art_piece_artist_id_fkey'),
('dflow.art_piece_attachment','art_piece_attachment_art_piece_id_fkey'),('dflow.art_piece_attachment','art_piece_attachment_company_code_fkey'),('dflow.art_piece_attachment','art_piece_attachment_created_by_fkey'),('dflow.art_piece_attachment','art_piece_attachment_divisioncode_id_fkey'),('dflow.art_piece_attachment','art_piece_attachment_updated_by_fkey'),
('dflow.art_piece','art_piece_big_theme_id_fkey'),('dflow.art_piece','art_piece_created_by_fkey'),('dflow.art_piece','art_piece_divisioncode_id_fkey'),('dflow.art_piece','art_piece_licensor_id_fkey'),('dflow.art_piece','art_piece_little_theme_id_fkey'),('dflow.art_piece','art_piece_property_id_fkey'),('dflow.art_piece','art_piece_season_code_id_fkey'),('dflow.art_piece','art_piece_style_guide_id_fkey'),('dflow.art_piece','art_piece_updated_by_fkey'),
('dflow.art_types','art_types_created_by_fkey'),('dflow.art_types','art_types_divisioncode_id_fkey'),('dflow.art_types','art_types_updated_by_fkey'),('dflow.artist_types','artist_types_created_by_fkey'),('dflow.artist_types','artist_types_updated_by_fkey'),('dflow.artists','artists_art_source_id_fkey'),('dflow.artists','artists_artist_type_id_fkey'),('dflow.artists','artists_created_by_fkey'),('dflow.artists','artists_divisioncode_id_fkey'),('dflow.artists','artists_updated_by_fkey'),
('dflow."RFQItem"','fk_rfqItem_copied_from'),('dflow."itemLicenseImage"','itemLicenseImage_itemheader_id_fk_fkey'),('dflow.item_character_associations','item_character_associations_character_id_fkey'),('dflow.item_character_associations','item_character_associations_item_header_id_fkey'),('dflow.item_prod_order_detail_associations','item_prod_order_detail_associations_item_header_id_fkey'),('dflow.item_prod_order_detail_associations','item_prod_order_detail_associations_prod_order_detail_pkey_fkey'),
('dflow."licensingFeedbackReply"','licensingFeedbackReply_licensing_status_id_fk_fkey'),('dflow."licensingStatus"','licensingStatus_tagged_group_id_fkey'),('dflow."merchGroupRelations"','merchGroupRelations_child_mg_id_fkey'),('dflow."merchGroupRelations"','merchGroupRelations_grand_parent_mg_id_fkey'),('dflow."merchGroupRelations"','merchGroupRelations_parent_mg_id_fkey'),('dflow."productUserAssignment"','productUserAssignment_item_id_fk_fkey'),('dflow."productUserAssignment"','productUserAssignment_user_id_fk_fkey'),('dflow.properties_and_characters','properties_and_characters_licensor_id_fkey'),('dflow.property_character_associations','property_character_associations_character_id_fkey'),('dflow.property_character_associations','property_character_associations_licensor_id_fkey'),('dflow.property_character_associations','property_character_associations_property_id_fkey'),
)
DFLOW_BASELINE_CONTRACT += " and not exists (select 1 from (values " + ",".join("('%s','%s')" % row for row in DFLOW_BASELINE_FOREIGN_KEYS) + ") expected(relation,conname) where not exists (select 1 from pg_constraint c where c.conrelid=to_regclass(expected.relation) and c.conname=expected.conname and c.contype='f' and c.convalidated))"
API_RLS_RELATIONS = tuple("""app.profile app.user_role app.app_access app.file_object app.comment app.activity app.notification core.company core.company_source_ref core.contact core.contact_source_ref core.contact_company core.licensor core.property core.character core.taxonomy_source_ref core.product_category core.product_type core.product_subtype core.merch_group core.factory core.factory_source_ref core.vendor_contact core.sku_ref dam.style_group dam.asset dam.asset_character dam.asset_tag dam.asset_path_history dam.asset_checkout dam.agent_registration dam.helper_device dam.processing_queue dam.style_guide_file dam.sku_style_guide_source dam.erp_item_snapshot dam.production_order_snapshot pim.design_collection pim.project pim.design pim.product pim.stage pim.stage_history pim.product_submission pim.product_sample pim.revision_request pim.customer_order pim.checklist_item pim.product_assignee pim.product_file pim.product_update pim.product_tag pim.product_field pim.product_link pim.product_time_entry pim.saved_view pim.view_pref pim.design_asset pim.product_style_group crm.department crm.opportunity crm.opportunity_product crm.email_message crm.meeting_note crm.note crm.task crm.ignore_rule crm.ai_model_config crm.licensor_approval_thread plm.item plm.item_detail plm.item_attachment plm.art_piece plm.production_order plm.production_order_line plm.licensing_status plm.licensing_feedback plm.rfq_group plm.rfq_item plm.rfq_vendor plm.reference_value ingest.sync_run ingest.raw_record ingest.dedupe_candidate""".split())
API_POLICY_GROUPS = (
    (tuple("""app.file_object app.comment app.activity core.company core.contact core.contact_company core.licensor core.property core.character core.product_category core.product_type core.product_subtype core.merch_group core.factory core.vendor_contact core.sku_ref""".split()), (("shared_read", "SELECT"), ("admin_write", "ALL"))),
    (tuple("""pim.design_collection pim.project pim.design pim.product pim.stage pim.stage_history pim.product_submission pim.product_sample pim.revision_request pim.customer_order pim.checklist_item pim.product_assignee pim.product_file pim.product_update pim.product_tag pim.product_field pim.product_link pim.product_time_entry pim.saved_view pim.view_pref pim.design_asset pim.product_style_group""".split()), (("pm_read", "SELECT"), ("pm_write", "ALL"))),
    (tuple("""crm.department crm.opportunity crm.opportunity_product crm.email_message crm.meeting_note crm.note crm.task crm.ignore_rule crm.ai_model_config crm.licensor_approval_thread""".split()), (("crm_read", "SELECT"), ("crm_write", "ALL"))),
    (tuple("""dam.style_group dam.asset dam.asset_character dam.asset_tag dam.asset_path_history dam.style_guide_file dam.sku_style_guide_source""".split()), (("dam_read", "SELECT"), ("dam_write", "ALL"))),
    (tuple("""dam.asset_checkout dam.agent_registration dam.helper_device dam.processing_queue dam.erp_item_snapshot dam.production_order_snapshot app.user_role app.app_access core.company_source_ref core.contact_source_ref core.taxonomy_source_ref core.factory_source_ref ingest.sync_run ingest.raw_record ingest.dedupe_candidate""".split()), (("admin_only", "ALL"),)),
    (tuple("""plm.item plm.item_detail plm.item_attachment plm.art_piece plm.production_order plm.production_order_line plm.licensing_status plm.licensing_feedback plm.rfq_group plm.rfq_item plm.rfq_vendor plm.reference_value""".split()), (("plm_read", "SELECT"), ("plm_admin_write", "ALL"))),
)
API_EXPLICIT_POLICIES = (("app.profile","profile_select_self_or_admin","SELECT"),("app.profile","profile_admin_write","ALL"),("app.notification","notification_select_own","SELECT"),("app.notification","notification_update_own_read_state","UPDATE"))
API_POLICY_EXPRESSIONS = {
    "shared_read": ("app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[])", None),
    "admin_write": ("app.has_role('administrator')", "app.has_role('administrator')"),
    "pm_read": ("app.has_app_access('pm') or app.has_role('administrator')", None),
    "pm_write": ("app.has_role('administrator') or app.has_any_role(array['licensing','designer','sales']::app.app_role[])", "app.has_role('administrator') or app.has_any_role(array['licensing','designer','sales']::app.app_role[])"),
    "crm_read": ("app.has_app_access('crm') or app.has_role('administrator')", None),
    "crm_write": ("app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[])", "app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[])"),
    "dam_read": ("app.has_app_access('dam') or app.has_role('administrator')", None),
    "dam_write": ("app.has_role('administrator') or app.has_any_role(array['designer','licensing']::app.app_role[])", "app.has_role('administrator') or app.has_any_role(array['designer','licensing']::app.app_role[])"),
    "admin_only": ("app.has_role('administrator')", "app.has_role('administrator')"),
    "plm_read": ("app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[])", None),
    "plm_admin_write": ("app.has_role('administrator')", "app.has_role('administrator')"),
    "profile_select_self_or_admin": ("id = app.current_profile_id() or app.has_role('administrator')", None),
    "profile_admin_write": ("app.has_role('administrator')", "app.has_role('administrator')"),
    "notification_select_own": ("profile_id = app.current_profile_id() or app.has_role('administrator')", None),
    "notification_update_own_read_state": ("profile_id = app.current_profile_id() or app.has_role('administrator')", "profile_id = app.current_profile_id() or app.has_role('administrator')"),
}
API_REALTIME_RELATIONS = tuple("""app.comment app.notification app.activity pim.product pim.stage_history pim.product_submission pim.product_sample pim.revision_request pim.customer_order pim.product_assignee crm.opportunity crm.task crm.note crm.email_message dam.asset dam.style_group""".split())
def _quoted(values: tuple[str, ...]) -> str:
    return ",".join("'" + value.replace("'", "''") + "'" for value in values)
def _policy_group_contract(tables: tuple[str, ...], policies: tuple[tuple[str,str], ...]) -> str:
    def norm(value: str | None) -> str:
        without_casts=re.sub(r"::[a-z0-9_.\[\]]+", "", (value or "").lower())
        return re.sub(r"[\s()]", "", without_casts).replace("'", "''")
    expected=",".join("('%s','%s','%s','%s')" % (name,cmd,norm(API_POLICY_EXPRESSIONS[name][0]),norm(API_POLICY_EXPRESSIONS[name][1])) for name,cmd in policies)
    normalize="regexp_replace(regexp_replace(lower(coalesce(%s,'')),'::[a-z0-9_.\\[\\]]+','','g'),'[[:space:]()]','','g')"
    exact_count="not exists (select 1 from unnest(array[%s]::text[]) expected_table(name) where (select count(*) from pg_policies p where p.schemaname=split_part(expected_table.name,'.',1) and p.tablename=split_part(expected_table.name,'.',2)) <> %d)" % (_quoted(tables),len(policies))
    expected_rows="not exists (select 1 from unnest(array[%s]::text[]) expected_table(name) cross join (values %s) expected_policy(policyname,cmd,qual,with_check) where not exists (select 1 from pg_policies p where p.schemaname=split_part(expected_table.name,'.',1) and p.tablename=split_part(expected_table.name,'.',2) and p.policyname=expected_policy.policyname and upper(p.cmd)=expected_policy.cmd and p.roles=array['authenticated']::name[] and %s=expected_policy.qual and %s=expected_policy.with_check))" % (_quoted(tables),expected,normalize % 'p.qual',normalize % 'p.with_check')
    return f"({exact_count} and {expected_rows})"
def _explicit_policy_contract() -> str:
    def norm(value: str | None) -> str:
        without_casts=re.sub(r"::[a-z0-9_.\[\]]+", "", (value or "").lower())
        return re.sub(r"[\s()]", "", without_casts).replace("'", "''")
    rows=",".join("('%s','%s','%s','%s','%s')" % (relation,name,cmd,norm(API_POLICY_EXPRESSIONS[name][0]),norm(API_POLICY_EXPRESSIONS[name][1])) for relation,name,cmd in API_EXPLICIT_POLICIES)
    normalize="regexp_replace(regexp_replace(lower(coalesce(%s,'')),'::[a-z0-9_.\\[\\]]+','','g'),'[[:space:]()]','','g')"
    exact_counts="(select count(*) from pg_policies where schemaname='app' and tablename='profile')=2 and (select count(*) from pg_policies where schemaname='app' and tablename='notification')=2"
    expected_rows="not exists (select 1 from (values %s) expected(relation,policyname,cmd,qual,with_check) where not exists (select 1 from pg_policies p where p.schemaname=split_part(expected.relation,'.',1) and p.tablename=split_part(expected.relation,'.',2) and p.policyname=expected.policyname and upper(p.cmd)=expected.cmd and p.roles=array['authenticated']::name[] and %s=expected.qual and %s=expected.with_check))" % (rows,normalize % 'p.qual',normalize % 'p.with_check')
    return f"({exact_counts} and {expected_rows})"
API_RLS_REALTIME_CONTRACT = " and ".join([
    "not exists (select 1 from unnest(array[%s]::text[]) expected(name) left join pg_class c on c.oid=to_regclass(expected.name) where c.oid is null or not c.relrowsecurity)" % _quoted(API_RLS_RELATIONS),
    *(_policy_group_contract(tables, policies) for tables, policies in API_POLICY_GROUPS),
    _explicit_policy_contract(),
    "exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (select 1 from unnest(array[%s]::text[]) expected(name) where not exists (select 1 from pg_publication_tables p where p.pubname='supabase_realtime' and p.schemaname=split_part(expected.name,'.',1) and p.tablename=split_part(expected.name,'.',2)))" % _quoted(API_REALTIME_RELATIONS),
])
DFLOW_SEQUENCE_TARGETS = (
    ('dflow."AuditLog_id_seq"','dflow."AuditLog"','id',1000000,610745),('dflow."Factory_id_seq"','dflow."Factory"','id',1000,201),
    ('dflow."MerchGroup_mg_id_seq"','dflow."merchGroup"','mg_id',10000,4867),('dflow."ProdOrderHeader_id_seq"','dflow."ProdOrderHeader"','id',100000,15298),
    ('dflow."RFQContainer_RFQContainer_id_seq"','dflow."RFQContainer"','RFQContainer_id',100,26),('dflow."RFQGroup_RFQGroup_id_seq"','dflow."RFQGroup"','RFQGroup_id',1000,424),
    ('dflow."RFQItem_rfqItem_id_seq"','dflow."RFQItem"','rfqItem_id',100000,18128),('dflow."RFQVendor_RFQVendor_id_seq"','dflow."RFQVendor"','RFQVendor_id',100000,36912),
    ('dflow."StandardizedGroup_id_seq"','dflow."StandardizedGroup"','id',1000,94),('dflow."StandardizedSize_id_seq"','dflow."StandardizedSize"','id',1000,644),
    ('dflow.customers_customers_id_seq','dflow.customers','customers_id',1000,57),('dflow."externalCustomer_id_seq"','dflow."externalCustomer"','id',30000000,19142539),
    ('dflow."externalVendor_id_seq"','dflow."externalVendor"','id',20000000,12258025),('dflow."licensingStatus_id_seq"','dflow."licensingStatus"','id',100000,16468),
    ('dflow.user_notification_id_seq','dflow.user_notification','id',1000000,108207),('dflow.users_id_seq','dflow.users','id',1000,72),
    ('dflow.vendor_vendor_id_seq','dflow.vendor','vendor_id',1000,299),('dflow."itemHeader_item_num_id_pk _seq"','dflow."itemHeader"','item_id_pk',100000,19877),
)
def _sequence_contract(row: tuple[str,str,str,int,int]) -> str:
    sequence, table, column, floor, external = row
    def scalar(query: str, alias: str) -> str:
        quoted=query.replace("'", "''")
        return "((xpath('/table/row/%s/text()',query_to_xml('%s',false,true,'')))[1]::text::bigint)" % (alias,quoted)
    next_value=scalar("select case when is_called then last_value + 1 else last_value end as next_value from %s" % sequence,"next_value")
    max_value=scalar('select coalesce(max("%s"),0) as max_id from %s' % (column.replace('"','""'),table),"max_id")
    threshold=max(floor,external)
    return "case when to_regclass('%s') is null then true when to_regclass('%s') is null then %s > %d else %s > greatest(%d,%s) end" % (sequence,table,next_value,threshold,next_value,threshold,max_value)
DFLOW_SEQUENCE_CEILINGS_CONTRACT = " and ".join(_sequence_contract(row) for row in DFLOW_SEQUENCE_TARGETS)
def _shape_contract(*, relations=(), indexes=(), constraints=(), routines=(), policies=(), triggers=()) -> str:
    checks=[]
    checks += ["to_regclass('%s') is not null" % value for value in relations]
    checks += ["to_regclass('%s') is not null" % value for value in indexes]
    checks += ["exists (select 1 from pg_constraint where conrelid=to_regclass('%s') and conname='%s' and convalidated)" % value for value in constraints]
    checks += [("to_regprocedure('%s') is not null" % value if '(' in value else "(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='%s' and p.proname='%s')=1" % tuple(value.split('.',1))) for value in routines]
    policy_tables=sorted(set(table for table,_ in policies))
    checks += ["(select relrowsecurity from pg_class where oid=to_regclass('%s'))" % table for table in policy_tables]
    checks += ["exists (select 1 from pg_policies where schemaname='%s' and tablename='%s' and policyname='%s')" % (*table.split('.',1),name) for table,name in policies]
    checks += ["(select count(*) from pg_policies where schemaname='%s' and tablename='%s')=%d" % (*table.split('.',1),sum(1 for owner,_ in policies if owner==table)) for table in policy_tables]
    checks += ["exists (select 1 from pg_trigger where tgrelid=to_regclass('%s') and tgname='%s' and not tgisinternal and tgenabled<>'D')" % row for row in triggers]
    return " and ".join(checks)
STYLE_TRACKER_TABLES_CONTRACT = _shape_contract(
    relations=('public.style_tracker_rows','plm.style_tracker_value_resolution','plm.style_tracker_item_bridge','public.style_tracker_audit_log','public.style_tracker_user_views','public.style_tracker_audit_log_with_user','public.style_tracker_rows_with_bridge'),
    indexes=tuple('public.'+name for name in ('idx_style_tracker_audit_log_changed_at','idx_style_tracker_audit_log_row','idx_style_tracker_audit_log_sheet','idx_style_tracker_rows_group_id','idx_style_tracker_rows_row_data_gin','idx_style_tracker_rows_sku','idx_style_tracker_rows_source_sheet'))+tuple('plm.'+name for name in ('idx_style_tracker_item_bridge_company','idx_style_tracker_item_bridge_creative_designer','idx_style_tracker_item_bridge_erp_item','idx_style_tracker_item_bridge_match_status','idx_style_tracker_item_bridge_row','idx_style_tracker_item_bridge_sku','idx_style_tracker_item_bridge_style_group','idx_style_tracker_value_resolution_field_value')),
    constraints=tuple((('public.style_tracker_audit_log' if name.startswith('style_tracker_audit_log_') else 'plm.style_tracker_item_bridge' if name.startswith('style_tracker_item_bridge_') else 'public.style_tracker_rows' if name.startswith('style_tracker_rows_') else 'public.style_tracker_user_views' if name.startswith('style_tracker_user_views_') else 'plm.style_tracker_value_resolution'),name) for name in """style_tracker_audit_log_pkey style_tracker_audit_log_style_tracker_row_id_fkey style_tracker_item_bridge_company_id_fkey style_tracker_item_bridge_core_licensor_id_fkey style_tracker_item_bridge_creative_designer_id_fkey style_tracker_item_bridge_erp_item_id_fkey style_tracker_item_bridge_factory_id_fkey style_tracker_item_bridge_pkey style_tracker_item_bridge_plm_item_id_fkey style_tracker_item_bridge_public_licensor_id_fkey style_tracker_item_bridge_row_unique style_tracker_item_bridge_style_group_id_fkey style_tracker_item_bridge_style_tracker_row_id_fkey style_tracker_item_bridge_updated_by_fkey style_tracker_rows_pkey style_tracker_rows_source_row_unique style_tracker_rows_updated_by_fkey style_tracker_user_views_pkey style_tracker_user_views_unique style_tracker_user_views_user_id_fkey style_tracker_value_resolution_pkey style_tracker_value_resolution_unique style_tracker_value_resolution_updated_by_fkey""".split()),
    policies=(('plm.style_tracker_item_bridge','Authenticated users insert style tracker bridge'),('plm.style_tracker_value_resolution','Authenticated users insert style tracker value resolutions'),('plm.style_tracker_item_bridge','Authenticated users read style tracker bridge'),('plm.style_tracker_value_resolution','Authenticated users read style tracker value resolutions'),('plm.style_tracker_item_bridge','Authenticated users update style tracker bridge'),('plm.style_tracker_value_resolution','Authenticated users update style tracker value resolutions'),('public.style_tracker_rows','Admins delete style tracker rows'),('public.style_tracker_rows','Authenticated users insert style tracker rows'),('public.style_tracker_rows','Authenticated users read style tracker rows'),('public.style_tracker_rows','Authenticated users update style tracker rows'),('public.style_tracker_user_views','Users insert their own style tracker views'),('public.style_tracker_user_views','Users read their own style tracker views'),('public.style_tracker_user_views','Users update their own style tracker views'),('public.style_tracker_audit_log','style tracker audit readable by authenticated users')),
)
STYLE_TRACKER_COLUMNS = {
    'public.style_tracker_rows': 'id source_workbook_id source_sheet source_row_number tracker_type sku group_id description customer designer commissioned upc customer_sku licensor license_status royalty concept_status pre_production_status production_status default_vendor discontinued notes row_data imported_at created_at updated_at updated_by'.split(),
    'plm.style_tracker_value_resolution': 'id field_key raw_value normalized_value resolution_type target_schema target_table target_id target_label local_value confidence notes created_at updated_at updated_by'.split(),
    'plm.style_tracker_item_bridge': 'id style_tracker_row_id bridge_source source_workbook_id source_sheet source_row_number tracker_type sku description customer_name designer_name commissioned upc customer_sku licensor_name license_status royalty concept_status pre_production_status production_status default_vendor_name discontinued notes erp_item_id style_group_id company_id public_licensor_id core_licensor_id factory_id plm_item_id match_status match_confidence match_notes raw_row_data last_matched_at created_at updated_at updated_by creative_designer_id'.split(),
    'public.style_tracker_audit_log': 'id event_type style_tracker_row_id source_sheet source_row_number field_key column_letter old_value new_value metadata changed_by changed_at'.split(),
    'public.style_tracker_user_views': 'id user_id source_sheet view_name column_state filter_model created_at updated_at'.split(),
}
STYLE_TRACKER_UUID_COLUMNS={
    'public.style_tracker_rows': 'id updated_by'.split(),
    'plm.style_tracker_value_resolution': 'id target_id updated_by'.split(),
    'plm.style_tracker_item_bridge': 'id style_tracker_row_id erp_item_id style_group_id company_id public_licensor_id core_licensor_id factory_id plm_item_id updated_by creative_designer_id'.split(),
    'public.style_tracker_audit_log': 'id style_tracker_row_id changed_by'.split(),
    'public.style_tracker_user_views': 'id user_id'.split(),
}
STYLE_TRACKER_INTEGER_COLUMNS={'public.style_tracker_rows':['source_row_number'],'plm.style_tracker_item_bridge':['source_row_number'],'public.style_tracker_audit_log':['source_row_number']}
STYLE_TRACKER_BOOLEAN_COLUMNS={'public.style_tracker_rows':['discontinued'],'plm.style_tracker_item_bridge':['discontinued']}
STYLE_TRACKER_JSONB_COLUMNS={'public.style_tracker_rows':['row_data'],'plm.style_tracker_value_resolution':['notes'],'plm.style_tracker_item_bridge':['match_notes','raw_row_data'],'public.style_tracker_audit_log':['old_value','new_value','metadata'],'public.style_tracker_user_views':['column_state','filter_model']}
STYLE_TRACKER_TIMESTAMP_COLUMNS={'public.style_tracker_rows':'imported_at created_at updated_at'.split(),'plm.style_tracker_value_resolution':'created_at updated_at'.split(),'plm.style_tracker_item_bridge':'last_matched_at created_at updated_at'.split(),'public.style_tracker_audit_log':['changed_at'],'public.style_tracker_user_views':'created_at updated_at'.split()}
STYLE_TRACKER_NOT_NULL={
    'public.style_tracker_rows':'id source_workbook_id source_sheet tracker_type row_data imported_at created_at updated_at'.split(),
    'plm.style_tracker_value_resolution':'id field_key raw_value normalized_value resolution_type confidence notes created_at updated_at'.split(),
    'plm.style_tracker_item_bridge':'id style_tracker_row_id bridge_source source_workbook_id source_sheet tracker_type match_status match_confidence match_notes raw_row_data created_at updated_at'.split(),
    'public.style_tracker_audit_log':'id event_type metadata changed_at'.split(),
    'public.style_tracker_user_views':'id user_id source_sheet view_name column_state filter_model created_at updated_at'.split(),
}
STYLE_TRACKER_DEFAULTS={
    'public.style_tracker_rows':{'id':'gen_random_uuid()','source_workbook_id':"'1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'::text",'row_data':"'{}'::jsonb",'imported_at':'now()','created_at':'now()','updated_at':'now()'},
    'plm.style_tracker_value_resolution':{'id':'gen_random_uuid()','confidence':"'verified'::text",'notes':"'{}'::jsonb",'created_at':'now()','updated_at':'now()'},
    'plm.style_tracker_item_bridge':{'id':'gen_random_uuid()','bridge_source':"'google_style_tracker'::text",'match_status':"'unmatched'::text",'match_confidence':"'possible'::text",'match_notes':"'{}'::jsonb",'raw_row_data':"'{}'::jsonb",'created_at':'now()','updated_at':'now()'},
    'public.style_tracker_audit_log':{'id':'gen_random_uuid()','metadata':"'{}'::jsonb",'changed_by':'auth.uid()','changed_at':'now()'},
    'public.style_tracker_user_views':{'id':'gen_random_uuid()','view_name':"'default'::text",'column_state':"'[]'::jsonb",'filter_model':"'{}'::jsonb",'created_at':'now()','updated_at':'now()'},
}
STYLE_TRACKER_INDEXES = (
    ('plm.idx_style_tracker_item_bridge_company','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_company ON plm.style_tracker_item_bridge USING btree (company_id) WHERE (company_id IS NOT NULL)'),
    ('plm.idx_style_tracker_item_bridge_creative_designer','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_creative_designer ON plm.style_tracker_item_bridge USING btree (creative_designer_id) WHERE (creative_designer_id IS NOT NULL)'),
    ('plm.idx_style_tracker_item_bridge_erp_item','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_erp_item ON plm.style_tracker_item_bridge USING btree (erp_item_id) WHERE (erp_item_id IS NOT NULL)'),
    ('plm.idx_style_tracker_item_bridge_match_status','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_match_status ON plm.style_tracker_item_bridge USING btree (match_status)'),
    ('plm.idx_style_tracker_item_bridge_row','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_row ON plm.style_tracker_item_bridge USING btree (style_tracker_row_id)'),
    ('plm.idx_style_tracker_item_bridge_sku','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_sku ON plm.style_tracker_item_bridge USING btree (upper(sku)) WHERE (sku IS NOT NULL)'),
    ('plm.idx_style_tracker_item_bridge_style_group','plm.style_tracker_item_bridge','CREATE INDEX idx_style_tracker_item_bridge_style_group ON plm.style_tracker_item_bridge USING btree (style_group_id) WHERE (style_group_id IS NOT NULL)'),
    ('plm.idx_style_tracker_value_resolution_field_value','plm.style_tracker_value_resolution','CREATE INDEX idx_style_tracker_value_resolution_field_value ON plm.style_tracker_value_resolution USING btree (field_key, normalized_value)'),
    ('public.idx_style_tracker_audit_log_changed_at','public.style_tracker_audit_log','CREATE INDEX idx_style_tracker_audit_log_changed_at ON public.style_tracker_audit_log USING btree (changed_at DESC)'),
    ('public.idx_style_tracker_audit_log_row','public.style_tracker_audit_log','CREATE INDEX idx_style_tracker_audit_log_row ON public.style_tracker_audit_log USING btree (style_tracker_row_id, changed_at DESC) WHERE (style_tracker_row_id IS NOT NULL)'),
    ('public.idx_style_tracker_audit_log_sheet','public.style_tracker_audit_log','CREATE INDEX idx_style_tracker_audit_log_sheet ON public.style_tracker_audit_log USING btree (source_sheet, changed_at DESC)'),
    ('public.idx_style_tracker_rows_group_id','public.style_tracker_rows','CREATE INDEX idx_style_tracker_rows_group_id ON public.style_tracker_rows USING btree (upper(group_id)) WHERE (group_id IS NOT NULL)'),
    ('public.idx_style_tracker_rows_row_data_gin','public.style_tracker_rows','CREATE INDEX idx_style_tracker_rows_row_data_gin ON public.style_tracker_rows USING gin (row_data)'),
    ('public.idx_style_tracker_rows_sku','public.style_tracker_rows','CREATE INDEX idx_style_tracker_rows_sku ON public.style_tracker_rows USING btree (upper(sku)) WHERE (sku IS NOT NULL)'),
    ('public.idx_style_tracker_rows_source_sheet','public.style_tracker_rows','CREATE INDEX idx_style_tracker_rows_source_sheet ON public.style_tracker_rows USING btree (source_sheet, source_row_number)'),
)
STYLE_TRACKER_POLICIES = (
    ('plm.style_tracker_item_bridge','Authenticated users insert style tracker bridge','INSERT',None,'true'),('plm.style_tracker_value_resolution','Authenticated users insert style tracker value resolutions','INSERT',None,'true'),
    ('plm.style_tracker_item_bridge','Authenticated users read style tracker bridge','SELECT','true',None),('plm.style_tracker_value_resolution','Authenticated users read style tracker value resolutions','SELECT','true',None),
    ('plm.style_tracker_item_bridge','Authenticated users update style tracker bridge','UPDATE','true','true'),('plm.style_tracker_value_resolution','Authenticated users update style tracker value resolutions','UPDATE','true','true'),
    ('public.style_tracker_rows','Admins delete style tracker rows','DELETE',"has_role(auth.uid(), 'admin'::app_role)",None),('public.style_tracker_rows','Authenticated users insert style tracker rows','INSERT',None,'true'),
    ('public.style_tracker_rows','Authenticated users read style tracker rows','SELECT','true',None),('public.style_tracker_rows','Authenticated users update style tracker rows','UPDATE','true','true'),
    ('public.style_tracker_user_views','Users insert their own style tracker views','INSERT',None,'user_id = auth.uid()'),('public.style_tracker_user_views','Users read their own style tracker views','SELECT','user_id = auth.uid()',None),
    ('public.style_tracker_user_views','Users update their own style tracker views','UPDATE','user_id = auth.uid()','user_id = auth.uid()'),('public.style_tracker_audit_log','style tracker audit readable by authenticated users','SELECT','true',None),
)
STYLE_TRACKER_CHECKS=(
    ('public.style_tracker_rows','style_tracker_rows_tracker_type_check',"CHECK ((tracker_type = ANY (ARRAY['licensed'::text, 'generic'::text, 'vendor'::text, 'project'::text, 'order'::text, 'other'::text])))"),
    ('plm.style_tracker_value_resolution','style_tracker_value_resolution_confidence_check',"CHECK ((confidence = ANY (ARRAY['verified'::text, 'probable'::text, 'possible'::text, 'conflict'::text])))"),
    ('plm.style_tracker_value_resolution','style_tracker_value_resolution_field_key_check',"CHECK ((field_key = ANY (ARRAY['sku'::text, 'customer'::text, 'licensor'::text, 'designer'::text, 'factory'::text])))"),
    ('plm.style_tracker_value_resolution','style_tracker_value_resolution_resolution_type_check',"CHECK ((resolution_type = ANY (ARRAY['canonical'::text, 'master_data'::text])))"),
    ('plm.style_tracker_value_resolution','style_tracker_value_resolution_target_check',"CHECK ((((resolution_type = 'canonical'::text) AND (target_schema IS NOT NULL) AND (target_table IS NOT NULL) AND (target_id IS NOT NULL) AND (target_label IS NOT NULL) AND (local_value IS NULL)) OR ((resolution_type = 'master_data'::text) AND (local_value IS NOT NULL) AND (target_schema IS NULL) AND (target_table IS NULL) AND (target_id IS NULL))))"),
    ('plm.style_tracker_item_bridge','style_tracker_item_bridge_match_confidence_check',"CHECK ((match_confidence = ANY (ARRAY['verified'::text, 'probable'::text, 'possible'::text, 'conflict'::text])))"),
    ('plm.style_tracker_item_bridge','style_tracker_item_bridge_match_status_check',"CHECK ((match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'partial'::text, 'needs_review'::text])))"),
    ('plm.style_tracker_item_bridge','style_tracker_item_bridge_tracker_type_check',"CHECK ((tracker_type = ANY (ARRAY['licensed'::text, 'generic'::text, 'vendor'::text, 'project'::text, 'order'::text, 'other'::text])))"),
    ('public.style_tracker_audit_log','style_tracker_audit_log_event_type_check',"CHECK ((event_type = ANY (ARRAY['row_added'::text, 'cell_update'::text, 'value_resolution'::text])))"),
    ('public.style_tracker_user_views','style_tracker_user_views_source_sheet_check',"CHECK ((source_sheet = ANY (ARRAY['License.Style'::text, 'Generic.Style'::text])))"),
)
# The one normalizer for comparing a catalog-reconstructed definition against a
# hand-authored expected definition. `pg_get_indexdef` and `pg_get_constraintdef`
# REBUILD their output from the catalog rather than echoing what was typed, so
# spacing, identifier quoting, and clause rendering are the server's choices. A
# byte-exact literal comparison is a guess at another program's formatter, and a
# guess that is wrong produces a contract that can never pass -- which surfaces at
# production promotion, the single-lane gated step, rather than in review.
# Every such comparison must use THIS constant, not a fresh equivalent, so there is
# one place to be wrong instead of several.
#
# LIMIT OF THIS NORMALIZER, and it is a real trap for the next contract added here.
# Lowercasing and stripping ALL whitespace is safe only while the compared definition
# carries no case-sensitive or space-sensitive string literal. A partial index
# (`where status = 'in progress'`) or an expression index over a literal would have
# that literal folded too, so `'in progress'`, `'InProgress'` and `'inprogress'` all
# collapse to the same text and the contract stops being able to tell them apart --
# a check that cannot return dirty. Every contract that exists today pins
# `indpred is null and indexprs is null`, which excludes literals entirely and is why
# this is currently unreachable. If you add a contract for a partial or expression
# index, do NOT reuse this constant unexamined: narrow the normalization instead.
INDEXDEF_NORMALIZE = "regexp_replace(lower(replace(%s,'\"','')),'[[:space:]]+','','g')"


def _style_tracker_exact_contract() -> str:
    checks=[]
    def expected_norm(value: str | None) -> str:
        without_casts=re.sub(r"::[a-z0-9_.\[\]]+", "", (value or "").lower())
        return re.sub(r"[\s()]", "", without_casts).replace("'", "''")
    for relation, columns in STYLE_TRACKER_COLUMNS.items():
        schema, table=relation.split('.',1); expected=_quoted(columns)
        checks.append("(select count(*) from information_schema.columns where table_schema='%s' and table_name='%s')=%d" % (schema,table,len(columns)))
        def kind(name: str) -> str:
            if name in STYLE_TRACKER_UUID_COLUMNS.get(relation,[]): return 'uuid'
            if name in STYLE_TRACKER_INTEGER_COLUMNS.get(relation,[]): return 'integer'
            if name in STYLE_TRACKER_BOOLEAN_COLUMNS.get(relation,[]): return 'boolean'
            if name in STYLE_TRACKER_JSONB_COLUMNS.get(relation,[]): return 'jsonb'
            if name in STYLE_TRACKER_TIMESTAMP_COLUMNS.get(relation,[]): return 'timestamp with time zone'
            return 'text'
        rows=','.join("('%s','%s','%s','%s')" % (name,kind(name),'NO' if name in STYLE_TRACKER_NOT_NULL[relation] else 'YES',STYLE_TRACKER_DEFAULTS.get(relation,{}).get(name,'').replace("'","''")) for name in columns)
        checks.append("not exists (select 1 from (values %s) expected(name,data_type,is_nullable,column_default) where not exists (select 1 from information_schema.columns c where c.table_schema='%s' and c.table_name='%s' and c.column_name=expected.name and c.data_type=expected.data_type and c.is_nullable=expected.is_nullable and coalesce(c.column_default,'')=expected.column_default))" % (rows,schema,table))
    normalize=INDEXDEF_NORMALIZE
    for index, owner, definition in STYLE_TRACKER_INDEXES:
        checks.append("(select i.indrelid=to_regclass('%s') and %s=%s from pg_index i where i.indexrelid=to_regclass('%s'))" % (owner,normalize % "pg_get_indexdef(i.indexrelid)",normalize % ("'%s'" % definition.replace("'","''")),index))
    for owner,name,definition in STYLE_TRACKER_CHECKS:
        checks.append("exists (select 1 from pg_constraint c where c.conrelid=to_regclass('%s') and c.conname='%s' and c.contype='c' and c.convalidated and %s=%s)" % (owner,name,normalize % 'pg_get_constraintdef(c.oid)',normalize % ("'%s'" % definition.replace("'","''"))))
    policy_norm="regexp_replace(regexp_replace(lower(coalesce(%s,'')),'::[a-z0-9_.\\[\\]]+','','g'),'[[:space:]()]','','g')"
    for relation,name,command,qual,with_check in STYLE_TRACKER_POLICIES:
        schema,table=relation.split('.',1)
        checks.append("exists (select 1 from pg_policies p where p.schemaname='%s' and p.tablename='%s' and p.policyname='%s' and upper(p.cmd)='%s' and p.roles=array['authenticated']::name[] and %s='%s' and %s='%s')" % (schema,table,name.replace("'","''"),command,policy_norm % 'p.qual',expected_norm(qual),policy_norm % 'p.with_check',expected_norm(with_check)))
    return ' and '.join(checks)
STYLE_TRACKER_TABLES_CONTRACT += ' and ' + _style_tracker_exact_contract()
STYLE_TRACKER_FUNCTIONS_CONTRACT = _shape_contract(routines=(
    'plm.apply_style_tracker_designer_resolutions()','plm.normalize_style_tracker_value(text,text)','plm.refresh_style_tracker_item_bridge()',
    'plm.set_style_tracker_bridge_audit_fields()','plm.set_style_tracker_value_resolution_audit_fields()',
    'public.add_style_tracker_rows(text,text,integer)','public.log_style_tracker_row_audit()','public.refresh_style_tracker_item_bridge()',
    'public.rls_auto_enable()','public.search_style_tracker_link_candidates(text,text,integer,text)',
    'public.set_style_tracker_row_audit_fields()','public.upsert_style_tracker_value_resolution(text,text,text,text,text,uuid,text,text)',
)) + " and md5((select prosrc from pg_proc where oid=to_regprocedure('public.rls_auto_enable()')))='99be20677b456ea8d3be47bdd44fb369'"
AI_TAG_BAKEOFF_CONTRACT = _shape_contract(
    relations=tuple("public."+value for value in "ai_tag_bakeoff_results ai_tag_bakeoff_reviews ai_tag_bakeoff_runs".split()),
    indexes=tuple("public."+value for value in "idx_ai_tag_bakeoff_results_run_asset idx_ai_tag_bakeoff_results_status idx_ai_tag_bakeoff_reviews_run".split()),
    constraints=tuple((('public.ai_tag_bakeoff_results' if name.startswith('ai_tag_bakeoff_results_') else 'public.ai_tag_bakeoff_reviews' if name.startswith('ai_tag_bakeoff_reviews_') else 'public.ai_tag_bakeoff_runs'),name) for name in """ai_tag_bakeoff_results_asset_id_fkey ai_tag_bakeoff_results_pkey ai_tag_bakeoff_results_property_id_fkey ai_tag_bakeoff_results_run_id_asset_id_model_slot_key ai_tag_bakeoff_results_run_id_fkey ai_tag_bakeoff_reviews_asset_id_fkey ai_tag_bakeoff_reviews_pkey ai_tag_bakeoff_reviews_reviewed_by_fkey ai_tag_bakeoff_reviews_run_id_asset_id_field_key ai_tag_bakeoff_reviews_run_id_fkey ai_tag_bakeoff_runs_created_by_fkey ai_tag_bakeoff_runs_pkey""".split()),
    policies=tuple((table,policy) for table in ('public.ai_tag_bakeoff_results','public.ai_tag_bakeoff_reviews','public.ai_tag_bakeoff_runs') for policy in (f"Admin manage {table.split('.')[-1].replace('_',' ')}",f"Admin read {table.split('.')[-1].replace('_',' ')}")),
)
DB_DATA_ADMIN_FORWARD_CONTRACT = _shape_contract(relations=('app.db_data_admin_feature_gate',),routines=tuple("""api.db_data_admin_audit_list api.db_data_admin_licensor_property_tree api.db_data_admin_merge_customer api.db_data_admin_merge_vendor api.db_data_admin_preview_customer_merge api.db_data_admin_preview_vendor_merge api.db_data_admin_update_customer api.db_data_admin_update_vendor app.db_data_admin_customer_row app.db_data_admin_extension_conflicts app.db_data_admin_merge_execute app.db_data_admin_merge_fk_counts app.db_data_admin_merge_preview app.db_data_admin_reconcile_extension app.db_data_admin_single_record_writes_enabled app.db_data_admin_vendor_row""".split()),triggers=(('app.db_data_admin_feature_gate','set_updated_at'),))
DCP_OPA_PROPERTY_AUTHORITY_CONTRACT = _shape_contract(
    relations=('plm.dcp_opa_property_resolution','plm.dcp_opa_property_resolution_member'),
    routines=('api.db_data_admin_scraped_properties(text,text,integer)','plm.reject_dcp_opa_resolution_mutation()'),
    policies=(('plm.dcp_opa_property_resolution','dcp_opa_property_resolution_read'),('plm.dcp_opa_property_resolution_member','dcp_opa_property_resolution_member_read')),
    triggers=(('plm.dcp_opa_property_resolution','dcp_opa_property_resolution_append_only'),('plm.dcp_opa_property_resolution_member','dcp_opa_property_resolution_member_append_only'),('plm.dcp_opa_property_resolution','dcp_opa_property_resolution_no_truncate'),('plm.dcp_opa_property_resolution_member','dcp_opa_property_resolution_member_no_truncate')),
)
# The dynamic `execute v_definition;` REWRITES THE BODY of a routine that already
# exists, so an existence-only contract would still pass if that execute became a
# no-op. These predicates witness the rewrite itself: the OPA-authority body must
# be installed and the superseded licensor-resolution join must be gone. Ownership
# barriers are asserted too, because a REVOKE alone does not bind the table owner.
_DCP_OPA_DEF = "pg_get_functiondef(to_regprocedure('api.db_data_admin_scraped_properties(text,text,integer)'))"
DCP_OPA_PROPERTY_AUTHORITY_CONTRACT += (
    " and position('explicit_dcp_to_opa_property_id' in %s)>0" % _DCP_OPA_DEF +
    " and position('style_guide_names' in %s)>0" % _DCP_OPA_DEF +
    " and position('contract_opa_conflict' in %s)>0" % _DCP_OPA_DEF +
    " and position('plm.dcp_property_licensor_resolution' in %s)=0" % _DCP_OPA_DEF +
    "".join(
        " and (select relforcerowsecurity from pg_class where oid=to_regclass('%s'))" % table
        for table in ('plm.dcp_opa_property_resolution','plm.dcp_opa_property_resolution_member')
    ) +
    "".join(
        " and exists (select 1 from pg_trigger where tgrelid=to_regclass('%s') and tgname='%s' and not tgisinternal and tgenabled='A')" % row
        for row in (
            ('plm.dcp_opa_property_resolution','dcp_opa_property_resolution_append_only'),
            ('plm.dcp_opa_property_resolution_member','dcp_opa_property_resolution_member_append_only'),
            ('plm.dcp_opa_property_resolution','dcp_opa_property_resolution_no_truncate'),
            ('plm.dcp_opa_property_resolution_member','dcp_opa_property_resolution_member_no_truncate'),
        )
    )
)
SCRAPED_PROPERTIES_SOURCE_PURPOSE_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
)
_SCRAPED_PROPERTIES_DEF = "pg_get_functiondef(to_regprocedure('api.db_data_admin_scraped_properties(text,text,integer)'))"
SCRAPED_PROPERTIES_SOURCE_PURPOSE_CONTRACT += (
    " and position('plm.wildbrain_era' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('plm.wildbrain_capture' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('plm.sega_submission_property' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('plm.sega_submission_capture' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('Strawberry Shortcake - Creative' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('Sega - Submissions' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('Sega - Creative' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('Marvel - Creative (ASGARD)' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('DCP Vault - Creative (authoritative Marvel scope)' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('plm.sega_property_licensor' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('normalized_licensor_label' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('Marvel - Creative (DCP Vault)' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('Source Property vocabulary' in %s)=0" % _SCRAPED_PROPERTIES_DEF
)
CREATIVE_SUBMISSION_CONTRACT_STATUS_CONTRACT = _shape_contract(
    relations=('plm.creative_submission_contract_resolution',),
    routines=(
        'api.db_data_admin_scraped_properties(text,text,integer)',
        'plm.enforce_creative_submission_contract_resolution()',
    ),
    triggers=(
        ('plm.creative_submission_contract_resolution','creative_submission_contract_resolution_immutable'),
        ('plm.creative_submission_contract_resolution','creative_submission_contract_resolution_no_truncate'),
        ('plm.creative_submission_contract_resolution','creative_submission_contract_resolution_identity_check'),
    ),
)
CREATIVE_SUBMISSION_CONTRACT_STATUS_CONTRACT += (
    " and position('creative_submission_property_resolution' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('creative_submission_contract_resolution' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('submission_source.source_property_name' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('mapping_state' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('submissions' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('contract_status' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('document_sha256' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_schedule_locator' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('exact_property_text' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('evidence_identity' in %s)=0" % _SCRAPED_PROPERTIES_DEF
)
SCRAPED_PROPERTIES_BOUNDED_ENRICHMENT_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
)
SCRAPED_PROPERTIES_BOUNDED_ENRICHMENT_CONTRACT += (
    " and position('ordered as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('enriched as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('from ordered o' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('from enriched e' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position(E'from source_rows s\\n    left join lateral' in %s)=0" % _SCRAPED_PROPERTIES_DEF
)
SCRAPED_PROPERTIES_SET_BASED_AUTHORITY_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
)
SCRAPED_PROPERTIES_SET_BASED_AUTHORITY_CONTRACT += (
    " and position('opa_scope_latest as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('opa_scope_summary as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('opa_studio_summary as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('dcp_current_resolution as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('dcp_scope_latest as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('dcp_scope_summary as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('where current_r.source_system = p.source_system' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('where r.licensed_property_id = p.licensed_property_id' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('ordered as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('enriched as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF
)
SCRAPED_PROPERTIES_BOUNDED_SOURCE_CONTEXT_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
)
SCRAPED_PROPERTIES_BOUNDED_SOURCE_CONTEXT_CONTRACT += (
    " and position('source_rows as not materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_dcp_context_rows as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_dcp_context as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('context_asset_count' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('context_style_guide_count' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('context_style_guide_names' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('select count(distinct o.dcp_asset_id)' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('select count(distinct o.lucasfilm_dcp_asset_id)' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('select count(distinct a.style_guide_id)' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('select distinct g.folder_name' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('ordered as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('enriched as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF
)
SCRAPED_PROPERTIES_SET_BASED_RETAINED_CONTEXT_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
    indexes=(
        'plm.idx_dcp_asset_property_obs_property_asset',
        'plm.idx_lucasfilm_dcp_asset_property_obs_property_asset',
    ),
)
SCRAPED_PROPERTIES_SET_BASED_RETAINED_CONTEXT_CONTRACT += (
    " and position('page_dcp_properties as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_lucasfilm_dcp_properties as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_dcp_retained_assets as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_lucasfilm_dcp_retained_assets as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('dcp_asset_context as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('lucasfilm_dcp_asset_context as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('l.row_key collate \"C\" > v_cursor_key collate \"C\"' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('app.require_licensing_manager_access()' in %s)>0" % _SCRAPED_PROPERTIES_DEF
)
SCRAPED_PROPERTIES_SET_BASED_PAGE_SUBMISSION_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
)
SCRAPED_PROPERTIES_SET_BASED_PAGE_SUBMISSION_CONTRACT += (
    " and position('page_creative_decision as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_submission_identity as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_submission_source as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('left join page_creative_decision creative_decision' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('left join page_submission_source submission_source' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('left join source_rows submission_source' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('l.row_key collate \"C\" > v_cursor_key collate \"C\"' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('source_rows as not materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_dcp_context_rows as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF
)
SCRAPED_PROPERTIES_TARGETED_SUBMISSION_LABEL_CONTRACT = _shape_contract(
    routines=('api.db_data_admin_scraped_properties(text,text,integer)',),
)
SCRAPED_PROPERTIES_TARGETED_SUBMISSION_LABEL_CONTRACT += (
    " and position('page_submission_source_candidates as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('left join page_submission_source_candidates' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('left join source_rows s' in %s)=0" % _SCRAPED_PROPERTIES_DEF +
    " and position('page_submission_identity as materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('l.row_key collate \"C\" > v_cursor_key collate \"C\"' in %s)>0" % _SCRAPED_PROPERTIES_DEF +
    " and position('source_rows as not materialized' in %s)>0" % _SCRAPED_PROPERTIES_DEF
)
POPDAM_FORWARD_RECOVERY_CONTRACT = _shape_contract(
    relations=('public.style_group_tags',),
    indexes=tuple('public.'+value for value in "asset_tags_active_asset_idx dam_search_embedding_claim_idx style_group_tags_active_group_idx".split()),
    constraints=tuple((('public.asset_tags' if name.startswith('asset_tags_') else 'public.dam_search_embeddings'),name) for name in """asset_tags_category_check asset_tags_confidence_check asset_tags_rejection_check asset_tags_source_normalized_check asset_tags_status_check asset_tags_tag_normalized_check dam_search_embedding_attempts_check dam_search_embedding_error_category_check""".split()),
    routines=tuple('public.'+value for value in "claim_dam_search_embedding_documents get_dam_search_embedding_status get_effective_asset_metadata mark_dam_search_embedding_error refresh_dam_search_asset_document refresh_dam_search_documents_batch refresh_dam_search_style_group_document replace_asset_ai_tag_result replace_style_group_ai_profile reset_dam_search_embedding_errors sync_asset_tags_to_array trg_refresh_dam_tag_or_character upsert_dam_search_embedding".split()),
    policies=(('public.style_group_tags','Authenticated read style_group_tags'),('public.style_group_tags','Admin manage style_group_tags')),
    triggers=(('public.asset_tags','asset_tags_sync_assets_tags'),('public.asset_tags','asset_tags_dam_search_refresh'),('public.style_group_tags','style_group_tags_dam_search_refresh'),('public.asset_characters','asset_characters_dam_search_refresh')),
)
CATALOG_CONTRACTS = {
    "api_rls_realtime_v1": API_RLS_REALTIME_CONTRACT,
    "core_person_role_lookups_v1": """
      not exists (
        select 1
        from unnest(array['creative_designer','technical_designer','freelance_designer','artist']::text[]) as expected(table_name)
        left join pg_class c on c.oid=to_regclass(format('core.%I', expected.table_name))
        where c.oid is null or not c.relrowsecurity
          or (select count(*) from pg_policies p where p.schemaname='core' and p.tablename=expected.table_name
              and (p.policyname,p.cmd) in (('shared_read','SELECT'),('admin_write','ALL'),('service_role_write','ALL'))) <> 3
      )
    """,
    "style_tracker_tables_v1": STYLE_TRACKER_TABLES_CONTRACT,
    "style_tracker_functions_v1": STYLE_TRACKER_FUNCTIONS_CONTRACT,
    "ai_tag_bakeoff_v1": AI_TAG_BAKEOFF_CONTRACT,
    "dflow_baseline_v1": DFLOW_BASELINE_CONTRACT,
    "db_data_admin_forward_v1": DB_DATA_ADMIN_FORWARD_CONTRACT,
    "dcp_opa_property_authority_v1": DCP_OPA_PROPERTY_AUTHORITY_CONTRACT,
    "scraped_properties_source_purpose_v1": SCRAPED_PROPERTIES_SOURCE_PURPOSE_CONTRACT,
    "creative_submission_contract_status_v1": CREATIVE_SUBMISSION_CONTRACT_STATUS_CONTRACT,
    "scraped_properties_bounded_enrichment_v1": SCRAPED_PROPERTIES_BOUNDED_ENRICHMENT_CONTRACT,
    "scraped_properties_set_based_authority_v1": SCRAPED_PROPERTIES_SET_BASED_AUTHORITY_CONTRACT,
    "scraped_properties_bounded_source_context_v1": SCRAPED_PROPERTIES_BOUNDED_SOURCE_CONTEXT_CONTRACT,
    "scraped_properties_set_based_retained_context_v1": SCRAPED_PROPERTIES_SET_BASED_RETAINED_CONTEXT_CONTRACT,
    "scraped_properties_set_based_page_submission_v1": SCRAPED_PROPERTIES_SET_BASED_PAGE_SUBMISSION_CONTRACT,
    "scraped_properties_targeted_submission_label_v1": SCRAPED_PROPERTIES_TARGETED_SUBMISSION_LABEL_CONTRACT,
    "dflow_sequence_ceilings_v1": DFLOW_SEQUENCE_CEILINGS_CONTRACT,
    "popdam_forward_recovery_v1": POPDAM_FORWARD_RECOVERY_CONTRACT,
    "popdam_query_expansion_rows_v1": """
      (select p.prorows = 32
        from pg_proc p
        where p.oid = to_regprocedure('public.expand_dam_search_queries(text)'))
    """,
    "coco_owner_ruling_v1": """
      case when to_regclass('core.taxonomy_owner_ruling') is null then true else
        cardinality(xpath('/table/row', query_to_xml(
          'select 1 from core.taxonomy_owner_ruling where entity_schema=''core'' and entity_table=''property'' and entity_id=''5c03fc46-5a02-4da1-bcac-8969e74bbd8f''::uuid and entity_code=''CC'' and entity_name=''COCO'' and ruled_by=''Albert Hazan (owner)'' and ruled_at=''2026-08-06 12:00:00+00''::timestamptz',
          false, true, ''))) = 1 end
    """,
    "core_licensor_code_key_nulls_distinct_v1": """
      (select count(*) = 1
        from pg_constraint c
        join pg_class r on r.oid = c.conrelid
        join pg_namespace n on n.oid = r.relnamespace
        join pg_index i on i.indexrelid = c.conindid
        where n.nspname = 'core'
          and r.relname = 'licensor'
          and c.conname = 'licensor_code_key'
          and c.contype = 'u'
          and c.convalidated
          and c.conkey = array[
            (select a.attnum
              from pg_attribute a
              where a.attrelid = r.oid
                and a.attname = 'code'
                and not a.attisdropped)
          ]::smallint[]
          and not i.indnullsnotdistinct)
    """,
    "popdam_1427_relations_columns_v1": """
      to_regclass('public.style_group_tags') is not null
      and to_regclass('public.dam_search_documents') is not null
      and (select count(*) = 4 from information_schema.columns
        where table_schema='public' and table_name='asset_tags'
          and column_name in ('category','status','evidence','updated_at')
          and is_nullable='NO')
      and (select count(*) = 5 from information_schema.columns
        where table_schema='public' and table_name='style_groups'
          and column_name in ('group_ai_description','group_ai_description_source',
            'group_ai_description_model','group_ai_tagged_at','group_ai_evidence_asset_ids'))
      and (select count(*) = 7 from information_schema.columns
        where table_schema='public' and table_name='dam_search_documents'
          and column_name in ('embedding_lease_token','embedding_lease_owner','embedding_lease_expires_at',
            'embedding_attempts','embedding_max_attempts','embedding_error_category','embedding_next_retry_at'))
      and (select count(*) = 6 from pg_constraint where conrelid=to_regclass('public.asset_tags')
        and convalidated and conname in ('asset_tags_tag_normalized_check','asset_tags_source_normalized_check',
          'asset_tags_category_check','asset_tags_status_check','asset_tags_confidence_check','asset_tags_rejection_check'))
    """,
    "popdam_1427_indexes_v1": """
      to_regclass('public.style_group_tags_active_group_idx') is not null
      and to_regclass('public.asset_tags_active_asset_idx') is not null
      and to_regclass('public.dam_search_embedding_claim_idx') is not null
      and to_regclass('public.asset_tags_forward_asset_id_idx') is not null
      -- The normalization accelerator was retired by issue #1467 (20260827183106)
      -- and is deliberately no longer part of this contract. It is removed rather
      -- than inverted because this contract is bound to sidecar 20260825082910,
      -- which is already promoted: the catalog-verification recovery lane re-runs
      -- that historical allowlist against current main, where an inverted clause
      -- would be a latent failure. supabase/tests assert the absence instead.
    """,
    "popdam_1427_functions_triggers_v1": """
      to_regprocedure('public.get_effective_asset_metadata(uuid)') is not null
      and to_regprocedure('public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])') is not null
      and to_regprocedure('public.replace_asset_ai_tag_result(uuid,text,text,jsonb)') is not null
      and to_regprocedure('public.refresh_dam_search_documents_batch(uuid[],uuid[],integer)') is not null
      and to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is not null
      and to_regprocedure('public.upsert_dam_search_embedding(text,uuid,text,uuid,extensions.vector,text)') is not null
      and to_regprocedure('public.mark_dam_search_embedding_error(text,uuid,text,uuid,text,text)') is not null
      and to_regprocedure('public.get_dam_search_embedding_status()') is not null
      and to_regprocedure('public.reset_dam_search_embedding_errors(text,uuid[])') is not null
      and (select count(*) = 4 from pg_trigger where not tgisinternal and tgenabled <> 'D' and (
        (tgrelid=to_regclass('public.asset_tags') and tgname in ('asset_tags_sync_assets_tags','asset_tags_dam_search_refresh'))
        or (tgrelid=to_regclass('public.style_group_tags') and tgname='style_group_tags_dam_search_refresh')
        or (tgrelid=to_regclass('public.asset_characters') and tgname='asset_characters_dam_search_refresh')))
    """,
    "popdam_1427_security_v1": """
      (select relrowsecurity from pg_class where oid=to_regclass('public.style_group_tags'))
      and (select count(*) = 2 from pg_policy where polrelid=to_regclass('public.style_group_tags')
        and polname in ('Authenticated read style_group_tags','Admin manage style_group_tags'))
      and has_table_privilege('authenticated',to_regclass('public.style_group_tags'),'SELECT')
      and has_table_privilege('service_role',to_regclass('public.style_group_tags'),'SELECT')
      and has_function_privilege('service_role',to_regprocedure('public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])'),'EXECUTE')
      and has_function_privilege('service_role',to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)'),'EXECUTE')
      and not has_function_privilege('authenticated',to_regprocedure('public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])'),'EXECUTE')
      and not has_function_privilege('authenticated',to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)'),'EXECUTE')
    """,
    "popdam_1427_active_marker_v1": """
      (select col_description(a.attrelid,a.attnum)
        from pg_attribute a where a.attrelid=to_regclass('public.asset_tags')
          and a.attname='category' and not a.attisdropped)
      = 'File-specific PopDAM tag category; final #1427 contract active.'
    """,
}

# DYNAMIC ACL EXTRACTION (issue #822 / production run 31558201593).
#
# A grant/revoke issued through `execute format(...)` inside a do-block is a
# real, assertable catalog change at apply time, but strip_sql removes the
# whole dollar-quoted body, so the plain-statement pass never sees it. When a
# batch grants ALL in one migration and revokes a subset in a later one that
# uses this pattern (B3: 20260729230000 grants ALL, 20260812020000 revokes four
# bits via execute format), the verifier sees only the GRANT ALL and demands
# every privilege -- failing a correct apply.
#
# The fix is GENERAL, not B3-specific. parse_dynamic_acl reads any
# execute-format grant/revoke inside a do-block, resolves the format argument
# to concrete values from the array literal feeding its foreach loop, and feeds
# the substituted statements into the same privilege pipeline. The "last
# statement wins" net-ACL logic in assert_privileges then reduces the earlier
# GRANT ALL by the later REVOKE. Unresolvable sources are recorded, not guessed.
DYNAMIC_DO_BODY_RE = re.compile(r"\bdo\s+\$(\w*)\$(.*?)\$\1\$", re.IGNORECASE | re.DOTALL)
DYNAMIC_EXEC_FMT_RE = re.compile(r"\bexecute\s+format\s*\(\s*", re.IGNORECASE)
DYNAMIC_GRANT_HEAD_RE = re.compile(r"^\s*(grant|revoke)\b", re.IGNORECASE)
DYNAMIC_PLACEHOLDER_RE = re.compile(r"%(?:s|I)")
DYNAMIC_ARRAY_TYPED_RE = re.compile(
    r"(\w+)\s+\w+\s*\[\s*\]\s*:=\s*array\s*\[", re.IGNORECASE
)
DYNAMIC_ARRAY_BARE_RE = re.compile(r"(\w+)\s*:=\s*array\s*\[", re.IGNORECASE)
DYNAMIC_FOREACH_RE = re.compile(
    r"foreach\s+(\w+)\s+in\s+array\s+(.+?)\s+loop", re.IGNORECASE | re.DOTALL
)


class PrivilegeExpectation:
    """One assertable statement about the end state of a privilege.

    `expect_held=False` is a REVOKE: the grantee must NOT hold the privilege
    afterwards. `expect_held=True` is a GRANT: it must. This is the difference
    between issue #790's "assert" and the old "print an ACL string and let a
    human read it".
    """

    KINDS = ("relation", "function", "default_acl")

    def __init__(
        self,
        kind: str,
        target: str,
        grantee: str,
        privileges: tuple[str, ...],
        expect_held: bool,
        source: str,
        objtype: str = "r",
    ) -> None:
        if kind not in self.KINDS:
            raise GuardError(f"unknown privilege expectation kind: {kind}")
        self.kind = kind
        self.target = target
        # `public` is a pseudo-role; `aclexplode` renders it as the literal
        # PUBLIC, so it is normalised once here rather than at every comparison.
        self.grantee = "PUBLIC" if grantee.lower() == "public" else grantee
        self.privileges = tuple(sorted(set(privileges)))
        self.expect_held = expect_held
        self.source = source
        self.objtype = objtype

    @property
    def key(self) -> tuple:
        return (
            self.kind,
            self.target,
            self.objtype,
            self.grantee,
            self.privileges,
            self.expect_held,
        )

    def expand(self, maintain_probed: bool) -> tuple[str, ...]:
        """`ALL` -> the concrete privilege list for this object type.

        MAINTAIN is included only when the server actually has it (PG >= 17).
        Asserting a privilege the server does not know would fail every correct
        apply on an older target -- the same false-negative class as #790.
        """
        if "ALL" not in self.privileges:
            return self.privileges
        base = list(ALL_PRIVILEGES_BY_OBJTYPE.get(self.objtype, ()))
        if self.objtype == "r" and maintain_probed:
            base.append(MAINTAIN_PRIVILEGE)
        rest = [p for p in self.privileges if p != "ALL"]
        return tuple(sorted(set(base) | set(rest)))

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "target": self.target,
            "objtype": self.objtype,
            "grantee": self.grantee,
            "privileges": list(self.privileges),
            "expect_held": self.expect_held,
            "source": self.source,
        }

    def describe(self) -> str:
        verb = "must HOLD" if self.expect_held else "must NOT hold"
        return (
            f"{self.grantee} {verb} {', '.join(self.privileges)} on "
            f"{self.kind} {self.target}"
        )


def _split_privileges(raw: str) -> tuple[tuple[str, ...], str | None]:
    """Parse the privilege list of a GRANT/REVOKE. Returns (privs, note).

    A column-level grant (`select (col_a, col_b)`) is NOT modelled: column ACLs
    live in `pg_attribute.attacl`, which this module does not read, and guessing
    would be the mis-parse it refuses to make. It returns a NOTE instead, so the
    statement is recorded as unassertable rather than silently dropped.
    """
    text = raw.strip()
    if "(" in text:
        return (), f"column-level privileges are not modelled: `{text}`"
    privileges: list[str] = []
    for token in text.split(","):
        name = " ".join(token.split()).upper()
        if name in ("ALL", "ALL PRIVILEGES"):
            privileges.append("ALL")
        elif re.fullmatch(r"[A-Z ]+", name or "x"):
            privileges.append(name)
        else:
            return (), f"unparseable privilege list: `{text}`"
    if not privileges:
        return (), f"empty privilege list: `{text}`"
    return tuple(privileges), None


def _split_grantees(raw: str) -> set[str]:
    """Roles named after TO / FROM, with the trailing clauses removed."""
    text = raw
    for tail in (
        "with grant option",
        "with admin option",
        "granted by",
        "cascade",
        "restrict",
    ):
        index = text.find(tail)
        if index != -1:
            text = text[:index]
    return _roles_in(f"to {text}")


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
        privileges: list[PrivilegeExpectation] | None = None,
        notes: list[str] | None = None,
        noop_declaration: dict | None = None,
        indexes: set[tuple[str, str]] | None = None,
        schema_renames: set[tuple[str, str, str | None]] | None = None,
    ) -> None:
        # ORDER IS LOAD-BEARING and must be the order the statements appear in,
        # not sorted: a batch may `grant` a privilege and then `revoke` it, and
        # only the LAST statement describes the end state. Sorting these would
        # make one of the two contradict production and fail a correct apply --
        # the very false-negative class issue #790 is about. Exact duplicates are
        # collapsed, which keeps the artifact stable without reordering anything.
        deduped: dict[tuple, PrivilegeExpectation] = {}
        for expectation in privileges or []:
            deduped.pop(expectation.key, None)
            deduped[expectation.key] = expectation
        self.privileges = list(deduped.values())
        self.notes = sorted(set(notes or []))
        self.noop_declaration = noop_declaration
        self.tables = sorted(tables)
        self.views = sorted(views)
        self.rls_relations = sorted(rls_relations)
        self.functions = sorted(functions)
        self.roles = sorted(roles)
        self.seeded = sorted(seeded)
        self.indexes = sorted(indexes or set())
        self.schema_renames = sorted(schema_renames or set())
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

    @property
    def default_acls(self) -> list[tuple[str, str, str]]:
        """The distinct (schema, defacl role, objtype) rows to read."""
        found = {
            tuple(e.target.split("|")) + (e.objtype,)
            for e in self.privileges
            if e.kind == "default_acl"
        }
        return sorted(found)  # type: ignore[arg-type]

    def is_empty(self) -> bool:
        return not (
            self.relations
            or self.functions
            or self.seeded
            or self.rls_relations
            or self.privileges
            or self.indexes
            or self.schema_renames
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
            "indexes": [f"{index}|{relation}" for index, relation in self.indexes],
            "schema_renames": [
                f"{source}|{destination}|{comment if comment is not None else ''}"
                for source, destination, comment in self.schema_renames
            ],
            "privilege_assertions": [e.describe() for e in self.privileges],
            "unassertable_statements": self.notes,
        }


def _strict_keys(value: object, allowed: set[str], label: str) -> dict:
    if not isinstance(value, dict):
        raise GuardError(f"{label} must be a JSON object")
    unknown = set(value) - allowed
    missing = allowed - set(value)
    if unknown or missing:
        raise GuardError(
            f"{label} has invalid keys; missing={sorted(missing)}, "
            f"unknown={sorted(unknown)}"
        )
    return value


def dynamic_execution_marker_lines(sql: str) -> list[int]:
    """Return conservative dynamic-execution marker lines without inferring targets."""
    chars = list(sql)
    i = 0
    state = "code"
    escape_string = False
    block_depth = 0
    while i < len(chars):
        if state == "code" and sql.startswith("--", i):
            state = "line_comment"; chars[i] = chars[i + 1] = " "; i += 2; continue
        if state == "line_comment":
            if chars[i] == "\n": state = "code"
            else: chars[i] = " "
            i += 1; continue
        if state == "code" and sql.startswith("/*", i):
            state = "block_comment"; block_depth = 1; chars[i] = chars[i + 1] = " "; i += 2; continue
        if state == "block_comment":
            if sql.startswith("/*", i): chars[i] = chars[i + 1] = " "; block_depth += 1; i += 2
            elif sql.startswith("*/", i):
                chars[i] = chars[i + 1] = " "; block_depth -= 1; i += 2
                if block_depth == 0: state = "code"
            else:
                if chars[i] != "\n": chars[i] = " "
                i += 1
            continue
        if state == "code" and chars[i] == "'":
            escape_string = i > 0 and sql[i - 1] in "eE" and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] in "_$"))
            state = "string"; i += 1; continue
        if state == "string":
            if escape_string and chars[i] == "\\" and i + 1 < len(chars):
                chars[i] = " "
                if chars[i + 1] != "\n": chars[i + 1] = " "
                i += 2; continue
            if chars[i] == "'" and i + 1 < len(chars) and chars[i + 1] == "'":
                chars[i] = chars[i + 1] = " "; i += 2; continue
            if chars[i] == "'": state = "code"
            elif chars[i] != "\n": chars[i] = " "
            i += 1; continue
        i += 1
    text = "".join(chars)
    # Proven-static uses: privilege token and CREATE TRIGGER execution clause.
    text = re.sub(r"(?is)\b(grant|revoke)\b[^;]*?\bexecute\b(?=[^;]*\bon\b)",
                  lambda m: re.sub(r"(?i)\bexecute\b", " " * 7, m.group(0)), text)
    text = re.sub(r"(?i)\bexecute\s+(?:function|procedure)\b",
                  lambda m: " " * len(m.group(0)), text)
    offsets = []
    for match in re.finditer(r'(?i)\bexecute\b|(?:\b[a-z0-9_]*apply[a-z0-9_]*ddl\b|"[a-z0-9_]*apply[a-z0-9_]*ddl")\s*\(', text):
        offsets.append(text.count("\n", 0, match.start()) + 1)
    return sorted(set(offsets))


def _validate_marker_reviews(item: dict, path: Path, migration_sql: str, check_ids: set[str]) -> None:
    markers = dynamic_execution_marker_lines(migration_sql)
    has_marker_fields = "marker_reviews" in item or "marker_schema_version" in item
    if not markers and not has_marker_fields:
        return
    if item.get("marker_schema_version") != MARKER_SCHEMA_VERSION:
        raise GuardError(f"{path}: marker_schema_version must be exactly {MARKER_SCHEMA_VERSION}")
    reviews = item.get("marker_reviews")
    if not isinstance(reviews, list) or not reviews:
        raise GuardError(f"{path}: marker_reviews must be a non-empty array")
    covered: list[int] = []
    empty_only = True
    previous_end = 0
    for index, value in enumerate(reviews):
        if not isinstance(value, dict):
            raise GuardError(f"{path} marker review {index} must be an object")
        disposition = value.get("disposition")
        allowed = MARKER_REVIEW_CHECK_KEYS if disposition == "checks" else MARKER_REVIEW_EMPTY_KEYS if disposition == "no_durable_target" else set()
        if not allowed:
            raise GuardError(f"{path}: invalid marker disposition {disposition!r}")
        review = _strict_keys(value, allowed, f"{path} marker review {index}")
        start, end = review["line_start"], review["line_end"]
        if not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start:
            raise GuardError(f"{path}: invalid marker review range {start!r}-{end!r}")
        if start <= previous_end:
            raise GuardError(f"{path}: marker review ranges overlap or are not strictly ordered")
        previous_end = end
        covered.extend(line for line in markers if start <= line <= end)
        if disposition == "checks":
            empty_only = False
            ids = review["check_ids"]
            if not isinstance(ids, list) or not ids or any(value not in check_ids for value in ids):
                raise GuardError(f"{path}: marker review cites an absent check")
            reason = review["reason"]
            if not isinstance(reason, str) or len(re.sub(r"\s", "", reason)) < 40:
                raise GuardError(f"{path}: checks disposition requires a substantive marker-to-contract rationale")
        else:
            reason = review["reason"]
            if not isinstance(reason, str) or len(re.sub(r"\s", "", reason)) < 40:
                raise GuardError(f"{path}: no_durable_target reason must contain 40 non-whitespace characters")
    if sorted(covered) != markers or len(covered) != len(set(covered)):
        raise GuardError(f"{path}: marker reviews must cover every marker line exactly once; markers={markers}")
    if not item["checks"] and not empty_only:
        raise GuardError(f"{path}: empty checks require only no_durable_target reviews")


def load_behavior_sidecars(
    repo: Path, migrations: dict[str, Path], allowlist: list[str]
) -> list[dict]:
    """Load exact-hash-bound, typed post-apply checks for allowlisted files.

    A sidecar is data, never SQL. It may select only a fixed verifier-owned
    catalog contract or typed row-count filters. Unknown fields and types fail closed. Its
    migration hash makes a reviewed assertion invalid as soon as the migration
    text changes, instead of silently applying an old claim to new behavior.
    """
    sidecars: list[dict] = []
    seen_ids: set[str] = set()
    for version in allowlist:
        path = repo / BEHAVIOR_SIDECAR_DIR / f"{version}.json"
        if not path.exists():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise GuardError(f"invalid behavioral sidecar {path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise GuardError(f"{path}: sidecar must be an object")
        allowed_top = BEHAVIOR_SIDECAR_MARKER_KEYS if (
            "marker_reviews" in raw or "marker_schema_version" in raw
        ) else BEHAVIOR_SIDECAR_KEYS
        item = _strict_keys(raw, allowed_top, str(path))
        if item["schema_version"] != 1:
            raise GuardError(f"{path}: schema_version must be exactly 1")
        if item["migration_version"] != version:
            raise GuardError(f"{path}: migration_version must equal {version}")
        migration = migrations.get(version)
        if migration is None:
            raise GuardError(f"{path}: migration {version} is missing from the repository")
        # Git stores text with LF, while a Windows checkout may materialise
        # CRLF. Bind to canonical text bytes so the same reviewed file has the
        # same hash on Windows and the Linux GitHub runner.
        canonical_bytes = migration.read_bytes().replace(b"\r\n", b"\n")
        actual_hash = hashlib.sha256(canonical_bytes).hexdigest()
        expected_hash = item["migration_sha256"]
        if not isinstance(expected_hash, str) or not re.fullmatch(
            r"[0-9a-f]{64}", expected_hash
        ):
            raise GuardError(f"{path}: migration_sha256 must be lowercase SHA-256")
        if actual_hash != expected_hash:
            raise GuardError(
                f"{path}: migration hash mismatch; expected {expected_hash}, "
                f"found {actual_hash}"
            )
        checks = item["checks"]
        if not isinstance(checks, list):
            raise GuardError(f"{path}: checks must be an array")
        checked: list[dict] = []
        for index, value in enumerate(checks):
            if not isinstance(value, dict):
                raise GuardError(f"{path} check {index} must be an object")
            kind = value.get("kind")
            allowed_keys = (
                BEHAVIOR_ROW_COUNT_KEYS
                if kind == "exact_row_count"
                else BEHAVIOR_CATALOG_CONTRACT_KEYS
                if kind == "catalog_contract"
                else None
            )
            if allowed_keys is None:
                raise GuardError(f"{path}: unsupported check kind {kind!r}")
            check = _strict_keys(value, allowed_keys, f"{path} check {index}")
            check_id = check["id"]
            if not isinstance(check_id, str) or not re.fullmatch(
                r"[a-z][a-z0-9_]{2,63}", check_id
            ):
                raise GuardError(f"{path}: invalid check id {check_id!r}")
            if check_id in seen_ids:
                raise GuardError(f"duplicate behavioral check id: {check_id}")
            seen_ids.add(check_id)
            expected_count = check["expected_count"]
            if (
                isinstance(expected_count, bool)
                or not isinstance(expected_count, int)
                or expected_count < 0
            ):
                raise GuardError(f"{path}: expected_count must be a non-negative integer")
            if kind == "catalog_contract":
                contract = check["contract"]
                if contract not in CATALOG_CONTRACTS:
                    raise GuardError(f"{path}: unsupported catalog contract {contract!r}")
                if expected_count != 1:
                    raise GuardError(f"{path}: catalog contract expected_count must be 1")
                parsed = dict(check)
                parsed["relation"] = f"catalog:{contract}"
                parsed["migration_version"] = version
                parsed["migration_sha256"] = actual_hash
                checked.append(parsed)
                continue
            relation = check["relation"]
            if not isinstance(relation, str) or not re.fullmatch(
                r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*", relation
            ):
                raise GuardError(f"{path}: invalid relation {relation!r}")
            filters = check["filters"]
            if not isinstance(filters, list) or not filters:
                raise GuardError(f"{path}: filters must be a non-empty array")
            parsed_filters: list[dict] = []
            seen_columns: set[str] = set()
            for filter_index, filter_value in enumerate(filters):
                filt = _strict_keys(
                    filter_value,
                    BEHAVIOR_FILTER_KEYS,
                    f"{path} check {index} filter {filter_index}",
                )
                column = filt["column"]
                if not isinstance(column, str) or not ROLE_RE.fullmatch(column):
                    raise GuardError(f"{path}: invalid column {column!r}")
                if column in seen_columns:
                    raise GuardError(f"{path}: duplicate filter column {column}")
                seen_columns.add(column)
                scalar_type = filt["type"]
                if scalar_type not in BEHAVIOR_TYPES:
                    raise GuardError(f"{path}: unsupported scalar type {scalar_type!r}")
                scalar = filt["equals"]
                if (
                    scalar_type in {"uuid", "text", *BEHAVIOR_ENUM_VALUES}
                    and not isinstance(scalar, str)
                ):
                    raise GuardError(f"{path}: {scalar_type} value must be a string")
                if scalar_type == "uuid":
                    try:
                        uuid.UUID(scalar)
                    except (ValueError, AttributeError) as exc:
                        raise GuardError(f"{path}: invalid UUID value") from exc
                if scalar_type == "integer" and (
                    isinstance(scalar, bool) or not isinstance(scalar, int)
                ):
                    raise GuardError(f"{path}: integer value must be an integer")
                if scalar_type == "boolean" and not isinstance(scalar, bool):
                    raise GuardError(f"{path}: boolean value must be true or false")
                if (
                    scalar_type in BEHAVIOR_ENUM_VALUES
                    and scalar not in BEHAVIOR_ENUM_VALUES[scalar_type]
                ):
                    raise GuardError(
                        f"{path}: invalid {scalar_type} enum value {scalar!r}"
                    )
                parsed_filters.append(dict(filt))
            parsed = dict(check)
            parsed["filters"] = parsed_filters
            parsed["migration_version"] = version
            parsed["migration_sha256"] = actual_hash
            checked.append(parsed)
        _validate_marker_reviews(
            item, path, canonical_bytes.decode("utf-8"),
            {check["id"] for check in checked},
        )
        if not checks and "marker_reviews" not in item:
            raise GuardError(f"{path}: empty checks require a reviewed marker declaration")
        sidecars.extend(checked)
    return sidecars


def _typed_sql_literal(value: object, scalar_type: str) -> str:
    if scalar_type == "uuid":
        return "'" + str(value) + "'::uuid"
    if scalar_type == "text":
        return "'" + str(value).replace("'", "''") + "'::text"
    if scalar_type == "integer":
        return str(value)
    if scalar_type == "boolean":
        return "true" if value else "false"
    if scalar_type in BEHAVIOR_ENUM_VALUES:
        return (
            "'" + str(value).replace("'", "''") + "'::" + scalar_type
        )
    raise GuardError(f"unsupported behavioral scalar type: {scalar_type!r}")


def build_behavior_sql(checks: list[dict]) -> str:
    """Build one SELECT from typed assertions. Sidecars cannot supply SQL."""
    if not checks:
        raise GuardError("cannot build behavioral SQL without checks")
    rows: list[str] = []
    for check in checks:
        check_id = check["id"].replace("'", "''")
        expected = check["expected_count"]
        if check["kind"] == "catalog_contract":
            contract = check["contract"]
            expression = CATALOG_CONTRACTS.get(contract)
            if expression is None:
                raise GuardError(f"refusing unknown catalog contract: {contract!r}")
            rows.append(
                "select '" + check_id + "'::text as id, "
                + "case when (" + expression + ") then 1 else 0 end::bigint as actual_count, "
                + str(expected) + "::bigint as expected_count"
            )
            continue
        relation = check["relation"]
        if not re.fullmatch(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*", relation):
            raise GuardError(f"refusing unsafe behavioral relation: {relation!r}")
        predicates: list[str] = []
        for filt in check["filters"]:
            column = filt["column"]
            if not ROLE_RE.fullmatch(column):
                raise GuardError(f"refusing unsafe behavioral column: {column!r}")
            predicates.append(
                f'{column} = {_typed_sql_literal(filt["equals"], filt["type"])}'
            )
        rows.append(
            "select '" + check_id + "'::text as id, count(*)::bigint as actual_count, "
            + str(expected) + "::bigint as expected_count from " + relation
            + " where " + " and ".join(predicates)
        )
    return (
        "select jsonb_build_object('behavior_checks', coalesce(jsonb_agg("
        "jsonb_build_object('id', q.id, 'actual_count', q.actual_count, "
        "'expected_count', q.expected_count) order by q.id), '[]'::jsonb)) as report "
        "from (" + " union all ".join(rows) + ") q;"
    )


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


def parse_default_privileges(
    statement: str, source: str
) -> tuple[list[PrivilegeExpectation], list[str]]:
    """`alter default privileges` -> expectations against `pg_default_acl`.

    CONSERVATIVE IN TWO PLACES, both load-bearing:

      * No `for role` -> the rule is keyed on the EXECUTING role, which this
        script cannot know from the text. Recorded as unassertable, never
        guessed. (20260810180000 states `for role postgres` explicitly, for the
        same reason its own header gives.)
      * No `in schema` -> the rule is database-wide across every schema the role
        creates in. Also recorded, not guessed.
    """
    notes: list[str] = []
    match = ADP_ACTION_RE.search(statement)
    if not match:
        return [], [f"unparseable `alter default privileges`: `{statement.strip()}`"]
    action, raw_privs, what, _direction, raw_roles = match.groups()

    role_match = ADP_FOR_ROLE_RE.search(statement)
    schema_match = ADP_IN_SCHEMA_RE.search(statement)
    if not role_match:
        return [], [
            "`alter default privileges` without `for role` names the EXECUTING "
            "role, which cannot be read from the file: "
            f"`{statement.strip()}`"
        ]
    if not schema_match:
        return [], [
            "`alter default privileges` without `in schema` applies across every "
            f"schema and is not modelled: `{statement.strip()}`"
        ]

    privileges, priv_note = _split_privileges(raw_privs)
    if priv_note:
        return [], [priv_note]
    grantees = _split_grantees(raw_roles)
    if not grantees:
        return [], [f"no readable grantee in: `{statement.strip()}`"]

    objtype = DEFACL_OBJTYPES[what]
    expectations: list[PrivilegeExpectation] = []
    for defacl_role in sorted(_roles_in(f"to {role_match.group(1)}")):
        for schema in sorted(_roles_in(f"to {schema_match.group(1)}")):
            for grantee in sorted(grantees):
                expectations.append(
                    PrivilegeExpectation(
                        kind="default_acl",
                        target=f"{schema}|{defacl_role}",
                        grantee=grantee,
                        privileges=privileges,
                        expect_held=action == "grant",
                        source=source,
                        objtype=objtype,
                    )
                )
    if not expectations:
        notes.append(f"no readable role/schema in: `{statement.strip()}`")
    return expectations, notes


def parse_grant_statement(
    statement: str, source: str
) -> tuple[list[PrivilegeExpectation], set[str], set[str], list[str]]:
    """`grant`/`revoke` -> expectations, plus the relations and functions named.

    Returns (expectations, relations, functions, notes). `all tables in schema`,
    `on schema`, `on database` and sequences are NOT modelled: each names
    something whose membership or ACL this module does not read, and inventing
    it is the mis-parse that costs a correct apply a red tick.
    """
    notes: list[str] = []
    match = GRANT_STATEMENT_RE.match(statement)
    if not match:
        return [], set(), set(), [f"unparseable grant/revoke: `{statement.strip()}`"]
    action, raw_privs, raw_objects, _direction, raw_roles = match.groups()

    privileges, priv_note = _split_privileges(raw_privs)
    if priv_note:
        notes.append(priv_note)
    grantees = _split_grantees(raw_roles)
    if not grantees:
        notes.append(f"no readable grantee in: `{statement.strip()}`")

    relations: set[str] = set()
    functions: set[str] = set()
    expectations: list[PrivilegeExpectation] = []
    objects = raw_objects.strip()

    routine_match = ROUTINE_OBJECT_RE.match(objects)
    if routine_match:
        names = [
            f"{m.group(1)}.{m.group(2)}"
            for m in ROUTINE_NAME_RE.finditer(routine_match.group(1))
        ]
        if not names:
            notes.append(f"unreadable routine name in: `{statement.strip()}`")
        functions |= set(names)
        kind, objtype = "function", "f"
        targets = names
    elif re.match(r"^\s*all\s+", objects) or re.match(
        r"^\s*(schema|database|sequence|foreign|large|tablespace|domain|type|language)\b",
        objects,
    ):
        return (
            [],
            set(),
            set(),
            notes
            + [
                "object class not modelled by this lexer, so it is recorded and "
                f"NOT asserted: `{statement.strip()}`"
            ],
        )
    else:
        targets = []
        for part in objects.split(","):
            plain = PLAIN_OBJECT_RE.match(part)
            if not plain:
                notes.append(
                    f"unreadable object `{part.strip()}` in: `{statement.strip()}`"
                )
                continue
            targets.append(f"{plain.group(1)}.{plain.group(2)}")
        relations |= set(targets)
        kind, objtype = "relation", "r"

    if privileges and grantees:
        for target in targets:
            for grantee in sorted(grantees):
                expectations.append(
                    PrivilegeExpectation(
                        kind=kind,
                        target=target,
                        grantee=grantee,
                        privileges=privileges,
                        expect_held=action == "grant",
                        source=source,
                        objtype=objtype,
                    )
                )
    return expectations, relations, functions, notes


def read_noop_declaration(raw: str, version: str) -> dict | None:
    """The one honest way a migration says "I name no catalog object".

    ISSUE #790 POINT 3. A pure-data migration really does touch nothing this
    module can read, and a silent pass there would rebuild the exact failure
    class the enforcing gate exists to remove. So the migration DECLARES it, in
    its own text, in the pull request where a human reviews it:

        -- catalog-verification: no-op <reason, at least 20 characters>

    THE DECLARATION IS NOT TAKEN ON TRUST. Every statement in the file must then
    be data-shaped; one `create`, one `grant`, one `do $$` block and the claim is
    REJECTED and the run still fails. It is therefore not a bypass flag: it
    cannot excuse a privilege migration, and it cannot be aimed at a migration id
    from outside the file.
    """
    match = NOOP_DECLARATION_RE.search(raw)
    if not match:
        return None
    reason = match.group("reason").strip()
    statements = split_statements(strip_sql(raw))
    # Issue #805: the head keyword is necessary but NOT sufficient. A statement
    # whose head is data-shaped can still write the system catalog, execute SQL
    # through dblink, or switch the executing principal. Each offender carries
    # the reason it was rejected, so the refusal names what it found.
    offenders = []
    for statement in statements:
        rejection = data_statement_rejection(statement)
        if rejection:
            offenders.append(f"{' '.join(statement.split())[:120]} [{rejection}]")
    if len(reason) < 20:
        return {
            "version": version,
            "reason": reason,
            "accepted": False,
            "rejected_because": (
                "the declared reason is shorter than 20 characters, so it is not "
                "a reason a reviewer can act on"
            ),
        }
    if offenders:
        return {
            "version": version,
            "reason": reason,
            "accepted": False,
            "rejected_because": (
                "the file declares itself a pure-data no-op but contains "
                f"{len(offenders)} non-data statement(s): {offenders}"
            ),
        }
    return {
        "version": version,
        "reason": reason,
        "accepted": True,
        "statements_checked": len(statements),
    }


def _strip_sql_comments(raw: str) -> str:
    """Remove line (--) and block comment markers, preserving single-quoted
    string literals and dollar-quoted bodies.

    Used ONLY for dynamic-ACL extraction (which reads raw text that strip_sql
    would blank). It does NOT blank string literals (the format strings ARE
    string literals) and does NOT remove dollar-quoted bodies. Comment removal
    prevents a stray keyword inside a comment from masquerading as a do-block
    boundary -- the same trap that bit strip_sql.
    """
    result: list[str] = []
    i, n = 0, len(raw)
    in_str = False
    while i < n:
        c = raw[i]
        if in_str:
            result.append(c)
            if c == "'":
                if i + 1 < n and raw[i + 1] == "'":
                    result.append(c)
                    i += 2
                    continue
                in_str = False
            i += 1
        elif c == "'":
            in_str = True
            result.append(c)
            i += 1
        elif c == "-" and i + 1 < n and raw[i + 1] == "-":
            while i < n and raw[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < n and raw[i + 1] == "*":
            i += 2
            while i + 1 < n and not (raw[i] == "*" and raw[i + 1] == "/"):
                i += 1
            i += 2
        else:
            result.append(c)
            i += 1
    return "".join(result)


def _read_single_quoted(text: str, pos: int) -> tuple[str, int] | None:
    """Read a single-quoted string literal starting at text[pos].

    Handles doubled quotes. Returns (content, pos_after) or None.
    """
    n = len(text)
    if pos >= n or text[pos] != "'":
        return None
    pos += 1
    chars: list[str] = []
    while pos < n:
        if text[pos] == "'":
            if pos + 1 < n and text[pos + 1] == "'":
                chars.append("'")
                pos += 2
                continue
            return "".join(chars), pos + 1
        chars.append(text[pos])
        pos += 1
    return None


def _collect_array_literals(text: str) -> list[str]:
    """Collect single-quoted string values from array-literal content.

    text starts immediately after 'array['. Reading stops at ']'.
    Non-string tokens are skipped; only string literals become values.
    """
    values: list[str] = []
    i, n = 0, len(text)
    while i < n:
        while i < n and text[i] in " \t\n\r,":
            i += 1
        if i >= n or text[i] == "]":
            break
        if text[i] == "'":
            parsed = _read_single_quoted(text, i)
            if parsed is None:
                break
            values.append(parsed[0])
            i = parsed[1]
        else:
            i += 1
    return values


def _resolve_foreach_arrays(body: str) -> dict[str, list[str]]:
    """Map PL/pgSQL variables in a do-block to concrete string values.

    Recognises array assignments (name := array[...]) and foreach loops
    (foreach var in array <source> loop). Sources may be named variables,
    inline array[...] literals, or concatenations (a || b) of resolved arrays.
    Query-driven or unrecognised sources are simply absent from the map.
    """
    known: dict[str, list[str]] = {}

    def resolve_source(source: str) -> list[str] | None:
        source = source.strip()
        inline = re.match(r"array\s*\[", source, re.IGNORECASE)
        if inline:
            return _collect_array_literals(source[inline.end():])
        if source.lower() in known:
            return known[source.lower()]
        concat = re.match(r"\(?\s*(\w+)\s*\|\|\s*(\w+)\s*\)?$", source)
        if concat:
            a = known.get(concat.group(1).lower())
            b = known.get(concat.group(2).lower())
            if a is not None and b is not None:
                return a + b
        return None

    for match in DYNAMIC_ARRAY_TYPED_RE.finditer(body):
        name = match.group(1).lower()
        vals = _collect_array_literals(body[match.end():])
        if vals:
            known[name] = vals
    for match in DYNAMIC_ARRAY_BARE_RE.finditer(body):
        name = match.group(1).lower()
        if name in known:
            continue
        vals = _collect_array_literals(body[match.end():])
        if vals:
            known[name] = vals
    for match in DYNAMIC_FOREACH_RE.finditer(body):
        var = match.group(1).lower()
        resolved = resolve_source(match.group(2))
        if resolved is not None:
            known[var] = resolved
    return known


def parse_dynamic_acl(
    raw: str, source: str
) -> tuple[list[PrivilegeExpectation], set[str], set[str], list[str]]:
    """Read grant/revoke issued dynamically via execute format(...) inside
    do-blocks.

    strip_sql removes dollar-quoted bodies, so a privilege change living inside
    a do-block is invisible to the plain-statement pass. This function reads the
    RAW text, finds execute-format grant/revoke calls, resolves the format
    argument to concrete values from the array literal feeding its foreach loop,
    and returns the same shape as parse_grant_statement for drop-in integration.

    CONSERVATIVE -- three refusal points:
      * The format string must be a grant/revoke with at most one placeholder.
      * The placeholder argument must trace to a static array literal.
      * The substituted statement is parsed by the SAME parse_grant_statement,
        inheriting every guard there.
    """
    expectations: list[PrivilegeExpectation] = []
    relations: set[str] = set()
    functions: set[str] = set()
    notes: list[str] = []

    cleaned = _strip_sql_comments(raw)
    for body_match in DYNAMIC_DO_BODY_RE.finditer(cleaned):
        body = body_match.group(2)
        var_values = _resolve_foreach_arrays(body)

        for fmt_head in DYNAMIC_EXEC_FMT_RE.finditer(body):
            pos = fmt_head.end()
            parsed = _read_single_quoted(body, pos)
            if parsed is None:
                continue
            fmt, pos = parsed
            fmt_text = fmt.strip()
            if not DYNAMIC_GRANT_HEAD_RE.match(fmt_text):
                continue

            while pos < len(body) and body[pos] in " \t\n\r":
                pos += 1
            if pos < len(body) and body[pos] == ",":
                pos += 1
            arg_start = pos
            depth = 0
            while pos < len(body):
                if body[pos] == "(":
                    depth += 1
                elif body[pos] == ")":
                    if depth == 0:
                        break
                    depth -= 1
                pos += 1
            args_text = body[arg_start:pos].strip()
            args = [a.strip() for a in args_text.split(",") if a.strip()]
            n_placeholders = len(DYNAMIC_PLACEHOLDER_RE.findall(fmt))

            if n_placeholders == 0:
                found, rels, fns, grant_notes = parse_grant_statement(
                    fmt_text, source
                )
                expectations.extend(found)
                relations |= rels
                functions |= fns
                notes.extend(grant_notes)
                continue

            if n_placeholders == 1 and len(args) == 1:
                values = var_values.get(args[0].lower())
                if values is None:
                    notes.append(
                        f"dynamic grant/revoke in a do-block: the format "
                        f"argument `{args[0]}` could not be resolved to "
                        f"concrete values, so it is recorded and NOT asserted: "
                        f"`execute format('{fmt_text}', {args_text})`"
                    )
                    continue
                for val in values:
                    substituted = fmt.replace("%s", val).replace("%I", val)
                    found, rels, fns, grant_notes = parse_grant_statement(
                        substituted.strip(), source
                    )
                    expectations.extend(found)
                    relations |= rels
                    functions |= fns
                    notes.extend(grant_notes)
            else:
                notes.append(
                    f"dynamic grant/revoke with {n_placeholders} format "
                    f"placeholder(s) and {len(args)} argument(s) is not "
                    f"modelled: `execute format('{fmt_text}', {args_text})`"
                )

    return expectations, relations, functions, notes


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
    privileges: list[PrivilegeExpectation] = []
    notes: list[str] = []
    noop: dict | None = None
    indexes: set[tuple[str, str]] = set()
    schema_rename_pairs: set[tuple[str, str]] = set()
    schema_comments: dict[str, str] = {}

    for version in allowlist:
        path = migrations.get(version)
        if path is None:
            raise GuardError(f"unknown migration version: {version}")
        raw = path.read_text(encoding="utf-8")
        # strip_sql deliberately blanks string literals, so schema comments
        # must be read from the comment-stripped raw text. This still avoids
        # matching prose in SQL comments while preserving the exact literal.
        for match in COMMENT_SCHEMA_RE.finditer(_strip_sql_comments(raw)):
            schema_comments[match.group(1)] = match.group(2).replace("''", "'")
        declaration = read_noop_declaration(raw, version)
        if declaration is not None and (noop is None or not declaration["accepted"]):
            noop = declaration
        text = strip_sql(raw)
        for statement in split_statements(text):
            if match := ALTER_SCHEMA_RENAME_RE.match(statement):
                schema_rename_pairs.add((match.group(1), match.group(2)))
                continue
            if ALTER_DEFAULT_PRIVILEGES_RE.match(statement):
                found, adp_notes = parse_default_privileges(statement, version)
                privileges.extend(found)
                notes.extend(adp_notes)
                continue
            if match := CREATE_TABLE_RE.match(statement):
                name = f"{match.group(1)}.{match.group(2)}"
                if match.group(1) == "pg_temp":
                    notes.append(f"{version}: excluded session-temporary table `{name}` from durable catalog verification")
                else:
                    tables.add(name)
                continue
            if match := CREATE_VIEW_RE.match(statement):
                views.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := CREATE_ROUTINE_RE.match(statement):
                name = f"{match.group(1)}.{match.group(2)}"
                if match.group(1) == "pg_temp":
                    notes.append(f"{version}: excluded session-temporary routine `{name}` from durable catalog verification")
                else:
                    functions.add(name)
                continue
            if match := CREATE_POLICY_RE.match(statement):
                rls.add(f"{match.group(1)}.{match.group(2)}")
                continue
            if match := INSERT_INTO_RE.match(statement):
                name = f"{match.group(1)}.{match.group(2)}"
                if match.group(1) == "pg_temp":
                    notes.append(f"{version}: excluded session-temporary seed target `{name}` from durable catalog verification")
                else:
                    seeded.add(name)
                continue
            if match := CREATE_INDEX_RE.match(statement):
                index_name = f"{match.group(4)}.{match.group(3)}"
                relation_name = f"{match.group(4)}.{match.group(5)}"
                indexes.add((index_name, relation_name))
                tables.add(relation_name)
                continue
            if CREATE_INDEX_HEAD_RE.match(statement):
                notes.append(
                    f"{version}: CREATE INDEX was not safely parseable and was not "
                    f"silently accepted: `{statement.strip()[:240]}`"
                )
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
                found, rels, fns, grant_notes = parse_grant_statement(
                    statement, version
                )
                privileges.extend(found)
                tables |= rels
                functions |= fns
                notes.extend(grant_notes)
                for expectation in found:
                    if expectation.grantee != "PUBLIC":
                        roles.add(expectation.grantee)

        # DYNAMIC ACL (issue #822): grant/revoke issued through execute
        # format(...) inside do-blocks is invisible to strip_sql, which removes
        # dollar-quoted bodies. Read it from the raw text so a later REVOKE
        # (B3: 20260812020000) can reduce an earlier GRANT ALL
        # (B3: 20260729230000). The substituted statements go through the SAME
        # parse_grant_statement as the plain pass. Processed AFTER the plain
        # statements of this file because do-blocks conventionally follow the
        # plain SQL; across files the allowlist order is authoritative.
        dyn_found, dyn_rels, dyn_fns, dyn_notes = parse_dynamic_acl(raw, version)
        privileges.extend(dyn_found)
        tables |= dyn_rels
        functions |= dyn_fns
        notes.extend(dyn_notes)
        for expectation in dyn_found:
            if expectation.grantee != "PUBLIC":
                roles.add(expectation.grantee)

    # A view that also matched a table-shaped rule stays a view; `to_regclass`
    # covers both, and `relkind` in the report says which it really is.
    tables -= views
    # Every relation is worth an RLS reading -- RLS-on-with-zero-policies was the
    # single check the canary run could not confirm at all.
    rls |= tables
    schema_renames = {
        (source, destination, schema_comments.get(destination))
        for source, destination in schema_rename_pairs
    }
    return Targets(
        tables,
        views,
        rls,
        functions,
        roles,
        seeded,
        optional,
        privileges=privileges,
        notes=notes,
        noop_declaration=noop,
        indexes=indexes,
        schema_renames=schema_renames,
    )


def diagnose_catalog_coverage(repo_root: Path, allowlist: list[str]) -> dict[str, Any]:
    """Read-only Phase 2 qualification entrypoint; verify() remains authoritative."""
    targets = derive_targets(local_migrations(repo_root), allowlist)
    payload = targets.as_dict()
    target_count = sum(len(value) for value in payload.values() if isinstance(value, list))
    covered = target_count > 0 or bool(targets.noop_declaration)
    return {"status": "covered" if covered else "missing", "target_count": target_count, "noop_declaration": targets.noop_declaration}


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


def _objtype_array(values: list[str]) -> str:
    """`pg_default_acl.defaclobjtype` codes. Uppercase `S` cannot use _sql_array.

    Checked against the closed set rather than a character class, for the same
    reason `_sql_array` re-asserts its identifiers: this string is interpolated
    into SQL.
    """
    allowed = set(DEFACL_OBJTYPES.values())
    for value in values:
        if value not in allowed:
            raise GuardError(f"refusing to interpolate unknown objtype: {value!r}")
    if not values:
        return "array[]::text[]"
    return "array[" + ", ".join(f"'{v}'" for v in values) + "]::text[]"


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
    index_names = _sql_array([row[0] for row in targets.indexes])
    index_relations = _sql_array([row[1] for row in targets.indexes])
    schema_names = _sql_array(
        sorted({name for source, destination, _ in targets.schema_renames for name in (source, destination)})
    )
    defacl = targets.default_acls
    defacl_schemas = _sql_array([row[0] for row in defacl])
    defacl_roles = _sql_array([row[1] for row in defacl])
    defacl_objtypes = _objtype_array([row[2] for row in defacl])
    return f"""
with defacl_target as (
  select * from unnest({defacl_schemas}, {defacl_roles}, {defacl_objtypes})
    as t(nspname, rolname, objtype)
),
index_target as (
  select * from unnest({index_names}, {index_relations})
    as t(index_name, relation_name)
),
rel as (
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
  -- Which probed roles actually EXIST. Without this, a grant expectation naming
  -- a role that is not there reads exactly like a role that holds nothing, and
  -- the two need different verdicts.
  'probe_roles', coalesce((
    select jsonb_agg(probe_roles.role order by probe_roles.role) from probe_roles
  ), '[]'::jsonb),
  'schemas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', s.name,
      'exists', n.oid is not null,
      'comment', obj_description(n.oid, 'pg_namespace')
    ) order by s.name)
    from unnest({schema_names}) as s(name)
    left join pg_namespace n on n.nspname = s.name
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', t.index_name,
      'relation', t.relation_name,
      'exists', c.oid is not null,
      'actual_relation', case when tc.oid is null then null
        else tn.nspname || '.' || tc.relname end,
      'valid', i.indisvalid,
      'ready', i.indisready,
      'definition', case when c.oid is null then null else pg_get_indexdef(c.oid) end
    ) order by t.index_name)
    from index_target t
    left join pg_namespace n on n.nspname = split_part(t.index_name, '.', 1)
    left join pg_class c on c.relnamespace = n.oid
      and c.relname = split_part(t.index_name, '.', 2)
      and c.relkind = 'i'
    left join pg_index i on i.indexrelid = c.oid
    left join pg_class tc on tc.oid = i.indrelid
    left join pg_namespace tn on tn.oid = tc.relnamespace
  ), '[]'::jsonb),
  -- DEFAULT PRIVILEGES (issue #790). `alter default privileges` names no
  -- relation, so nothing above can see it. `pg_default_acl` is where its effect
  -- lands and is therefore where it is asserted.
  -- A MISSING ROW IS NOT "NO GRANTS": with no row, Postgres's built-in default
  -- applies, and for FUNCTIONS that is EXECUTE to PUBLIC. `row_exists` is
  -- reported so the assertion can tell those two states apart.
  'default_acl', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', t.nspname,
      'defacl_role', t.rolname,
      'objtype', t.objtype,
      'role_exists', exists (select 1 from pg_roles r where r.rolname = t.rolname),
      'row_exists', d.defaclacl is not null,
      'acl_text', d.defaclacl::text,
      'acl', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantee', case when a.grantee = 0 then 'PUBLIC'
                          else a.grantee::regrole::text end,
          'privilege', a.privilege_type,
          'grantor', case when a.grantor = 0 then 'PUBLIC'
                          else a.grantor::regrole::text end
        ) order by a.grantee, a.privilege_type)
        from aclexplode(d.defaclacl) a), '[]'::jsonb)
    ) order by t.nspname, t.rolname, t.objtype)
    from defacl_target t
    left join pg_namespace n on n.nspname = t.nspname
    left join pg_default_acl d
      on d.defaclnamespace = n.oid
     and d.defaclobjtype::text = t.objtype
     and d.defaclrole = (select r.oid from pg_roles r where r.rolname = t.rolname)
  ), '[]'::jsonb),
  'relations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rel.name,
      'to_regclass', rel.oid::text,
      'relkind', (select c.relkind::text from pg_class c where c.oid = rel.oid),
      -- The OWNER always holds every privilege on its own relation, whatever the
      -- ACL says. A revoke aimed at the owner is a no-op in effect, so asserting
      -- it would fail every correct apply.
      'owner', (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = rel.oid),
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
          'owner', pg_get_userbyid(p.proowner),
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
    request = build_query_request(project_ref, token, sql, api)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # str(exc) alone hid a Cloudflare edge ban (403 / error 1010) for a full
        # day on issue #709. The status AND the body are the evidence; a body
        # that cannot be read must never mask the original error.
        raise GuardError(
            f"HTTP {exc.code} from {request.full_url}: {read_error_body(exc)}"
        ) from exc


def build_query_request(
    project_ref: str, token: str, sql: str, api: str = MANAGEMENT_API
) -> urllib.request.Request:
    """Construct the Management API query request, headers included.

    Split out from `run_query` so the outgoing headers -- above all the
    User-Agent that keeps Cloudflare from banning us at the edge -- can be
    asserted in tests WITHOUT any network call.
    """
    url = f"{api.rstrip('/')}/v1/projects/{project_ref}/database/query"
    body = json.dumps({"query": sql, "read_only": True}).encode("utf-8")
    return urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )


def read_error_body(exc: urllib.error.HTTPError) -> str:
    """Best-effort decode of an HTTPError body; never raises."""
    try:
        raw = exc.read()
    except Exception as read_exc:  # noqa: BLE001 -- must not mask the real error
        return f"<response body unreadable: {read_exc!r}> ({exc})"
    if not raw:
        return f"<empty response body> ({exc})"
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception as decode_exc:  # noqa: BLE001
        return f"<response body undecodable: {decode_exc!r}> ({exc})"
    return text.strip()[:2000]


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


def _acl_by_grantee(acl: list) -> dict[str, set[str]]:
    held: dict[str, set[str]] = {}
    for entry in acl or []:
        grantee = entry.get("grantee")
        if grantee is None:
            continue
        held.setdefault(str(grantee), set()).add(str(entry.get("privilege")).upper())
    return held


def _effective_for(held: dict[str, set[str]], grantee: str) -> set[str]:
    """What `grantee` ends up with, PUBLIC included.

    A privilege granted to PUBLIC is held by every role, so a revoke aimed at one
    role that leaves the PUBLIC grant standing has NOT achieved its end state.
    Folding PUBLIC in here is what makes that visible instead of passing.
    """
    return set(held.get(grantee, set())) | set(held.get("PUBLIC", set()))


def assert_privileges(
    targets: Targets, data: dict
) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Turn each derived expectation into a PASS / FAIL / RECORD verdict.

    ISSUE #790 POINTS 1, 2 AND 4. Before this, privileges were EVIDENCE ONLY --
    the report printed an ACL string and left a human to decide. For a
    grant/revoke/default-privilege migration the expected end state is knowable
    (20260810180000 asserts it internally in its own D2 block), so the lane
    asserts it externally too.

    RECORD, never FAIL, in exactly the places where the catalog cannot answer the
    question asked: an owner (who holds everything regardless of ACL), an
    ambiguous grant across multiple overloads, and an object the lexer did not
    read. Those are recorded WITH THEIR REASON; none of them is silent.
    """
    rows: list[tuple[str, str, str]] = []
    failures: list[str] = []
    maintain = bool(data.get("maintain_probed"))
    probe_roles = {str(r) for r in (data.get("probe_roles") or [])} | {"PUBLIC"}

    relations = {row.get("name"): row for row in (data.get("relations") or [])}
    functions = {row.get("name"): row for row in (data.get("functions") or [])}
    effective: dict[tuple[str, str], set[str]] = {}
    for row in data.get("effective_privileges") or []:
        # `probe_roles` probes the pseudo-role under its literal lowercase name
        # `public`, while `PrivilegeExpectation` normalises the grantee to
        # `PUBLIC`. Normalise here too, or the two keys never meet: a revoke
        # from PUBLIC that did NOT take reads PASS, and a grant to PUBLIC that
        # DID take reads FAIL.
        role = str(row.get("role"))
        key = (
            str(row.get("name")),
            "PUBLIC" if role.lower() == "public" else role,
        )
        effective.setdefault(key, set()).add(str(row.get("privilege")).upper())
    defacl = {
        (str(r.get("schema")), str(r.get("defacl_role")), str(r.get("objtype"))): r
        for r in (data.get("default_acl") or [])
    }

    def verdict(expectation, status: str, detail: str) -> None:
        rows.append((expectation.describe(), status, detail))
        if status == "FAIL":
            failures.append(f"{expectation.describe()} — {detail}")

    # LAST STATEMENT WINS, per single privilege. A batch may grant a privilege in
    # one file and revoke it in a later one; only the last statement describes
    # the end state, and asserting the earlier one would fail a correct apply.
    winner: dict[tuple[str, str, str, str, str], int] = {}
    for index, expectation in enumerate(targets.privileges):
        for privilege in expectation.expand(maintain):
            winner[
                (
                    expectation.kind,
                    expectation.target,
                    expectation.objtype,
                    expectation.grantee,
                    privilege,
                )
            ] = index

    for index, expectation in enumerate(targets.privileges):
        wanted = {
            privilege
            for privilege in expectation.expand(maintain)
            if winner[
                (
                    expectation.kind,
                    expectation.target,
                    expectation.objtype,
                    expectation.grantee,
                    privilege,
                )
            ]
            == index
        }
        if not wanted:
            rows.append(
                (
                    expectation.describe(),
                    "RECORD",
                    "every privilege here is restated by a LATER statement in the "
                    "same batch, which is the one that describes the end state",
                )
            )
            continue

        if expectation.kind == "relation":
            row = relations.get(expectation.target)
            if row is None or row.get("to_regclass") is None:
                verdict(
                    expectation,
                    "RECORD",
                    "the relation is not in the catalog; the missing-relation "
                    "check above owns that failure",
                )
                continue
            if row.get("owner") == expectation.grantee:
                verdict(
                    expectation,
                    "RECORD",
                    f"`{expectation.grantee}` OWNS this relation and therefore "
                    "holds every privilege on it regardless of the ACL",
                )
                continue
            if expectation.grantee not in probe_roles:
                if expectation.expect_held:
                    verdict(
                        expectation,
                        "FAIL",
                        f"role `{expectation.grantee}` does not exist, so it "
                        "cannot hold the granted privilege",
                    )
                else:
                    verdict(
                        expectation,
                        "PASS",
                        f"role `{expectation.grantee}` does not exist, so it "
                        "holds nothing",
                    )
                continue
            held = effective.get((expectation.target, expectation.grantee), set())
            if expectation.expect_held:
                missing = sorted(wanted - held)
                if missing:
                    verdict(
                        expectation,
                        "FAIL",
                        f"not held after the apply: {', '.join(missing)} "
                        "(has_table_privilege)",
                    )
                else:
                    verdict(expectation, "PASS", "held (has_table_privilege)")
            else:
                still = sorted(wanted & held)
                if still:
                    verdict(
                        expectation,
                        "FAIL",
                        f"STILL HELD after the revoke: {', '.join(still)} "
                        "(has_table_privilege) — the revoke did not take, or a "
                        "PUBLIC grant or role membership re-supplies it",
                    )
                else:
                    verdict(expectation, "PASS", "not held (has_table_privilege)")
            continue

        if expectation.kind == "function":
            row = functions.get(expectation.target)
            overloads = (row or {}).get("overloads") or []
            if not overloads:
                verdict(
                    expectation,
                    "RECORD",
                    "no overload of that routine exists; the missing-function "
                    "check above owns that failure",
                )
                continue
            if len(overloads) > 1 and expectation.expect_held:
                verdict(
                    expectation,
                    "RECORD",
                    f"{len(overloads)} overloads share this name and the grant "
                    "cannot be attributed to one of them without resolving "
                    "argument types, which this module does not do",
                )
                continue
            for overload in overloads:
                identity = overload.get("identity")
                described = f"{expectation.describe()} [{identity}]"

                def overload_verdict(status: str, detail: str) -> None:
                    rows.append((described, status, detail))
                    if status == "FAIL":
                        failures.append(f"{described} — {detail}")

                if overload.get("owner") == expectation.grantee:
                    overload_verdict(
                        "RECORD",
                        f"`{expectation.grantee}` OWNS this routine and holds "
                        "EXECUTE on it regardless of the ACL",
                    )
                    continue
                holders = {str(r) for r in (overload.get("execute_held_by") or [])}
                if "EXECUTE" not in wanted:
                    overload_verdict(
                        "RECORD",
                        "only EXECUTE is assertable on a routine; "
                        f"{', '.join(sorted(wanted))} is not",
                    )
                    continue
                if not expectation.expect_held:
                    # ISSUE #790 POINT 4. `proacl IS NULL` is the DEFAULT ACL,
                    # and for a function the default is EXECUTE TO PUBLIC. It is
                    # precisely the state a MISSING revoke leaves behind, so it
                    # must never read as "no grants, therefore safe".
                    if overload.get("acl_is_default"):
                        overload_verdict(
                            "FAIL",
                            "proacl IS NULL, i.e. the DEFAULT ACL, which for a "
                            "routine is EXECUTE TO PUBLIC. That is the state a "
                            "MISSING revoke leaves behind, not an absence of "
                            "grants — the revoke did not take",
                        )
                        continue
                    if expectation.grantee == "PUBLIC":
                        still_public = "PUBLIC" in _acl_by_grantee(
                            overload.get("acl") or []
                        )
                        if still_public:
                            overload_verdict(
                                "FAIL",
                                "PUBLIC still holds an explicit ACL entry after "
                                "the revoke",
                            )
                        else:
                            overload_verdict("PASS", "PUBLIC holds no ACL entry")
                        continue
                    if expectation.grantee not in probe_roles:
                        overload_verdict(
                            "PASS",
                            f"role `{expectation.grantee}` does not exist, so it "
                            "holds nothing",
                        )
                        continue
                    if expectation.grantee in holders:
                        overload_verdict(
                            "FAIL",
                            "STILL holds EXECUTE after the revoke "
                            "(has_function_privilege) — the revoke did not take, "
                            "or a PUBLIC grant or role membership re-supplies it",
                        )
                    else:
                        overload_verdict(
                            "PASS", "does not hold EXECUTE (has_function_privilege)"
                        )
                    continue
                if expectation.grantee not in probe_roles:
                    overload_verdict(
                        "FAIL",
                        f"role `{expectation.grantee}` does not exist, so it "
                        "cannot hold the granted EXECUTE",
                    )
                elif expectation.grantee in holders or (
                    expectation.grantee == "PUBLIC" and overload.get("acl_is_default")
                ):
                    overload_verdict("PASS", "holds EXECUTE (has_function_privilege)")
                else:
                    overload_verdict(
                        "FAIL", "does NOT hold EXECUTE after the grant"
                    )
            continue

        # default_acl
        schema, defacl_role = expectation.target.split("|")
        row = defacl.get((schema, defacl_role, expectation.objtype))
        if row is None:
            verdict(
                expectation,
                "FAIL",
                "the default-privilege rule was not read back from "
                "pg_default_acl, so nothing was proved about it",
            )
            continue
        if not row.get("role_exists"):
            verdict(
                expectation,
                "FAIL",
                f"role `{defacl_role}` does not exist, so no default-privilege "
                "rule can be keyed on it",
            )
            continue
        if row.get("row_exists"):
            held_map = _acl_by_grantee(row.get("acl") or [])
            source = f"pg_default_acl = `{row.get('acl_text')}`"
        else:
            # NO ROW IS NOT "NO GRANTS". Postgres's built-in default applies, and
            # for functions and types that default hands PUBLIC a privilege.
            held_map = {
                k: set(v)
                for k, v in BUILTIN_DEFAULT_ACL.get(expectation.objtype, {}).items()
            }
            source = (
                "there is NO pg_default_acl row, so Postgres's BUILT-IN default "
                f"applies: {held_map or 'owner only'}"
            )
        held = _effective_for(held_map, expectation.grantee)
        if expectation.expect_held:
            missing = sorted(wanted - held)
            if missing:
                verdict(
                    expectation,
                    "FAIL",
                    f"not in the default privileges: {', '.join(missing)} — {source}",
                )
            else:
                verdict(expectation, "PASS", source)
        else:
            still = sorted(wanted & held)
            if still:
                verdict(
                    expectation,
                    "FAIL",
                    f"STILL in the default privileges: {', '.join(still)} — the "
                    f"revoke did not take. {source}",
                )
            else:
                verdict(expectation, "PASS", source)

    return rows, failures


def render_report(
    allowlist: list[str],
    targets: Targets,
    catalog: object,
    row_counts: object,
    errors: list[str],
    enforcing: bool,
    behavior_checks: list[dict] | None = None,
    behavior_results: object = None,
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

    checks = behavior_checks or []
    add("## Behavioral assertions")
    add("")
    add(
        "These checks come from strict JSON sidecars bound to the SHA-256 of "
        "the migration file. The sidecars contain no SQL; this verifier builds "
        "one read-only SELECT from typed equality filters or fixed, named "
        "catalog contracts owned by the verifier."
    )
    add("")
    add("| check | migration | relation | expected rows | actual rows | verdict |")
    add("| --- | --- | --- | --- | --- | --- |")
    result_rows = {}
    if isinstance(behavior_results, dict):
        raw_rows = behavior_results.get("behavior_checks")
        if isinstance(raw_rows, list):
            for row in raw_rows:
                if isinstance(row, dict) and isinstance(row.get("id"), str):
                    if row["id"] in result_rows:
                        failures.append(f"duplicate behavioral result id: {row['id']}")
                    result_rows[row["id"]] = row
    for check in checks:
        row = result_rows.pop(check["id"], None)
        actual = row.get("actual_count") if isinstance(row, dict) else None
        returned_expected = row.get("expected_count") if isinstance(row, dict) else None
        expected = check["expected_count"]
        passed = (
            isinstance(actual, int)
            and not isinstance(actual, bool)
            and returned_expected == expected
            and actual == expected
        )
        add(
            f"| `{check['id']}` | `{check['migration_version']}` | "
            f"`{check['relation']}` | {expected} | "
            f"{actual if actual is not None else 'MISSING'} | "
            f"**{'PASS' if passed else 'FAIL'}** |"
        )
        if not passed:
            failures.append(
                f"behavioral check {check['id']} expected {expected} row(s) "
                f"but received {actual!r}"
            )
    for unexpected in sorted(result_rows):
        failures.append(f"unexpected behavioral result id: {unexpected}")
    if not checks:
        add("| _no behavioral sidecar for this allowlist_ | | | | | |")
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
        "mixed-case identifiers, or search_path-relative names are NOT listed "
        "and NOT checked. **A short list is not a clean bill of health.** "
        "`alter default privileges` and plain `grant`/`revoke` ARE now read "
        "(issue #790); every statement the lexer could not read is listed under "
        "**unassertable_statements** above rather than dropped."
    )
    add(
        "- Privileges named by a `grant`, a `revoke` or an `alter default "
        "privileges` are now ASSERTED — see _Privilege assertions_ below. "
        "Privileges nobody named, RLS flags, policy counts and row counts remain "
        "EVIDENCE ONLY: the lane has no expected value for them, and inventing "
        "one would block correct promotions."
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

    declaration = targets.noop_declaration
    if declaration is not None:
        add("## Declared no-op")
        add("")
        add(
            f"- Migration `{declaration['version']}` declares itself a pure-data "
            "no-op via a `-- catalog-verification: no-op` line."
        )
        add(f"- Recorded reason: **{declaration['reason']}**")
        if declaration["accepted"]:
            add(
                "- The claim was CHECKED: all "
                f"{declaration.get('statements_checked')} statement(s) in the "
                "file are data statements. No catalog object is expected, so "
                "there is nothing to verify."
            )
        else:
            add(f"- **The claim was REJECTED**: {declaration['rejected_because']}")
        add("")

    if checks:
        # A hash-bound behavioral assertion is real evidence for a data-only
        # migration. Catalog targets from sibling migrations remain intact and
        # are still checked below.
        pass
    elif targets.is_empty() and declaration is not None and declaration["accepted"]:
        # ISSUE #790 POINT 3. A pure-data migration genuinely names no catalog
        # object. That is allowed to pass -- but only with the reason written
        # down in the file, reviewed in the pull request, and reproduced in this
        # artifact, and only after every statement in the file was checked to be
        # data. It is never a silent pass and never a flag on this script.
        pass
    elif targets.is_empty():
        # ISSUE #697 EXISTS BECAUSE A GREEN TICK WAS MISTAKEN FOR EVIDENCE.
        # A run where this step proved nothing must therefore not end green in
        # enforcing mode. `20260810110000` lands exactly here: its only
        # statement outside a `do $$` block is an `alter view`, and before the
        # review fix even that derived nothing. The remedy for a genuinely
        # unverifiable migration is to say so on the issue, not to let the lane
        # report a verification it did not perform.
        detail = (
            f" The file's own no-op declaration was REJECTED: "
            f"{declaration['rejected_because']}."
            if declaration is not None
            else ""
        )
        failures.append(
            "the allowlisted migrations named NO catalog object this lexer can "
            "read, so this step proved nothing. A run that verified nothing must "
            "not report itself green. If the migration really is a pure-data "
            "no-op, say so IN THE MIGRATION with a "
            "`-- catalog-verification: no-op <reason>` line, which is checked "
            "(every statement in the file must be a data statement) and "
            "reproduced in this artifact." + detail
        )

    if (
        declaration is not None
        and not declaration["accepted"]
        and not targets.is_empty()
    ):
        # A file that CLAIMS to be a no-op and is not is a defect in its own
        # right, whatever else the run proved.
        failures.append(
            f"{declaration['version']} declares itself a catalog-verification "
            f"no-op and that claim is false: {declaration['rejected_because']}"
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

    # ---- ISSUE #790: assertions, not just evidence -------------------------
    assertion_rows, assertion_failures = assert_privileges(targets, data)
    failures.extend(assertion_failures)
    add("## Privilege assertions")
    add("")
    add(
        "Derived from the `grant`, `revoke` and `alter default privileges` "
        "statements in the allowlisted files, and asserted against "
        "`relacl` / `proacl` / `pg_default_acl`. **FAIL fails the job in "
        "enforcing mode.** RECORD means the catalog cannot answer the question "
        "asked — the reason is stated in the row, never left blank."
    )
    add("")
    add("| expectation | verdict | detail |")
    add("| --- | --- | --- |")
    if assertion_rows:
        for expectation, status, detail in assertion_rows:
            add(f"| {expectation} | **{status}** | {detail} |")
    else:
        add("| _no grant/revoke/default-privilege statement was derived_ | | |")
    add("")

    add("## Default privileges (`pg_default_acl`)")
    add("")
    add(
        "**A missing row is NOT \"no grants\".** With no row, Postgres's built-in "
        "default applies, and for FUNCTIONS that default is `EXECUTE` to "
        "`PUBLIC` — exactly the state a missing revoke leaves behind."
    )
    add("")
    add("| schema | for role | objtype | row exists | acl |")
    add("| --- | --- | --- | --- | --- |")
    for row in data.get("default_acl") or []:
        add(
            f"| `{row.get('schema')}` | `{row.get('defacl_role')}` | "
            f"`{row.get('objtype')}` | {row.get('row_exists')} | "
            f"`{row.get('acl_text') or 'NULL'}` |"
        )
    add("")

    add("## Schema rename assertions (`pg_namespace`)")
    add("")
    add("| source | destination | source absent | destination present | comment matches |")
    add("| --- | --- | --- | --- | --- |")
    schema_rows = {
        str(row.get("name")): row for row in (data.get("schemas") or [])
        if isinstance(row, dict)
    }
    for source, destination, expected_comment in targets.schema_renames:
        source_row = schema_rows.get(source)
        destination_row = schema_rows.get(destination)
        source_absent = source_row is not None and source_row.get("exists") is False
        destination_present = (
            destination_row is not None and destination_row.get("exists") is True
        )
        comment_matches = (
            expected_comment is None
            or (
                destination_row is not None
                and destination_row.get("comment") == expected_comment
            )
        )
        add(
            f"| `{source}` | `{destination}` | {source_absent} | "
            f"{destination_present} | {comment_matches} |"
        )
        if not source_absent:
            failures.append(
                f"schema rename {source} -> {destination}: source schema must be absent"
            )
        if not destination_present:
            failures.append(
                f"schema rename {source} -> {destination}: destination schema must be present"
            )
        if not comment_matches:
            failures.append(
                f"schema rename {source} -> {destination}: destination comment does not match the migration"
            )
    if not targets.schema_renames:
        add("| _no ALTER SCHEMA RENAME target was derived_ | | | | |")
    add("")

    add("## Indexes (`pg_index` / `pg_get_indexdef`)")
    add("")
    add("| name | expected table | actual table | valid | ready | exact live definition |")
    add("| --- | --- | --- | --- | --- | --- |")
    expected_indexes = {name: relation for name, relation in targets.indexes}
    seen_indexes: set[str] = set()
    for row in data.get("indexes") or []:
        name = row.get("name")
        if isinstance(name, str):
            seen_indexes.add(name)
        expected_relation = expected_indexes.get(str(name))
        actual_relation = row.get("actual_relation")
        definition = row.get("definition")
        add(
            f"| `{name}` | `{expected_relation}` | `{actual_relation or 'NULL'}` | "
            f"{row.get('valid')} | {row.get('ready')} | `{definition or 'NULL'}` |"
        )
        if row.get("exists") is not True:
            failures.append(f"{name}: expected index is missing")
        elif actual_relation != expected_relation:
            failures.append(
                f"{name}: index belongs to {actual_relation!r}, expected {expected_relation!r}"
            )
        elif row.get("valid") is not True or row.get("ready") is not True:
            failures.append(f"{name}: index is not valid and ready")
        elif not isinstance(definition, str) or not definition.strip():
            failures.append(f"{name}: pg_get_indexdef returned no definition")
    for missing_index in sorted(set(expected_indexes) - seen_indexes):
        failures.append(f"{missing_index}: catalog returned no index evidence row")
    if not expected_indexes:
        add("| _no CREATE INDEX target was derived_ | | | | | |")
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
    remote_ledger: Path | None = None,
) -> int:
    remote = (
        parse_remote_versions(remote_ledger)
        if remote_ledger is not None
        else frozenset()
    )
    allowlist = parse_allowlist(raw_allowlist, remote)
    migrations = local_migrations(repo)
    targets = derive_targets(migrations, allowlist)
    behavior_checks = load_behavior_sidecars(repo, migrations, allowlist)

    errors: list[str] = []
    catalog: object = None
    row_counts: object = None
    behavior_results: object = None

    declaration = targets.noop_declaration
    if behavior_checks:
        try:
            behavior_results = extract_report(
                run_query(
                    project_ref, token, build_behavior_sql(behavior_checks), api
                )
            )
        except (urllib.error.URLError, GuardError, ValueError, OSError) as exc:
            errors.append(f"behavioral query failed: {exc}")

    has_catalog_contract = any(
        check.get("kind") == "catalog_contract" for check in behavior_checks
    )
    if targets.is_empty() and behavior_checks and not has_catalog_contract:
        errors.append(
            "the allowlisted migrations named no catalog object, but supplied "
            f"{len(behavior_checks)} hash-bound behavioral assertion(s)."
        )
    elif targets.is_empty() and has_catalog_contract:
        # The strict named contract is the durable verification surface. This
        # is expected for migrations whose permanent DDL is passed as typed
        # text to a guarded helper and whose only directly parsed objects are
        # session-temporary.
        pass
    elif targets.is_empty() and declaration is not None and declaration["accepted"]:
        # ISSUE #790 POINT 3. Not silence: the reason travels into the artifact,
        # the job log and the JSON payload, and it was CHECKED before it counted.
        errors.append(
            "the allowlisted migrations named no catalog object, and "
            f"{declaration['version']} DECLARES itself a pure-data no-op: "
            f"\"{declaration['reason']}\". Every statement in that file was "
            "checked to be a data statement, so there is nothing to verify."
        )
    elif targets.is_empty():
        errors.append(
            "the allowlisted migrations named no catalog object this lexer can "
            "read. That may be legal (a pure-data migration), but it means THIS "
            "STEP PROVED NOTHING, so enforcing mode fails rather than letting a "
            "green tick stand in for evidence it never gathered. A genuine "
            "no-op declares itself in the migration with a "
            "`-- catalog-verification: no-op <reason>` line."
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
                "privilege_expectations": [e.as_dict() for e in targets.privileges],
                "noop_declaration": targets.noop_declaration,
                "catalog": catalog,
                "row_counts": row_counts,
                "behavior_checks": behavior_checks,
                "behavior_results": behavior_results,
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
        allowlist,
        targets,
        catalog,
        row_counts,
        errors,
        enforcing,
        behavior_checks=behavior_checks,
        behavior_results=behavior_results,
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
    parser.add_argument(
        "--remote-ledger",
        type=Path,
        required=True,
        help="production ledger captured before apply, for co-presence rules",
    )
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
            remote_ledger=args.remote_ledger,
        )
    except (GuardError, OSError) as exc:
        print(f"CATALOG VERIFICATION BLOCKED: {exc}", file=sys.stderr)
        return 1

CATEGORY_ORDERLIST_BRIDGE_COVERING_INDEX = """
  (select count(*) = 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_namespace ns on ns.oid = idx.relnamespace
    join pg_class rel on rel.oid = i.indrelid
    join pg_am am on am.oid = idx.relam
    where ns.nspname = 'plm'
      and idx.relname = 'style_tracker_item_bridge_plm_item_cover_idx'
      and rel.oid = to_regclass('plm.style_tracker_item_bridge')
      and am.amname = 'btree'
      and i.indisvalid
      and i.indisready
      and not i.indisunique
      and i.indnkeyatts = 1
      and i.indnatts = 4
      and i.indpred is null
      and i.indexprs is null
      and %s = %s)
  and to_regclass('plm.style_tracker_item_bridge_plm_item_idx') is null
""" % (
    INDEXDEF_NORMALIZE % "pg_get_indexdef(i.indexrelid)",
    INDEXDEF_NORMALIZE % (
        "'CREATE INDEX style_tracker_item_bridge_plm_item_cover_idx"
        " ON plm.style_tracker_item_bridge USING btree (plm_item_id)"
        " INCLUDE (id, style_tracker_row_id, tracker_type)'"
    ),
)
CATALOG_CONTRACTS["orderlist_bridge_covering_index_v1"] = CATEGORY_ORDERLIST_BRIDGE_COVERING_INDEX

# Durable catalog outcome of the single dynamic-execution marker in migration
# 20260830204711 (`execute format('comment on column ...')`, issue #505).
#
# WHY A COMMENT CONTRACT AND NOT A ROW COUNT. That marker's only effect is this
# column comment. The migration also updates two `public.licensors` rows, and it
# is tempting to cite those row counts as the marker's coverage -- but they are
# produced by different statements. Citing them would be a rationale claiming
# coverage it does not have: the row checks would pass with the comment never
# written. The sidecar's row-count checks cover the UPDATEs; this contract covers
# the marker. Each claim is answerable by the thing it names.
#
# The expected text is compared byte-exact against the literal the migration
# declares once as `c_comment`. Editing the migration changes its SHA-256, which
# invalidates the hash-bound sidecar before this contract is ever consulted, so
# the two cannot drift into silent disagreement.
LICENSORS_EXTERNAL_ID_COMMENT = (
    'Canonical licensor code, aligned to core.licensor.code since 2026-08-07 '
    '(owner ruling: change DS to DY at its source). Legacy values DS/WWE were '
    'normalised to DY/WW by issue #505. public.dam_character_catalog still '
    'carries a defensive DS/WWE remap; it is now a no-op and is deliberately '
    'retained as a safety net.'
)
CATEGORY_LICENSORS_EXTERNAL_ID_CANONICAL_COMMENT = """
  (select count(*) = 1
     from pg_description d
     join pg_class c on c.oid = d.objoid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
    where n.nspname = 'public'
      and c.relname = 'licensors'
      and a.attname = 'external_id'
      and d.description = '""" + LICENSORS_EXTERNAL_ID_COMMENT.replace("'", "''") + """')
"""
CATALOG_CONTRACTS["licensors_external_id_canonical_comment_v1"] = (
    CATEGORY_LICENSORS_EXTERNAL_ID_CANONICAL_COMMENT
)


if __name__ == "__main__":
    raise SystemExit(main())
