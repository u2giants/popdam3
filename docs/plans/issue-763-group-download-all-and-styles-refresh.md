---
summary: Issue #763 plan: style-group "Download all" must open every file (no token expiry race, no all-or-nothing) and Styles cell-save refresh must never throw unhandled. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-763, Download all, checkout-batch, Helper batch checkout, StylesPage refresh
---

# Plan: "Download all" opens every file, and Styles edits never fail silently (u2giants/popdam3#763)

Issue: https://github.com/u2giants/popdam3/issues/763 (review finding on merged PR u2giants/popdam3#761)
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md)
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS — 2026-11-25

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Finding 1 (test imports Deno module into app typecheck) | ✅ already fixed on main | `src/test/export-pagination.test.ts:2` now imports the dependency-free `supabase/functions/_shared/export-pagination.ts` (no imports at all); re-check: `grep -n import supabase/functions/_shared/export-pagination.ts` prints nothing |
| 1 | Helper: claim every batch token before any file copy starts | ⬜ open | — |
| 2 | Helper: tests for claim-first batch | ⬜ open | — |
| 3 | Web: "Download all" launches the files it could get tokens for and reports the rest | ⬜ open | — |
| 4 | Web: StylesPage `onSettled` refresh failure shows a toast, never an unhandled rejection | ⬜ open | — |
| 5 | Web tests for steps 3–4 | ⬜ open | — |
| 6 | PR, CI, merge, Helper release, deployed SHA verified | ⬜ open | — |
| 7 | Live proof (Download all on a 15+ file group; Styles edit with refresh failure) | ⬜ open | — |

A fresh session starts at step 1.

## Part 1 — Why

### 1. The ultimate goal
When a designer clicks **Download all** on a style group, **every file in that
group opens on their computer** through PopDAM Helper — including big groups of
large Photoshop/Illustrator files that take minutes to copy — and if one file
can't be opened (locked by a colleague, deleted), the others still open and the
designer is told which one failed. Separately, when someone edits a cell on the
**Styles** page and the follow-up refresh of that row fails, they see a clear
message instead of the page silently showing stale data.

*If a step conflicts with this goal, the goal wins — stop and flag it.*

### 2. What this application is
PopDAM (repo `u2giants/popdam3`, release branch `main`) is POP Creations'
internal Digital Asset Manager for licensed product art. Web app: React/Vite in
`src/`, served at https://dam.designflow.app. Back end: Supabase edge functions
in `supabase/functions/` (shared Postgres project `qsllyeztdwjgirsysgai`).
**PopDAM Helper** (`apps/popdam-helper/`) is an Electron desktop app on each
designer's Windows/Mac computer; the web app hands it work through
`popdam://…` links. "Checkout" = Helper copies the NAS/SeaDrive file into a
private workspace, takes a server lock so nobody else edits it, and opens it.

### 3. What triggered this work
The advisory AI reviewer on PR #761 ("Fix multi-file checkout, stable exports
and individual Styles refresh") raised four findings; the fixer deferred them
because the PR was closed. Finding 1 is fixed on main (STATUS row 0). Findings
2–4 are still true on `origin/main` `787c20b8` (verified 2026-11-25):

- **Finding 2 (medium) — token expiry race.** `StyleGroupDetailPanel.tsx:371-393`
  (`handleDownloadAll`) mints up to 50 one-time checkout tokens in a burst, then
  opens `popdam://checkout-batch?tokens=a,b,c`. Each token expires 5 minutes
  after creation (`supabase/functions/helper-api/index.ts:221`). The Helper
  (`apps/popdam-helper/src/shared/checkoutBatch.ts:9-16`) runs
  `checkout(token)` one at a time, and `checkout()`
  (`apps/popdam-helper/src/main/checkoutManager.ts:123-156`) does the token
  claim **and** the whole file copy before returning. So token N is only
  claimed after files 1..N-1 have fully copied; with 15 files × 20–30 s the
  later tokens are past 5 minutes and fail "Token expired"
  (`helper-api/index.ts:263`).
- **Finding 3 (minor) — all-or-nothing.** `handleDownloadAll` throws on the
  first failed token (`StyleGroupDetailPanel.tsx:383-385`), e.g. a 409 "checked
  out by another user" (`helper-api/index.ts:214-216`), so zero files open.
- **Finding 4 (minor) — unhandled rejection.** `src/pages/StylesPage.tsx:298-301`
  `onSettled` does `await refreshEditedRow(...)` with no catch; the realtime
  path at `StylesPage.tsx:178-180` already catches and toasts.

Reproduce finding 2: open a style group with ≥15 large files, click Download
all, watch the Helper: later files report "Token expired". Reproduce 3: have a
colleague check out one file of a group, then click Download all: nothing opens.

### 4. Scope
In: Helper batch flow (claim-first), the web `handleDownloadAll` loop, the
StylesPage `onSettled` catch, their tests, a Helper release.
**NOT in this plan:** changing token lifetime or the `helper_tokens` table
(shared DB — would need `popcre/shared-db`); the 50-file cap; single-file
checkout; check-in; any Styles page behaviour other than the refresh catch;
finding 1 (done).

