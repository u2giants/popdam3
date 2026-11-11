---
summary: Issue #671 plan: fix(pdf): reject form text in parsed sheet fields. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-671
---

# Plan: Review finding: u2giants/popdam3#670 fix(pdf): reject form text in parsed sheet fields (u2giants/popdam3#671)
Issue: https://github.com/u2giants/popdam3/issues/671
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Confirm findings against current `main` (one already fixed) | ⬜ open | — |
| 1 | Spaced asset names on a V2 `ASSETS:` line are kept, junk is not | ⬜ open | — |
| 2 | Wrapped continuation line passes the field's `accept` check | ⬜ open | — |
| 3 | `FORM_FURNITURE` anchored so real descriptions survive | ⬜ open | — |
| 4 | `product_size` and V1 `manager` get an accept filter | ⬜ open | — |
| 5 | Adversarial table fully covered by named tests | ⬜ open | — |
| 6 | PR, CI green, edge function deployed, issue closed with evidence | ⬜ open | — |

Where a fresh session starts: step 0, then steps 1–4 in one branch (they all touch one file). Coordinate with the sibling plan for #673 (same file, same function) — see section 11.

---

## 1. The ultimate goal

POP Creations' licensing sheets and tech packs (PDFs on the NAS) carry facts the team searches by: which designers made the product, which art files were used, product type, size, packaging, licensor. A rescan reads every sheet with OCR and a parser turns that text into database fields. **The goal: a parsed field is either the real value from the sheet or blank — never form furniture, tick-box labels, legal boilerplate, or a number that happened to sit under the heading.** Junk in these fields pollutes search, overwrites real designer names on files, and feeds wrong "files used" links.

If a step in this plan conflicts with that goal, the goal wins — stop and flag it. In particular: when in doubt between "keep a doubtful value" and "leave blank", leave blank; a blank is recoverable, a wrong overwrite of a designer name is what caused the incident in section 3.

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch policy: feature branch → PR → `main`) is POP Creations' digital asset library for product art, tech packs and licensing sheets. Live app: https://dam.designflow.app. Database: Supabase project `qsllyeztdwjgirsysgai` (Virginia). The parser in scope is a Supabase edge-function module, `supabase/functions/_shared/pdf-sheet-fields.ts`, imported by `supabase/functions/agent-api/index.ts:56` and called at `index.ts:4122` inside `completePdfRescanBatch`. The Windows render agent (`apps/windows-agent/src/pdf-backfill.ts`) reads PDFs with Indra OCR and posts text to that edge function; the edge function parses fields and calls the shared-db RPC `commit_pdf_rescan_batch` (`index.ts:4125`), which writes `pdf_text_samples.extracted_fields`, overwrites `assets.designer_name` / `technical_designer_name` (with an undo copy in `asset_designer_sheet_backup`) and inserts `sku_files_used` rows. That RPC lives in `popcre/shared-db` migration `20261103171536_pdf_sheet_designers_overwrite.sql` (lines 133–196) — never in this repo.

Edge functions deploy through `.github/workflows/deploy-supabase.yml` on any change under `supabase/functions/**` after merge to `main`. Edge-function unit tests run under vitest's `edge-functions` project (`vitest.config.ts`, include `supabase/functions/**/*.test.ts`) as part of root `npm run test` in CI (`.github/workflows/ci.yml`).

## 3. What triggered this work

PR #670 ("reject form text in parsed sheet fields", head `d0f818fb`) added `accept` filters after the first designer backfill stored junk such as "BATTERY BOX" and "MOCK UP" as designer names (see `HANDOFF.d/2026-11-03T2208Z-hetz-claude-tagging-after-indra-rescan.md` §4). The advisory Muse review of #670 (ai-review run 41665957999) raised five findings; the fixer bot deferred them because the PR was already closed. Albert's Nov 4 comment on the issue (checked against `main` `522e5722`) confirms: N/A placeholder is fixed; still open are spaced asset names, the unchecked wrapped line, the unanchored `FORM_FURNITURE`, and unfiltered `product_size`.

