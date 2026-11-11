---
summary: Issue #737 plan: Tagging: never save Albert as technical designer (#680). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-737
---

# Plan: Review finding: u2giants/popdam3#732 Tagging: never save Albert as technical designer (#680) (u2giants/popdam3#737)
Issue: https://github.com/u2giants/popdam3/issues/737
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Check tagging-run state and confirm the findings on `main` | ⬜ open | |
| 2 | Make `isManagerNotTechnicalDesigner` total and word-based | ⬜ open | |
| 3 | Simplify the call in `applyBatchTagResult` | ⬜ open | |
| 4 | Unit and apply-path tests | ⬜ open | |
| 5 | PR, CI, merge when worker restart is safe, verify deploy | ⬜ open | |
| 6 | Live proof query and close | ⬜ open | |

**Where a fresh session starts:** step 1.

---

## 1. The ultimate goal

Albert is the manager on older tech packs, and the AI misread that line as the technical designer. On November 4, 2026 he ruled that his name comes out of that field. The name was removed from 1,462 files. The goal is that the paid tagging run, or any later run, can never put it back, and that the save can never crash on an odd AI answer. The "real" designer field and everyone else's names must stay untouched.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

PopDAM (https://dam.designflow.app, licensed-art asset manager) and PopSG (https://sg.designflow.app, style-guide library) are POP Creations internal tools used by designers, sales and administrators. Repo `u2giants/popdam3`, default branch `main`. Stack: one React 18 + Vite frontend in `src/` (GHCR image, Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`); Supabase edge functions in `supabase/functions/` (project `qsllyeztdwjgirsysgai`, Virginia; deployed by `.github/workflows/deploy-supabase.yml` on changes to `supabase/functions/**`); a long-running job worker in `apps/worker` on Railway (auto-deploys on every push to `main`, which restarts it); agents on the NAS and Windows machines. Database structure is owned by `popcre/shared-db` (canonical checkout `/worksp/shared-db`); `shared-db/` here is a read-only mirror.

The relevant path: the worker sends a file to the AI, then `applyBatchTagResult` (`apps/worker/src/handlers/ai-tagging.ts:308`) saves tags and fills blank designer fields.

## 3. What triggered this work

PR #732 (**merged** 2026-11-04 at 22:00 UTC, 5:00 PM EST, commit `7562a398`) added the guard. Its advisory Muse review (head `22c40f3d`) filed #737 with four findings: non-total function, unknown passed to a string parameter, a regex that is broader than the person and has an unreachable branch, and no apply-path test. Owner ruling record: #680 comment "Albert ruled Nov 4 that his name comes out of the technical designer field. Done 5:05 PM EST: 1,462 files including retired ones (1,123 live) and 964 style groups", backup key `ALBERT_TECHNICAL_REMOVAL_BACKUP_2026_11...` in `admin_config` (read #680 for the full name).

## 4. Scope

In: the helper, its one call site, tests.

### NOT in this plan
- The `designer_name` field. Albert may legitimately appear there; the ruling covers technical designer only.
- Removing `ALBERT` from `known_designer_first_name` (live has it, and `designer_name` depends on it).
- Other designer rules: [issue-715 plan](issue-715-tag-finish-designer-name-guard.md) owns those; do not touch `isKnownDesigner` (`tag-finish.ts:207-213`).
- Re-cleaning data: live count is 0 (section 5). The PDF rescan write path (`apply_sheet_designers`, shared-db) is not guarded by this helper; step 6 detects any recurrence, and a recurrence is reported on this issue, not fixed here.

## 5. Current state of the code

Checkout `39e428ef`. GitHub `main` had moved to `ef8ca260`, where #724 adds lines to `ai-tagging.ts` near line 149 and to `ai-tagging-scope.test.ts` near line 273, so expect `ai-tagging.ts` lines below to shift by a few; re-grep.
- `apps/worker/src/handlers/tag-finish.ts:215-218`: `isManagerNotTechnicalDesigner(value: string)`, regex `/^(?:manager\s*:\s*)?albert\b/i`.
- `apps/worker/src/handlers/ai-tagging.ts:367-371`: loop; line 370 is the call, safe today only because `isKnownDesigner` narrows first.
- `apps/worker/src/handlers/ai-tagging.ts:258-265`: `knownDesignerFirstNames`, cached 10 minutes in a module variable.
- `apps/worker/src/handlers/tag-finish.test.ts:144-147`: helper-only test.
- `apps/worker/src/handlers/ai-tagging-scope.test.ts:100-132`: `recordingSupabase`, which records update payloads, but its asset fixture (line 103) has no designer columns and every table returns the same `single`.
- Live, read-only, 2026-11-04 about 6:05 PM EST: 0 assets with `technical_designer_name` containing the word Albert; `known_designer_first_name` holds `ALBERT`; `BULK_OPERATIONS["ai-tag-parallel"].status = running`, updated 6:05 PM EST.

**All four findings are still open on `main`.** The guard itself works for the ordinary cases.

## 6. Key findings and root cause

- The non-total signature is a latent crash, not a live one.
- `manager:` is unreachable: `isKnownDesigner` (`tag-finish.ts:210`) rejects `:`.
- **New gap found while planning, not in the review:** the regex is anchored at the start, while `isKnownDesigner` only checks the first name and permits `/`, `&` and spaces. So `Zarit / Albert` and `Zarit & Albert Hazan` pass both checks and would save his name. A word-based check closes it.
- The review's "other Alberts" concern: `known_designer_first_name` is first-name-only, so nothing in the database can tell two Alberts apart, and no other Albert is evidenced.

## 7. Approaches considered and REJECTED

- **Scope to exactly `albert hazan` / `albert`:** "Albert H.", "Albert Hazen" or "Albert (Manager)" would then be saved, which is the failure Albert ruled out. A wrongly blank field costs little; the sheet rescan owns designers anyway.
- **Delete `ALBERT` from the known list:** breaks `designer_name` and needs a data change for a code rule.
- **Exporting `knownDesignerCache` for tests:** use a name that is present in the fake table in the first call instead, and keep the cache private; see gotcha.
- **Only widening the type at the call site with a cast:** hides the problem instead of making the callee safe.

## 8. Design decisions

- **LOCKED (owner ruling, Nov 4, 2026):** Albert never lands in `technical_designer_name`.
- **LOCKED (this plan, reversible; assumption stated):** any standalone word `albert` in the value blocks it, because no other Albert is known. If a real technical designer named Albert is ever hired, narrow the rule. `Alberta`, `Albertson` stay allowed.
- **LOCKED:** a blocked mixed value such as `Zarit / Albert` leaves the field blank rather than editing the string; the model's text is not trustworthy enough to repair.
- **LOCKED:** drop the `manager:` branch; `Manager: Albert` still returns true because the word rule matches it.
- **OPEN:** whether line 370 is reformatted for readability. Keep the diff small.

## 9. The plan

**Step 1. Preflight.** Read-only: `select value->'ai-tag-parallel'->>'status' from admin_config where key='BULK_OPERATIONS'`. Re-grep the lines above. You'll know it worked when you have recorded run state and confirmed the regex is unchanged.

**Step 2. Helper** (`tag-finish.ts:215-218`).
```ts
export function isManagerNotTechnicalDesigner(value: unknown): boolean {
  return typeof value === "string" && /(?<![\p{L}\p{N}])albert(?![\p{L}\p{N}])/iu.test(value);
}
```
Extend the comment to say all Alberts are blocked on purpose and why. You'll know it worked when the unit tests in section 10 pass; `\b` is avoided so accented neighbours do not count as boundaries.

**Step 3. Call site** (`ai-tagging.ts:370`). Behaviour unchanged; the expression now type-checks without relying on narrowing. Depends on step 2. You'll know it worked when `npm run build --prefix apps/worker` passes.

**Step 4. Apply-path test.** In `ai-tagging-scope.test.ts`, add a small local fake rather than altering `recordingSupabase`: `from("assets").single` returns blank designer fields, `from("known_designer_first_name").select` resolves `[{first_name:"ALBERT"},{first_name:"ZARIT"}]`, and `update` payloads are recorded. See the gotcha on the cache. You'll know it worked when the tests in section 10 pass and fail if `key === "technical_designer_name"` is removed.

**Step 5. Land.** PR referencing #737. Worker code on `main` auto-deploys and restarts the worker, and PR #731 says not to merge while the run is active. Rule: if `ai-tag-parallel` is `running`, leave the PR green and unmerged. The current guard already protects the run, so nothing is lost by waiting. Merge when it is no longer running, or sooner if the #680 run owner records on #680 that restart is safe. (#724 reached `main` at 6:03 PM EST and the run was still updating at 6:05 PM EST; that is a hint, not proof, that it tolerates restart.) After merging, confirm the Railway deployment for the merge SHA. You'll know it worked when the deployed commit equals the merge SHA and the worker logs ticks.

**Step 6. Live proof.** After at least one tagging batch on the new build, run the count from section 5 again. You'll know it worked when it is 0. Post the query and time on #737, then close. If the run has ended and no batch ran on this build, leave `- [ ] live proof` on #737 until the next batch.

### Adversarial cases (AI output is external input)

| Value | Hostile case | Test |
|---|---|---|
| `null`, `undefined`, number, object, array | crash on `.trim()` | `a non-text value is not treated as the manager and does not throw` |
| `Albert Hazan`, `ALBERT`, ` albert hazan ` | ordinary | `the manager is not saved as technical designer` (existing) |
| `Manager: Albert` | prefix | `the manager is recognised with a label in front` |
| `Zarit / Albert`, `Zarit & Albert Hazan` | second name | `a shared credit naming the manager is blocked` |
| `Alberta Smith`, `Albertson`, `Dalbert` | lookalike | `names merely containing the letters are allowed` |
| full apply with `technical_designer_name:"Albert Hazan"` | save path | `applying a result never writes the manager as technical designer` |

## 10. Tests required

`tag-finish.test.ts`: the helper rows above. `ai-tagging-scope.test.ts`:
- `applying a result never writes the manager as technical designer`: payload lacks the key.
- `the manager can still fill the designer field`: `designer_name:"Albert Hazan"` is written.
- `another known technical designer is still written`.

Must stay green: `npm run build --prefix apps/worker && npm run test --prefix apps/worker`, and root `npm run test`.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges; Albert does not. Albert is not technical: never ask him to click, type, create a credential or approve. Only business-meaning questions go to him.
- CI (`.github/workflows/ci.yml`): `npm ci && npm run lint && npm run typecheck && npm run test` at root; `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker`; `npm ci --prefix apps/windows-agent && npm test --prefix apps/windows-agent`; `npm run build`. Wait with `bin/ai-pr-wait <pr>` in the background; never a sleep loop. AI reviews are advisory and never block; required checks stay lean.
- Database structure changes never go in this repo; they go through `popcre/shared-db`, claim-first on the existing issue, loading the `shared-db-change` skill. Production database is read-only by default; migrations reach production only through shared-db's automatic promotion workflow.
- Secrets live in 1Password vault `vibe_coding`; reference by vault + item title only, never values.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote human times in EST (America/New_York).
- Live proof is required before an outcome is closed. If it cannot happen yet, leave `- [ ] live proof` on this SAME issue; never open a follow-up issue for it.
- No band-aids, no silent failures, nothing hard-coded beyond what this plan names as a locked decision.
- `knownDesignerCache` is module-level for 10 minutes: a test whose fake returns a real list (even empty) fixes that list for later tests in the same process, while a fake with no `data` is not cached. Put the new tests in a dedicated file (`ai-tagging-designer.test.ts`) if ordering breaks them; `tsx --test` isolates files per process. Choose this if the shared file fails.
- A merge restarts the worker; see step 5.
- Do not ask Albert about other Alberts; the assumption is recorded in section 8.

## 12. Access and environment

- Machine: hetz (the production VPS). `gh` is authenticated for `u2giants/popdam3`. Supabase read-only SQL is available through the `supabase` MCP (`execute_sql`); if it is unauthorized or hits the old Ohio project, see the memory note on secret and DB access paths. Confirm the project is `qsllyeztdwjgirsysgai`.
- Work in your own git worktree. Test logins: 1Password vault `vibe_coding`, items "PopSG / PopDAM AI tester login" (user role) and `ai-admin@designflow.app` (administrator). See `docs/1password.md`. Never screenshot PopSG Settings -> Setup (it renders the NAS password).
- Local: `npm ci --prefix apps/worker && npm run test --prefix apps/worker`. Railway auto-deploys; the Railway MCP may be unavailable on this machine, in which case verify through `gh` deployment status or the worker version recorded in logs.

## 13. Definition of done, risks, open questions

- [ ] Helper, call site, tests committed; PR merged; CI green.
- [ ] Worker deployed at the merge SHA, without disturbing the active run.
- [ ] Live count 0 after a batch on the new build, posted on #737; STATUS updated.

**Risks:** a future real Albert is dropped to blank (accepted, section 8). Rollback: revert the PR. **Uncertain:** whether a restart harms the run; step 5 gives the rule.

## Self-audit

1. *Could a brand-new session execute this without asking?* Yes: sections 5 and 9 give exact code and gates; section 8 settles the name question. Gap fixed: the merge timing rule is explicit in step 5.
2. *Does it carry all background, including what was ruled out?* Yes: sections 3, 6 and 7, including the newly found shared-credit gap.
3. *Is the goal clear enough for judgment calls?* Yes: section 1, and section 4 draws the line at `designer_name`.
