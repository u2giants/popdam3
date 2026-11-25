---
summary: Combined plan for #1276, #1293, #1303 — repair the Master Data/DesignFlow reference cutover STATUS and fix the shared Size picker gaps in PopDAM Master Data. Read its STATUS first.
kind: plan
status: open
read-when: implementing #1276, #1293 or #1303; changing the Master Data Description Size picker; editing plan_master_data_designflow_reference_cutover.md STATUS
---

# Plan: Master Data Size picker fixes and reference-cutover STATUS repair (u2giants/popdam3 #1276, #1293, #1303)

Issues covered (all advisory AI review findings on the #1273 workstream; parent work item is #1273):
- #1276 — review of PR #1275 (STATUS reconcile of the cutover plan)
- #1293 — review of PR #1292 (shared Product Size values in Master Data)
- #1303 — review of PR #1302 (Depth storage delivery STATUS + handoff)

Handoff: [HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-plans-master-data-shared-data-invites.md](../../HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-plans-master-data-shared-data-invites.md)
Parent plan (not replaced; its Steps 9–11 stay the Depth/consumer work): [plan_master_data_designflow_reference_cutover.md](../../plan_master_data_designflow_reference_cutover.md)
Written 2026-11-25 3:56 PM EST by Claude (plan only; nothing implemented).

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| A1. Cutover plan Step 3: restore a re-derivable Size reconciliation | ⬜ open | #1276 finding 1 |
| A2. Cutover plan Step 4 vs 7: reconcile Creative Designer | ⬜ open | #1276 finding 2 |
| A3. Cutover plan Step 2 vs 7: reconcile Packaging alias totals | ⬜ open | #1276 finding 3 |
| A4. Cutover plan Step 6: remove "Release 1 complete" | ⬜ open | #1276 finding 4 |
| A5. Cutover plan Step 8/10: scope "live" correctly; add PopDAM DB pre-start gate | ⬜ open | #1303 findings 1–2 |
| A6. One live handoff for #1273 | ⬜ open | #1303 finding 3 |
| B0. Read-only census of MG04 labels (bare numbers, retired non-dimension labels) | ⬜ open | Decides B2/B3 detail |
| B1. Bulk (AI) Description edit: per-row Size validation with a named-row error | ⬜ open | #1293 finding 1 |
| B2. Parser: a bare-number Size label must not steal a trailing number | ⬜ open | #1293 finding 2 |
| B3. Retired Size labels recognized on rows that already hold them | ⬜ open | #1303 finding 2 (may need shared-db change C1) |
| B4. Size list failure: say editing is paused and why; docs match | ⬜ open | #1293 finding 3, #1303 finding 2 |
| C1. (Only if B0 shows it is needed) shared-db: let `api.product_size_list` return retired labels for recognition | ⬜ open | claim-first in `popcre/shared-db` |
| D1. Tests, PR, merge, deploy, live proof on both sheets, close issues | ⬜ open | — |

Where a fresh session starts: Phase A (docs) and B0 can run in parallel. B1–B4 after B0. C1 only if B0 says so, and before B3.

## 1. The ultimate goal

POP staff editing a Master Data line in PopDAM must be offered exactly the
approved Product Sizes (ColdLion MG04, shared list `core.product_size`), must be
able to keep the Size a line already has even if that Size was later retired,
and must never have a description silently re-read with a different meaning.
Bulk AI edits must behave the same way as one-cell edits and say exactly which
line blocked them. The cutover plan that tracks this work must tell the next
session the truth: what is proven live, with an artifact a reader can reopen,
and what is still open. **If a step conflicts with this goal, the goal wins —
stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, `main` is the release branch) is POP Creations'
internal digital asset manager. Its **Master Data** screen
(`https://dam.designflow.app/styles`) is an AG Grid spreadsheet of Licensed and
Generic SKU lines stored in `public.style_tracker_rows` in the shared Supabase
project (production `qsllyeztdwjgirsysgai`; canonical schema repo
`popcre/shared-db`; vendored read-only mirror at `shared-db/` in this repo).
The **Description** column is built from sections MG01 → MG02 → MG03 →
Licensor + Property → Art Description → Size, stored as one text string (there
is **no Size id on the row**). DesignFlow PLM (`popcre/designflow-*`, sandbox
`https://alsand.designflow.app`) is the item system that must converge on the
same lists; it is out of scope here except for documentation.

