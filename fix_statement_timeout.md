# AI Tagging Statement-Timeout Remediation Plan

Date: 2026-07-14

Status: implemented 2026-07-14. Shared-db PR #64 is merged and migrations
`20260714180000` / `20260714180100` are applied to preview and production.
PopDAM worker/UI implementation and deployment evidence are recorded in
`HANDOFF.md` and the canonical shared-db adoption note.

Owners:

- Shared database work: canonical `/worksp/shared-db`
- PopDAM Railway worker and admin UI: `/worksp/popdam`
- Cross-application adoption: dflow PLM, PM/PIM, and CRM application owners

Related plan: [`fix_SEARCH_PIPELINE_PLAN.md`](fix_SEARCH_PIPELINE_PLAN.md). That
document addresses the quality and completeness of DAM search. This plan is
narrower: it removes the proven AI-tagging database timeout, makes bulk jobs
resumable and observable, and defines the reusable database-access conventions
that the other applications on the shared Supabase project should adopt.

---

## 1. Executive decision

The fix must be delivered as a coordinated database-and-worker change.

The database portion will add query-shaped partial indexes and a stable,
read-only RPC that returns AI-tag candidates using keyset pagination. The worker
will stop issuing offset-based table queries, stop running an exact count in the
hot path, store an opaque resumable cursor, and report the exact database stage
that failed. The UI will stop describing every PostgreSQL statement timeout as
a database *write* timeout.

The database changes improve the shared Supabase project immediately for any
caller whose query matches the new indexes or calls the new RPC. They do not,
by themselves, rewrite PLM, PM, or CRM queries. Those applications benefit from
shared infrastructure, but each must deliberately adopt keyset pagination,
bounded counts, app-facing RPCs/views, and query-shaped indexes for its own
tables.

Do not solve this by increasing `statement_timeout`. The production query plan
is structurally inefficient; a larger timeout only lets it consume resources
for longer and makes concurrent application latency less predictable.

---

## 2. Definitive incident findings

### 2.1 Production operation state

The live Virginia Supabase project is `qsllyeztdwjgirsysgai`. The canonical
`admin_config.BULK_OPERATIONS` state for `ai-tag-untagged` showed:

```json
{
  "status": "interrupted",
  "cursor": 60,
  "run_id": "j7ds0iluzed",
  "progress": {
    "total": 7,
    "tagged": 60,
    "skipped": 0,
    "failed": 0
  },
  "error": "canceling statement due to statement timeout",
  "interruption_reason_code": "statement_timeout",
  "auto_resume_attempts": 10
}
```

The operation therefore did real work: it tagged 60 assets, resumed ten times,
and repeatedly failed at the same cursor. The `0 / 5` display in the screenshot
was not the canonical operation state and must not be used as incident evidence.

### 2.2 Query-stage isolation

The worker stages were tested independently against production with an 8-second
statement timeout:

| Stage | Result | Meaning |
|---|---:|---|
| Smart-skip tagged-group prefetch | about 740 ms | Not the statement that stopped this run |
| Candidate select at offset 60, without exclusions | timed out at about 8.004 s | Proven failure stage |
| Candidate select at offset 60, with the worker's exclusions | timed out at about 8.010 s | Smart-skip list does not repair the plan |
| Exact candidate count | timed out at about 8.007 s | A second independent timeout hazard |

The timeout occurred before image download, OpenRouter inference, and per-asset
tag writes for the next batch. It was a slow candidate **read**, not an AI model
failure and not a tag write failure.

### 2.3 Production query plan

`EXPLAIN` for the candidate query showed this shape:

```text
Limit
  -> Sort (primary_sort_tier, id)
       -> Hash Anti Join
            -> Bitmap Heap Scan on assets
                 Bitmap Index Scan on idx_assets_is_deleted
```

The database was using the broad `is_deleted` index, rechecking roughly 119,000
live rows, applying the thumbnail/status/tier filters afterward, anti-joining
smart-skip groups, and sorting the survivors before applying the offset and
limit. No production index matched the complete filter and order shape.

The exact problematic worker code is in
`apps/worker/src/handlers/ai-tagging.ts`:

- Lines 330-344 fetch a capped, nondeterministic sample of tagged groups.
- Lines 346-368 build the candidate query and use `.range(offset, end)`.
- Lines 433-447 run an exact count in the first batch.
- Line 458 advances the offset by the number of returned rows.

The generic operation loop adds two compatibility constraints:

- `apps/worker/src/types.ts` currently permits only numeric or string cursors.
- `apps/worker/src/operation-loop.ts` currently auto-resumes only numeric
  cursors, even though other handlers already use string cursors.

