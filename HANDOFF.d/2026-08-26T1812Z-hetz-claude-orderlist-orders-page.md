---
issue: 91
status: OPEN
owner: hetz/claude session 2026-08-26 (no branch — work below is DB-only, no app code written)
---

# PopDAM OrderList — Master Data load is DONE in production; the `/orders` page is all that remains

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert Hazan in ONE message before starting work. Do not
meet these one at a time.

**Blocking — cannot ship without an answer**

1. **Nothing.** Every gate that previously blocked this workstream has been
   answered. Steps 1–3 are complete in production and the access ruling is made
   (see "Already settled" below). Building and deploying `/orders` is ordinary
   scoped app work and needs no further approval.

**A wrong guess is recoverable, but ask before spending the effort**

2. **RECOVERED 2026-08-26 — how should it land?** The finished `/orders` page was
   NOT lost. It is commit **`0b661992`**, *"feat: add PopDAM OrderList page at
   /orders"*, authored 2026-08-16 23:30 EDT on THIS VPS. It had become a **dangling
   commit** — a real commit whose branch had been deleted, so `git log --all` and
   `git branch -a` could not see it and it was invisible to every ordinary search.
   Found with `git fsck --lost-found`. It is now preserved as branch
   **`rescue/orders-page`** and tag **`orders-page-2026-08-16`**, both pushed to
   GitHub. 23 files, 3,294 insertions, including 5 test files and `docs/ORDER_LIST.md`.
   **Ask:** land it on `main` as-is (it deploys on push), or land it behind an
   admin-only gate first? *Recommendation:* rebase onto current `main`, run the
   tests, review the diff, then land it normally — the page was already verified
   signed-in against preview, and the Master Data it needs is now loaded in
   production, which it was not when the page was written.

**Not part of this work and nobody is on it**

3. **134 items exist in DesignFlow's Item Master but not in ColdLion**, almost all
   on rows where DesignFlow left company and division blank. They look hand-entered
   or legacy rather than real ERP items. Nothing depends on them today.
   *Recommendation:* leave them; raise with Uma (the DesignFlow developer) only if
   someone reports a missing item. Nothing in PopDAM writes to DesignFlow.
4. **`plm.item.name` is NULL on all 19,362 rows** — the loader populates
   `description` instead (19,118 non-null). This is a shared-db loader shape, not a
   PopDAM bug. *Recommendation:* no change; the page reads `description` (see §7).
5. **13 production orders are quarantined** for identity conflicts (82 rows) and
   **45 source rows were rejected** as malformed by the 2026-08-13 import. They are
   documented and recoverable, not lost. *Recommendation:* review only if a user
   reports a missing PO.

**Already settled — do NOT re-ask**

- **2026-08-26, Albert:** *"everyone should be able to see OrderList data."*
  Read access for every signed-in account is now a deliberate, approved decision.
  This closes `plan_popdam_order_list.md` OPEN QUESTIONS item 2. Recorded at
  https://github.com/u2giants/popdam3/issues/91#issuecomment-5428670752
- **2026-08-26, Albert:** approved and ran the production ColdLion item load.
- **2026-08-11, Albert:** the accepted OrderList workbook is the one with SHA-256
  `68c9b03a…2409fe`, and the approved populated-row count is **12,354**. The
  12,328 / 12,323 figures in the history are provenance only.
- **2026-08-07, Albert:** Google OrderList rows and future ColdLion production
  orders are the SAME business orders and resolve into the same
  `plm.production_order` / `plm.production_order_line` records. `plm.item` is the
  ultimate item list; there is no intended `core.item`.

## 1. What this application is

**PopDAM** is POP Creations' internal Digital Asset Management web app. Albert
Hazan owns POP Creations; the users are POP's internal staff (designers, sales,
licensing, administrators). It manages art assets, style guides, and product
Master Data for licensed merchandise.

- **App repo:** `u2giants/popdam3` — React + TypeScript + Vite + AG Grid, trunk-based,
  **`main` only, no feature branches**. This checkout: `/worksp/popdam` on the
  `hetz` VPS.
- **Sister app:** **PopSG** (style-guide viewer) is served from the SAME codebase,
  switched by the `IS_POPSG` build flag. Anything PopDAM-only must be excluded from
  PopSG navigation and routing.