Key files:
- `src/pages/styles/helpers.ts:260` `fetchSizeOptions` — calls `api.product_size_list()` with no arguments and keeps only `selectable` labels.
- `src/pages/styles/helpers.ts:278` `parseDescriptionParts` — splits a description; Size match at `:312-327`.
- `src/pages/styles/helpers.ts:353` `validateDescriptionSelection(value, options, currentValue)` — Size passes if approved or equal to `currentValue`'s parsed Size.
- `src/pages/styles/columns.ts:33` `SIZE_AT_END_RE` — legacy dimension regex.
- `src/pages/styles/cells.tsx` `DescriptionBuilderEditor` — popup editor; Size list = `options.size`.
- `src/pages/StylesPage.tsx:83` size query; `:634-637` Description editable only when `isAdmin` and the size list loaded; `:715-722` per-cell validation; `:816-826` AI bulk edit; `:851-855` admin Retry button.
- `src/App.tsx:38-41` QueryClient defaults: `retry: 1`, `staleTime: 5_000`.
- `docs/MASTER_DATA.md:158-160`, `:297` — Description/Size behaviour docs.
- `src/test/master-data-size-options.test.ts` — current Size tests.
- Shared contract: `shared-db/supabase/migrations/20260809170400_api_product_size_and_depth_pickers.sql:28-77` — `api.product_size_list(p_selected_ids uuid[], p_division_code, p_search, p_limit)` returns active rows plus inactive rows **only when their id is passed**.

## 3. What triggered this work

Three advisory AI reviews on merged PRs, each deferred by the automatic fixer
("source owner must address"). Full text is on each issue; the actionable
findings are:

#1276 (cutover plan STATUS, PR #1275):
1. Step 3 replaced the reconciliation detail (37/37 headers, 530 Size arrays vs 661 legacy rows, 17 gaps = 8 inactive + 9 EP001, 11 label differences) with "shared-db #597/#602/#607 (closed)" and an unsourced "538 rows".
2. Step 4 says "Phase 2 requires one approved person mapping" (3 assignments); Step 7 says no live assignments, no mapping needed — unexplained.
3. Step 2 says "1 alias candidate"; Step 7 (at review time) named two aliases. Step 7 now says "Packaging merged into one list (owner ruling 2026-11-22)" without totals.
4. Step 6 says "Release 1 complete" while Steps 8–10 are open.

#1293 (Size picker code, PR #1292):
1. AI bulk Description edit validates one replacement value against every row's own old description; one row's different legacy Size blocks the whole batch with a generic error; validation runs before the editable-row filter.
2. Any selectable label (including a possible bare number such as `12`) can be split off the end of a description; the `>=` length tiebreak favours the approved label; no test with a real MG04-like list and multi-dimension legacy sizes.
3. If the Size list fails, Description editing is disabled; docs mention only the retry.

#1303 (Depth STATUS, PR #1302):
1. Step 8 "Depth storage is live" — the plan must require proof that the database PopDAM actually uses (production and the PopDAM sandbox/preview) has `public.style_tracker_rows.staged_product_depth_id`, `dam.validate_style_tracker_product_depth()` and `api.style_tracker_staged_product_depth` before consumer work starts.
2. Size picker: Retry is admin-only; retired Sizes are dropped (`p_selected_ids` never passed); the existing test asserts retired rows are dropped; generic-sheet behaviour unverified.
3. Two `status: current` handoffs give overlapping Size/Depth directions: `HANDOFF.d/2026-11-23T1905Z-hetz-claude-1273-master-data-cutover.md` and `HANDOFF.d/2026-11-23T2020Z-edge-dev3-codex-1273-size-depth.md`.

## 4. Scope

In: cutover-plan STATUS text (Steps 2, 3, 4, 6, 7, 8, 10 and the fresh-session line); `docs/MASTER_DATA.md` Size text; the five Size code paths above and their tests; a possible small shared-db contract addition (C1); live proof of Size on both sheets.

