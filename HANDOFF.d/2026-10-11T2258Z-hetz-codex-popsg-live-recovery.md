---
issue: 335
status: OPEN
owner: codex:01a12c68-44b8-7bb3-b1d4-98cb375b6859
---

# PopSG live recovery — October 11, 2026

## 0. Business decisions only the owner can make

None. Albert asked “is PopSG working and finished?” and then “fix it.” Continue the remaining technical repair autonomously. Do not ask Albert to approve, sign in, run commands, or install keys. Missing provider account authority is an AI-owned access blocker, not a business decision.

## 1. What this application is

PopSG is the style-guide library at https://sg.designflow.app, served by the PopDAM codebase. Users browse guides and files, view previews, and search licensed source material. The bridge crawls NAS files; a Windows agent renders difficult formats and extracts PDF text; hosted Supabase stores library/search state. Production is Virginia project qsllyeztdwjgirsysgai. The retired Ohio project must not be used for live proof.

Read [the application guide](https://github.com/u2giants/popdam3/blob/main/AGENTS.md), [PopSG implementation](https://github.com/u2giants/popdam3/blob/main/docs/POPSG.md), and [the readiness STATUS](https://github.com/u2giants/popdam3/blob/main/plan_popsg_production_readiness.md). Canonical structural work belongs to https://github.com/popcre/shared-db.

## 2. Goal and trigger

Finish reliable updates, common matching search in both modes, and searchable PDF coverage. Do not equate a green deployment or default browsing with full acceptance. [Application repair #335](https://github.com/u2giants/popdam3/issues/335) is the immediate card; [readiness #107](https://github.com/u2giants/popdam3/issues/107) owns full acceptance, including two qualifying ordinary changed-night windows. No leftover-proof issue is needed.

## 3. Current state

### Update repair deployed, live full-run completion still pending

[Canonical PR #4201](https://github.com/popcre/shared-db/pull/4201) at immutable f7842c9a7f58848955dd46a245fa044b6ff3b6cf passed five governed independent slots, guarded merge, fresh merged-main preview, and automatic production. [Production run 38179538914](https://github.com/popcre/shared-db/actions/runs/38179538914) succeeded. [Virginia read-only proof](https://github.com/popcre/shared-db/blob/main/.github/live-proofs/3458.sql) returned true afterward. Work issue #3458 and claim #4200 belong to that finished structural change.

The service-only await_style_guide_matview_refresh(uuid) waits for the real existing scheduler instead of performing the costly refresh inside the edge request. It preserves a stable first refresh start, lifecycle state, bounds, and row locks; it does not stamp completion. The cron-resolved two-argument default refresh implementation has MD5 52b676f90e4500dc323c2f9e6e6f3c97. There is no zero-argument overload. Existing concurrent cron work #4190/#4192 changed cadence to hourly :07; this repair did not alter cron.

[App PR #347](https://github.com/u2giants/popdam3/pull/347) merged as [46dd78567bc99516d294867923f5b242be2fbd3e](https://github.com/u2giants/popdam3/commit/46dd78567bc99516d294867923f5b242be2fbd3e). Edge deployment 38179966079, bridge image 38179966017, and Windows release 38179966068 succeeded. Normal idle-respecting update commands were used, never forced. Read-only heartbeats at 6:51 PM EDT verified bridge 1.16.17 with exact 46dd7856 build and Windows 0.16.7.173 matching the published release; both updating=false and no reported error. Windows build_sha remains null, an existing metadata limitation.

Controlled crawl 0c34cc2e-2d23-4e60-8f6e-eb1cbf8bbc70 began at 6:30:21 PM EDT. At 6:51 PM EDT it was running, lifecycle pending, not yet ingest-complete, no reported error. Pending counters are populated at completion; do not infer a failed scan from files_upserted=0 during enumeration. Verify ingestion, reconciliation, actual scheduler refresh, bounded search drain, completed timestamp, and zero stale unexplained rows. The next hourly scheduler opportunity is 7:07 PM EDT. Do not restart the run or substitute a synthetic completion.

### Search repair implemented and tested, not deployed

[Issue #4210](https://github.com/popcre/shared-db/issues/4210), exact-object claim #4212, [PR #4213](https://github.com/popcre/shared-db/pull/4213), branch codex/popsg-common-search, current pushed head [4af9808c9a9617d5af5a4cb4aa3c46a241634483](https://github.com/popcre/shared-db/commit/4af9808c9a9617d5af5a4cb4aa3c46a241634483). Migration version 20261011220717; seven owned files. Concurrent main was merged twice, preserving all sidecar registry entries. Fetch current main before any new paid review, retain concurrent source, and never force-push.

The single existing 15-argument search RPC keeps owner postgres, STABLE SECURITY DEFINER, exact search_path/work_mem/grants and argument order. Baseline prosrc MD5 3547b0f7d28d044ff6d6e031dcbeebbb; new body 9d5dd045810fa3fce5cc3d508e1210ff. Parse the one-row text query once in both modes. Guides use constant EXECUTE SELECT with fifteen USING values; no user text interpolation. Separate page metadata from distinct tag expansion, preserving full matching, rank, totals, facets, paging, null/blank identity, live previews, and PDF/render states. No timeout, role, index, or cron changes.

Existing nine behavioral contracts, dedicated guide metadata contracts, strong identity/dependency proof contracts, and 224 complete baseline/new JSON comparisons passed in a disposable PostgreSQL fixture. Read-only production-sized prepared-body diagnostics returned Files 4.113 seconds and final Guides 4.621 seconds under the unchanged eight-second ceiling. These are diagnosis, not deployed acceptance. [Tracked executed evidence](https://github.com/popcre/shared-db/blob/codex/popsg-common-search/docs/verification/popsg-search-4210.md) contains aggregate index/plan facts without licensed rows.

The runtime SELECT has a hash-bound no_durable_target sidecar tied to the real migration digest and EXECUTE marker. Local checker passed after resolving upstream registry conflict. The prior missing-sidecar CI failure was repaired; current source checks have no recorded failing check. Recheck current exact head before merge.

Old head 9aa10e61: DeepSeek sequence 6275 returned evidence-based BLOCKED, retained without an authorizing verdict. It requested executed test/index evidence and owner/dependency proof; new tracked evidence, dedicated tests and assertions address those requests. Do not call this a provider failure or erase the judgment. GLM sequence 6276 was stopped when that source was superseded; no completed verdict is known. New current-head assignment is pending; record actual resulting assignment rather than guessing. A contention retry waits five minutes by standing rule. Do not spawn duplicate draws or bypass the coordination mutex. The first retry without --admit-issue is not the proper structural route; the supported draw needs --admit-issue 4210.

### PDF route deployed; recovery blocked by compromised credential

Active-only coverage is 4,379 PDFs: 4,023 extracted, 223 explicit >100 MB exceptions, 100 exhausted old-provider failures, and 33 with no extraction row. One historical extracted inactive row must not inflate active coverage. All 100 exhausted rows matched active identities and had empty text when verified at 5:43 PM EDT.

PR #347 restores the selected meta-direct/muse-spark-1.3-contributor model through a server-owned agent endpoint. Windows submits the leased PDF identity and base64 PNG; server checks active PDF, current unexpired lease and identity before and after direct Meta Responses, with bounded same-model retry. No model switch, browser key, client provider override, automatic canonical-data write, or OpenRouter fallback for this route. It is not functional until the server-owned META_API_KEY is safely installed.

At 6:11 PM EDT this chat's diagnostic exposed the shared Meta key in process argument output. Albert was informed. The 1Password item “Meta ai Muse Spark API Key,” vault vibe_coding, item czggiabkpo7dt7ojep4btdvq5i, field “api key,” was marked Compromised at 6:14 PM EDT without changing its value. Private incident identifier 20261011T221402Z-hetz-muse-2924806 preserves secret-free evidence. Never repeat the value, inspect raw process arguments/environments, or put it in public artifacts.

Provider dashboard redirects to GitHub sign-in; no suitable account login is available in the connected vault or browser. API tokens are not dashboard login credentials. AI owns obtaining valid provider account authority, an exact credential/provider/all-consumer rotation plan with independent APPROVE, replacement distribution, verification, and old-key revocation. Consumers include protected Muse stores/OpenCode on managed machines, the Railway direct Meta worker, and the proposed edge consumer; finish inventory before approval. Do not create a new edge consumer using the compromised value. No edge-key installation, 100-row reset, or 133-PDF backfill was performed.

The reviewed operations scope is [the app release note](https://github.com/u2giants/popdam3/blob/46dd78567bc99516d294867923f5b242be2fbd3e/verification/popsg-readiness/repair-2026-10-11.md): database proof → app deployment → safe key install → normal idle updates → exact backed-up guarded 100-row reset → normal backfill and final QA. Keep the original review head immutable while its approval is needed.

### Reviewer capability repair is partial

[ai-devops PR #1581](https://github.com/popcre/ai-devops/pull/1581) merged as [6445c837c60c34b2d87294cecdbf7e225d3f1fde](https://github.com/popcre/ai-devops/commit/6445c837c60c34b2d87294cecdbf7e225d3f1fde), tracked by [#1580](https://github.com/popcre/ai-devops/issues/1580). Qwen's full prompt now uses private 0600 NDJSON stdin rather than a single huge argv value; containment, model, endpoint, and tools are preserved. All 114 offline tests passed and supported live qualification passed at 6:39 PM EDT. Wrapper digest 49e5cf3aef17183f554971529a794021ad381aad2f964c6e0c4c8c10a83d6111; runtime 0.21.14.

The exact pinned installer was independently APPROVED by the supported GLM front door and advanced the clean canonical toolkit checkout to 6445c837. Managed artifact verification passed. Installation is still INCOMPLETE because its required private memory seed union failed health: two existing Claude indices are 13,246 and 12,386 bytes above the 12 KB limit. Divergent private-memory snapshot refs were preserved; no outgoing union push is claimed. Do not reset/discard private memory, disable the seed, skip its required stage, or update memories without Albert explicitly requesting that work. This is a separate retained installation blocker, not a finished installation.

Actual Qwen sandbox recovery probe used image ghcr.io/qwenlm/qwen-code:0.21.14 and preserved full tools, but returned insufficient_quota with zero input/output tokens: monthly Token Plan exhausted, reset November 1 at 11:00 AM EST. The model was not switched. Qualification success alone does not prove a complete large-input Docker review. Its original E2BIG session remains recovery-required with no resumable provider ID; retain it. Qwen is quarantined for the real out-of-credit condition. Do not claim full runtime repair acceptance.

## 4. Tried approaches that did not work

- Matching-search QA once counted an earlier default response, a false acceptance now withdrawn. Correlate every response with p_mode and exact p_query.
- Merely materializing the parser fixed Files but not Guides. Parser variable alone, custom planning alone, and split tags alone did not safely fix both modes. Final bound constant Guides query plus separate metadata/tags passed the measured ceiling and JSON equivalence. Do not repeat discarded variants or increase statement timeouts.
- A direct ai-review-engine invocation produced advisory metadata without implementer/review_mode; it is not gate authority. Supported ai-review --implementer codex reports were obtained for app shipment and toolkit installation.
- Literal synthetic bearer fixture text was redacted by the reviewer copy and caused a false rejection. Equivalent joined fixture text preserves the test without that redaction mismatch. Never expose real credentials to work around redaction.
- Shared risk assessment requires the literal production-risk-assessment fence. A json fence was not accepted. Source review alone is not risk authority.
- Nonclosing Refs binding sent the structural search PR into maintenance evidence-pair handling. PR #4213 now says Closes #4210; keep that exact structural binding.
- A diagnostic mistakenly treated the quota-cache timestamp field as remaining allowance and reported a GitHub limit. It was corrected: GitHub quota was available. The actual delay was coordination contention, not a quota reset.
- Optional process diagnostics exposed a credential. Never dump raw process arguments or environments again; use only PID, parent, elapsed, state and command name if essential.

## 5. Key findings

Library baseline: 220,218 active files; 217,998 previews; 2,220 explicit render exceptions; zero unexplained missing previews and search queue zero. This does not prove search or PDFs. Cached guide/folder matviews must catch up after the new crawl through the real scheduler. Old render queue has 119 June 20 claims, zero current leases; do not treat those as live work or clean them as unrelated repair.

App tests: 27 focused edge tests, 35 bridge tests, Windows checks/11 TIFF tests/build, root build and changed lint passed. Full root suite had 557 passes/one skip/two load timeouts; affected files passed 12 standalone. Worker had 307 passes and two cancelled unref tests; the three bounded-dependency tests passed with a private keepalive harness. Do not report an unqualified full worker suite pass.

Signed-in default library browsing with visible previews succeeds. Common “Disney” failures returned 500/57014 before this search repair. Final UI proof must show matching and unmatched queries in Files and Guides, correct counts/visible results, filters and stable paging without matching a stale response. Do not rely on warm-cache success alone.

## 6. Exact next steps and verification gates

1. Reconcile the pending current-head reviewer draw and superseded old leases through supported coordination tooling. Preserve old BLOCKED/partial artifacts. Refresh main, merge source without losing owned changes, push, update the brief head, and draw fresh slots with --admit-issue 4210. Gate: two independent current-head durable APPROVE verdicts and all required checks pass.
2. Guarded merge PR #4213. Obtain a correct fenced production-risk assessment pinned to the actual merged preview main, allowlisting only 20261011220717 and source PR 4213. Use the supported merged-preview selector, live preview ledger, fresh dry run/apply, and automatic production qualification. Gate: automatic production succeeds; read-only .github/live-proofs/4210.sql is true on Virginia. Never manually dispatch production or execute production DDL.
3. Follow crawl 0c34cc2e-2d23-4e60-8f6e-eb1cbf8bbc70 through actual refresh and search drain. Gate: truthful completed status with every required timestamp, guard acceptance, zero stale remaining and zero search queue; previews remain accounted for. Keep ordinary-night proof pending separately on #107.
4. Obtain valid Meta provider account authority, finish all-consumer inventory and exact reviewed rotation, install replacement only through protected secret transport, verify every consumer and revoke the exposed key. Gate: original capabilities still work with the fresh credential and old credential is revoked. This is blocked, never an ask for human approval.
5. Under the reviewed production operations scope, back up and reset only the exact exhausted 100 active identities in one guarded transaction, then run ordinary backfill covering those plus the 33 new rows. Gate: active PDF counts close exactly, only genuine explicit size/render exceptions remain, searchable text and queue drain are verified. Do not switch the selected model.
6. Run signed-in response-correlated common and unmatched searches in both modes, filters and paging, plus preview and update checks. Record aggregate-only evidence on #335 and readiness #107. Gate: ordinary customer-visible behavior passes, not just HTTP/deploy status.
7. Preserve toolkit installer state and #1580's two distinct blockers: private-memory seed authority/health and provider monthly quota. Repair only within explicit authority; never suppress the capability or falsify completion. Gate: supported installer finalization plus a successful complete >128 KB Docker/tool review with original containment, not tool-less qualification.
8. Complete the two qualifying ordinary changed-night windows on #107 when they actually occur. Close #335/#107 and retire this handoff only when all their deliverables are proved. No reminder/automation is configured by this chat; do not promise background monitoring.

## 7. Constraints and gotchas

Dedicated current-upstream worktrees for every write; canonical checkouts are landing-only. Preserve all concurrent dirty/untracked source and existing handoffs. Stage owned files only, never force-push or directly push protected main. Use the shared ai-gh transport and bounded event-aware waiter; respect five-minute contention retries. Exact-head independent approval gates technical production; never ask Albert to approve. Sign every GitHub post with this chat and hetz. Human-facing times use America/New_York and name EDT/EST.

1Password access is serialized and values move only through protected files/pipes. Never inspect process args/envs, browser JWTs, licensed file paths, or raw authenticated traffic in output. Query aggregates only, target Virginia immediately before every write. Shared structural claims are fresh and exact; claim #4212 expires October 12 around 6:06 AM EDT and must be renewed/recovered if necessary. No NAS host edits or durable SSH infrastructure changes. Broad NAS reads use the existing long-running operation procedure without increasing production timeout.

## 8. Access and environment

GitHub and the Virginia read-only database credential path work. 1Password vault vibe_coding owns DB password, Supabase CLI token, QA login, NAS service login and Meta credential; no values belong here. The connected browser has PopSG login capability but Meta/GitHub dashboard authentication is unavailable. The exposed Meta API token is not an account login and must not be used for new consumers.

Immutable app review candidate codex/popsg-readiness-proof at 152d7ac3f6cbfc6639fcd473afc1c08d335a2bae retains the proper Muse final-check APPROVE and reviewed production scope. Immutable DB update candidate codex/popsg-refresh-reliable at f7842c9a retains the finished source. Search candidate codex/popsg-common-search retains current tests/evidence and failed probes privately on hetz; no private artifact should be copied to a public repository. The owned postgres15 disposable fixture used for contracts is still present and may be removed only after confirming exact ownership; retain relevant output first.

## 9. Open questions and risks

October 11: full controlled-run completion is unverified, common search is implemented but unpublished, PDF recovery is blocked by provider account authority, and two ordinary changed-night windows are future. Root owns all immediate continuations; no subagent was spawned. Do not label another session active without a fresh status view.

Root caused the credential exposure and owns secure replacement/revocation. Source tests do not remove that incident. The toolkit installation/private memory seed is incomplete and Qwen's monthly quota is exhausted; the original large-input runtime capability is not fully accepted. Preserve both, rather than removing the original tool or seed. There is no business question waiting for Albert.

Posted by Codex chat 01a12c68-44b8-7bb3-b1d4-98cb375b6859 on hetz
