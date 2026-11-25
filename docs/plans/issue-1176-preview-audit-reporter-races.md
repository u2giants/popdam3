---
summary: Issue #1176 plan: make the compat-audit preview reporter never lose a flag recorded during a write, and keep the newest thumbnail and path when the server merges flags. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1176, or editing packages/agent-common/src/compat-preview-reporter.ts or supabase/functions/_shared/compat-audit-preview-merge.ts
---

# Plan: Compat-audit preview reporter — snapshot writes, newest-wins merge (u2giants/popdam3#1176)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Snapshot pending flags before each write | ⬜ open | — |
| 2 Server merge keeps newest fields per id | ⬜ open | — |
| 3 Tests for concurrent record + newest-wins | ⬜ open | — |
| 4 Sync agent copies, ship, live proof | ⬜ open | — |

Fresh session starts at step 1 (planned 2026-11-25; nothing implemented).

## 1. Ultimate goal

When the team runs a "compatibility audit preview" (a scan that lists artwork files the system
cannot render, with thumbnails, so someone can review them), every flagged file must appear exactly
once in the list, with its current thumbnail and folder path — no file silently missing because it
was found while the previous update was still being sent.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, `main`) is POP Creations' Digital Asset Manager. Two on-site agents scan
files: the **bridge agent** (`apps/bridge-agent/`, Docker on the Synology NAS) and the **Windows agent**
(`apps/windows-agent/`, render machine). Both use shared code from `packages/agent-common/src/`,
copied into each agent's `src/common/` by `node packages/agent-common/sync.mjs` (run by each agent's
`prebuild`/`pretest`; the copies are generated — never edit them). A compat audit preview posts
progress and completion to the `agent-api` edge function (`supabase/functions/agent-api/index.ts`,
~lines 4859 and 4893), which merges flags into the stored list with
`supabase/functions/_shared/compat-audit-preview-merge.ts`.

## 3. What triggered this work

Advisory review of merged PR #1171 ("preview audits send only new flags per batch", fixing #1104;
head `b8b66da3`) opened #1176; the fixer deferred it:
1. `compat-preview-reporter.ts:43-46` `reportProgress` passes the live `this.pending` array, then
   slices by `batch.length` after `await` — a flag recorded meanwhile grows `batch.length` too and is dropped.
2. `:53-55` `finish` passes the live array then sets `this.pending = []` — a concurrent `record()` is lost.
3. `compat-audit-preview-merge.ts:12-18` keeps the first entry per id, ignoring updated
   `thumbnail_url`/`relative_path`.
The fixer noted current agents await writes sequentially, so (1)-(2) are latent; they must still be
fixed because the class promises exactly-once delivery and any future concurrent caller breaks it.

## 4. Scope

In: the two files above, their tests, regenerated agent copies, agent version bump/release as needed.
NOT in this plan: changing the audit itself, the UI for reviewing flags, the server trigger at
`supabase/functions/_shared/admin-handlers/agent-handlers.ts:1086-1103` (reviewer confirmed correct),
backward compatibility with full-list senders (already preserved).

## 5. Current state (origin/main `787c20b8`)

- `packages/agent-common/src/compat-preview-reporter.ts`: `pending` array; `record()` pushes;
  `reportProgress(scanned)` = `const batch = this.pending; await progress(scanned, batch); this.pending = this.pending.slice(batch.length)`; `finish` = `await complete(scanned, this.pending, error); this.pending = []`.
- Tests: `packages/agent-common/src/compat-preview-reporter.test.ts` (node:test; three tests, run from
  `apps/bridge-agent` `npm test`).
- `supabase/functions/_shared/compat-audit-preview-merge.ts`: first-wins by `id`; test
  `compat-audit-preview-merge.test.ts` (Vitest project `supabase/functions/**/*.test.ts`, root `npm run test`).
- Callers: `apps/bridge-agent/src/handlers/compat-audit.ts`, `apps/windows-agent/src/compat-audit.ts`.

## 6. Key findings

- Fix is a snapshot: `const batch = this.pending.slice()` (or capture `const n = this.pending.length`)
  before `await`, then remove exactly the first `n` entries on success. For `finish`, take
  `const batch = this.pending; this.pending = []` **before** the await; on failure put `batch` back in
  front (`this.pending = [...batch, ...this.pending]`) and rethrow, preserving "failed write keeps flags pending".
- Newest-wins: iterate stored then incoming; on a repeated id, replace the entry's fields but keep its
  original position (so list order stays stable).

