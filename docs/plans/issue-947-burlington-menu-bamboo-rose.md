---
summary: Issues #947, #932, #1034 plan: Burlington menu wording and tests, Bamboo Rose sheet dialog and writer. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-947, issue-932 or issue-1034, or changing the OrderList Burlington menu or Bamboo Rose sheet
---

# Plan: Burlington menu, Bamboo Rose sheet and Clear-menu test (u2giants/popdam3#947, #932, #1034)

Issues covered (advisory AI-review findings on merged PRs; each is resolved only when every open finding below is fixed or proven moot):

- https://github.com/u2giants/popdam3/issues/947 — review of PR #946 (Burlington menu groups "Import buy sheet (HFC)" and "Bamboo Rose sheet")
- https://github.com/u2giants/popdam3/issues/932 — review of PR #931 (fill Burlington's Bamboo Rose quote sheet from a buy sheet)
- https://github.com/u2giants/popdam3/issues/1034 — review of PR #1033 (Clear my last HFC upload made sandbox-only)

Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md)
Sibling plan (import dialog, parser, Clear dialog): [issue-905-buy-sheet-import-hardening.md](issue-905-buy-sheet-import-hardening.md). Only `docs/ORDER_LIST.md` is shared; rebase that file.

Written 2026-11-25 (about 4:10 PM EST) by Claude on `al8960ofc`, plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Re-verify resolved findings | ⬜ open | — |
| 1. Bamboo Rose dialog: download, empty input, wording, no personal defaults (#932 f1, f3, f7; #947 f1) | ⬜ open | — |
| 2. Bamboo Rose writer: keep template formulas on blank values; case-safe keys (#932 f2, f4) | ⬜ open | — |
| 3. Import dialog is Burlington-only: remove the customer choice (#947 f3) | ⬜ open | — |
| 4. Docs: menu name, row count (#947 f2, #932 f6) | ⬜ open | — |
| 5. Tests: menu opens both dialogs; Clear item in both modes, hermetic (#947 f4, #1034 f1) | ⬜ open | — |
| 6. Tests: Bamboo Rose ordering and options paths (#932 f5) | ⬜ open | — |
| 7. PR, CI, merge, deploy verified | ⬜ open | — |
| 8. Live proof, close the three issues | ⬜ open | — |

**Where a fresh session starts:** Step 0, then Steps 1–6 in any order.

---

## 1. The ultimate goal

Burlington's staff workflow on the OrderList page (`/orders`) has a "Burlington" menu with two tools: import the HFC buy sheet, and produce the filled Bamboo Rose quote sheet (Burlington's vendor portal spreadsheet) from it. When this plan is done, **the menu and its messages name the controls that really exist, the downloaded Bamboo Rose file always downloads in every browser and keeps the template's own calculations, no staff member's name or email is baked into the screen, and the tests prove the menu opens both tools and that the Clear tool appears only on the sandbox.**

If a step conflicts with this goal, the goal wins — stop and flag it in the issue.

## 2. What this application is

PopDAM (repo `u2giants/popdam3`; React + Vite web app in `src/`; shared Supabase Postgres project `qsllyeztdwjgirsysgai`, schema owned by `popcre/shared-db`). `/orders` is the OrderList, documented in `docs/ORDER_LIST.md`.

- Production: https://dam.designflow.app/orders
- Sandbox (preview database, no login, Clear tool enabled): https://dam-sandbox.designflow.app/orders, built by `.github/workflows/publish-sandbox.yml`.

Files:

| Piece | File |
|---|---|
| Burlington menu | `src/pages/OrdersPage.tsx:497-520` (dropdown "Burlington", items "Import buy sheet (HFC)", "Bamboo Rose sheet", sandbox-only "Clear my last HFC upload"); dialog mounts near `:560-570` |
| Sandbox flag | `src/lib/app-mode.ts:56-71` `IS_NON_PRODUCTION_DATABASE` (module-level const from `import.meta.env`) |
| Bamboo Rose dialog | `src/components/orders/BambooRoseDialog.tsx` |
| Bamboo Rose row builder and template writer | `src/lib/bamboo-rose-sheet.ts` (`buildBambooRoseRows`, `fillBambooRoseTemplate`) |
| Tests | `src/pages/OrdersPage.integration.test.tsx:327-335`, `src/test/bamboo-rose-sheet.test.ts`, fixture `src/test/fixtures/burlington-bamboo-rose-2026-10-20.expected.json` |

## 3. What triggered this work

Three advisory review issues on PRs #931, #946 and #1033. Labels `fixer-done/-deferred/-failed` are not proof of a fix. A coordinator session (2026-11-25) grouped them because they share the menu and the Bamboo Rose files.

## 4. Scope

In: the open findings in section 6 and the tests in section 10.

NOT in this plan:
- Import dialog, parser, Clear dialog and its database guard — sibling plan [issue-905](issue-905-buy-sheet-import-hardening.md).
- Reading ColdLion HTS codes from the browser (doc: "ColdLion HTS is not readable from the browser"; HTS is guessed from wording and flagged).
- Making the buy-sheet import read other customers' formats.
- Changing which fields Bamboo Rose leaves blank for a person.

## 5. Current state of the code

All three PRs are merged and live. PR #946 moved the two buttons into the Burlington dropdown; PR #1033 hid the Clear item unless `IS_NON_PRODUCTION_DATABASE`. Since PR #931 the Bamboo Rose download moved out of the import dialog into its own `BambooRoseDialog.tsx`, and the ColdLion HTS browser query was removed. Nothing in this plan has started.

## 6. Key findings — current status

### #947 (PR #946)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | Error text names a button "Import buy sheet" that no longer exists | **Open** | `BambooRoseDialog.tsx:62` |
| f2 | Doc names the old toolbar button | **Open** | `docs/ORDER_LIST.md:154` "**Import buy sheet** lets…" |
| f3 | Menu labelled "Burlington" though the import dialog offers any customer | **Open — decided: Burlington-only (owner 2026-11-25)** | `OrdersPage.tsx:500`; customer select `BuySheetImportDialog.tsx:203-215` |
| f4 | No test that the menu items open the dialogs | **Open** | `OrdersPage.integration.test.tsx:327-335` only checks the item texts are present |

### #932 (PR #931)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | Detached `<a>` click and immediate `revokeObjectURL` | **Open** | `BambooRoseDialog.tsx:66-71` |
| f2 | Blank value clears a cell even if it holds a template formula | **Open** | `bamboo-rose-sheet.ts` (template writer loop) — `if (value === undefined \|\| value === "") { if (c) clear(c); … }`, while the no-data branch just above it keeps `<f>` cells |
| f3 | Empty `.in()` lists; ColdLion HTS errors ignored | **Partly resolved** | HTS query removed (no ColdLion read in the dialog). Still open: `BambooRoseDialog.tsx:58-59` sends `.in(...)` lists that are empty when the HFC parses to zero lines; error is now checked (`:60`) |
| f4 | Fact map upper-cases keys, lookups use `l.sku` verbatim | **Open** | `bamboo-rose-sheet.ts:66` vs `:91`, `:102`, `:139` |
| f5 | Test sorts rows, so order is untested; options and checks paths untested | **Open** | `src/test/bamboo-rose-sheet.test.ts:41-58` |
| f6 | Doc says 67 rows; fixture has 68 entries | **Open (verify)** | `docs/ORDER_LIST.md:251`; `burlington-bamboo-rose-2026-10-20.expected.json` array length 68 |
| f7 | Personal defaults `ANNA BATMAN` / `jsafdieh@popcre.com` in source | **Open** | `BambooRoseDialog.tsx:21` |

### #1034 (PR #1033)

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | Only the production branch is tested, and the test depends on the shell's `VITE_SUPABASE_URL` | **Open** | `OrdersPage.integration.test.tsx:327-335`; flag is a module const in `src/lib/app-mode.ts:56-71` |
| f2 | Opening the Radix menu with `keyDown Enter` unproven | **Resolved** | The test is on `main` and the required `ci.yml` "npm run test" job passes on `main` (`787c20b8`), so the menu does open that way. Re-check in step 0 |
| f3 | Second guard redundant | No change needed (reviewer's own verdict) | — |

## 7. Approaches considered and rejected

- **Keep the customer select and warn for other customers** (#947 f3). Rejected 2026-11-25: Albert ruled that only Burlington has the HFC buy-sheet system, so offering other customers invites importing a sheet the parser cannot read. Also rejected: renaming the menu to something generic. Chosen (step 3): the import dialog is Burlington-only — no customer choice.
- **Storing the buyer and vendor email defaults in `admin_config`** (#932 f7). Rejected: a new configuration key for two text boxes is more moving parts. Chosen: remember the last values the user typed in `localStorage` (key `popdam.bambooRose.defaults`), start blank otherwise, and require both before download.
- **Testing the sandbox branch by setting `VITE_SUPABASE_URL` in the test** (#1034 f1). Rejected: the flag is computed at module load, so env tweaks are order-dependent. Chosen: `vi.mock("@/lib/app-mode", …)` with a mutable value and `vi.resetModules()` + dynamic import per case.

## 8. Design decisions

Locked:
- The HFC buy-sheet import is Burlington-only; only Burlington has the HFC buy-sheet system (owner, Albert, 2026-11-25, in chat: "only bulington has that HFC buy sheet system").
- Clear is sandbox-only (owner correction 2026-11-16; UI PR #1033; database guard shared-db #6520).
- The Burlington menu is the entry point for both tools (PR #946).
- Carton sizes, weights, materials, inner packs and pallets stay blank for a person.

Open (criteria): the exact wording of the "Burlington missing" error — plain English, says to tell Albert.

## 9. The plan

### Step 0 — Re-verify (lead-only)
```
git grep -n "Import buy sheet" src/components/orders/BambooRoseDialog.tsx
git grep -n "ANNA BATMAN" src
gh run list -R u2giants/popdam3 --branch main --workflow ci.yml -L 1
node -e "console.log(require('./src/test/fixtures/burlington-bamboo-rose-2026-10-20.expected.json').length)"
```
You'll know it worked when the first two find the lines in section 6, the last CI run on `main` is green, and the fixture count is 68.

### Step 1 — Bamboo Rose dialog (helper-ok; edits named)
File `src/components/orders/BambooRoseDialog.tsx`.
1. `:62` message → `This HFC is not in OrderList yet. Close this, use Burlington → "Import buy sheet (HFC)" with the same HFC first, then come back.`
2. Before the query (`:52`): if `parsed.lines.length === 0`, throw `This HFC has no style lines with a quantity, so there is nothing to fill.` — never send empty `.in()` lists.
3. Download (`:66-71`): `document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);`. Extract into a small `downloadBlob(bytes, fileName)` helper in the same file (or `src/lib/download.ts` if one already exists — `git grep -n "createObjectURL" src` first and reuse an existing helper if there is one).
4. Defaults (`:21`): initial `buyer` and `vendorEmail` from `localStorage.getItem("popdam.bambooRose.defaults")` (JSON `{buyer, vendorEmail}`), else `""`; keep `packSuffix: "V2"`. Save them on successful download. Disable Download until both are non-blank and show "Fill in Buyer and Vendor email." under the button.
You'll know it worked when the dialog tests in section 10 pass and `git grep -n "jsafdieh\|ANNA BATMAN" src` returns nothing.
Stop-and-ask trigger: an existing download helper behaves differently (for example a different revoke delay) — ask before changing it.

### Step 2 — Template writer and key case (helper-ok; pure functions, tests named)
File `src/lib/bamboo-rose-sheet.ts`.
1. In `fillBambooRoseTemplate`'s column loop, the blank-value branch: `if (c && !c.getElementsByTagName("f").length) clear(c); return;` — same rule as the no-data branch.
2. Key lookups: define `const key = (sku: string, date: string) => `${sku.trim().toUpperCase()}|${date}``; use it at `:66` (map build) and at `:91`, `:102`; at `:139` look up `opts.hts?.[l.sku.trim().toUpperCase()] ?? opts.hts?.[l.sku]`.
You'll know it worked when the writer and lower-case tests in section 10 pass and the existing "matches Fabi's hand-made sheet" test stays green.

### Step 3 — Burlington-only import dialog (helper-ok; edits named)
File `src/components/orders/BuySheetImportDialog.tsx`.
1. Remove the customer `<select>` (`:203-215`) and the `customerId` state (`:67`); `customer` becomes the Burlington id found at `:63-66` (label `burlington`, case-insensitive). Show the text "Customer: Burlington" where the select was.
2. If no Burlington entry is in `customerOptions`, disable Preview and show in red: "Burlington is missing from the customer list, so the buy sheet cannot be imported. Tell Albert."
3. Title (`:196`) → "Import Burlington buy sheet (HFC)"; description drops "customer" wording.
4. In `src/pages/OrdersPage.tsx`, keep passing `customerOptions` (the dialog still needs Burlington's id); do not add a new prop.
Coordinate with the sibling plan, which edits the same file elsewhere (rebase).
You'll know it worked when the tests "no customer choice; Burlington used" and "Burlington missing disables Preview" pass.
Stop-and-ask trigger: Burlington appears more than once in `customerOptions` — bring the list to the lead.

### Step 4 — Docs (helper-ok; wording given)
0. `docs/ORDER_LIST.md` buy-sheet step 1 ("Choose the customer (canonical customer list, Burlington by default) and the `.xlsx`") → "Choose the `.xlsx` (Burlington only; only Burlington has the HFC buy-sheet system, owner 2026-11-25)".
1. `docs/ORDER_LIST.md:154`: "**Import buy sheet**" → "**Burlington → Import buy sheet (HFC)**".
2. `docs/ORDER_LIST.md:251`: open the fixture and the test; if the 68 entries are 67 sheet rows plus one header/meta entry, say "all 67 data rows"; otherwise change to 68. State which in the commit message.
3. Add one sentence in the Bamboo Rose section: buyer and vendor email are typed once and remembered in that browser.
You'll know it worked when `git grep -n "^\*\*Import buy sheet\*\*\|On \`/orders\`, \*\*Import buy sheet" docs/ORDER_LIST.md` returns nothing.
Stop-and-ask trigger: the fixture's 68th entry is a real row the doc author missed and the test still says 67 — bring both to the lead.

### Step 5 — Menu tests (lead-only; the hermetic-mode mock decides whether the suite is trustworthy)
File `src/pages/OrdersPage.integration.test.tsx`.
1. Add at top: `const appMode = vi.hoisted(() => ({ IS_NON_PRODUCTION_DATABASE: false, POPDAM_SUPABASE_PROJECT_REF: "qsllyeztdwjgirsysgai" }));` and `vi.mock("@/lib/app-mode", async (orig) => ({ ...(await orig()), get IS_NON_PRODUCTION_DATABASE() { return appMode.IS_NON_PRODUCTION_DATABASE; } }));`. If a getter is not honoured because `OrdersPage.tsx` reads the const at module load, use `vi.resetModules()` and `await import("@/pages/OrdersPage")` inside each test instead.
2. Tests: production mode hides "Clear my last HFC upload" (keep the existing one, now hermetic); sandbox mode shows it and clicking it opens the dialog titled "Clear my last HFC upload"; clicking "Import buy sheet (HFC)" opens "Import customer buy sheet"; clicking "Bamboo Rose sheet" opens "Burlington Bamboo Rose sheet". Open the menu the same way the existing test does (`keyDown Enter` + `advanceTimersByTime(200)`).
You'll know it worked when `npx vitest run src/pages/OrdersPage.integration.test.tsx` passes both with and without `VITE_SUPABASE_URL=https://x.supabase.co` exported in the shell.

### Step 6 — Bamboo Rose builder tests (helper-ok; tests named in section 10)

### Step 7 — Land it (lead-only)
Fresh worktree branch from `origin/main`, PR to `main`, required checks green, the AI merges, verify the frontend and sandbox bundles changed (`docs/deployment.md` stale-site check).

### Step 8 — Live proof (lead-only)
On https://dam-sandbox.designflow.app/orders: Burlington menu shows three items; Bamboo Rose with `src/test/fixtures/burlington-buy-sheet-2026-10-20.xlsx` and a blank Bamboo Rose template downloads a file in Chrome **and** Firefox; opening it in Excel shows template formula columns still calculating; buyer/email start blank the first time and are remembered after. On https://dam.designflow.app/orders: Burlington menu shows two items (no Clear). Screenshots on #947 with the deployed SHA; close #947, #932, #1034 with signed evidence comments.

## 10. Tests required

`src/test/bamboo-rose-sheet.test.ts`:
1. Rows come out in the expected order (compare without sorting): every parent pack row directly before its child rows, deliveries in date order.
2. Lower-case and mixed-case `l.sku` find their facts (assortment, factory, port) and produce no fallback `PACK…` rows.
3. `opts.hts` override for a style is used and not listed under checks.
4. `vendorNumber`, `terms`, `category` options appear in the right columns.
5. A style with no assortment fact and a vendor missing from `BAMBOO_ROSE_FACTORY` each add a line to `checks`.
6. Template writer: a template data row with a formula in a column the row leaves blank keeps its `<f>` after filling.

New `src/test/bamboo-rose-dialog.test.tsx`:
1. Zero-line HFC → error message, Supabase not called.
2. Facts empty → message naming `Burlington → "Import buy sheet (HFC)"`.
3. Download appends an anchor to `document.body` and revokes the URL only after a timer.
4. Download disabled until Buyer and Vendor email are filled; values are restored from `localStorage`.

`src/test/buy-sheet-revision-stop.test.tsx` (or the sibling plan's dialog test file): (a) no customer select is rendered and the RPC receives Burlington's id as `p_customer_id`; (b) with no Burlington in `customerOptions`, Preview is disabled and the "Burlington is missing" message shows.

`src/pages/OrdersPage.integration.test.tsx`: the four menu tests in step 5.

Must stay green: `npm run lint`, `npm run typecheck`, `npm run test`.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`; the AI merges after required checks.
- No database change is needed. Any that seems needed goes to `popcre/shared-db`, never here.
- No staff personal data in source (#932 f7).
- Template files come from Burlington's vendor portal (outside the repo) — adversarial cases:

| External input | Hostile case | Test |
|---|---|---|
| Bamboo Rose template | formula in a column left blank | builder 6 |
| HFC file | parses to zero lines | dialog 1 |
| HFC style codes | lower/mixed case | builder 2 |
| OrderList facts | none found | dialog 2 |
| Browser | Firefox detached-anchor rule | dialog 3 + live Firefox check |

- `IS_NON_PRODUCTION_DATABASE` is a module-level constant: tests must mock the module, not the environment.
- Rebase on `docs/ORDER_LIST.md` and `BuySheetImportDialog.tsx` with the sibling plan.

## 12. Access and environment

`gh` as `u2giants`. Local `npm ci && npm run test`; dev server needs `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (`docs/development.md`). Sandbox opens without login; production uses Google SSO with a POP staff account. A blank Bamboo Rose template: the test fixture template used by `bamboo-rose-sheet.test.ts` "writes into a template" (find it with `git grep -n "arrayBuffer\|readFile" src/test/bamboo-rose-sheet.test.ts`); a real one comes from Burlington's Bamboo Rose portal (staff only — ask Albert only if no fixture template exists). Secrets: 1Password vault `vibe_coding`, never in chat.

## 13. Definition of done, risks, open questions

Done when: all open findings fixed; section 10 tests pass; CI green; merged; frontend + sandbox deployed with the merge SHA verified; live proof posted; docs updated; #947, #932, #1034 closed with signed evidence; STATUS rows cite artifacts; handoff entry marked done.

Risks: the formula-keeping change could leave a stale formula in a row Burlington expects blank — the live Excel check in step 8 covers it; rollback by reverting the PR.

Open: none (Burlington-only decided by Albert 2026-11-25).

## Self-audit (2026-11-25)

1. *Could a fresh session execute it without asking?* Yes — sections 2, 6 and 9 give files, lines, exact edits and gates; section 12 says where test inputs are.
2. *All background, including rejections?* Yes — section 7 (keeping the select with a warning, generic rename, config key for defaults, env-var tests) and section 8.
3. *Goal clear for judgment calls?* Yes — section 1: real control names, reliable download that keeps formulas, no personal data, tests that prove the menu.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 plan docs/plans/issue-947-burlington-menu-bamboo-rose.md (issues #947, #932, #1034).
Read AGENTS.md, then this plan's STATUS and sections 1, 6, 8, 11. Work in your own worktree on a new branch from origin/main.
You do Steps 0, 5, 7, 8 yourself (lead-only). Hand Steps 1, 2, 3, 4 and 6 to your helper, one at a time, in that order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; when a stop-and-ask trigger fires, bring it to you; if stuck 30 minutes, you take the step back.
Rules sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run yourself: npm run lint, npm run typecheck, npm run test (also with VITE_SUPABASE_URL exported), the Chrome and Firefox live checks, and you read every helper diff before committing.
Update this plan's STATUS with artifacts as each step lands.
```