The UI label in `src/components/settings/diagnostics/types.ts` says
`Database write timed out`, but the classifier has no evidence that the timed
out statement was a write.

---

## 3. Target behavior and invariants

After this work:

1. Fetching the next candidate page has runtime proportional to page size, not
   to the number of rows before an offset.
2. Every committed page has a durable cursor that can resume after a deploy,
   worker crash, transient network failure, or statement timeout.
3. Replaying a page cannot corrupt data. At worst, an idempotent asset is
   reconsidered and then skipped or safely re-tagged according to operation
   mode.
4. Candidate discovery does not run an exact count in the hot path.
5. Smart-skip is complete and deterministic; it is not based on the first 1,000
   database rows or a JavaScript-generated `NOT IN` string.
6. The admin UI identifies `candidate_fetch`, `progress_count`,
   `asset_fetch`, `tag_write`, or another known stage when possible.
7. `statement_timeout` remains a guardrail. Performance comes from access-path
   design, bounded work, and resumability.
8. Database contracts land in canonical `shared-db`, pass preview verification,
   and are promoted before dependent worker code is deployed.
9. Existing ID-targeted retagging remains a separate fast path and does not need
   a database cursor.

---

## 4. Proposed database contract

All SQL in this section must be authored as a new timestamped migration in
`/worksp/shared-db/supabase/migrations/`. Do not add it to PopDAM's historical
`supabase/migrations/` directory and do not run it through the Supabase
Dashboard.

### 4.1 Candidate RPC

Create a read-only function with a stable app-facing signature. Recommended
name:

```sql
public.get_ai_tag_candidates(
  p_mode text,
  p_limit integer,
  p_after_tier integer default null,
  p_after_id uuid default null,
  p_group_ids uuid[] default null
)
```

Recommended return columns:

```text
id uuid
thumbnail_url text
filename text
relative_path text
style_group_id uuid
primary_sort_tier integer
```

Contract rules:

- `p_mode` accepts an explicit allow-list such as `untagged` and `all`.
- Clamp `p_limit` in SQL, for example to `1..200`, regardless of caller input.
- Reject a half cursor: tier and ID must both be null or both be present.
- Apply the invariant filters in SQL:
  `is_deleted = false`, `thumbnail_url is not null`, and
  `primary_sort_tier not in (4, 8)`.
- For `untagged`, apply the same status semantics as production currently uses.
  Decide explicitly whether null status is excluded; do not let SQL null
  behavior make this accidental.
- For `all`, do not filter on tagging status.
- If `p_group_ids` is nonempty, filter with
  `style_group_id = any(p_group_ids)`.
- Order only by `(primary_sort_tier asc, id asc)`.
- Continue with the row-value predicate:

  ```sql
  (primary_sort_tier, id) > (p_after_tier, p_after_id)
  ```

- Return at most `p_limit` rows. The worker derives the next cursor from the
  final returned row. An empty result means completion.
- Use `security invoker` unless preview testing proves a narrowly scoped
  `security definer` function is required. Set `search_path` explicitly either
  way.
- Grant execution only to the roles that need it. The Railway worker uses the
  service role; do not broaden browser access merely for convenience.
- Add `comment on function` documenting mode, ordering, cursor semantics, and
  the fact that the cursor is opaque to UI callers.

The first implementation should be a read-only page function, not a row-locking
claim queue. PopDAM currently serializes AI operations into one worker lane, and
AI inference lasts far longer than a sensible database transaction. Holding row
locks through inference would be wrong. If multiple independent tagging workers
are introduced later, add an explicit lease table with `leased_until`, owner,
attempt count, and `FOR UPDATE SKIP LOCKED`; do not stretch this read RPC into a
long transaction.

### 4.2 Smart-skip in SQL

Remove the 1,000-row tagged-group prefetch and the JavaScript `NOT IN` list.
For untagged, non-group-scoped runs, express smart-skip as a correlated
anti-existence test:

```sql
not exists (
  select 1
  from public.assets tagged
  where tagged.style_group_id = candidate.style_group_id
    and tagged.is_deleted = false
    and tagged.status = 'tagged'
    and tagged.ai_tagged_at is not null
)
```

Assets with a null `style_group_id` must remain eligible. Write this explicitly,
for example `candidate.style_group_id is null or not exists (...)`, and add a
test for it.

Before implementation, confirm the product rule for multiple untagged assets in
the same group:

- Compatibility behavior: the RPC may return multiple untagged members of a
  group until one becomes tagged.
- Recommended behavior: select one deterministic representative per group and
  rely on tag propagation for the other members.