- **Live URLs:** PopDAM `dam.designflow.app`, PopSG `sg.designflow.app`.
- **Deploy path:** commit to `main` → GitHub Actions → GHCR image → Coolify.
  **Pushing to `main` deploys.** There is no staging gate.
- **Shared database:** Supabase project **`qsllyeztdwjgirsysgai`** (production,
  Virginia), shared with PopPIM, PopCRM and DesignFlow. Preview branch project is
  `rjyboqwcdzcocqgmsyel`. **All schema changes are authored in
  `u2giants/shared-db`** (branch + PR + timestamped migration), never from this
  repo. CI (`.github/workflows/shared-db-guard.yml`) fails DDL added here.
- **Separate system, read-only relevance:** **DesignFlow PLM** runs on Google
  **Cloud SQL** (a different database entirely, public IP `104.198.220.200`), and
  is the app POP's PLM users work in. It holds its own copy of the Item Master.

**"OrderList"** is the legacy Google Sheet POP used to track production orders
(purchase orders to factories: PO status, vendor, dates, customer, style, quantity,
shipping, tracking). The project is to retire that spreadsheet and replace it with
a real `/orders` screen in PopDAM backed by the shared database.

## 2. What we set out to do this session, and why

Albert opened with *"where do we stand with OrderList?"* — a status question about
a workstream that had been stalled for nine days.

The business goal: get POP off the Google Sheet and onto a real Orders screen, with
each order line correctly linked to the canonical item list so staff can see what
product an order is actually for.

The session became: (a) establish true status from evidence, (b) unblock whatever
was blocking, (c) execute the next real step. It succeeded at all three — the
Master Data load that had been blocking everything since 2026-08-17 is now done in
production.

## 3. Current state — what is true right now

### Done and verified in production `qsllyeztdwjgirsysgai`

- **Schema:** all OrderList tables, the `api.dam_order_list` view, the three RPCs
  (`create_dam_order`, `update_dam_order`, `link_dam_order_line`), the style-item
  bridge, and `public.relink_dam_order_lines_bulk(p_limit int)` are applied and
  live. **There is no OrderList migration left to promote.**
- **Legacy order data:** imported 2026-08-13. **3,212 orders, 24,010 lines.**
  13 orders quarantined (82 rows), 45 source rows rejected. All 10 balance checks
  PASS. A second identical run changed 0 business rows.
  Evidence: `shared-db/docs/verification/popdam-order-list-production-2026-08-13/README.md`
- **Item Master loaded — THIS SESSION, 2026-08-26.**
  `plm.item` went from **0 → 19,362 rows**.
- **Order lines linked — THIS SESSION.**
  `master_data_match_status`: **matched 23,997** (all with a non-null `item_id`),
  **not_applicable 13**, unmatched **0**, ambiguous **0**.

Exact numbers, for anyone re-verifying:

| Step | Command | Result | Runtime |
|---|---|---|---|
| 1. Item load | `node tools/sync-coldlion-items.mjs --apply` in `/worksp/shared-db` | sweep 19,362 items / 97 pages / `terminalReached: true`; divisions CW001 12,920, EH001 3,883, SP001 2,108, EP001 451. Sync run `1b0a6982-5798-49aa-9a5c-5d40db95b04e`: rows_seen 19,362, **inserted 19,362**, updated 0, partially_resolved 13,012, ambiguous 0, unresolved 6,350 | 1m20s |
| 2. Bridge refresh | `select plm.refresh_style_tracker_item_bridge();` | returned `(0,15619,15619)`; bridge 15,619 rows, **14,621 now carry `plm_item_id`** (was 0) | 17s |
| 3. Bulk relink | `select public.relink_dam_order_lines_bulk();` | considered 23,997, **linked 23,997**, `ties_left` **0**, `no_candidate` **0** | 11s |

**Link integrity check: 0 rows** where `plm.item.item_number` disagrees with the
line's `sku_normalized`. No links were invented — the RPC writes only when exactly
one candidate exists.

This **beat the preview projection** (which predicted 23,519 unique + 436 ambiguous
+ 41 no-candidate). All 436 previously-ambiguous lines resolved to exactly one
candidate against the full production item set.

### Not started

