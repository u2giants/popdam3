# PopSG broad Guides search repair design — issue #4210

Status: design only. No migration is edited by this document.
Branch: `codex/popsg-4210-forward-recovery` at `ee263c32`.
Serving body today: `public.search_style_guide_library_v2`, `md5(prosrc) = 9d5dd045810fa3fce5cc3d508e1210ff`
(merged parse-once repair, `supabase/migrations/20261012005136_popsg_parse_search_query_once.sql`).
Evidence base: `docs/verification/popsg-search-4210.md`, the Guides SQL body, and the
local visibility-churn benchmark (60k+ heap fetches; VACUUM recovered only ~5.6% wall-clock).

Constraints honored: no timeout raise, no result-scope reduction, no top-K fake
totals, no app-side DDL, no autovacuum table options on `style_guide_files`
(unapproved and collides with table claims), no new index on `style_guide_files`.

---

## 1. Root cause hypothesis (with SQL evidence)

Broad Guides matching search is a different shape from Files and from unmatched
queries. A common six-character term matches **94,497 of 220,218** active
documents. Default browse is already served from the snapshot matviews
(`style_guide_library_default_summary` / `_guides`) and unmatched queries prune
to zero rows, so both stay fast. The matching Guides path recomputes the whole
matched set for exact totals and facets under the unchanged 8s
`authenticated` ceiling and overruns it.

The parse-once body fixed *planning* (constant `$guides_query$`, fifteen `USING`
binds, planning 17 ms) but left four execution costs in place.

### 1.1 `live_files` is read twice

```sql
live_files as not materialized (
  select id, true as has_preview, false as has_error from public.style_guide_files
    where is_active and thumbnail_url is not null
  union all
  select id, false, false from ... thumbnail_error is null
  union all
  select id, false, true  from ... thumbnail_error is not null
)
```

