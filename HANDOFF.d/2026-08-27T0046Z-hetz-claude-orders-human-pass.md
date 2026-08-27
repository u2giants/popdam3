---
issue: 99
status: OPEN
owner: hetz/claude session 2026-08-26 — work is shipped; only the human pass remains
---

# PopDAM `/orders` is LIVE — a human still needs to click through it, especially editing and manual relink

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert Hazan in ONE message before starting. Do not meet
these one at a time.

**Blocking**

1. **None.** The page is live, the data is loaded, the access ruling is made.
   The remaining task is a human QA pass and needs no approval to begin.

**A wrong guess is recoverable, but ask before spending the effort**

2. **The QA pass writes to REAL production orders.** Editing a PO Status or
   relinking a line changes live business data that POP staff may be reading the
   same day. There is no separate test environment for this — the preview branch
   project referenced in older notes (`rjyboqwcdzcocqgmsyel`) no longer resolves;
   the stored preview credential points at a dead branch project
   (`mvpkijzfmfcxhnzqogzs`, password auth fails). *Recommendation:* do the pass
   on production but make every change reversible and revert it immediately —
   change a field, confirm it saved, set it back. Say so to Albert first so he is
   not surprised by an audit trail on a real order.
3. **Should a preview/staging branch be re-created for PopDAM?** Today there is
   none, so every UI verification is against production. *Recommendation:* worth
   doing before the next feature that writes data; out of scope here.

**Not part of this work and nobody is on it**

4. **AG Grid Enterprise licence key is not set.** Every grid in the app logs
   "License Key Not Found — all AG Grid Enterprise features are unlocked for
   trial" and renders a watermark. Pre-existing and app-wide, not caused by
   `/orders`. *Recommendation:* buy or install the key, or accept the watermark
   deliberately; right now it is neither.
5. **134 items exist in DesignFlow's Item Master but not in ColdLion**, almost
   all on rows where DesignFlow left company and division blank. Likely
   hand-entered or legacy. *Recommendation:* leave them unless someone reports a
   missing item; raise with Uma (the DesignFlow developer) if so.
6. **13 orders remain quarantined** (82 rows) and **45 source rows were rejected**
   as malformed by the 2026-08-13 legacy import. Documented and recoverable, not
   lost. *Recommendation:* review only if a user reports a missing PO.
7. **One stale handoff sits in this folder:**
   `2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md`, whose issue #90 is
   already CLOSED. It belongs to a Codex session, so this session did not touch
   it. *Recommendation:* whoever next works AI-model routing should delete it.

**Already settled — do NOT re-ask**

- **2026-08-26, Albert:** *"everyone should be able to see OrderList data."*
  Read access for every signed-in account is deliberate and approved. Writes stay
  administrator-only. No policy change was needed — the live policies already
  matched. Recorded in `docs/ORDER_LIST.md` and on issue #91.
- **2026-08-26, Albert:** approved and ran the production ColdLion item load.
- **2026-08-26, Albert:** approved landing `/orders` on `main`, which deploys.
- **2026-08-11, Albert:** the accepted OrderList workbook is SHA-256
  `68c9b03a…2409fe` and the approved populated-row count is **12,354**.
- **2026-08-07, Albert:** Google OrderList rows and future ColdLion production
  orders are the SAME business orders and resolve into the same
  `plm.production_order` / `plm.production_order_line` records. `plm.item` is the
  ultimate item list; there is no intended `core.item`.

## 1. What this application is

**PopDAM** is POP Creations' internal Digital Asset Management web app. Albert
Hazan owns POP Creations; the users are POP's internal staff (designers, sales,
licensing, administrators). It manages art assets, style guides and product
Master Data for licensed merchandise.

- **App repo:** `u2giants/popdam3` — React + TypeScript + Vite + AG Grid.
  **Trunk-based: `main` only, no feature branches for app code.** This checkout:
  `/worksp/popdam` on the `hetz` Ubuntu VPS. **Albert does ~99% of PopDAM work on
  this VPS** — search here first, always.
