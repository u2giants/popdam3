# Plan: Review finding: u2giants/popdam3#697 Tagging: keep scanned junk and people out of tags (#680) (u2giants/popdam3#698)
Issue: https://github.com/u2giants/popdam3/issues/698
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 0 | Finding 1 (worker test suite broke on `client.schema`) | ✅ landed before this plan | `origin/main` `apps/worker/src/handlers/ai-tagging.ts:270-279` wraps the read in try/catch; owner comment on #698 (Nov 4) confirms "Fixed: test break" |
| 1 | Re-measure retailer miss rate against live data (read-only) | ⬜ open | Owner comment: up to 2,980 of 5,880 sheet retailer values miss |
| 2 | Finding 2: log the customer-read failure, keep last-known names | ⬜ open | no `logger.warn` in `customerNames()` |
| 3 | Finding 3: match sheet retailers against `display_name`, `name` and `core.customer_alias` | ⬜ open | `tag-finish.ts:132-134` matches `name` prefix only |
| 4 | Finding 4: pin the `NOT_A_CHARACTER` catalog filter with a test | ⬜ open | no test mentions "likeness" |
| 5 | PR to `main`, CI green, merge | ⬜ open | |
| 6 | Live proof: tag one real sheet-backed asset, show the customer tag | ⬜ open | `- [ ] live proof` on #698 |

Where a fresh session starts: Step 1. Verified 2026-11-04 against `origin/main` = `4409e2d3`. This worktree's branch is behind `origin/main` (predates #717/#721); branch from a fresh `origin/main`.

---

## 1. The ultimate goal

When a design file has a licensing or costing sheet that names the retailer ("Ross", "Burlington SS26", "ROSS STORES INC SUPPLIERS"), the AI-tagged file must carry a searchable **customer tag** so the team can find "everything we did for Ross". Today roughly half of real sheet retailer values never become a tag because the matcher only knows the ERP's legal-style customer names, and if the customer list cannot be read at all the tags vanish with no trace in the logs. Also, the character catalog filter that keeps placeholder rows such as "No Character Likeness" out of the model prompt has no test pinning it, so a future edit could silently reintroduce them.

