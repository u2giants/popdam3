# Master Data and OrderList loading-performance implementation plan

Tracking: [PopDAM #121](https://github.com/u2giants/popdam3/issues/121) · database lane: [shared-db #2665](https://github.com/u2giants/shared-db/issues/2665) · handoff: [HANDOFF.d/2026-09-10T0209Z-hetz-codex-grid-loading-performance-plan.md](HANDOFF.d/2026-09-10T0209Z-hetz-codex-grid-loading-performance-plan.md)

## STATUS — read this first

Fresh sessions start at **Step 1**. Re-read the downstream phase before starting each phase because the shared-db queue and production state may have changed.

| Step | Status | Date | Evidence |
|---|---|---|---|
| 1. Record baselines and exact payload contract | 🟨 partial | 2026-09-10 | Sanitized Licensed baseline: `docs/verification/grid-loading-performance/2026-09-10T1514Z/README.md`; Generic/OrderList traces remain after test-session rotation. Explicit projection contract test added in Step 2–3 commit. |
| 2. Render the first 4,000 Master Data rows immediately | ✅ complete — local verification | 2026-09-10 | `useInfiniteQuery` releases four 1,000-row ranges per page and appends later pages; focused tests and build passed. Production verification remains Step 6. |
| 3. Stop downloading unused Master Data fields | ✅ complete — local verification | 2026-09-10 | Explicit select projection and contract test exclude verified unused view metadata; production byte measurement remains Step 6. |
| 4. Add the governed OrderList Find-position RPC | ⬜ open — queued as shared-db #2665 | 2026-09-10 | Shared-db migration, SQL tests, preview evidence, PR and merge SHA. |
| 5. Replace the OrderList multi-request scan with the RPC | ⬜ open — blocked by Step 4 | 2026-09-10 | App tests and browser/network evidence specified in Step 5. |
| 6. Ship and verify production behavior and performance | ⬜ open — blocked by Steps 2–5 | 2026-09-10 | CI run, deployed SHA, browser screenshots and before/after measurements. |

## 1. The ultimate goal

Master Data and OrderList must feel ready sooner without sacrificing completeness, editing, sorting, filtering, saved views, search accuracy, permissions, or surrounding-row navigation. Master Data must show its first 4,000 newest rows as soon as that first wave arrives and continue loading the rest in the background. It must not download database fields the page does not consume. OrderList Find must locate a full-dataset match with one governed database lookup instead of downloading up to 24,000 IDs across as many as 25 requests.

If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager. Its Master Data page mirrors the legacy Google style tracker; its OrderList page replaces the legacy Google OrderList while reading linked product truth from Master Data.

- Application repository: `u2giants/popdam3`, local checkout `/worksp/popdam`, direct-to-`main` workflow.
- Shared database repository: `u2giants/shared-db`, canonical checkout `/worksp/shared-db`, branch → preview → PR → AI merge workflow controlled by the single orchestrator.
- Frontend: React, TypeScript, Vite, TanStack Query and AG Grid 35.3.1.
- Backend: shared hosted Supabase/PostgreSQL project. Production project is `qsllyeztdwjgirsysgai`; never use retired Ohio project `ryltkzzernhwnojzouyb`.
- Production pages: `https://dam.designflow.app/styles` and `https://dam.designflow.app/orders`. PopSG must continue to hide OrderList.
- Frontend deployment: GitHub Actions builds GHCR image and deploys through Coolify.

## 3. What triggered this work

On 2026-09-09 the page Find behavior was changed at PopDAM commit `629670862af0204d6640393c03e31c81baf1b8f4`: Find now navigates to and highlights matches while preserving surrounding rows. Albert then asked whether initial data could load faster and selected three improvements for one plan:

1. render the first 4,000 Master Data rows immediately;
2. stop, or defer, downloading unused Master Data database fields;
3. implement a small governed database lookup for OrderList Find.

The current symptom is perceived waiting, not missing or incorrect data. Reproduce on production by opening `/styles` with a cold browser cache and recording the time until the first usable rows and until the full active tab is searchable/filterable. For OrderList, type a term matching a row late in the current sort and inspect the number of network requests before the grid scrolls to the match.

## 4. Scope — in and out

### In scope

- Progressive full-tab loading for both Licensed and Generic Master Data tabs.
- An explicit Master Data select projection containing every field the current page consumes and no unused view fields.
- Visible, truthful background-loading state until the entire active tab is loaded.
- Preservation of full-dataset Find/filter semantics after background loading completes.
- A shared-db-owned, authenticated Find-position RPC for OrderList.
- Replacing only the current OrderList position scan with that RPC.
- Focused tests, documentation, before/after measurements, deployment and live verification.

### NOT in this plan

- Changing Master Data or OrderList business rules, editable fields, row order, page sizes, saved-view format, role policy, import data, or row counts.
- Converting Master Data to infinite/server-side row mode. The completed active tab must remain client-side so all rows participate in AG Grid Find and filters.
- Loading all OrderList rows into the browser; the full view was measured at about 53 MB and roughly 25 seconds.
- Adding Set filters to OrderList.
- Combining OrderList row and exact-count requests, increasing statement timeouts, caching stale results, or hiding failures.
- Editing `src/integrations/supabase/types.ts`; it is generated.
- Adding migrations under PopDAM's historical `supabase/migrations/` or editing PopDAM's read-only `shared-db/` mirror.
- Any production database write without Albert's explicit approval for the exact migration after preview proof.

## 5. Current state of the code

Everything described here is committed, pushed and deployed on PopDAM `main` at `62967086`; this plan itself begins with no implementation work completed.

### Master Data

- `src/pages/StylesPage.tsx:481-505`, `fetchRows(sourceSheet)`, reads `public.style_tracker_rows_with_bridge` with `.select("*")`.
- Each PostgREST range is 1,000 rows. Four ranges run concurrently, but `fetchRows` does not resolve until every wave has completed; TanStack Query therefore gives AG Grid no `rowData` until the full active tab is downloaded.
- Production documentation records 12,527 Licensed and 3,207 Generic rows (`docs/MASTER_DATA.md:52-56`). The first Licensed load therefore waits for four waves rather than displaying the first 4,000 rows after wave one.
- `src/lib/master-data-loading.ts` owns `MASTER_DATA_FETCH_BATCH_SIZE = 1000` and the full-batch continuation rule.
- `src/pages/StylesPage.tsx` keeps the active tab in `useQuery(["style-rows", active.name])`; `rowsQuery.data ?? []` feeds AG Grid. Realtime invalidates the query after relevant changes.
- The view currently returns fields not present in `StyleRow` and not consumed by this page: `source_workbook_id`, `imported_at`, `created_at`, `updated_at`, `updated_by`, `bridge_id`, `match_confidence`, `last_matched_at`, `canonical_description`, `canonical_licensor_name`, `canonical_factory_name`, `style_group_sku`, and `erp_style_number`. Verify this list again against the current view and code before Step 3; do not delete a field based only on this snapshot.
- Fields that look large or expensive but are required must stay: `row_data` drives flexible sheet columns and saves; `match_notes` drives per-field resolution state; `rfq_groups` is displayed and opens history; canonical customer/designer fields drive display and filtering; all IDs in `StyleRow` drive matching indicators and writes.

### OrderList

- `src/components/orders/OrderListGrid.tsx` uses AG Grid's infinite row model and 500-row database blocks. Keep it.
- `src/hooks/useOrderList.ts:74-96`, `applyOrderListShape`, applies allowlisted filter models, full-text Find clause, and stable sorting.
- `src/hooks/useOrderList.ts:149-165`, `fetchOrderListBlock`, deliberately separates row data from the best-effort exact count. Keep that separation.
- `src/hooks/useOrderList.ts:172-205`, `findOrderListRow`, first fetches one matching full row, then scans the filtered-but-unsearched list's IDs in 1,000-row ranges, six requests at a time, until it discovers the matching row's index. At current volume this can issue roughly 25 ID-range requests.
- `src/pages/OrdersPage.tsx`, the search effect, calls `findOrderListRow`, changes pagination, scrolls to the returned index and highlights the returned ID. Preserve that customer-visible behavior and race cancellation.
- `src/lib/order-list.ts:33-43` is the locked list of searchable columns; `buildOrderListFilters` and `buildOrderListSort` define the filter/sort semantics the RPC must match.
- Shared-db issue `#2665` is already open with label `db-work`, type `structural`, route `shared-db-orchestrator`, write claim `public.find_dam_order_list_row`, and read claim `api.dam_order_list`.

## 6. Key findings and root cause

1. **Master Data's first-paint delay is an orchestration delay.** Four ranges are already parallel, but the query returns only after all waves finish. The first 4,000 rows exist earlier and are withheld by the promise structure.
2. **Master Data over-fetches columns.** `.select("*")` couples payload size to every column ever added to the shared view. An explicit projection reduces current bytes and prevents future unrelated view additions from slowing this page.
3. **Do not defer required row fields per cell.** Lazy cell-level fetches would add request storms, inconsistent Find/filter coverage and editing races. The useful split is first 4,000 rows versus remaining rows, not visible columns versus hidden columns.
4. **OrderList's normal opening path is already bounded.** The slow opportunity is Find positioning, not initial rows. Loading the whole 53 MB view would reverse a deliberate production optimization.
5. **The OrderList index belongs in the database.** PostgreSQL already owns the full filtered and sorted set and can calculate `row_number()` once. The browser should receive one `order_line_id` and zero-based `row_index`, not the ID of every preceding row.
6. **The RPC is a structural shared-database contract.** It must be authored in `u2giants/shared-db` and land before dependent PopDAM code. App-side SQL, Dashboard SQL and direct production DDL are forbidden.

## 7. Approaches considered and rejected

- **Rejected: wait for all Master Data rows, then optimize rendering.** The dominant avoidable delay is that rows are withheld; AG Grid cannot render data it has not received.
- **Rejected: increase Master Data concurrency above four without measurement.** This may move pressure to PostgREST/database and does not create progressive display. Four 1,000-row requests define the requested first wave.
- **Rejected: make Master Data infinite/server-side.** It would break the settled full-tab client-side Find and filter behavior or require a much larger redesign.
- **Rejected: defer `row_data`, `match_notes`, or `rfq_groups` merely because they are JSON.** Each is used by current customer-visible behavior. Removing them is a functional regression.
- **Rejected: use AG Grid's built-in Find for OrderList.** AG Grid Find supports only the client-side row model; OrderList intentionally uses the infinite model, whose browser cache contains only a subset.
- **Rejected: retain the current parallel ID scan as the final design.** It works but transfers the full position prefix and creates up to 25 requests for one Find.
- **Rejected: interpolate arbitrary AG Grid column names/operators into dynamic SQL.** The RPC must reject unknown columns, operators, sort directions and malformed shapes before building a query.
- **Rejected: merge row and exact-count queries.** This previously made the visible rows fail when a count timed out; the split is a locked reliability decision.
- **Rejected: increase any timeout or hide a failed lookup.** A performance fix must reduce work while keeping errors truthful.

## 8. Design decisions already made

### Locked decisions — do not relitigate

- **2026-09-10:** One plan covers all three improvements, but Master Data is an independently shippable phase while shared-db work waits.
- **2026-09-10:** One Master Data page equals four concurrent 1,000-row requests; first useful render occurs after page one (up to 4,000 rows). Subsequent pages append in the background.
- **2026-09-10:** Use TanStack `useInfiniteQuery` or an equivalently cancellation-safe paged cache, flattening completed pages for AG Grid. Do not manage a second unsynchronized local copy of rows.
- **2026-09-10:** The UI must say that remaining rows are loading and must distinguish partial from complete. It must never claim that partial Find/filter results cover the full tab.
- **2026-09-10:** Use an explicit Master Data projection. Keep every field proven to be consumed, even if hidden or JSON-backed.
- **2026-09-10:** The OrderList lookup returns only `order_line_id` and zero-based `row_index`, at most one row.
- **2026-09-10:** The RPC is invoker-security, authenticated-only, and preserves the same filters, search columns, sort directions, null placement, stable `order_line_id ASC` tie-breaker and wildcard escaping as the app.
- **2026-09-10:** The app falls back to the current bounded ID scan only for a short rollout window if the RPC is genuinely unavailable due to deployment skew. The fallback must be visible in telemetry/console, tested, and removed after production proof; it must not mask permission, validation, or query errors.

### Open implementation judgment

- Choose `useInfiniteQuery` unless current TanStack behavior makes realtime invalidation or background paging measurably unreliable. Any alternative must retain one authoritative cache, abort stale tab requests, and pass the same tests.
- The shared-db implementer may choose SQL-language or PL/pgSQL implementation. Selection criteria are: no unchecked dynamic identifiers/operators, explainable plan, contract parity, invoker permissions, and one bounded call. The public signature/behavior is locked; internal SQL is not.

## 9. Executable implementation plan

### Phase A — baseline and Master Data frontend (Steps 1–3)

#### Step 1 — record baseline and freeze the consumed-field contract

1. From `/worksp/popdam`, confirm `git status --short` is clean and `main` matches `origin/main`. Do not disturb another session's changes.
2. Use a signed-in, read-only browser session against production to capture a cold-cache network trace for Licensed and Generic Master Data. Record: time to first visible usable row, time to complete active-tab loading, request count, compressed/transferred bytes for `style_tracker_rows_with_bridge`, and peak browser heap if available.
3. Capture an OrderList Find trace for a term whose first match is late in the current default ordering. Record time to highlight and count requests to `dam_order_list`.
4. Save sanitized evidence under `docs/verification/grid-loading-performance/<UTC>/README.md` plus screenshots/trace summaries. Never commit JWTs, cookies, row contents or licensed data.
5. Create a pure exported `STYLE_TRACKER_ROW_SELECT` constant near the Master Data fetch code and a test that compares it to the page's required `StyleRow` contract. Re-inspect every `StyleRow` reference before finalizing the list.

Dependencies: none. This baseline must precede performance edits.  
**You'll know it worked when:** the evidence README names exact URL, commit, browser state, timings/request counts/bytes, redaction method, and reproducible steps; the field inventory test fails if a required field is removed.

#### Step 2 — render the first 4,000 Master Data rows immediately

1. Refactor `src/pages/StylesPage.tsx` `fetchRows` into a page fetcher that requests four non-overlapping 1,000-row ranges concurrently and returns one ordered page plus `hasNextPage`. Keep `source_row_number DESC` in every range.
2. Replace `useQuery(["style-rows", active.name])` with `useInfiniteQuery` keyed by active sheet. Flatten `data.pages` with `useMemo`; do not resort client-side and do not duplicate rows.
3. Once page one resolves, supply its rows to AG Grid immediately. Start `fetchNextPage()` in a guarded effect until `hasNextPage` is false. At most one next-page fetch may be in flight.
4. Abort or ignore stale background work when the user switches Licensed/Generic tabs. Returning to a cached tab must reuse its complete or partial pages correctly and resume only if incomplete.
5. Keep realtime invalidation. An invalidation must restart from a coherent first page and then refill; it must not append fresh pages onto stale pages or duplicate IDs.
6. Add a compact grid-adjacent status such as `4,000 of 12,527 rows loaded — loading the rest…`. Use the existing count query as the denominator. While incomplete, explain that Find and column filters currently cover loaded rows; once complete, change to the normal total without a warning. Do not block editing of loaded rows.
7. Preserve pagination, Show All, saved views, row selection, AI helper selection, edits, audit history, realtime refresh, row highlighting and Find navigation.

Dependencies: Step 1. Can be developed in parallel with shared-db Step 4.  
**You'll know it worked when:** with the remaining-page requests deliberately delayed in browser devtools/test mocks, the grid shows exactly the first 4,000 ordered rows, the partial-loading label is truthful, editing a loaded row remains usable, later pages append without duplicates, and final Find/filter sees the full expected count.

**Natural context cut point:** after Step 2 is tested and its STATUS row updated, use `fresh-session` if context is tight. Re-read Steps 3–6 before continuing.

#### Step 3 — stop downloading unused Master Data fields

1. Replace `.select("*")` in the Master Data page fetch with `STYLE_TRACKER_ROW_SELECT`.
2. The projection must include the current `StyleRow` fields actually consumed: base identity/source/order/type fields; typed editable fields; `row_data`; all bridge/link IDs used by status logic; `match_status`; `match_notes`; canonical customer/designer names; `customer_id`; and `rfq_groups`. Re-derive the exact list from current code rather than copying this prose blindly.
3. Explicitly exclude confirmed unused view fields listed in Section 5. If a field is newly consumed by then, keep it and update the plan's historical snapshot rather than breaking behavior.
4. Confirm mutations still write only to `public.style_tracker_rows` with existing smallest-patch behavior; the select projection must not change saves.
5. Repeat the baseline measurements. Report raw and percentage reductions in transferred bytes and time, but do not claim a win if normal network variance explains it.

Dependencies: Step 1; normally land with Step 2 because both touch `StylesPage.tsx`.  
**You'll know it worked when:** network requests contain an explicit `select=` projection with no confirmed-unused fields; every Master Data behavior test passes; Licensed and Generic render/edit correctly; and the saved evidence contains before/after payload sizes.

### Phase B — governed OrderList database lookup (Step 4)

#### Step 4 — add and land `public.find_dam_order_list_row`

1. Do not author this from `/worksp/popdam`. Shared-db issue `#2665` is already queued. The active shared-db orchestrator must resolve its current marker, claim the exact object and dispatch the work into an isolated worktree.
2. In `/worksp/shared-db`, read its live `AGENTS.md`, issue #2665 and existing `plan_popdam_order_list.md`. Check current migration-author claims and collisions before work.
3. Add one new, uniquely timestamped migration above the current maximum. Never edit an applied migration.
4. Create `public.find_dam_order_list_row(p_search text, p_filters jsonb default '[]'::jsonb, p_sorts jsonb default '[]'::jsonb)` returning `table(order_line_id uuid, row_index bigint)` (zero-based). If repository conventions require parameter-name or schema adjustment, preserve this behavioral contract and document the exact final signature before app work.
5. Validate input shapes and allowlists before query construction. Filters must support the exact operators emitted by `buildOrderListFilters`: `eq`, `neq`, `ilike`, `not.ilike`, `gt`, `gte`, `lt`, `lte`, `is null`, and `not.is null`, including combined range conditions. Sorts accept only exposed OrderList columns and `asc`/`desc`; append `order_line_id ASC`; keep nulls last.
6. Search exactly `ORDER_LIST_SEARCH_COLUMNS`: production order number, order status, customer PO, SKU, vendor, customer, container booking group, MBL and snapshot description. Treat `%`, `_`, backslash and punctuation exactly as the existing escaped literal substring search; blank input returns zero rows.
7. Build the filtered set from `api.dam_order_list`, calculate `row_number() over (requested stable order) - 1`, then return the lowest-index row matching the search. Return no row when unmatched.
8. Keep function security invoker (the default), set a safe search path per repo conventions, grant execute only to `authenticated` and `service_role` if operationally required, and revoke anon/public. Do not use SECURITY DEFINER to bypass the view's underlying RLS.
9. Add or extend shared-db SQL contract tests covering: default sort; custom ascending/descending and multi-sort; stable ties; nulls last; text/number/date/blank/not-blank/range filters; multiple conditions; literal wildcard characters; blank search; no match; exact search-column scope; malformed/unknown input rejection; authenticated success; anon/public refusal; and low-privilege visibility.
10. Run focused SQL/static checks, preview dry-run, prove preview ref immediately before apply, apply preview, run behavior tests and capture `EXPLAIN (ANALYZE, BUFFERS)` with safe fixtures. Obtain independent review required by shared-db, open PR, merge it, and record merge SHA. Do not write dependent PopDAM code before this contract lands.
11. Production apply is a separate explicit owner gate. Present preview evidence and the exact migration/object/action to Albert in one request. After approval, use the shared-db bounded production promotion workflow; prove production ref immediately before apply and verify grants, signature, behavior and ledger.

Dependencies: Step 1 baseline only. Runs independently of Steps 2–3, but must complete before Step 5.  
**You'll know it worked when:** shared-db SQL tests and CI pass; preview returns the same ID/index as the old algorithm across the fixture matrix; the query is bounded and materially cheaper than the ID scan; PR is merged; and, after exact approval, production catalog/behavior/ledger show the migration applied.

**Natural context cut point:** shared-db orchestration should be its own session. Update this STATUS table and handoff after merge/preview and again after production promotion. Re-read Steps 5–6 before app integration.

### Phase C — OrderList integration and landing (Steps 5–6)

#### Step 5 — replace the OrderList ID scan with the RPC

1. Only after Step 4 is applied to the target environment, update `src/hooks/useOrderList.ts` `findOrderListRow` to normalize the existing `buildOrderListFilters` and `buildOrderListSort` outputs into the RPC input contract and call `public.find_dam_order_list_row` once.
2. Return `{ rowId, index }` or equivalent. The surrounding grid block will load through the existing datasource after `paginationGoToPage`/`ensureIndexVisible`; do not fetch the full matching row solely to identify it.
3. Update `src/pages/OrdersPage.tsx` to highlight by returned row ID. Preserve 300 ms debounce, stale-request cancellation, no-match message, active filter/sort semantics, page navigation and centered surrounding rows.
4. Keep the old `findOrderListRow` ID scan as a narrowly classified deployment-skew fallback only if the error proves the RPC is unavailable (`42883`/known missing-function schema-cache case). Never fall back for permission, malformed input, timeout or SQL errors. Emit one non-secret warning identifying fallback use. Remove the fallback after live production proof or create a dated cleanup issue with a short deadline.
5. Do not change `fetchOrderListBlock`, `fetchOrderListCount`, datasource search `""`, infinite row model, count caching or summary counts.

Dependencies: Step 4 production contract.  
**You'll know it worked when:** one debounced Find produces one RPC plus the ordinary destination grid-block request, no ID-range scan; a late match scrolls/highlights with surrounding rows; active filters/custom sorts produce the same ID/index as the database fixture; rapid typing cannot highlight a stale term; and no-match/permission failures are truthful.

#### Step 6 — ship, measure and close

1. Run focused lint, all tests and production build. Check `git diff --check` and `git var GIT_COMMITTER_IDENT` before the first commit.
2. Update `docs/MASTER_DATA.md` and `docs/ORDER_LIST.md` with the final loading and lookup contracts. Update this STATUS table after every phase with artifact paths/SHAs, never bare claims.
3. Commit owned PopDAM paths only, fetch/rebase if `origin/main` advanced, push to `main`, watch CI and `Publish Frontend Image` through success.
4. Verify live HTML/bundle contains the exact deployed SHA/build stamp and both `/styles` and `/orders` return healthy responses. A green Railway deployment is not frontend proof.
5. Perform signed-in production read-only/customer-safe QA on Licensed, Generic and OrderList: cold load, tab switch mid-load, cached return, Find before/after completion, column filter, saved view, edit-cancel path, default/custom sort and late OrderList Find. Do not save production edits solely for testing.
6. Repeat Step 1 traces using the same browser/network conditions. Acceptance targets: first 4,000 Master Data rows usable after the first request wave; final row counts unchanged; confirmed-unused fields absent; lower transferred bytes; OrderList Find uses one position RPC and highlights the correct row with context. Record actual timings rather than inventing a fixed percentage target.
7. If any acceptance fails, fix forward or revert the exact app commit. Database rollback is a new forward migration revoking/dropping the new function only if no deployed app depends on it; never edit/remove the applied migration.
8. Close PopDAM #121 only after production acceptance. Close shared-db #2665 per orchestrator rules only after its structure is merged/applied/verified. Delete this plan's handoff file when every obligation it describes is proven complete; keep or update the plan as durable history according to repo convention.

Dependencies: Steps 2–5.  
**You'll know it worked when:** all acceptance artifacts, CI run IDs, shared-db merge/apply evidence, PopDAM commit and live screenshots/traces are linked from the STATUS table; both issues are correctly closed; and no unfinished handoff remains.

## 10. Tests required

### PopDAM unit/component tests

- Extend `src/test/master-data-loading.test.ts`:
  - four 1,000-row ranges form page one in stable descending order;
  - a short range stops pagination;
  - complete 4,000-row wave continues;
  - page offsets never overlap;
  - flattening pages has no duplicate IDs.
- Add `src/test/master-data-progressive-loading.test.tsx` or the nearest existing Styles-page test:
  - first 4,000 render while later promise is pending;
  - truthful partial-loading label;
  - later rows append and label completes;
  - tab switch cancels/ignores stale data;
  - realtime invalidation does not duplicate pages.
- Add/extend `src/test/master-data-column-contract.test.ts`:
  - explicit select contains every consumed `StyleRow` field;
  - confirmed-unused view fields are absent;
  - `row_data`, `match_notes`, `rfq_groups`, canonical display names and link IDs remain present.
- Extend `src/test/order-list.test.ts` for filter/sort payload normalization and exact search-column parity.
- Extend `src/test/order-list-block-count.test.ts` or add `order-list-find.test.ts`:
  - one RPC call returns row ID/index;
  - blank/no match;
  - custom filters/sort forwarded;
  - only missing-function error activates fallback;
  - permission/timeout/validation errors remain errors;
  - stale responses are ignored at page/component level.
- Preserve all existing grid/search/routing/edit tests, especially `order-list-grid.test.tsx`, `order-list-routing.test.ts`, `master-data-realtime.test.ts`, `master-data-pagination.test.ts`, and `master-data-column-contract.test.ts`.

### Shared-db tests

- Add a dedicated SQL contract file following current naming, e.g. `supabase/tests/dam_order_list_find_position_contract.sql`, with every case listed in Step 4.9.
- Run `scripts/check-sql.sh` and every repository-required migration, privilege, handoff and contract check named by the live shared-db `AGENTS.md`/CI.

### Commands that must stay green

- PopDAM: `npm test -- --run`
- PopDAM: `npm run build`
- PopDAM focused lint on owned files; existing unrelated warnings do not authorize broad cleanup.
- Shared-db: commands required by its live `AGENTS.md`, plus the new SQL contract test on preview.

## 11. Constraints, standing rules and gotchas

- Preserve concurrent work: inspect status, stage owned paths only, fetch/rebase rather than force-push, never broad reset/clean/stash.
- PopDAM changes go directly to `main`. Shared-db uses the one orchestrator, isolated worktree, branch and PR; the AI merges after gates.
- Every shared-db write requires immediate target proof. Production project is Virginia `qsllyeztdwjgirsysgai`; never the retired Ohio project.
- Albert's explicit approval is required for the exact production migration apply. Preview work and PR/merge do not imply production authority.
- Never increase statement timeouts, suppress errors, weaken RLS, use SECURITY DEFINER to bypass callers, or replace complete behavior with partial silent results.
- Master Data must remain editable by every signed-in user; do not narrow its policy.
- Do not add browser-side direct database SQL, migrations in PopDAM, or changes to generated types.
- `row_data` is not unused merely because individual keys are dynamic; almost every legacy grid column reads it.
- RFQ groups are a lateral aggregate in the view but customer-visible. Optimizing or splitting that database contract is outside scope unless measurements prove it dominates and Albert expands scope through a new governed issue.
- Partial Master Data must be labeled partial. Find/filter before full completion may operate on loaded rows, but the UI may not imply full-tab completeness.
- AG Grid packages must remain exactly version-aligned at 35.3.1.
- Visual QA is mandatory for UI changes. If the preferred browser controller is unavailable, repair/install the supported project-owned tool or use another approved visible browser; do not claim visual verification from HTTP 200.
- Never expose tokens, cookies, user row contents or licensed data in traces, screenshots, logs, issues or commits. Secrets live in 1Password vault `vibe_coding`.

## 12. Access and environment

- Local app checkout: `/worksp/popdam`; install with existing lockfile, run `npm run dev -- --host 127.0.0.1`, tests with `npm test -- --run`, build with `npm run build`.
- Canonical DB checkout: `/worksp/shared-db`. Do not work directly in its shared checkout; the orchestrator creates an isolated worktree.
- GitHub CLI is authenticated for `u2giants`; verify before mutation. Tracking issues already exist: PopDAM #121 and shared-db #2665.
- Supabase CLI access, project refs and database passwords are documented in `/worksp/shared-db/AGENTS.md`. Tokens/passwords are in 1Password vault `vibe_coding`, including `Supabase CLI Personal Access Token`, `Supabase DB Password - shared POP database`, and the current preview password item. Never put values in argv, chat, docs or commits; follow the repo's protected injection commands.
- Production frontend is `https://dam.designflow.app`. Use an existing dedicated signed-in test account from the approved 1Password item referenced by the app's auth/QA documentation; do not inspect personal browser state.
- Production infrastructure and database are read-only by default. The only planned production mutation is the exact new shared-db migration after Albert approves it in the current implementation chat.
- At plan creation, PopDAM `main` is `62967086`; implementation must fetch and re-check current heads, open issues, orchestrator marker and schema because these drift.

## 13. Definition of done, risks and open questions

### Definition of done

- [ ] First 4,000 Master Data rows render after the first four-request wave; the remainder loads in background with truthful status.
- [ ] Licensed/Generic final counts and ordering match production truth; no duplicates or omissions.
- [ ] Explicit Master Data projection excludes every confirmed-unused field and retains every required behavior.
- [ ] Before/after traces demonstrate actual first-use and payload improvement.
- [ ] Shared-db RPC is validated, allowlisted, invoker-secure, tested, preview-proven, reviewed, merged, explicitly production-approved, applied and ledger/catalog/behavior verified.
- [ ] OrderList Find uses one position RPC, respects current filters/sort/search scope, and highlights the correct row with surrounding rows.
- [ ] Required PopDAM/shared-db tests, lint/build and CI pass.
- [ ] Docs and this STATUS table are current with artifact-backed evidence.
- [ ] PopDAM commit is pushed/deployed and exact live frontend build is verified; signed-in visual QA passes.
- [ ] PopDAM #121 and shared-db #2665 are closed only after their acceptance gates; handoff is retired when nothing remains.

### Risks and rollback

- **Partial-data misconception:** users may treat early rows as the full tab. Mitigate with explicit loaded/total status; never hide it while incomplete.
- **Race/duplication:** tab switches, realtime invalidation or overlapping next-page calls may mix pages. Mitigate through query keys, cancellation and ID/order tests.
- **Projection regression:** a hidden save/status dependency may be omitted. Mitigate with code-derived contract tests and both-tab QA.
- **RPC semantic drift:** filter/sort/search mismatch could navigate to the wrong row. Mitigate with shared fixtures comparing old and new algorithms before removing fallback.
- **Dynamic SQL injection:** malformed column/operator inputs could become SQL. Mitigate with strict allowlists and rejection tests; never quote unchecked values into SQL.
- **Deployment skew:** app may deploy before PostgREST sees the RPC. Sequence database production first; retain only the narrowly classified temporary missing-function fallback.
- **Rollback:** frontend can revert `main` normally. Applied migrations are immutable; database rollback is a reviewed forward migration and only after dependency inspection.

### Owner decision required

Albert must explicitly approve applying the exact `public.find_dam_order_list_row` migration to production after preview evidence is ready. Recommendation: approve when shared-db tests, low-privilege permission proof, query plan and result-parity evidence all pass. This blocks Step 5 production integration and Step 6 closure, not Master Data Steps 1–3.

### Already settled — do not re-ask

- 2026-09-10: implement all three improvements under this one plan.
- 2026-09-10: show the first 4,000 Master Data rows, then background-load the rest.
- 2026-09-10: preserve full data and existing features; do not turn performance work into filtering or capability loss.
- 2026-09-10: route the OrderList lookup through governed shared-db; issue #2665 is already filed.

## Mandatory self-audit — PASSED

1. **Could a brand-new AI session execute this perfectly without asking for planning context? Yes.** Sections 1–5 define the business, repositories, runtime, trigger, scope and exact current state; Section 9 gives ordered file/function-level work and a verification gate for every step; Sections 10–12 provide tests, rules and access.
2. **Does the plan carry all current background, nuance and rejected paths? Yes.** Sections 6–8 preserve the root causes, costly findings, rejected designs and locked/open decisions, including why client-side Master Data and infinite OrderList must remain different.
3. **Is the ultimate goal sufficient for correct judgment if a step is wrong? Yes.** Section 1 states the customer outcome and explicitly makes the goal override conflicting steps; Sections 4 and 13 bound acceptable tradeoffs, risks and rollback.

Checklist result: all 13 sections are present; the plan is standalone; rejected approaches are explicit; every executable step names targets/dependencies/gates; locked versus open decisions are labeled; tests are named; secrets are location-only; landing includes commit/push/CI/deploy/live proof; and the plan/handoff/router/topic-doc links are reciprocal.
