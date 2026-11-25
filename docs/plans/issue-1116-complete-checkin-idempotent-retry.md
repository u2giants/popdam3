---
summary: "Make the server's check-in completion safely repeatable: a retry of an already-saved check-in must succeed whatever the verification setting is now, without stale fields or extra writes."
kind: plan
status: open
read-when: "implementing #1116 (helper-api complete-checkin idempotent retry)"
---

# Issue #1116 — A repeated check-in confirmation always succeeds once the file is saved

Covers [u2giants/popdam3#1116](https://github.com/u2giants/popdam3/issues/1116) (advisory review of PR #1111). Handoff:
[HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).
Companion (desktop side of the same retry): [issue-1087 plan](issue-1087-helper-upload-queue-failure-paths.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Decide retry outcome from stored state | ⬜ open | |
| 2. No asset rewrite / stale fields on retry | ⬜ open | |
| 3. Tests incl. setting flips | ⬜ open | |
| 4. Deploy + live proof | ⬜ open | |

**Fresh session starts at step 1.** Review-fixer labels on #1116 (`fixer-deferred`) are not proof of anything; the code on main still has every finding (checked 2026-11-25 at 787c20b8).

## 1. Ultimate goal

When a designer checks a file in, the Helper keeps retrying the "I'm done, record it" call until the server confirms. If the first call actually saved but the reply got lost, the retry must be answered "yes, it's saved" — never "error" — so the designer is not told their check-in failed when it didn't, and the record stays clean. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch `main`) is POP Creations' licensed-artwork library. The desktop **PopDAM Helper** checks files out/in. The server route is `POST /checkouts/complete-checkin` in the Supabase edge function `supabase/functions/helper-api/index.ts`, deployed to shared project `qsllyeztdwjgirsysgai` by `.github/workflows/deploy-supabase.yml` on merge. Rows live in `public.asset_checkouts` (status values used here: `checkin_queued`, `uploading`, `verifying`, `complete`, `error`) and `public.assets`.

Seafile (Brazil office storage) check-ins can be held in `verifying` until the NAS bridge agent confirms the file arrived; that is controlled by an `admin_config` feature flag read by `isCheckinVerificationEnabled` (`index.ts:39-50`), which ships **off** and may be turned on later.

## 3. What triggered this work

Advisory review of PR #1111 (muse-meta, issue body of #1116):
1. `index.ts:440-452` — the shortcut answers depend on the *current* flag (`useVerification`), not on what was stored. A same-upload retry of a row already `complete` after the flag is turned on returns **409** (`alreadyComplete` requires `!useVerification`); the Helper exhausts retries and reports failure for a durable save. Reverse flip: a row in `verifying` retried with the flag now off is converted to `complete`, keeping stale `verify_deadline_at`, `verify_resolve_at`, `expected_quick_hash`.
2. `index.ts:497-504` — an `alreadyComplete` retry still rewrites `assets.quick_hash/file_size` before answering, adding a failure mode (500) to an already-durable check-in.
3. `complete-checkin.test.ts` — no flag-flip coverage, and the harness slices source between the markers `async function handleCompleteCheckin` and `// Re-drive: the server asked` (`complete-checkin.test.ts:6-10`), which silently breaks if either text changes.

## 4. Scope

In: `handleCompleteCheckin` decision logic and its tests. **NOT in this plan:** turning the verification flag on; bridge-agent verification (`report-checkin-verification`); Helper-side queue (#1087 plan); redrive routes; any shared-db/schema change (none needed — all columns exist).

## 5. Current state of the code (main @ 787c20b8)

`supabase/functions/helper-api/index.ts:411-519` `handleCompleteCheckin`: loads `id, asset_id, status, source_hash, checkin_hash` (line 432); `sameUpload = !!final_hash && checkout.checkin_hash === final_hash` (445); verifying shortcut (446-448); `alreadyComplete` (449); 409 guard (450-452); verification park (463-490); asset update (497-503); complete update (504-517). Tests: `supabase/functions/helper-api/complete-checkin.test.ts` (vitest, executed through root `vitest.config.ts` project `supabase/functions/**/*.{test,spec}.ts`).

## 6. Key findings and root cause

The idempotency check mixes two questions: "was this exact upload already recorded?" (stored state) and "should a *new* check-in use verification?" (current flag). Only the second may depend on the flag. Stored `status` + `checkin_hash` fully answer the first.

## 7. Approaches considered and rejected

- **Store the flag value on the row and compare** — rejected: needs a schema change for no gain; the stored status already says which path was taken.
- **Always return 200 when `sameUpload`** — rejected: a same-hash call against `active`/`error` rows must still be refused (409), because those are not saved check-ins.
- **Keep the source-slicing test harness** — rejected: fragile. Export the handler instead (see step 3).

## 8. Design decisions

Locked (2026-11-25): retry outcome by stored state —
| stored status | same upload? | answer (any flag value) | writes |
|---|---|---|---|
| `complete` | yes | 200 `complete` | none |
| `verifying` | yes | 200 `verifying` | none |
| `checkin_queued` / `uploading` | any | normal first-save path, flag decides verify vs complete | as today |
| `verifying` | no (new hash) | normal path (new upload supersedes) | as today, but clear verify fields when completing |
| anything else | any | 409 as today | none |
When the normal path writes `complete`, it sets `verify_deadline_at`, `verify_resolve_at`, `expected_quick_hash` to `null`.
Open: none.

## 9. The plan

**Step 1 — Stored-state shortcuts (lead-only: decides a production outcome).** In `handleCompleteCheckin`, replace lines 445-452 with: compute `sameUpload`; if `sameUpload && status === "complete"` → `return json({ ok:true, checkout_id, status:"complete" })` before any write; if `sameUpload && status === "verifying"` → return `verifying`; then the existing 409 guard over `["checkin_queued","uploading","verifying"]`. Compute `useVerification` only after the shortcuts. Remove the `alreadyComplete` variable and the `if (!alreadyComplete)` wrapper (504). Verify: step 3 tests.

**Step 2 — Clean completion (lead-only).** In the `complete` update (505-514) add `verify_deadline_at: null, verify_resolve_at: null, expected_quick_hash: null`. Confirm column names against `shared-db/` mirror (`grep -rn verify_resolve_at shared-db | head`). Verify: test asserts nulls.

**Step 3 — Tests (helper-ok).** Export `handleCompleteCheckin` with injectable dependencies: move it into `supabase/functions/helper-api/complete-checkin.ts` exporting `makeCompleteCheckin({ getUserId, serviceClient, isCheckinVerificationEnabled, now })`, imported by `index.ts`; rewrite `complete-checkin.test.ts` to import it (no source slicing). Keep every existing test case and add:
- `retry of a complete row succeeds after verification is turned on, with no writes`
- `retry of a verifying row returns verifying after verification is turned off, with no writes`
- `new upload over a verifying row with verification off completes and clears verify fields`
- `same hash against an active row is still 409`
- `retry of a complete row does not touch assets (assets write failure is not reached)`
Stop-and-ask: if the Deno import map prevents the vitest import (then keep the harness but assert both markers exist and fail loudly). Verify: `npx vitest run supabase/functions/helper-api` green; `deno check supabase/functions/helper-api/index.ts` clean (CI runs Deno checks in deploy-supabase).

**Step 4 — Land and prove (lead-only).** PR → merge → `deploy-supabase.yml` green. Live proof (read-only): find a recent Helper check-in with `select id, status, checked_in_at, verify_deadline_at from public.asset_checkouts where status='complete' order by checked_in_at desc limit 5;` after deploy, and confirm the edge function logs (Supabase dashboard logs / MCP `get_logs` for `helper-api`) show no 409 on `complete-checkin` for a `complete` row since deploy. Post evidence on #1116 (EST times), close it.

## 10. Tests required

The five new cases above plus all existing cases in `complete-checkin.test.ts`. Must stay green: root `npm test`, Deno type check of `helper-api`.

## 11. Constraints, standing rules, gotchas

No schema change; if one ever seems needed it goes through `popcre/shared-db` (never this repo's `supabase/migrations/`). Branch + PR; AI merges; reviews advisory. Do not change the flag. The flag is read per request — tests must cover both values. Sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

`gh` as `u2giants`. Local tests: repo root `npm ci && npx vitest run supabase/functions/helper-api`. Production read needs Supabase MCP / `SUPABASE_ACCESS_TOKEN` from 1Password `vibe_coding` (shared Supabase project item). Never print values.

## 13. Definition of done, risks, open questions

Done: steps 1-3 merged, CI + deploy-supabase green, deployed function matches merge SHA, live check posted, #1116 closed, STATUS updated with PR and run ids. Risk: a client that relied on 409 for complete rows — none known (only the Helper calls this). Rollback: revert the PR; deploy re-runs. Open: none.

## Self-audit

1. Executable without questions? Yes — §8 table fixes every outcome; §9 names lines/files/tests; §12 commands.
2. All background carried? Yes — §3 has all three findings, §7 the rejected options.
3. Goal clear? Yes — §1: a saved check-in is always confirmed; that settles any edge not in the table.

## Lead launch prompt

```
Read docs/plans/issue-1116-complete-checkin-idempotent-retry.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do steps 1, 2, 4. Hand step 3 (test extraction and cases) to your helper after step 1-2 are on your branch.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring back the step's stop-and-ask trigger; taken back after 30 minutes stuck.
You verify yourself: vitest for helper-api, deno check, deploy-supabase run, production read-only check.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
