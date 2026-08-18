---
issue: 92
status: OPEN
owner: codex/openrouter-batch-recovery-plan-92
---

# HANDOFF — OpenRouter batch restart recovery (2026-08-18 14:09 UTC, hetz/codex)

Plan: [`../plan_openrouter_batch_restart_recovery.md`](../plan_openrouter_batch_restart_recovery.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None. Albert asked for this plan and Grok 4.6 review on 2026-08-18. Do not re-ask whether restart safety is worthwhile.

Already settled: use existing operation JSON unless it exceeds the measured 100 KB bound; pending is not failure; persist IDs/mapping so a normal Railway restart reconnects. A backward-compatible compare-and-swap/lease enhancement to the canonical shared-db updater is in scope and must land through `/worksp/shared-db` first unless inspection proves equivalent protection already exists.

The §0 sweep of §§1-9 found no other blocking, recoverable or unrelated owner decision.

## 1. What this application is

PopDAM is POP Creations' internal licensed-art digital asset manager at `https://dam.designflow.app`; the same app serves PopSG at `https://sg.designflow.app`. Node/TypeScript worker `apps/worker/` runs on Railway and processes state in Supabase project `qsllyeztdwjgirsysgai`. Repo `u2giants/popdam3`, path `/worksp/popdam`, branch `main`.

## 2. What we set out to do this session, and why

Write a zero-context plan to make OpenRouter Batch API tagging restart-safe and review it with Grok 4.6. `c1ac8443` uses real batches but retains batch ID/mapping only in Railway memory, risking abandoned billed work and duplicate resubmission after restart. This is planning only; implementation is the linked plan.

## 3. Current state — what is true right now

- `57b60673` guardrail lookup and `c1ac8443` Batch API support are pushed/deployed. CI `32144096107`; Railway deployment `5964010747` success.
- Planning baseline after fetch: `origin/main` `bbfaeee7` on 2026-08-18; fetch again.
- Issue [#92](https://github.com/u2giants/popdam3/issues/92) tracks work.
- Implementation not started; all plan rows open.
- Plan, docs, and this handoff were committed and pushed to `main` in `03cbf71c`. No application code changed, so no runtime deployment was required. Issue #92 remains open because implementation has not started.
- Grok 4.6 session `openrouter-batch-recovery-plan` cost $0.54548818 across three reviews. The first two reviews found and closed material gaps, including blind UI/API writers. Final verdict: **SAFE FOR ZERO-CONTEXT IMPLEMENTATION**.

## 4. Everything we tried that did NOT work

Exact variant stripping caused first failure, fixed `57b60673`. Normal chat endpoint caused provider 404, fixed `c1ac8443`. Current long in-memory poll still cannot restart safely. Module maps, blind resubmit, progress-hidden state, full request persistence and pretending `custom_id` is idempotency are rejected in plan §7.

## 5. Root causes and key findings

- `openrouter.ts:433-533` owns submit/poll/result in one process promise; `:543-555` queues in module memory.
- `operation-loop.ts:540-647` saves only after dispatch returns; `:93-112` strips arbitrary AI progress; `:84-89` declares stale after 10 minutes.
- Existing `BULK_OPERATIONS` can hold compact recovery state, but its updater has no proven worker lease and app/UI writers replace whole state. The design now requires revision/lease protection plus an audit of every writer.
- OpenRouter documents POST, GET-by-ID, terminal states, 30-day retention, but no idempotency/search; POST/save ambiguity must be loud.
- The safe submit protocol is two ticks: persist prepared intent and yield; then atomically claim a lease, POST once, and hard-save the ID. An unproved save becomes ambiguity, never an automatic second POST.
- Per-item durable status is required so rows and additive counters both converge after a crash. Every unresolved return must preserve the cursor explicitly, including numeric `0`.
- The live output ladder, repair, same-model retries, and eligible fallback must remain exact. Vision Bake-Off must reject `:batch` until it has its own durable state machine.
- No UI/API replacement may erase or regress protected state. `set-config` must not bypass the updater; stale Resume/Queue/Stop/reset requests fail closed; a second single-asset click and its later idle write cannot replace a live job.

## 6. Exact next steps

1. Read plan fully, fetch main, update drift/STATUS. **You'll know it worked when** citations match or drift is recorded.
2. Execute Step 1 shared-db revision/lease contract first, then app typed state and writer audit. **You'll know it worked when** preview proves one lease owner and Resume/Queue preserve state while new Start refuses it.
3. Execute Step 2 real fixture/stateless helpers and synchronous batch rejection. **You'll know it worked when** captured contract tests and Bake-Off rejection pass.
4. Execute Steps 3-5 extraction/state machine/yield/stop/stale recovery. **You'll know it worked when** serialized restart performs same-ID GET and zero replacement POST.
5. Execute Steps 6-7 tests/docs/UI. **You'll know it worked when** all named commands pass and the UI explicitly shows waiting, batch ID, and last check.
6. Execute Step 8 cutover/restart proof on a tiny already-tagged set. **You'll know it worked when** exact SHA is green/deployed and logs show one POST ID followed by GETs for it.
7. Keep STATUS current; close issue/retire handoff only when Definition of Done passes.

## 7. Constraints and gotchas in force

Main-only app; correct Albert commit identity; stage only own files. Shared structure changes only through shared-db branch/PR/preview/merge, never app-local migrations. Never persist/log keys, auth, base64, prompts or bodies. Pending is not failure; cursor fixed until reconcile; `custom_id` not order; guarded state saves; no undocumented cancellation/idempotency claims. Old code must never be rolled back over a running external job.

## 8. Access and environment

Repos `/worksp/popdam` (`u2giants/popdam3`) and `/worksp/shared-db` (`u2giants/shared-db`); read both AGENTS files and verify status/auth. Railway owns deploy/runtime key. Supabase `qsllyeztdwjgirsysgai`, reads open, structure governed. Secrets in 1Password vault `vibe_coding`, existing AI-provider/OpenRouter item, never values. Worker: `npm test`, `npm run build`, current CI workflow.

## 9. Open questions and risks

No documented provider idempotency/search; compact JSON size must be measured; stop may not cancel provider billing; beta API may drift. Criteria/mitigations are complete in plan §13.

## Handoff self-audit

1. **Could a street-new developer continue without asking a question? Yes.** §§1-3 define the product, trigger, repositories, deployed baseline, planning SHA, issue, and unfinished state; §6 and the linked plan give the exact execution order.
2. **Could they continue as effectively as this session can? Yes.** §§4-5 preserve both earlier failed fixes, the memory-only root cause, Grok's findings, the lease protocol, writer risks, cursor/counter traps, and provider limits.
3. **Are failed attempts and reasons included? Yes.** §4 names exact variant lookup, normal chat submission, the remaining long in-memory poll, and the rejected replacements, with the linked plan §7 carrying full reasoning.
4. **Is every next step concrete and verifiable? Yes.** §6 contains seven ordered steps with a “you'll know it worked when” gate; the plan §§9-10 specify files, behavior, and tests.
5. **Are terms, identifiers, paths, URLs, and SHAs defined? Yes.** §§1,3,5,8 identify both repositories, Supabase, Railway, OpenRouter state, issue #92, commits, commands, and secret location without values.
6. **Was the §0 owner-decision sweep run? Yes.** Re-reading §§1-9 found no sentence requiring Albert's approval or judgment. Implementation is already authorized; provider uncertainty has a fail-closed rule rather than an owner choice. §0 therefore correctly says none and records settled decisions not to re-ask.

Final synthesis:

1. **Is this comprehensive enough for a brand-new developer? Yes.** §§1-9 plus the reciprocal plan contain the full background, current state, implementation sequence, and proof gates.
2. **Can they continue as well as this session can now? Yes.** §§3-6 preserve all verified evidence and all three Grok review rounds, including the non-obvious blind writers and rollback danger.
3. **Is every relevant detail present for flawless execution? Yes.** Goals, intended outcome, state, failures, locked decisions, constraints, risks, exact actions, tests, commit, issue, and verification evidence are split deliberately between this handoff and the linked 13-section plan.
4. **Would Albert see every needed decision by reading only §0? Yes.** A line-by-line sweep of §§1-9 found zero current decisions for him; all implementation choices are settled and issue #92 is open for execution evidence, not approval.

**Handoff self-audit passed.**