The recommended behavior reduces AI spend and duplicate work, but it changes
semantics and must not be slipped into a performance migration without a
fixture-based test and owner sign-off. The timeout fix can ship first with
compatibility behavior.

### 4.3 Query-shaped indexes

Create indexes that match predicates and ordering. Final definitions must be
chosen from preview `EXPLAIN (ANALYZE, BUFFERS)` evidence, but the starting
design is:

```sql
create index concurrently if not exists idx_assets_ai_tag_untagged_candidates
on public.assets (primary_sort_tier, id)
include (thumbnail_url, filename, relative_path, style_group_id)
where is_deleted = false
  and thumbnail_url is not null
  and primary_sort_tier not in (4, 8)
  and status <> 'tagged';

create index concurrently if not exists idx_assets_ai_tag_all_candidates
on public.assets (primary_sort_tier, id)
include (thumbnail_url, filename, relative_path, style_group_id)
where is_deleted = false
  and thumbnail_url is not null
  and primary_sort_tier not in (4, 8);

create index concurrently if not exists idx_assets_ai_tag_tagged_groups
on public.assets (style_group_id)
where is_deleted = false
  and status = 'tagged'
  and ai_tagged_at is not null
  and style_group_id is not null;
```

Important implementation notes:

- Supabase migrations run transactionally in some workflows, while PostgreSQL
  forbids `CREATE INDEX CONCURRENTLY` inside a transaction. Follow an existing
  canonical shared-db precedent and verify the CLI execution model before
  choosing concurrent versus ordinary index creation.
- If ordinary index creation is required, measure preview build time and schedule
  the production migration in an approved low-traffic window.
- A separate group-scoped index beginning with `style_group_id` may help
  `p_group_ids`, but add it only if preview plans show a material need:
  `(style_group_id, primary_sort_tier, id)` with the common partial predicate.
- `INCLUDE` columns trade storage and write amplification for index-only reads.
  Confirm heap-fetch and index-size evidence; remove included columns that do
  not improve the plan.
- If the application can replace `status <> 'tagged'` with a small explicit set
  of eligible statuses, prefer the explicit set. It is clearer around nulls and
  makes the partial-index predicate more intentional.
- Do not drop the broad existing indexes in this change. They may serve unrelated
  applications, and removal requires a separate usage audit.

### 4.4 Counts and progress

Remove `count: "exact"` from the AI-tagging hot path. It already timed out in
the isolated production probe.

Use this progress model initially:

- `processed = tagged + skipped + failed`
- total is unknown while running
- UI shows an indeterminate progress bar and throughput
- completion is defined by an empty candidate page, not `processed >= total`

If a total is required later, create a separate, explicitly optional RPC backed
by a matching index or a maintained stats table. A count failure must never stop
tagging. Store `total_is_estimate: true` when using planner estimates or cached
statistics so the UI does not present false precision.

Do not compute a smart-skip-aware exact total before every run. That duplicates
the expensive anti-join and races with the worker as statuses change.

---

## 5. Worker implementation

### 5.1 Opaque cursor format

Keep the generic operation-state cursor as `number | string` for now and encode
the AI keyset as a versioned string, for example:

```text
ai1:<primary_sort_tier>:<asset_uuid>
```

Add dedicated helpers in the AI-tagging handler or a small worker utility:

```ts
type AiTagCursor = { tier: number; id: string };

function encodeAiTagCursor(cursor: AiTagCursor): string;
function decodeAiTagCursor(raw: string | number | undefined): AiTagCursor | null;
```

Decoder requirements:

- Accept only the current version prefix.
- Validate the tier as a safe integer and ID as a UUID.
- Treat numeric `0` as a new run for backward compatibility.
- Do not silently treat a positive legacy numeric offset as a keyset cursor.
- Return a clear `legacy_cursor` interruption requiring restart when a positive
  offset belongs to `ai-tag-all`.
- For `ai-tag-untagged`, restarting from the beginning is data-safe because
  newly tagged rows are no longer eligible, but the rollout should still reset
  the stale operation explicitly so behavior is visible and auditable.

An opaque string avoids widening every edge-function and frontend type to a
cursor object. The UI may display the number processed; it must not parse the
cursor.

### 5.2 Replace candidate discovery

In `apps/worker/src/handlers/ai-tagging.ts`:

1. Keep the `asset_ids` fast path unchanged.
2. Delete the tagged-group prefetch and generated `NOT IN` clause.
3. Decode the keyset cursor.
4. Call `get_ai_tag_candidates` with mode, bounded batch size, decoded tier/ID,
   and optional group IDs.
5. If the RPC errors, return a structured batch failure with
   `error_stage: "candidate_fetch"` and preserve the current cursor.
