---
issue: 100
status: OPEN
owner: hetz/claude session 2026-08-27 — measured and diagnosed; the fix is not started
---

# PopDAM `/orders` reaches the 8-second database ceiling on a cold load, and the cause is one query

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert Hazan in ONE message before starting. Do not meet
these one at a time.

**Blocking**

1. **Which fix to take — and one of the three changes the number staff see.**
   The page shows "24,486 shown of 24,486 lines". Getting that number costs 3.4
   seconds and is what pushes the page over the limit.
   - **(a) Make the count cheap and keep it exact.** A new function in the shared
     database that checks permission once instead of once per row. *Recommended.*
     Best outcome, and the number staff see never changes. Costs a shared-database
     change: branch, pull request, review — roughly a session's work.
   - **(b) Show an approximate total for the unfiltered list.** No database change,
     an hour of work — but the headline number becomes "about 24,000" rather than
     exact, until someone filters or searches, where it stays exact and fast.
     **This is the only option that changes what staff read on screen, so it needs
     the owner's word, not a developer's.**
   - **(c) Keep a small running total, refreshed on a schedule.** Exact and fast,
     but it is another moving part that can silently go stale.
   *Blocks everything: step 1 in §6 is choosing.*

**A wrong guess is recoverable, but ask before spending the effort**

2. **Is this urgent, or is honest degradation good enough for now?** Today the
   page does NOT lose data or lie when it happens: the rows still render, the
   total honestly reads "of more", and a red banner names the cause. One load in
   seven during the 2026-08-26 pass. *Recommendation:* schedule it deliberately
   rather than treating it as an incident — but do not leave it indefinitely,
   because the cost grows with the table and will eventually break the page
   outright rather than degrade it.
3. **Should the same treatment be applied to the other big grids?** Master Data
   and Styles read comparable row-level-permission views. Nobody has measured
   them. *Recommendation:* measure them once the OrderList fix proves out; do not
   widen the scope now.

**Not part of this work and nobody is on it**

4. **`shared-db/plan_popdam_order_list.md` still has a stale status table** that
   tells a cold reader this whole workstream is blocked, when it shipped.
   Filed as `u2giants/shared-db#1639`. It must be corrected through that repo's
   pull-request workflow. *Recommendation:* whoever next opens a `shared-db`
   session should clear it; it has now cost two sessions time.

**Already settled — do NOT re-ask**

- **2026-08-26, Albert:** everyone signed in may read OrderList data; writes stay
  administrator-only.
- **2026-08-26, this session:** rows and the exact count are permanently TWO
  requests. Re-merging them reintroduces the original outage. `docs/KNOWN_QUIRKS.md`
  #75 and `src/test/order-list-block-count.test.ts` hold that line.
- **2026-08-27, Albert:** the missing AG Grid Enterprise licence key is
  **deliberately out of scope** and is not to be raised again as part of this work.

## 1. What this application is

**PopDAM** is POP Creations' internal Digital Asset Management web app. Albert
Hazan owns POP Creations; the users are POP's internal staff — designers, sales,
licensing, administrators. It manages art assets, style guides and product Master
Data for licensed merchandise.

- **App repo:** `u2giants/popdam3` — React + TypeScript + Vite + AG Grid.
  **Trunk-based: `main` only, no feature branches for app code.** This checkout:
  `/worksp/popdam` on the `hetz` Ubuntu VPS. **Albert does ~99% of PopDAM work on
  this VPS** — search here first.
- **Sister app:** **PopSG**, a style-guide viewer served from the SAME codebase,
  switched by the `IS_POPSG` build flag. PopDAM-only screens must stay out of
  PopSG's routes and navigation, with a contract test proving it.
- **Live URLs:** PopDAM `dam.designflow.app`, PopSG `sg.designflow.app`.
- **Deploy path:** commit to `main` → GitHub Actions → GHCR image → Coolify.
  **Pushing to `main` deploys. There is no staging gate and no preview
  environment** — the preview branch project referenced in older notes is dead.
- **Shared database:** Supabase project **`qsllyeztdwjgirsysgai`** (production,
  Virginia), shared with PopPIM, PopCRM and DesignFlow. **All schema changes are
  authored in `u2giants/shared-db`** via branch + pull request + timestamped
  migration, never from this repo; CI (`shared-db-guard.yml`) fails DDL added here.