- **The `/orders` page — step 4 — is WRITTEN but not on `main`.** Recovered
  2026-08-26 as commit `0b661992`, preserved on branch `rescue/orders-page` and
  tag `orders-page-2026-08-16` (both on GitHub). It is **not** merged, so
  `main` still has no `/orders` route. It was written against `main` as of
  `8cb757ad` (2026-08-16) and has **not** been rebased onto the ~10 days of `main`
  since. What it contains: `src/pages/OrdersPage.tsx`, `src/components/orders/`
  (6 components), `src/hooks/useOrderList.ts`, `src/lib/order-list.ts`,
  `src/types/order-list.ts`, 5 test files, `docs/ORDER_LIST.md`, plus route/nav
  wiring in `src/App.tsx` and `src/components/AppHeader.tsx`.
- **Deploy and verify — step 5.**

### Commit / push / deploy status of THIS session

- **No app code was written or changed.** Nothing to commit in `u2giants/popdam3`
  except this handoff file.
- **No shared-db code was changed.** The tools used already existed on `main`.
- The production database WAS written to (steps 1–3 above) — that is data, not code.
- Two comments were posted to `u2giants/popdam3` issue #91 recording the access
  ruling and the full load evidence.
- **⚠️ This checkout `/worksp/popdam` is concurrently dirty with ANOTHER session's
  uncommitted work** (AI-tagging changes across `apps/worker/**`, `supabase/functions/**`,
  `src/components/library/AssetDetailPanel.tsx`, and their own
  `HANDOFF.d/2026-08-24T1402Z-hetz-codex-scoped-ai-metadata-plan.md`).
  **Stage only your own files. Never `git add -A` here.**

## 4. Everything we tried that did NOT work