`as not materialized` lets the planner inline the CTE. The recorded Guides plan
shows `idx_sgf_live_preview_ids` **rows 108,999, loops 2** — about 218k
index-only entry reads for one join. Every index-only scan consults the
visibility map of `style_guide_files`. That table is high-churn with **0% HOT
updates and 17 indexes** (issue #1966), so VM bits go dirty and those scans
degrade into heap fetches. Local proof: 60k+ heap fetches on a partial index;
VACUUM cleared them and recovered only **~5.6%** of full-query wall-clock.
Visibility churn is real, but it is not the dominant term. Autovacuum table
options are out of scope (unapproved, claim collision), so the repair must not
depend on them.

### 1.2 `page_children` joins `style_guide_files` for every child of the page's guides

```sql
page_children as materialized (
  select d.*, live_payload.thumbnail_url
  from active_children d
  join page pg on pg.group_id = d.group_id
  join public.style_guide_files live_payload on live_payload.id = d.style_guide_file_id
)
```

That single join exists only so `page_metadata` can do

```sql
(array_agg(d.thumbnail_url
   order by (d.thumbnail_url is null), d.modified_at desc nulls last, d.style_guide_file_id
   filter (where d.thumbnail_url is not null))[1] as thumbnail_url
```

and pick one URL per guide. A broad query puts large guides on the page; the
recorded plan shows `style_guide_files_pkey` **rows 1, loops 31,665**. That is
tens of thousands of random heap/index visits — each a visibility check — to
select at most `p_limit` (≤200, typically 50) URLs. Files mode does not have
this fan-out: its page is ≤ `p_limit` rows. This is the Guides-only cliff.

### 1.3 `guide_facets` rescans the matched CTE five times

`guide_facets` is five separate `select distinct group_id, <dim> from active_children`
subqueries (extensions, tags, preview, render_exception, pdf_content) over the
full 94k-row materialization, then another `GROUP BY`. Same rows are walked
five times for facet counts that a single lateral pass can produce.

### 1.4 `active_children` pays for expressions the page does not need yet

For every matched row the CTE computes a length-prefixed `concat_ws` `group_id`
(five `length()`/`coalesce()` pairs), `ts_rank_cd`, and three CASE state
strings. `entities` then re-groups on the concatenated key. State strings are
only consumed by facets and by `page_metadata` for the page's groups. Carrying
booleans and grouping on the five identity columns (which already distinguish
NULL from `''`) removes that per-row tax.

`render_rollup` is a full `GROUP BY` over `style_guide_render_queue` each call.
Keep it for now (one pass, bounded queue); only scope it to matched ids if
measurement shows it hot. It is not in the recorded top plan nodes.

### 1.5 Why the merged body still times out

| Factor | Evidence | Contribution |
|---|---|---|
| Double `live_files` read | `idx_sgf_live_preview_ids` loops 2 (108,999 rows) | ~0.5–1.5 s + VM/heap fetches |
| Thumbnail mass lookup | `style_guide_files_pkey` loops 31,665 | ~0.6 s cold, worse when dirty |
| Five-pass facets | five `distinct` scans of 94k CTE | CPU + repeated CTE scan |
| Per-row `concat_ws` + state CASE | `active_children` projection | CPU on 94k rows |
| Visibility churn | 60k+ heap fetches; VACUUM −5.6% | real but secondary |
| Parse-once body wall-clock | 4,621 ms Guides on production-sized probe | already at 58% of ceiling before RPC + churn |

Diagnosis timings (Files 4,113 ms, Guides 4,621 ms) were READ ONLY probes of
extracted SQL. Production RPC adds bind/plan/serialize overhead and live
visibility noise; the body has no headroom left for those.

---

## 2. Exact change

One `CREATE OR REPLACE FUNCTION public.search_style_guide_library_v2(...)` with
a fail-closed `md5(prosrc) = '9d5dd045810fa3fce5cc3d508e1210ff'` guard, same
signature, same `SECURITY DEFINER`, same `proconfig`
(`search_path=pg_catalog, auth`, `work_mem=64MB`), same grants. Snapshot
default-browse path, Files path semantics, output JSON contract, and the
parse-once `EXECUTE $guides_query$ ... USING` binder are unchanged.

Guides body changes only (Files path gets change A for free):

### A. Force `live_files` to materialize once

```sql
live_files as materialized (
  select id, true as has_preview, false as has_error from public.style_guide_files
    where is_active and thumbnail_url is not null
  union all
  select id, false, false from public.style_guide_files
    where is_active and thumbnail_url is null and thumbnail_error is null
  union all
  select id, false, true from public.style_guide_files
    where is_active and thumbnail_url is null and thumbnail_error is not null
)
```

Same three partial index-only scans (`idx_sgf_live_*`), executed once. Removes
loops=2. No new index, no `style_guide_files` write.

### B. Stop joining `style_guide_files` for every page child

`page_children` drops `join public.style_guide_files live_payload` and keeps
only what aggregates need (`style_guide_file_id`, `group_id`, `extension`,
`tag_names`, `modified_at`, `preview_state`, `render_exception_state`,
`pdf_content_state`, `rank`, `has_preview`/`preview_state`).

Winner pick uses the same order the current `array_agg` implements among rows
with a live preview — `modified_at desc nulls last, style_guide_file_id` —
because the `filter (where thumbnail_url is not null)` already drops the
`thumbnail_url is null` sort key:

```sql
page_thumb_ids as materialized (
  select d.group_id,
         (array_agg(d.style_guide_file_id
            order by d.modified_at desc nulls last, d.style_guide_file_id)
          filter (where d.preview_state = 'available'))[1] as style_guide_file_id
  from page_children d
  group by d.group_id
)
page_thumb as materialized (
  select t.group_id, f.thumbnail_url
  from page_thumb_ids t
  join public.style_guide_files f on f.id = t.style_guide_file_id
)
```

`page_metadata.thumbnail_url` joins `page_thumb` instead of aggregating heap
URLs. Replaces 31,665 pkey scans with ≤ `p_limit` (≤200). Live preview remains
authoritative: `popsg_guide_page_metadata_contracts.sql` already pins that a
stale `style_guide_search_documents.thumbnail_url` must lose to the live
`style_guide_files` URL. We still read the winner from `style_guide_files`.

### C. Single-pass `guide_facets`

One lateral unnest of the five facet dimensions over the matched set, one
`select distinct group_id, category, value`, one `GROUP BY category, value`.
Output shape stays the same `[{value, count}]` arrays per category. Extension
array order stays unspecified (set comparison in tests — finding 3 of the
prior REVISE round).

### D. Group entities on the identity columns

`entities` becomes `GROUP BY root_label, licensor_name, property_folder,
style_guide_folder, style_guide_name` (SQL `GROUP BY` already keeps NULL and
`''` distinct). `entity_key` is built only on entity rows (far fewer than 94k).
`page` joins `page_children` on those five columns with `IS NOT DISTINCT FROM`
or on a `group_id` materialized from `entities` — not from a length-prefixed
concat evaluated on every matched file. Sort tie-break `entity_key` and the
emitted `guide_key` keep the current `concat_ws(chr(31), root_label,
coalesce(licensor_name,''), ...)` so output identity does not change.

### E. Carry booleans, not state strings, in the matched set

`active_children`/`filtered` keeps `has_preview`, `has_error`,
`has_open_work`, `has_recoverable_error`, `has_terminal_error`, `rank`, and
the identity/extension/tag/modified columns. The three CASE state machines run
in `guide_facets` and `page_metadata` only. WHERE-side state filters keep
their CASE form (empty filter arrays already short-circuit).

Explicitly unchanged: `render_rollup` shape, parse-once bind list and argument
order, default snapshot branch, authorization (`has_app_access`), role grants,
`work_mem=64MB`, no plan-cache or timeout setting.

---

## 3. Why it fits 8s

Budget accounting on the production-sized corpus (220,218 active, 94,497
matching), under the unchanged 8s `authenticated` ceiling and `work_mem=64MB`:

| Step | Current evidence | After change | Rationale |
|---|---|---|---|
| `live_files` | ~218k index-only rows (loops 2) + dirty VM heap fetches | ~109k index-only rows (loops 1) | A alone removes half this IO |
| Thumbnail URL | 31,665 `style_guide_files_pkey` heap visits | ≤200 pkey visits | B alone removes the Guides cliff |
| Facets | 5× walk of 94k CTE | 1× walk | C |
| Group/CASE CPU | `concat_ws`+3 CASE on 94k | 5-col GROUP BY; CASE on facet/page sites | D+E |
| ts_rank_cd | 94k (required for exact rank + relevance) | unchanged | contract |
| Matched-set scan + exact totals/facets | inherent | inherent | exact totals kept |
| Visibility churn | −5.6% when clean; worse when dirty | still present on ≤200 thumbnail fetches and one `live_files` pass | cannot fix via autovacuum; work no longer scales with it |
| Prior probe Guides | 4,621 ms | target ≤3.5 s wall-clock on the same probe | removals are proportional to the measured plan nodes |

Exact totals and full-population facets remain: we still materialize the whole
matched set once. We do not paginate totals, approximate, or restrict facet
dimensions. The margin comes from deleting work the plan proved redundant
(second live_files pass, 31k heap fetches for 50 URLs, four extra facet
walks), not from reducing result scope.

Success criterion (must be measured before this is called a repair):
`EXPLAIN (ANALYZE, BUFFERS)` of the extracted new `$guides_query$` on a
220k/94k corpus, READ ONLY, `statement_timeout='8s'`, `work_mem='64MB'`,
finishes in **≤5.0 s** warm and **≤6.5 s** after a dirty-visibility pass,
with plan nodes `idx_sgf_live_*` loops=1 and `style_guide_files_pkey` loops ≤
`p_limit + 1`.

---

## 4. Test plan

All synthetic checks use invented rows only. Production probes are READ ONLY
diagnosis, not deployment acceptance.

1. **Fail-closed apply.** Guard asserts current `md5(prosrc)`,
   `prosecdef`, `provolatile='s'`, `proconfig`, and dependency kinds/types
   (same shape as `20261018171808` recovery guard). Any mismatch aborts;
   prior body stays in place.
2. **Behavioral equivalence (fixture).** Install baseline body under a
   fixture-only name; install new body under the serving name; run the
   existing 224-case complete-JSON harness (Files and Guides; null, matching,
   unmatched, negated, quoted, null-identity, tag queries; four sorts; limits
   1/200; offsets 0/1). Compare results, totals, facets, order, rank, live
   preview selection, null/empty guide identity. Extension arrays compare as
   sets (sorted distinct + length), not raw order.
3. **Contract suites.**
   `supabase/tests/popsg_search_style_guide_library_v2_contracts.sql`,
   `popsg_parse_search_query_once_contracts.sql` (incl. default-matview
   column types), `popsg_guide_page_metadata_contracts.sql` (stale
   `search_documents.thumbnail_url` must lose to live URL).
4. **Production-width benchmark.** 220,218 documents, 94,497 matching a
   common six-char term. Capture `EXPLAIN (ANALYZE, BUFFERS)` for:
   - Guides matching, `p_limit=50`, relevance
   - Guides matching, `modified_desc`, offset 1000
   - Files matching (regression)
   - Unmatched term (still fast path)
   - Default browse (still snapshot path)
   Assert the plan-node budgets in §3 and wall-clock targets.
5. **Dirty-visibility case.** On the fixture corpus, churn
   `style_guide_files` updates without VACUUM; re-run the Guides probe. Heap
   fetches may rise on `live_files`, but wall-clock must stay ≤6.5 s and the
   pkey thumbnail node must stay ≤200 loops. This is the case where the old
   body showed 60k+ heap fetches.
6. **Exactness spot-checks.** Unmatched, negated, and tag queries return the
   same totals/facets as baseline. Guide `matched_file_count`,
   `file_extensions`, `preview_states`, `render_exception_states`,
   `pdf_content_states`, and `thumbnail_url` match baseline on the full result
   set for three representative broad terms.
7. **Live proof (post-merge, same issue).** As `authenticated` with a real
   PopSG-entitled JWT under the normal 8s ceiling: one broad Guides common-term
   call (`p_limit=50`), one broad Files call, one unmatched call, one default
   browse. No SQLSTATE 57014. Record timings in
   `docs/verification/popsg-search-4210.md`. Leave `- [ ] live proof` on the
   issue until this is done.

---

## 5. Rollback

- Apply is one `CREATE OR REPLACE FUNCTION` plus a `DO` guard. If the guard
  fails, the statement aborts and the serving body (`9d5dd045…`) remains.
- If the new body is applied and must be undone, re-apply the exact prior
  definition from `20261012005136_popsg_parse_search_query_once.sql` (the
  same function text the guard hashes to `9d5dd045810fa3fce5cc3d508e1210ff`)
  and assert the hash returns. No `DROP FUNCTION`, no privilege or setting
  change, no index/table/cron object is created or altered by the repair.
- Drill: on a disposable fixture, replace with the new body, then replace with
  the parse-once body and assert `md5(prosrc)` equals `9d5dd045…`.
- No production vacuum, autovacuum option, or index action is required or
  permitted for this repair. If Guides still misses budget after the
  measured plan-node targets pass, the next candidate is scoping
  `render_rollup` to matched ids — still function-only — not table options.

---

## 6. Out of scope (explicitly rejected)

- Raising `statement_timeout` or any role/ceiling setting.
- Reducing result scope, approximating totals, or top-K facet fabrication.
- App-side DDL, new indexes on `style_guide_files`, autovacuum table options.
- Shipping the preserved `20261018171808_popsg_search_forward_delivery_recovery.sql`
  draft as-is (body identical to parse-once; it does not change execution
  shape — see commit `ee263c32` message).
- Depending on VACUUM or cleaner VM bits for the 8s budget.
