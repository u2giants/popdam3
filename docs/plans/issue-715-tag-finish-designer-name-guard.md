# Plan: Review finding: u2giants/popdam3#712 Tagging: block scan debris from tags (#680) (u2giants/popdam3#715)
Issue: https://github.com/u2giants/popdam3/issues/715
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Confirm each finding is still open on `main` | ⬜ open | Checked 2026-11-04 4:45 PM EST on `origin/main` 4409e2d3: PR #712 (14d3d546) and the later #721 (b19fac79) both landed; none of the four findings is addressed, see §5. No fixer-bot PR exists |
| 1 | One person-name rule (`isPersonName`) with a character exception, used for model tags and sheet packaging | ⬜ open | |
| 2 | `isJunkTag` normalises its input | ⬜ open | |
| 3 | Remove the hard-coded `STAFF_FULL_NAMES`; coverage comes from the DB first-name list plus the rule | ⬜ open | |
| 4 | Tests (regression for the first-word leak, consistency, normalisation) | ⬜ open | |
| 5 | Docs note in `docs/MODEL_RULES.md` tagging rules | ⬜ open | |
| 6 | PR, CI, merge, Railway worker deployed | ⬜ open | |
| 7 | Live proof on one freshly tagged file whose sheet names a designer; close #715 | ⬜ open | |

Where a fresh session starts: Step 0, then Step 1.

---

## 1. The ultimate goal

Search tags on a PopDAM file must be things a person would search for — characters, product words, asset types — and never a staff member's name, sheet furniture, or scan garbage. Owner rule (issue #680, Nov 3 2026): people are never tags. PR #712 fixed real cases ("peter pan" and "amy rose" were being dropped because Peter and Amy are designers' first names) but did it by weakening the person rule so that a designer's **full** name written on a sheet ("luis herrera") now becomes a search tag. When this plan is done, a character that shares a designer's first name keeps its tag **because it is a character**, a designer's name in any form is dropped, the same rule applies to the sheet's packaging value, the junk check is safe however it is called, and no staff list is typed into source code.

**If a step conflicts with this goal, the goal wins — stop and flag it.** A leaked person's name is worse than a redundant character tag, because characters already reach the tags through two other routes (§6).

## 2. What this application is