Done means: a sheet retailer that matches any known spelling of a customer (legal name, display name, or alias) becomes one clean tag; a failed customer read is visible in the worker log and never silently empties tags; and the catalog filter is covered by a test.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product artwork. Repo `u2giants/popdam3`, branch `main`. The code here is the **Railway worker** (`apps/worker/`, Node + TypeScript, auto-deploys on push to `main`; see `AGENTS.md` → Deployment). Post-model tagging rules live in `apps/worker/src/handlers/tag-finish.ts` (issue #680 owner rules, summarized in `docs/MODEL_RULES.md:36`). Customer master data lives in the shared Supabase database, schema `core` (`core.customer`, `core.customer_alias`), owned by `popcre/shared-db` (synced copy under `shared-db/` in this repo). Sheet facts (retailer, packaging) come from `pdf_text_samples.extracted_fields` written by the Indra PDF rescan (`supabase/functions/_shared/pdf-sheet-fields.ts:17,43`).

## 3. What triggered this work

PR #697 (merged `4f43af49`, 2026-11-04) added customer-gated retailer tags and a prompt-catalog filter. The advisory review (GLM, run 41761265435) filed #698 with four findings against head `6f3001ab`:

1. `customerNames()` called `client.schema("core")` on doubles that lack `.schema` → six worker tests would reject. **Already fixed** (§5).
2. A `core.customer` read failure returns `[]` silently; combined with the gate, every "sheet original customer" tag disappears invisibly.
3. Matching only against `core.customer.name` drops legitimate retailer tags when names are legal-style.
4. No test for the new `no character likeness` catalog filter (and it was unanchored).
5. Minor heuristic notes — **truncated in the issue body**; unrecoverable, treat as none.

The review-fixer deferred (label `fixer-deferred`, "source PR is closed"). Owner-side comments on #698 (Nov 4, checked against `522e5722` and live data): "Fixed: test break. Still open: silent failure with no log, name-only customer matching, no test for the no-character-likeness filter." and "Impact measured Nov 4: up to 2,980 of 5,880 retailer values miss, because customer names are legal-style (ROSS STORES INC SUPPLIERS)."

Business driver: the ~110,500-file tagging run on #680 is about to use these rules; a 50% customer-tag miss rate ships into every tagged file.

## 4. Scope

**In:**
- Logging + last-known-value behavior for the customer read.
- Matching sheet retailers against `core.customer.name`, `core.customer.display_name`, and `core.customer_alias.alias`, choosing one clean tag per match.
- Tests for the above and for `NOT_A_CHARACTER`.
- Read-only measurement before and after (same query, numbers on #698).

**NOT in this plan:**
- Any schema change (no new columns, views, or RPCs). If a view would make this cleaner, it goes to `popcre/shared-db` claim-first — not here.
- Changing how the Indra rescan extracts `retailer` (`pdf-sheet-fields.ts`).
- Fuzzy/AI customer matching (OpenRouter calls for name resolution).
- The model-tag "season customer" rewrite path (`tag-finish.ts:160`) beyond reusing the improved matcher.
- Re-tagging already-tagged assets (backfill); the full run on #680 covers that.
- #711 (outage fail-over) and #719 (audit backlog PR) — separate plans.

## 5. Current state of the code (all `origin/main` `4409e2d3`)

- `apps/worker/src/handlers/ai-tagging.ts:267-279` — `customerNames(client)`: 10-minute cache; `client.schema("core").from("customer").select("name")`; on `error || !data` returns `customerCache?.names ?? []`; **try/catch** returns the same on throw. No log line on either path. Names are lower-cased, trimmed, `length >= 3`.
- `apps/worker/src/handlers/ai-tagging.ts:295` — `loadFinishContext` runs `customerNames(client)` in `Promise.all` with `loadSheetFacts` and `knownDesignerFirstNames`; result passed as `customerNames` at `:303`.
- `apps/worker/src/handlers/ai-tagging.ts:113-116` — `getVisionModels` is the reference pattern: `logger.warn("ai-tag: model config unavailable; using the last known/default model", { error })`.
- `apps/worker/src/handlers/tag-finish.ts:119-120` — `FinishTagInput.customerNames?: string[]` ("a sheet retailer becomes a tag only when it starts with one").
- `apps/worker/src/handlers/tag-finish.ts:132-134` — `matchingCustomer(retailer, customerNames)`: `retailer === name || retailer.startsWith(name + " ")`, longest wins.
- `apps/worker/src/handlers/tag-finish.ts:160-161` — model tags that look like "burlington ss26" are rewritten to the matched customer.
- `apps/worker/src/handlers/tag-finish.ts:192-194` — sheet retailer → `sheetTagValue` (3–40 chars, letters/digits/`&'./-`) → `matchingCustomer` → `add(customer, "other", "sheet original customer")`. **The tag written is the matched customer string, not the raw sheet value.** With legal names that means a tag like "ross stores inc suppliers" if it ever matched.
- `apps/worker/src/handlers/tag-finish.test.ts:59-66,100` — tests use `customerNames: ["ross"]`/`["burlington"]` (short-name happy path only).
- `apps/worker/src/handlers/ai-tagging-shared.ts:252` — `NOT_A_CHARACTER = /do not use|\blogo\b|no character likeness|no reportable elements|\(general\)|\bno likeness\b|\bwith likeness\b|general \(no name|film elements/i`; used at `:289` (exact-name linking from #721) and `:431` (prompt catalog). Still unanchored for `no character likeness` (fine for placeholders; the test will pin the behavior).
- `apps/worker/src/handlers/character-reference-validation.test.ts:40-52` — `promptClient()` double: returns `[{character:{id,name:"Fixture character"}}]` for table `property_character_associations`, and `buildImageTaggingPrompt(asset, {client, requireCharacterReadSuccess:true, onCharacterCatalog})` captures the ids offered. This is the harness to reuse for Step 4.
- Shared-db (read-only reference, `shared-db/supabase/migrations/`):
  - `20260717122317_core_customer_display_name_drop_legal_name.sql:19,25` — `core.customer.display_name text`, `normalized_name text` (generated).
  - `20260716143231_core_customer_alias.sql:15-28` — `core.customer_alias(customer_id, alias, normalized_alias generated lower(regexp_replace(alias,'\s+',' ','g')), alias_type in ('legacy_name','banner','dba','erp_name','abbreviation','other'))`.
  - `20260721143000_dam_master_data_customer_id.sql:56` — DAM picker view uses `coalesce(display_name, name)` as the shared identity.
- The worker already reads `core.customer` and `core.character` through PostgREST with the service role, so `core` is exposed; `core.customer_alias` is in the same schema and readable the same way (verify in Step 1 with a one-row select).

Nothing for findings 2–4 is committed anywhere. Nothing deployed.

## 6. Key findings and root cause

- **Finding 2:** both failure exits of `customerNames()` are silent (`ai-tagging.ts:273,278`). Because the gate at `tag-finish.ts:193` requires a match, an unreadable customer list means zero customer tags for every asset in the 10-minute window, with no log to explain it. The fail-open-to-last-known-values behavior is right; the missing piece is one `logger.warn` per failure (not per asset — the cache makes that naturally once per 10 min).
- **Finding 3 root cause:** ERP customer `name` is legal-style ("ROSS STORES INC SUPPLIERS"), sheets say the banner ("Ross", "Ross FW26"). `matchingCustomer` only accepts *retailer starts with customer name*. The reverse (customer name starts with the sheet word) and the DAM identity (`display_name`) and `customer_alias` (which has exactly the `banner`/`dba`/`abbreviation` types for this) are never consulted. Owner measurement: ≈2,980 of 5,880 sheet values miss.
- **Which string becomes the tag matters:** `tag-finish.ts:194` tags the matched customer string. Matching against a legal name must not produce legal-name tags; the tag should be the customer's display identity.
- **Finding 4:** `NOT_A_CHARACTER` has two call sites (`:289`, `:431`); neither has a test. The `character-reference-validation.test.ts` harness can drive `:431` directly with a two-row catalog.
- **Finding 1 is fixed** by the try/catch; the scope-test doubles still lack `.schema` (grep finds none in `ai-tagging-scope.test.ts`), so the catch is what keeps that suite green. Leave it; Step 2 adds a log inside the catch only.

## 7. Approaches considered and rejected

- **Match the raw sheet value as the tag ("ross fw26").** Rejected by #697/#712 direction and `tag-finish.ts:194`: the tag is the customer, season noise is stripped (see the `seasonCustomer` rewrite at `:160`).
- **Tag the legal `name` when it matches.** Rejected: produces "ross stores inc suppliers" tags nobody searches; use `display_name` (the DAM identity per `dam_master_data_customer_id.sql:56`).
- **Fuzzy similarity (Levenshtein / token overlap).** Rejected: unbounded false positives on short words ("Target", "Five Below" vs "below"); aliases are the curated, owner-controlled mechanism and already exist.
- **Add a shared-db view `core.customer_match_names`.** Rejected for this issue: three table reads from the worker are enough; a view would require a shared-db claim and promotion cycle and block the #680 run. Revisit only if the match set needs to be reused by edge functions.
- **Prefix-match customer legal name on the sheet word ("ross" ⊂ "ross stores…").** Considered and **kept as a bounded fallback** (Step 3, rule c) with a minimum length and a word-boundary, because the owner measurement shows it is the dominant miss shape and aliases do not yet exist for every customer.
- **Throw on customer-read failure (fail-closed).** Rejected: a paid model result must never be lost over an optional tag (`ai-tagging.ts:270` comment).

## 8. Design decisions

- **LOCKED (owner rule #680, MODEL_RULES.md:36):** clean sheet customer values become tags; junk never does. Gate remains "must match a known customer".
- **LOCKED:** no schema change in this repo; worker reads `core.customer(name, display_name)` and `core.customer_alias(customer_id, alias, alias_type)` as they exist.
- **LOCKED:** the written tag is the customer's **display identity** = `display_name` if non-empty, else `name`; lower-cased, whitespace-collapsed (same normalization as `sheetTagValue`).
- **LOCKED:** read failures log once (`logger.warn`) and keep last-known names.
- **LOCKED:** test names in §10; `.test.ts` under `apps/worker/src/handlers/` only.
- **OPEN (implementer):** minimum length for the reverse-prefix fallback (rule c). Default 4 characters and require the sheet value to be a whole leading word of the customer name (`name === v || name.startsWith(v + " ")`). If the Step 1 measurement shows false positives above ~2% of matches, raise to 5 or drop rule c and rely on aliases.
- **OPEN (implementer):** whether `alias_type = 'legacy_name'` should be excluded from matching. Default: include all types; legacy names on old sheets are exactly the case.

## 9. The plan

Prerequisite: fresh worktree, `git switch -c fix/698-customer-tag-matching origin/main`.

### Step 1 — Measure (read-only, no dependencies)
- Using the Supabase MCP (`execute_sql`, project `qsllyeztdwjgirsysgai`) or `psql` through `op_run` with the vault item for the live DB (vault `vibe_coding`; see `docs/1password.md`), run read-only:
  - distinct sheet retailers: `select lower(regexp_replace(trim(extracted_fields->>'retailer'),'\s+',' ','g')) v, count(*) from pdf_text_samples where extracted_fields->>'retailer' is not null group by 1 order by 2 desc`;
  - customer spellings: `select lower(name), lower(display_name) from core.customer`; `select lower(alias), alias_type from core.customer_alias`;
  - count how many sheet values match under (a) current rule, (b) plus display_name, (c) plus aliases, (d) plus reverse-prefix. Keep the SQL in `$TMPDIR` and post only the four counts on #698.
- Also confirm `select count(*) from core.customer_alias` is readable with the worker's role (the worker uses the service role; the MCP does too).
- **Gate:** a signed comment on #698 with the four counts; the (b)+(c)+(d) count should recover most of the 2,980.

### Step 2 — Finding 2: log and keep last-known (no dependencies)
- `apps/worker/src/handlers/ai-tagging.ts:267-279`: in both failure exits add `logger.warn("ai-tag: customer list unavailable; using last known customers", { error: error?.message ?? String(e), cached: customerCache?.names.length ?? 0 })`. Keep the return values exactly as they are.
- Add a short negative cache (e.g. `expires: Date.now() + 60_000` on the existing `customerCache` when it exists) so a persistent failure logs once a minute, not once per asset. If there is no cache yet, do not create an empty one (so the next asset retries).
- **Gate:** test `a failed customer read is logged once and keeps the last known names` (stub `client.schema` to return `{error:{message:"boom"}}` after a successful first call; assert `logger.warn` called once and names unchanged). Use the existing logger stub pattern in `ai-tag-parallel.test.ts` if one exists; otherwise spy on `logger.warn` via module import.

### Step 3 — Finding 3: broader matching, display-identity tag (depends on Step 1 numbers)
- `apps/worker/src/handlers/ai-tagging.ts`: change `customerNames()` to return `CustomerMatch[]` = `{ tag: string; keys: string[] }` where `tag` = display identity (LOCKED above) and `keys` = all lower-cased, whitespace-collapsed spellings with `length >= 3`: `name`, `display_name`, every alias for that `customer_id`. Reads:
  - `client.schema("core").from("customer").select("id, name, display_name")`
  - `client.schema("core").from("customer_alias").select("customer_id, alias")`
  - Alias read failure degrades to names only (log at warn, same style as Step 2).
- `apps/worker/src/handlers/tag-finish.ts:119-120`: change the input to `customers?: CustomerMatch[]` (keep `customerNames?: string[]` accepted for one release by mapping `{tag:n, keys:[n]}` — or update both call sites and the tests; implementer's choice, but no silent behavior change for existing tests).
- `tag-finish.ts:132-134` → `matchingCustomer(value, customers)` returns the `tag` of the best match using, in order:
  a. exact: `value === key`;
  b. value starts with key as a whole word: `value.startsWith(key + " ")` (today's rule; keeps "ross fw26" → ross);
  c. **reverse prefix (OPEN threshold):** `key.startsWith(value + " ")` with `value.length >= 4` — "ross" → "ross stores inc suppliers" → tag `display_name`.
  Longest key wins among (a)/(b); among (c) prefer the customer with a `display_name`.
- `tag-finish.ts:160-161` and `:192-194` keep calling the same function; no other logic change.
- `docs/MODEL_RULES.md:36`: replace "clean sheet packaging and customer values become tags" with "clean sheet packaging values become tags; a sheet retailer becomes the matching customer's display name when it matches the customer's name, display name or alias".
- **Gate:** tests in §10 pass; re-run the Step 1 count (d) with the implemented rules via a tiny script in `$TMPDIR` that imports `matchingCustomer` and the live spellings — the recovered count on #698 must be within a few percent of the SQL estimate.

### Step 4 — Finding 4: pin `NOT_A_CHARACTER` (no dependencies)
- New test in `apps/worker/src/handlers/character-reference-validation.test.ts`: `placeholder catalog rows are never offered as characters` — build a `promptClient` variant whose catalog returns three rows: `{id:A,name:"Fixture character"}`, `{id:B,name:"No Character Likeness"}`, `{id:C,name:"Marvel Logo"}`; call `buildImageTaggingPrompt(asset,{client, requireCharacterReadSuccess:true, onCharacterCatalog})`; assert captured ids `=== [A]` and the prompt text does not contain "Likeness" or "Logo".
- Second test `exact-name linking skips placeholder rows` for `:289` — drive the #721 name-linking helper (find it via `grep -n NOT_A_CHARACTER ai-tagging-shared.ts` → the function around `:280-295`) with a model name "No Character Likeness" and assert no link.
- Optionally export `NOT_A_CHARACTER` for a direct table test; not required.
- **Gate:** both tests fail if `no character likeness` is removed from the regex (prove once locally, restore).

### Step 5 — PR, CI, merge (depends on 2–4)
- Commit as Albert's verified identity, stage only these files. Title `fix(tagging): match sheet retailers to customer display names and aliases; log customer-read failures (#698)`.
- `gh pr create --base main`, body `Closes #698`, signed with `$AI_GH_SIGNATURE`; `bin/ai-pr-wait <pr>` in background; merge on green (reviews advisory).
- **Gate:** merged SHA on `origin/main`; Railway deployment for it observed (read-only).

### Step 6 — Live proof (depends on 5)
- Pick one asset whose sheet retailer is a known miss from Step 1 (e.g. a "Ross" sheet) and that is in the #680 run scope; after the worker deploys, let the run (or the explicit-file `ai-tag-parallel` operation already configured by the #680 owner) tag it. Do **not** change production settings yourself; if no run is active, coordinate on #680 with a signed comment naming the asset id.
- Read-only check: `select tag, evidence from asset_tags where asset_id = '<id>'` shows the customer display tag with evidence `sheet original customer`.
- **Gate:** screenshot or SQL row on #698; tick `- [x] live proof`. If not possible this session, leave `- [ ] live proof (asset <id>)` on #698 — never a new issue.

## 10. Tests required

New (`apps/worker/src/handlers/tag-finish.test.ts` unless noted):
- `a sheet retailer that starts a legal customer name becomes the display-name tag` ("Ross" / `{tag:"ross", keys:["ross stores inc suppliers","ross"]}` → `ross`).
- `a sheet retailer matching a customer alias becomes the display-name tag` ("Rooms To Go Kids" alias → "rooms to go").
- `season wording after the customer still maps to the customer` ("Burlington SS26" → "burlington") — existing behavior kept.
- `short or junk retailers never match` ("All Aboard For Sale", "©© 4 @#", "ros") → no tag.
- `a customer without display name is tagged by its name` .
- `a failed customer read is logged once and keeps the last known names` (`ai-tagging-scope.test.ts` or a new `customer-names.test.ts`).
- `alias read failure degrades to names only` .
- `placeholder catalog rows are never offered as characters` (`character-reference-validation.test.ts`).
- `exact-name linking skips placeholder rows` (same file).

Existing that must stay green: `npm test --prefix apps/worker` (incl. `tag-finish.test.ts:59-66,100`, `ai-tagging-scope.test.ts`, `character-reference-validation.test.ts`), root `npm run lint && npm run typecheck && npm run test`, `npm run build`.

### Adversarial cases (external inputs: OCR'd sheet text; ERP customer rows; alias rows)

| Input | Hostile case | Test |
|---|---|---|
| Sheet `retailer` | OCR junk / symbols / 1–2 letters | `short or junk retailers never match` |
| Sheet `retailer` | generic word that prefixes a customer ("the", "five") | `short or junk retailers never match` (length ≥ 4 + whole-word) |
| Sheet `retailer` | > 40 chars (sheetTagValue cap) | existing `only clean sheet values become tags` |
| `core.customer.name` | null / empty / whitespace | `a customer without display name is tagged by its name` (null display) + filter `length >= 3` |
| `core.customer_alias.alias` | duplicate alias across two customers | `a sheet retailer matching a customer alias…` (assert deterministic: longest key, then display-name holder) |
| `core` read | PostgREST error / throw | `a failed customer read is logged once…`, `alias read failure degrades…` |
| Character catalog `name` | "No Character Likeness", "… Logo", "(General)" | `placeholder catalog rows are never offered as characters` |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push `main`; AI merges after required checks; reviews advisory only.
- **No DB schema change in this repo.** Reads of `core.*` are allowed from the app; structure changes go to `popcre/shared-db` claim-first with the `shared-db-change` skill. Production DB is read-only for you: measurement queries only.
- Commit as Albert's verified identity; stage only your hunks (shared checkout).
- `bin/ai-pr-wait` in background; no sleep loops. Sign GitHub posts with `$AI_GH_SIGNATURE`.
- **Gotcha:** `apps/worker` tests are `tsx --test src/**/*.test.ts`; vitest `.vitest.ts` and `.mjs` are not run there.
- **Gotcha:** `ai-tagging-scope.test.ts` doubles have no `.schema`; `customerNames` relies on the try/catch to stay green there. Don't move the `core` reads outside the try.
- **Gotcha:** the 10-minute `customerCache` is module-level; tests that change customer data must reset it (export a `resetCustomerCacheForTests()` or construct the match list via a parameter).
- **Gotcha:** `tag-finish.ts:160` rewrites *model* tags like "burlington ss26" through the same matcher; after Step 3 that path gains alias/reverse-prefix matching too — intended, but keep its `/\d|\b(ss|fw|…)\b/` guard so plain model words are not rewritten.
- **Gotcha:** this worktree is behind `origin/main` (#717/#721 moved `tag-finish.ts`); line numbers above are from `origin/main`.
- Times for humans in EST.

## 12. Access and environment

- Machine hetz; `gh` authenticated as `u2giants`. Supabase MCP available (live project `qsllyeztdwjgirsysgai`, Virginia; memory note warns the default MCP may point at the old Ohio project — check `get_project_url` first). Railway MCP not connected this session.
- Secrets: 1Password `vibe_coding` (DB/service-role items per `docs/1password.md`); never print values.
- Run locally: `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm test --prefix apps/worker`.
- No UI in this plan; live proof is a DB row or the asset's tag chips at dam.designflow.app (admin login item in `docs/1password.md`).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Step 1 counts posted on #698 (before) and re-posted after Step 3.
- [ ] Nine tests in §10 green in CI; run id on #698.
- [ ] Merged SHA on `main`; Railway deployment observed.
- [ ] `docs/MODEL_RULES.md:36` wording updated.
- [ ] Live proof row/screenshot on #698 or `- [ ] live proof (asset <id>)` left on #698.
- [ ] This plan's STATUS and the handoff STATUS updated.

Risks: reverse-prefix rule may over-match generic first words → mitigated by length ≥ 4, whole-word, and the Step 1/Step 3 measurement; rollback is a single revert, and already-written tags are replaced on the next tagging pass (AI-owned tag replacement, `MODEL_RULES.md:38`).

Open questions (not blocking): whether Albert wants legal-name customers given `display_name`/aliases in the ERP data instead — that is a business-data question for shared-db/CRM, not this fix; note it on #698 if Step 1 shows many customers with no `display_name`.

## Self-audit

1. **Executable without questions?** Yes — §5 gives every file:line on `origin/main` and the shared-db column facts; §9 gives SQL shapes, matching rules in order, tag choice, test harness to copy (`character-reference-validation.test.ts:40-52`), PR and proof steps.
2. **All background and rejected paths?** Yes — §3 carries the owner's measurement and which findings remain, §6 the root causes, §7 five rejected approaches with reasons, §8 locked vs open with defaults and thresholds.
3. **Goal clear for judgment calls?** Yes — §1 states the business outcome ("find everything we did for Ross", no silent loss) and the goal-wins rule; the OPEN threshold in §8 names the criterion (false positives ≤ ~2%).