6. Process the returned assets with the existing bounded concurrency.
7. After the whole page settles, derive the next cursor from the final candidate
   row, not the final successfully tagged row. This prevents one permanently
   failing asset from trapping the operation on the same page.
8. Persist progress and the new cursor after every page through the existing
   operation loop.
9. Mark done when fewer than the requested limit are returned, or conservatively
   request once more and mark done only on an empty page. The latter avoids a
   race where concurrent inserts make a short page appear terminal.
10. Delete the exact-count query. Allow a separately fetched estimate to enrich
    progress later, but never make it a batch prerequisite.

### 5.3 Error-stage metadata

Extend `BatchResult` and `OpState` with optional, bounded metadata:

```ts
type OperationStage =
  | "candidate_fetch"
  | "progress_count"
  | "asset_fetch"
  | "image_fetch"
  | "model_inference"
  | "tag_write"
  | "state_persist";

last_stage?: OperationStage;
last_stage_started_at?: string;
last_successful_cursor?: string | number;
```

Do not put raw SQL, service-role tokens, image URLs with signatures, full model
responses, or unbounded error arrays into `admin_config`.

The operation loop should persist `last_stage` on interruption and clear stale
error metadata after a successful batch. Logging should include operation key,
run ID, stage, batch size, cursor version, elapsed milliseconds, and PostgreSQL
error code when available.

### 5.4 Auto-resume and backoff

Update `apps/worker/src/operation-loop.ts` so valid string cursors can
auto-resume. Do not change the condition to accept arbitrary strings; use an
operation-aware cursor validator or at minimum accept nonempty strings only for
handlers known to support them.

Replace rapid identical retries with bounded exponential backoff plus jitter,
for example 15 seconds, 30 seconds, 1 minute, 2 minutes, then 5 minutes. Persist
`next_auto_resume_at` so a worker restart does not reset the delay.

For `candidate_fetch` statement timeouts only:

- first retry with the configured page size
- then reduce page size, for example 50 -> 25 -> 10
- never reduce below a documented floor
- restore the default on a new operation
- stop after the existing bounded attempt count and show the exact stage

Page-size reduction is a resilience fallback, not the main performance fix. A
correct index/keyset plan should make 50 rows cheap.

Do not automatically retry nontransient errors such as invalid cursor,
permission denied, undefined function, invalid mode, or schema mismatch.

### 5.5 Operation-state consistency

`admin_config.BULK_OPERATIONS` is a shared JSON document. Preserve the current
conditional persistence behavior that avoids overwriting a user stop, and test
concurrent updates to different operation keys.

If lost updates remain possible because the implementation reads and rewrites
the whole JSON value, schedule a follow-up shared-db RPC that atomically patches
one operation key. Do not broaden this timeout migration unless a test proves
that state loss blocks the AI-tagging rollout.

---

## 6. Admin UI changes

Update the diagnostics UI after the worker contract is available:

- Change `statement_timeout` from `Database write timed out` to
  `Database query timed out`.
- If `last_stage` is present, render a more precise message such as
  `Candidate lookup timed out` or `Tag save timed out`.
- Show processed count even when total is unknown.
- Use an indeterminate progress treatment when no trustworthy total exists.
- Continue showing tagged, skipped, and failed counts.
- Show auto-resume attempt count and next retry time when scheduled.
- Permit resume for valid string cursors; do not gate resumability on
  `typeof cursor === "number"`.
- Never expose or ask the user to edit the opaque cursor.
- On a legacy positive numeric cursor, offer `Restart safely` for untagged mode
  and an explicit restart warning for tag-all mode.

The UI should describe observed state, not infer that a PostgreSQL cancellation
was a write, a model failure, or a network failure.

---

## 7. Implementation sequence

### Phase 0 - Baseline and fixture capture

Repositories:

- `/worksp/popdam` read-only
- `/worksp/shared-db` read-only

Actions:

1. Confirm both worktree statuses and preserve unrelated changes.
2. Record the current production operation state and sanitized `EXPLAIN` output
   in the eventual shared-db migration note.
3. Capture representative candidate cases in test fixtures: ungrouped asset,
   group with no tagged member, group with a tagged member, excluded tier,
   deleted asset, missing thumbnail, tagged asset, and null status.
4. Record baseline latency for first page, a page after cursor 60, a deep page,
   smart-skip mode, tag-all mode, and group-scoped mode.

Exit criteria: the incident is reproducible and expected candidate IDs for the
fixture set are agreed.

### Phase 1 - Shared-db branch and migration

Repository: `/worksp/shared-db`

Actions:

1. Start from clean `main` and create a dedicated `codex/...` branch.
2. Add one timestamped migration containing the candidate RPC, grants/comments,
   and evidence-supported indexes.