## Part 2 — What we already know

### 5. Current state of the code
- `apps/popdam-helper/src/main/checkoutManager.ts:123-156` `checkout(token, assetId?)`:
  calls `apiStartCheckout` (server consumes token + creates lock, returns
  `checkout_id, asset, root_mappings, open_after_checkout`), then
  `resolveCopyAndOpen(...)`; on copy failure it releases the lock with
  `apiDiscard(checkout_id)` and rethrows. This release-on-failure contract
  must be kept.
- `apps/popdam-helper/src/shared/checkoutBatch.ts` — `parseCheckoutBatch`
  (≤50 unique 32-hex tokens) and `checkoutBatch(tokens, checkout)` (serial,
  collects failures, throws one summary error).
- `apps/popdam-helper/src/main/protocol.ts:83-85` calls
  `checkoutBatch(link.tokens ?? [], checkout)`.
- Existing test: `src/test/helper-checkout-batch.test.ts` (root vitest).
- Helper version `apps/popdam-helper/package.json` = `1.4.18`; released by
  `.github/workflows/publish-popdam-helper.yml` (GitHub Releases, unsigned
  installers — intentional).
- Web: `handleDownloadAll` at `src/components/library/StyleGroupDetailPanel.tsx:371-393`.
- Nothing for this issue is started; no branch exists.

### 6. Key findings and root cause
Root cause of finding 2: claiming the token (fast API call) and copying the
file (slow) are fused inside one `checkout()` call, and the batch runs them
serially. The server-side claim is the only step that checks expiry, so if
all claims happen first (seconds total), expiry can't be hit no matter how long
the copies take.

### 7. Approaches considered and rejected
- **Longer token expiry for batch tokens** — needs a shared-DB/edge-function
  contract change and weakens a security control (tokens live in URLs). Rejected.
- **Helper mints its own tokens per file** — Helper would need a new
  token-creation path and the web would have to pass asset IDs instead of
  tokens; larger change, new auth surface. Rejected.
- **Run copies in parallel** — would hammer NAS/SeaDrive and still race on very
  large groups. Rejected.

### 8. Design decisions
- **Locked:** split `checkout` into `claimCheckout(token, assetId?)` (calls
  `apiStartCheckout`, returns the response) and `completeCheckout(claim)`
  (runs `resolveCopyAndOpen` with the existing release-on-failure). `checkout()`
  keeps its signature and becomes `completeCheckout(await claimCheckout(...))`
  so single-file behaviour is unchanged.
- **Locked:** batch = phase A claim all tokens serially (collect failures),
  then phase B complete each successful claim serially (collect failures),
  then one summary error naming the count and first message (same shape as
  today).
- **Locked:** web Download all keeps going past failed tokens, launches the
  successful ones, and shows one toast listing how many files could not be
  prepared plus the first reason. If zero tokens succeed, show only the error.
