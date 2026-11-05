# Plan: Audit backlog — correctness bugs (u2giants/popdam3#469)
Issue: https://github.com/u2giants/popdam3/issues/469
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Source of the findings: [`docs/audit-2026-10-21.md`](../audit-2026-10-21.md)
→ "Backlog (verified, not yet fixed) → Correctness". Issue #469 tracks that
list; its 2026-11-04 comments say most items were fixed "in #713" and leave
four ranked. **Verified 2026-11-04 against this worktree (HEAD `01fcfc34`) and
`origin/main` (`4409e2d3`): PR #713 is OPEN, not merged** (`gh pr view 713`:
state OPEN, mergeable, check `lint-test-build` SUCCESS, head
`73196e65`). So *nothing* attributed to #713 is on `main` yet. Step 1 of this
plan is therefore to land #713.

**Update 2026-11-04 6:05 PM EST: PR #713 merged 2026-11-04 5:12 PM EST as `2287f1b5`.** Sections saying "NOT on main" describe the pre-merge state. Confirmed on `origin/main`: all three terminal saves use `onlyIfRunning` (`operation-loop.ts:1297,1661,1818`); sentinel cap 16 MB (`ai-sentinel-detect.ts:37`); the merge touches `path-utils.ts`, `path-filters/index.ts`, `admin-api/index.ts`, the Tesseract files, `AgentSetup.tsx`, `useScanLifecycle.tsx`, `useAgentStatus.ts`, `AiTaggingSection.tsx` and the three loop-cap files. **No test for the Stop guard landed in #713**. Held test-only PR #785 now covers actual conditional persistence, real worker tick terminal refusal/history suppression, and the next tick preserving a user interruption; two tests and worker build pass. It is not live full-run Stop proof.

## STATUS — 2026-11-05

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Merge PR #713 (carries 12 findings incl. Stop-overwrite guard, .ai sentinel cap) and verify the deploys | 🟡 merged; deploy verification open | merged 2026-11-04 5:12 PM EST as `2287f1b5` |
| 2 | Download all: batch checkout token so every file opens | implemented; configured-machine outcome open | PR #761; Helper 1.4.15 installed/status verified, one launch, existing single-use tokens, maximum 50; actual batch checkout unproven |
| 3 | export-table / export-sql-dump: deterministic `ORDER BY` and page math | live export accepted | PR #761; authenticated pairings pages 6+0 and junction pages 7+7, unique composite identities/no overlap; coordinator independently repeated |
| 4 | rich-pdf: do not treat a failed extraction as done (RPC change in shared-db first) | reader and worker deployed; actual retry open | shared-db #5627/version 20261105041612 live, app #779 deployed; 11 cooldown tests pass; 246 live extractions contain zero saved failures, so no live retry candidate |
| 5 | StylesPage: targeted cache update on cell edit, dedupe realtime invalidation | frontend partial proof accepted; persisted save open | Settled intercepted save: one row read/zero grid reads. Actual save invokes global bridge writes; scoped shared-db #5640/#5639 prepared, not deployed |
| 6 | Update `docs/audit-2026-10-21.md` backlog + this STATUS; close #469 with evidence | ⬜ open | — |

Continue the same open #469: configured Helper outcome and actual failed-PDF retry remain unproven. Preserve the global Styles refresh capability; deliver the prepared bounded contract before a real synthetic-row UI save. All owned app/shared-db main merges are held until after 3:30 AM EST; never stop or reset the full tagging run.

---

## 1. The ultimate goal

Every correctness bug the 2026-10-21 audit found in PopDAM is either gone from
`main` with a test that keeps it gone, or recorded as consciously deferred
with a reason. Concretely for users: pressing **Stop** on a long worker job
stops it for good; "Download all" on an item actually checks out every file;
a data export never duplicates or drops rows; a PDF whose AI extraction
failed during an outage gets retried instead of being marked done forever;
editing one cell in the Styles grid does not re-download the whole grid.

**If a step conflicts with this goal, the goal wins — stop and flag it.** A
fix that hides the symptom (e.g. suppressing the error) is not a fix.

## 2. What this application is