3. Add SQL contract tests or a repeatable verification script using the fixture
   cases.
4. Add an app migration note under
   `docs/app-migration-notes/ai-tagging-keyset-timeout-20260714.md`.
5. Run `bash scripts/check-sql.sh` and the repository's required checks.
6. Link to the preview project and run `supabase db push --dry-run`.
7. Apply to preview project `xjcyeuvzkhtzsheknaiu`.
8. Verify result correctness, role permissions, query plans, index usage, and
   latency at first/deep cursors.
9. Open the shared-db PR, include before/after plans and affected-app matrix,
   satisfy the shared-db merge checklist, and merge it.
10. Promote to production only in an approved window and verify live plans.

Exit criteria: production exposes the backward-compatible new RPC, old callers
are unaffected, and the candidate page remains comfortably below the statement
timeout at deep cursors.

### Phase 2 - Worker adoption

Repository: `/worksp/popdam`

Actions:

1. Add cursor encode/decode tests.
2. Switch AI candidate fetch to the new RPC.
3. Remove offset pagination, capped smart-skip prefetch, JavaScript `NOT IN`,
   and exact hot-path count.
4. Add stage metadata and operation-aware string-cursor auto-resume.
5. Add bounded retry/backoff and adaptive page-size fallback.
6. Add handler tests for empty page, one page, multiple pages, one failed asset,
   resume, malformed cursor, transient RPC timeout, and group-scoped mode.
7. Run worker typecheck/tests and root tests that cover operation state.
8. Before deployment, ensure no old `ai-tag-all` run is active. Reset the stale
   `ai-tag-untagged` operation through the normal admin operation path.
9. Commit to PopDAM `main`; Railway will deploy `apps/worker/` automatically.
10. Verify Railway build/deploy and run a small production untagged batch.

Exit criteria: the worker completes across multiple pages, a forced restart
resumes from the keyset cursor, and no candidate/count statement timeout occurs.

### Phase 3 - Admin diagnostics

Repository: `/worksp/popdam`

Actions:

1. Update shared frontend operation types for string cursors and stage fields.
2. Correct timeout wording and add stage-specific rendering.
3. Support unknown totals and string-cursor resume.
4. Add UI tests for running/unknown-total, interrupted/candidate-fetch,
   scheduled retry, exhausted retry, and legacy cursor states.
5. Run root tests, lint, typecheck, and production build.
6. Push to `main`, verify frontend publishing separately from the Railway
   deployment badge, and confirm the live build SHA.

Exit criteria: live diagnostics accurately report what is happening and offer a
safe recovery action.

### Phase 4 - Production soak

Actions:

1. Run `ai-tag-untagged` on a bounded, observable scope first.
2. Confirm page-fetch p50/p95/p99, rows per page, and index usage.
3. Interrupt the worker once after a committed page and verify exact resume.
4. Run through the old cursor-60 failure region and then a materially deeper
   cursor.
5. Watch Supabase database CPU, I/O, active statements, lock waits, and API
   latency for other applications.
6. Confirm tagged/failed counts match sampled database state.
7. Leave the old table-query path removed; do not retain a silent fallback that
   can recreate the timeout.

Exit criteria: at least one representative production operation completes, no
statement timeout occurs, and shared-project latency does not regress.

---

## 8. Verification matrix

### 8.1 SQL correctness

Verify all of these in preview:

| Case | Expected result |
|---|---|
| First page, untagged | Ordered eligible rows only |
| Next page from final row | No duplicate from prior page |
| Reuse same cursor | Same deterministic next page, absent concurrent changes |
| Candidate becomes tagged between pages | It disappears safely from untagged mode |
| New lower-key row appears behind cursor | Not included in this run; eligible next run |
| New higher-key row appears ahead of cursor | May be included in current run |
| Null group | Remains eligible |
| Group with tagged representative | Excluded only when smart-skip applies |
| Explicit group IDs | Only requested groups returned |
| Tag-all | Status does not filter candidates |
| Tier 4 or 8 | Excluded |
| Deleted/no-thumbnail | Excluded |
| Invalid mode/limit/cursor | Clean bounded error |
| Browser role | Cannot call service-only RPC unless intentionally granted |

### 8.2 Query-plan performance

For every mode, use `EXPLAIN (ANALYZE, BUFFERS)` and require:

- no offset node
- index scan or index-only scan using a candidate index where appropriate
- no full sort over the live assets table
- no scan of roughly all nondeleted assets for a 50-row page
- stable runtime at deep cursors
- bounded shared-buffer reads

