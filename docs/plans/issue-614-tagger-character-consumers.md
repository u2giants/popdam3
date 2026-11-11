---
summary: Issue #614 plan: Tagger: characters only from licensor-scraped master list. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-614
---

# Plan: Review finding: u2giants/popdam3#613 Tagger: characters only from licensor-scraped master list (u2giants/popdam3#614)
Issue: https://github.com/u2giants/popdam3/issues/614
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Verify findings 1 and 3a (write target, search read) are landed; record evidence on the issue | ⬜ open | — (planning evidence in section 5: migrations `20261031235206`, `20261101015213`, `20261101120856`; `ai-tagging.ts:328-338`) |
| 2 | Bake-off resolves character ids and names from `core.character`, not the retired `dam_character_catalog` | ⬜ open | — |
| 3 | Bake-off tests: ids from the prompt catalogue are accepted; names resolve | ⬜ open | — |
| 4 | Cap the property-links + co-occurrence character list at `LICENSOR_CHARACTER_LIST_LIMIT` | ⬜ open | — |
| 5 | Scope test: an over-large property list offers no characters | ⬜ open | — |
| 6 | `rebuild-character-stats` tallies the live `asset_licensor_characters` table too; docs corrected | ⬜ open | — |
| 7 | Docs, PR, CI, merge, deploy (worker to Railway, admin-api edge function, front end) | ⬜ open | — |
| 8 | Live proof (bake-off run with named characters; stats route output) and close #614 | ⬜ open | — |

**Where a fresh session starts:** step 1 is a short evidence post; real work starts at step 2. Findings 1 and the search half of 3 are landed on `main`; findings 2, 3 (admin half) and 4 are open (section 5). The issue carries both `fixer-done` and `fixer-deferred`: the fixer's PR #617 was **closed unmerged** (section 6).

---

## 1. The ultimate goal

AI tagging must attach **only real, licensor-approved character names** to artwork — the names POP Creations is licensed to use — and every screen or job that reads character links must read the same list the tagger writes. Three consumers still read the retired list, so today: the **bake-off** (the tool that compares AI models before Albert pays for a full tagging run) silently scores every model as finding zero characters, which makes its results worthless for choosing a model; the **character priority statistics** in Settings decay to zero and mislead; and a property with a very long character list is sent to the model in full, which costs money and invites wrong matches.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Never reintroduce the retired DesignFlow character list (`public.characters` / `dam_character_catalog`) as a tagging source, and never write character links anywhere but `public.asset_licensor_characters`.

## 2. What this application is

PopDAM (see `AGENTS.md`): internal DAM for licensed consumer-product art. AI tagging runs in the Railway worker (`apps/worker/src/handlers/ai-tagging*.ts`), reads its character catalogue from the shared Supabase backend (`qsllyeztdwjgirsysgai`), and writes tags to `public.asset_tags` and character links to `public.asset_licensor_characters` (→ `core.character`, the licensor-scraped master list). The vision **bake-off** (`apps/worker/src/handlers/ai-tag-bakeoff.ts`, op `ai-tag-bakeoff`; docs `docs/MODEL_RULES.md:68`, `docs/BULK_JOBS.md:29`) runs several models on sample assets and stores comparable results in `ai_tag_bakeoff_results`. Admin routes live in the Supabase edge function `supabase/functions/admin-api/index.ts`; the Settings UI in `src/components/settings/`. Deploys: worker → Railway on merge to `main`; edge functions → `.github/workflows/deploy-supabase.yml` on `supabase/functions/**` changes; front end → GHCR → Coolify at https://dam.designflow.app. DB schema is owned by `popcre/shared-db` (vendored read-only mirror under `shared-db/`).

## 3. What triggered this work

PR #613 ("Tagger: characters only from licensor-scraped master list", merged 2026-11-01 as `a2a4faeb`) switched the tagging prompt's character catalogue from the legacy DesignFlow list to `core.character` (property links, co-occurrence edges, or a small licensor list) and switched the write target to a new table `asset_licensor_characters`. The advisory review (reviewer: glm, run 41254462553) filed #614 with four findings:

1. **BLOCKER** — `asset_licensor_characters` did not exist in the DB at review time → every tag apply would fail at `character_links`.
2. **HIGH** — bake-off still resolves ids/names via `dam_character_catalog`; with `core.character` ids in the prompt, every model-returned id is rejected → results stored with `character_ids: []`.
3. **HIGH** — deleting legacy `asset_characters` rows on re-tag breaks (a) search (`dam_search_documents` built from `asset_characters`) and (b) admin `rebuild-character-stats` (tallies `asset_characters`).
4. **MEDIUM** — no size cap on the property-links path (`LICENSOR_CHARACTER_LIST_LIMIT` bounds only the licensor fallback). *(The issue body is truncated after this heading; the finding's substance is clear from the code.)*

The review-fixer opened PR #617 (closed, never merged); its description claims it re-pointed writes, "kept bakeoff compatible", "preserved legacy links", and "capped property-linked lists at 400" — but it targeted the pre-merge feature branch and was abandoned. Albert's session on Nov 4, 2026 checked `main` `522e5722` and live data and posted: *"Fixed: write target and search read. Still open: bakeoff uses dam_character_catalog; rebuild-character-stats tallies asset_characters; property-links list uncapped."* This plan matches that.

## 4. Scope

**In:**
- `apps/worker/src/handlers/ai-tag-bakeoff.ts` — `resolveNames` (164-178), `loadCharactersByIds` (191-198), `resolveCharacterNameCandidates` (200-247), `CharacterRow` (99-105).
- `apps/worker/src/handlers/ai-tagging-shared.ts` — `buildImageTaggingPrompt` property-links/edges branch (340-365) and the dedupe line (383).
- `supabase/functions/admin-api/index.ts` — `handleRebuildCharacterStats` (737-780) and its docs (`docs/ADMIN_OPERATIONS.md:578-590`, `docs/SCHEMA.md:59`, `docs/KNOWN_QUIRKS.md:639`).
- `src/components/settings/ApisTab.tsx` `CharacterStatsSection` (1298-1340) — toast/description wording only.
- Tests: `apps/worker/src/handlers/character-scope.test.ts`, a new `apps/worker/src/handlers/ai-tag-bakeoff-taxonomy.test.ts`, and (if a Deno test harness exists for admin-api — check `supabase/functions/_shared/*.test.ts`, 22 files) a stats tally test.

**NOT in this plan:**
- Any schema change (new columns on `core.character`, dropping `asset_characters`/`characters`, view changes) — `popcre/shared-db`, claim-first. Section 8 records the one follow-up that may be worth filing there.
- Findings already landed (write target; search document/trigger wiring) beyond citing evidence.
- The tagging prompt's *selection* rules (property links → edges → small licensor list), the "do not use/logo" filter, or the #680/#721 work on named-character linking.
- `group-metadata-refresh.ts` (its comment at line 17 only says what a refresh must never touch).
- Re-running the bake-off at scale or choosing a model (that is #680's business decision).

## 5. Current state of the code (worktree at `01fcfc34`, contains `origin/main`)

**Finding 1 — LANDED.** Table created by `shared-db/supabase/migrations/20261031235206_asset_licensor_characters.sql:6-19` (RLS + grants); in generated types at `src/integrations/supabase/types.ts:626` and `shared-db/types/database.types.ts:42118`. Worker writes at `apps/worker/src/handlers/ai-tagging.ts:328-338` (delete stale links, delete legacy `asset_characters`, upsert new rows with `source:"ai", model, tagged_at`). Later migration `20261104073606_group_shot_designers_and_grogu_merge.sql:76-81` already manipulates the table. Test `character-reference-validation.test.ts:75` ("a re-tag clears the asset's old character links before writing the new ones…").

**Finding 3a (search) — LANDED.** `20261031235206_asset_licensor_characters.sql:51-52,102-105,181-186` — the DAM search document builder unions `asset_characters×characters` with `asset_licensor_characters×core.character`; refresh triggers `20261101015213_asset_licensor_characters_search_refresh.sql:6-8`, re-created statement-level in `20261101120856_dam_search_refresh_statement_level.sql:71-76`.

**Finding 2 — OPEN.** `ai-tag-bakeoff.ts:168` (`resolveNames`), `:194` (`loadCharactersByIds`), `:214` (`resolveCharacterNameCandidates`) all query `public.dam_character_catalog` selecting `id, name, property_id:core_property_id, is_priority, usage_count`. That view (`shared-db/.../20260723113000_dam_core_licensor_property_cutover.sql:204-232`) is a join over **legacy `public.characters`** with the comment "character IDs remain legacy public.characters". The bake-off prompt is built with `buildImageTaggingPrompt` (`ai-tag-bakeoff.ts:555`), which offers `core.character` ids (`ai-tagging-shared.ts:340-380`). `normalizeModelTaxonomy` (`:250-300`) therefore loads zero rows for any returned id, pushes them all into `debug.rejected_character_ids` (`:272`), and `characterIds` ends empty unless a *name* happens to match a legacy row by `ilike`. `is_priority`/`usage_count` are only typed (`CharacterRow:103-104`) and selected; nothing reads them.

**Finding 3b (admin stats) — OPEN.** `supabase/functions/admin-api/index.ts:747-757` pages `asset_characters` and `:760-776` writes `characters.usage_count`/`is_priority`. Tagging now deletes `asset_characters` rows on every re-tag (`ai-tagging.ts:333`), so the tally decays. `core.character` has **no** `usage_count`/`is_priority` columns (`20260621150815_app_core.sql:203-213`: id, property_id, name, code, status, metadata, timestamps), so the write side cannot simply be re-pointed. UI: `src/components/settings/ApisTab.tsx:1298-1340` counts `characters` rows and calls the route. Docs describing the legacy behaviour: `docs/ADMIN_OPERATIONS.md:578-590`, `docs/SCHEMA.md:59`, `docs/KNOWN_QUIRKS.md:639`, `docs/audit-2026-10-21.md:52`.

**Finding 4 — OPEN.** `ai-tagging-shared.ts:340-365`: property links (`core.property_character_associations`, `is_current`) and co-occurrence edges (`core.property_character_source_edge`) are concatenated with no limit; only the licensor fallback (`:371-380`) applies `LICENSOR_CHARACTER_LIST_LIMIT = 400` (`:313`) and returns `[]` when exceeded. Dedupe/filter/sort at `:383`.

Nothing on a branch; PR #617 closed unmerged.

## 6. Key findings and root cause

- The PR migrated the **prompt source** and the **write target** but left three **readers** on the legacy identity space. Legacy `public.characters.id` and `core.character.id` are different UUID spaces; the view `dam_character_catalog` maps legacy rows to a `core_property_id` but keeps legacy ids, so an id lookup across spaces returns nothing.
- Bake-off results are therefore silently degraded, not failed: `rejected_character_ids` lands in `_popdam_debug` inside `raw_output` (`:367-371`), `character_ids: []`, and `characterNames` empty. Nothing alerts.
- `is_priority`/`usage_count` on `CharacterRow` are vestigial in the bake-off (nothing reads them), so dropping them is free. That also removes the last worker dependency on the legacy stats.
- For the stats route, the honest state is: the legacy tally is now a count of links that tagging actively deletes. The only live link table is `asset_licensor_characters`. Persisting counts per `core.character` would need shared-db columns; this plan keeps the route truthful without a schema change (section 8).
- Fixer PR #617 cannot be cherry-picked: it was built on the pre-merge branch head `7ac6f3e` and "kept bakeoff compatible by offering existing record IDs for unambiguous licensor-sourced names" — i.e. it re-mapped **back** to legacy ids, the opposite of the goal. Do not resurrect it.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Keep the bake-off on `dam_character_catalog` and map `core.character` ids → legacy ids by name | That is PR #617's approach; it reintroduces the retired list as an identity, is lossy (names differ, ambiguous), and contradicts the LOCKED direction. |
| Extend the `dam_character_catalog` view to expose `core.character` ids | Schema change in shared-db for a view whose comment calls it "temporary"; the worker can read `core.character` directly (it already does in `ai-tagging-shared.ts:371-376` and `ai-tagging.ts:284`). |
| Add `usage_count`/`is_priority` to `core.character` now | Shared-db structural change; no consumer needs persisted counts today (bake-off drops them). Record as an optional follow-up only. |
| Delete the `rebuild-character-stats` route and the Settings card | Removes a capability instead of repairing it (standing rule). Make it truthful instead. |
| Cap by truncating the property list to the first 400 by name | Arbitrary — would silently drop "Zurg" and keep "Aardvark". Mirror the licensor branch: too large → offer none, log it. |
| Cap by dropping co-occurrence edges first, then truncating | More rules for a case that may not exist in the data; start with the simple consistent rule, revisit if live data shows a property genuinely over 400 (section 13). |

## 8. Design decisions

- **LOCKED (2026-11-04):** the bake-off reads character ids and names from `core.character` (`client.schema("core").from("character").select("id, name, property_id, status")`), the same table the prompt catalogue comes from. `CharacterRow` drops `is_priority`/`usage_count`. Archived/deleted rows and "do not use/logo" names are filtered exactly as in `ai-tagging-shared.ts:383`.
- **LOCKED:** the property-links + co-occurrence list is capped with the same constant and the same consequence as the licensor list: more than `LICENSOR_CHARACTER_LIST_LIMIT` (after dedupe and status/name filtering) → `characters = []` and a `logger.warn("ai-tag: property character list too large to offer", { property_id, count })`. When the property list is emptied this way the code must **not** fall through to the licensor list (it would also be huge); mirror the existing `characters.length === 0 && scope.licensor_id` condition by tracking an `overflow` flag.
- **LOCKED:** no schema change in this repo or this plan. `rebuild-character-stats` keeps its legacy writes (so nothing breaks for anyone still reading `characters.is_priority`) **and** additionally tallies `asset_licensor_characters` (paged the same way, joined to non-deleted assets), returning `licensor_character_usage: { characters: <distinct count>, priority: <count ≥ threshold>, top: [{ character_id, name, count }] (top 25) }` in the JSON response. The Settings toast shows both numbers. Docs say plainly which table feeds which number and that the legacy number only reflects links tagging no longer writes.
- **OPEN (shared-db follow-up, file only if someone needs it):** persist per-`core.character` usage counts (columns or a materialised view) — claim-first on the existing shared-db tagging issue, `shared-db-change` skill.
- **OPEN (implementer):** whether to extract the three bake-off resolver functions into an injectable-client module (recommended, for testability) or test through `handleAiTagBakeoff` with a mocked `db()`.

## 9. The plan

### Step 1 — Evidence for the landed parts
- On #614 post (signed with `$AI_GH_SIGNATURE`) the section 5 evidence for findings 1 and 3a (migration file names + `ai-tagging.ts:328-338`), stating they are verified on `main` and this plan covers the rest. Do not close the issue.
- **Gate:** comment visible on the issue.

### Step 2 — Bake-off reads `core.character`
- `apps/worker/src/handlers/ai-tag-bakeoff.ts`:
  - `CharacterRow` (99-105) → `{ id: string; name: string; property_id: string | null; status?: string | null }`.
  - `loadCharactersByIds` (191-198) → `db().schema("core").from("character").select("id, name, property_id, status").in("id", characterIds)`; filter out `status in ("archived","deleted")`.
  - `resolveNames` (164-178) → same table for names (`select("id, name")`).
  - `resolveCharacterNameCandidates` (200-247) → `schema("core").from("character").select("id, name, property_id, status").ilike("name", trimmed).limit(25)`; keep the exact-normalised-name filter and the preferred-property logic; exclude archived/deleted.
  - Prefer refactoring these three into `apps/worker/src/handlers/ai-tag-bakeoff-taxonomy.ts` with `(client: DB, …)` parameters and re-export/import them in `ai-tag-bakeoff.ts`, so step 3 can test them with a fake client (pattern: `catalogClient` in `character-scope.test.ts:47-66`).
  - `normalizeModelTaxonomy` (250-300) keeps its logic; property acceptance compares `row.property_id` to the (core) property id, which is now the same id space as `asset.property_id` (assets carry core property ids since the 2026-07-23 cutover).
- Intended behaviour: a model that returns an id from the offered catalogue gets it accepted and named; `rejected_character_ids` only lists ids outside the catalogue/property.
- **Gate:** `npm run build --prefix apps/worker` passes; step 3 tests pass; `grep -n dam_character_catalog apps/worker/src/handlers/ai-tag-bakeoff.ts` returns nothing.

### Step 3 — Bake-off taxonomy tests (`apps/worker/src/handlers/ai-tag-bakeoff-taxonomy.test.ts`)
Fake client: `schema("core").from("character")` answering `in()` and `ilike()` from an in-memory list of `{id, name, property_id, status}`; `schema("core").from("property")` answering `maybeSingle()`.
1. **"a model-returned id from the offered core.character catalogue is accepted and named"** — asset with `property_id: P`; catalogue rows A(P), B(P); output `character_ids: [A]` → `characterIds: [A]`, `characterNames: ["A"]`, no `rejected_character_ids`.
2. **"an id outside the asset's property is rejected and reported"** — output `[C]` where C belongs to property Q and the description does not mention C → `characterIds: []`, `debug.rejected_character_ids: [C]`.
3. **"a retired licensor character is never accepted even when returned by id"** — row with `status: "archived"` → rejected.
4. **"explicit character names resolve unambiguously within the property"** — `character_names: ["Stitch"]`, two rows named Stitch under P and Q, asset property P → the P row only.
5. **"legacy catalogue ids are not consulted"** — fake client throws if `from("dam_character_catalog")` is called; run the resolver → no throw.
- **Gate:** `npm run test --prefix apps/worker` green; tests 1 and 5 fail against the current code (verify once).

### Step 4 — Cap the property-links path
- `apps/worker/src/handlers/ai-tagging-shared.ts` inside `buildImageTaggingPrompt`:
  - After the edges are concatenated (after line 357) and **after** the dedupe/filter at line 383 (move the dedupe/filter up, or apply the filter to a local list first), compute `const propertyListTooLarge = characters.length > LICENSOR_CHARACTER_LIST_LIMIT`; if so, `logger.warn(...)` and set `characters = []`.
  - Guard the licensor fallback at line 366: `if (!scope.unlicensed && characters.length === 0 && scope.licensor_id && !propertyListTooLarge)`.
  - Update the comment block at lines 335-339 to mention the cap applies to both paths.
- Intended behaviour: a property with ≤400 current characters is offered in full (today's behaviour); a larger one offers nothing, like the licensor branch, and leaves a warning in the worker log naming the property.
- **Gate:** step 5 test; existing `character-scope.test.ts` tests 82-99 still pass.

### Step 5 — Scope test (`apps/worker/src/handlers/character-scope.test.ts`)
- **"a property list too large to show offers no characters and does not fall back to the licensor list"** — `catalogClient(links = 401 rows, licensorChars = [small list], edges = [])` with `promptAsset("p", "lic")` → `offered(...)` is `[]` (note the licensor list would otherwise be offered; the assertion proves the fallback is suppressed).
- **"links plus co-occurrence edges are capped together"** — 300 links + 101 edges → `[]`; 300 links + 100 edges → 400 ids.
- **"duplicates between links and edges do not count twice toward the cap"** — 400 links and the same 400 as edges → 400 ids offered.
- **Gate:** tests pass; fail with step 4 reverted.

### Step 6 — Truthful `rebuild-character-stats`
- `supabase/functions/admin-api/index.ts` `handleRebuildCharacterStats` (737-780): factor the paging loop into `tallyLinks(table: "asset_characters" | "asset_licensor_characters")` (same select `character_id, assets!inner(is_deleted)`, same `.eq("assets.is_deleted", false)`, same ordering/range). Run it for both tables. Keep the legacy write block unchanged. For the licensor tally, resolve names for the top 25 via `db.schema("core").from("character").select("id, name").in("id", topIds)` and add `licensor_character_usage` to the response (section 8).
- `src/components/settings/ApisTab.tsx:1316-1318` toast → `${data.priority_characters} legacy priority characters; ${data.licensor_character_usage.priority} licensor characters with ≥${data.threshold} tagged assets`. Card description (1328-1330): one sentence that the live count comes from licensor-scraped character links.
- Docs: `docs/ADMIN_OPERATIONS.md:578-590` (describe both tallies; legacy writes retained; no writes for licensor characters), `docs/SCHEMA.md:59`, `docs/KNOWN_QUIRKS.md:639` (the legacy usage shortcut no longer grows).
- Test: if `supabase/functions/_shared` has a Deno test pattern that can exercise a route handler with a fake client (check `supabase/functions/_shared/dam-search-merge.test.ts` and `licensing-resolution.test.ts` for the style), add **"character stats tally both link tables and report licensor usage"**; otherwise put `tallyLinks` in `supabase/functions/_shared/character-stats.ts` with a pure `summarizeTally(map, threshold)` and test that.
- **Gate:** `deno check supabase/functions/admin-api/index.ts` (or the repo's edge-function lint step in `deploy-supabase.yml`) passes; the route returns both blocks when called in step 8.

### Step 7 — Docs, PR, CI, merge, deploy
- `docs/MODEL_RULES.md:68` (bake-off code path note): add "character ids/names resolve from `core.character`". `docs/BULK_JOBS.md:84` row mentions `asset_characters` for AI tagging writes — correct it to `asset_licensor_characters`.
- Commit as Albert's verified identity; push; PR to `main`: `fix(tagging): bake-off and stats read licensor characters; cap property lists (#614)`, body `Closes #614` + attribution lines; sign posts with `$AI_GH_SIGNATURE`.
- `bin/ai-pr-wait <pr>` in background. CI runs root vitest/lint/typecheck/build and the worker build+test.
- Merge. Verify: Railway worker running the merge SHA; `deploy-supabase.yml` run green (admin-api redeployed to `qsllyeztdwjgirsysgai`); `publish-frontend.yml` green and Coolify serving the SHA.
- **Gate:** all three deploy surfaces at the merge SHA.

### Step 8 — Live proof and close
- Bake-off: from Settings (admin tester login, 1Password `vibe_coding`) start a small `ai-tag-bakeoff` run (≤5 assets with known characters, one or two cheap models — see `docs/MODEL_RULES.md`). Read `ai_tag_bakeoff_results` (read-only SQL): at least one row has non-empty `character_ids` and `character_names`, and `raw_output->'_popdam_debug'->'rejected_character_ids'` is absent or lists only off-property ids. Before/after comparison: the most recent pre-fix run's rows should show empty `character_ids` for the same assets.
- Stats: click **Rebuild** in the Character Priority Stats card; the toast shows both numbers; the response JSON (network tab) carries `licensor_character_usage.top` with real names.
- Cap: worker log shows no "property character list too large" warnings during the bake-off, or, if one appears, record the property id for the section 13 question.
- Post evidence (signed) on #614, tick `- [ ] live proof`, close.
- **Gate:** issue closed with query output and screenshots.

## 10. Tests required

New: five bake-off taxonomy tests (step 3), three scope tests (step 5), one stats test (step 6). Must stay green: `npm run test --prefix apps/worker` (node:test), `npm run build --prefix apps/worker`, root `npm run test` / lint / typecheck / build, `character-reference-validation.test.ts`, `character-scope.test.ts`, `ai-tag-bakeoff-batch.test.ts`.

Adversarial cases (external input = model output and catalogue rows):

| Input | Hostile case | Test |
|---|---|---|
| model `character_ids` | id not in `core.character` | step 3 test 2 |
| model `character_ids` | legacy `public.characters` id | step 3 test 5 (never consulted) |
| model `character_ids` | archived/deleted core row | step 3 test 3 |
| model `character_names` | ambiguous across properties | step 3 test 4 |
| model `character_names` | "Venom - Do Not Use", "Marvel logo" | add **"retired labels never resolve by name"** (reuse the regex from `ai-tagging-shared.ts:383`) |
| property links | > 400 rows, duplicates across links/edges | step 5 tests |
| stats page | > 1000 links (PostgREST cap) | existing paging loop; stats test asserts the loop runs to exhaustion with a 1001-row fake |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; the AI merges; one worktree per task.
- **No DDL here**; `shared-db-guard.yml` fails any migration outside the vendored mirror. `core.character` has no usage columns — do not add them from this repo.
- Production DB read-only; bake-off and stats runs are app actions through the UI/worker, not SQL writes.
- The worker Supabase client's default schema is `public` (`apps/worker/src/supabase.ts:14`); `core.*` needs `.schema("core")`.
- `dam_character_catalog` is a legacy compatibility view; nothing new may depend on it. After step 2, `grep -rn dam_character_catalog apps/worker/src` should list only `character-reference-validation.test.ts` (if it still references it as a negative case) — check and clean.
- Bake-off runs cost money per model call; keep the live-proof run tiny. The paid full tagging run is #680's decision, not this plan's.
- Edge-function changes deploy automatically on merge (`deploy-supabase.yml`); the admin route is live for admins immediately.
- Times in EST; sign GitHub posts; reviews advisory; `bin/ai-pr-wait` for CI.

## 12. Access and environment

- Implement in a fresh worktree of `u2giants/popdam3`; `gh` as `u2giants`.
- Worker: `npm ci --prefix apps/worker`, `npm run test --prefix apps/worker`, `npm run build --prefix apps/worker`. Edge functions: Deno (`deno check`), see `docs/development.md`.
- DB reads: Supabase MCP (project `qsllyeztdwjgirsysgai`, Virginia — memory `project_supabase_virginia_cutover`) or the CLI runbook in `/worksp/shared-db/AGENTS.md`.
- Admin UI: https://dam.designflow.app → Settings; admin tester login in 1Password `vibe_coding` (titles in `docs/1password.md`; never values). Model keys are admin_config/1Password items referenced in `docs/MODEL_RULES.md`.
- Railway worker logs: Railway dashboard (the Railway MCP did not connect in the planning session).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Evidence for findings 1/3a posted on #614.
- [ ] Bake-off resolves ids/names from `core.character`; no `dam_character_catalog` reference remains in the worker.
- [ ] Property-links list capped; licensor fallback suppressed on overflow.
- [ ] Stats route reports both tallies; UI toast and docs updated.
- [ ] Nine new tests pass; worker and root CI green.
- [ ] PR merged; worker, admin-api and front end at the merge SHA.
- [ ] Live proof (bake-off rows with names; stats response) on #614; issue closed; STATUS table updated with artifacts (test paths, SHA, CI run id, query output file).

Risks and rollback:
- If a real property has > 400 current characters, tagging for its assets would lose character suggestions. Decision criterion: if the worker log shows the new warning for a property in normal use, open a follow-up to drop co-occurrence edges first and/or raise the constant for property lists; do not silently truncate. Revertible by one commit.
- The stats route runs two paged scans; `asset_licensor_characters` is still small (written since 2026-11-01), so runtime stays within the edge-function limit; if it ever approaches it, move the tally to an RPC in shared-db (OPEN follow-up).
- Bake-off result rows written before this fix remain degraded; they are historical and not rewritten.

Open questions (none require Albert): the shared-db follow-up for persisted `core.character` usage counts is filed only if a consumer appears.

## Self-audit

1. **Executable by a fresh session without questions?** Yes — section 5 separates landed from open with file:line and migration names; section 9 names the functions, the replacement queries, the fake-client pattern to copy, and the deploy surfaces per component.
2. **Carries all background and what was ruled out?** Yes — section 6 explains the id-space mismatch and why the fixer's PR #617 must not be resurrected; section 7 lists six rejected approaches including the schema-change and delete-the-route options.
3. **Goal clear enough to steer by?** Yes — section 1 ties the work to trustworthy model comparison and licensor-approved names, and forbids reintroducing the retired list or writing links elsewhere.
