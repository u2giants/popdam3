---
issue: 96
status: BLOCKED
owner: codex/issue96-meta-recovery-20261015
---

# Muse request recovery and credential review continuation

Snapshot: October 15, 2026, 9:51 AM EDT. This handoff continues [PopDAM issue #96](https://github.com/u2giants/popdam3/issues/96) from current main, commit [b06c1074](https://github.com/u2giants/popdam3/commit/b06c107437985d4de35b2a40486420368a4e6aca). The issue remains open. This document records a blocked recovery and the exact credential replacement plan for independent review. No production state, provider request, or key was changed.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None. Albert's existing authorization to complete the PopDAM file-tagging scope with the exact Meta Muse Spark 1.3 Contributor model remains in force. Do not request a technical approval, login, key, or manual action from him. Account access, provider evidence, independent review, and production gates are technical duties; platform limits are reported as blockers.

## 1. WHAT THIS APPLICATION IS

PopDAM is the internal artwork library in [u2giants/popdam3](https://github.com/u2giants/popdam3). A Railway worker saves visual descriptions and normalized AI tags to the Virginia Supabase project qsllyeztdwjgirsysgai. The requested proof is asset-level and file-scoped; PopSG filename tags and Style Group metadata are outside this scope.

An asset counts complete only when it has a saved description, assets.ai_model and ai_tagged_at attribution for meta-direct/muse-spark-1.3-contributor, and normalized active asset_tags with source=ai and that exact model. Aggregate assets.tags, operation counters, and deployment status do not count as saved-row proof.

## 2. WHAT WE SET OUT TO DO THIS SESSION, AND WHY

Recover Meta's accepted response for cursor 64 through an authorized supported route; obtain independent approval for replacing and revoking the compromised Meta API key; preserve the original run and key while those gates are unresolved; and, only after safe continuation, prove the full 8,663-asset union before closing issue #96.

The 8,546-position run has an accepted Meta request at cursor 64 but no durably saved response ID. Resubmitting could duplicate paid work and violate the provider-capacity reservation. The current Meta key is marked compromised and is present in runtime configuration. Neither uncertainty authorizes a reset, retry, cancellation, or new operation.

## 3. CURRENT STATE — WHAT IS TRUE

### Issue and live data evidence

- Issue #96 remains open. Its latest update at this snapshot is the signed production proof posted October 15, 2026, 12:21 AM EDT: [issue comment](https://github.com/u2giants/popdam3/issues/96#issuecomment-6183461008).
- That last live proof reported the protected run interrupted at cursor 64 of 8,546, ambiguous_submission, with no Meta request ID; counters were 63 tagged and 1 historical failure. Do not change or clear the run.
- The same proof covered 8,663 unique assets: 181 had complete saved metadata and 8,482 remained incomplete. This is the latest verified count, not a fresh read from this session. No claim that every incomplete position is untagged is authorized.
- The 118 historical repair assets and the 64-position processed prefix had complete saved metadata in that proof. Their overlap is one asset; do not retag them.
- This session did not read production rows or operation receipts. ai-task-gates refused the production action under both reviewer-safety and deployment, with no reviewer or acknowledgement override. The task was narrowed to this Markdown handoff and its review; do not treat that as authority for production access.

### Meta request and credential access

- The accepted cursor-64 response ID and terminal result remain unknown. The public API documents response retrieval by a known response ID; no supported list-by-time or search-by-request route was established.
- A fresh 1Password title search found only “Meta ai Muse Spark API Key”. Its metadata has no username or linked sign-in identity; its security status says compromised. No concealed key value was revealed or used.
- Meta's official help says the account activity includes API request logs, but accessing the developer dashboard requires sign-in. Creating or deleting API keys also requires a signed-in account. The official support-ticket flow requires identity confirmation. No authorized signed-in route was available here, and no support request was sent.
- Earlier live evidence, last checked October 14, 2026, 11:59 PM EDT, found the compromised value in the Railway worker fallback, a sealed META_API_KEY in Supabase Functions, and no admin_config.META_API_KEY row. Do not present these runtime observations as freshly reverified.
- The task made no Meta provider API call, generation request, support contact, key creation, key revocation, runtime configuration change, operation mutation, or row write.

## 4. EVERYTHING WE TRIED THAT DID NOT WORK

- Official Responses API documentation shows retrieval at GET /v1/responses/{id}. The required ID is missing; guessing an ID or using an earlier cursor's ID is unsafe.
- Official account-security guidance mentions API request logs, but the dashboard requires an authenticated developer account. The accessible vault has no login identity, and the current task has no authorized browser session. The official support form also requires identity confirmation, so it was not submitted.
- ai-task-gates check --before production refused under reviewer-safety and deployment; no production read or write followed. Do not change the task class to evade that refusal.
- These official sources support the boundary: [response retrieval](https://dev.meta.ai/docs/protocols/responses), [account activity](https://dev.meta.ai/help/accounts-and-login/account-security), [support access](https://dev.meta.ai/help/support/contact-support), [key creation](https://dev.meta.ai/help/api-keys/create-api-key), [key revocation](https://dev.meta.ai/help/api-keys/delete-api-key).

## 5. ROOT CAUSES AND EXACT CREDENTIAL REPLACEMENT PLAN

### Request ambiguity

Meta accepted the cursor-64 request, but a revision conflict prevented durable storage of its ID. The original process ended. The held run correctly stays ambiguous and reserves provider capacity. [PR #368](https://github.com/u2giants/popdam3/pull/368) prevents future accepted-ID persistence loss but cannot recover this past ID.

### Credential exposure and consumers

The existing Meta API-key item is marked compromised. The known consumers are:

1. admin_config.META_API_KEY, the saved setting used by the worker and PopSG agent when present.
2. Railway production worker environment META_API_KEY, the worker fallback.
3. Supabase Functions environment META_API_KEY, the PopSG agent fallback.

Source maps: [key consumer inventory](https://github.com/u2giants/popdam3/blob/main/docs/INFRASTRUCTURE.md#L38-L83), [worker key resolution](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/provider-api-key.ts#L55-L56), [worker environment](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/config.ts#L39-L40), and [PopSG fallback](https://github.com/u2giants/popdam3/blob/main/supabase/functions/agent-api/index.ts#L3616-L3629).

### Proposed exact sequence for independent approval

1. Use the authorized existing Meta Model API account at dev.meta.ai, then open its API keys page. Create one replacement key scoped to the existing team and store it in the current vibe_coding entry without exposing it.
2. Through supported interfaces, set the replacement in admin_config.META_API_KEY, Railway META_API_KEY, and Supabase Functions META_API_KEY. Compare values only inside protected processes; report booleans, never values. Keep the existing runtime capability available during the swap.
3. Use the replacement key for a non-generating GET /v1/models check, then verify all three consumers resolve to the replacement and the ordinary worker/agent configuration is healthy.
4. Revoke the compromised key through the signed-in Meta dashboard as soon as the replacement is in place and verified. Update the vault metadata and keep no usable copy of the compromised key after revocation.
5. Preserve the original run and its provider account provenance. Do not use either key to resubmit the ambiguous cursor-64 generation.

This is a plan for reviewer assessment only. The task-gate refusal and missing authorized Meta login currently prevent executing it. An approval of this plan does not override either blocker or authorize a provider request.

## 6. EXACT NEXT STEPS AND ACCEPTANCE GATES

1. Establish an authorized Meta developer-account route already belonging to POP Creations. Gate: a legitimate sign-in is available without using another session's browser state or asking Albert to perform setup.
2. Inspect that account's supported request logs for the original request window, model, and team; if the exact record is absent, use Meta's authenticated support flow. Gate: an exact response ID is tied to the original request, input, model, account, and terminal status. Otherwise preserve the ambiguity.
3. Obtain an assigned in-rotation AI reviewer APPROVE for the exact sequence in §5, bound to the precise replacement plan and consumers. Gate: the reviewer report approves the credential and revocation action without exposing values. This handoff is the review target; the issue comment records the exact-head result.
4. Recheck current task-gate policy before any production action. Gate: all required checks pass; if the repository still refuses the action, stop without changing the key.
5. Only after the request identity and credential risks are resolved, obtain fresh exact review for same-request reconciliation and original-run continuation. Gate: the supported reconciliation binds the exact provider result, preserves scope/history, and cannot submit another request.
6. After the original fixed scope completes, re-read every page for the union of 8,663 unique assets. Gate: every eligible asset has the saved description, exact model attribution, ai_tagged_at, and active normalized exact-model AI tags; skips and exclusions reconcile to valid saved metadata; no ambiguous request remains; the historical failure count is preserved.
7. Keep issue #96 open until the gate in step 6 passes and the issue carries the live proof. Do not open a second issue for remaining proof.

## 7. CONSTRAINTS AND GOTCHAS

- Use only meta-direct/muse-spark-1.3-contributor. Never switch models or retag valid active exact-model assets.
- Do not reset, resume, cancel, clear, replace, replay, or bypass the original ambiguous run; do not start a disjoint operation while the provider reservation is unknown.
- Never use the compromised key for a generation or new provider request. Do not expose secret values, raw provider logs, request IDs, asset IDs, or licensed paths in GitHub, review packets, or reports.
- The only production database is Virginia project qsllyeztdwjgirsysgai. Application rows stay application-owned; no schema change is needed.
- Any production action requires the repository task gate and exact assigned AI reviewer approval. A gate refusal has no acknowledgement bypass.
- Preserve concurrent worktrees and existing handoffs. This handoff is this session's own file; never edit or delete an earlier session's handoff.

## 8. ACCESS AND ENVIRONMENT

- Repository: [u2giants/popdam3](https://github.com/u2giants/popdam3); current upstream base at snapshot: [b06c1074](https://github.com/u2giants/popdam3/commit/b06c107437985d4de35b2a40486420368a4e6aca).
- Current issue card: [#96](https://github.com/u2giants/popdam3/issues/96). Prior continuation evidence: [October 15 recovery handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-15T0358Z-hetz-codex-muse-request-and-credential-closeout.md) and [October 14 recovery handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-15T0250Z-hetz-codex-muse-recovery-closeout.md).
- The only accessible Meta credential record is the compromised API-key item in 1Password vault vibe_coding. It has no account username. Do not reveal or publish the item fields or key.
- Official account activity and key management live behind sign-in at dev.meta.ai; the support ticket also requires identity confirmation.
- This file is being prepared on branch codex/issue96-meta-recovery-20261015. At this snapshot it is not yet published. Reviewer and publication outcomes must be recorded on issue #96 before any successor takes stronger action.

## 9. OPEN RISKS AND SELF-AUDIT

The exact accepted response ID and terminal result remain unknown. The authorized Meta sign-in route is unavailable. The replacement/revocation plan still needs an assigned AI review, and direct production action is currently refused by the task gate. The 8,663-asset count is historical proof from 12:21 AM EDT, not a fresh read in this session. No background process or monitor is running.

Self-audit:

1. Newcomer context and current truth are in §§1–3; the exact issue, current main, and last live evidence are linked.
2. Background, failure causes, and the credential consumers are in §§2, 4, and 5; current access limits are in §§3 and 8.
3. Concrete next actions and observable gates are in §6; safety constraints and non-retry rules are in §7.
4. The business-decision sweep of §§1–9 found no owner decision. Section 0 says none and asks for no technical approval.

Posted by Codex chat 01a13fce-9e95-71f3-b27e-6356ef214c1b on hetz