The Indra rescan this parser serves is **finished**: `admin_config.PDF_BACKFILL` read at 4:46 PM EST Nov 4 shows `status: completed`, 19,434 processed, 1,043 failed, `designers_filled: 7026`, `technical_designers_filled: 3013`, `files_used_added: 3256`. So this fix affects: (a) the requeue of the ~634 live failed files (tracked on #680, PR #718 raises the agent size limit), (b) every future sheet scan, and (c) nothing retroactively — stored `extracted_fields` were produced by the parser as it stood when each batch committed.

## 4. Scope

In: the four open findings on `pdf-sheet-fields.ts`, their regression tests, verification that finding 5 (N/A) is fixed, and closing #671 with evidence.

**NOT in this plan**
- Re-parsing already-stored `pdf_text_samples.extracted_text` to refresh `extracted_fields` or designer names (would need a shared-db RPC change and a decision on overwriting; raise on #680 if wanted).
- The #673 findings (designer reorder guard, licensor suffix strip, legal-text scan widening) — sibling plan `docs/plans/issue-673-pdf-assets-legal-designer-pairing.md`. Same file; see section 11 for ordering.
- Requeueing the 634 failed rescan files, the agent size limit (PR #718), NAS path corrections — #680 / #681 / #684.
- Any change to `commit_pdf_rescan_batch` or other shared-db objects.
- OCR quality (Indra misreads such as "Dicky" for the Disney logo).

## 5. Current state of the code (verified in this worktree at `01fcfc34`, identical to `origin/main` `4409e2d3` for this file)

`supabase/functions/_shared/pdf-sheet-fields.ts` (271 lines):
- `valueAfter` lines 109–129: `accept` is applied to the first value line (line 116) but the wrapped `next` line (118–124) is joined unchecked. Condition at line 121: `CONTINUES.test(value) || CONTINUATION.test(next) || (joinSingleWord && !/\s/.test(value))`. `joinSingleWord` is true only for `product_type` (line 241).
- `looksLikeAssetCode` line 131: `t.length >= 4 && /\d/.test(t) && !/\s/.test(t) && !/[:"”°©]/.test(t) && !/\.(gov|com)$/i.test(t)` — rejects any token with whitespace.
- `isPersonName` lines 134–137 — **already rejects `N/A`** (`!/^n\s*\/\s*a$/i.test(v)`, landed in PR #692 commit `95510d35`). Test coverage: `pdf-sheet-fields.test.ts:127-135` ("accepts joint designer credits with a slash but not N/A or view labels"). Finding 5 is fixed; the plan only re-verifies.
- `ACCEPT` lines 140–147: filters for creative/technical designer, art director, retailer, product_type, packaging_type. **No entry for `product_size`** (nor `licensor`, which has its own path).
- `FORM_FURNITURE` lines 150–151: `/^\W*\S?\W*\s*(New Submission|Revised Submission|...|Packaging|Concept|...|Other|...)/i` — no end anchor. Used at line 227 for the V1 `Description` value.
- `assetsAfter` lines 153–169: for each line within 14 lines of the heading, strips `ASSETS:` prefix (163), `splitFiles` on `, ; |` (164), keeps tokens passing `looksLikeAssetCode` (165).
- V1 path lines 216–229: `creative_designer` filtered by `isPersonName` (218); **`manager` (219) is unfiltered**; `licensor` (220), `style_guide` (221), `files_used` via `splitFiles` (222) — which is why V1 keeps spaced names like `AB_0010 P1`, `AB 0029.psd` (test lines 9 and 57).

Tests: `supabase/functions/_shared/pdf-sheet-fields.test.ts` (158 lines, 14 cases). Nothing in this plan is implemented; nothing is on a branch.

## 6. Key findings and root cause

- The V1/V2 inconsistency is real: V1 `FILES USED:` keeps `AB_0010 P1`; V2 `ASSETS:` drops the same token at line 131. Spaced names come from sheets whose asset list uses spaces inside one file name (`AB 0029.psd`) and from OCR inserting a space into one code. Nobody measured how many V2 sheets have spaced names; `sku_files_used` only grew by 3,256 rows in the rescan, so a loss would have gone unnoticed.
- `joinSingleWord` was added for product types like `GREYBOARD STORAGE CHEST / WITH MAGNETIC CLOSURE` (test line 29–30, 76) and for one-word types that wrap. It joins `next` without any check, so `CANVAS` + `12` or `CANVAS` + `©Acme` would store `CANVAS 12` / `CANVAS ©Acme`.
- `FORM_FURNITURE` was written for tick-box labels on blank forms (`_] New Submission`, `_) Packaging`, test lines 116–120). Unanchored, it also blanks a genuine description that starts with one of those words.
- `product_size` values are form-like (`W: 16”X H: 16" X D: 1”`) so the author left them unfiltered; but the same junk the test rejects for retailer (`10`, `12`, `())`) is accepted for size.
- `Manager:` on V1 sheets is an older-form line; values like `N/A`, `Albert Hazan` or junk reach `pdf_text_samples.extracted_fields.manager`. Today nothing downstream writes `manager` into `assets` (the RPC only reads `creative_designer`, `technical_designer`, `files_used`), so the fix is hygiene, not an incident.

## 7. Approaches considered and rejected

- **Split every V2 token on whitespace and test each part** — rejected as the only rule: it would turn `AB 0029.psd` into `0029.psd` (and drop `AB`), inventing a file name that does not exist. Splitting is the fallback only when the whole spaced token fails the spaced-token rule (step 1).
- **Dropping `joinSingleWord` altogether** — rejected: the `WITH MAGNETIC CLOSURE` continuation (test line 76) is a real sheet pattern.
- **Filtering `product_size` with `isPersonName`-style letters-only rules** — nonsense for sizes; sizes need digits and a unit or dimension marker.
- **Re-parsing all stored text as part of this fix** — out of scope (section 4); it needs a shared-db change and an overwrite decision.
- **Making `FORM_FURNITURE` a word-list `includes`** — rejected; it must stay anchored to the start and end of the line because the point is "this line is nothing but a label".

## 8. Design decisions

LOCKED
- A doubtful value becomes blank, never "best effort" text (owner's reaction to the junk-overwrite incident; handoff §4).
- V1 and V2 must agree on what a spaced file name is; the V1 test fixture (`AB_0010 P1`, `AB 0029.psd`) is the reference behaviour.
- All edits stay in `pdf-sheet-fields.ts` and its test file; no schema, no RPC change.
- `FORM_FURNITURE` keeps matching tick-box prefixes (`_]`, `_)`, `C `) and bare labels; it must stop matching a label followed by real words.

OPEN (implementer's judgment, criteria given)
- Exact spaced-token rule (step 1): the criteria in the step are the contract; the regex shape is yours.
- Exact size rule (step 4): must accept every shape in the adversarial table and reject bare integers and symbol runs; whether `10 inch` (no digit-x-digit) passes is your call — accept it.

## 9. The plan

All steps in one branch `fix/pdf-parser-671` from current `origin/main`. Run `npx vitest run supabase/functions/_shared/pdf-sheet-fields.test.ts` after every step.

**Step 0 — confirm state.** `git log --oneline -5 -- supabase/functions/_shared/pdf-sheet-fields.ts` on `origin/main`; if any commit after `95510d35` touches it, re-read lines cited in section 5 and adjust line numbers. Confirm finding 5 by running the existing N/A test. Gate: test file passes 14/14 before you change anything.

**Step 1 — spaced asset names (`assetsAfter` + `looksLikeAssetCode`, lines 131 and 163–166).**
Behaviour: a V2 `ASSETS:` token that contains whitespace is kept whole when it looks like one spaced file name: at most three whitespace-separated parts, every part ≥ 2 characters, at least one part contains a digit, no part is a form word (`PROP`, `LABEL`, `WARNING`, `WARNINGS`, `PAGE`, `TYPE`, `VIEW`, `SIZE`, `LINE`, `LEGAL`, `STYLE`, `GUIDE`), and the whole token passes the existing character/suffix checks. Otherwise split the token on whitespace and apply `looksLikeAssetCode` to each part. Keep the V1 `files_used` path unchanged. Implement as a new `assetTokens(token: string): string[]` used only by `assetsAfter`.
Gate: tests `keeps a spaced asset name on a V2 ASSETS line` and `drops form words that share a line with an asset` (table rows A1–A4) pass; existing test at line 104–114 (`AB_0010.ai` with `Prop 65 Label` on later lines) still passes.

**Step 2 — wrapped continuation (`valueAfter`, lines 118–124).**
Behaviour: `next` is joined only when `accept(next)` is true AND `next` does not start with a digit, `©`, `®`, `™`, `PO#`, or `Ages`. Keep the three existing join triggers. Gate: tests `does not absorb a number or legal mark after a one-word product type` (rows B1–B3) pass; test at line 69–82 (`WITH MAGNETIC CLOSURE`) still passes.

**Step 3 — anchor `FORM_FURNITURE` (lines 150–151).**
Behaviour: the regex matches only when the label is the whole line, allowing trailing tick-box punctuation and whitespace: append `\s*[_)\]\-]*\s*$`. `Date\s*:`, `REV\s*\d`, `PAGE\s*\d` keep matching with anything after them (they are furniture whatever follows) — give them their own alternation branch without the end anchor. Gate: tests `keeps a description that starts with a tick-box word` (rows C1–C3) pass; test at lines 116–120 still passes.

**Step 4 — filter `product_size` and V1 `manager`.**
Add `isSizeValue = (v) => /\d/.test(v) && /(["”'′″]|\b(in|inch|inches|cm|mm|m|ft)\b|\d\s*[xX×]\s*\d|\b[WHDL]\s*:)/i.test(v) && !/^[\d\s().:-]*$/.test(v)` (shape is yours; contract is rows D1–D5) and add `product_size: isSizeValue` to `ACCEPT` (line 140). At line 219 wrap `manager` with `isPersonName` exactly like `creative_designer` at 218. Gate: tests `rejects numbers and symbols where a product size belongs` and `treats a non-person manager as blank` (rows D1–D7) pass; test line 77 (`W: 16”X H: 16" X D: 1”`) and line 53 (`manager: "Pat Manager"`) still pass.

**Step 5 — adversarial table complete.** Every row below has a passing test. Gate: the test file lists each test name in the table.

**Step 6 — land.** Commit, push, `gh pr create` against `main` (title `fix(pdf): parser keeps spaced asset names and blanks form junk (#671)`), run `bin/ai-pr-wait <pr>` in the background; merge yourself (PopDAM has no reviewer gate; reviews are advisory). After merge, wait for `deploy-supabase.yml` to finish and confirm the deployed `agent-api` function version (`supabase functions list` or the Supabase dashboard's function updated-at) is later than the merge time. Post the closing comment on #671 signed with `$AI_GH_SIGNATURE` citing the merge SHA and the test names; close the issue. Live proof: when the failed-file requeue on #680 runs (after PR #718), query `pdf_text_samples` rows committed after your deploy for `extracted_fields->'files_used'` containing a space and for `product_size` values without a digit — expect ≥0 spaced names and 0 digitless sizes. Leave `- [ ] live proof` on #671 until that query is run, on the same issue.

## 10. Tests required

File: `supabase/functions/_shared/pdf-sheet-fields.test.ts`. Command: `npx vitest run supabase/functions/_shared/pdf-sheet-fields.test.ts`; whole suite: `npm run test` (root), plus `npm run lint` and `npm run typecheck` (CI).

Adversarial-cases table (parser is a trust boundary: OCR text from NAS files):

| Row | Input (text given to `parsePdfSheetFields`) | Hostile case | Expected | Test name |
|---|---|---|---|---|
| A1 | `RETAILER\nX\nASSET/STYLE GUIDE\nASSETS: AB_0010 P1, AB 0029.psd` | spaced file names on V2 | `files_used` = `["AB_0010 P1","AB 0029.psd"]` | keeps a spaced asset name on a V2 ASSETS line |
| A2 | `...ASSETS: AB_0010.ai Prop 65 Label` | junk after a name on one line | `["AB_0010.ai"]` | drops form words that share a line with an asset |
| A3 | `...ASSETS: STYLE GUIDE 2024 PG 12` | spaced junk with digits | `[]` | drops form words that share a line with an asset |
| A4 | `...ASSETS: 7pt type 5Warnings.ca.gov` | legal text | `[]` | drops form words that share a line with an asset |
| B1 | `RETAILER\nX\nPRODUCT TYPE\nCANVAS\n12` | number after one-word type | `product_type` = `CANVAS` | does not absorb a number or legal mark after a one-word product type |
| B2 | `...PRODUCT TYPE\nCANVAS\n©Acme` | legal mark | `CANVAS` | same |
| B3 | `...PRODUCT TYPE\nCANVAS\nAges 4+` | age warning | `CANVAS` | same |
| C1 | `Designer: X Y\nDescription\nPackaging includes 2 pieces` | real description starting with a label word | description kept | keeps a description that starts with a tick-box word |
| C2 | `...Description\nConcept art for FW26` | same | kept | same |
| C3 | `...Description\n_] Packaging` and `...Description\nOther` | bare labels | `null` | same (negative rows) |
| D1 | `RETAILER\nX\nPRODUCT SIZE\n12` | bare integer | `product_size` null | rejects numbers and symbols where a product size belongs |
| D2 | `...PRODUCT SIZE\n())` | symbols | null | same |
| D3 | `...PRODUCT SIZE\nW: 16”X H: 16" X D: 1”` | real size | kept | same |
| D4 | `...PRODUCT SIZE\n16 x 20 in` | real size | kept | same |
| D5 | `...PRODUCT SIZE\nSEE PAGE 2` | form text, no digit | null | same |
| D6 | `Manager: N/A` | placeholder | `manager` null | treats a non-person manager as blank |
| D7 | `Manager: BATTERY BOX 12` | junk | null | same |
| E1 | `Designer: N/A` / `n/a` / `N / A` | placeholder | null | existing test lines 127–135 (verify only) |

Existing 14 tests must stay green, in particular lines 46–59 (V1 fixture), 69–82 (V2 fixture), 104–114, 116–120.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges; Albert does not. Sign every GitHub post with `$AI_GH_SIGNATURE`. Times to humans in EST.
- **Same file as #673.** `assetsAfter`, `looksLikeAssetCode`, the licensor strip and the designer reorder all live within 30 lines of each other. Do #673's step C (legal-text stop in `assetsAfter`) before or together with step 1 here: step 1 makes spaced tokens acceptable, which is exactly the surface #673-C narrows. Preferred: one branch, one PR, both issues referenced, both plans' STATUS tables updated.
- `.github/workflows/edge-functions-format.yml` runs `deno fmt .` and pushes a `chore: deno fmt supabase edge functions` commit onto your branch after you push. `git pull --rebase` before pushing again, or the push is rejected.
- DB changes never go in this repo (shared-db, claim-first, `shared-db-change` skill). This plan needs none.
- The parser result is written by `commit_pdf_rescan_batch`, which **overwrites** designer names on assets (with a backup row). A new accept rule that is too strict only leaves blanks; one that is too loose overwrites real names. Err strict.
- No band-aids: do not special-case a single sheet; every rule must be expressed as a test row.
- `npm run lint` includes `no-useless-escape` (it broke the frontend deploy once, PR #686); keep regexes clean.
- Worktree rule: edit in your own worktree, stage only your hunks.
- Review-finding issues: the fixer bot marked #671 `fixer-deferred`; closing is manual, with evidence.

## 12. Access and environment

- Machine: hetz (production VPS). Repo checkout root `/worksp/popdam`; use a worktree per task.
- `gh` is authenticated as `u2giants`. Supabase MCP is authenticated; confirm the project URL contains `qsllyeztdwjgirsysgai` before reading. Production DB is read-only by default.
- Secrets: 1Password vault `vibe_coding` (reference by item title only). No secret is needed for this plan.
- Local run: `npm ci && npx vitest run supabase/functions/_shared/pdf-sheet-fields.test.ts`. No server needed; the function is pure.
- Deploy: merge → `deploy-supabase.yml` (Supabase project `qsllyeztdwjgirsysgai`).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–4 implemented in `pdf-sheet-fields.ts`; every adversarial row has a named passing test.
- [ ] Root `npm run lint`, `npm run typecheck`, `npm run test` green locally and in CI.
- [ ] PR merged; `deploy-supabase.yml` run succeeded; function updated after merge.
- [ ] #671 closed with a comment citing merge SHA + test names; `- [ ] live proof` left on #671 until the next rescan batch is checked (section 9 step 6).
- [ ] STATUS table above updated; the handoff file linked at the top updated to say this plan is done.

Risks: a too-strict size rule could blank real sizes on sheets that write sizes without units — mitigated by rows D3/D4 and by sampling 20 live `product_size` values from `pdf_text_samples.extracted_fields` before finalising the regex (read-only query). Rollback: revert the PR; nothing is written retroactively.

Open questions: none that block. Whether stored fields should be re-parsed is a #680 question for the coordinator, not this plan.

## Self-audit

1. Could a brand-new session execute this without asking? Yes — section 5 gives exact lines, section 9 gives per-step behaviour and gates, section 10 the test rows and names, section 12 the commands and access.
2. Does it carry every piece of background and what was ruled out? Yes — section 3 (incident and review origin), section 6 (why each finding exists), section 7 (rejected rules, including the whitespace-split trap), section 11 (overlap with #673, deno fmt commits).
3. Is the goal clear enough to steer a wrong step? Yes — section 1 states the rule "real value or blank, never junk; err strict", which decides every judgment call in steps 1 and 4.