- **`mcp__supabase__execute_sql` returns `Unauthorized`** on this machine ("provide
  a valid access token"). This is a known standing condition, not a new breakage,
  and it is **not** a dead end. Route around it with `psql` — the exact working
  connection string is in §8. Do not waste time re-authenticating the MCP.
- **Reading production through PostgREST does not work for this data.** The `plm`
  schema is not exposed: a service-role request with `Accept-Profile: plm` returns
  **406** for both table reads and RPC calls. (Established 2026-08-17, still true.)
- **`public.link_dam_order_line` cannot be driven by a script.** It raises
  `authentication required` when `auth.uid()` is null, so no service-role script,
  edge function, or Railway worker can call it. That is exactly why
  `public.relink_dam_order_lines_bulk()` was commissioned (shared-db #1115, merged
  #1117, migration `20260818141220`) — **use the bulk RPC, not the per-line one.**
- **`shared-db/plan_popdam_order_list.md` is STALE and will mislead you.** Its
  STATUS table still says step 6 is open and "the importer has no production mode",
  and it still cites issues #852 and #853 as blockers. **All three statements are
  false as of 2026-08-26:** #852 closed 2026-08-12, #853 closed 2026-08-17, and the
  production import ran 2026-08-13. Trust the verification READMEs and issue #91
  over the plan's STATUS table. The plan's **Phase 3 build spec is still good** —
  it is only the status rows that rotted.
- **⚠️ THE BIGGEST MISTAKE OF THIS SESSION: I concluded the `/orders` page was
  lost, and it was sitting on this machine the whole time.** I checked branches
  (`git branch -a`), remote refs (`git ls-remote origin`), the stash, the
  filesystem (`find` for `*Order*Page*`), and session transcripts — all came back
  empty, and I reported the page as gone. **Every one of those searches is blind to
  a dangling commit.** The work had been committed and then its branch deleted (or
  `main` reset past it), leaving a real commit in `.git` that NOTHING except
  `git fsck` will show you. **The lesson for any future session: when work is
  described as "committed locally but never pushed" and you cannot find it, run
  `git fsck --lost-found` and date every dangling commit BEFORE concluding
  anything is lost.** The one-liner that found it:
  `for c in $(git fsck --lost-found | awk '/dangling commit/{print $3}'); do git log -1 --format='%H %ad %s' --date=short $c; done | grep -i order`
- **`tools/compare-coldlion-designflow-daily.mjs` and
  `check-coldlion-designflow-sync-health.mjs` do NOT compare against Cloud SQL** —
  despite the names. They compare taxonomy state inside Supabase. The real
  DesignFlow comparison had to be done by hand against Cloud SQL (§5).
- **`designflow."itemHeader".compan_code` / `div_code` are unusable as a join key** —
  they are **blank on 15,520 of 19,796 rows**. The usable identifier is
  `item_num_id`. A first attempt to compare on the three-part key
  (company|division|item) matched only 3,901 rows and looked like a disaster; it was
  an artifact of DesignFlow's blank columns, not a real divergence.

## 5. Root causes and key findings

- **The whole workstream was blocked on one thing: `plm.item` was empty in
  production.** Every order line existed but had nothing to point at, so the page
  would have shipped with an empty Master Data column on every row. That is now
  fixed and it was the single highest-value action available.
- **The load is cheap and safe.** ~19k rows in one transaction, 1m20s. Guardrails
  inside `plm.import_item_master_data` refuse the write on a non-terminal sweep, an
  empty sweep, a zero-row division, a division present in current silver but absent
  from the sweep, or a row count below 80% of existing silver. It **upserts** on
  `(source_system, source_id)` and **never deletes from `plm.item`**. A timeout
  rolls the whole thing back — there is no half-loaded state to clean up.
  Production `statement_timeout` is **120000 ms (2 min)**, which is tight for this;
  the run used `PGOPTIONS="-c statement_timeout=900000"` to be safe.
- **ColdLion is the authoritative, fuller Item Master — verified, not assumed.**
  Compared live ColdLion against DesignFlow PRODUCTION Cloud SQL
  (`designflow."itemHeader"`, read-only) on 2026-08-26:

  | Measure | Count |
  |---|---:|
  | ColdLion sweep, distinct item numbers | 19,332 |
  | DesignFlow rows / distinct item numbers | 19,796 / 18,235 |
  | **In both** | **18,101 (94%)** |
  | ColdLion only | 1,231 |
  | DesignFlow only | 134 |

  Same identifier space, overwhelming overlap. **DesignFlow leaves company and
  division blank on 15,520 of its 19,796 rows**, while ColdLion returns a division
  on every row — and division is what disambiguates items sharing a bare item
  number. So ColdLion is correctly the feed for PopDAM. **Nothing in DesignFlow was
  modified and nothing in PopDAM writes to it.**
- **`plm.item.name` is NULL on all 19,362 rows; `description` is populated on
  19,118.** A page that renders `name` will show an empty column on every row. This
  is the single most likely way to waste a day on the rebuild.
- **The access policies already matched Albert's ruling.** Each of the four
  OrderList tables carries a permissive `USING (true)` SELECT policy for
  `authenticated`, alongside the role-scoped `plm_read`. Writes remain restricted to
  `plm_admin_write` (administrator role only). Since the ruling is "everyone can
  see", **no policy change is needed** — the work was to record the decision, not to
  change the database.

## 6. Exact next steps

**Step A — DONE 2026-08-26. The page was recovered.** It is commit `0b661992` on
branch `rescue/orders-page` (also tag `orders-page-2026-08-16`), pushed to GitHub.
Nothing needs rebuilding. Skip to Step B'.

**Step B' — rebase, verify, and land the recovered page.**
1. `git fetch origin && git checkout rescue/orders-page && git rebase origin/main`
   — it was written against `8cb757ad` and `main` has moved ~10 days. Expect
   conflicts in `docs/SCHEMA.md` (the commit rewrites 1,266 lines of it) and
   possibly `src/lib/app-mode.ts`.
2. Run the test suite; the commit ships 5 order-list test files including
   `src/test/order-list-routing.test.ts`, which proves PopSG cannot expose the route.
3. **Re-verify against preview signed in.** The page was verified on 2026-08-16
   when `plm.item` was EMPTY — every Master Data cell would have shown the import
   snapshot fallback. Now that 23,997 lines are linked, the live Master Data path
   renders for the first time. **This is the one part that has never actually been
   seen working.** Confirm the description column populates and check it reads
   `plm.item.description` and not `name` (§7).
4. Land on `main` per Step C.
*You'll know it worked when:* the rebase is clean, tests pass, and a signed-in
preview run shows real Master Data descriptions on the order lines rather than
"from import snapshot" labels.

**Step B (only if the recovered commit turns out to be unusable) — build `/orders` to spec.** The full file-by-file specification is
`shared-db/plan_popdam_order_list.md` **Phase 3** (steps 3.1–3.4). Follow it as
written; it is current even though the plan's STATUS table is not. In summary:
1. `src/types/order-list.ts`, `src/lib/order-list.ts`, `src/hooks/useOrderList.ts`
   (bounded reads from `api.dam_order_list`; regenerate
   `src/integrations/supabase/types.ts` via the repo workflow — never hand-edit).
2. `src/pages/OrdersPage.tsx` plus `src/components/orders/`: `OrderListGrid.tsx`,
   `OrderEditorDialog.tsx`, `MasterDataLinkCell.tsx`, `MasterDataLinkDialog.tsx`,
   `OrderListViewsMenu.tsx`, `OrderListSummary.tsx`. Use the existing AG Grid theme
   and the pinned `35.3.1` packages.
3. Route + nav: import in `src/App.tsx`, add protected `/orders` **only under
   `!IS_POPSG`**; add an `Orders` item to `popdamNavItems` in
   `src/components/AppHeader.tsx` — **never** to `popsgNavItems`. Add a
   route/navigation contract test proving PopSG cannot expose OrderList.
4. Docs: `docs/ORDER_LIST.md`, linked from `AGENTS.md`, `docs/architecture.md`,
   `docs/SCHEMA.md`.
*You'll know it worked when:* an authenticated local session against **preview**
shows the grid with 3,212 orders, the Master Data description populated on
essentially every line, the Columns panel, a Set filter, a saved view surviving
reload, and **no console errors**; and PopSG shows no Orders nav item and does not
render the route.

**Step C — deploy and verify.** Commit to `main` and push to BOTH remotes
(`git push origin main` then `git push github main` — they are the same repo here,
so the second reporting "Everything up-to-date" is expected, not a failure).
Pushes are frequently rejected as non-fast-forward because `main` moves often;
resolve with `git rebase --autostash origin/main`, then confirm the worktree came
back unchanged. **Never force-push and never revert files you did not modify.**
*You'll know it worked when:* the GitHub Actions run is green, Coolify shows the
new image running, and `dam.designflow.app/orders` renders the grid signed in.

**Step D — retire this handoff.** When `/orders` is live and verified, delete
`HANDOFF.d/2026-08-26T1812Z-hetz-claude-orderlist-orders-page.md` in the same
commit, and close issue #91.

## 7. Constraints and gotchas in force

- **Pushing to `main` deploys to production.** There is no staging gate. That is
  precisely why the 2026-08-17 session held the finished page back — and why it was
  then lost. **Do not repeat that mistake:** if the page needs to land before it is
  ready to be seen, put it behind a flag or an admin-only route and push it, rather
  than leaving it uncommitted on one machine.
- **`main` only in this repo.** No feature branches for app code.
- **This checkout is concurrently edited by other AI sessions.** Check
  `git status --short` before touching anything; stage only your own files; never
  `git add -A`; never `git stash` bare (the stash stack is shared) — use a WIP
  commit or `git stash push -u -m "<unique-tag>"` and `apply` by SHA.
- **No shared-DB structural changes from this repo.** No DDL, no inline migrations,
  no Dashboard SQL, no new files under `supabase/migrations/`. CI enforces it. If
  you need a schema change, it goes to `u2giants/shared-db` as branch + PR.
- **Render `plm.item.description`, NOT `plm.item.name`.** `name` is NULL on all
  19,362 rows.
- **PopSG must never expose OrderList.** Route and nav both, with a contract test.
- **Current product cells are read-only** and must be visually marked as coming
  from Master Data. Order cells are editable per the API contract. Unmatched or
  ambiguous rows get a visible warning badge — never a silent fallback. Optimistic
  updates only if failures roll back visibly with a toast.
- **Production `statement_timeout` is 2 minutes.** Any bulk DB operation needs
  `PGOPTIONS="-c statement_timeout=900000"` or an explicit `set statement_timeout`.
- **Never print a secret.** Use `op run --env-file=<tmpl>` so values land only in
  the subprocess environment. The classifier blocks tool calls that echo even a
  prefix of a live credential — that is working as designed, route around it.

## 8. Access and environment

All verified working on `hetz` on 2026-08-26.

- **`gh` CLI:** authenticated as `u2giants`. Used for issues #91, #852, #853, #1115.
- **`op` (1Password) CLI:** authenticated as a service account against vault
  **`vibe_coding`** (the only vault). `op://` refs break on titles containing
  parentheses — resolve the item **id** first and reference
  `op://vibe_coding/<id>/<FIELD>`.
- **`psql` to production Supabase** (this is the reliable path; the Supabase MCP is
  unauthorized here):
  password = item `246sf23gymd64yudpmhswcnyle` (*Supabase DB Password - shared POP
  database*), field `password`, injected as `PGPASSWORD` via `op run --env-file`,
  then connect to
  `postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
  — note the pooler-form user `postgres.<project-ref>` and the `aws-1-us-east-1`
  host, **not** the project's own hostname.
- **Preview branch project** `rjyboqwcdzcocqgmsyel` has its own item
  `qbvfk7umc3n75ejekd65zwd4ty` with a ready-made `POSTGRES_URL_NON_POOLING` field —
  use it directly rather than assembling a URL. **Build and test the page against
  preview.**
- **DesignFlow PRODUCTION Cloud SQL, READ-ONLY** (a separate database; use only for
  cross-checks, never write): item
  `tcaf3o3u2cx52g6ivvczxbhola` (*DesignFlow PRODUCTION Cloud SQL - read-only
  (albert_read_only, creatiflow-database)*), fields `DB_HOST` `104.198.220.200`,
  `DB_PORT` 5432, `DB_USER` `albert_read_only`, `DB_NAME` `postgres`, `DB_PASSWORD`.
  Read access confirmed by Uma (the DesignFlow developer) on 2026-08-04.
- **ColdLion API:** key resolved automatically by
  `readColdlionApiKey()` in `/worksp/shared-db/tools/coldlion-sync-common.mjs` (env
  `COLDLION_API_KEY`, else a documented 1Password reference). Base items endpoint is
  `…/items?companyCode=EDGEHOME&size=200`. **Running the loader with no flags is
  read-only** — it fetches and prints counts; only `--apply` writes.
- **Canonical shared-db checkout:** `/worksp/shared-db`.
- Also present and working: Supabase CLI 2.98.2 (linked to `qsllyeztdwjgirsysgai`),
  Node, `psql` 18.4.

## 9. Open questions and risks

- **RESOLVED 2026-08-26 — the page was never lost.** Recovered from a dangling
  commit on this VPS (`0b661992`) and preserved as branch `rescue/orders-page` and
  tag `orders-page-2026-08-16`, both pushed to GitHub. No rebuild is needed. The
  remaining risk is only the rebase onto ~10 days of `main` and the untested live
  Master Data path (§6 Step B').
- **RISK — the recovered page has never been seen with real Master Data.** It was
  verified on 2026-08-16 when `plm.item` was empty, so every Master Data cell fell
  back to the import snapshot. The live path renders for the first time after the
  rebase. Budget time to look at it properly.
- **RISK — pushing `/orders` deploys it.** Weigh a flag/admin-gate landing against
  holding code back. Holding it back is what lost the last one. **Decided
  2026-08-26 (implicitly, by the loss):** prefer landing behind a switch.
- **Decided 2026-08-26 (Albert):** everyone signed in may read OrderList data;
  write access stays administrator-only. No policy change required.
- **Open, low urgency:** the 134 DesignFlow-only items (§0 item 3) and the 1,231
  ColdLion items DesignFlow lacks. Neither affects PopDAM.
- **Open, low urgency:** 13 quarantined orders and 45 rejected source rows from the
  2026-08-13 import. Documented in the verification README; recoverable.
- **Watch:** `plm.item` is now populated but is **not** on a refresh schedule that
  this session established. If ColdLion adds items, re-running
  `node tools/sync-coldlion-items.mjs --apply` followed by the bridge refresh and
  `relink_dam_order_lines_bulk()` is safe and idempotent — it upserts and never
  deletes. Nobody has decided who owns that cadence.
- **Watch:** `shared-db/plan_popdam_order_list.md`'s STATUS table is stale (§4). A
  future session reading it cold will believe this workstream is blocked when it is
  not. It was not corrected here because that file belongs to `shared-db` and must
  be changed through that repo's own PR workflow.