- **Sister app:** **PopSG** (style-guide viewer) is served from the SAME codebase,
  switched by the `IS_POPSG` build flag. PopDAM-only screens must be excluded from
  PopSG routing and navigation, with a contract test proving it.
- **Live URLs:** PopDAM `dam.designflow.app`, PopSG `sg.designflow.app`.
- **Deploy path:** commit to `main` → GitHub Actions → GHCR image → Coolify.
  **Pushing to `main` deploys.** There is no staging gate.
- **Shared database:** Supabase project **`qsllyeztdwjgirsysgai`** (production,
  Virginia), shared with PopPIM, PopCRM and DesignFlow. **All schema changes are
  authored in `u2giants/shared-db`** via branch + PR + timestamped migration,
  never from this repo; CI (`shared-db-guard.yml`) fails DDL added here.
- **Separate system:** **DesignFlow PLM** runs on Google **Cloud SQL** (public IP
  `104.198.220.200`) — a different database entirely, with its own copy of the
  Item Master. PopDAM never writes to it.

**OrderList** is the legacy Google Sheet POP used to track production orders —
purchase orders to factories: PO status, vendor, dates, customer, style, quantity,
shipping, tracking. `/orders` replaces it.

## 2. What we set out to do this session, and why

Albert asked *"where do we stand with OrderList?"* — a status question about a
workstream stalled for nine days. It became: establish true status from evidence,
unblock it, and finish it. All three were done. `/orders` is live.

The remaining task, which Albert asked for explicitly at the end of the session:
**a human needs to click through the page, particularly the editing and manual
relink paths**, because those write to real orders and no human has used them on
the live site.

## 3. Current state — what is true right now

### Shipped and verified

- **`/orders` is LIVE** at https://dam.designflow.app/orders, build `47a42e92`.
- **Production data is fully linked.** `plm.item` holds **19,362** items; the
  style-item bridge carries `plm_item_id` on **14,621** rows; **23,997 of 24,010**
  order lines are linked (`matched`), the other **13** are `not_applicable` —
  lines with no SKU to match. **Zero** unmatched, **zero** ambiguous.
- **Link integrity proven:** zero rows where `plm.item.item_number` disagrees with
  the line's `sku_normalized`. No links were invented — the bulk RPC writes only
  when exactly one candidate exists.
- **Read path verified in production, signed in as administrator:** 24,486 shown
  of 24,486 lines, Linked to Master Data 24,473, Ambiguous 0, Not linked 0, page 1
  of 245, Master Data descriptions rendering live on every row, no console errors
  beyond the AG Grid trial notice.
- **All CI green** on every push: CI, Publish Frontend Image, shared-db guard,
  Forbid Shared DB Bypass.

### Commits this session (all on `main`, all pushed to both remotes)

| SHA | What |
|---|---|
| `559a1c82` | `feat: add PopDAM OrderList page at /orders` — the recovered 2026-08-16 commit, rebased |
| `47a42e92` | `fix(orders): load OrderList rows and the exact total as separate requests` |
| `0ccba30a` | retired the previous handoff |
| (this commit) | docs: KNOWN_QUIRKS #75, ORDER_LIST.md verification + data state, this handoff |

Production database writes this session (data, not code): the ColdLion item load,
the bridge refresh, and the bulk relink. All three are idempotent and repeatable.

### NOT done — this is the whole remaining scope

**No human has clicked through the live page.** Specifically unexercised against
production orders: **cell editing**, the **order editor dialog** (create/update),
**manual relink**, and **saved views**. They were proven on preview on 2026-08-16
and the code is unchanged, but they mutate real orders.

Full checklist is on **issue #99** — work from there, it is the authoritative list.

## 4. Everything we tried that did NOT work

