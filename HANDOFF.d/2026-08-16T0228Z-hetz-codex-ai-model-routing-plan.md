---
issue: 90
status: OPEN
owner: codex/ai-model-routing-plan-90
---

# HANDOFF — AI model interaction reliability plan (2026-08-16 02:28 UTC, hetz/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None. Albert already requested a comprehensive implementation plan to fix every
finding from the AI-model interaction audit. The plan makes no model-selection,
database-structure, or unbounded paid-bake-off decision.

Already settled on 2026-08-15, do not re-ask:

- Fix the root capability-routing design rather than adding more model-name patches.
- Keep Vision Bake-Off behavior aligned with production image tagging.
- Preserve direct DeepSeek rich-PDF extraction and direct Google/Anthropic PDF fallback.
- Do not change the `tag_asset` business taxonomy in this workstream.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed product art.
The React web app runs at `https://dam.designflow.app`; PopSG runs at
`https://sg.designflow.app`. A Railway Node worker performs image tagging, bake-off,
ERP classification, and rich-PDF work. Synology bridge and Windows agents process
source files and PDF pages. Repository: `u2giants/popdam3`, local path
`/worksp/popdam`, normal app branch `main`.

## 2. What we set out to do this session, and why

Albert asked for a fresh-session-grade plan to fix every finding from the audit of
how PopDAM interacts with AI models. The trigger was Muse Spark 1.2 rejecting forced
tool choice in Vision Bake-Off. The immediate Muse fix exposed broader risks:
name-based capability guessing, premature cascade termination, silent ERP skips,
different PDF behavior between agents, and missing end-to-end tests.

The complete build specification is
[`../plan_ai_model_interaction_reliability.md`](../plan_ai_model_interaction_reliability.md).

## 3. Current state — what is true right now

- Immediate Muse recovery is committed, pushed, and deployed as `c3f133b5`.
  GitHub CI run `31921541662` passed, and Railway marked the SHA successful.
