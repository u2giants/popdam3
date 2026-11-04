# Plan: Review finding: u2giants/popdam3#651 fix(worker): never offer licensor-retired character labels (u2giants/popdam3#652)
Issue: https://github.com/u2giants/popdam3/issues/652
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1. Widen the retired-label filter to the canonical markers (`DNU`, `Do Not Use`, `Discontinued`) and share the rule in one helper | ⬜ open | — |
| 2. Worker tests: retired labels are offered neither in the prompt nor in the schema binding | ⬜ open | — |
| 3. `docs/idiosyncrasies.md` entry + `AGENTS.md` index line | ⬜ open | — |
| 4. PR, CI, merge; Railway worker auto-deploy verified | ⬜ open | — |
| 5. Live proof (one tagging run on a Marvel/DC asset shows no retired label) and close #652 | ⬜ open | — |

**Where a fresh session starts:** Step 1.

---

## 1. The ultimate goal

When the AI tags artwork with characters, it must only ever pick from the licensor's current, usable character list. Labels the licensor has retired — rows named like "Venom - DO NOT USE", "DNU - Disney Lorcana", "(DNU) Batman Forever Logo", "Cars - Planes (Discontinued Do Not Use)" — must never be shown to the model or accepted from it, because a tag like that on an asset would tell the team the art uses a character the licensor says may not be used. Today the spelled-out phrase is blocked but the licensors' `DNU` abbreviation (19 live rows) is not.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`) manages licensed consumer-product artwork. The Railway cloud worker (`apps/worker/`, Node/TypeScript, auto-deploys on every push to `main`) runs AI image tagging. `apps/worker/src/handlers/ai-tagging-shared.ts` → `buildImageTaggingPrompt` assembles, per asset, the list of characters the model may choose from (scoped to the asset's property/licensor from the shared database tables `core.property_character_associations`, `core.property_character_source_edge`, `core.character`), binds their ids into the structured-output schema (`onCharacterCatalog`), and prints their names in the prompt. Character master data comes from licensor style-guide scrapes loaded through `popcre/shared-db` (e.g. `shared-db/supabase/migrations/20261030153101_curated_licensor_scrape_characters.sql`); the canonical name classifier lives in shared-db's `tools/resolve-character-identity.mjs`.

## 3. What triggered this work

Advisory review (StepFun) of merged PR #651 (`190db3a2`, one-line regex filter) raised on #652:

1. **No test** covers the new filter (`character-scope.test.ts`, `character-reference-validation.test.ts` untouched). Still true on `main` — no test mentions "Do Not Use"/"DNU"/"logo" (grep of both files, 2026-11-04).
2. **Regex misses the canonical `DNU` marker.** shared-db's resolver treats `[['dnu','start'], ['do not use','start']]` as `DO_NOT_USE_LABEL` (`shared-db/tools/resolve-character-identity.mjs:129`, `classifyNonCharacterLabel` `:140`). Still true: the current worker filter is `/do not use|\blogo\b|no character likeness/i` (`apps/worker/src/handlers/ai-tagging-shared.ts:371`). Live production counts (read-only, 2026-11-04): **79** `core.character` names contain "do not use", **19** carry a `DNU` token (e.g. "DNU - Disney Lorcana", "DNU - 1602 Spider-Man ( Marvel Games ) - DNU", "(DNU) Batman Forever (1995)  Logo", "DNU Ben Mears as portrayed by Lewis Pullman"), **1** says "Discontinued" (also contains "Do Not Use"), and only **1** row is non-`active` — so the `status` filter added later does not catch retirement; the name is the only signal.
3. **Non-blocking:** no `docs/idiosyncrasies.md` entry records the rule.

Fixer bot deferred (source PR closed).

## 4. Scope — in and out

In: widen the name filter to the canonical markers; express it once as an exported helper so tests can target it; two worker tests; the idiosyncrasies entry; deploy and one live tagging proof.

**NOT in this plan:**
- A DB-level retirement flag on `core.character` (e.g. `status='retired'`, a `retired_at` column or scrape-time classification). That is shared-db territory (claim-first in `popcre/shared-db`) and a bigger change; record it in section 13 as the long-term direction, do not start it here.
- Changing what happens to existing `asset_characters` links that point at retired rows (re-tag already replaces machine links, `apps/worker/src/handlers/ai-tagging.ts:264-275`).
- The `logo` / `no character likeness` parts of the same regex (kept as-is; they were added by later PRs #691/#696/#697 and have their own rules).
- Any prompt-wording change beyond the catalog contents.

## 5. Current state of the code (main `01fcfc34`)

- `apps/worker/src/handlers/ai-tagging-shared.ts`
  - Property links `:343-352`, co-occurrence edges `:354-364` (`select("character:character_id(id, name, status)")`), licensor fallback `:365-368` (`select("id, name, status")`, `LICENSOR_CHARACTER_LIST_LIMIT`).
  - **`:370-371`**: the filter — comment "Licensor-retired labels ("Venom - Do Not Use") and logos must never be offered as characters." then `characters = [...new Map(characters.filter(c => !["archived","deleted"].includes(c.status ?? "") && !/do not use|\blogo\b|no character likeness/i.test(c.name)).map(c => [c.id, c])).values()].sort(...)`.
  - Binding `:373-377` (`normalizeCharacterIds` → `onCharacterCatalog(ids)`), prompt context `:378+`. Filter runs before both consumers (good; reviewer confirmed no divergence window).
- History on this file: `190db3a2` (#651 regex), `e89e3769` (#653 edges), `8b25bef8`/`338850e0`/`4f43af49` (#680 owner rules, status filter, scan junk).
- Tests (`node --test` via `npm test --prefix apps/worker`, `apps/worker/package.json:9`):
  - `apps/worker/src/handlers/character-scope.test.ts`: `catalogClient(links, licensorChars, edges)` fake `:48-67`, `promptAsset` `:69-72`, `offered()` `:74-78` returns the bound ids; cases `:82-99` ("a property's linked licensor characters are offered", "an unlinked property falls back…", "…too large…", "co-occurrence edges are offered…").
  - `apps/worker/src/handlers/character-reference-validation.test.ts`: `:30` captures the catalog binding; `:82` "a file with no licensing context is offered no characters"; has a `promptClient` that lets a test read the prompt text.
- `docs/idiosyncrasies.md`: no entry (format at `:1-12`: Looks like / Actually / Why / Do not change because; index line goes in `AGENTS.md` → Intentional quirks).
- shared-db canonical classifier: `shared-db/tools/resolve-character-identity.mjs:122-146` — markers apply at a **segment start** (segments split on ` - `, parentheses etc.; see `segmentCarriesPhrase` above `:120`), with tests `shared-db/tools/resolve-character-identity.test.mjs` (asserts `'DNU-Old Art'`, `'Skyward Falls - DNU Old Art'` are `DO_NOT_USE_LABEL`).

## 6. Key findings and root cause

- The worker's filter is a name heuristic because the database carries no retirement flag: `core.character.status` is `app.entity_status` (`shared-db/supabase/migrations/20260829004145_separate_property_and_character.sql:37`) and 100% of the DNU/Do-Not-Use rows are `active`. Until shared-db classifies retirement at load time, the name is the only signal, so the worker must mirror the canonical name rule.
- The canonical rule is "marker at the start of a segment" — e.g. `DNU - X`, `(DNU) X`, `X - DNU`, `DNU X` all match, but a character whose real name merely contains the letters (none exist today; "dnu" is not a substring of any current non-retired name — verified by the same query) should not. A plain `\bdnu\b` word-boundary match is equivalent for every live row and simpler; the segment rule is stricter against future names like "Dnu-something" which are vanishingly unlikely. Either passes; LOCKED choice below.
- The reviewer's suggested regex `/^(?:.*\b)?(?:do not use|dnu)\b/i` is effectively `\b(do not use|dnu)\b` — fine.
- "Discontinued" appears once and that row also says "Do Not Use"; include it anyway (it is what licensors write for retired lines).
- The worker cannot import `shared-db/tools/resolve-character-identity.mjs` directly: that file lives in the vendored mirror which is synced, not a package, and the worker is compiled with `tsc` (`apps/worker/package.json:8`) without that path in its include. Copying the marker list into one small exported helper in the worker, with a comment pointing at the canonical source, is the honest minimum.

## 7. Approaches considered and REJECTED

- **Fix only by widening the inline regex.** Works, but leaves the rule untestable in isolation and buried in a 200-char line; a later edit (as happened in #696/#697 which appended more alternatives) can silently break it. Rejected in favour of an exported helper plus the same inline call.
- **Import the shared-db resolver.** Rejected: not a package, vendored mirror is read-only and may lag; the worker build would have to reach outside `apps/worker`. Revisit if shared-db ever publishes the resolver as an npm workspace.
- **Filter by `status` only.** Rejected: all retired rows are `active` (section 3).
- **Shared-db schema flag now.** Rejected for this issue (scope); the right long-term fix — note in section 13 and on the issue when closing.
- **Strip the retired rows from `core.character` data.** Rejected: licensor master data is loaded from curated scrapes (owner ruling: licensing/property ownership comes from scrapes, never hand-edited); the rows are legitimate records of what the licensor retired.

## 8. Design decisions (2026-11-04)

- **LOCKED:** Add `export const RETIRED_CHARACTER_LABEL = /\b(?:dnu|do not use|discontinued)\b/i;` and `export function isRetiredCharacterLabel(name: string | null | undefined): boolean` in `ai-tagging-shared.ts` (next to `LICENSOR_CHARACTER_LIST_LIMIT`), with a comment: "Mirrors `DO_NOT_USE_MARKERS` in popcre/shared-db `tools/resolve-character-identity.mjs`; keep in sync." The inline filter at `:371` calls `isRetiredCharacterLabel(c.name)` and keeps the existing `\blogo\b|no character likeness` and status clauses unchanged.
- **LOCKED:** Null/undefined name → `false` (never throws; today `RegExp.test(null)` coerces to "null" and happens to return false — make it explicit).
- **LOCKED:** Tests assert both consumers: the bound id list (via `onCharacterCatalog`) and the prompt text (the name must be absent).
- **OPEN:** whether to log the number of retired labels dropped per prompt at debug level (recommended no — noise).

## 9. The plan

**Step 1 — helper + filter.** `apps/worker/src/handlers/ai-tagging-shared.ts`: add the exported regex/helper (section 8) near the top-level exports; change `:371` to `characters.filter(c => !["archived","deleted"].includes(c.status ?? "") && !isRetiredCharacterLabel(c.name) && !/\blogo\b|no character likeness/i.test(c.name))`. Update the comment at `:370` to list the three markers and cite the shared-db source. Gate: `npm run build --prefix apps/worker` clean.

**Step 2 — tests.**
- `apps/worker/src/handlers/character-scope.test.ts`, new cases using the existing `catalogClient`/`offered` helpers:
  - `test("licensor-retired labels are never offered, in any marker form", …)`: links = `[{id: uuid(1), name: "Venom"}, {id: uuid(2), name: "Venom - DO NOT USE"}, {id: uuid(3), name: "DNU - Disney Lorcana"}, {id: uuid(4), name: "(DNU) Batman Forever (1995)  Logo"}, {id: uuid(5), name: "Cars - Planes (Discontinued Do Not Use)"}, {id: uuid(6), name: "DNU Ben Mears as portrayed by Lewis Pullman"}]` → offered ids `== [uuid(1)]`.
  - `test("a retired label in the licensor fallback and in co-occurrence edges is dropped too", …)`: put a DNU row in `licensorChars` and one in `edges`; assert only the clean sibling ids are offered.
  - `test("isRetiredCharacterLabel matches the canonical markers only", …)`: table of names → boolean: `"DNU-Old Art"` true, `"Skyward Falls - DNU Old Art"` true, `"Do Not Use"` true, `"Discontinued line"` true, `"Donut Man"` false, `"Dnumber"` false, `null` false, `""` false.
- `apps/worker/src/handlers/character-reference-validation.test.ts`: extend the prompt-capturing case at `:30` (or add `test("a retired label never reaches the prompt text or the schema binding", …)`) asserting the captured prompt does not contain `"DO NOT USE"` / `"DNU"` while the sibling name is present, and the bound ids exclude the retired id.
- Run `npm test --prefix apps/worker`. Gate: new tests fail with the helper stubbed to `() => false` (sanity) and pass with the real one.

Adversarial cases (external input = licensor-scraped names):

| Input name | Hostile case | Test |
|---|---|---|
| `"Venom - DO NOT USE"` | spelled-out marker, uppercase | retired labels never offered |
| `"DNU - Disney Lorcana"` | abbreviation at start | retired labels never offered |
| `"(DNU) …Logo"` | abbreviation inside parentheses | retired labels never offered |
| `"… - DNU"` | abbreviation at end | isRetiredCharacterLabel table |
| `"Donut Man"`, `"Dnumber"` | false positive on substring | isRetiredCharacterLabel table |
| `null` / `""` name | throw / crash prompt build | isRetiredCharacterLabel table |
| retired row only in fallback list / edges | path not covered by the link filter | fallback-and-edges test |

**Step 3 — docs.** `docs/idiosyncrasies.md`: append "## Licensor-retired character labels are filtered by name in the tagging prompt (2026-11-04)" in the four-field shape: Looks like (DB has DNU rows that are `active`, so why aren't they offered?), Actually (worker drops names matching `dnu|do not use|discontinued` and `logo`/`no character likeness` before prompt + schema binding, `ai-tagging-shared.ts` helper), Why (licensors retire labels by renaming; `core.character` has no retirement flag), Do not change because (the model would be offered and could bind a retired label; long-term fix is a shared-db flag). Add the one-line index entry in `AGENTS.md` → Intentional quirks. Gate: `npm run lint` (prose gates) green.

**Step 4 — ship.** Branch `fix/worker-retired-labels-dnu`, PR referencing #652, `bin/ai-pr-wait <pr>` in background, merge. Railway rebuilds the worker on push to `main`; verify the Railway deployment shows the merged SHA (Railway dashboard/API per `docs/INFRASTRUCTURE.md` → Railway Worker; the `railway` MCP failed to connect in the planning session — use the API path from the doc). Gate: worker running merged SHA.

**Step 5 — live proof + close.** Pick one asset whose property has DNU rows (query: `select p.name, count(*) from core.character c join core.property_character_associations a on a.character_id=c.id join core.property p on p.id=a.property_id where c.name ~* '\bdnu\b' group by 1 order by 2 desc limit 3;` read-only) and run a single-asset re-tag from the admin UI path the worker exposes (Settings → diagnostics bulk op, `docs/BULK_JOBS.md`) or the worker's documented one-asset handler; confirm in the worker log that the prompt's character list omits every DNU/Do-Not-Use name and the resulting `asset_characters` has none. Post evidence on #652, tick `- [ ] live proof`, close with `$AI_GH_SIGNATURE`. Update STATUS and the handoff; mention the shared-db flag follow-up in the closing comment (no new issue unless Albert's business rules session decides it).

## 10. Tests required

- New (section 9 Step 2): `licensor-retired labels are never offered, in any marker form`; `a retired label in the licensor fallback and in co-occurrence edges is dropped too`; `isRetiredCharacterLabel matches the canonical markers only`; `a retired label never reaches the prompt text or the schema binding`.
- Existing green: all of `character-scope.test.ts`, `character-reference-validation.test.ts`, and the worker suite (`npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker`, as CI runs it). Root CI unaffected.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; AI merges; never push to `main`. Railway deploys the worker automatically on `main`.
- No DB changes here; a retirement flag belongs to `popcre/shared-db` claim-first (`shared-db-change` skill). Never edit the vendored `shared-db/` mirror.
- Licensor/property/character master data comes from scrapes; never hand-edit rows or ask Albert which characters are retired (memory: "Licensing from scrapes"). DC and Harry Potter are Warner properties, never licensors (ruling 2026-11-01) — irrelevant to the filter but relevant if you pick a DC asset for proof.
- Worker tests use `node:test` with fake Supabase clients — no network. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` dummies are set by the npm script.
- Keep the filter before `onCharacterCatalog` (reviewer's noted regression risk).
- Prose changes to `docs/*.md` pass the prose-merge gate (`docs/idiosyncrasies.md:290`).
- Times in EST; sign posts with `$AI_GH_SIGNATURE`; reviews advisory.

## 12. Access and environment

- `gh` as `u2giants`. Supabase MCP read-only for the counts (project `qsllyeztdwjgirsysgai`). Railway: API/token per `docs/INFRASTRUCTURE.md` and 1Password `vibe_coding` (reference by item title only).
- Admin test login for the UI proof: 1Password `vibe_coding`, item per `docs/1password.md`.
- Local worker: `npm ci --prefix apps/worker`; tests need no credentials.

## 13. Definition of done, risks, open questions

- [ ] Helper + filter merged; four new tests green; worker build green; CI green.
- [ ] Railway worker on merged SHA.
- [ ] Live re-tag evidence on #652; `- [ ] live proof` ticked; #652 closed; docs entry + AGENTS index line landed; STATUS/handoff updated.

Risks: a legitimate character whose name contains a whole word "DNU"/"Discontinued" would be hidden — none exists today (verified); the test table documents the boundary. Rollback: revert the commit (Railway redeploys).

Open / long-term: retirement should become a database fact (shared-db classifies `DO_NOT_USE_LABEL` at scrape load and exposes it as a status or column); until then the worker helper and `resolve-character-identity.mjs:129` must be kept in sync by hand. Not a question for Albert.

## Self-audit

1. **Fresh session, no questions?** Yes — sections 5, 8, 9 name the exact line, helper signature, regex, fixture names from the live database, test file helpers, and the deploy verification path.
2. **All background and rejected paths?** Yes — section 6 explains why a name heuristic is the only option (all retired rows are `active`) and the segment-vs-word-boundary nuance; section 7 lists five rejected approaches including the shared-db flag and why it is deferred.
3. **Goal clear enough to steer by?** Yes — section 1: no retired label may reach the model or the schema; any step that re-exposes one, or that hides a real character, conflicts with it.