## 7. Approaches rejected

- **Mutex around record/write** — rejected: heavier than a snapshot and `record()` is synchronous.
- **Sending the full list every time** — rejected: that is what #1104/#1171 removed (payload growth).
- **Last-wins by appending a duplicate** — rejected: breaks dedup.

## 8. Design decisions

- LOCKED: exactly-once per id delivery; failed writes keep flags pending.
- LOCKED (2026-11-25, this plan): server merge is newest-wins for payload fields, first position kept.
- OPEN: whether agents need a version bump now — bridge agent ships only with an
  `apps/bridge-agent/package.json` version bump; since callers are sequential, a bump is optional;
  do bump bridge and Windows agent patch versions so the shared copy matches source (judgment: if
  another session is mid-release, ride its release instead and note it).

## 9. Steps

1. **Snapshot writes** — `helper-ok` (exact behaviour in §6). Edit `reportProgress` and `finish`.
   Stop-and-ask: any caller relies on `finish` leaving flags pending after failure in a different way.
   Gate: step 3 tests pass.
2. **Newest-wins merge** — `helper-ok`. Edit `mergeCompatAuditFlagged` to use a `Map<string, index>`
   and overwrite fields on a repeat id. Update the doc comment. Gate: step 3 tests pass; existing
   tests still pass (retry dedup).
3. **Tests** — `helper-ok`. Add to `compat-preview-reporter.test.ts`: "a flag recorded during an
   in-flight progress write is sent on the next write" (progress stub that calls `record()` before
   resolving), "a flag recorded during finish is not lost" (assert `undelivered === 1` after),
   "a failed finish keeps its flags pending". Add to `compat-audit-preview-merge.test.ts`:
   "a repeated id takes the newest thumbnail_url and relative_path, keeping its position".
   Gate: `npm test --prefix apps/bridge-agent` and `npx vitest run supabase/functions/_shared/compat-audit-preview-merge.test.ts` pass, and the new tests fail on the old code.
4. **Sync, ship, live proof** — `lead-only` (release + live judgment). Run `npm run pretest` in both
   agents (regenerates `src/common/`), commit only if the generated copies are tracked (check `git status`).
   Merge PR → `deploy-supabase.yml` deploys `agent-api`; bump agent versions per §8 → bridge
   publish + `AGENT_UPDATE_REQUEST`, Windows agent release. Live: run a compat audit preview from the
   app's admin screen (or confirm the next scheduled one) and check the stored flag count equals the
   distinct flagged ids reported in the agent log. Gate: deploy run ids + the count comparison recorded
   in STATUS row 4 and on #1176.

Order: 1, 2 parallel → 3 → one PR → 4.

## 10. Tests required

The four new tests in step 3. Green: `npm run test` (root Vitest), `npm test --prefix apps/bridge-agent`,
`npm test --prefix apps/windows-agent`, `npm run lint`, `npm run typecheck`.

## 11. Constraints and gotchas

- Branch + PR; AI merges after required checks; reviews advisory; no wait over 30 minutes; never ask
  Albert to approve.
- Never edit `apps/*/src/common/` by hand — regenerate.
- Bridge agent update self-updater is fragile (`docs/KNOWN_QUIRKS.md` #26); use the normal publish +
  update-request path only.
- No database schema change is needed; if one seems needed, stop — it belongs in `popcre/shared-db`.

## 12. Access and environment

`gh` as `u2giants`. App: `https://dam.designflow.app` (Albert's signed-in Chrome). Supabase MCP for
read-only checks of the stored preview list (`admin_config` / audit tables — find the key in
`agent-api/index.ts` near line 4859).

## 13. Definition of done, risks, open questions

Done: rows 1-4 cite artifacts; PR merged green; edge function deployed; agents released or ride-along
noted; live count matches; #1176 closed with evidence. Risk: newest-wins changes stored order — kept
stable by design. Open: version bump timing (§8).

## Self-audit

1. Executable without questions? Yes — §5 exact code, §6 exact fix, §9 gates.
2. Background/rejected paths? Yes — §3, §7.
3. Goal steers? Yes — §1.

## Lead launch prompt

```
Read docs/plans/issue-1176-preview-audit-reporter-races.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead: hand steps 1, 2 and then 3 to your helper; do step 4 yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes or
posts; bring stop-and-ask triggers to you; take a step back after 30 minutes stuck.
Verify every gate, open one PR, merge when required checks pass (reviews advisory), release and
live-prove, update STATUS, close #1176 with evidence.
```