**`/orders`** is the page that replaced OrderList, the legacy Google Sheet POP
used to track production orders — purchase orders to factories, with status,
vendor, dates, customer, style, quantity, shipping and tracking. It is live and
in use, holding 24,486 order lines.

## 2. What we set out to do this session, and why

Albert asked for a **human pass over the live `/orders` write paths** — cell
editing, the order editor, manual relink and saved views had never been used by a
person against real orders. That work is **finished and closed** (issue #99): all
seven checklist items pass, four defects were found and fixed, and every change
made to production during the pass was reverted.

**This handoff is the one loose end Albert asked to be carried forward:** during
that pass the page hit the database's 8-second per-statement limit on a cold
load. He asked for it written up properly rather than left in a closing comment.

The objective now: **stop `/orders` from approaching the 8-second ceiling at all.**

## 3. Current state — what is true right now

### The problem, measured

Run against production as the `authenticated` role — the role the browser
actually uses — on **2026-08-27**:

| Query | Cost |
|---|---|
| `select count(*) from api.dam_order_list` — the unfiltered exact total | **3,365 ms** |
| `… where item_id is not null` | 403 ms |
| `… where master_data_match_status = 'ambiguous'` | 14 ms |
| `… where item_id is null and master_data_match_status not in ('not_applicable','ambiguous')` | 15 ms |
| one 100-row block with the full column list | 107 ms cold, 8 ms warm |
| `statement_timeout` for `authenticated` | **8,000 ms** |

**The rows are not the problem. The unfiltered total is.** It was ~2,200 ms when
quirk #75 was written on 2026-08-26 and is **3,365 ms a day later** — it scales
with the table, and it runs on every single page load.

Reproduce the measurement exactly:

```bash
psql "$PGURL" -c "set role authenticated; \timing on" -c "select count(*) from api.dam_order_list;"
```

Measure as `authenticated`, **never as `postgres`** — `postgres` has no statement
timeout and its numbers are misleading, which has already fooled one session.

### What the user actually sees when it happens

Observed **once in seven** consecutive cold loads on 2026-08-26:

- the grid still renders its rows;
- the pager reads **"1 to 100 of more"** instead of a total — honest, never a
  fabricated 0;
- a red banner appears: `Could not load OrderList: canceling statement due to
  statement timeout`;
- the summary counts above the grid still populate, because they are separate,
  cheaper calls. **That split is the tell** that it is the count and not the rows.

Six of seven loads were clean, and a later run of five consecutive loads was
clean. It is intermittent and load-dependent, not deterministic.

### Where the code is

- `src/hooks/useOrderList.ts`
  - `ORDER_LIST_SELECT` — the column list each block requests.
  - `fetchOrderListCount()` — the separate, best-effort exact count, cached per
    filter/search result set in `orderListCountCache`. Returns `null` on failure,
    never 0.
  - `fetchOrderListBlock()` — fires rows and count as **two** requests via
    `Promise.allSettled`; the rows decide success.
  - `fetchOrderListStatusCounts()` — the summary bar. Fires **four** whole-dataset
    exact counts in parallel on every page load. The first of those four is the
    3.4-second one.
- `src/pages/OrdersPage.tsx` — `datasource.getRows` sets `loadError`, which is
  what renders the red banner.
- `src/test/order-list-block-count.test.ts` — five tests that lock the rows/count
  split in place.

### Status of the work

- **Nothing has been changed for this issue.** It is measured and diagnosed only.
- The human pass that found it is **complete and shipped**: commits `1a593dab`,
  `cd44efee`, `c66477d3`, all on `main`, all pushed to both remotes, all CI green,
  196 tests passing, live at build `cd44efe`.
- **Production data is exactly as it was before the pass:** 3,212 orders (0
  voided), 24,010 lines (23,997 `matched`, 13 `not_applicable`), 0 saved views.

## 4. Everything we tried that did NOT work

- **Re-merging the rows and the count into one request — DO NOT DO THIS.** It is
  the original outage: PostgREST computes an exact count in the *same statement*
  that returns the rows, so one request paid for both and the whole grid died over
  one number. Fixed in `47a42e92`, written up as quirk #75, and locked by
  `src/test/order-list-block-count.test.ts`. It will look like an obvious
  round-trip saving to a fresh reader. It is not.
- **Measuring the count as `postgres`.** It has no statement timeout, so the query
  simply completes and looks fine. Use `set role authenticated`.
- **Assuming a local-works / live-fails split is flakiness.** On 2026-08-26 the
  page worked in local development against the SAME production database minutes
  before failing live. It was a real ceiling that local timing sneaked under.
- **The Supabase MCP is `Unauthorized` on this machine** ("provide a valid access
  token"). Standing condition, not a new breakage, and NOT a dead end — use `psql`
  (§8). Do not burn time re-authenticating it.
- **PostgREST cannot reach the `plm` schema.** A service-role request with
  `Accept-Profile: plm` returns **406** for both table reads and RPC calls. Only
  `api.dam_order_list` and the `public` RPCs are reachable from a client.
- **Playwright is not a dependency of this repo.** `npx playwright` fetches it
  transiently but `import { chromium } from "playwright"` then fails with
  `ERR_MODULE_NOT_FOUND`. Install it into a scratch prefix and run with
  `NODE_PATH=<prefix>/node_modules` rather than adding it to `package.json`.
- **This worktree has no `node_modules` of its own.** `vitest` and `tsc` resolve
  up to `/worksp/popdam/node_modules` and work, but `vite build` does not —
  it fails with `Could not load .../node_modules/react/jsx-runtime`. Symlink it:
  `ln -s /worksp/popdam/node_modules node_modules` (and make sure you are not
  creating `node_modules/node_modules`, which is what `ln -sfn` does when the
  directory already exists).

## 5. Root causes and key findings

- **The cost is row-level security, re-evaluated per row.** `api.dam_order_list`
  is declared **security invoker**, so counting all 24,486 rows re-checks every one
  of them against the policies on `plm.production_order`,
  `plm.production_order_line`, `core.customer`, `core.factory` and `plm.item`.
  Defined in `shared-db/supabase/migrations/20260810010000_popdam_order_list_contract.sql`
  and hardened by `20260810110000_warner_grants_rls_and_dam_order_list_invoker.sql`.
  The other three summary counts are cheap **only because their filters shrink the
  set before the per-row checks**, which is why they are 14–400 ms rather than
  3,400 ms. The unfiltered count has nothing to shrink it.
- **Therefore the fix must remove the per-row work, not shave the query.** Adding
  an index will not help; the cost is authorization, not lookup. A `security
  definer` function that applies the same authorization rule ONCE, then counts, is
  the direct answer — and because the read ruling is "every signed-in user may see
  OrderList data" (settled 2026-08-26), that single check is genuinely simple.
- **The exact total is the only expensive thing on the page.** Rows are 8–107 ms.
  Any fix that makes the unfiltered total cheap — or stops demanding it exactly —
  removes the whole problem.
- **Filtered and searched result sets are already fine** and must stay exact: they
  are the case where a user genuinely needs to know how many matches there are, and
  they cost milliseconds. Only the unfiltered "how many rows are there in total"
  is expensive.
- **The page already degrades honestly**, and that behaviour must survive the fix:
  an unknown total renders as "of more", never as 0, and a failure is always named
  in a banner rather than swallowed. `fetchOrderListCount` returning `null` is the
  mechanism (`src/hooks/useOrderList.ts`).

## 6. Exact next steps

**Step 1 — put §0 to Albert in one message and get the choice between (a), (b)
and (c).** Option (b) changes a number staff read on screen, so it is his call,
not a developer's.
*You'll know it worked when:* he names one option. Do not start building without it.

**Step 2 — if (a): author the count function in `u2giants/shared-db`.** Switch to
`/worksp/shared-db`, create a branch, add a timestamped migration under
`supabase/migrations/`, and follow the preview-first checklist in that repo's
`AGENTS.md`. The function should be `security definer`, apply the same read rule
the RLS policies apply (today: any authenticated user), count, and grant execute
to `authenticated`. Then open and merge the pull request — **the AI owns the
merge**, this is not handed back to Albert.
*You'll know it worked when:* `set role authenticated; select <the new function>();`
returns 24,486 in well under 500 ms, measured with `\timing on`.

**Step 3 — if (b): change only the client.** In `src/hooks/useOrderList.ts`, keep
`fetchOrderListCount` exact whenever a filter or search is active, and ask for an
estimated count when the result set is unfiltered. Label it in the UI so nobody
reads an estimate as exact.
*You'll know it worked when:* an unfiltered cold load shows the approximate total
with no banner, and typing in the search box still shows an exact count.

**Step 4 — wire it in and prove the ceiling is gone.** Point
`fetchOrderListStatusCounts` and `fetchOrderListCount` at whichever mechanism was
chosen. Then load `https://dam.designflow.app/orders` **ten times in a fresh
browser context each time** and record: whether the red banner appeared, what the
pager read, and how many `dam_order_list` requests returned 4xx/5xx. A working
harness for exactly this is described in §8.
*You'll know it worked when:* ten of ten loads are clean, the pager shows the real
total every time, and no request exceeds ~1 s.

**Step 5 — keep the guards.** `src/test/order-list-block-count.test.ts` must still
pass unchanged: rows and count stay two requests, and an unknown total is still
reported as unknown rather than 0. Add a test for whatever new path you introduce.
*You'll know it worked when:* `npx vitest run` is green across all 196+ tests.

**Step 6 — update the documentation and retire this file.** Fold the outcome into
`docs/KNOWN_QUIRKS.md` #75 (which currently records the ~2.2 s figure) and the
*How the page loads data* section of `docs/ORDER_LIST.md`. When #100 is closed,
delete `HANDOFF.d/2026-08-27T1110Z-hetz-claude-orders-count-timeout.md` in the
same commit.

## 7. Constraints and gotchas in force

- **Pushing to `main` deploys to production.** No staging gate, no preview
  environment. If something must land before it is seen, put it behind a flag and
  push it — do not hold it uncommitted on one machine. (A finished `/orders` page
  was once held back that way and nearly lost as a dangling commit.)
- **`main` only for app code.** No feature branches. `shared-db` is the opposite:
  branch + pull request, and the AI owns the merge.
- **No shared-database structural changes from this repo.** No DDL, no migrations
  under `supabase/migrations/`, no Dashboard SQL, no one-off `execute_sql`. CI
  enforces it. Step 2 happens in `/worksp/shared-db`.
- **This checkout is edited concurrently by other AI sessions.** Check
  `git status --short` first; stage only your own files; **never `git add -A`**;
  never bare `git stash` (the stack is shared) — use a WIP commit, or
  `git stash push -u -m "<unique-tag>"` and `apply` by SHA.
- **Push both remotes:** `git push origin main` then `git push github main`. They
  are the same repository here, so the second reporting "Everything up-to-date" is
  expected. Non-fast-forward rejections are common — resolve with `git fetch
  origin` then `git rebase --autostash origin/main`, and confirm the working tree
  came back unchanged. **Never force-push `main`; never revert files you did not
  modify.**
- **Never re-merge the rows and count requests** (§4, quirk #75).
- **Measure as `authenticated`, never as `postgres`.**
- **Read `plm.item.description`, never `plm.item.name`** — `name` is NULL on all
  19,362 rows, so any new code reading it renders an empty column.
- **Any OrderList write path must use `coerceFieldValueStrict`, not
  `coerceFieldValue`** — the lenient parser turns unreadable input into `null` and
  silently erases data (quirk #76).
- **Anything the grid reasons about must be named in `ORDER_LIST_SELECT`,** not
  just the columns it displays — component tests will not catch the omission
  (quirk #77).
- **PopSG must never expose OrderList** — route and navigation, with the contract
  test.
- **Bulk operations via `psql` need** `PGOPTIONS="-c statement_timeout=900000"`.
- **Never print a secret.** Use `op run --env-file=<tmpl>` so values reach only the
  subprocess environment.
- **The AG Grid Enterprise licence key is deliberately out of scope** (owner
  ruling, 2026-08-27). Every grid logs a trial notice and renders a watermark.
  That is expected. Do not raise it, and do not let it be mistaken for a symptom.

## 8. Access and environment

All verified working on `hetz` on 2026-08-27.

- **`gh` CLI:** authenticated as `u2giants`.
- **`op` (1Password) CLI:** service account against vault **`vibe_coding`** (the
  only vault). `op://` references break on titles containing parentheses — resolve
  the item **id** first, then `op://vibe_coding/<id>/<FIELD>`.
- **`psql` to production Supabase** — the reliable path, since the Supabase MCP is
  unauthorized here. Password = item `246sf23gymd64yudpmhswcnyle`
  (*Supabase DB Password - shared POP database*), field `password`, injected as
  `PGPASSWORD` via `op run --env-file`, then:
  `postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
  — pooler-form user `postgres.<project-ref>`, host `aws-1-us-east-1`, **not** the
  project's own hostname.
- **Signed-in UI testing:** item `7s5uzpbjenka4fpvrqogh44bre` — *DAM AI tester
  login - PopDAM (administrator, dam.designflow.app, production)*, fields
  `username` / `password`.
  Working pattern used this session, which step 4 should reuse: install Playwright
  into a scratch prefix, log in once with
  `op run --env-file=<tmpl> -- node login.mjs` and save `storageState` to a JSON
  file, then run every later check against that saved state so the password never
  reappears. The page needs **14–18 seconds** after `domcontentloaded` before the
  grid has rows — shorter waits produce false "no rows" and "no buttons" results
  that look like real failures.
  Two DOM traps cost time: **AG Grid virtualises columns horizontally** (reading
  `.ag-header-cell-text` shows only what is on screen), and **pinned columns live
  in `.ag-pinned-left-cols-container`**, not `.ag-center-cols-container`.
- **Local verification without deploying:** the Supabase URL and key are compiled
  into `src/lib/external-supabase.ts`, so `npx vite preview` on this checkout talks
  to production with no `.env`. That is how the new UI was checked before it
  shipped. Expect harmless CORS errors from an unrelated `admin-api` call on a
  localhost origin.
- **Canonical shared-db checkout:** `/worksp/shared-db`.
- Also present: Supabase CLI 2.98.2 (linked to `qsllyeztdwjgirsysgai`), Node 20,
  `psql` 18.4.

## 9. Open questions and risks

- **RISK — the cost grows with the table.** 2.2 s on 2026-08-26, 3.4 s on
  2026-08-27, against an 8 s ceiling. Today the page degrades honestly; at some
  point it will stop rendering instead. There is no alerting on it, so the first
  signal will be a user complaining.
- **RISK — a fresh session's instinct will be to re-merge the two requests.** It
  looks like an obvious saving and it is the original outage. §4, quirk #75 and
  `src/test/order-list-block-count.test.ts` exist to stop it.
- **Open — nobody has measured the other big grids.** Master Data and Styles read
  comparable row-level-permission views and may carry the same latent problem
  (§0 item 3).
- **Watch — nobody owns the item-refresh cadence.** `plm.item` is populated but on
  no schedule. Re-running `node tools/sync-coldlion-items.mjs --apply`, then the
  bridge refresh, then `relink_dam_order_lines_bulk()` is safe and idempotent
  (upsert, never delete). New ColdLion items will NOT appear in PopDAM until
  someone runs it.
- **Watch — `shared-db/plan_popdam_order_list.md` STATUS is stale** and will tell a
  cold reader this workstream is blocked when it shipped. Filed as
  `u2giants/shared-db#1639` (§0 item 4).
- **Decided 2026-08-26 (Albert):** everyone signed in may read OrderList data;
  writes stay administrator-only.
- **Decided 2026-08-26 (session):** rows and the exact count are permanently two
  requests.
- **Decided 2026-08-27 (Albert):** the AG Grid Enterprise licence key is out of
  scope for this work.

---

### Self-audit (run before this file was saved)

1. **Could a brand-new developer with no project knowledge continue?** Yes. §1
   defines the app, the repos, the hosts and the deploy path; §3 gives the
   measured problem, the exact symptom on screen and every relevant `file`/symbol;
   §6 is executable without judgement calls; §8 supplies every credential location
   and the two DOM traps that would otherwise waste an afternoon.
2. **As effectively as this session can right now?** Yes. The numbers in §3 are
   the measurement, not a summary of one; §5 explains *why* the count is expensive
   and therefore why an index will not help — the single non-obvious thing learned;
   §4 carries all six dead ends, including the two environment traps (`node_modules`,
   Playwright) that are invisible from the code.
3. **Is every detail needed for flawless execution present?** Yes. Background §1,
   goal §2, state §3, failures §4, causes §5, numbered steps with verification
   gates §6, constraints §7, access §8, risks and dated decisions §9.
4. **Reading ONLY §0, would the owner see every decision needed?** Checked line by
   line rather than from memory. §3 and §5 imply the fix choice → §0 item 1. §9's
   "cost grows" risk → §0 item 2. §9's unmeasured sibling grids → §0 item 3. §9's
   stale shared-db plan → §0 item 4. §7's and §9's settled rulings → the
   "do NOT re-ask" list, including the owner's 2026-08-27 ruling that the AG Grid
   licence key is out of scope. No sentence in §1–§9 needs his judgement without
   also appearing in §0.
