---
summary: "#6415 preview proof: 84 trigger-function EXECUTE grants revoked, revocable scope census 104->0, 23 platform-owned left as boundary"
kind: proof
status: done
read-when: checking the preview proof for #6415 (revoke anon/authenticated EXECUTE on trigger-returning functions) or Step 6 of plan_database_efficiency_and_api_security.md
---

# #6415 preview proof — trigger-function EXECUTE revocation — 2026-11-16

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 6 / popcre/shared-db #6415 (claim #6432)
**Recorded:** 2026-11-15 8:20 PM EST (census, production) through 2026-11-15 9:4x PM EST (preview proof)
**Session:** MiMo chat ses_ffe5e1ec on edge-dev
**Scope:** the #6415 migration's preview rehearsal and its named proof points. Production was read-only
(Management API `database/query`, `read_only: true`, pattern `scripts/catalog-truth.mjs`). No preview
project ref, no credentials in this artifact (standing rule).

## What the migration does

Revokes `EXECUTE` from `public`, `anon`, `authenticated` on every trigger-returning function
(`prorettype = 'trigger'`) outside `auth`/`extensions` and the platform-owned schemas. The
`PUBLIC` pseudo-role is included because most of these functions carry no explicit role grant —
their ACL is the function default (PUBLIC EXECUTE), so revoking named roles alone is a no-op.

## Census (issue query, live)

**Before — production, 2026-11-15 8:2x PM EST (authoring pin):** 130 trigger-returning functions
outside `auth`/`extensions` carry `anon`/`authenticated` EXECUTE. Split: **104 revocable**
(`app` 2, `coldlion` 1, `core` 1, `crm` 2, `dflow_prod` 26, `plm` 46, `public` 23,
`temp_status_watch` 3) and **26 platform-owned** (`pg_catalog` 17, `storage` 6, `realtime` 1,
`cron` 1, `repack` 1). (The issue pinned 133 on 2026-11-15; the list moves, as its body warns.)

**Apply on preview** (governed lane run 43789639543, 2026-11-16T02:05:08Z, migration then named
`20261116013153`, since renamed `20261116124001` for Guard B — see "Version rename" below):

```
NOTICE: revoked EXECUTE on 84 trigger function(s) in revocable scope
NOTICE: platform-owned trigger functions left untouched (accepted boundary): 23
```

(Preview holds 84 revocable + 23 platform, not production's 104 + 26 — preview drifts from
production; the predicate, not the count, is the scope.)

**After — preview census (same query):** revocable scope returns **0 rows**. The full query
returns only the platform residual: 23 rows (`pg_catalog` 17, `storage` 3, `cron` 1, `realtime` 1,
`repack` 1).

## Platform boundary (why 23/26 stay)

`pg_catalog`, `storage`, `realtime`, `cron`, `repack` function owners are `supabase_admin` /
`supabase_storage_admin` / `supabase_realtime_admin`. The migration role is `postgres`
(`rolsuper = false`, not a member of `supabase_admin` — read-only verified 2026-11-15), so a
`REVOKE` there is refused (`must be owner of function`). The Prime Directive keeps this repo out
of vendor/platform objects. None of those schemas is in `pgrst.db_schemas` (live 2026-11-15:
`public, graphql_public, api, crm, pim, core, app`), so there is no Data API RPC surface there.
Acceptance deviation from the issue's "census returns 0": **0 within the revocable scope**;
the named platform residual is an explicit boundary, not a silent drop.

## Negative control (Data API, preview)

Trigger functions can only be invoked by a trigger (`prorettype = trigger`), so an RPC cannot do
useful work before or after; the point is that the PostgREST surface closes.

| probe | anon (publishable key) | authenticated |
|---|---|---|
| `POST /rest/v1/rpc/set_assets_updated_at` (revoked) | **404** | not obtained (see limitation) |
| `POST /rest/v1/rpc/update_updated_at_column` (revoked) | **404** | not obtained |
| `POST /rest/v1/rpc/no_such_function_xyz_6415` (control) | **404** | not obtained |

Status codes only; no row contents. The 404 is identical to the non-existent-function control:
the revoked trigger functions are not in the role's exposed relation set.

**Limitation (tooling, not change gap):** the `authenticated` HTTP leg could not be obtained on
preview — the 1Password preview test logins fail `invalid_credentials` against the current preview
project (they pin an older project ref), the admin fixture-create returned 500, and a minted JWT
is rejected at the auth layer (the item's JWT secret appears stale). The catalog proof covers the
role: `has_function_privilege('authenticated'|'anon', f, 'EXECUTE')` is **false** for every
in-scope function (the after-census predicate is exactly that), and PostgREST's exposed set for a
role is that same privilege.

## Contract tests

The PR's CI (`database-contract-tests.yml`, trigger-covered contracts incl.
`dam_order_list_contract.sql`, `opa_property_character_landing_contracts.sql`) is the trigger-firing
proof: a revoked role EXECUTE grant does not affect trigger invocation (checked at CREATE TRIGGER
time, not at fire time). PR check results are recorded on PR #6433.

## Version rename (Guard B)

The migration was first authored as `20261116013153` (reserved via
`check-dispatch-collision.mjs --reserve-version`) and rehearsed on preview under that version
(run 43789639543, NOTICEs above). While the PR was open, `origin/main` gained future-dated
versions through `20261116124000`, so Guard B ("a new migration may not be backdated behind the
base branch") refused `20261116013153`. The file was `git mv`-renamed to `20261116124001`
(reserved the same way; the old reservation is burned and never reused). Preview's ledger
therefore holds the rehearsal row `20261116013153` as a preview-only orphan of the pre-rename
version — the `preview-ledger-orphan-reconciliation` workflow's named class; production sees only
`20261116124001`. The renamed migration re-applies idempotently (the loop revokes what matches;
nothing remains).