Set a concrete preview target after baseline capture. A reasonable initial gate
is candidate-page p95 below 500 ms and no tested page above 2 seconds, leaving
substantial room below the production statement timeout. Do not accept the
target without also inspecting the plan; a warm-cache fast sequential scan is
not proof of a scalable access path.

### 8.3 Worker tests

Required automated cases:

- cursor encode/decode round trip
- malformed/version-unknown cursor rejection
- positive legacy offset handling by operation mode
- cursor advances past failed assets
- operation resumes after process restart
- candidate timeout persists current cursor and stage
- retry backoff survives worker restart
- page size reduces only for eligible transient fetch failures
- exact count is never called by the handler
- asset ID fast path still works
- completion on empty page
- stop request is not overwritten by a later batch persist

### 8.4 End-to-end evidence

Record in the shared-db migration note and PopDAM handoff:

- migration and PR URL
- preview and production apply timestamps
- before/after `EXPLAIN` summaries
- before/after candidate latency
- worker commit/deploy SHA
- frontend commit/live SHA
- operation run ID used for production proof
- final tagged/skipped/failed counts
- any remaining index-size or write-amplification concern

---

## 9. Rollout and rollback

Rollout order is mandatory:

```text
shared-db preview -> shared-db production -> worker -> frontend diagnostics
```

The RPC and indexes are additive, so the old worker can continue running between
database and worker deployment. Do not deploy the new worker before production
has the RPC.

Rollback order:

1. Stop the active AI operation through the UI.
2. Revert the PopDAM worker commit if the new handler is faulty.
3. Leave additive indexes/RPC in place while investigating unless they are
   proven to harm shared-project performance.
4. If a database rollback is required, create a new shared-db migration that
   revokes/drops the RPC and drops only the new indexes. Never edit or delete the
   applied migration.
5. Re-run shared-app smoke checks after any index removal.

Do not roll back by raising/lowering global timeouts, running ad hoc Dashboard
SQL, or editing the vendored `shared-db/` copies in application repositories.

---

## 10. Cross-application adoption: PLM, PM/PIM, and CRM

### 10.1 What every application receives automatically

When a shared-db migration is merged to `main`, the repository is automatically
mirrored into the active consumer repos, including CRM, DAM, PM/PIM, and the
DesignFlow repositories. All applications on project `qsllyeztdwjgirsysgai`
share the same PostgreSQL compute, cache, connection limits, extensions, and
schema objects.

They automatically receive:

- the new database indexes and RPC definitions
- reduced shared database load when PopDAM stops running broad scans
- any shared-db migration notes and contract documentation
- improved headroom caused by shorter PopDAM statements

They do **not** automatically receive:

- rewritten application queries
- keyset cursors in their APIs or UI state
- faster queries against unrelated CRM, PM, or PLM tables
- permission to call DAM-private RPCs
- semantic/lexical DAM search behavior unless they deliberately call the DAM
  search contract and are authorized to see its data
- app-specific generated types, tests, or deployment changes

This distinction must be explicit in release communication. “Same Supabase
project” means shared infrastructure and available contracts, not automatic
optimization of every query.

### 10.2 Canonical notification mechanism

The durable communication should live in `shared-db`, not only in Slack, a
ticket, or PopDAM's handoff.

For this implementation, create:

```text
/worksp/shared-db/docs/app-migration-notes/
  ai-tagging-keyset-timeout-20260714.md
```

That note is mirrored automatically to every consumer repository. It must
contain:

1. Problem statement and production evidence.
2. Migration filename, PR, preview/prod status, and rollback.
3. New RPC signature, role grants, cursor contract, and examples.
4. Index definitions and the exact predicates they accelerate.
5. “Automatic benefit” versus “application adoption required.”
6. Affected-app matrix: PopDAM, CRM, PM/PIM, DesignFlow PLM services.
7. Before/after plan and latency evidence.
8. A grep/audit recipe for finding risky application queries.
9. Per-application owner, issue/PR link, status, and verification evidence.
10. A warning that consumers must not copy DAM-specific indexes onto unrelated
    tables without measuring their own plans.

Also add a one-line entry to `/worksp/shared-db/README.md` under Current
Documents. Because the mirror is automatic, developers encounter the guidance
inside their own repo without needing to know where this PopDAM plan lives.

### 10.3 Developer announcement template

Send this after the shared-db production migration is verified and before app
audits begin:

```text
Shared Supabase performance contract update

We fixed a proven PopDAM AI-tagging timeout caused by offset pagination, an
unindexed filter/order query, and an exact count in the hot path. The shared-db
migration adds a bounded keyset-paginated DAM candidate RPC and query-shaped
indexes. PopDAM is adopting it in the Railway worker.

Automatic benefit: all apps on qsllyeztdwjgirsysgai get more database headroom,
and the new schema objects are available subject to grants.

Required app action: audit large-list and search queries for offset/range
pagination, exact counts, broad selects followed by client filtering, unstable
ordering, and filters whose leading/order columns lack a matching index. Use an
app-facing api.* view/RPC with keyset pagination for high-volume paths. Do not
increase statement_timeout as the primary fix.

Canonical contract, examples, rollout status, and audit checklist:
shared-db/docs/app-migration-notes/ai-tagging-keyset-timeout-20260714.md

Please attach EXPLAIN (ANALYZE, BUFFERS), before/after p95, and the app PR to the
tracking issue for each changed query.
```

Use the teams' normal coordination channel for visibility, but make the
shared-db note and repository issues/PRs the durable source of truth.

### 10.4 Shared audit recipe

Each app team should search its server, edge functions, and frontend data hooks
for these patterns:

```text
.range(
offset:
OFFSET
findAndCountAll
count: "exact"
count: 'exact'
select("*"
.select('*'
.order(
.ilike(
.or(
Promise.all(      # when each branch is an independent DB query
```

The presence of a pattern is not automatically a bug. For every high-volume or
user-facing occurrence, record:

- table/view/RPC and role
- filters, sort, result limit, and expected cardinality
- whether order is unique and deterministic
- current p50/p95/p99 and timeout rate
- `EXPLAIN (ANALYZE, BUFFERS)` with representative parameters
- rows scanned versus rows returned
- exact-count requirement and UX reason
- proposed keyset columns and supporting index
- RLS impact
- rollout and rollback owner

Priority order:

1. Queries that have already timed out.
2. Queries over more than roughly 10,000 eligible rows.
3. Queries using deep offsets or exact counts on every page load.
4. Search endpoints with `%term%` patterns or client-side filtering.
5. Polling/realtime reconciliation queries repeated frequently.

### 10.5 Shared coding standard to adopt

For large shared-Supabase collections:

- Prefer keyset pagination over offset pagination.
- Order by a stable, unique tuple such as `(updated_at, id)` or domain-specific
  priority plus ID.
- Treat cursors as opaque, versioned API values.
- Bound every page size in the database contract.
- Put complex browser-facing reads behind versioned `api.*` views/RPCs instead
  of duplicating query construction across clients.
- Build indexes from the actual equality/range/order predicate shape, then prove
  them with representative plans.
- Use partial indexes for stable high-selectivity predicates, with awareness of
  null semantics.
- Avoid exact counts in hot paths. Use unknown, approximate, cached, or
  separately fetched totals when product UX permits.
- Select only required columns.
- Keep write transactions short; never hold locks across model calls or remote
  HTTP requests.
- Make bulk work bounded, idempotent, checkpointed, and resumable.
- Include query stage and PostgreSQL error code in diagnostics.
- Keep RLS and grants part of performance testing; service-role plans alone do
  not prove browser-user performance.
- Do not use a global `statement_timeout` increase to conceal a bad plan.

### 10.6 App-specific guidance

#### DesignFlow PLM

Scope includes the relevant `designflow-backend`, `designflow-bff`,
`designflow-item-master`, `designflow-tracking`, `designflow-data-syncing`, and
frontend repositories.

Actions:

- Audit Sequelize `offset`/`limit`, `findAndCountAll`, and list endpoints that
  sort by nonunique timestamps.
- Replace deep operational lists with keyset contracts in canonical shared-db
  first; do not add Sequelize model-only or startup DDL.
- Prefer stable `api.*` contracts at the BFF boundary so the frontend does not
  know physical PLM table structure.
- Keep master-data imports as bounded batches with durable source cursors and
  idempotent upserts.
- For text search, choose indexes from actual field/query behavior. Exact ID,
  SKU, PO, and code lookup should remain lexical and index-backed; do not route
  every operational lookup through semantic search.
- Work on `sandbox-albert`, push, and open/update a PR to `develop`; DesignFlow
  PRs are reviewed by Uma and are not self-merged under current repo rules.

#### PM/PIM (`/worksp/poppim-web`)

Actions:

- Audit Supabase `.range()` hooks, legacy pagination assumptions, product
  grids, project/order lists, and any exact total fetched on each filter change.
- Move expensive cross-domain joins to shared `api.*` views/RPCs with explicit
  columns and RLS rather than N+1 browser calls.
- Use keysets that match the user-visible sort, for example
  `(modified_at, id)`, and add a deterministic ID tie-breaker.
- If PM needs DAM asset discovery, consume an authorized DAM search/product
  asset API contract. Do not duplicate `assets`, `asset_tags`, or
  `dam_search_documents` into PM-owned tables merely for search.
