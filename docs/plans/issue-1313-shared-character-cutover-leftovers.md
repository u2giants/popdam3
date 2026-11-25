---
summary: "Issues 1313/1325: safe character-link write order, behaviour tests for character stats, interim table handed to shared-db."
kind: plan
status: open
read-when: "changing how AI tagging writes asset_characters / asset_licensor_characters, the rebuild-character-stats admin route, or the character-usage Settings card; fixing review findings 1313 or 1325"
---

# Shared-character cutover leftovers (issues #1313, #1325)

Issues: [#1313](https://github.com/u2giants/popdam3/issues/1313), the review of [PR #1311](https://github.com/u2giants/popdam3/pull/1311). It carries the folded [#1325](https://github.com/u2giants/popdam3/issues/1325), the review of [PR #1324](https://github.com/u2giants/popdam3/pull/1324).
Parent effort: [plan_shared_data_no_copies.md](../../plan_shared_data_no_copies.md), stage C3 (#1301).
Handoff registration: [HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md](../../HANDOFF.d/2026-11-25T2059Z-al8960ofc-claude-ai-tagging-routing-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 0. Findings already resolved by C2/C3/#1324 | ✅ verified | Read-only production check, 2026-11-25 ~3:55 PM EST: `api.dam_character_usage` view and `api.dam_publish_character_usage` function exist; the `asset_characters.character_id` foreign key targets `core.character`. The migrations are vendored in `shared-db/supabase/migrations/20261225091406_asset_characters_core_character.sql` and `20261225091609_api_dam_character_usage.sql`. |
| 1. Worker writes canonical links before clearing the interim copy | ⬜ open | — |
| 2. Behaviour tests for rebuild-character-stats and the Settings card | ⬜ open | — |
| 3. Stale comments | ⬜ open | — |
| 4. Interim table retirement routed to shared-db | ⬜ open | — |
| 5. Land and live proof | ⬜ open | `- [ ] live proof` on #1313 |

A fresh session starts at step 1.

## 1. Ultimate goal

When AI tagging re-tags a picture, its character links (Mickey, Elsa and so on) are never lost because a save failed partway. The Settings page's character-usage numbers are real numbers, backed by tests that would catch a broken lookup. The last leftover copy of character links (`asset_licensor_characters`) ends up owned by someone with a plan to retire it, instead of lingering. PopDAM then uses only the one shared character list, as Albert asked in the "no copies of shared data" effort.

**If a step conflicts with this goal, the goal wins. Stop and flag it on the issue.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork. The shared database (Supabase project `qsllyeztdwjgirsysgai`, owned by [popcre/shared-db](https://github.com/popcre/shared-db)) holds the company character list `core.character`. PopDAM links assets to characters in `public.asset_characters (asset_id, character_id → core.character)`.

During the cutover an interim copy, `public.asset_licensor_characters`, also existed. On 2026-11-25 it still held 73,547 rows (read-only count).

The relevant code:
- the Railway worker (`apps/worker/`), which writes links when it tags;
- the edge function `admin-api` (`supabase/functions/admin-api/index.ts`), whose route `rebuild-character-stats` publishes per-character usage to `dam.character_usage` through `api.dam_publish_character_usage`;
- the Settings card in `src/components/settings/ApisTab.tsx`, which reads `api.dam_character_usage`.

Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3), protected `main`; the AI merges the PR.

## 3. What triggered this work

The reviewer on PR #1311 (2026-11-24) found three things:
1. `admin-api` used `.schema("dam")`, which PostgREST does not expose.
2. The tagger wrote `core.character` IDs while the foreign key still pointed at the retired list, and it deleted interim links before the upsert, risking data loss.
3. The search functions read character IDs only from the interim table.

The reviewer on PR #1324 found:
- the `api` objects did not exist yet;
- the tests only check source substrings;
- the comment saying "ONE upsert" is stale.

The fixer run failed. The coordinator folded #1325 into #1313 on 2026-11-25.

## 4. Scope

**In:**
- the write order in `apps/worker/src/handlers/ai-tagging.ts` around `:362-377`;
- behaviour tests for `rebuild-character-stats` and the Settings count;
- comments at `supabase/functions/admin-api/index.ts:673-676` and `supabase/functions/_shared/character-stats.ts:1-4`;
- getting a shared-db issue for retiring `asset_licensor_characters`.

**NOT in this plan:**
- Any SQL or migration. Shared-db owns those; this plan only files or links the shared-db issue.
- Retiring `asset_licensor_characters` itself.
- Changing search functions.
- The historical relink scripts, which is [#797](issue-797-character-relink-script-hardening.md).
- Character UI.

## 5. Current state of the code (`main` @ `787c20b8`)

- `ai-tagging.ts:360-377`, in this order:
  1. replace the AI tags;
  2. delete `asset_characters` rows for the asset **except** the new `characterIds` (the stale links only);
  3. delete **all** `asset_licensor_characters` rows for the asset;
  4. upsert the new `asset_characters` rows.
  If step 4 fails, the asset has lost its interim links, and any stale-but-valid canonical links. The batch path retries up to five times (`ai-tagging.ts:901-916`), then records a terminal failure.
- `admin-api/index.ts:648-700`, the `rebuild-character-stats` route:
  - it pages over `asset_characters` counts;
  - it reads `api.dam_character_usage` (`:679-688`);
  - `planCharacterStats(existing, tally, threshold)` produces the changes;
  - it publishes them with `db.schema("api").rpc("dam_publish_character_usage", { p_rows: changed })` (`:692-695`).
  The comment at `:673-676` still says "ONE upsert".
- `supabase/functions/_shared/character-stats.ts:1-4`: the comment says "publishes every changed row in ONE write". `character-stats.test.ts` checks that the source contains certain strings.
- `src/components/settings/ApisTab.tsx:1118-1120`: `(supabase as any).schema("api").from("dam_character_usage").select(…, {count:"exact", head:true}).eq("is_priority", true)`. `src/test/core-licensor-property-contract.test.ts:66-72` also checks source substrings.
- `supabase/functions/agent-api/index.ts:1501`: an asset merge copies links for both tables.
- Live database, read-only on 2026-11-25:
  - the `api` view and function exist, and `dam.character_usage` holds 7,244 rows;
  - six functions still read `asset_licensor_characters` **and** `asset_characters`: `dam.search_text_embedding_input`, `public.cleanup_mega_group_tags_batch`, `public.dam_search_named_scope`, `public.propagate_group_tags_batch`, `public.refresh_dam_search_asset_document` and `public.refresh_dam_search_style_group_document`.
  The C4 migration (`shared-db/supabase/migrations/20261225120502_c4_retire_dam_legacy_lists.sql`) retired the old lists but still reads the interim table.

## 6. Key findings and root cause

- #1313 findings 1 and 2 (schema and foreign key) and #1325 finding 1 (missing `api` objects) are **resolved**; see STATUS row 0. Do not redo them.
- #1313 finding 3 (search reads only the interim table) is **resolved in substance**: the live functions read both tables. It leaves a dependency, though. As long as search still reads the interim table, the worker's per-asset interim delete changes search inputs. Retiring the interim table cleanly needs shared-db to drop those reads first.
- The data-loss ordering in the worker is still present. Root cause: destructive deletes run before the constructive write, with no transaction. PostgREST calls cannot share one.
- The tests are still substring checks (#1325), and the "ONE upsert" comments are stale.

## 7. Approaches considered and rejected

- **Moving the link write into one SQL function with a transaction.** This is right long-term, but it is a shared-db change. Note it in the step 4 issue as an option; do not block this plan on it.
- **Keeping the interim delete but retrying it.** Rejected. Ordering removes the loss window; retries do not.
- **Stopping the interim delete.** Rejected. The cutover rule is that the interim copy is never kept beside the canonical links (comment at `ai-tagging.ts:370`). Leaving stale interim rows would make search read outdated characters.

## 8. Design decisions

Locked:
- `asset_characters` holds only `core.character` IDs (C2, live 2026-11-24).
- `dam` is reached only through `api` and `public` wrappers, never `.schema("dam")` (`docs/KNOWN_QUIRKS.md`, decision `docs/decisions/2026-10-25-dam-schema-reached-through-public-wrappers.md`).
- No app-side DDL.

Locked by this plan: the write order is upsert canonical → delete stale canonical → delete interim. A failure at any step throws `AssetTagApplyError("character_links", code)`, as today.

Open: none.

## 9. The plan

**Step 1. Safe write order.** `lead-only`: production data integrity.
- In `ai-tagging.ts:362-377`, reorder to:
  - (a) if `characterIds.length`, upsert the rows into `asset_characters` (`onConflict: "asset_id,character_id"`), and throw on error;
  - (b) delete the stale `asset_characters` rows not in `characterIds`, or all of them when the list is empty, and throw on error;
  - (c) delete all `asset_licensor_characters` rows for the asset, and throw on error.
- Keep the metadata-last rule: the asset is marked tagged only after these succeed.
- Update the comment.
- Gate: these new tests in `apps/worker/src/handlers/ai-tagging.test.ts`, using a fake client that records call order and can fail a chosen call, pass:
  - "upsert failure leaves existing canonical and interim links untouched" (no delete calls recorded);
  - "stale delete failure throws after upsert";
  - "success order is upsert → stale delete → interim delete";
  - "empty characterIds deletes all canonical and interim links".
- The existing tagging tests must stay green.

**Step 2. Behaviour tests (#1325).** `helper-ok`: the patterns exist in the repo.
- Extract the route body into a function that takes an injected database, e.g. `rebuildCharacterStats(db, threshold)` in `supabase/functions/_shared/character-stats.ts`. If the route body is too entangled, a stop-and-ask; see the trigger below.
- Add tests to `character-stats.test.ts` with a fake PostgREST-shaped client:
  - counts that span two pages are summed correctly;
  - an empty `changed` makes no RPC call;
  - RPC failure → error result, and nothing else written;
  - a read failure on `api.dam_character_usage` → error;
  - success → `p_rows` equals `planCharacterStats` output.
- Replace the substring tests in `character-stats.test.ts:22-31` and `src/test/core-licensor-property-contract.test.ts:66-72` with these behaviour tests. Keep one guard test that `.schema("dam")` never appears, because that is a real tripwire.
- For the Settings card, add a vitest test that, when the mocked supabase count returns `{error}`, renders an error and not "0 priority".
- Gate: the root `npm test` passes.
- Stop-and-ask trigger: extraction would need to change the route's HTTP response shape.

**Step 3. Comments.** `helper-ok`.
- `admin-api/index.ts:673-676` and `character-stats.ts:1-4`: "publishes every changed row in one call to api.dam_publish_character_usage (a single statement in shared-db, so all-or-nothing)". First confirm the all-or-nothing claim by reading `shared-db/supabase/migrations/20261225091609_api_dam_character_usage.sql`. If it is not a single statement, write what it actually does.
- Gate: no "ONE upsert" remains (`grep -rn "ONE upsert" supabase/functions`).
- Stop-and-ask trigger: the function does not set `updated_at`, or is not atomic.

**Step 4. Route the interim-table retirement.** `lead-only`: a cross-repo request.
- Search `popcre/shared-db` for an open issue about retiring `asset_licensor_characters`: `gh issue list -R popcre/shared-db --search "asset_licensor_characters" --state open`, and check whether `shared-db/plan_shared_data_no_copies_db.md` names it.
- If there is none, open one in `popcre/shared-db`, signed. It should:
  - list the six functions above that still read it;
  - list the PopDAM writers (`ai-tagging.ts` interim delete, `agent-api/index.ts:1501` merge copy);
  - give the row count;
  - ask for a migration that moves those functions to `asset_characters` only, then drops the table;
  - note the one-transaction link-write function from §7 as an option.
- Link it from #1313 and from `plan_shared_data_no_copies.md`.
- When shared-db drops the table, PopDAM removes the interim delete and the merge entry. Note that as the follow-up step on that issue; it is not done here.
- Gate: the issue URL is recorded in STATUS.

**Step 5. Land and live proof.** `lead-only`.
- Open a PR and merge once the required checks pass. The worker auto-deploys; verify the Railway SHA. The edge functions and frontend deploy through their workflows; verify both succeed for the merge SHA.
- Live proof:
  - (a) Admin → Settings character card shows a non-zero priority count. Use Playwright or a browser with the owner's existing session, and screenshot it.
  - (b) Calling `rebuild-character-stats` returns `ok: true`.
  - (c) Read-only SQL: for 20 assets tagged after the deploy, every asset whose AI result named characters has `asset_characters` rows and zero `asset_licensor_characters` rows.
- Record this on #1313, then close it.

## 10. Tests required

- The four worker write-order tests from step 1.
- The five `rebuildCharacterStats` behaviour tests, the `.schema("dam")` guard and the Settings error-rendering test from step 2.
- Existing: `cd apps/worker && npm test && npm run build`, the root `npm test`, and the edge type check.

## 11. Constraints and gotchas

- No SQL or migrations here; the shared-db gatekeeper applies (`AGENTS.md` → Standing rules).
- `rebuild-character-stats` writes production data. Live proof (b) runs the real route, which is the normal admin action and is idempotent. Do not run it in a loop.
- The full tagging run may be active. The worker deploy restarts it safely from durable receipts.
- Use a feature branch and PR; never push to `main`.

## 12. Access and environment

- `gh` is authenticated as `u2giants`, which can open issues in `popcre/shared-db`.
- Read-only SQL: the Supabase Management API, with the token from 1Password `vibe_coding` → "Supabase CLI Personal Access Token", injected with `op run`.
- Admin UI: https://dam.designflow.app (the PopDAM web app). Use the owner's existing browser session; never type a password.
- Local: `npm ci`, the root `npm test`, then `cd apps/worker && npm test`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–3 are merged with CI green, and the worker, edge and frontend are deployed at the merge SHA.
- [ ] The step 4 shared-db issue exists and is linked.
- [ ] Live proof (a)–(c) is recorded, then #1313 is closed.
- [ ] STATUS is updated.

Risk: the reordered writes briefly leave the stale and new canonical links together between (a) and (b). That is harmless, because the next statement removes the stale ones. Rollback: redeploy the previous worker SHA.

Open: none.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes. STATUS row 0 says what is already fixed, with evidence. §5 gives the exact write order and code, §9 the edits and gates, and §12 the access.
2. *Is all background captured?* Yes. §3 covers both reviews, §6 separates resolved from open findings, and §7 records the rejected options.
3. *Is the goal clear for judgment calls?* Yes. §1 says: never lose links, use real numbers, and give the leftover copy an owner.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1313-shared-character-cutover-leftovers.md in u2giants/popdam3. Read AGENTS.md, then the plan (STATUS first; row 0 is already done). Do steps 1, 4 and 5 yourself. Give steps 2 and 3 to your helper. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules (https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md): return finished work or an evidenced blocker. Make no design decisions, no merges and no posts. Bring stop-and-ask triggers back to you. If stuck for 30 minutes, the step is taken back. You re-run every gate and the suites, merge when required checks pass, verify the deploys, record live proof, update STATUS, and close #1313 with evidence.
```