PopDAM (`github.com/u2giants/popdam3`, identity `u2giants`, branch `main`):
internal Digital Asset Manager for licensed consumer-product art. Parts this
plan touches:
- Web app `src/` (React + Vite + TypeScript) at https://dam.designflow.app,
  deployed by Coolify from GHCR (`.github/workflows/publish-frontend.yml`).
- Railway worker `apps/worker/` (Node; auto-deploys on push to `main`); runs
  long operations through `apps/worker/src/operation-loop.ts` and handlers
  under `apps/worker/src/handlers/`.
- Supabase edge functions `supabase/functions/**` (Deno), deployed by
  `.github/workflows/deploy-supabase.yml` to project `qsllyeztdwjgirsysgai`.
- Desktop helper `apps/popdam-helper/` (Electron, Windows/macOS) that handles
  `popdam://` deep links for file check-out/check-in.
- Database schema is owned by `popcre/shared-db` (`/worksp/shared-db` on hetz;
  a read-only copy is synced into `shared-db/` here).
CI: `.github/workflows/ci.yml` runs root `npm ci && npm run lint && npm run
typecheck && npm run test`, worker build+test, windows-agent test, `npm run build`.

## 3. What triggered this work

The 2026-10-21 five-reviewer audit (`docs/audit-2026-10-21.md`) fixed one set
of bugs in its PR and left a verified backlog; #469 is the correctness part.
On 2026-11-04 a session re-verified the list, opened PR #713 for the
mechanical ones, and left four ranked items plus the Stop-overwrite guard
(which #713 also carries). This plan picks up from there.

## 4. Scope

**In:** the five correctness items below, PR #713's landing, the regression
tests, the audit-doc update, closing #469 with evidence.

**NOT in this plan:**
- Efficiency items (#470, `docs/plans/issue-470-audit-efficiency-backlog.md`).
- Security items (`admin-api`, `browse_dir`, `claim-render`, helper deep-link
  tokens) — separate issue; not re-verified here.
- Dead-code/duplication cleanup.
- Items the 2026-11-04 comment marks **disproved**. `ResourceAndPolling` (issue scope: verify-or-drop) was verified and dropped: `ResourceAndPolling.tsx:48-58` syncs on `[loaded]`, and `loaded` is the query's `data` object, which React Query keeps by reference when a refetch returns identical content. A sibling card's invalidation therefore does not reset unsaved edits; only a real change to `RESOURCE_GUARD` does, which is acceptable. `PopSGLibraryPage` search debounce: the issue scope says fixed; do not reopen without new evidence.
- Any new helper feature beyond the batch checkout (no UI redesign).
- Any DB change in this repo (step 4's RPC change goes through shared-db).

## 5. Current state — finding by finding (verified 2026-11-04, file:line)

**A. Worker terminal writes overwrite a user Stop** — *fixed in #713, NOT on main.*
`apps/worker/src/operation-loop.ts` on HEAD: the legacy-op failure save at
`:1288` is `persistOpState(opKey, failedState)` with no `onlyIfRunning`; the
auto-stop save (~`:1650`) and the completion save (~`:1804`) likewise. #713's
diff adds `{ onlyIfRunning: true }` to all three (`gh pr diff 713`, hunks at
`@@ -1283`, `@@ -1647`, `@@ -1801`). The revision-guarded path already exists
for other saves (`persistOpState(..., { onlyIfRunning: true, expectedRevision })`
at `:1263-1265`). Nothing more to design; merge #713 and add the test in §10.

**B. `.ai` sentinel 100 MB read** — *fixed in #713* (`apps/bridge-agent/src/ai-sentinel-detect.ts`
in its file list; the issue's correction comment says the cap is now 16 MB).
Covered by step 1.

**C. "Download all" launches only the first file** — *still present.*
`src/components/library/StyleGroupDetailPanel.tsx:386-392`
`handleDownloadAll()` loops `groupAssets` and awaits
`handleAssetCheckout(asset.id)` (`:353-366`), which calls
`helper-api/tokens` with `{action:"checkout", asset_id}` and then sets
`window.location.href = data.url` (`:362`). Each iteration replaces the
navigation; browsers hand only one `popdam://` launch to the OS. Server side
`supabase/functions/helper-api/index.ts:182-241` `handleCreateToken` builds a
single-asset token (`helper_tokens` row: `id, user_id, action, asset_id,
checkout_id, consumed_at, expires_at` — `shared-db/types/database.types.ts:42833-42843`)
and `handleStartCheckout` (`:243-300`) consumes it atomically
(`.is("consumed_at", null)` at `:280`). The helper parses one `assetId`
(`apps/popdam-helper/src/main/protocol.ts:36-54`) and calls
`checkout(token, assetId)` (`checkoutManager.ts:122`) which posts
`/checkouts/start` (`damClient.ts:128`).

**D. Export functions page without `ORDER BY`** — *still present.*
`supabase/functions/export-table/index.ts:77`
`tableSource(db, table).select("*").range(offset, chunkEnd)` — no `.order()`;
`page_size` (`:54`, default 50 000, cap 50 000) is walked in 1 000-row chunks
from `page*pageSize` (`:70-86`) and stops when `rows.length < targetRows` is
false, so a `page_size` that is not a multiple of 1 000 over-fetches up to 999
rows into the page (the trailing chunk is pushed whole, `:84`).
`supabase/functions/export-sql-dump/index.ts:142-144` same pattern, no order,
`chunk_size` capped at 10 000 (`:132-135`). Postgres gives no stable order
without `ORDER BY`; concurrent writes or a plan change can duplicate/drop
rows across chunks. Table list / source resolver:
`supabase/functions/_shared/export-tables.ts:8` `tableSource`.

**E. rich-pdf marks failed extractions done** — *still present; needs shared-db.*
`apps/worker/src/handlers/rich-pdf.ts:247-256` reads
`get_pdf_rich_extraction_hashes` → `{asset_id, source_text_sha256}` only;
`:262-268` skips any asset whose stored hash equals the text hash. The catch
branch `:309-323` upserts the **same hash** with `p_data: {}` and
`p_parse_error: <message>`. Result: after one provider outage the asset is
skipped forever. The RPC (`shared-db/supabase/migrations/20260715210000_dam_rich_pdf_rpc_access.sql:10-19`)
selects only two columns from `dam.pdf_rich_extraction`, which does have a
`parse_error text` column (`…20260715183000_dam_rich_pdf_extraction.sql:35`).
The RPC is `security definer`, execute granted to `service_role` only
(`:66`), and listed in the public-execute lockdown allow-lists
(`…20260729120000…:220`, `…20260729130000…:139`).

**F. StylesPage over-invalidation** — *still present.*
`src/pages/StylesPage.tsx:66-73` `rowsQuery = useInfiniteQuery({queryKey:
["style-rows", active.name], queryFn: fetchRowsPage(...)})` (pages flattened
at `:92`, auto-fetches every page `:95-99`). Cell edit mutation `onSettled`
`:288-291` invalidates `["style-rows"]` (every sheet) and
`["style-cell-audit"]`; the realtime subscription `:156-175` invalidates the
same keys again on the resulting `UPDATE` event (`:166-167`). Net effect: one
cell edit refetches all pages of the grid twice. `addRow`/`deleteRow`
(`:312-314`, `:331`, `:365`, `:386`) are coarser but legitimately change row
sets.

Other items in the audit's correctness list (`normalizeRelativePath`,
`shouldSkipPath`, `set-user-apps`, Tesseract `finally`, `ensureRootMarkers`,
`AgentSetup` poll, scan wording, counters, rate label, loop caps, thumbnail
manifest order) are in #713's file list; verify at merge, not here.

## 6. Key findings and root causes

- The issue's "fixed in #713" wording hides that #713 is unmerged. Anyone
  closing #469 before merging it closes bugs that are still live. (Checked
  with `gh pr view 713 --json state` on 2026-11-04.)
- C's root cause is architectural, not a loop bug: the `popdam://` scheme
  launch is one-per-navigation, and the token is one-per-asset and
  single-use. A fix needs a token that carries **many** asset ids and a
  helper that iterates them.
- D's `.range()` without `.order()` is undefined order in PostgREST/Postgres;
  the primary key of every exportable table is `id` (uuid) — ordering by `id`
  is enough for stability and uses the PK index.
- E needs the RPC to expose `parse_error` (or the worker to stop writing the
  text hash on failure). Writing a *different* sentinel hash on failure would
  retry every tick forever (hot loop) — the original reason the code wrote
  the hash. Correct behavior: retry failed rows but **bounded** (see §8).
- F: TanStack Query supports `setQueryData` on the infinite cache; the edited
  row's new values are known client-side, so no refetch is needed for a
  successful cell edit.

## 7. Approaches considered and REJECTED

- **Open one tab per asset for Download all** (`window.open` per URL) —
  rejected: pop-up blockers and the OS still coalesce custom-scheme launches;
  users would get N blocked-popup warnings.
- **Loop with a delay between navigations** — rejected: timing-dependent,
  still drops launches on Windows, no proof of delivery.
- **rich-pdf: write an empty hash on failure so it retries** — rejected: a
  permanently broken PDF or a dead provider would be retried every tick
  (hot loop), the exact reason the hash write was added
  (`rich-pdf.ts:309` comment).
- **rich-pdf: fix only in the worker by also reading `dam.pdf_rich_extraction`
  directly** — rejected: `dam.*` is not exposed to PostgREST
  (`rich-pdf.ts:245-246` comment); it has to go through a public RPC, and
  RPCs are shared-db territory.
- **Export: add `ORDER BY created_at`** — rejected: not unique, ties
  re-order; `id` (PK) is unique on every table in `export-tables.ts`.
- **StylesPage: debounce the invalidations** — rejected: still refetches the
  whole grid; the goal is no grid refetch on a successful single-cell save.

## 8. Design decisions

LOCKED:
- 2026-11-04: #713 lands as-is first (step 1); do not fold its hunks into a
  new PR.
- 2026-11-04 (C): new helper-api token action `checkout-batch` carrying
  `asset_ids[]` in a new nullable column **only if** shared-db agrees;
  otherwise encode the ids in the existing `checkout_id`-free row by issuing
  one `helper_tokens` row per asset and one `popdam://checkout-batch?tokens=
  t1,t2,…` URL. **Choose the latter** (no schema change): it reuses the
  single-use token semantics per asset and needs no shared-db work. The URL
  length stays under 2 KB for ≤ 50 assets (32 hex + 1 per token); cap the
  batch at 50 and tell the user when a group has more.
- 2026-11-04 (D): order by `id` ascending in both export functions; make
  `page_size` chunk math exact (never push past `targetRows`).
- 2026-11-04 (E): the RPC gains `parse_error` and `extracted_at` columns in
  its return; the worker retries a failed row only when
  `parse_error is not null` **and** `extracted_at` is older than
  `RICH_PDF_RETRY_AFTER_HOURS` (default 24). Bounded retry, no hot loop.
- 2026-11-04 (F): on cell-edit success, update the edited row inside the
  `["style-rows", active.name]` infinite cache with `setQueryData`; the
  realtime handler ignores `UPDATE` events whose `commit_timestamp` is within
  2 s of a local save of the same row id (keep a `recentLocalSaves` Map).
  Audit-log key invalidation stays (it is small).

OPEN:
- (C) Whether the helper opens each file after checkout or only the first;
  default: check out all, open none, show a tray notification "N files
  checked out". Albert may prefer opening — ask only if the helper's
  existing `open_after_checkout` flag (`checkoutManager.ts:140`) makes one
  behavior free.
- (E) Exact retry window (24 h default).

## 9. The plan

**Step 1 — land PR #713.** Verify its branch is still mergeable against
`origin/main` (`gh pr view 713 --json mergeable`), run
`ai-pr-wait 713 --repo u2giants/popdam3` in the background, merge with
`gh pr merge 713 --squash --delete-branch`. Then: Railway worker deploy
picks up `operation-loop.ts` automatically; the edge functions deploy via
`deploy-supabase.yml` (it touches `admin-api`, `agent-api`,
`export-thumbnail-manifest`); the frontend via `publish-frontend.yml`; the
bridge agent via `publish-bridge-agent.yml` (`ai-sentinel-detect.ts`,
`path-tools.ts`); the Windows agent via `publish-windows-agent.yml`.
Gate: merge SHA on `main`; the four workflow runs green
(`gh run list --workflow <file> -L 1`); dam.designflow.app header shows the
SHA. Add the regression test for A (§10) in step 2's PR if #713 lacks one
(`gh pr diff 713 | grep -c "onlyIfRunning" ` in a test file — if 0, write it).

**Step 2 — Download all (C).** Files:
- `supabase/functions/helper-api/index.ts` `handleCreateToken` (`:182-241`):
  accept `action: "checkout-batch"` with `asset_ids: string[]` (1–50, uuids,
  deduped). Verify each asset exists and is not locked by another user
  (reuse the two queries at `:200-217`, batched with `.in("id", ids)`), insert
  one `helper_tokens` row per asset with `action: "checkout"` (unchanged
  consumer path), return `url: popdam://checkout-batch?tokens=<t1,t2,…>` and
  `skipped: [{asset_id, reason}]` for locked/missing ones.
- `apps/popdam-helper/src/main/protocol.ts:36-54`: parse `checkout-batch`
  with `tokens` (split on `,`, each `/^[0-9a-f]{32}$/`), add it to the
  allowed-action list at `:48`; dispatcher `:78+`: for each token call
  `checkout(token)` sequentially, collect failures, show one summary via the
  existing failure/notification helpers (`:18-30`).
- `src/components/library/StyleGroupDetailPanel.tsx:386-392`: call
  `helper-api/tokens` once with `{action:"checkout-batch", asset_ids}`, set
  `window.location.href = data.url`, toast the count and any `skipped`.
Gate: unit tests §10; manual: on a Windows machine with the helper installed
— **not available on hetz**; the live proof for this step is done by the
helper's own release path: build the helper (`npm --prefix
apps/popdam-helper run build` in CI), install on the Windows render box
(the windows-agent host — see `docs/1password.md` for its RDP item) and click
Download all on a 3-file item: three check-outs appear in the tray. Record
a screenshot. Until that exists the step is "code landed, not accepted" with
`- [ ] live proof (Download all)` on #469.

**Step 3 — Export ordering (D).**
- `supabase/functions/export-table/index.ts:77`: `.order("id", { ascending: true }).range(offset, chunkEnd)`;
  compute `const want = Math.min(CHUNK, targetRows - rows.length)` and
  `range(offset, offset + want - 1)` so the page never exceeds `page_size`.
- `supabase/functions/export-sql-dump/index.ts:142-144`: same `.order("id")`
  and `want = Math.min(POSTGREST_PAGE, chunkSize - rows.length)`.
- Extract the loop into `supabase/functions/_shared/export-tables.ts`
  `fetchOrderedRows(db, table, from, limit)` used by both, so one test covers
  both.
Gate: Deno tests §10 green (`deno test supabase/functions/_shared/`); after
deploy, `curl` `export-table?table=licensors&page_size=1500&format=json`
twice with the service key from 1Password (`vibe_coding` → the Supabase
service-role item named in `docs/1password.md`) → identical `data[].id`
sequences and `rowsInPage === 1500`.

**Step 4 — rich-pdf retry (E).** Two halves, shared-db first:
4a. In `/worksp/shared-db` (claim-first on its existing rich-PDF issue; load
`shared-db-change` and `supabase-postgres-best-practices`): new migration
`create or replace function public.get_pdf_rich_extraction_hashes(p_asset_ids uuid[]) returns table (asset_id uuid, source_text_sha256 text, parse_error text, extracted_at timestamptz)`
— same body plus the two columns; same `security definer`, `search_path`,
and `grant execute … to service_role`. Adding return columns is
backward-compatible for the worker (it ignores extras). It reaches production
only through shared-db's automatic promotion workflow; never run SQL by hand.
4b. `apps/worker/src/handlers/rich-pdf.ts:247-268`: read the two new fields;
`work` filter becomes: process when hash differs **or** (`parse_error` set
and `extracted_at < now - RICH_PDF_RETRY_AFTER_HOURS`). Export a pure
`shouldRetryExtraction(existing, hash, now)` for tests. Constant
`RICH_PDF_RETRY_AFTER_HOURS = 24` in the same file.
Dependency: 4b must not merge before 4a is live in production (the worker
would just not retry until then — harmless — but the plan's proof needs it).
Gate: worker tests §10; after both deploy, the worker log shows a previously
failed asset re-extracted (`rich-pdf extract failed` earlier, then processed).

**Step 5 — StylesPage (F).** `src/pages/StylesPage.tsx`:
- Cell edit mutation (`:270-300`): in `onSuccess`, `queryClient.setQueryData(["style-rows", active.name], pages => pages with the row replaced by {...row, ...buildUpdate(...)})`;
  keep `["style-cell-audit"]` invalidation; drop the `["style-rows"]`
  invalidation from `onSettled` (keep it in `onError` so a failed save
  resyncs).
- Realtime handler (`:160-171`): keep a `useRef(new Map<string, number>())`
  of `rowId → Date.now()` written in `onSuccess`; skip `UPDATE` events for
  ids saved < 2 s ago. Extract `shouldIgnoreRealtimeUpdate(map, id, now)` to
  `src/lib/master-data-loading.ts` for a unit test.
Gate: tests §10; dev-server check: edit a cell, Network tab shows no
`style_tracker_rows?...` page refetch; the cell shows the new value.

**Step 6 — close.** Update `docs/audit-2026-10-21.md` backlog: strike each
fixed line with the PR number, as the security section already does
(`:85-88` pattern). Update this STATUS. Comment on #469 with the merge SHAs,
test names and the one remaining `- [ ] live proof (Download all)` if the
helper install is still pending; sign with `$AI_GH_SIGNATURE`. Close #469 only
when every row cites an artifact.

Steps 2, 3, 4a, 5 are independent — separate small PRs, parallel sessions
allowed. Context cut: after step 1.

### Adversarial-cases table (trust boundaries: deep-link URL, export query params, provider output)

| Input | Hostile case | Required behavior | Test |
|---|---|---|---|
| `popdam://checkout-batch?tokens=` | empty / 51 tokens / non-hex / duplicate | reject with a user-visible failure, nothing checked out | `parseDeepLink rejects malformed batch tokens` |
| helper-api `asset_ids` | 0, 51, non-uuid, duplicates, one locked by another user | 400 for shape errors; locked ones reported in `skipped`, rest proceed | `checkout-batch validates ids and reports skipped` |
| one token already consumed | replay of the batch URL | `/checkouts/start` returns 401 for it; helper reports 1 failed, N-1 ok | `batch continues past a consumed token` |
| `page_size` | `0`, `-5`, `abc`, `99999999` | clamp to 1..50000; never NaN loop | `export page_size is clamped` |
| `page_size=1500` | not a multiple of 1000 | exactly 1500 rows, ordered by id | `export page is exact and ordered` |
| rich-pdf RPC row | `parse_error` set, `extracted_at` 1 h ago | skip (bounded retry) | `shouldRetryExtraction waits out the retry window` |
| rich-pdf RPC row | `parse_error` set, 25 h ago | retry | `shouldRetryExtraction retries after the window` |
| rich-pdf RPC row | missing `parse_error` field (old RPC) | behave as today (hash-only) | `shouldRetryExtraction tolerates the old RPC shape` |
| realtime UPDATE | same row saved locally 1 s ago | ignored | `shouldIgnoreRealtimeUpdate drops echoes of a local save` |
| realtime UPDATE | other user's edit of the same row 10 s later | applied (invalidate) | `shouldIgnoreRealtimeUpdate keeps foreign updates` |
| operation-loop | user Stop lands between last batch and completion write | op stays `stopped`, no auto-resume | `terminal writes are skipped when the op is no longer running` |

## 10. Tests required

- `apps/worker/src/operation-loop.test.ts` (node:test, exists): `terminal
  writes are skipped when the op is no longer running` — stub `persistOpState`
  to return false for `onlyIfRunning` and assert `recordStyleGroupTerminalOutcome`
  is not called.
- `apps/worker/src/handlers/rich-pdf.test.ts` (node:test; imports at `:1-9`):
  the three `shouldRetryExtraction …` tests.
- `supabase/functions/_shared/export-tables.test.ts` (new, Deno):
  `export page is exact and ordered`, `export page_size is clamped` — stub
  the client builder and assert `.order("id")` and the ranges requested.
- `supabase/functions/helper-api/helper-api.test.ts` (new, Deno, pure
  validator extracted as `validateBatchCheckoutBody`): `checkout-batch
  validates ids and reports skipped`.
- `apps/popdam-helper/src/main/protocol.vitest.ts` (new, same style as
  `pathSafety.vitest.ts`): `parseDeepLink rejects malformed batch tokens`,
  `batch continues past a consumed token` (checkout stubbed).
- `src/test/styles-page-cache.test.ts` (new, vitest): the two
  `shouldIgnoreRealtimeUpdate …` tests and `cell save updates the cached row
  without refetch` (render with a `QueryClient`, spy on `fetchRowsPage`).
- Existing suites stay green: root `npm test`, `npm run typecheck`, `npm run
  lint`, worker `npm test --prefix apps/worker`, `npm run build`.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main` per step; never push to `main`; the AI
  merges; CI waits with `ai-pr-wait` in the background.
- **Schema/RPC changes never in this repo** — step 4a in `popcre/shared-db`,
  claim-first, `shared-db-change` skill, automatic promotion only.
  Production DB is read-only by default; never run the migration by hand.
- No symptom suppression: do not catch-and-ignore export errors or realtime
  errors.
- Edge functions are Deno: `deno test` for the new tests; CI does not run
  them today — run locally and paste the output in the PR body.
- The helper cannot be exercised on hetz (Linux). Say so in STATUS; keep the
  live-proof checkbox on #469.
- `export-table`/`export-sql-dump` are admin-only (service key); test them
  with the key loaded through 1Password `op run`, never pasted.
- Worker tests use `node:test` (`apps/worker/src/**/*.test.ts`), not vitest.
- Sign GitHub posts with `$AI_GH_SIGNATURE`; times in EST.

## 12. Access and environment

- hetz; canonical `/worksp/popdam` is landing-only — one worktree per PR.
- `gh` as `u2giants`; `ai-pr-wait`, `ai-task-gates` on PATH (`/usr/local/bin`).
- Supabase MCP (`mcp__supabase__*`) points at project `qsllyeztdwjgirsysgai`
  for read-only checks (`execute_sql` with `select`).
- Secrets: 1Password vault `vibe_coding` — Supabase service-role item and the
  Windows render-box RDP item as named in `docs/1password.md`.
- Tester login: `vibe_coding` → "DAM AI tester login - PopDAM (designer,
  dam.designflow.app, production)".
- Shared-db checkout: `/worksp/shared-db` (landing-only; worktree for 4a).
- Local: `npm ci && npm run dev` (port 8080); worker `npm ci --prefix apps/worker && npm test --prefix apps/worker`.

## 13. Definition of done, risks, open questions

Done: #713 merged and deployed; steps 2-5 merged with the named tests;
shared-db migration promoted (4a) and the worker observed retrying a failed
asset; `docs/audit-2026-10-21.md` updated; #469 closed with SHAs, or left
open only for the helper live-proof checkbox.

Risks: (a) #713 may conflict with the three tagging commits on `main` since
its branch — rebase, re-run CI; (b) batch deep link on macOS: Electron's
`open-url` passes one URL — fine; (c) shared-db promotion may wait on its
own gates — the worker half is safe to merge first; (d) `setQueryData` shape
must match `flattenMasterDataPages` (`src/lib/master-data-loading.ts:95`) or
the grid blanks — covered by the cache test.
Rollback: revert the squash commit per step.

Open: §8 OPEN items (open-after-checkout behavior; retry window).

## Self-audit

1. **Fresh session, no questions?** Yes — §5 gives each finding's exact
   lines and state (including the unmerged #713), §9 gives file-level edits
   with gates, §12 names every tool and secret location.
2. **All background and rejections?** Yes — §6 explains the root causes
   (one-launch-per-navigation, undefined order, hash-on-failure hot-loop
   trade-off), §7 lists six rejected approaches, §8 dates the locked choices.
3. **Goal clear enough to steer?** Yes — §1 states the user-visible outcome
   per bug and the no-symptom-suppression rule.

Execution correction: `asset_characters` has composite identity `(asset_id, character_id)` and no `id`; exports order by both columns. Styles edits reload one canonical row, including bridge-derived and computed licensing fields, rather than merging incomplete raw realtime data. No full-grid reload occurs for UPDATE.
