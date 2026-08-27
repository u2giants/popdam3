---
issue: 92
status: OPEN
owner: codex/openrouter-batch-live-proof-92
---

# OpenRouter batch restart recovery — retry live proof after media fix

Canonical plan: [`../plan_openrouter_batch_restart_recovery.md`](../plan_openrouter_batch_restart_recovery.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream currently needs Albert's judgement. The feature, safety contract, and acceptance bar are settled. Do not lower the acceptance bar or close #92 merely because the deployed code and simulations pass.

Already settled — do not re-ask:

- 2026-08-24: issue #92 closes only after a tiny real production batch crosses an actual Railway restart, resumes the same provider ID, and applies results exactly once without a replacement POST.
- 2026-08-27: failed provider jobs are preserved as terminal protected pointers; they are not overwritten or resubmitted to manufacture a passing result.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager at `https://dam.designflow.app`; the same codebase serves PopSG at `https://sg.designflow.app`. Repository `u2giants/popdam3` is locally `/worksp/popdam`. A Node/TypeScript worker under `apps/worker/` runs on Railway and stores durable bulk-operation state in shared Supabase project `qsllyeztdwjgirsysgai`.

OpenRouter Batch API image tagging submits discounted asynchronous provider work. PopDAM must persist the provider batch ID and asset mapping so a Railway restart resumes the existing job instead of abandoning, duplicating, or rebilling it.

## 2. What we set out to do this session, and why

This replacement handoff reconciles the original 2026-08-18 planning handoff with current GitHub, plan, deployment, and production evidence. The old file said implementation had not started; that became materially false after the restart-safe implementation shipped.

The remaining objective is narrow: obtain the committed Definition-of-Done artifact from one successful provider batch across a real Railway restart.

## 3. Current state — what is true right now

- Steps 1–7 in `plan_openrouter_batch_restart_recovery.md` are complete. Step 8 is partial.
- Durable external-job state, receipt-gated submission, stateless same-ID polling, result-ID validation, terminal clearing, replay-safe application, stop/stale handling, and waiting-state diagnostics are deployed.
- Core implementation shipped at `1c042fb96883e5ed201e0fd232239e92f1bb016f`; Railway deployment `6061715659` succeeded for that SHA. Automated restart simulation proves one POST followed by same-ID GET after reconstruction.
- Permanent preparation/starvation repairs shipped at `f6714b1a` and `1b065171`; worker 1.4.5 passed 138/138 tests and TypeScript build. Railway deployment `6132251480` succeeded for exact SHA `1b065171383bc520ee02fb79505a82ab4ed533d5`.
- Two controlled production attempts on 2026-08-27 durably saved provider IDs, but OpenRouter marked both jobs `failed` about 12 seconds after submission—before a normal Railway rebuild could complete. No replacement provider ID appeared. This proves safe terminal preservation, not restart recovery.
- Production Image Tagging was restored to `meta-direct/muse-spark-1.2-contributor` and verified live after the attempts.
- The terminal provider cause was then confirmed and repaired at `25232c60`: synchronous tagging still uses base64 data URIs, while asynchronous batch requests now send public HTTP(S) thumbnail URLs that OpenRouter can fetch later. Batch payload construction rejects data URIs before submission. CI run `33124691849` passed and Railway deployment `6132494659` reported success for the exact SHA.
- Issue [#92](https://github.com/u2giants/popdam3/issues/92) is OPEN. The media repair removes the known external blocker; a fresh controlled live restart proof is now actionable.

## 4. Everything we tried that did NOT work

1. **Treating deploy/simulation success as completion.** CI, exact Railway SHA, HTTP 200, and automated reconstructed-state tests all passed, but the plan explicitly requires one real restart artifact. The issue was correctly reopened.
2. **Using the first controlled production batch.** `ai-tag-all` persisted a real provider ID for 50 bounded already-tagged assets, but OpenRouter terminally failed it in about 12 seconds, before restart recovery could be observed. The later diagnosis found the batch payload carried a data URI that the asynchronous provider could not fetch.
3. **Trying a second operation shape before diagnosing the shared payload.** `ai-tag-groups` persisted a different provider ID for 20 bounded already-tagged assets; OpenRouter also terminally failed it in about 12 seconds because it used the same incompatible media form.
4. **Earlier normal-chat/variant paths.** `:batch` requires `/api/beta/batches`; catalog normalization and normal chat completion were not valid substitutes. Those code defects were already repaired by `57b60673` and `c1ac8443`.
5. **Unsafe resubmission after ambiguity or terminal failure.** Rejected. Receipt/lease rules and protected pointers intentionally fail closed because another POST can duplicate cost.

## 5. Root causes and key findings

- The original process-memory defect is fixed: provider identity and custom-ID mapping now cross the durable operation-state boundary.
- The two provider failures had a confirmed request cause: asynchronous OpenRouter workers cannot later fetch inline data URIs. Commit `25232c60` preserves base64 for synchronous calls but sends the existing public thumbnail URL for batch calls and rejects incompatible media before POST.
- A terminally failed batch cannot prove same-ID GET after restart or exactly-once result application, even when its persisted ID proves no replacement submission occurred.
- Empty commits `5e24ea78` and `11f9d65c` were deliberate Railway rebuild triggers during the controlled exercise; they did not change source code and do not themselves prove acceptance.
- The safe production model remains `meta-direct/muse-spark-1.2-contributor`; do not leave Image Tagging pointed at a failing batch route after a test.

## 6. Exact next steps

1. Read the STATUS table and newest issue #92 comment before doing anything; verify current `origin/main`, successful Railway deployment of `25232c60`, live Image Tagging model, and that no protected terminal pointer will be overwritten. **You'll know it worked when** the candidate operation and rollback model are named without exposing prompts, artwork, credentials, or payloads.
2. Run one minimal post-fix preflight batch and confirm OpenRouter accepts the public thumbnail URL rather than terminally rejecting incompatible media. **You'll know it worked when** the batch remains pending/processing and its durable provider ID is visible privately long enough to exercise recovery.
3. With that bounded already-tagged batch pending, trigger one normal Railway rebuild after the ID is persisted. **You'll know it worked when** the restarted worker performs a GET for the same ID and no second POST/provider ID appears.
4. Let that same batch complete and reconcile. **You'll know it worked when** every expected custom ID is applied exactly once, the cursor advances only after the page is complete, and the operation has no duplicate or missing result residue.
5. Restore the normal production Image Tagging model and verify a live non-batch tag operation still works. Add sanitized evidence to #92, update plan Step 8 to complete, close #92, and delete this handoff. **You'll know it worked when** issue state is CLOSED, the plan is accurate, production capability is restored, and no issue-92 handoff remains.

## 7. Constraints and gotchas in force

- Never expose keys, prompts, artwork, base64, provider request/response bodies, or customer data in issues, logs, commits, or chat.
- Provider submission requires `lease_receipt_issued` and a non-empty one-time `lease_token`; `ok` alone is never authority to submit.
- Ambiguous POST/save state, terminal pointers, expired leases, unknown/duplicate/missing result IDs, and stale hashes all fail closed.
- Do not overwrite a protected terminal pointer or manually clear it to force another test.
- Keep the candidate page cursor fixed until the complete page reconciles.
- Stop means no more PopDAM submission/application; OpenRouter cancellation is not promised.
- Use a bounded already-tagged set and restore the normal model after the experiment.
- PopDAM app work lands on `main`; preserve concurrent work and stage only owned files. Shared structure changes, if unexpectedly required, go through canonical `/worksp/shared-db`.

## 8. Access and environment

- App repo: `/worksp/popdam`; GitHub: `u2giants/popdam3`; production: `dam.designflow.app` and `sg.designflow.app`.
- Railway worker deploys from PopDAM `main`; verify the exact deployment SHA rather than relying on a green GitHub environment badge.
- Shared Supabase production project: `qsllyeztdwjgirsysgai`.
- OpenRouter credentials and related notes live in 1Password vault `vibe_coding`; never print values. Production Image Tagging configuration is managed through the authenticated app/config path.
- GitHub CLI and normal repository access were working during the 2026-08-27 reconciliation; reverify before acting.

## 9. Open questions and risks

- The known media defect is repaired, but the post-fix live provider behavior has not yet been exercised across a restart. Treat any new failure from its actual evidence rather than assuming it is the old data-URI problem.
- A provider job that completes before Railway restarts cannot prove recovery; choose a bounded job that is accepted but leaves a real restart window.
- A provider outage can keep this acceptance artifact blocked indefinitely without invalidating the deployed safety implementation.
- Repeating production tests can incur cost. Keep the sample minimal and do not resubmit after ambiguous state.
- The fresh session must not mistake durable terminal-ID preservation for successful same-ID polling and exactly-once application.

## Self-audit

Passed 2026-08-27. Sections 0–9 are present; §3 records exact shipped and live state, §4 preserves every important failed attempt, §§5 and 7 preserve the non-obvious safety contract, §6 gives ordered actions with verification gates, §8 names access without secret values, and §9 captures the provider uncertainty. A line-by-line owner-decision sweep found no unresolved owner judgement outside §0.
