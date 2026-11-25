---
summary: Issues #905, #927, #939, #1032 plan: harden the Burlington HFC buy-sheet import dialog, parser and Clear tool. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-905, issue-927, issue-939 or issue-1032, or changing the customer buy-sheet (HFC) import
---

# Plan: harden the customer buy-sheet (HFC) import (u2giants/popdam3#905, #927, #939, #1032)

Issues covered (all four are advisory AI-review findings on merged PRs; each is resolved only when every open finding below is fixed or proven moot):

- https://github.com/u2giants/popdam3/issues/905 — review of PR #904 (first buy-sheet import)
- https://github.com/u2giants/popdam3/issues/927 — review of PR #926 (revised-sheet stop)
- https://github.com/u2giants/popdam3/issues/939 — review of PR #938 (assortment Item Description suggestion)
- https://github.com/u2giants/popdam3/issues/1032 — review of PR #1031 (master SKU per pack; Clear my last HFC upload)

Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md)
Sibling plan (same feature, other dialogs): [issue-947-burlington-menu-bamboo-rose.md](issue-947-burlington-menu-bamboo-rose.md) — covers the Burlington menu, the Bamboo Rose dialog and the sandbox-only Clear menu item test (#947, #932, #1034). The two plans touch different files except `docs/ORDER_LIST.md`; do them in either order, rebasing that one file.

Written 2026-11-25 (about 4:00 PM EST) by Claude on `al8960ofc`, plan only; no implementation started. Code references are to `origin/main` at `787c20b8`.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Re-verify the findings this plan marks resolved are still resolved | ⬜ open | — |
| 1. Parser: impossible dates, local-date cells, non-contiguous pack carry-down (#905 f5–f7) | ⬜ open | — |
| 2. Dialog: preview race, stale preview, row keys, master-SKU inputs only where needed (#905 f3–f4, #1032 f5) | ⬜ open | — |
| 3. Dialog: apply-time revision defence, revision count in summary, derived revision flag (#927 f1, f3, f6) | ⬜ open | — |
| 4. Dialog: Item Master lookup errors visible, deterministic lookup, clipboard result (#939 f2–f4) | ⬜ open | — |
| 5. Clear dialog: correct EST/EDT label, confirm step, stale-import refusal (#1032 f3, f7) | ⬜ open | — |
| 6. Shared-db: clear refuses an import that is not the caller's latest (#1032 f3) | ⬜ open | — |
| 7. Google refresh keeps only truly blank cells (#905 f8) | ⬜ open | — |
| 8. Docs: ORDER_LIST.md held/master-SKU contradiction; description rule wording (#1032 f4, #939 f6) | ⬜ open | — |
| 9. Tests (section 10) | ⬜ open | — |
| 10. PR, CI, merge, deploy verified | ⬜ open | — |
| 11. Live proof on the sandbox site, then close the four issues | ⬜ open | — |

**Where a fresh session starts:** Step 0 (read-only greps, five minutes), then Steps 1–5 and 7 in any order; Step 6 is in another repository and Step 5's stale-import part waits for it.

---

## 1. The ultimate goal

Burlington sends POP Creations a bulk "buy sheet" (an Excel purchase-order worksheet, called the HFC) one to two months before its official purchase order. Staff upload it on the OrderList page (`/orders`) so every style and delivery becomes an OrderList line without hand-typing. When this plan is done, **the import never silently gets a number, a date, a pack or a description wrong, never tells the user "imported" when the database refused, and the "Clear my last upload" tool can never remove the wrong upload.** Every failure is shown to the user in plain words instead of being swallowed.

If a step conflicts with this goal, the goal wins — stop and flag it in the issue.

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager and OrderList replacement (repo `u2giants/popdam3`, React + Vite + Tailwind web app in `src/`, data in the shared Supabase Postgres project `qsllyeztdwjgirsysgai`). The OrderList page `/orders` replaced a legacy Google Sheet; it is documented in `docs/ORDER_LIST.md`.

- Production web app: https://dam.designflow.app/orders (production database).
- Sandbox web app: https://dam-sandbox.designflow.app/orders (preview database; built by `.github/workflows/publish-sandbox.yml`; the Clear tool works only here).
- Database schema and functions are owned by the separate repo `popcre/shared-db` (old URL `u2giants/shared-db` redirects). This repo holds only a read-only mirror under `shared-db/` — never edit it.

Pieces this plan touches:

| Piece | File |
|---|---|
| Import dialog (Preview / Import, master SKU boxes, description suggestions) | `src/components/orders/BuySheetImportDialog.tsx` |
| Sheet reader/parser (runs in the browser) | `src/lib/buy-sheet-import.ts` |
| Assortment description suggestion | `src/lib/assortment-description.ts` |
| Clear-my-last-upload dialog | `src/components/orders/ClearBuySheetDialog.tsx` |
| Database import function | `public.import_dam_buy_sheet` (latest mirror body: `shared-db/supabase/migrations/20261203000000_sandbox_catchup_functions_nov16.sql:231`) |
| Database clear function | `public.clear_dam_buy_sheet_import` (latest mirror body: `shared-db/supabase/migrations/20261225091103_drop_popdam_prod_order_copy_and_dam_snapshots.sql:12`) |
| Google Sheet refresh script (operator-run, Python) | `scripts/refresh-google-orderlist-rows.py`, tests `scripts/test-refresh-google-orderlist-rows.py` |
| Feature doc | `docs/ORDER_LIST.md` → "Customer buy-sheet import (Burlington HFC, 2026-11-10)" (around line 150) |

Business process (owner, 2026-11-16): the salesperson (Fabi) uploads the HFC, copies each pack's suggested description to JamieLynn, JamieLynn creates the master SKU (assortment number) in ColdLion (the ERP), and the salesperson types that master SKU into the pack's box. No PO number is needed; production POs are written later. Business rule source: `popcre/shared-db` `docs/business-rules/erp-orders-and-source-meaning.md` → *Burlington HFC (bulk) buy sheet*.

## 3. What triggered this work

An advisory AI reviewer runs on every merged PR and files a `review-finding` issue. Labels `fixer-done`, `fixer-deferred`, `fixer-failed` mean only that the automatic fixer gave up or tried; they are **not** proof of a fix. The four issues were filed against four successive PRs of the same feature. A coordinator session (2026-11-25) grouped them into this one plan because every fix lands in the same three files.

## 4. Scope

In scope: every finding listed as **open** in section 6, plus the tests in section 10.

NOT in this plan:
- Handling revised buy sheets (owner rule 2026-11-10: a revision is stopped, not handled; build revision handling only when a real revised sheet arrives).
- Any change to the description *wording format* (waiting on JamieLynn; `src/lib/assortment-description.ts` changes only if she asks).
- The Burlington menu, Bamboo Rose dialog and Clear menu-item gating test — sibling plan [issue-947](issue-947-burlington-menu-bamboo-rose.md).
- Removing the sandbox's no-login mode (owner's word only; see `HANDOFF.d/2026-11-10T2216Z-hetz-claude-burlington-buy-sheet.md` item 6).
- Other customers' buy-sheet formats.

## 5. Current state of the code

Live on production since 2026-11-10 (first real import 4:50 PM EST, 54 style-deliveries). Master-SKU flow and Clear tool landed in PR #1031 (2026-11-18), Clear made sandbox-only in PR #1033 and server-side by shared-db #6520 (guard visible in the clear function body: `admin_config` key `SANDBOX_ENABLED_TOOLS` must contain `clear_dam_buy_sheet_import`, otherwise it raises `42501`).

Nothing in this plan has been started.

## 6. Key findings — every review finding, current status

Checked against `origin/main` `787c20b8` on 2026-11-25.

### #905 (PR #904)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | `p_order_numbers` sent untrimmed | **Resolved (superseded)** | The dialog no longer sends `p_order_numbers`; it sends `p_master_skus` trimmed and upper-cased with blanks dropped — `BuySheetImportDialog.tsx:125` |
| f2 | Held-pack input keyed on case-sensitive `/order number/` reason text | **Resolved (superseded)** | The reason-text test is gone; boxes now come from parsed packs (`:94-106`, `:251-273`). Its replacement has its own problem, #1032 f5 |
| f3 | `onBlur` re-preview races; Import can use a stale preview | **Open** | `:268` calls `runPreview()` on every blur; `runPreview` (`:132-142`) has no request ordering, so an older response can land last. Typing then clicking Import immediately applies with `masterSkus` the preview never saw |
| f4 | Row key `sku|delivery_date` may not be unique | **Open** | `:284` |
| f5 | Pack carry-down only remembers the previous row | **Open** | `buy-sheet-import.ts:176-184` — `pack === previousPack ? previousPrepacks : 0`; a pack that reappears after another pack resets to 0 and its formula rows' units drop silently |
| f6 | `exFactoryDate` accepts 2/30 | **Open** | `buy-sheet-import.ts:85` checks only 1–12 / 1–31 |
| f7 | Excel date cells shift a day | **Open** | `buy-sheet-import.ts:255` uses `toISOString()` (UTC) on a date ExcelJS created; the raw-sheet copy stored with the import can be a day early |
| f8 | Google refresh restores buy-sheet quantity for *invalid* Google values, not only blank | **Open** | `scripts/refresh-google-orderlist-rows.py:79-86` tests `result.get(field) is None`, which is also true when the Google cell held text such as `Wrong QTY` (the parser types it `None`) |
| cov | No tests for the above | **Open** | `src/test/buy-sheet-import.test.ts` has none of these cases |

### #927 (PR #926)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | `apply()` toasts success without checking `applied`/`revision` | **Open (defence in depth)** | `BuySheetImportDialog.tsx:161-175`. The database now raises on apply when any line is a revision (`20261203000000_…:524-526`, errcode `P0001`), so today the error path shows; but a response with `applied: false` (any other refusal) would still toast "imported" and call `onApplied()` |
| f2 | Database guarantee not in repo | **Resolved** | Mirror has the `revision` outcome and the apply refusal: `shared-db/supabase/migrations/20261203000000_sandbox_catchup_functions_nov16.sql:425,524` |
| f3 | Preview summary omits the revision count | **Open** | `:237-238` |
| f4 | Stale handoff item 4 | **Resolved** | `HANDOFF.d/2026-11-10T2216Z-hetz-claude-burlington-buy-sheet.md:73` strikes item 4 as superseded by the 2026-11-10 rule |
| f5 | One happy-path test only | **Open** | `src/test/buy-sheet-revision-stop.test.tsx` has 2 tests; no apply-time refusal test, no 0-revision regression |
| f6 | `isRevision` trusts only `counts.revision` | **Open** | `:178` |

### #939 (PR #938)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | Item Master lookup upper-cases SKUs; stored `sku_normalized` is lower-case | **Resolved** | PR #950: `:79` and `:103` lower-case both sides |
| f2 | Lookup errors swallowed; no `.catch` | **Open** | `:85` reads only `data` |
| f3 | `.limit(2000)` unordered over a per-line view; first row wins even if its description is null | **Open** | `:82-88` |
| f4 | "Description copied" even when the clipboard write fails | **Open** | `:259` |
| f5 | Test mock used upper-case `sku_normalized` | **Resolved** | `src/test/buy-sheet-revision-stop.test.tsx:7` returns `x1` for sheet style `X1` |
| f6 | (truncated on GitHub at "documented rule mentions property names, implemen…") | **Open (reconstructed)** | `src/lib/assortment-description.ts:3` says the description names "licensors/properties", but `AssortmentStyle` (`:8-15`) carries only `licensor`; no property name is ever used. The doc/comment and the implementation disagree |

### #1032 (PR #1031)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | `p_master_skus` not in backend | **Resolved** | Mirror: `import_dam_buy_sheet(..., p_master_skus jsonb DEFAULT '{}')` in `20261203000000_…:231` |
| f2 | `clear_dam_buy_sheet_import` undefined | **Resolved** | Mirror: `20261225091103_…:12` |
| f3 | Clear re-sends the preview's `import_id`; single-click irreversible delete | **Partly open** | Server checks uploader (`…091103…:50-52`: "only the person who uploaded…"), ColdLion link and real PO (`:79-91`). Not checked: that `p_import_id` is still the caller's **latest** import. If the user uploads again in another tab between opening Clear and clicking "Clear it", the older import is undone underneath the newer one, restoring quantities the newer one set. The UI also has one click and no confirmation |
| f4 | Doc contradiction: master SKU vs "held … without an order number" | **Open** | `docs/ORDER_LIST.md:164-166` vs `:187-189` |
| f5 | Master-SKU boxes shown for every pack with quantity, even packs already matched, and still editable after Import | **Open** | `:94-106` builds from all parsed packs; `:251-273` renders regardless of `preview.applied` (only the blur re-preview is skipped) |
| f6 | Tests: no `p_master_skus` normalisation, no blur re-preview, no Clear dialog test | **Open** | no `ClearBuySheetDialog` test exists in `src/test` |
| f7 | Hard-coded "EST" next to an `America/New_York` time | **Open** | `ClearBuySheetDialog.tsx:66` |

## 7. Approaches considered and rejected

- **Debounce the blur re-preview** (#905 f3). Rejected alone: a debounce narrows but does not close the race, and does not stop Import using a preview that predates the last edit. Chosen: a request sequence number plus a "preview is stale" flag (step 2).
- **Hide the master-SKU boxes once the preview says `held`, keyed on `reason` text** (#1032 f5). Rejected: that is exactly the fragile text coupling #905 f2 flagged. Chosen: key on `outcome === "held"` and the line's `group`.
- **Fix the Clear race only in the browser by re-previewing just before apply.** Rejected as the only fix: still a window between the two calls. The real guard is in the database function (step 6). The browser re-check stays as a friendlier message.
- **Deleting the Google refresh preservation rule** (#905 f8). Rejected: the rule is correct for a truly blank Google cell (a blank must not erase a buy-sheet quantity). Only narrow it.
- **Replacing the `api.dam_order_list` lookup with a new database function** (#939 f3). Not needed: ordering by `sku_normalized, item_description nulls last` and picking the first non-null description per SKU fixes the determinism; a bounded `.in()` over at most a sheet's styles (about 44 on the sample) cannot reach the cap unless one style has more than ~45 historical lines. Step 4 also checks for the cap and warns. If a real sheet ever hits the cap, a database function is the follow-up.

## 8. Design decisions

Locked (do not relitigate):
- Revised sheets are stopped, not handled (owner rule 2026-11-10).
- No PO number at import; master SKU per pack from JamieLynn (owner process 2026-11-16).
- Clear is sandbox-only, enforced in the database (shared-db #6520) and in the UI (PR #1033).
- Database changes are made only in `popcre/shared-db` by branch + PR + timestamped migration; this repo never gets DDL.
- All user-facing times say EST or EDT correctly for the date (owner standing rule).

Open for the implementer (criteria given):
- Exact wording of new error messages: plain English, say what to do next, no jargon.
- Whether Import re-runs Preview itself when the preview is stale or simply disables Import with "Press Preview again" — either is fine; prefer automatic re-preview then apply only if the fresh preview has no revision and the counts still allow Import.

## 9. The plan

### Step 0 — Re-verify resolved findings (lead-only; a wrong "resolved" would skip a real bug)
Run on a fresh `origin/main`:
```
git grep -n "p_order_numbers" src/components/orders/BuySheetImportDialog.tsx    # expect no match
git grep -n "toLowerCase" src/components/orders/BuySheetImportDialog.tsx        # expect lines ~79 and ~103
git grep -n "'revision'" shared-db/supabase/migrations/ | tail -3                # expect the apply refusal
git grep -n "only the person who uploaded" shared-db/supabase/migrations/ | tail -1
```
You'll know it worked when all four results match section 6. If any differs, update section 6 before coding.

### Step 1 — Parser fixes (helper-ok; pure functions with named tests)
File `src/lib/buy-sheet-import.ts`.
1. `exFactoryDate` (`:80-93`): after computing `year`, build `new Date(Date.UTC(year, month-1, day))` and return `null` unless its UTC month and day equal the inputs. Then `parseBuySheetGrid` already throws "Delivery #n has quantities but no ex-factory date" for a block with quantities — change that message, when a label exists but is not a real date, to `Delivery #n's ex-factory date "<label>" is not a real calendar date.` (pass the label through).
2. Carry-down (`:176-184`): replace `previousPack/previousPrepacks` with a `Map<number, number>` of the last known prepacks per pack. A formula cell (`isFormula(raw)`) takes `lastByPack.get(pack) ?? 0`; a numeric cell sets `lastByPack.set(pack, prepacks)`. Behaviour for the contiguous sample must not change (the existing test "re-applies the sheet's formulas" stays green).
3. Date cells (`:255`): format with local calendar parts, not UTC: ``value = `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}` ``. Judgment: ExcelJS builds dates as UTC midnight for date-only cells in some versions; write the test (section 10) with both a UTC-midnight and a local-midnight `Date`, and pick whichever formatting returns the calendar date the sheet shows for both. If they disagree, use UTC parts when the time is exactly 00:00:00.000 UTC and local parts otherwise, and say so in a comment.
You'll know it worked when the three new tests in section 10 (parser group) pass and the existing 9 tests in `src/test/buy-sheet-import.test.ts` stay green: `npx vitest run src/test/buy-sheet-import.test.ts`.
Stop-and-ask trigger: any existing test changes its expected numbers (14,400 / 11,400 / 4,800).

### Step 2 — Preview ordering, stale preview, row keys, master-SKU boxes (lead-only; decides what is written to production)
File `src/components/orders/BuySheetImportDialog.tsx`.
1. Add `const previewSeq = useRef(0)`. In `runPreview`, take `const seq = ++previewSeq.current`; after the await, only `setPreview` / `setError` if `seq === previewSeq.current`. `busy` should clear only for the latest request.
2. Track `previewedSkus` (the `masterSkus` object the current preview was made with; store it alongside `preview`). Define `stale = preview && !preview.applied && !shallowEqualNormalized(masterSkus, previewedSkus)` where normalisation is the same trim/upper/drop-blank as `:125` (extract that into a small exported helper `normalizeMasterSkus` in the same file or `src/lib/buy-sheet-import.ts`). When `stale`, `importBlockedReason` = "You changed a master SKU after the preview. Press Preview again (or click outside the box) to update it." and Import is disabled.
3. Table row key (`:284`): `` `${l.group}|${l.sku}|${l.delivery_date}|${l.order_number ?? ""}` ``.
4. Master-SKU boxes (`:251-273`): render a box only for groups where the current preview has at least one line with `outcome === "held"` (match on `line.group`). Before a preview exists show the description list with Copy buttons but no boxes, and the sentence "Press Preview to see which packs need a master SKU." After `preview.applied`, render the boxes `disabled` (read-only), or hide them — hide is preferred.
You'll know it worked when the dialog tests in section 10 (dialog group, items 1–4) pass, and on the sandbox (step 11) a pack already in OrderList shows no box.

### Step 3 — Revision defence (helper-ok; mechanical, tests named)
Same file.
1. `isRevision` (`:178`): `(counts.revision ?? 0) > 0 || (preview?.lines ?? []).some((l) => l.outcome === "revision")`.
2. Summary line (`:237-238`): add `· {counts.revision ?? 0} revision` when `isRevision`.
3. `apply()` (`:161-175`): after `call(true)`, if `!result.applied` or the result is a revision (same derivation), `setPreview(result)`, set the error "The database did not import this sheet. Nothing was changed." (plus the revision stop text when it is a revision) and return without toast or `onApplied()`.
You'll know it worked when the tests "apply refused" and "0-revision still enables Import" (section 10) pass.
Stop-and-ask trigger: the database returns a shape where `applied` is missing — bring the actual response to the lead.

### Step 4 — Item Master lookup (helper-ok; tests named)
Same file, effect at `:78-92`.
1. Destructure `{ data, error }`; on `error`, set a new state `itemInfoError` and render above the assortment list, in amber: "Item Master details could not be loaded, so these descriptions use the sheet's text only. Check them before sending." Add a `.catch` that does the same.
2. Add `.order("sku_normalized").order("item_description", { nullsFirst: false })`; keep the first row per SKU whose `item_description` is non-null, else the first row. If `data.length === 2000`, show the same amber note with "some styles may be missing".
3. Copy button (`:259`): `async` handler — `await navigator.clipboard.writeText(...)` inside try; success toast only after it resolves; on failure or when `navigator.clipboard` is missing, `toast.error("Could not copy. Select the text and copy it by hand.")`.
You'll know it worked when the tests "lookup error is shown" and "copy failure is reported" pass.
Stop-and-ask trigger: the `api.dam_order_list` view rejects `.order` on these columns.

### Step 5 — Clear dialog (lead-only; irreversible delete path)
File `src/components/orders/ClearBuySheetDialog.tsx`.
1. Time label (`:66`): replace the literal ` EST` with `timeZoneName: "short"` in `toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })`, which prints EST or EDT for that date.
2. Two-step confirm: first click on "Clear it" changes the footer to "This removes N lines and M orders and cannot be undone. Clear it?" with "Yes, clear it" (destructive) and "Cancel".
3. Just before apply, call `call(false)` again (no id) and if the returned `import_id` differs from `preview.import_id`, refuse in the dialog: "You uploaded another buy sheet since this opened. Close and open Clear again." Then send the id. After step 6 lands, also map the new database error code (step 6) to the same message.
You'll know it worked when the Clear dialog tests (section 10) pass.

### Step 6 — Database: clear only the caller's latest import (lead-only; shared-db structure change, other repository)
Repository `popcre/shared-db`. Load the `shared-db-change` skill first and claim the function on its existing tracking issue (search `clear_dam_buy_sheet_import` in popcre/shared-db issues; #6520 is the sandbox-guard issue). New timestamped migration that `CREATE OR REPLACE`s `public.clear_dam_buy_sheet_import` with the current body (copy it from the live definition, verify its md5 against production first as the 2026-11-23 migration did) plus, after the uploader check:
```sql
if p_import_id is not null and exists (
  select 1 from dam.order_buy_sheet_import n
   where n.imported_by = v_actor
     and (n.imported_at, n.id) > (v_imp.imported_at, v_imp.id)) then
  raise exception 'clear_dam_buy_sheet_import: a newer buy-sheet upload of yours exists; clear that one first'
    using errcode = 'P0001';
end if;
```
Add a contract test in shared-db next to `supabase/tests/dam_buy_sheet_clear_sandbox_guard.sql` and `supabase/tests/dam_order_buy_sheet_import_contracts.sql` covering: latest import clears; older import with a newer one refuses; another user's import refuses. Promotion to production goes only through shared-db's automatic promotion workflow (preview rehearsal, tests, no open `review-finding` issue). Then the mirror sync PR (`chore: sync shared-db @ …`) brings it here.
You'll know it worked when the shared-db PR's preview rehearsal and contract test pass and the mirror in this repo shows the new check.

### Step 7 — Google refresh keeps only truly blank cells (helper-ok; Python, test named)
File `scripts/refresh-google-orderlist-rows.py`.
`merged_payload` (`:69-92`) cannot tell blank from invalid because `desired` holds parsed values. Add a parameter `blank_fields=frozenset()`; the preservation loop at `:84-86` runs only for fields in `blank_fields`. At the line call site (`:246`), compute `blank_fields` from the source row's raw text for the quantity and case-pack columns (`row.text(m.COL_…) is None or not row.text(...).strip()` — find the column constants in `shared-db/scripts/import-order-list-xlsx.py`, imported as `m`). A non-blank value that parses to `None` must leave the field `None` (so the line shows the invalid source) — and must not be silently replaced.
You'll know it worked when `python -m unittest scripts/test-refresh-google-orderlist-rows.py` passes, including the new test in section 10 and the existing `test_blank_google_quantity_keeps_buy_sheet_quantity`.
Stop-and-ask trigger: the line object at `:246` has no access to its source row's raw text.

### Step 8 — Docs (helper-ok; wording given)
1. `docs/ORDER_LIST.md:187-189`: replace "or a new pack without an order number" with "or a new pack with no master SKU typed yet". Rewrite step 3 (`:164-166`) to: "Packs that match no existing order are held until the user types the master SKU (assortment #) JamieLynn assigns; no PO # is needed (production POs are written later, owner process 2026-11-16). The box appears only for held packs." Drop the "Formerly…" history sentence (history lives in git).
2. Add one sentence after step 4 about the stale-preview rule and the Item Master warning.
3. `src/lib/assortment-description.ts:3`: change "licensors/properties" to "licensors" unless the business rule (`popcre/shared-db` `docs/business-rules/erp-orders-and-source-meaning.md` → *Burlington HFC (bulk) buy sheet*) names properties. If it does, stop and ask the lead (adding property names changes the suggestion JamieLynn is reviewing).
You'll know it worked when `git grep -n "without an order number" docs/ORDER_LIST.md` returns nothing.

### Step 9 — Tests: see section 10 (helper-ok per test; lead reviews assertions).

### Step 10 — Land it (lead-only)
Branch from fresh `origin/main` in its own worktree, PR to `main`, required checks green (`ci.yml`: lint, typecheck, `npm run test`, build), merge (the AI merges; reviews are advisory). Frontend deploys via `publish-frontend.yml` → GHCR → Coolify; sandbox via `publish-sandbox.yml`. Verify the served bundle changed (see `docs/deployment.md` → stale-site check).

### Step 11 — Live proof (lead-only)
On https://dam-sandbox.designflow.app/orders → Burlington → Import buy sheet (HFC), using the sample sheet `src/test/fixtures/burlington-buy-sheet-2026-10-20.xlsx`:
- Preview shows the same unit totals as the test; packs already in OrderList show no master-SKU box.
- Type a master SKU, click Import immediately: Import is disabled with the "press Preview again" reason until the fresh preview arrives.
- Clear my last HFC upload shows EST/EDT correctly and asks to confirm.
Screenshot each and post them on #905 with the deployed SHA. Production: open the dialog on https://dam.designflow.app/orders and preview (no import) to confirm it loads. Then close #905, #927, #939, #1032 with a signed comment linking the PR and proof.

## 10. Tests required

Parser group — `src/test/buy-sheet-import.test.ts`:
1. `exFactoryDate("2/30 X FACT", ref)` returns `null`; `"2/29/28 X FACT"` returns `2028-02-29`.
2. A grid where a block with quantities has label "2/30 X FACT" throws the "not a real calendar date" message.
3. Non-contiguous pack: rows pack 1 (typed 5), pack 2 (typed 3), pack 1 (formula) → the third row gets 5 prepacks, not 0.
4. `readBuySheetGrid` on a workbook built in the test with ExcelJS holding a date cell 2026-12-20 returns `"2026-12-20"` (run under `TZ=America/New_York`; Vitest honours `process.env.TZ` set before the date is built).

Dialog group — `src/test/buy-sheet-revision-stop.test.tsx` (or a new `src/test/buy-sheet-import-dialog.test.tsx` reusing its mocks):
1. Two previews resolve out of order (first slower) → the table shows the second response.
2. After editing a master SKU, Import is disabled with the stale reason until the next preview resolves.
3. Two result lines with the same sku/date but different `group` render as two rows.
4. Master-SKU box appears only for a group whose preview line is `held`; none after `applied: true`.
5. `p_master_skus` sent as `{ "2026-12-10|1": "ABC123" }` when typed `" abc123 "`; blank boxes omitted.
6. Apply returns `{ applied: false, counts: { revision: 1 } }` → no success toast, `onApplied` not called, error shown.
7. Preview with `counts: {}` but a line `outcome: "revision"` → stop alert shown, Import disabled.
8. Preview with 0 revision and 1 new → Import enabled.
9. Item Master query returns `{ error: { message: "x" } }` → amber "could not be loaded" note shown.
10. `navigator.clipboard.writeText` rejects → error toast, not "Description copied".

Clear group — new `src/test/clear-buy-sheet-dialog.test.tsx`:
1. Time label for a July timestamp contains "EDT", for a January one "EST".
2. First "Clear it" click does not call the RPC with `p_apply: true`; "Yes, clear it" does.
3. Re-check returns a different `import_id` → RPC apply is not called and the "uploaded another" message shows.

Python — `scripts/test-refresh-google-orderlist-rows.py`:
1. `test_invalid_google_quantity_is_not_replaced_by_buy_sheet`: source text `Wrong QTY`, old buy-sheet quantity 120 → result quantity `None`.

Must stay green: `npm run lint`, `npm run typecheck`, `npm run test` (whole Vitest suite), `python -m unittest scripts/test-refresh-google-orderlist-rows.py`.

## 11. Constraints, standing rules, gotchas

- Never push to protected `main`; feature branch + PR; the AI merges after required checks.
- No database change in this repo (`shared-db-guard.yml` fails DDL outside the mirror). Step 6 goes to `popcre/shared-db` only, preview first, automatic promotion.
- No silent failures: every new error path shows a message.
- The import is a trust boundary (an outside company's spreadsheet). Adversarial cases:

| External input | Hostile case | Test |
|---|---|---|
| Delivery label | impossible date `2/30` | parser 1, 2 |
| Date cell | timezone shift | parser 4 |
| Complex Pack ID column | pack reappears after another pack | parser 3 |
| Master SKU box | spaces, lower case, blank | dialog 5 |
| Server response | `applied:false`, revision lines without count | dialog 6, 7 |
| Server response | duplicate sku/date in different packs | dialog 3 |
| Item Master view | error / permission denied | dialog 9 |
| Browser clipboard | permission denied | dialog 10 |
| Clear target | newer upload exists | clear 3, shared-db contract test (step 6) |
| Google Sheet cell | non-numeric text in quantity | Python 1 |

- Times shown to people say EST/EDT correctly (step 5).
- The mirror `shared-db/` is read-only; it changes only via the sync PRs.
- The sample HFC fixture contains Burlington's real buy; keep it in `src/test/fixtures/` only.
- Other plan sessions land in parallel: rebase before merge; `docs/ORDER_LIST.md` is shared with the sibling plan.

## 12. Access and environment

- `gh` authenticated as `u2giants` for `u2giants/popdam3`; `popcre/shared-db` access for step 6.
- Local: `npm ci`, `npm run test`, `npm run dev` (needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; see `docs/development.md`). Python 3 for step 7.
- Sandbox https://dam-sandbox.designflow.app opens without login (owner decision 2026-11-11). Production login: Google SSO with a POP staff account; no stored password is needed.
- Supabase MCP / CLI for read-only checks against project `qsllyeztdwjgirsysgai`; secrets in 1Password vault `vibe_coding` (see `docs/1password.md`), never in chat.

## 13. Definition of done, risks, open questions

Done when: every open finding in section 6 is fixed; all section 10 tests exist and pass; CI green; PR merged; frontend and sandbox deployed with the merge SHA verified; shared-db step 6 promoted to production and mirrored; sandbox live proof screenshots posted; `docs/ORDER_LIST.md` updated; #905, #927, #939, #1032 closed with signed evidence comments; this plan's STATUS rows all cite artifacts; the handoff entry marked done.

Risks: changing carry-down could alter quantities on a real sheet — the sample's totals test guards it; rollback is reverting the PR (no data is changed by the frontend alone). Step 6 is a function replacement only; rollback is a migration restoring the prior body.

Open: whether ExcelJS date cells are UTC midnight or local midnight in the installed version (step 1.3 gives the decision rule). Whether the business rule names properties (step 8.3 trigger).

## Self-audit (2026-11-25)

1. *Could a brand-new session execute this without asking?* Yes — sections 2 and 5 say what the feature and files are; section 6 lists each finding with file:line and status; section 9 gives exact edits, gates and triggers; section 12 gives access. Gap found and fixed during drafting: #939 f6 was truncated on GitHub; section 6 reconstructs it from the code.
2. *Does it carry all background, including what was ruled out?* Yes — section 7 (debounce, reason-text keying, browser-only Clear guard, deleting the Google rule, a new lookup function) and section 8 (locked owner rules with dates).
3. *Is the goal clear enough for judgment calls?* Yes — section 1: no silent wrong numbers, no false "imported", Clear can never remove the wrong upload; the goal-wins instruction is there.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 plan docs/plans/issue-905-buy-sheet-import-hardening.md (issues #905, #927, #939, #1032).
Read AGENTS.md, then this plan's STATUS and sections 1, 6, 8, 11. Work in your own worktree on a new branch from origin/main.
You do Steps 0, 2, 5, 6, 10, 11 yourself (lead-only). Hand Steps 1, 3, 4, 7, 8 and the tests of section 10 to your helper, one step at a time, in that order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; when a step's stop-and-ask trigger fires, bring it to you; if stuck 30 minutes, you take the step back.
Rules sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run yourself: npm run lint, npm run typecheck, npm run test, python -m unittest scripts/test-refresh-google-orderlist-rows.py, the sandbox live proof, and you read every helper diff before committing.
Step 6 is in popcre/shared-db: load the shared-db-change skill first. Update this plan's STATUS with artifacts as each step lands.
```