- **⚠️ THE BIGGEST MISTAKE OF THIS SESSION — I declared the finished `/orders`
  page lost when it was on this VPS the whole time.** It had been committed on
  2026-08-16 and deliberately not pushed (pushing deploys), then its branch was
  deleted, leaving a **dangling commit**. `git branch -a`, `git log --all`,
  `git ls-remote`, `git stash list`, a filesystem `find`, and a session-transcript
  search ALL came back empty — every one of them is structurally blind to a
  dangling commit. Albert pushed back ("are you sure you searched everywhere?")
  and `git fsck` found it in seconds. **Rule for any future session: when work is
  described as "committed locally but never pushed" and you cannot find it, run
  this BEFORE concluding anything is lost:**
  `for c in $(git fsck --lost-found | awk '/dangling commit/{print $3}'); do git log -1 --format='%H %ad %s' --date=short $c; done | grep -i <keyword>`
- **The page timed out in production on its first live load**, with
  `canceling statement due to statement timeout`, despite working in local dev
  against the SAME production database minutes earlier. Root cause in §5. Do not
  dismiss a local-works/live-fails split as flaky — here it was a real 8-second
  ceiling that local timing happened to sneak under.
- **The Supabase MCP is `Unauthorized` on this machine** ("provide a valid access
  token"). Standing condition, not a new breakage, and NOT a dead end — use `psql`
  (§8). Do not burn time re-authenticating it.
- **PostgREST cannot reach the `plm` schema.** A service-role request with
  `Accept-Profile: plm` returns **406** for both table reads and RPC calls.
- **`public.link_dam_order_line` cannot be script-driven** — it raises
  `authentication required` when `auth.uid()` is null, so no service-role script,
  edge function or worker can call it. That is why
  `public.relink_dam_order_lines_bulk()` exists. Use the bulk RPC.
- **The preview branch project is dead.** The 1Password item for preview
  (`qbvfk7umc3n75ejekd65zwd4ty`) holds a `POSTGRES_URL_NON_POOLING` pointing at
  `mvpkijzfmfcxhnzqogzs`, which now fails password authentication. Preview
  verification is currently impossible; that is why the QA pass is against
  production (§0 item 2).
- **`tools/compare-coldlion-designflow-daily.mjs` and
  `check-coldlion-designflow-sync-health.mjs` do NOT compare against Cloud SQL**
  despite their names — they compare taxonomy state inside Supabase. The
  DesignFlow comparison had to be done by hand.
- **`designflow."itemHeader".compan_code` / `div_code` are useless as a join key** —
  blank on **15,520 of 19,796** rows. Join on `item_num_id`. A first attempt using
  the three-part key matched only 3,901 rows and looked like a catastrophe; it was
  an artifact of those blank columns.
- **`shared-db/plan_popdam_order_list.md`'s STATUS table is STALE** and will
  mislead a session that reads it cold: it still claims step 6 is open, that the
  importer has no production mode, and that issues #852/#853 block the work. All
  false. Its Phase 3 build spec is still accurate; only the status rows rotted. It
  was not corrected here because that file belongs to `shared-db` and must change
  through that repo's PR workflow.
- **Playwright is not a dependency of this repo.** `npx playwright` fetches it
  transiently but `import { chromium } from "playwright"` then fails with
  `ERR_MODULE_NOT_FOUND`. Install it into a scratch prefix and run with
  `NODE_PATH=<prefix>/node_modules` rather than adding it to `package.json`.

## 5. Root causes and key findings

- **The workstream was blocked on exactly one thing: `plm.item` was empty in
  production.** Every order line existed with nothing to point at. Loading it took
  1m20s and unblocked everything.
- **The live timeout, in full.** The `authenticated` Postgres role carries
  `statement_timeout = 8s` (`anon` 3s; `postgres` has none, which is why measuring
  as `postgres` is misleading). PostgREST computes an exact count **in the same
  statement** that returns the rows. Returning 100 rows from `api.dam_order_list`
  costs **~50 ms**; counting all 24,486 exactly costs **~2.2 s as
  `authenticated`**, because the security-invoker view re-checks every row against
  RLS on `plm.production_order`, `plm.production_order_line`, `core.customer`,
  `core.factory` and `plm.item`. Combined, the one request that renders the screen
  sat close enough to the ceiling that a cold moment tipped it over — and the whole
  grid died over one number. **Fix (`47a42e92`):** rows and count are two requests;
  the rows decide success, the count is best-effort, cached per filter/search
  result set, and reported as **unknown — never 0** on failure, which the grid
  already renders as "of more". Five tests in
  `src/test/order-list-block-count.test.ts` lock this in. Written up as
  `docs/KNOWN_QUIRKS.md` **#75**.
- **The `name` vs `description` trap, already handled.** `plm.item.name` is NULL on
  all 19,362 rows; `description` is populated on 19,118. The page reads
  `master_data_description ?? item_description ?? item_name`
  (`src/lib/order-list.ts:191`), so it renders correctly — but any NEW code that
  reads `name` will show an empty column on every row.
- **ColdLion is the authoritative, fuller Item Master — verified, not assumed.**
  Against DesignFlow PRODUCTION Cloud SQL, read-only, 2026-08-26: 19,332 distinct
  ColdLion item numbers vs 18,235 in DesignFlow; **18,101 in both (94%)**; 1,231
  ColdLion-only; 134 DesignFlow-only. DesignFlow leaves company/division blank on
  15,520 of 19,796 rows while ColdLion returns a division on every row — and
  division is what disambiguates items sharing a bare item number.
- **The item load is cheap and heavily guarded.** ~19k rows, one transaction,
  1m20s. `plm.import_item_master_data` refuses a non-terminal sweep, an empty
  sweep, a zero-row division, a division present in current silver but missing
  from the sweep, or a row count below 80% of existing silver. It **upserts** on
  `(source_system, source_id)` and **never deletes from `plm.item`**. A timeout
  rolls the whole thing back — no half-loaded state.

## 6. Exact next steps

**Step 1 — tell Albert the pass touches real orders** (§0 item 2) and confirm he
is content with reversible edit-then-revert on live data.
*You'll know it worked when:* he answers. Do not start writing without it.

**Step 2 — run the human pass.** Work the checklist on **issue #99** signed in at
https://dam.designflow.app/orders. It covers: cell edit (save, reload, revert),
order editor dialog (update and create), manual relink (exact Style# candidates
only, status becomes `manual`), saved views (create, reload, restore, delete),
error honesty (a failed save must roll back visibly with a toast, never silently),
PopSG exclusion, and deep scrolling past row 1,000.
*You'll know it worked when:* every box on #99 is ticked with what you actually
saw, and any change you made has been reverted.

**Step 3 — if something writes badly, STOP.** That is live business data. Report
it, do not work around it. Open a `db-work` issue in `u2giants/shared-db` if the
fault is in the RPCs or policies; fix in this repo if it is the UI.

**Step 4 — retire this handoff.** When #99 is fully ticked, delete
`HANDOFF.d/2026-08-27T0046Z-hetz-claude-orders-human-pass.md` in the same commit
that closes it.

## 7. Constraints and gotchas in force

- **Pushing to `main` deploys to production.** No staging gate. This is exactly
  why the finished page was once held back on one machine and nearly lost — if
  something needs to land before it should be seen, put it behind a flag and push
  it, rather than leaving it uncommitted.
- **`main` only for app code.** No feature branches.
- **This checkout is concurrently edited by other AI sessions.** Check
  `git status --short` first; stage only your own files; **never `git add -A`**;
  never bare `git stash` (the stack is shared) — use a WIP commit, or
  `git stash push -u -m "<unique-tag>"` and `apply` by SHA.
- **Push both remotes:** `git push origin main` then `git push github main`. They
  are the same repository here, so the second reporting "Everything up-to-date" is
  expected. Non-fast-forward rejections are common because `main` moves often —
  resolve with `git fetch origin` then `git rebase --autostash origin/main`, and
  confirm the working tree came back unchanged. **Never force-push `main`; never
  revert files you did not modify.**
- **No shared-DB structural changes from this repo.** No DDL, no migrations under
  `supabase/migrations/`, no Dashboard SQL. CI enforces it.
- **Read `plm.item.description`, not `name`.**
- **Never re-merge the rows and count requests** (§5, KNOWN_QUIRKS #75).
- **PopSG must never expose OrderList** — route and nav, with the contract test.
- **Production `statement_timeout` is 8s for `authenticated`, 2 minutes for
  `postgres`.** Bulk operations via psql need
  `PGOPTIONS="-c statement_timeout=900000"`.
- **Never print a secret.** Use `op run --env-file=<tmpl>` so values reach only the
  subprocess environment.

## 8. Access and environment

All verified working on `hetz` on 2026-08-26.

- **`gh` CLI:** authenticated as `u2giants`.
- **`op` (1Password) CLI:** service account against vault **`vibe_coding`** (the
  only vault). `op://` refs break on titles containing parentheses — resolve the
  item **id** first, then `op://vibe_coding/<id>/<FIELD>`.
- **`psql` to production Supabase** (the reliable path; the Supabase MCP is
  unauthorized here): password = item `246sf23gymd64yudpmhswcnyle` (*Supabase DB
  Password - shared POP database*), field `password`, injected as `PGPASSWORD` via
  `op run --env-file`, then
  `postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
  — pooler-form user `postgres.<project-ref>`, host `aws-1-us-east-1`, **not** the
  project's own hostname.
- **Signed-in UI testing:** item `7s5uzpbjenka4fpvrqogh44bre` — *DAM AI tester
  login - PopDAM (administrator, dam.designflow.app, production)*, fields
  `username` / `password`. Drive it with Playwright installed to a scratch prefix
  (§4) and `op run --env-file` so the password never appears in a transcript. A
  working script and screenshots from this session are in the session scratchpad.
- **DesignFlow PRODUCTION Cloud SQL, READ-ONLY** (cross-checks only, never write):
  item `tcaf3o3u2cx52g6ivvczxbhola`, `DB_HOST` `104.198.220.200`, `DB_PORT` 5432,
  `DB_USER` `albert_read_only`, `DB_NAME` `postgres`, `DB_PASSWORD`. Read access
  confirmed by Uma (the DesignFlow developer) on 2026-08-04.
- **ColdLion API:** key resolved by `readColdlionApiKey()` in
  `/worksp/shared-db/tools/coldlion-sync-common.mjs`. **Running
  `node tools/sync-coldlion-items.mjs` with no flags is READ-ONLY** — it fetches
  and prints counts; only `--apply` writes.
- **Preview Supabase: currently unavailable** (§4).
- **Canonical shared-db checkout:** `/worksp/shared-db`.
- Also present: Supabase CLI 2.98.2 (linked to `qsllyeztdwjgirsysgai`), Node 20,
  `psql` 18.4.

## 9. Open questions and risks

- **RISK — the write paths are unproven on production (the reason this file
  exists).** Editing, creating, relinking and saved views have never been used
  against live orders. If one of them writes badly, it corrupts real business
  data. Mitigation: do the pass deliberately, revert every change, stop on the
  first fault.
- **RISK — no preview environment.** Every future UI verification for this app is
  currently against production (§0 item 3).
- **Decided 2026-08-26 (Albert):** everyone signed in may read OrderList data;
  writes stay administrator-only.
- **Decided 2026-08-26 (this session):** rows and exact count are permanently two
  requests. Re-merging them reintroduces the outage.
- **Watch — nobody owns the item-refresh cadence.** `plm.item` is populated but on
  no schedule. Re-running `node tools/sync-coldlion-items.mjs --apply`, then the
  bridge refresh, then `relink_dam_order_lines_bulk()` is safe and idempotent
  (upsert, never delete). New ColdLion items will NOT appear in PopDAM until
  someone runs it. This should probably become a scheduled job; no one has decided.
- **Watch — `shared-db/plan_popdam_order_list.md` STATUS is stale** (§4) and will
  mislead a cold reader into thinking this workstream is still blocked.
- **Open, low urgency:** the 134 DesignFlow-only items, the 1,231 ColdLion items
  DesignFlow lacks, the 13 quarantined orders and 45 rejected import rows, and the
  missing AG Grid licence key (§0 items 4–6).