NOT in this plan: Depth editing UI, Depth carryover on linking, DesignFlow Size/Depth consumers, legacy Depth backfill, duplicate-path retirement (those are cutover plan Steps 9–11 on #1273); Packaging, Vendor or Designer data changes; any change to who may edit Master Data (editing is admin-only today by design: `StylesPage.tsx:634`).

## 5. Current state of the code (origin/main 787c20b8, read 2026-11-25)

- Size list: `fetchSizeOptions` drops non-selectable rows (`helpers.ts:269`); test `"uses selectable labels from the shared picker…"` asserts a `Retired` row is dropped.
- Parse: approved label wins when `approvedSize.length >= legacySize.length` (`helpers.ts:320`). A retired **non-dimension** label (e.g. an `18oz`-style label that MG04 later retired) is matched by neither the approved list nor `SIZE_AT_END_RE`, so it lands in Art Description and Size parses empty → `validateDescriptionSelection` reports "Size" even with `currentValue` (because `currentSize` also parses empty). A retired **dimension** label survives via the regex. This is the concrete form of #1303 finding 2.
- Bulk edit (`StylesPage.tsx:816-826`): loops over all `selectedRows`, skips ColdLion-linked rows, throws on the first failure, then filters `editableRows`.
- Failure UX: Description not editable while `sizeOptionsQuery.data` is missing; admins see "Retry loading the shared Size list". Non-admins cannot edit any cell, so the "non-admin has no retry" finding has no user impact; record that, do not change permissions.
- Query defaults are `retry: 1, staleTime: 5s` (`App.tsx:40-41`), not "cached indefinitely" as #1303 claimed.
- Cutover plan STATUS rows as quoted in §3; Step 8 already says the item links are unpopulated; Step 10 says Size picker live, Depth entry open.
- Generated types already include `staged_product_depth_id` (`src/integrations/supabase/types.ts:3779`).

## 6. Key findings

- Rows hold Size as text, so the shared contract's "pass the ids you already hold" mechanism cannot be used directly by PopDAM. Recognising a retired label therefore needs the retired **labels** (not ids) — either from a contract option (C1) or by resolving text → id first, which itself needs the labels.
- `core.product_size` is readable by `authenticated` under RLS (`20260809170000_core_product_size_and_depth_foundation.sql:285-343`), but apps must read through the `api` contract, not `core` directly (shared-db contract rule) — so do not query `core.product_size` from PopDAM.
- The 2026-11-23 handoff (`…2020Z…size-depth.md` §3) records 530 active + 8 retired Sizes and 121 Depths in both production and DesignFlow sandbox, with proof at https://github.com/u2giants/popdam3/issues/1273#issuecomment-7111929143 — this is the artifact Step 3 should cite (530 + 8 = 538).
- Shared-db Step 1 evidence folder: `shared-db/docs/verification/master-data-designflow-reference-cutover-20260807/` (vendored mirror) holds the original 661-row MG04 comparison.
- #1273 comment: "Creative Designer needs no mapping because there are no live assignments" — the 3 August assignments no longer exist; A2 must cite where that was re-checked.

## 7. Approaches rejected

- Reading `core.product_size` directly from PopDAM for retired labels: bypasses the `api` contract; rejected.
- Hard-coding the 8 retired labels in PopDAM: a second copy of shared data, the exact thing the no-copies effort removed; rejected.
- Dropping the legacy-size allowance for bulk edits: removes a working capability (bulk edit across rows that share the same legacy Size); rejected in favour of per-row validation with a named-row error.
- Letting non-admins see the Retry button: they cannot edit anyway; rejected as noise.
- Marking cutover Steps 8/10 "done": live proof for Depth entry and cross-app reload is still missing; they stay partial.

## 8. Decisions

Locked (2026-11-25, this plan, reversible):
- Retired Sizes stay visible and valid on a line that already holds them; never offered for a new choice (owner rule recorded in the shared contract comment and the cutover plan fresh-session line, 2026-11-23).
- Bulk edit stays all-or-nothing; the error names every blocking line (SKU or row number) and its Size.
- ColdLion-linked lines stay read-only for Description (existing).
Open (implementer judgment, criteria given):
- B2 exact rule depends on B0: if MG04 has no bare-number labels, keep the parser and add a guard test; if it has some, a bare-number label matches only when it is the whole remaining text after Licensor + Property **or** the editor produced it (the editor always rebuilds via `assembleDescription`).
- C1 needed or not: needed if B0 finds any retired label that `SIZE_AT_END_RE` does not match.

## 9. The plan

### Phase A — cutover plan STATUS (docs only; parallel with B0)

A1 (`lead-only`: evidence judgment). In `plan_master_data_designflow_reference_cutover.md` Step 3 evidence: cite the catalog proof comment (§6), state "530 selectable + 8 retired = 538 rows in `core.product_size`", and restore the 2026-08-07 reconciliation (37/37 headers, 530 vs 661, 17 gaps = 8 inactive + 9 EP001, 11 label differences) with the path `shared-db/docs/verification/master-data-designflow-reference-cutover-20260807/`. Verify each number against the cited artifact before writing it; drop any number you cannot find. Gate: every number in the row appears in a cited file or comment.

A2 (`lead-only`). Step 4: append "Superseded 2026-11-23: re-check found zero live creative-designer assignments (the 3 August assignments were removed); no mapping needed — see <#1273 comment URL>". Find the URL with `gh api repos/u2giants/popdam3/issues/1273/comments --jq '.[]|select(.body|test("Creative Designer"))|.html_url'`. If no comment shows the re-check, run a read-only query of DesignFlow assignments per the 2020Z handoff §8 access, or mark Step 7's designer clause `🟨 unverified`. Gate: Steps 4 and 7 no longer contradict.

A3 (`helper-ok`). Step 2: append "Superseded by Step 7: owner ruling 2026-11-22 merged Packaging into one shared list (see #1273)". Step 7: add the resulting list size and the alias mappings it used, citing the DesignFlow PRs already named in Step 9 (backend#526, frontend#628). Stop-and-ask: if the alias count cannot be found in those PRs.

A4 (`helper-ok`). Step 6: replace "Release 1 complete." with "Depth catalog migrated; Depth entry and consumer cutover continue in Steps 8–10." Gate: `grep -n 'Release 1 complete' plan_master_data_designflow_reference_cutover.md` empty.

A5 (`lead-only`). Step 8: say "Depth storage contract is in shared production and preview (shared-db #6985); no PopDAM or DesignFlow screen uses it yet." Step 10 next-gate: add "Before starting: read-only check on production and the preview branch that `public.style_tracker_rows.staged_product_depth_id`, `dam.validate_style_tracker_product_depth()` and `api.style_tracker_staged_product_depth` exist (query `information_schema.columns` / `pg_proc` / `information_schema.views`); quote the project ref." Also record the Size items B1–B4 as open in Step 10 until D1 passes. Gate: rows readable and consistent with §5.

A6 (`helper-ok`). Set front-matter `status: superseded` in `HANDOFF.d/2026-11-23T1905Z-hetz-claude-1273-master-data-cutover.md` (front-matter only) with `superseded-by: 2026-11-23T2020Z-edge-dev3-codex-1273-size-depth.md`; the fresh-session line of the cutover plan names only the 2020Z handoff and this plan. Stop-and-ask: if doc-health rejects `superseded`.

### Phase B — Size picker code

B0 (`lead-only`: production read). Read-only, as `authenticated`-equivalent or the read-only identity: `select label, status from api.product_size_list(null, null, null, 2000)` for active labels; for retired labels use the shared-db read-only CLI (`select label, status from core.product_size where status <> 'active'`) — reading core for a census is allowed (read-only inspection); the app must not. Record: any label matching `^\d+(\.\d+)?$`; every retired label and whether `SIZE_AT_END_RE` matches it. Save as `docs/verification/master-data-size-census-<date>.md` (labels are business vocabulary, not licensed data). Gate: file exists with both lists and the project ref.

B1 (`helper-ok` after lead reviews the diff). `StylesPage.tsx:816-826`: compute `editableRows` first; validate each with `validateDescriptionSelection(value, descriptionOptions, row.description)`; collect failures `{ row label (SKU or row number), parsed size }`; if any, throw one error: "N of M lines would get a Size that is not approved: <up to 5 labels>…"; apply nothing. Add `docs/MASTER_DATA.md` sentence: "A bulk edit keeps a legacy Size only on lines that already have that same Size; otherwise it is refused and names the lines." Gate: test `bulk edit across rows with different legacy sizes names the blocking rows` (see §10). Stop-and-ask: if the AI plan can carry per-row values (then per-row application is possible and the lead decides).

B2 (`lead-only`: parser semantics). Apply the B0-dependent rule in §8 inside `parseDescriptionParts` (`helpers.ts:312-327`). Keep the current `>=` tiebreak (approved label wins a tie with the legacy regex) unless B0 lists a label where that tie produces a different split than the legacy regex; in that case prefer the longer match and the regex on a tie, and record the reason in a code comment citing the census file. Gate: tests `bare-number label …` and `multi-dimension legacy sizes round-trip` pass.

B3 (`lead-only`). Make retired labels recognisable but not offered: `fetchSizeOptions` returns `{ selectable: string[]; retired: string[] }` (adjust `DescriptionEditorOptions` in `src/pages/styles/types.ts`: add `retiredSize: string[]`); `parseDescriptionParts` matches against `size ∪ retiredSize`; `validateDescriptionSelection` accepts a retired label only when it equals `currentValue`'s Size; the editor list (`cells.tsx`) still offers only `size`, but shows the row's current retired Size as the selected value. Source of `retired`: C1's contract option if C1 ran; if B0 found every retired label matches `SIZE_AT_END_RE`, skip C1 and set `retired = []` with a code comment citing the census file. Update the existing test that asserts retired rows are dropped. Gate: tests in §10; no hard-coded labels (`grep -n "18oz" src/pages` empty outside tests).

B4 (`helper-ok`). When `sizeOptionsQuery.isError`, show (to admins, next to Retry) "Description editing is paused until the shared Size list loads." Update `docs/MASTER_DATA.md:159`: "If the Size list cannot load, Description editing pauses and administrators see a retry." Gate: test `size list failure pauses Description editing` or a screenshot with the list request blocked in the browser.

### Phase C — shared-db (only if B0 requires it)

C1 (`lead-only`: shared structure). Load `shared-db-change`. Claim `api.product_size_list` on the existing issue popcre/shared-db#597 (or a `db-work` issue if closed). Add parameter `p_include_retired boolean default false` that, when true, also returns inactive rows with `selectable = false`. Because adding a parameter changes the signature, drop and recreate in one migration with grants re-issued, keeping old call shapes valid (all params defaulted). Migration version from the lane tool; preview first; PR; automatic promotion only. Add a pgTAP/SQL test: default call returns no inactive row; `p_include_retired => true` returns all 8 with `selectable=false`. Then regenerate PopDAM types. Gate: production ledger shows the version; `select count(*) from api.product_size_list(p_include_retired => true) where not selectable` = the B0 retired count.

### Phase D — land and prove

D1 (`lead-only`). One PR for Phase A + B (`Fixes #1276`, `Fixes #1293`, `Fixes #1303`), checks green, AI merges, confirm the publish-frontend run and the Coolify-served SHA. Live proof signed-in at `https://dam.designflow.app/styles`, both Licensed and Generic sheets: (a) Size picker lists approved labels; (b) a line with a retired or legacy Size opens, edits Art Description, saves, reloads with Size unchanged; (c) AI bulk edit over two lines with different legacy Sizes is refused naming both. Use disposable user-created rows and delete them after. Screenshots under `docs/verification/`. Comment evidence on each issue (signed) and on #1273; update this STATUS and cutover Step 10.

## 10. Tests required

Add to `src/test/master-data-size-options.test.ts`:
- `bulk edit across rows with different legacy sizes names the blocking rows` (extract the B1 loop into a pure helper in `helpers.ts`, e.g. `validateBulkDescription(value, options, rows)`, so it is unit-testable).
- `bulk edit keeps a shared legacy size on rows that already have it`.
- `bare-number label does not take a trailing number from Art Description` (with B0's real labels if any; else a synthetic `12`).
- `multi-dimension legacy sizes round-trip` — `16x20" x1.2"` and `24x24" x1.5"` with an MG04-like list of 20+ labels.
- `retired label stays valid only on the row that already holds it` (replaces the "Retired is dropped" assertion).
- `retired label is never offered in the picker list`.
- `size list failure pauses Description editing` (render test or helper test of the `editable` predicate).
Must stay green: `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Note the 2020Z handoff observed ten pre-existing failures on unchanged main — compare against a fresh `main` run, do not count those as regressions.

### Adversarial cases (description text is user and AI input)

| Input | Hostile case | Test |
|---|---|---|
| Bulk AI value | Legacy size differing per row | `bulk edit across rows with different legacy sizes…` |
| Bulk AI value | Selection mixing ColdLion-linked and unlinked rows | `bulk edit skips ColdLion-linked rows before validating` |
| Description text | Ends in standalone number equal to a size label | `bare-number label does not take…` |
| Description text | Retired label typed on a new row | `retired label stays valid only on the row…` |
| Description text | Extra whitespace / case variants of a label | `uses selectable labels … preserves punctuation` (existing) + case variant assertion |
| Size API | Request fails | `surfaces an unavailable shared picker` (existing) + `size list failure pauses…` |

## 11. Constraints and gotchas

- Feature branch + PR; never push to `main`; AI merges.
- No app-repo migrations; shared structure only via `popcre/shared-db` claim-first (C1). Never edit `shared-db/` mirror.
- No hard-coded Size lists (no-copies rule).
- Visual verification required for UI (D1 screenshots).
- Generic sheet previously timed out in browser proof — retest after deploy; do not claim it from the Licensed sheet.
- Prove the target project before any write; production is read-only except through normal app use on disposable rows.
- Do not edit other sessions' handoff bodies (front-matter status only, A6).

## 12. Access and environment

`gh` as `u2giants` (popdam3 + popcre/shared-db read/write). Supabase read-only: 1Password `vibe_coding`, Supabase CLI Personal Access Token item (location only). Shared project refs: `ai-private-config value supabase_shared_prod_ref` / `supabase_shared_preview_ref`. Browser: signed-in PopDAM session via Microsoft SSO (`docs/AUTHENTICATION.md`). Local: `npm ci`, `npm run dev`, `npx vitest run`.

## 13. Definition of done, risks, open questions

Done: every STATUS row ✅ with an artifact; PR merged; frontend SHA verified live; D1 proof on both sheets; #1276, #1293, #1303 closed with signed evidence; cutover Step 10 updated (Depth items stay open there).
Risks: parser changes can re-split existing descriptions — mitigated by round-trip tests and B0 census; C1 signature change could break DesignFlow callers — mitigated by keeping every parameter defaulted and testing old call shapes. Rollback: revert the PR; C1 by fix-forward migration.
Open: B2/C1 depend on B0 (criteria in §8).

## Self-audit (2026-11-25)

1. Fresh session executes without asking: yes — §2 names every file/line, §5 the exact current behaviour, §9 per-step edits and gates, §12 access. Gap found and fixed during drafting: retired non-dimension labels were not covered by the reviewer's text; §5 states the concrete failure.
2. Background carried: yes — §3 lists every finding, §6/§7 explain why ids cannot be used, why `core` direct reads and hard-coding are rejected, and which reviewer claims were wrong (cache, non-admin retry).
3. Goal clear: yes — §1 sets the business rule (approved for new, retained for existing, no silent meaning change, truthful STATUS); §8 separates locked and open choices.

## Lead launch prompt

```text
Implement docs/plans/issue-1276-1293-1303-master-data-size-picker-and-cutover-status.md in u2giants/popdam3. Read its STATUS first, then plan_master_data_designflow_reference_cutover.md STATUS.
You (lead) do A1, A2, A5, B0, B2, B3, C1 (only if B0 requires it) and D1, and verify everything. Hand A3, A4, A6, B1 and B4 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design decisions, never merges or posts, asks you when a stop-and-ask trigger fires, and is taken back after 30 minutes stuck.
You run every test in §10 and every gate yourself; live proof (D1) is yours alone.
```
