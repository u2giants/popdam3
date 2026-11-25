---
summary: Issue #1208 plan: make the backend string validator test prove that both import paths run the same functions, and add the missing undefined-value and named cases from cleanup 18. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1208, or editing supabase/functions/_shared/validators.ts, validators.test.ts or the admin-utils re-export
---

# Plan: Make the string-validator test prove what it claims (u2giants/popdam3#1208)

Issue: https://github.com/u2giants/popdam3/issues/1208
Handoff: [HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md](../../HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md)
Parent plan: [issue-1200-18-backend-string-validators.md](issue-1200-18-backend-string-validators.md) (cleanup 18 of #1200; delivered and live-verified — this is its test follow-up).
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch | ⬜ open | |
| 2 | Identity assertion + explained mocks in `validators.test.ts` | ⬜ open | file on `origin/main` `787c20b8` |
| 3 | Add `{ value: undefined }` and the four named cases | ⬜ open | |
| 4 | PR, merge, close #1208 | ⬜ open | |

Review finding 4 (cleanup-18 STATUS overstated completion) is **moot**: that plan's Step 4 now records live admin and Windows-agent route proof (edge deploy run 44591473524). Nothing to do for it.

**Where a fresh session starts:** Step 1. Test-only change; no deploy needed.

## 1. The ultimate goal

Cleanup 18 of #1200 merged two copies of the backend "is this text field present?" checks into one file, `supabase/functions/_shared/validators.ts`, and left the old import path (`admin-utils.ts`) re-exporting them. Its test is supposed to prove that **both** import paths give the same answers. A reviewer showed the test cannot fail if the re-export is broken or replaced by a different function, so the promise is unproven. When this plan is done, the test fails the moment the admin path stops pointing at the shared functions, and it carries the exact cases cleanup 18 promised.

Nothing a user sees changes; no production code changes. **If a step conflicts with this goal, the goal wins — stop and flag it.** If a new case fails against current code, that is a real behaviour finding: do not change `validators.ts` to make it pass; bring it to #1208.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager (https://dam.designflow.app) with the PopSG style-guide mode, repo `u2giants/popdam3`, branch `main`. Backend entry points are Supabase edge functions in Deno (`supabase/functions/`, project `qsllyeztdwjgirsysgai`): `admin-api` (web admin screens) and `agent-api` (NAS bridge and Windows render agents). Both parse JSON request bodies and use `requireString` / `optionalString` / `requireExactString` from `_shared/validators.ts`. Edge-function unit tests run under the root Vitest config's `supabase/functions/**/*.{test,spec}.ts` project (`vitest.config.ts:29`). Read `AGENTS.md` first.

## 3. What triggered this work

The advisory reviewer (DeepSeek via OpenRouter) reviewed merged PR #1206 ("Reuse backend string validators (#1200 item 18)", head `f36b52d6`) and opened #1208:
1. `validators.test.ts:5-6` mocks only `service-client.ts` and `http.ts`; the cases therefore run the real functions under both names, and nothing checks the admin name is the same function — a broken or wrapped re-export would still pass.
2. `{ value: undefined }` is never tested for `requireString`.
3. The case names `backend-string-validators_case_1..4` from cleanup 18 §10 appear nowhere.
4. (Informational) STATUS wording — now moot.

The fixer bot deferred it ("source moved").

## 4. Scope

**In:** `supabase/functions/_shared/validators.test.ts` only (plus STATUS lines in this plan).

**NOT in this plan:** any change to `validators.ts`, `admin-utils.ts`, or callers; changing error messages or codes (cleanup 18 locked "the original error codes are intentionally preserved"); other #1200 cleanups.

## 5. Current state of the code (verified 2026-11-25 on `origin/main` `787c20b8`)

- `supabase/functions/_shared/validators.ts:8-14` `requireString` — throws `Missing required string field: <key>` unless a non-blank string; returns trimmed. `requireExactString` (`:20-26`) keeps whitespace. `optionalString` (`:28-…`) returns `null` for absent/null/blank, throws `Field <key> must be a string` for non-strings, else trimmed.
- `supabase/functions/_shared/admin-utils.ts:17` — `export { optionalString, requireString } from "./validators.ts";`. `admin-utils.ts` also imports `./service-client.ts` and `./http.ts` (`:8-9`), which pull a remote `https://` Supabase import Vitest cannot load.
- `supabase/functions/_shared/validators.test.ts`: imports `* as admin from "./admin-utils"` and `* as agent from "./validators"`; `vi.mock("./service-client.ts")` and `vi.mock("./http.ts")` at `:5-6`; a `describe.each` over both modules with cases `{}`, `{value:7}`, `{value:"   "}` (required), `{}`, `{value:null}`, `{value:"   "}` (optional), non-string optional, padded; and a `requireExactString` block.

## 6. Key findings

1. The two mocks are **necessary** — without them importing `admin-utils.ts` fails on the remote import. The reviewer's "remove both mocks" fix would break the file. What is missing is an identity check: `expect(admin.requireString).toBe(agent.requireString)` (and the same for `optionalString`). That fails if the re-export is removed, renamed, or replaced by a wrapper.
2. With identity proven, the `describe.each` over two names is redundant but harmless; keep it (cheap, and it still exercises the admin import path end-to-end).

## 7. Approaches considered and rejected

- **Remove both `vi.mock` calls** (reviewer's suggestion). Rejected: §6.1 — the admin import would fail to load.
- **Mock `./validators.ts` and assert the admin path calls the mock.** Rejected: more machinery than a `toBe` identity check, which proves the same thing directly.

## 8. Design decisions

- **LOCKED (2026-11-19, cleanup 18):** no behaviour or error-message change.
- **LOCKED (2026-11-25):** identity assertion via `toBe`; mocks stay with a comment saying why.
- **OPEN:** whether case names are in `it` titles or a table column — criterion: `grep -n "backend-string-validators_case_[1-4]" validators.test.ts` finds all four.

## 9. The plan

**Step 1 — Worktree/branch.** `git worktree add <path> -b claude/1208-validator-test origin/main`; `npm ci`. Gate: `npx vitest run supabase/functions/_shared/validators.test.ts` passes on the untouched tree. `helper-ok`. Stop-and-ask: it fails before edits.

**Step 2 — Identity + mock comment.** Above the two `vi.mock` lines add: "admin-utils imports service-client/http, which load a remote module Vitest cannot resolve; these mocks only let the admin path import." Add `it("admin-utils re-exports the shared validator functions themselves", () => { expect(admin.requireString).toBe(agent.requireString); expect(admin.optionalString).toBe(agent.optionalString); })`. Gate: the test passes; temporarily changing `admin-utils.ts:17` to export a wrapper (`export const requireString = (o, k) => v.requireString(o, k)`) makes it fail — revert that probe and do not commit it. `lead-only` — the mutation probe is the proof this step exists for.

**Step 3 — Missing and named cases.** Add `{ value: undefined }` to the required-value rejection list. Add four `it` titles (or `it.each` rows) named `backend-string-validators_case_1` (missing key: required throws, optional → null), `_case_2` (non-string: required throws `Missing required string field: value`, optional throws `Field value must be a string`), `_case_3` (whitespace-only: required throws, optional → null), `_case_4` (padded `"  example  "`: both → `"example"`), each run against both import paths. Gate: `grep -c "backend-string-validators_case_" supabase/functions/_shared/validators.test.ts` ≥ 4; file passes. `helper-ok` — exact cases given. Stop-and-ask: any case fails.

**Step 4 — PR, merge, close.** Verified identity; stage only the test file and this plan; PR to `main` with attribution; wait (`bin/ai-pr-wait` background or `gh pr checks --watch`); merge on required checks. Comment on #1208 with the merge SHA and the Step 2 mutation-probe result (failed as expected), signed; close it; update STATUS here and add a one-line pointer in cleanup 18's plan. `lead-only`.

## 10. Tests required

| Test | Behaviour |
|---|---|
| "admin-utils re-exports the shared validator functions themselves" (new) | `toBe` identity for `requireString` and `optionalString` |
| `backend-string-validators_case_1..4` (new) | the four outcomes in Step 3 on both paths |
| existing cases in `validators.test.ts` | unchanged, green |
| root `npm test` | green |

Adversarial cases: the inputs are request-body values. Covered hostile shapes: missing key, explicit `undefined`, `null`, number, whitespace-only, padded. All named above.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; the AI merges; reviews advisory.
- Do not touch production validator code; cleanup 18 preserved exact error codes on purpose.
- Vitest cannot load `https://` imports — keep the mocks.
- Sign GitHub posts ("Posted by <tool> chat (<id>) on <host>"); EST times.

## 12. Access and environment

`gh` as `u2giants`. Local: `npm ci`, `npx vitest run supabase/functions/_shared/validators.test.ts`. No live system access needed (test-only).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Identity test and four named cases on `main`, green in CI; PR merged.
- [ ] Mutation probe result recorded on #1208; #1208 closed; STATUS updated.

Risks: none at runtime. Rollback: revert. Live proof: not applicable (no deployed change); the mutation probe is the acceptance evidence.

Open questions: none.

## Self-audit

1. **Fresh session could execute without asking?** Yes — §5 gives the exact file state, §9 the exact assertions, case list and mutation probe, §12 the command.
2. **All background carried, including what was ruled out?** Yes — §6.1 records why the reviewer's "remove the mocks" fix would break the file; §7 records both rejected options; STATUS records finding 4 as moot with evidence.
3. **Goal clear enough to steer by?** Yes — §1: the test must fail if the admin path stops being the shared function; never edit production code to pass.

## Lead launch prompt

```
Read docs/plans/issue-1208-validator-test-proof.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 2 and 4 yourself (including the mutation probe). Hand Steps 1 and 3 to your
helper. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for
Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules: return
finished work or an evidenced blocker; make no design decisions; never merge or post; bring back any failing
case; if stuck 30 minutes, the lead takes the step back. Rules sheet:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Lead checks: run the test file yourself and repeat the mutation probe before merging.
```
