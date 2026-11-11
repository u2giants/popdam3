---
summary: Issue #736 plan: Tagging: named characters resolve through licensor aliases (#680). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-736
---

# Plan: Review finding: u2giants/popdam3#731 Tagging: named characters resolve through licensor aliases (#680) (u2giants/popdam3#736)
Issue: https://github.com/u2giants/popdam3/issues/736
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Confirm PR #731 state and tagging-run state | ⬜ open | |
| 2 | Add the retired-label guard on PR #731's branch | ⬜ open | |
| 3 | Normalise duplicate comparison | ⬜ open | |
| 4 | Add tests | ⬜ open | |
| 5 | CI, merge when worker restart is safe, verify deploy | ⬜ open | |
| 6 | Live proof and close | ⬜ open | |

**Where a fresh session starts:** step 1. Work on the existing PR; do not open a second one.

---

## 1. The ultimate goal

Staff search by character. When a sheet says a character's everyday name, and the licensor files it under another label, the file should still link to the right character. But labels the licensor has retired ("Venom - Do Not Use"), logos and "(general)" rows must never become a character link, whichever route found them. The alias feature must not open a back door around that rule.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

PopDAM (https://dam.designflow.app, licensed-art asset manager) and PopSG (https://sg.designflow.app, style-guide library) are POP Creations internal tools used by designers, sales and administrators. Repo `u2giants/popdam3`, default branch `main`. Stack: one React 18 + Vite frontend in `src/` (GHCR image, Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`); Supabase edge functions in `supabase/functions/` (project `qsllyeztdwjgirsysgai`, Virginia; deployed by `.github/workflows/deploy-supabase.yml` on changes to `supabase/functions/**`); a long-running job worker in `apps/worker` on Railway (auto-deploys on every push to `main`, which restarts it); agents on the NAS and Windows machines. Database structure is owned by `popcre/shared-db` (canonical checkout `/worksp/shared-db`); `shared-db/` here is a read-only mirror.

Terms: `core.character` is the licensor master list; `core.character_alias` maps other names to one character. `addNamedCharacters` adds characters that an AI read by name from a sheet.

## 3. What triggered this work

PR #731 is **OPEN and not merged** (head `e18707b1`, mergeable: a test merge with local `origin/main` `39e428ef` had no conflicts). Its body says "Do not merge while the tagging run is active". Muse's advisory review of that head filed #736. **So the finding is not on `main`; `main` has no alias code at all** and the fix must land inside the PR before it merges.

## 4. Scope

In: three findings, namely the missing guard, case-sensitive duplicate check, and the missing test.

### NOT in this plan
- Loading more aliases, or any alias data; `core.character_alias` belongs to shared-db and Master Data work.
- Using aliases when offering the catalog to the model (`ai-tagging-shared.ts:431`).
- Retired-label data cleanup: [issue-652 plan](issue-652-retired-character-labels-dnu.md).
- Sharing `NOT_A_CHARACTER` with edge functions (see #725 plan).
- Re-tagging files already tagged.

## 5. Current state of the code

Checkout `39e428ef` (`main`):
- `apps/worker/src/handlers/ai-tagging-shared.ts:252` `NOT_A_CHARACTER`.
- `:264-296` `addNamedCharacters`; `:289` direct-path guard; `:431` catalog guard. Findings cite `:436`, which is the older line number; the guard is at `:431` here.
- `:210` `normalizeCharacterIds` lowercases. `:254-256` `normalizedCharacterName`.
- `apps/worker/src/handlers/ai-tagging.ts:319` caller, passes validated IDs.
- `apps/worker/src/handlers/ai-tagging.test.ts:281-288` direct-path test with the proxy client.

PR head `e18707b1` adds: `ai-tagging-shared.ts:292` alias query selecting `alias, character:character_id(id, status)`; `:293-294` filter; `:295` the duplicate check; and a test at `ai-tagging.test.ts:290-298`.

Live, read-only, 2026-11-04 about 6:05 PM EST: 1 alias row, 0 aliases pointing at a retired-pattern character, 0 retired-pattern alias texts; 885 of 15,019 `core.character` rows match the retired pattern and all but one character are `active`. `ai-tag-parallel` is `running`.

## 6. Key findings and root cause

- **Confirmed by reading the PR:** the alias path filters on status only. Retired labels are `active`, so status never catches them. No current row exploits it, but the PR body says more aliases are being loaded.
- **Duplicate check:** latent. `characterIds` is validated today, and a mixed-case caller would produce a duplicate UUID.
- **Extra, same line:** when the alias target is already in `characterIds`, `have.add(name)` is skipped. Harmless, since each wanted name is visited once.
- `shared-db/supabase/migrations/20260906222338_core_character_alias_and_source_provenance.sql:588` `:587-588` is a unique index on `(licensor_id, normalized_alias)`. So at most one alias row normalises equally under the database rule, though the worker's `normalizedCharacterName` is its own normaliser, so keep the `.find` loop.

## 7. Approaches considered and REJECTED

- **Add a database constraint forbidding aliases to retired rows:** a DB rule for a worker invariant, and retired labels are matched by text pattern; the worker guard is needed anyway.
- **Query `normalized_alias` with `.eq` instead of `ilike`:** a different normaliser from the worker's (it would change matching); not needed for this finding.
- **Filter only the target name, not the alias text:** an alias literally reading "Venom - Do Not Use" would then match a wanted name; check both.
- **Merge first, fix later:** the PR would ship the back door during a paid run.

## 8. Design decisions

- **LOCKED:** the same `NOT_A_CHARACTER` regex is applied to both alias text and target name. One rule, no copy.
- **LOCKED:** this keeps the "exact match, licensor scoped, failed read keeps ids already chosen" behaviour at `:286-294`.
- **LOCKED:** fix on PR #731's branch `fix/680-worker-reads-character-aliases`. Another session owns that PR, so check `gh pr view 731` for fresh commits first.
- **OPEN:** whether to wrap the duplicate check in a small `Set`. Criterion: minimal diff.

## 9. The plan

**Step 1. Preflight.** `gh pr view 731 --json state,headRefOid,mergedAt` and the read-only run query in section 5. If merged since, make a new branch from `main` with the same edits. You'll know it worked when you have recorded the head and whether the code is unchanged.

**Step 2. Guard.** In a worktree of the PR branch, change line 292's select to `alias, character:character_id(id, name, status)`, the cast at 293 to include `name: string`, and the predicate at 294 to additionally require `!NOT_A_CHARACTER.test(row.alias) && !NOT_A_CHARACTER.test(row.character.name)`. Result: a retired alias or target never links, and the loop moves on to the next name. You'll know it worked when the test `an alias never links a retired or logo character` passes.

**Step 3. Duplicates.** Compare lowercased on both sides: `const aliasedId = aliased?.character?.id.toLowerCase(); const known = new Set([...characterIds, ...added].map(id => id.toLowerCase()));`. Return value keeps caller order and is otherwise unchanged. You'll know it worked when `an alias does not duplicate an id already chosen in another case` passes.

**Step 4. Update the PR test data** to include `name` on each `character` fixture, because the guard reads it. A missing `name` must not crash silently into the catch: fixtures must carry it. You'll know it worked when `npm run test --prefix apps/worker` shows all ai-tagging tests pass.

**Step 5. Land.** Push to the PR branch, `bin/ai-pr-wait 731`. Same rule as the PR body: if `ai-tag-parallel` is `running`, leave it green and unmerged unless the #680 run owner records on #680 that restart is safe. Tradeoff to report on #680: files tagged in the meantime do not use aliases. Today that is one alias row, so the cost is small. After merge, confirm the Railway deployment for the merge SHA. You'll know it worked when the deployed commit matches.

**Step 6. Live proof.** Pick a file whose sheet names the aliased character after deployment (the PR names Asha and Lucky aliases), tag it through normal flow, and read `asset_licensor_characters`. You'll know it worked when the alias target is linked and the count of links to retired-pattern characters created since the deploy with `source='ai'` is 0 through the alias path. Post on #736 and close. If no file can be tested yet, leave `- [ ] live proof` on #736.

### Adversarial cases (AI output and alias data are external input)

| Input | Hostile case | Test |
|---|---|---|
| alias target name | `Venom - Do Not Use`, status active | `an alias never links a retired or logo character` |
| alias target name | `Mickey Logo`, `Foo (general)` | same test, table-driven |
| alias text | `Hero - Do Not Use` to a good target | `an alias whose own text is retired is ignored` |
| alias target | `archived`, `deleted`, null embed | `an alias to an archived or missing character is ignored` |
| existing ids | upper-case UUID equals target | `an alias does not duplicate an id already chosen in another case` |
| names | `%`, `_`, non-array, short text | existing escape and filter at `:270,286`; `wildcards in a named character cannot widen an alias match` |
| alias read | error or thrown | `a failed alias read keeps the ids already chosen` |

## 10. Tests required

All in `apps/worker/src/handlers/ai-tagging.test.ts`, reusing the proxy client from the PR's test; the table above lists names. The PR's `a named character links through a licensor alias when the label differs` stays. Must stay green: full CI.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges; Albert does not. Albert is not technical: never ask him to click, type, create a credential or approve. Only business-meaning questions go to him.
- CI (`.github/workflows/ci.yml`): `npm ci && npm run lint && npm run typecheck && npm run test` at root; `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker`; `npm ci --prefix apps/windows-agent && npm test --prefix apps/windows-agent`; `npm run build`. Wait with `bin/ai-pr-wait <pr>` in the background; never a sleep loop. AI reviews are advisory and never block; required checks stay lean.
- Database structure changes never go in this repo; they go through `popcre/shared-db`, claim-first on the existing issue, loading the `shared-db-change` skill. Production database is read-only by default; migrations reach production only through shared-db's automatic promotion workflow.
- Secrets live in 1Password vault `vibe_coding`; reference by vault + item title only, never values.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote human times in EST (America/New_York).
- Live proof is required before an outcome is closed. If it cannot happen yet, leave `- [ ] live proof` on this SAME issue; never open a follow-up issue for it.
- No band-aids, no silent failures, nothing hard-coded beyond what this plan names as a locked decision.
- A worker merge restarts the worker during the paid run; see step 5.
- Do not create a second PR for the same change.
- Silent `catch` at `:293` hides mistakes such as a wrong embed name: test a real alias hit, and read-only verify the select shape against production with one `core.character_alias` query using PostgREST through the worker client.

## 12. Access and environment

- Machine: hetz (the production VPS). `gh` is authenticated for `u2giants/popdam3`. Supabase read-only SQL is available through the `supabase` MCP (`execute_sql`); if it is unauthorized or hits the old Ohio project, see the memory note on secret and DB access paths. Confirm the project is `qsllyeztdwjgirsysgai`.
- Work in your own git worktree. Test logins: 1Password vault `vibe_coding`, items "PopSG / PopDAM AI tester login" (user role) and `ai-admin@designflow.app` (administrator). See `docs/1password.md`. Never screenshot PopSG Settings -> Setup (it renders the NAS password).
- Local: `npm ci --prefix apps/worker && npm run test --prefix apps/worker`.

## 13. Definition of done, risks, open questions

- [ ] Guard, duplicate fix, tests pushed on PR #731; CI green; merged per step 5; worker at merge SHA.
- [ ] Live proof on #736; STATUS updated; #736 closed.

**Risks:** a genuinely valid character whose name contains "logo" is not linked, the same as the direct path. Rollback: revert the merge. **Uncertain:** when the run ends; the step 5 rule covers it.

## Self-audit

1. *Could a brand-new session execute this without asking?* Yes: sections 3, 5 and 9 name both PR and `main` lines and exact edits. Gap fixed: stale line `:436` corrected to `:431`.
2. *Does it carry all background, including what was ruled out?* Yes: sections 6 and 7, with live row counts.
3. *Is the goal clear enough for judgment calls?* Yes: section 1, one rule whichever route finds the character.
