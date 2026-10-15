---
issue: 96
status: BLOCKED
owner: codex/issue96-meta-recovery-20261015
---

# Issue #96: fresh file-tagging run under the owner's updated direction

Snapshot: October 15, 2026, 4:58 PM EDT. This is a new, write-once successor handoff for the unfinished PopDAM file-tagging work on [issue #96](https://github.com/u2giants/popdam3/issues/96). It does not edit or retire the earlier [blocked recovery handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-15T1351Z-hetz-codex-muse-key-review-blocked.md). This file is not yet published; its intended location after merge is [HANDOFF.d/2026-10-15T2058Z-hetz-codex-issue96-fresh-tag-run.md](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-15T2058Z-hetz-codex-issue96-fresh-tag-run.md).

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None. Albert's October 15 direction is settled: do not recover the first Meta response; create a fresh tagging operation; do not rotate, revoke, replace, or change the existing Meta key; redact unprotected copies where found; verify descriptions and active Muse tags across the 8,663-asset scope; then close issue #96. This explicitly supersedes the older recovery and key-replacement direction in the predecessor handoff. Do not ask Albert to approve a technical action, sign in, provide a key, or run a command. Obtain technical approval from an assigned AI reviewer and follow the production gate.

The close condition in the owner's latest direction is the full 8,663-asset file-metadata proof. The prior issue body also listed Style Group profile-pilot work; do not re-open that scope as a business question. Record the requested file-metadata closeout on #96, and close only after the stated asset proof passes.

## 1. WHAT THIS APPLICATION IS

PopDAM is POP Creations' internal artwork library. The Railway worker uses the direct Meta Model API to write visual descriptions and normalized AI tags to the Virginia Supabase project. This task is file-level: each in-scope asset needs a saved description and active tags attributed to the exact model `meta-direct/muse-spark-1.3-contributor`. Style Group facts are a separate data scope.

The [PopDAM repository](https://github.com/u2giants/popdam3) is currently at latest main commit [`94b41b745fc18d8defbef6295cc0214d880145a2`](https://github.com/u2giants/popdam3/commit/94b41b745fc18d8defbef6295cc0214d880145a2). The current work branch is `codex/issue96-meta-recovery-20261015`. The app's worker code has a supported explicit-ID path: [the tagging handler](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/ai-tagging.ts#L1024-L1093) reads `params.asset_ids`, and [the operation hook](https://github.com/u2giants/popdam3/blob/main/src/hooks/usePersistentOperation.ts#L147-L170) accepts operation parameters. `ai-tag-all` uses the tag-all mode, so its explicit list must contain only assets confirmed incomplete immediately before the run.

## 2. WHAT WE SET OUT TO DO THIS SESSION, AND WHY

Albert changed the plan after the earlier session was blocked on recovering Meta's accepted cursor-64 response and replacing a key. He said not to recover the first response, to create a new tag operation, not to rotate the key, to redact local copies, and to verify all 8,663 assets before closing #96. His direction replaces the previous handoff's proposed response recovery and key-replacement steps.

The technical goal is to leave the original `ai-tag-untagged` operation's provider receipt and work history intact while using a separately keyed `ai-tag-all` operation with an explicit list of only currently incomplete assets. Any auto-resume of the original run must be prevented through its normal stop action before the new operation starts, if live evidence shows that run is eligible to auto-resume. No production action is allowed until an exact independent review approves the plan and the task gate passes.

## 3. CURRENT STATE — WHAT IS TRUE

### Source and review

- The task worktree is on `codex/issue96-meta-recovery-20261015` at `94b41b745fc18d8defbef6295cc0214d880145a2`, equal to freshly fetched `origin/main` at 4:58 PM EDT. The new handoff and temporary review input are uncommitted. No code or configuration file has been edited.
- A first GLM plan review said APPROVE, but `ai-task-gates check --before production` rejected its report because it had no recorded implementing engine.
- A second GLM review was run with `--implementer codex` and returned REJECT at the exact head above. It found that the owner pivot was only in an untracked file, the old worker may auto-resume the interrupted run, and the proposed explicit-ID path was not proven in its review packet. It also reported a high finding about an unrelated shared-db branch-protection obligation because the default review base used the local `main` reference at [`b06c107437985d4de35b2a40486420368a4e6aca`](https://github.com/u2giants/popdam3/commit/b06c107437985d4de35b2a40486420368a4e6aca), while `origin/main` was 15 commits ahead at `94b41b74`.
- A third GLM plan review at this head returned APPROVE and verified the worker's explicit-ID path, tag-all behavior, worker auto-resume conditions, and stop action. It made three low-severity completeness findings: name the exact saved-row predicates, check thumbnail availability before paid work, and clarify the no-tests instruction for a documentation-only handoff. That report is plan feedback only; it is not the final-check required to publish this reviewer-safety handoff or the exact approval required for a production operation. Resolve the findings before the final-check.
- The exact production gate remains unsatisfied. No production query, operation update, Meta request, or asset write was made after the owner's updated direction.

### Original run and asset counts

- The latest saved live evidence is the October 15, 12:21 AM EDT closeout comment on [issue #96](https://github.com/u2giants/popdam3/issues/96#issuecomment-6184336560): the original `ai-tag-untagged` run was interrupted at cursor 64 of 8,546, revision 841, with phase `ambiguous_submission` and no saved Meta response ID. Its counters were 63 tagged and one historical failure. Do not infer that this is still the live state; perform a gated fresh read before any action.
- That historical read found 181 complete of the 8,663 unique assets and 8,482 incomplete. It also found saved proof for the 64 processed prefix assets and 118 historical repair assets, with one overlap. This count and union are historical, not a current inventory or a published asset-ID list. The exact 8,663-member manifest must be proved or safely reconstructed in protected evidence before running or closing.
- Keep the original run unchanged while the task is blocked. If the fresh read shows that the worker could auto-resume it, the reviewer-approved plan must use the normal Stop path to mark it `user_stop` while preserving its cursor, parameters, external-job receipt, and counters. If that guarded write refuses or cannot preserve the receipt exactly, stop; do not start the new operation.

### Key and redaction

- Albert directed no rotation, revocation, replacement, or other key change. Leave the 1Password secret and all intentional runtime secret configuration unchanged. Use only the existing worker configuration after confirming the exact model; never expose or compare the key in logs or reports.
- In the previous turn, local archived Codex and Muse transcript/spool copies containing the value were redacted and read back to confirm the value was absent. The intended protected local key file and the 1Password value were preserved. A protected comparison against 63 issue/PR objects across #96 and related PRs #412 and #415 found no GitHub copy. The available Codex app tools have no individual-message redaction control; do not claim the remote chat service record was edited.
- Prior handoffs recorded the value in private runtime configuration. That is not evidence that the value was publicly posted. The owner says it was not published outside this computer and directs no rotation. Do not change the configured key to reconcile this wording.

### Issue and current user direction

Issue #96 remains open. Its latest posted comment predates the owner's updated direction and still says to recover the old response and replace the key. This successor handoff is intended to supersede that stale direction without editing the predecessor. Add a signed issue comment after this handoff is published, then keep the same issue open until all 8,663 assets pass the live proof.

## 4. EVERYTHING WE TRIED THAT DID NOT WORK

- Recovering the original Meta response by request time or cursor is no longer requested by Albert. The prior review established that supported retrieval needs a known response ID; none was saved. Do not repeat dashboard or support recovery work.
- Starting a new provider operation before approval was refused by the production task gate. This was correct: neither of the two GLM reports was accepted as an exact, lifecycle-recorded APPROVE for the proposed action.
- The first GLM APPROVE lacked the required implementing-engine record. The follow-up GLM review returned REJECT and named the stale handoff, possible auto-resume, and review-scope issues. Do not pass the rejected report to the gate or present it as approval.
- The full asset count from the prior report cannot stand in for today's inventory. No current list of the 8,663 asset IDs was found in the public issue or the reviewed handoff. Do not invent a manifest from the old count.
- The accessible Meta browser was signed out in the prior session. This is irrelevant to the owner's new request; do not use another browser profile or seek account access.
- No public GitHub match was found in issue #96, PR #412, or PR #415. The remote Codex conversation itself cannot be edited with the currently available thread tools; local copies were redacted instead.

## 5. ROOT CAUSES AND KEY FINDINGS

### Why the original run remains ambiguous

The prior cursor-64 submission was accepted by Meta, but its response ID was not durably saved before a revision conflict. The earlier handoff explains the event and the existing receipt protections. Albert has now chosen a fresh operation rather than recovery. The new operation may duplicate paid work for the unknown cursor-64 request; that is an accepted consequence of the owner's direction, but it does not authorize clearing or silently overwriting the original receipt.

### How the worker treats interrupted runs

The worker can auto-resume some interrupted runs; “interrupted” alone does not prove inactivity. [The operation loop](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/operation-loop.ts#L1085-L1127) resumes an eligible transient interruption only when its reason and cursor qualify, its backoff is due, attempts remain, and the AI-tagging lane is free. [The retry rules](https://github.com/u2giants/popdam3/blob/main/apps/worker/src/operation-retry.ts#L1-L29) define the qualifying reasons and cursor formats. The new plan must inspect the fresh `interruption_reason_code`, cursor, `next_auto_resume_at`, and attempt count. If eligible, stop it through the ordinary UI/API stop path, which preserves the external job; the new job's active use of the same lane is not a durable substitute because the old run could resume after the new job completes.

### Why a separate operation is plausible but still gated

Current main dispatches `ai-tag-all` through the same AI tagging handler, and the handler supports an explicit `params.asset_ids` list. That path does not require replacing the old `ai-tag-untagged` key. Because tag-all mode can force a tag operation, the list must exclude every asset already complete under the required four-part saved-row proof. Recheck active operations and the target `ai-tag-all` row before starting. Do not use a direct database write, guessed key, or unguarded reset if the normal API/UI route refuses.

### Proof that counts

An asset is complete only if `assets.ai_description` is nonblank, `assets.ai_model` equals `meta-direct/muse-spark-1.3-contributor`, `assets.ai_tagged_at` is present, and at least one normalized `asset_tags` row for that asset has `status='active'`, `source='ai'`, and `model='meta-direct/muse-spark-1.3-contributor'`. Paginate every normalized tag row and compare unique asset IDs against the fixed 8,663-member union. Aggregate tag fields, worker counters, or an operation status do not prove completion. The earlier handoff [codifies this contract](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-15T1351Z-hetz-codex-muse-key-review-blocked.md).

## 6. EXACT NEXT STEPS

1. **Publish this successor handoff.** Obtain an exact-head final-check for this documentation-only shipment, then stage only this file, commit it on the owned branch, open a documentation-only PR to `main`, and merge it normally. Gate: the new handoff is visible on main and the old handoff remains unchanged.
2. **Obtain exact production-action approval.** Fetch main and start from a fresh current-upstream worktree. Run the task gate before the paid review; have an in-rotation reviewer issue a final-check at the exact current main head and source, with the exact read and write route described below. A plan-review report is not sufficient for a production operation. Gate: the reviewer returns an exact-head APPROVE recorded by the lifecycle, then `ai-task-gates check --before production --reviewer-approval <report>` passes.
3. **Prove the current target and scope read-only.** Use only Virginia Supabase project `qsllyeztdwjgirsysgai`; do not use the default Supabase MCP, which is documented as resolving to the retired Ohio project. Verify the full fixed 8,663-asset union, current saved descriptions/tags, `thumbnail_url` availability for every incomplete asset, the configured vision model, all relevant operation rows, and any active tag worker. Keep IDs and raw rows in protected private evidence. Gate: the unique scope is exactly 8,663; every incomplete asset has an available thumbnail or is held for the supported thumbnail workflow; the model is exact; and no conflicting tagging operation is active.
4. **Prevent old-run auto-resumption if needed.** Use the fresh old-run fields and the current worker retry rules. If it is auto-resume eligible, use the ordinary stop action and confirm that only the status/reason changed while cursor, params, external-job receipt, and counters remain intact. If it is not eligible, leave it unchanged. If the stop is refused or the receipt differs, stop the entire task without starting the new job. Gate: no old run can resume into another Meta submission after the new run finishes.
5. **Start one new bounded operation.** From the fresh inventory, create a private explicit list containing only incomplete assets with available thumbnails; if any incomplete asset lacks a thumbnail, preserve that exception list and use the existing thumbnail workflow before trying to tag those assets. The settings-page button does not accept an explicit asset list, so use the authenticated `admin-api` `update-bulk-op` route that calls the guarded `update_bulk_operation` RPC; do not write the database directly. Supply `op_key='ai-tag-all'`, the explicit `params.asset_ids`, cursor zero, and a new run ID. First inspect the existing `ai-tag-all` row: if it is running, queued, or contains an external provider job/receipt, preserve it and do not start; if its prior state is safely terminal without an external job, retain a protected copy and use a fresh run ID rather than inheriting a resumable cursor or parameters. Verify the worker will use `meta-direct/muse-spark-1.3-contributor`. Do not change the Meta key or its runtime configuration and do not include already-complete assets. Gate: the new run ID and exact target count are durably saved, existing receipts remain preserved, and the normal worker accepts the job.
6. **Let the worker complete and preserve exceptions.** Follow the existing operation record. Do not retry a fresh ambiguous provider submission or switch models. If it fails, preserve its receipt and report the exact state on #96. Gate: the run reaches a terminal success state without losing provider IDs or masking failures.
7. **Verify all 8,663 assets and close #96.** Re-read the full unique asset union and every page of normalized active tags after the run. Reconcile all exclusions/failures; require every asset to meet the four saved-row conditions in §5. Post proof without IDs, licensed paths, raw rows, or key values; close #96 only if every asset passes. Gate: saved-row proof covers exactly 8,663 unique assets and issue #96 is closed with a signed evidence comment.

## 7. CONSTRAINTS AND GOTCHAS IN FORCE

- The owner changed the business direction on October 15, 2026: no old-response recovery and no key rotation, revocation, replacement, or configuration change. This supersedes the conflicting older handoff; never re-ask.
- Leave both the old run and key unchanged while approval or production access is blocked. After the exact review passes, stop the old run only if the fresh worker rules show it could auto-resume; preserve its ambiguous provider receipt exactly.
- Never reset, replay, clear, replace, cancel, or bypass a protected provider receipt. A separate run does not authorize altering the original receipt.
- Use only `meta-direct/muse-spark-1.3-contributor`; do not switch models or retag a complete asset.
- Correct production is Virginia project `qsllyeztdwjgirsysgai`. The default `mcp__supabase__*` MCP is a retired Ohio project trap; use a route that explicitly targets the Virginia project.
- Keep the 8,663-asset manifest and row data in protected local evidence. Never publish asset IDs, licensed paths, raw provider traffic, API key values, or runtime environment values.
- Use the repository's normal guarded operation route and worker. No direct SQL, raw PostgREST writes, or manual production update that bypasses `update_bulk_operation` and its protected-job rules.
- This handoff and its first PR change Markdown only; no code tests apply to that publication, and tests do not prove production metadata. Do not change code under this plan. If a code change becomes necessary, stop and follow the repository's required test treatment before reviewing it. Preserve unrelated worktrees and stage only this handoff when publishing it.
- All GitHub comments need the session signature: `Posted by Codex chat 01a13fce-9e95-71f3-b27e-6356ef214c1b on hetz`.

## 8. ACCESS AND ENVIRONMENT

- Repository and issue: [u2giants/popdam3](https://github.com/u2giants/popdam3), [issue #96](https://github.com/u2giants/popdam3/issues/96). Latest main at snapshot: [`94b41b745fc18d8defbef6295cc0214d880145a2`](https://github.com/u2giants/popdam3/commit/94b41b745fc18d8defbef6295cc0214d880145a2).
- Correct production database: Supabase Virginia project `qsllyeztdwjgirsysgai`. Do not infer the project from the default MCP connection.
- Exact provider model: `meta-direct/muse-spark-1.3-contributor`. The existing key is stored in the `vibe_coding` 1Password vault under “Meta ai Muse Spark API Key”; never reveal or export the value. The key must remain unchanged by the owner's instruction.
- The official Meta API creates a response at `POST /v1/responses`; retrieval requires the known response ID. That distinction motivated the old recovery block, but the owner has explicitly abandoned response recovery.
- This handoff is unpushed on the named branch. Intended main URL is the link in the opening paragraph after normal merge. No production browser, Meta login, database read, or worker action was used in this session.

## 9. OPEN QUESTIONS AND RISKS

- The 8,663-asset count and 181/8,482 completeness split are historical. A complete current read and an exact reproducible 8,663-member union are not yet available. If the fixed union cannot be established without inventing membership, keep #96 open and do not start the run.
- The fresh old-run interruption reason, backoff, and retry count are unknown. Auto-resume eligibility must be checked before starting the new run. A new same-lane run only delays auto-resume; it does not permanently stop it.
- The latest GLM plan review returned APPROVE with three low-severity completeness findings, but it is not a final-check or production-action approval. Do not take a provider or database action until the handoff is revised, published, receives an exact-head final-check, and the production task gate passes for the later exact action.
- The owner says the key was not published outside this computer. An earlier handoff records the value in private runtime configuration; that statement was not reverified this turn and does not establish a public leak. Keep the secret unchanged and distinguish intentional private configuration from an exposed public copy.
- The local transcript/spool copies found in the previous session were redacted; the related GitHub issue/PR scan found no copy. The current tools do not support editing a message in the remote Codex thread, so remote-service transcript redaction is unverified.
- The independent review also reported an unrelated shared-db branch-protection finding because it compared against a stale local base. Do not make shared-db changes from this PopDAM issue. A correctly scoped review should use the fetched `origin/main` base and must still report any current finding that blocks the exact production action.

Self-audit of this handoff: §0 contains all owner decisions and no technical approval request; §§1–3 give a newcomer the app, target, owner pivot, live-proof freshness, and exact current blocker; §4 records failed attempts; §5 links the worker state and proof contract; §6 gives ordered actions with observable gates; §§7–8 preserve safety and access boundaries; §9 records the remaining technical uncertainties. A brand-new session can continue without asking a business question, and this file records no work as complete unless its evidence is current.

Next-session prompt: Continue issue #96 from latest `main`. Read this successor handoff and the predecessor handoff. The owner has cancelled response recovery and key rotation, authorized a fresh file-tagging operation, and directed closure only after saved descriptions and exact active Muse tags are verified across all 8,663 unique assets. Publish this handoff through its final-check-approved documentation PR; then obtain an exact-head final-check for the production action and pass the production gate. Freshly prove the Virginia project, asset scope, thumbnails, current operation rows, configured model, and whether the old ambiguous run can auto-resume. If needed, stop it through the guarded path while preserving its provider receipt. Use the guarded `update-bulk-op` route to start one fresh explicit-list `ai-tag-all` run for eligible incomplete assets using the existing key/model. Keep #96 open until a complete paged saved-row proof passes; then close it with a signed, secret-safe comment. Never recover the old response, rotate the key, change its configuration, bypass a guarded write, or publish private row data.

Posted by Codex chat 01a13fce-9e95-71f3-b27e-6356ef214c1b on hetz
