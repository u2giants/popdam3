# AI tagging keyset timeout remediation

Date: 2026-07-14

Migrations:

- `20260714180000_ai_tagging_keyset_candidates.sql`
- `20260714180100_fix_ai_tag_candidate_tier_type.sql` (preview-rehearsal type correction)

Status: database contract promoted to production and PopDAM caller merged. This
note is the canonical adoption and verification record for every application
using Supabase project `qsllyeztdwjgirsysgai`.

## Why this changed

PopDAM's `ai-tag-untagged` worker repeatedly timed out at offset 60. Production
stage probes proved the candidate read timed out at about 8.0 seconds both with
and without the old JavaScript smart-skip exclusion. Its exact hot-path count
also timed out at about 8.0 seconds. The query plan scanned roughly 119,000 live
assets through `idx_assets_is_deleted`, filtered and anti-joined afterward, then
sorted before applying the offset. The model, thumbnail fetch, and tag writes
had not started for the failing page.

## Database contract

```sql
public.get_ai_tag_candidates(
  p_mode text,
  p_limit integer,
  p_after_tier integer default null,
  p_after_id uuid default null,
  p_group_ids uuid[] default null
)
```

The result is ordered by `(primary_sort_tier, id)` and returns `id`,
`thumbnail_url`, `filename`, `relative_path`, `style_group_id`, and
`primary_sort_tier`. `p_mode` is `untagged` or `all`; limits are clamped to
`1..200`; cursor tier and ID must be supplied together. An empty `p_group_ids`
array is unscoped. Only `service_role` can execute the function.

Example first and next pages:

```sql
select * from public.get_ai_tag_candidates('untagged', 50);

select * from public.get_ai_tag_candidates(
  'untagged', 50, 2, '00000000-0000-0000-0000-000000000001'::uuid
);
```

Callers must treat the application cursor as opaque. PopDAM encodes the final
row as `ai1:<tier>:<uuid>` and sends the decoded fields on the next call.

Compatibility smart-skip behavior is intentional: an unscoped untagged call
excludes a group once an AI-tagged representative exists, but may return
multiple currently untagged members before that happens. Null-group assets stay
eligible. Group-scoped and `all` calls preserve the previous all-status behavior.

## Indexes

- `idx_assets_ai_tag_untagged_candidates` accelerates the exact untagged
  predicate and `(primary_sort_tier, id)` order.
- `idx_assets_ai_tag_all_candidates` accelerates all/group candidate paging.
- `idx_assets_ai_tag_tagged_groups` accelerates smart-skip anti-existence checks.

These are DAM-specific indexes. Do not copy them to CRM, PM/PIM, or PLM tables.
Build each app's index from measured filters, ordering, cardinality, and
representative `EXPLAIN (ANALYZE, BUFFERS)` evidence.

## Rollout record

| Gate | Status | Evidence |
|---|---|---|
| Shared-db PR | Passed | [PR #64](https://github.com/u2giants/shared-db/pull/64), merged as `fadebce` |
| Preview dry-run/apply | Passed | Both migrations applied 2026-07-14 via the canonical non-pooling preview URL |
| Preview correctness/roles | Passed | 120k rollback-only fixture; limit clamp 200, null groups eligible, zero tagged-group leaks, explicit group scope, invalid mode/half-cursor rejected; only `service_role` can execute |
| Preview plans/latency | Passed | First page 55 ms, deep page 61 ms; underlying page used `idx_assets_ai_tag_untagged_candidates`, no sort/offset, 2.5 ms execution |
| Production apply | Passed | RPC plus all three indexes verified live on `qsllyeztdwjgirsysgai` at 2026-07-14 16:46 UTC |
| Production plans/latency | Passed | With `statement_timeout = '8s'`, first 50-row untagged page completed in 19.834 ms and the next 50-row keyset page in 16.746 ms |
| PopDAM caller adoption | Passed | Caller merged in `6e7d289`; Railway build-context fixes landed in `280b9f5` and `9181891`; worker `1.4.3` deployed successfully. Worker tests/build, exact Docker build/startup, frontend cursor tests, and GitHub CI passed. |

Rollback is additive and migration-based: stop the worker, revert the PopDAM
caller if needed, and leave the RPC/indexes in place unless they are proven
harmful. If database rollback is necessary, add a new migration that revokes and
drops this function and only these three indexes. Never edit an applied migration.

## Automatic benefit versus required adoption

Every application on the shared project automatically receives shorter PopDAM
statements, more shared CPU/I/O/connection headroom, the indexes, and this
mirrored note. Other applications do not automatically receive rewritten
queries, cursors, indexes for unrelated tables, DAM permissions, or DAM search.

Each app team must audit high-volume list and search paths for `.range()`, SQL
`OFFSET`, Sequelize `offset`/`findAndCountAll`, `count: "exact"`, broad selects,
client-side filtering, nonunique ordering, and `%term%` search. For each risky
query, record rows scanned/returned, representative plans, p50/p95/p99, exact
count UX need, a deterministic keyset, RLS behavior, and rollback ownership.

Recommended shared standard:

- Use bounded keyset pages ordered by a stable unique tuple such as
  `(updated_at, id)`.
- Keep cursors opaque and versioned.
- Separate list data from optional counts; a count failure must not blank a list.
- Put complex browser reads behind explicit `api.*` views/RPCs with narrow grants.
- Select only required columns and prove query-shaped indexes with plans.
- Make bulk work bounded, idempotent, checkpointed, and resumable.
- Report query stage and PostgreSQL error code; do not raise global
  `statement_timeout` to conceal a bad access path.

## Application guidance and tracking

| Consumer | Automatic benefit | Audit/action | Preview tested | Production verified |
|---|---|---|---|---|
| PopDAM | Pending verification | Adopt this RPC; remove offset, prefetch, and exact count | Pending | Pending |
| PM/PIM | Shared headroom and mirrored contract | Audit Supabase ranges, grids, joins, and exact totals | Pending | Pending |
| CRM | Shared headroom and mirrored contract | Audit segments, timelines, feeds, and tab counts; prefer existing bounded CRM RPCs | Pending | Pending |
| DesignFlow PLM | Shared headroom and mirrored contract | Audit Sequelize offsets, `findAndCountAll`, and nonunique list sorts | Pending | Pending |

The persistent preview branch normally contains zero assets. Performance and
correctness evidence therefore used 120,000 synthetic assets and 1,000 style
groups inside a single transaction with triggers disabled; the transaction was
rolled back and `public.assets` was confirmed empty afterward. The first
rehearsal exposed a strict `smallint`-versus-`integer` return mismatch, which is
why the immutable corrective migration `20260714180100` exists.

PM/PIM and CRM changes follow their `main` workflows after any needed shared-db
contract is in production. DesignFlow changes go to `sandbox-albert` with a PR
to `develop` for Uma's review. This remediation does not edit those app repos.

## Search adoption

This candidate RPC is not a general search API. Apps needing authorized DAM
discovery should call a purpose-specific cross-app `api.*` contract from their
backend/BFF, which may project minimal permitted results from DAM search
contracts such as `search_dam_documents`. Never expose a service-role key in a
frontend or grant CRM/PM/PLM access to this private worker RPC.

For each app's own search, reuse the pattern rather than the DAM corpus: a
domain-owned normalized document/view, measured lexical indexes, optional
embeddings only when useful, bounded ranked RPCs, deterministic cursors, and
domain-specific RLS. Do not create a single global corpus across confidential
CRM, PLM, PM, and DAM data without a separately designed authorization model.