- **Locked:** StylesPage `onSettled` catches and shows the same toast text as
  the realtime path ("Could not refresh the changed row" / "Refresh to load
  its latest values.").
- **Open:** wording of the web partial-failure toast — must say how many files
  were skipped and why (first reason).

## Part 3 — How to build it

### 9. Steps

**Step 1 — Helper claim-first batch.** `lead-only` (changes how server locks
are taken; a mistake could leave orphan locks, which no unit gate fully catches).
- In `apps/popdam-helper/src/main/checkoutManager.ts` export
  `claimCheckout` and `completeCheckout` per §8; keep `checkout` as the
  composition.
- In `apps/popdam-helper/src/shared/checkoutBatch.ts` change
  `checkoutBatch(tokens, claim, complete)`: phase A `for` tokens → `await claim(t)`
  (catch → push failure), phase B `for` claims → `await complete(c)` (catch →
  push failure; `completeCheckout` already released the lock). Keep the
  "attempt every file" comment and the summary error.
- `protocol.ts:84` passes `claimCheckout, completeCheckout`.
- Behaviour when done: all server locks for the batch exist within seconds of
  the link opening; copies then proceed one by one; a failed copy releases its
  own lock only.
- Gate: you'll know it worked when step 2 tests pass and a manual run (step 7)
  shows no "Token expired".

**Step 2 — Helper tests.** `helper-ok` (files and cases named). Stop-and-ask:
if `checkoutBatch` cannot be tested without importing Electron, bring it back.
Extend `src/test/helper-checkout-batch.test.ts`:
- `claims every token before completing any` (record call order: all `claim`
  calls precede the first `complete`).
- `a failed claim does not stop other files` (one claim rejects → others
  complete; error says "1 file(s)").
- `a failed completion does not stop later completions`.
- existing parse tests stay green.
Gate: `npx vitest run src/test/helper-checkout-batch.test.ts` green.

**Step 3 — Web partial success.** `helper-ok`. Stop-and-ask: if the token
response shape differs from `{ ok, token, error }`.
In `handleDownloadAll` (`StyleGroupDetailPanel.tsx:371-393`): per asset,
try/catch around the invoke; push successes to `tokens`, failures to
`failures: {filename, reason}[]` (read the 409 message from `data?.error` /
`error.message`). If `tokens.length` → open the link and `toast("Opening N
files in PopDAM Helper…")`; if `failures.length` → `toast.warning(...)` with
count and first `filename: reason`. If no tokens → `toast.error` only.
Gate: step 5 tests.

**Step 4 — StylesPage catch.** `helper-ok`. Stop-and-ask: none expected.
`src/pages/StylesPage.tsx:298-301`: wrap `await refreshEditedRow(...)` in
try/catch that calls the same `toast.error` as line 179; keep the audit
invalidation running in both cases. Gate: step 5 test.

**Step 5 — Web tests.** `helper-ok`. Stop-and-ask: if the panel test harness
in `StyleGroupDetailPanel.mockup.test.tsx` can't mock `supabase.functions.invoke`.
- New `src/components/library/StyleGroupDetailPanel.downloadAll.test.tsx`
  (copy mocks from `StyleGroupDetailPanel.mockup.test.tsx`): `launches the
  files whose tokens succeeded when one is locked` (3 assets, 2nd returns
  409 → link contains 2 tokens, warning toast mentions 1 file);
  `shows only an error when no token succeeds`.
- `src/test/styles-page-refresh-catch.test.ts`: source-level assertion that
  the `onSettled` block wraps `refreshEditedRow` in try/catch (pattern used
  by `src/test/erp-canonical-cutover.test.ts`), or a render test if StylesPage
  is already rendered in an existing test.
Gate: `npx vitest run` on the new files green.

**Step 6 — Land.** `lead-only` (merge + release). Branch
`claude/issue-763-download-all`, PR to `main`, CI green, AI merges. Bump
`apps/popdam-helper/package.json` patch version so
`publish-popdam-helper.yml` releases it; confirm the release assets exist on
GitHub Releases. Confirm Coolify serves the merge SHA (`docs/deployment.md` →
stale-site check: `https://dam.designflow.app/version.json`).

**Step 7 — Live proof.** `lead-only` (live judgment). On a Windows machine
with the new Helper: Download all on a group with ≥15 files totalling >5
minutes of copy time → every file opens, Helper log has no "Token expired".
Then have one file checked out by another test user → Download all opens the
rest and the warning toast names the locked file. Screenshot both toasts and
the Helper activity list; save under `docs/verification/issue-763/` and cite
in STATUS. Styles: no live trigger exists for a refresh failure — the unit
test is the proof; note that in STATUS.

### 10. Tests required
New: the five named tests above. Must stay green: `npm test`, `npm run
typecheck`, `npm run lint`, and the Helper's own `npm test` in
`apps/popdam-helper` (vitest `*.vitest.ts`).

### 11. Constraints and gotchas
- Never push to `main`; branch + PR; AI merges; reviews advisory.
- No shared-DB change; `helper_tokens` and expiry stay as is.
- Keep `checkout()`'s lock-release-on-failure (comment at
  `checkoutManager.ts:138-142` explains why: orphan locks stick the web UI on
  "Check In").
- Tokens are secrets in URLs: never log them; `redactDeepLink` already covers
  `tokens=` — keep it.
- Helper installers stay unsigned (owner ruling) — don't add signing.
- UI change → visual verification is required (step 7 screenshots).

### 12. Access and environment
`gh` authenticated as `u2giants`. Local web: `npm run dev` →
http://localhost:8080 (`docs/development.md`). Helper dev: `cd
apps/popdam-helper && npm run dev`. Test logins: 1Password vault
`vibe_coding` (search "PopDAM test user"); never paste values.

### 13. Definition of done, risks, open questions
Done: steps 1–7 ✅ with evidence; PR merged; Helper release published; live
SHA verified; issue #763 commented with proof and closed.
Risks: a claimed-but-never-completed lock if the Helper crashes between phases
— same exposure as today's single checkout mid-copy; existing stale-lock
handling covers it. Rollback: revert the PR; previous Helper release stays
downloadable.
Open: none needing the owner.

## Self-audit
1. Fresh session can execute without asking? Yes — §5 gives exact files/lines,
   §8 locks the design, §9 gives each edit and gate.
2. All background and ruled-out options carried? Yes — §3 restates every
   finding, §7 lists three rejected approaches with reasons.
3. Goal clear enough for judgment calls? Yes — §1: every file opens, failures
   named; claim-first is a means, not the goal.

## Lead launch prompt
```
You are the lead for u2giants/popdam3 issue #763. Read AGENTS.md, then
docs/plans/issue-763-group-download-all-and-styles-refresh.md (STATUS first).
Do steps 1, 6 and 7 yourself. Hand steps 2, 3, 4, 5 to your helper in that
order after step 1 lands locally. Your helper is your own tool's smaller
model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash
for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design
decisions, never merges or posts, asks you when a step's stop-and-ask
trigger fires, and is taken back after 30 minutes stuck. You run every gate
yourself, update STATUS with artifacts, merge, release the Helper, and do
live proof with screenshots.
```