PopDAM (POP Creations' Digital Asset Manager, https://dam.designflow.app) tags product art with AI in the **Railway worker** (`apps/worker/`, Node + TypeScript, auto-deployed from `main`). After each model call, `apps/worker/src/handlers/tag-finish.ts` applies deterministic clean-up (`finishTagResult`) so rules cost no tokens. Its inputs come from `apps/worker/src/handlers/ai-tagging.ts` (`loadFinishContext`, `main` `:283-304`): the file's selected characters, licensing state, sheet facts (`packaging_type`, `retailer` from the Indra rescan's `extracted_fields`), customer names (`core.customer`), and designer **first** names from the DB table `public.known_designer_first_name` (shared-db migration `20261103174555_pdf_sheet_designer_known_names.sql`, upper-case first names, service-role readable). Repo `u2giants/popdam3`, branch `main`. Rules doc: `docs/MODEL_RULES.md`.

## 3. What triggered this work

PR #712 (head `778d0792`, merged 4:15 PM EST Nov 4 as 14d3d546) replaced `isPerson` (first-word match) with `isFirstName` (exact match) and added hard-coded `STAFF_FULL_NAMES`. The advisory review (Muse, run 41913496066) found:

1. **Designer-name leak regression** — `tag-finish.ts` old `isPerson` blocked any model tag whose first word was a designer first name; new `isFirstName` blocks only an exact single-token match. "luis herrera" with `designerFirstNames = {"luis"}` was dropped before and is a tag now. `STAFF_FULL_NAMES` covers 16 people only.
2. **Inconsistent rule** — model tags use full equality; sheet `packaging_type` still uses first-word (`packaging.split(/\s+/)[0]`). "peter pan box" is suppressed as packaging but kept as a model tag.
3. **`isJunkTag` assumes lower-case input** — the sets and patterns have no `i` flag; `isJunkTag("Pantone 186 C")` is false. Safe only because the caller lower-cases first.
4. **Staff allowlist hard-coded** — rots when staff changes, unlike the DB-sourced first names and customers.

Reproduce (unit level, on `main`): `finishTagResult({ tagData:{ asset_tags:[{tag:"Luis Herrera"}] }, designerFirstNames:new Set(["luis"]), characterIds:[], characterNames:new Map(), filename:null, licensed:false })` returns a tag `luis herrera`.

## 4. Scope

In: `tag-finish.ts` rules and tests, the `loadFinishContext` wiring if a new input is needed, one doc line, deploy, live proof.

**NOT in this plan:**
- Changing the model prompt or `TAG_ASSET_SCHEMA` / `tag-asset-contract.js`.
- The "named character" and "selected character" routes (`tag-finish.ts:181-186`) — they stay as the way characters reach tags.
- The PDF rescan designer overwrite (`isKnownDesigner`, `tag-finish.ts:206-213`; `apply_sheet_designers` in shared-db) — a different rule for a different field; untouched.
- A new DB table or RPC for staff full names. Considered and rejected (§7); if a future ruling wants a curated people list it starts in `popcre/shared-db`, claim-first.
- Backfilling or cleaning tags already saved by the leaky version (a data job; note the count on #680 if the live proof shows leaked names, but do not fix here).

## 5. Current state (verified on `origin/main` @ 4409e2d3, 2026-11-04 4:45 PM EST; the planning worktree is behind `main` by #721, so use `main` line numbers)

- `apps/worker/src/handlers/tag-finish.ts:66-70` `STAFF_FULL_NAMES` (16 names); `:72-84` `FORM_TEXT_TAGS`; `:86-97` `JUNK_TAG_PATTERNS` (no `i` flags); `:99-102` `export function isJunkTag(tag)` — no normalisation; `:129` `JUNK_TAG` regex (sheet boilerplate, from #721); `:137-141` `sheetTagValue` lower-cases; `:143-204` `finishTagResult`; `:145` `const isFirstName = (value) => designerFirstNames.has(value)`; `:155-165` model-tag loop, `:164` the keep condition `!isJunkTag(renamed) && !isFirstName(renamed)`; `:173-176` licensor/property names always added (#721); `:181` selected character names added; `:183-186` model `character_names` added via `sheetTagValue` (#721); `:190-191` packaging with the first-word check; `:192-194` retailer → customer.
- `apps/worker/src/handlers/ai-tagging.ts:257-265` `knownDesignerFirstNames` (cached 10 min, failure returns the last set or empty); `:283-304` `loadFinishContext` builds the input; `:320` the `finishTagResult` call; `:971-973` `tagSingleAsset` selects the asset without `designer_name`.
- Tests on `main` `apps/worker/src/handlers/tag-finish.test.ts`: `:116-120` junk list (includes "albert hazan", "sarbani ghosh" through the hard-coded set); `:122-126` good list (includes "peter parker"); `:128-131` "a character sharing a designer's first name keeps its tag" expects `["peter pan","amy rose"]` from `designerFirstNames {peter, amy, luis}` with **no** characters and **no** `character_names` — this test encodes the under-block and must change (§9 Step 4).
- Docs: `docs/MODEL_RULES.md` tagging-rules bullets (search "Owner rules from 2026-11-03" / junk tags) — the #712 and #721 rules are summarised there; nothing about the person rule's exception.
- Nothing from this plan exists yet; no branch, no PR.

## 6. Key findings and root cause

- The swing happened because the only test for the motivating case gave the function **no character context**. In production the same file would carry Peter Pan either as a selected character (`characterIds` → `:181`) or in the model's `character_names` (`:183-186`, schema field `character_names` in `apps/worker/vendor/tag-asset-contract.js:82`, prompt rule at `:187` tells the model to list every drawn character there). So a character-aware exception has the data it needs already inside `FinishTagInput`; no new query is required.
- Residual leak path even after this plan: the model putting a person into `character_names` ("Luis Herrera"). That route bypasses the person rule by design (characters outrank). Mitigation: the licensor-catalog match (`addNamedCharacters`, `ai-tagging.test.ts:281-288`) only *links* exact catalog names; the tag is still added at `:185`. Accepted as out of scope, recorded in §13.
- The DB first-name list has 27+ rows including common character first names (AMY, PETER, JAMES, JON). A first-word rule therefore needs the character exception or it reverts to #712's motivating bug.
- `isJunkTag` is exported and used only by `finishTagResult` (`grep -rn "isJunkTag" apps/worker/src` → `tag-finish.ts`, `tag-finish.test.ts`). Normalising inside is free.

## 7. Approaches considered and rejected

- **Full-name set from `assets.designer_name` / `technical_designer_name`** — no DISTINCT RPC exists (checked `admin-api` and shared-db migrations; only `apply_sheet_designers`, `backfill_pdf_sheet_designers`, `is_known_designer_value`); reading all rows through PostgREST is a whole-table pull per cache refresh. Rejected for this issue; would need a shared-db RPC first.
- **Keep `STAFF_FULL_NAMES` and extend it** — exactly Finding 4. Rejected.
- **Only the exact-first-name rule plus the staff list** (status quo) — Finding 1. Rejected.
- **Block by first word with no exception** (pre-#712) — drops "peter pan" when the model only wrote it in `asset_tags`. Rejected; the exception set makes it safe.
- **Match the tag against the whole `core.character` catalog** — a catalog read per file for a post-processing rule; the asset's own characters and the model's `character_names` already cover the realistic cases. Rejected.

## 8. Design decisions

- **LOCKED** 2026-11-04: one exported helper `isPersonName(value: string, ctx: { designerFirstNames: Set<string>; characterTags: Set<string> }): boolean` in `tag-finish.ts`: normalise (`trim`, collapse spaces, lower-case); return `false` if `characterTags.has(value)`; otherwise `true` when `designerFirstNames.has(value)` **or** (the value has two or more words **and** `designerFirstNames.has(firstWord)`). `characterTags` = lower-cased `displayCharacterName` of every selected character + every string in `tagData.character_names` passed through `sheetTagValue` + licensor and property names. Single-word tags equal to a first name are always dropped (unchanged from #712).
- **LOCKED**: the same helper decides the sheet packaging value at `:191`.
- **LOCKED**: `isJunkTag` normalises internally (`tag.trim().replace(/\s+/g, " ").toLowerCase()`) and no longer consults a staff list.
- **LOCKED**: delete `STAFF_FULL_NAMES`. Maintenance path for a new staff member: add their first name to `public.known_designer_first_name` (data row in the shared DB; curated master data starts in `popcre/shared-db`, claim-first). State this in the doc line (Step 5).
- **OPEN** (implementer's judgement, criteria given): whether a two-word tag whose **second** word is a known first name ("mr peter") is a person. Default no; add only if the live proof shows such leaks.

## 9. The plan

Branch `claude/715-person-name-rule` from `origin/main`. Class `code` via `ai-task-gates`.

**Step 1 — the rule.** In `tag-finish.ts`: add `isPersonName` (exported) above `finishTagResult`; inside `finishTagResult` build `characterTags` **before** the model-tag loop (compute `names` as today at `:149`, the model `character_names` list through `sheetTagValue`, and the licensing names used at `:173-176`); replace `isFirstName` (`:145`) and the `:164` condition with `!isPersonName(renamed, ctx)`; replace the `:191` check with `!isPersonName(packaging, ctx)`. Intent: "peter pan" survives when Peter Pan is a selected or model-named character of this file; "luis herrera" never survives; "upc sticker" packaging unaffected. Gate: tests in Step 4 red-then-green; `npm run build --prefix apps/worker` passes.

**Step 2 — normalise `isJunkTag`.** `:100-102`: compute the normalised value first; test the sets and patterns against it. Gate: `isJunkTag("Pantone 186 C")`, `isJunkTag(" Legal  Line ")` true.

**Step 3 — remove the staff list.** Delete `:66-70` and the `STAFF_FULL_NAMES.has(tag)` term at `:101`; move the two staff names out of the junk test list (`:117`) into the person-rule tests, with `designerFirstNames` supplying `albert`, `sarbani` (both are in the DB list). Gate: `grep -n STAFF_FULL_NAMES apps/worker/src` returns nothing.

**Step 4 — tests.** Rewrite `:128-131` so the kept characters are justified by context: `character_names: ["Peter Pan", "Amy Rose"]` (or `characterIds` with names) → `["peter pan","amy rose"]`; the same input **without** that context → `[]` (documents the trade-off). Add the tests in §10. Gate: `npm test --prefix apps/worker` green.

**Step 5 — doc line.** `docs/MODEL_RULES.md` tagging-rules bullet: "A model tag or sheet packaging value that is a designer's first name, or starts with one, is never a tag unless it names one of the file's characters (selected, model-named, or the licensing names). The first-name list is `known_designer_first_name` in the shared DB; new staff are added there, never in code." Gate: `grep -n "known_designer_first_name" docs/MODEL_RULES.md`.

**Step 6 — land.** Commit as the verified identity, push, PR "fix(tagging): people never become tags, characters sharing a first name still do (#680)" with `Closes #715`; `bin/ai-pr-wait <pr>` in the background; merge; confirm the Railway deployment for the merge SHA.

**Step 7 — live proof (class `production`, read path + one tag operation).** Pick one asset whose `pdf_text_samples.extracted_fields` has a `creative_designer` with a two-word name and which has a thumbnail; run the single-asset re-tag from the asset page (the normal UI "Re-tag" action; it is a paid call for one file). Evidence: the saved `asset_tags` for that asset contain no designer name and still contain the characters shown; post the asset id, tag list and deployed SHA on #715 and #680 (signed), tick live proof, close #715. If the re-tag action is unavailable, the proof is the next nightly/explicit run's first tagged asset meeting the same condition.

### Adversarial cases (trust boundary: model output and OCR'd sheet text)

| Input | Hostile case | Test |
|---|---|---|
| model tag "Luis Herrera" (first name known) | becomes a search tag | `a designer's full name never becomes a tag` |
| model tag "peter pan", Peter Pan selected character | wrongly dropped | `a character sharing a designer's first name keeps its tag when the file names that character` |
| model tag "peter pan", no character context | kept (leak) vs dropped | `a first-name match with no character context is dropped` |
| model tag "amy" alone | single first name | existing `known designers only` / new `a bare first name is never a tag` |
| sheet packaging "Peter Pan Box" | inconsistent with model rule | `packaging and model tags obey the same person rule` |
| `isJunkTag("Pantone 186 C")`, `"  Legal   Line "` | mixed case / spacing bypass | `the junk rule ignores case and spacing` |
| model `character_names` contains "Luis Herrera" | leak by the character route | not blocked by design — documented in §13, no test |
| licensor name equals a first name ("Peter")? | licensing names are always tags (`:173-176`) and are in the exception set | `licensing names are never treated as people` |
| Cyrillic / 41+ char value | still junk after normalisation | existing `scan debris and form text never become tags` |

## 10. Tests required

`apps/worker/src/handlers/tag-finish.test.ts` (node:test): `a designer's full name never becomes a tag`; `a character sharing a designer's first name keeps its tag when the file names that character`; `a first-name match with no character context is dropped`; `a bare first name is never a tag`; `packaging and model tags obey the same person rule`; `the junk rule ignores case and spacing`; `licensing names are never treated as people`; `staff names are dropped through the first-name list, not a code list` (uses `albert hazan` with `designerFirstNames {albert}`).
Must stay green: `npm test --prefix apps/worker`, `npm run build --prefix apps/worker`, root `npm run lint && npm run typecheck && npm run test`.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`; the AI merges; reviews are advice only.
- No DB change in this repo; a staff/people table or a distinct-designers RPC would be `popcre/shared-db` work (claim-first, `shared-db-change` skill) — not needed here.
- `knownDesignerFirstNames` returns the previous or an empty set on a read error (`ai-tagging.ts:261`): with an empty set the person rule is inert, never throwing — keep it that way (a paid result must never be lost to a lookup failure).
- `displayCharacterName` strips "(…)" and "aka …" — use it for the exception set so "Spider-Man (Spidey…)" matches the model's "spider-man".
- Do not touch `isKnownDesigner` (sheet designer gate) — same first-name list, different purpose.
- Sign posts with `$AI_GH_SIGNATURE`; EST times; wait on CI with `bin/ai-pr-wait`; no sleep loops.
- Open PR #724 and plan `issue-722` touch `ai-tagging.ts` elsewhere; rebase if they merge first (no overlap with `loadFinishContext`).

## 12. Access and environment

- hetz; `gh` as `u2giants`; Supabase MCP project `qsllyeztdwjgirsysgai` (verify the ref first); Railway identifiers `docs/INFRASTRUCTURE.md:58` (Railway MCP failed to connect in the planning session).
- UI https://dam.designflow.app; admin tester login by 1Password title in `docs/1password.md` (vault `vibe_coding`).
- Local: `npm ci --prefix apps/worker && npm test --prefix apps/worker`.

## 13. Definition of done, risks, open questions

Done when: rule, normalisation and list removal merged with the eight tests; CI green; Railway deployment live for the merge SHA; one production asset re-tagged shows no person name and keeps its characters; `MODEL_RULES.md` updated; #715 closed with evidence; live-proof item ticked on #680; HANDOFF.d updated.

Risks: a two-word product tag that starts with a known first name and is not a character ("amy's kitchen set"? — "amy's" ≠ "amy", so safe; "peter rabbit" **is** a character but only kept if the file names it) is dropped — acceptable per §1. Rollback: revert the PR. Residual: the `character_names` route can carry a person (§6); if the live proof shows it, open the follow-up on #680, not a new issue for the gap.

Open: the second-word rule (§8 OPEN); whether leaked names already saved since 4:15 PM EST Nov 4 need cleanup (count them in the live-proof query and report on #680).

## Self-audit

1. **No questions for a fresh session?** Yes — §5 pins lines on `main` 4409e2d3 for every edit, §8 fixes the rule precisely (normalisation, exception set, two-word condition), §9 names the test to rewrite and the proof recipe.
2. **All background and rejections?** Yes — §3 carries the four findings, §6 explains why the #712 test misled and which routes already carry characters, §7 lists five rejected designs including the DB full-name set and why it is not possible without shared-db work.
3. **Goal clear enough to steer?** Yes — §1 states the owner rule (people never tags) and the tie-breaker (a dropped redundant character beats a leaked name), which §13 applies to the one known trade-off.

Self-audit passed.