- Test product and account/customer screens against preview before shared-db PR
  merge when they depend on a new contract.
- PM app changes commit to `main` after the shared-db dependency is in
  production and app checks pass.

#### CRM (`/worksp/popcrm-web`)

Actions:

- Start from the existing timeout-safe CRM contracts documented in
  `/worksp/shared-db/docs/crm-customer-contract-rollout.md`; do not regress to
  broad table reads and client-side aggregation.
- Audit customer segments, opportunity lists, email-routing feeds, activity
  timelines, and tab counts independently. List data and counts should be
  separately bounded contracts so a count failure cannot blank the list.
- Prefer existing `api.crm_*_list` and `api.crm_*_segment_counts` contracts;
  extend them in shared-db when a new sort/filter is required.
- Use keyset pagination for deep email/activity timelines and deterministic
  tie-breakers for equal timestamps.
- Do not grant CRM direct access to DAM-private candidate RPCs. If CRM needs DAM
  search results for an opportunity/product workflow, define a purpose-specific
  authorized API view/RPC with only the fields CRM may see.
- CRM app changes commit to `main` after shared-db production promotion and
  successful app verification.

### 10.7 Search-feature adoption

The new AI candidate structure is not itself a general search API. The broader
DAM lexical/hybrid search work is specified in
`fix_SEARCH_PIPELINE_PLAN.md` and exposed through DAM search contracts such as
`search_dam_documents`, `search_assets_full_text`, and
`search_style_groups_full_text`.

Other apps should adopt those search features only when the product workflow
actually needs DAM assets and the caller is authorized. Recommended integration
shape:

```text
PLM/PM/CRM UI
  -> its own backend/BFF or authorized edge function
  -> stable cross-app api.* RPC/view
  -> DAM search contract
  -> IDs + minimal permitted display fields
```

Do not expose service-role credentials in a frontend, bypass DAM RLS, or make
CRM/PM/PLM depend directly on PopDAM worker tables and operation state.

For search within each application's own domain, reuse the architecture pattern,
not necessarily the DAM corpus:

- canonical per-domain search document or view
- complete normalized lexical corpus
- GIN/trigram indexes for measured lexical behavior
- optional embeddings only where natural-language recall adds value
- bounded ranked RPC with a deterministic cursor
- domain-specific RLS and result projection
- embedding backfill and refresh lifecycle before enabling hybrid mode

A single global search corpus spanning confidential CRM, PLM, PM, and DAM data
would create ranking, ownership, and authorization problems. Keep domain
documents separate and add a federated API later if a cross-app search product
is explicitly designed.

### 10.8 Adoption tracking table

The shared-db migration note should maintain this table until all audits close:

| Consumer | Automatic benefit verified | Query audit issue | App changes needed | Preview tested | Production verified |
|---|---|---|---|---|---|
| PopDAM | Pending | This plan | Yes | Pending | Pending |
| PM/PIM | Pending | Create after DB PR | Unknown until audit | Pending | Pending |
| CRM | Pending | Create after DB PR | Unknown until audit | Pending | Pending |
| DesignFlow PLM | Pending | Create after DB PR | Unknown until audit | Pending | Pending |

An application may close with “no code change” only after its audit documents
why no high-volume query can use the new contract or pattern.

---

## 11. Definition of done

This workstream is complete only when:

- the shared-db migration has passed preview, merged, and been promoted to
  production
- the RPC has explicit grants, comments, tests, and measured plans
- candidate fetch uses keyset pagination in the Railway worker
- the smart-skip prefetch and offset query are gone
- the exact hot-path count is gone or strictly optional
- string cursors resume correctly after a worker restart
- retries are bounded and stage-aware
- the UI no longer claims a read timeout was a write timeout
- a representative production AI-tagging operation completes
- production evidence is recorded in shared-db and PopDAM handoff docs
- the shared-db consumer migration note has been mirrored to app repos
- PLM, PM/PIM, and CRM have tracking issues and completed query audits
- each required app change follows its repository workflow and records
  before/after evidence
- no untracked migration or dirty shared-db worktree is left behind

---

## 12. Explicit non-goals

This work does not:

- increase the global PostgreSQL statement timeout
- redesign the AI tagging prompt or model contract
- implement the full DAM hybrid-search overhaul
- grant all applications direct access to DAM internals
- create one cross-domain global search corpus
- introduce a multi-worker lease queue before parallel workers exist
- drop broad existing indexes without an independent usage audit
- change the semantics of one-representative-per-style-group without explicit
  approval and tests

Those boundaries keep the remediation deployable while leaving clear extension
points for the broader search and shared-application work.