- GitHub issue [`#90`](https://github.com/u2giants/popdam3/issues/90) tracks the
  complete repair.
- The implementation plan, this handoff, and router/topic links are the only work
  produced by this planning session. No application code or production config was changed.
- All implementation steps remain open. A new session starts at plan Step 1.
- The plan is written against remote `main` baseline `c3f133b5` and must be
  drift-checked before implementation.

## 4. Everything we tried that did NOT work

- Forced `tool_choice: required` failed for Muse because its current provider
  accepts only `auto`.
- Relying on the JSON-schema/JSON/repair cascade did not save that run because
  the model produced no parsable contract response in those legs.
- A one-model regex fixed production immediately but is rejected as the long-term
  design because provider behavior changes and other models have different capability sets.
- Universal `tool_choice: auto` is rejected because a model may answer normally
  without invoking the tool; current ERP then silently skips the item.
- Universal schema-first without capability metadata is rejected because some
  models are tools-only or JSON-only.
- Moving direct DeepSeek rich-PDF work to OpenRouter is rejected because it would
  lose intentional prefix-cache economics and does not address an audit defect.

Full rejected-approach history is plan Section 7.

## 5. Root causes and key findings

- `apps/worker/src/handlers/ai-tagging-shared.ts:74-99` guesses routing from a
  handful of model-name patterns.
- `ai-tagging-shared.ts:350-362` can throw malformed/invalid tool output before
  trying schema or JSON modes.
- `apps/worker/src/handlers/erp.ts:398-407` silently continues when the model
  returns no usable tool call.
- Windows PDF extraction prefers OpenRouter; bridge PDF extraction retains the
  direct-provider catalog. Identical settings can behave differently.
- Catalog/UI metadata and runtime execution use separate capability interpretations.
- Existing tests cover helpers but do not execute the complete output cascade.

The root cause is the absence of one capability contract shared by discovery,
strategy planning, execution, diagnostics, and UI.

## 6. Exact next steps

1. Open `plan_ai_model_interaction_reliability.md`, read its STATUS table, and
   begin Step 1. You'll know this is correct when the new regression tests fail
   against the documented baseline for the expected reasons.
2. Execute Steps 2–3 and use the plan's first fresh-session cut. You'll know the
   routing core works when malformed tool output continues to strict schema and
   terminal provider failures stop immediately.
3. Execute Steps 4–7, coordinating parallel work only where the plan permits.
   You'll know migration is complete when tagging, bake-off, ERP, both PDF agents,
   and both settings screens use the shared capability vocabulary.
4. Execute Steps 8–9, update plan status as evidence lands, and close issue #90
   only after exact-SHA CI/deployment and bounded smoke proof.

## 7. Constraints and gotchas in force

- Work on `main`; preserve concurrent dirty files and stage exact files only.
- Verify Albert's git identity before committing.
- No database structure change from this repo.
- No new hard-coded model quirks when configuration/provider metadata can express them.
- No silent fallback or silent success.
- Do not log credentials, licensed images, full prompts, or PDF text.
- Keep production tagging and bake-off on one adapter.
- Keep DeepSeek rich-PDF direct and keep Google/Anthropic PDF fallback.
- Never modify source-file timestamps.
- UI work requires a served screenshot.
- Update the plan immediately as steps are executed.
- Do not rewrite the legacy root `HANDOFF.md`; another session has modified it in
  the shared checkout. Migration remains pending and is not part of issue #90.

## 8. Access and environment

- `git` and `gh` are authenticated for `u2giants/popdam3`; issue #90 was created.
- Railway deploy status is visible through GitHub commit statuses.
- 1Password vault is `vibe_coding`; AI keys are referenced in docs under
  `ai-provider-api-keys`. Never store values in the plan or tests.
- Supabase project is `qsllyeztdwjgirsysgai`. No database structure work is planned.
- Local commands and each app's build commands are in plan Sections 9–12.

## 9. Open questions and risks

- OpenRouter does not publish granular named/required/auto tool-choice support for
  every provider. The plan uses explicit overrides plus bounded runtime downgrade.
- Catalog outages require last-known-good cache behavior without per-asset refetch.
- A shared agent package must build under both bridge and Windows module systems.
- Schema-first behavior may change output quality; bounded smoke proof is required.
- Agent workflow success proves publication, not installation on a live machine.

No owner decision is currently blocking implementation. If implementation discovers
a need to change models, expand paid testing, alter database structure, or use new
credentials, stop and ask Albert once with the consequence and recommendation.

## Handoff self-audit

1. **Could a street-new developer continue without a question?** Yes. Sections
   1–3 define the product, goal, trigger, repository, issue, baseline, and status;
   Section 6 points to exact plan steps and gates.
2. **Could they continue as effectively as this session?** Yes. Sections 4–5
   preserve failed approaches, exact root causes, and file evidence; Sections 7–9
   preserve constraints, access, and risks.
3. **Are failed attempts included with reasons?** Yes, Section 4 and plan Section 7.
4. **Is every next step concrete and verifiable?** Yes, Section 6 links to plan
   Section 9, where each file-level step ends with a verification gate.
5. **Are terms, paths, URLs, identifiers, and SHAs explained?** Yes, Sections
   1–3 and 8 define them.
6. **Was the Section 0 sweep run?** Yes. Sections 1–9 and the plan were checked for
   owner decisions. None are currently required; all future stop conditions are
   consolidated in Sections 0 and 9.

Final synthesis:

1. **Is this handoff comprehensive enough for a brand-new developer to not skip a
   beat?** Yes, supported by Sections 1–9 and the linked 13-section plan.
2. **Can they continue with all current knowledge?** Yes, supported by Sections
   3–5, 7, and 9.
3. **Is every relevant detail present for flawless execution?** Yes. The handoff
   carries current and past state; the plan carries ordered implementation, tests,
   delivery, rollback, and proof requirements.
4. **Would Albert see every needed decision from Section 0 alone?** Yes. A line-by-
   line sweep found no current owner decision; future expansion triggers are stated
   in Sections 0 and 9. No gap remains.
