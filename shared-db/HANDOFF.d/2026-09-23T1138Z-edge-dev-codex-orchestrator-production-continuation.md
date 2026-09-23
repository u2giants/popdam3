---
issue: 3401
status: BLOCKED
owner: Codex chat 01a0cb03-daa2-79d2-85fd-6a8904abfc53 on EDGE-DEV; successor must claim a new route
---

# Shared database orchestrator closeout, 2026-09-23

This is the successor to `HANDOFF.d/2026-09-22T2028Z-916-codex-orchestrator-closeout.md` (merged PR #3402). It records only this session's changes and fresh observations; the older file retains its detailed preexisting worktree inventory and constraints. Issue #3401 remains the non-structural acceptance record for the predecessor handover. This file is write-once; do not edit either predecessor file.

## 0. Decisions only Albert can make

**Blocking decisions, ask together before an irreversible step:**

1. **HTS production route, #2995.** The activated automatic promotion failed before any production write on an access-risk gate. A read-only current-main requalification succeeded, but no manual production dispatch has been authorized. Recommend keeping automatic-only until an independent reviewer and the current policy qualify one exact recovery action; if Albert wants a manual recovery, he must name its exact resource and action in a new chat. An async question was sent this session and remains unanswered. This blocks #2995 production acceptance and keeps #3418/#2478 behind the serial promotion ordering.
2. **DesignFlow target for #3400.** The issue names `dflow`, while the observed current Cloud SQL database is `designflow` and the future Supabase target is `dflow_prod`. Recommend getting the owning DesignFlow engineer's explicit target mapping before schema authoring. The owner question sent this session remains unanswered.
3. **Reviewer installation on EDGE-DEV.** Merged ai-devops PR #699 repairs the WinGet 1Password link, but `ai-task-gates check --before deploy` refused local installation of protected reviewer tooling without an exact owner-named resource and action. Recommend explicitly authorize installation of that merged commit on EDGE-DEV if still wanted, then have the next session re-run the gate; no bypass or local install occurred. The async exact-authorization question remains unanswered.
4. **916-ALIEN private work access.** Albert said the machine is available. The original Disney and protected migration author worktrees are on its D: drive and remain outside this EDGE-DEV filesystem. Recommend opening Codex Desktop on 916-ALIEN, resuming task `01a0bf00-fa7b-73d1-b447-fc4c89c50b96` in its original D: worktree, and sending its task link/ID. Existing SSH authentication from EDGE-DEV was refused; do not copy licensed data through public shared-db.

**Already settled; do not re-ask:** Albert authorized parallel subagents and ordinary blocker resolution; on this session he explicitly authorized reviewing, committing and opening the private Warner readiness checker PR in `u2giants/licensor-source-data` on EDGE-DEV. That PR #91 has merged. No portal capture, source-data load, or unrelated production action was authorized by this answer. DesignFlow `develop` PRs remain Uma-merge-only. Disney outreach is refused. Structural work remains governed by exact claims, independent reviews, preview, guarded merge and production gates. For technical production approvals, use the independent-reviewer ruling in AGENTS.md; do not infer approval from a handoff.

## 1. What this application is

`popcre/shared-db` is POP Creations' canonical shared Supabase structure repository. It governs schema shape and curated Master Data loads for CRM, DAM, PM/PIM and DesignFlow. GitHub's `db-work` issue queue and live marker route structural work. Preview is one mutable rehearsal database; production project reference is `qsllyeztdwjgirsysgai`. Application row repairs, private licensor capture, and ai-devops reviewer tooling have their own repositories and owners.

## 2. Goal and why this session existed

Albert requested resuming the production program from merged PR #3402 and the 916 closeout, revalidating live GitHub state, preserving reviewer/author locks, and working independent issues concurrently. This session claimed marker #3405 with its own route, dispatched isolated agents, recovered several authored PRs, and advanced read-only and application checks. Albert then invoked `$wrap-up`; that froze new scope. This file hands over remaining obligations without claiming the production program complete.

## 3. Current state and verified delivery

### Fresh coordination snapshot

- At **2026-09-23T11:56Z**, fetched `origin/main` was `005930613f4881e2d35834ed6c7181183358a2f2`, after another task merged PR #3186. Highest migration filename on that main was `20260920202755_hts_rag_classification_jobs.sql`. Re-fetch both before any gate; today's other PRs have moved main repeatedly.
- At 11:56Z, `node scripts/check-orchestrator-marker.mjs --resolve` found exactly one open marker, #3405, route `01a0cb03-daa2-79d2-85fd-6a8904abfc53` on EDGE-DEV. Close this marker **last** after this handoff PR is merged and closeout gates pass. The next orchestrator opens a different marker and route.
- A current native `--queue-audit` completed with `fullyAudited:true`, `dispatchable:[]`, `unlabelled:[]`, and four expired claims. Protected object/version claims remain; expiry is not abandonment. No new structural author was admitted from this snapshot. The queue is already seeded by open issue records; #3401 holds predecessor acceptance and #3405 holds this continuation until closeout.
- **Preview is not proven clean.** #2995's prior preview run #35817992979 succeeded and yielded artifact #10732840061/digest `sha256:4b0f0fd4dce8a5281b42e49ffd3f1bb5462e56d4839e0b2ce510cce8806de00c`. This session did not do a fresh preview catalog/ledger read at closeout. Treat the contents and selector as live moving state; resolve them before any new dispatch.

### Structural queue, precise states

- **#2995 / PR #3382:** version `20260920202755_hts_rag_classification_jobs.sql` guarded merged at `c384c26`. Automatic production run #35819078625 failed at its business-risk gate before write. Version absent from production's 676-entry ledger at the last read-only check. A fresh independent Muse substantive review approved read-only requalification only. Evidence workflow run #35844120279 succeeded, artifact #10741774422/digest `sha256:9f44effd5c827e184ca56295cd9606ce4d060bc05aca084281165913d0ba0035`, bound to then-main `57c2c307`; current main has moved to `005930613`, so do not silently carry that binding. Signed issue update: https://github.com/popcre/shared-db/issues/2995#issuecomment-5792528549. No manual promotion or database write.
- **#3418 / PR #3426:** exact head `9108b45281e224ab1128ef44b37ae785b9952156`, claim #3425, 21 passing/6 skipped hosted checks and two durable exact-head Muse/Grok approvals at last check. Held behind #2995 production route; no merge/write. See https://github.com/popcre/shared-db/issues/3418#issuecomment-5792081609.
- **#2478 / PR #3385:** refreshed exact head `c40a499edc159ed585609ab1d3867a62a4620b14`, claim #2745; 26 hosted checks passed, 277+142 local tests and SQL/probe passed; digest-bound Muse/Grok approvals carried unchanged implementation. Held behind #2995; no merge/write. See https://github.com/popcre/shared-db/issues/2478#issuecomment-5793052212.
- **#2110 / PR #3391:** exact head `97fa9467fda9f40a7159d783a3ac012ceecdb73c`, version `20260920203316`, claim #3378 renewed until `2026-09-23T22:12:43.327Z` using the corrected guarded path. Targeted failed author-lease job rerun #35790764967 attempt 2 passed; all PR checks then green. The original 916 D: author tree, backup/recovery proof and reviewer work are untouched. See https://github.com/popcre/shared-db/issues/2110#issuecomment-5793007246. Do not call it production-ready.
- **#2662, #3175, #3282, #2357:** protected existing PR/claim/worktrees; original 916 D: author trees were unavailable from EDGE-DEV. No claim release, branch overwrite, review lock deletion, or merge. Read each issue and the predecessor's per-worktree appendix before touching.
- **#2870:** both database columns are applied and a read-only live observation found them. DesignFlow backend PR #110 awaits Uma's merge; then rerun application observation/acceptance before #2870 completion or its dependent #2874/#2875 work.
- **#3234** waits on ColdLion answer in #3351; **#3400** waits on target mapping; **#2204** waits on a supported sandbox target route (#3428, repository maintenance). **#1966** has no safe index drop/fillfactor candidate from the current read. **#1275** lacks 11 Warner artwork assets and complete product-catalog reindex; do not infer source coverage from retained rows.

### Other repositories advanced by isolated workers

- `u2giants/licensor-source-data` is the **private repository** whose task gate required Albert's exact authorization. Private Paramount due checker PR #87 and hash fix #89, NBCU checker PR #90, and Warner checker PR #91 merged; #91 main commit `da02b71f0f9c8fc03325490dfb5b8eb8403c5f3d`. These are read-only readiness checks, not weekly authenticated captures or data loads. Private issue #86 remains assigned; Paramount alert #88 is open. Full #2603/#2604 proof requires original 916 source sessions.
- `u2giants/popdam3` manual aggregate diagnostic run #35851331579 found 95 missing/wrong style-group assets and opened assigned alert #153. Wording PR #154, target-guard PR #156, and null-aware ingest repair PR #155 merged. PR #155 main commit `521ddfbb5c24f146634c460d1b3a9b51038f6c11` automatically deployed all 13 edge functions in successful run #35854912528. Live `agent-api` ACTIVE v32 contains the repaired predicate. Read-only follow-up saw **zero assets created/updated/seen after deployment**, so new-ingest behavior remains unproven; #153 stays open for a natural ingest and aggregate recheck. Do not claim the historical 95 rows are repaired.
- `popcre/ai-devops` PRs #693, #698, #699, #700 and #692 merged for reviewer batching, Windows lock race, Qwen installer link, reviewer-pool session naming and task-gate classifier speed. PR #684 private reviewer sandbox repair remains **open** at old head `4f018743` despite green old-head CI; root audit found allowed packet/manifest injection risk. The author preserved repair commits `624c47fa` and `5df0d741` locally on isolated branch `codex/pr684-packet-publish-20260923`; a final-head focused hostile suite passed 10/0, while broader 99/0 sandbox and 138/0 packet suites ran on the preceding commit. The old-head Claude review still held a live process/reservation with zero-byte report at 11:47Z; preserve it through supported terminal return. Then push/update PR #684, run final-head hosted CI and a new independent exact-head review. PR #666 policy continuation was not started here.

## 4. What we tried that did not work

- SSH to 916-ALIEN reached the host but returned `Permission denied (publickey,keyboard-interactive)`. The D: worktrees cannot be assumed available merely because Git's EDGE-DEV worktree registry lists their old paths. Use the original authenticated 916 task/session; do not copy private records into public GitHub.
- The first PR #3391 claim renewal refused a historical extra lock and then refused while the issue scope said `blocked`. The merged guard fix PR #3419 and a supported guarded scope transition to `ready` allowed renewal; do not hand-edit claim refs or repeat the failed unguarded route.
- ai-devops reviewer-safety `deploy` gate refused local installer promotion despite merged PR #699: `STOP. "deploy" is forbidden for the protected class reviewer-safety... needs Albert naming exact resource and action`. Do not call `ship` as a substitute or treat merged code as installed behavior.
- The scheduled PopDAM read-only observer had not run at 11:01Z; a manual diagnostic was explicitly reviewed and dispatched, and is recorded as manual. No daily clean series can be inferred.
- The first PR #684 sandbox design allowed reviewer-visible, unverified packet paths. Even after initial repair commit `624c47fa`, a hostile self-hash manifest test found a gap. Second local repair `5df0d741` stages packets outside the export and passed focused hostile tests. Hold merge until old review terminates, final-head CI and independent exact-head review pass.

## 5. Root causes and durable findings

- The **serial preview lane** is a shared one-at-a-time migration apply lock, so it can affect future sessions whenever several migrations are ready together. It is a safety property of a shared mutable rehearsal target. Parallel authors, independent reviews and read-only evidence can proceed now; genuinely parallel applies require separate isolated preview databases plus target identity and evidence guards. The latest fully audited queue has **zero dispatchable** structural items, so preview serialization is **not the current active blocker**. Do not loosen the one-at-a-time lock to manufacture throughput.
- Current #2995 production risk is authorization/evidence, not simply compute capacity. The automatic lane stopped before write; read-only requalification is not an apply authorization and must be rebound if main moves.
- PopDAM historical drift includes SQL NULL semantics: `.neq` excludes `style_group_id = NULL`; PR #155 widened the predicate. The verified deployment did not encounter a new ingest yet, so it cannot prove behavior or repair old rows.
- A protected author lease's expiry does not remove object/version reservations. The queue may have no dispatchable work while many agents can still do independent app/private/repo tasks.

## 6. Exact next steps and verification gates

1. From a fresh current-upstream worktree, read this file, the predecessor file and AGENTS.md; fetch, resolve marker, then **claim a new marker and route** after #3405 closes. Verify one clean live resolver result naming the successor, not this route.
2. Run the supported queue audit, live claim/lease reconciliation, PR head/check/review inventory, and current main/maximum version check. Verify `fullyAudited:true` or record exact refusal; do not interpret `dispatchable:[]` as an empty program.
3. Resolve the consolidated decisions in §0 before dependent actions. Re-read #2995's current scope, risk gate, production ledger, current-main evidence, preview digest, target identity, fresh dry-run/exclusive lock and activated workflow. Verify exact immutable evidence for the current main and obtain the required independent authorization before any production write. Never run a manual action from this handoff alone.
4. Continue #3418, #2478, #2110 and other protected structural PRs in their existing claim order after #2995's route is settled. Before each gate verify exact head, claim objects/version, two durable reviewer verdicts, current main, target, preview selector/ledger and merge eligibility. Use guarded merge, merged-main preview and automatic production lane where applicable; verify production artifact, live catalog and application acceptance separately.
5. On 916-ALIEN resume the original D: source/author work after authenticating through that machine's own Codex task. Verify clean/dirty worktree and branch before any edit; preserve private source artifacts and review reservations. Do not use EDGE-DEV's stale D: registry entries as filesystem proof.
6. Separate app/private outcome sessions complete their own live proofs: DesignFlow PR #110 after Uma merge; PopDAM #153 after a natural ingest; private #86 weekly authenticated captures. Verify live result, not PR merge or read-only readiness checker alone.
7. For ai-devops #684, preserve local repair branch `codex/pr684-packet-publish-20260923` and old-head Claude reservation until supported terminal return. Then run remaining final-head suites, push/update PR #684, hosted checks and a new independent exact-head review; merge only if containment is proven. Resolve Qwen local-install gate by owner instruction, not bypass. Keep #666 separate.
8. When any issue outcome is genuinely live-verified, use the repository's supported completion path and signed issue comment; close only issues this session opened or whose lifecycle explicitly allows orchestrator closure. Preserve open handoff/claim records until their own acceptance gates pass.

## 7. Constraints and concurrency

- The orchestrator owns only database shape or curated Master Data. Proof, monitoring, scripts, private capture, docs and application rows stay in their own sessions. Every shared-db issue requires `db-work` and a valid scope fence; current queue audit found no unlabelled issue.
- Canonical checkouts are landing-only. Use a unique current-upstream worktree for each writer; verify branch before each commit, stage only owned files. No count ceiling on authors/reviewers; keep exact object/version collision locks and the serial preview, guarded merge and production lanes.
- Never reset, clean, delete, retire or edit the original 916 D: worktrees, dirty predecessor trees, reviewer reservations or another session's `HANDOFF.d` file. This session deliberately preserved them. Git worktree registry contains many stale/machine-remote entries; registry membership is not safe cleanup authority.
- `C:/repos/shared-db` was already on older `main` and had other sessions' untracked files when inspected. This session did not stage, move or delete them. Closeout prose lives only in `C:/Users/ahazan/.codex/worktrees/shared-db-orch-closeout-20260923/shared-db`, branch `codex/orch-closeout-01a0cb03-20260923`; retire only after its PR is verified merged and safe cleanup rules pass.
- The old #3297 marker is closed; this session's #3405 marker must close last. A successor must not copy either old route ID. Sign each GitHub body/comment/review with the current task and machine.

## 8. Access, secrets and environment

EDGE-DEV PowerShell and `gh`/`ai-gh` worked for read-only GitHub and guarded repository actions. This session used dedicated worktrees under `C:/Users/ahazan/.codex/worktrees/`. The original 916-ALIEN task ID is `01a0bf00-fa7b-73d1-b447-fc4c89c50b96`; its private D: worktree is on that machine. Secrets remain in 1Password vault `vibe_coding`; refer to item IDs there, never values. Production Supabase reference is `qsllyeztdwjgirsysgai`; prove it again immediately before any action. **Secrets sweep:** inspected this session's intended prose diff and known untracked paths without opening private evidence/auth stores; no new credential, token, connection string or `.env` was created or exposed here. **Docs pass:** no standing AGENTS.md or procedure rule became false; this handoff records the session's moving facts and lessons, with no edits outside this new file.

## 9. Open questions, risks and self-audit

The owner's three unanswered decisions and 916 access path are consolidated in §0. Main, preview and PR heads can move within minutes; the recorded snapshot is not permission to dispatch. The private weekly checkers prove due status only. PopDAM's deployed fix needs a real post-deploy ingest. PR #684's independent review at old head cannot approve its new security repair. No production migration application or destructive work occurred in this session.

Self-audit after reading §0–§9 and the agent blocks: **Yes**, a new developer can continue without this chat because §1–§3 identify the system, exact commits and work states; §4–§5 preserve failed attempts and causal findings; §6 gives ordered actions with success tests; §7–§8 preserve boundaries and access; §0 contains every owner decision found in §1–§9 and the agent blocks. Unknown moving state is expressly a fresh read gate, not a guessed answer. The predecessor file supplies unchanged older worktree detail. No new issue is needed for a deferred item: each remains on its named open issue/PR or the private #86/#153 records.

## Agent continuation records

### Agent: `/root/audit_2357_recovery`
- Asked/read: independent read-only PR #692 review-thread audit; touched no files. Found exact head `d9e2ee0`, no unresolved threads, CLEAN. PR #692 later merged by root. Worktree: none. Deliberately did not merge or alter schema.

### Agent: `/root/audit_3282_recovery`
- Asked/read: refresh protected #2478 PR #3385 without changing the implementation. Pushed fast-forward head `c40a499e`; hosted/local/evidence checks passed and both reviewer approvals carried. Original two worktrees preserved; no merge or DB dispatch.

### Agent: `/root/fresh_orch_queue_triage`
- Asked/read: current structural queue and #2870 acceptance. Confirmed two applied columns and backend PR #110 awaiting Uma. No files or database rows touched; no self-merge.

### Agent: `/root/nbcu_weekly_prep`
- Asked/write: private NBCU weekly due checker. Private PR #90 merged, tests/checks passed; private issue #86 still owns authenticated refresh/proof. Its isolated source worktree is finished but should only be cleaned under private repo policy. No capture/load.

### Agent: `/root/popdam_deploy_guard`
- Asked/write: protect PopDAM merge-triggered deployment target. PR #156 passed six target cases, hosted checks and review; root merged it before PR #155. Agent did not deploy or merge. Worktree clean, retired only after verified merge policy.

### Agent: `/root/popdam_drift_95`
- Asked/read/write: investigate 95 drift rows, prepare null-aware PR #155 and monitor production. Root reviewed/merged #155; automatic run #35854912528 succeeded; live function v32 contains fix; no post-deploy ingest has occurred. Preserve issue #153 and its original worktree until live behavior proof. No row backfill was performed.

### Agent: `/root/private_weekly_2603`
- Asked/read/write: private source/readiness and PopDAM observer evidence. Private Paramount/NBCU checkers and PopDAM wording PR #154 merged; manual run identified 95 drift rows and opened assigned alert #153. Scheduled daily observation had not run at 11:01Z. No source capture or DB write.

### Agent: `/root/prod_2995_requal_evidence`
- Asked/read: read-only current-main #2995 requalification. Run #35844120279 succeeded with artifact/digest in §3. No production workflow dispatched, no migration applied. Evidence was bound to main `57c2c307`, now stale for head `005930613` unless supported carry/requalification proves otherwise.

### Agent: `/root/qwen_3418_recovery`
- Asked/read: targeted #2110 author-lease check at unchanged PR #3391 head. Rerun passed. Did not change claim, review, branch, worktree or DB state.

### Agent: `/root/qwen_prelaunch_repair`
- Asked/write: install merged Qwen reviewer wrapper on EDGE-DEV. Gate refused protected deploy; agent preserved canonical checkout and installed launcher. No install and no capability replacement. §0 carries owner action.

### Agent: `/root/review_pool_session_name`
- Asked/write: ai-devops PR #700 reviewer session-name repair. Focused tests, hosted CI and Muse exact-head review passed; root merged it. Local installed behavior remains unverified. Isolated worktree finished, cleanup only after merge verification.

### Agent: `/root/sandbox684_root_audit`
- Asked/read: independent PR #684 security audit. Found reviewer-visible unverified packet paths; exact old head `4f018743` was unsafe. No files touched. Root held merge.

### Agent: `/root/ship_sandbox_684` and child `/audit_684_security`
- Asked/write/read: repair PR #684 in isolated `C:/Users/ahazan/.codex/worktrees/ai-devops-pr684-packet-publish/ai-devops`, branch `codex/pr684-packet-publish-20260923`. Initial commit `624c47fa` passed public sandbox 99/0 and packet 138/0 tests but child audit found manifest self-hash injection. Second local commit `5df0d741` stages code-only packets outside reviewer exports and passed final-head focused hostile tests 10/0 plus static checks. **Not pushed or attached to PR #684 yet**: old-head Claude review process/lease was still live with zero-byte report. Preserve that review through supported terminal return, then push/update PR and obtain final-head hosted CI and independent exact-head review. No merge, install or lock deletion. Child did not edit files.

### Agent: `/root/warner_1275_coverage`
- Asked/write: private Warner weekly checker under Albert's exact authorization. Fixed two false-success cases, pushed PR #91 head `a0a18b25`, seven tests and hosted verification passed. Root reviewed and merged it at private main commit `da02b71f`. No portal capture, data load or external private review.

### Agent: `/root/resume_policy_666_new`
- Reserved for separate ai-devops PR #666 continuation but remained `pending_init`; no file, branch, review or issue mutation attributable to it. Do not infer work started. Separate successor should revalidate PR #666 after #684.

### Agent: `/root/queue_dispatch_survey` children: `/hts_bff_step6`, `/hts_frontend_client`, `/hts_frontend_rfq_grid`
- BFF child pushed DesignFlow BFF PR #33 with 22 focused tests and two PR checks passing; Uma merge remains pending. Frontend client child pushed `bd101309` then safety fix `4273d3db`, eleven tests/TypeScript passing; frontend RFQ child pushed `f339cb0e`, `a95bce24`, `f511241d`, TypeScript and marker tests passed, one RFQ mock-only reset case repaired and rerun. Their isolated worktrees/branches stay with application owners; no DesignFlow self-merge or shared-db mutation. They deliberately left full sandbox/UI billing/RFQ acceptance unclaimed.

### Agent: `/root/hts2995_acceptance/hts_tasks_internal`
- Asked/write: HTS job runner implementation. Pushed isolated branch at `f7fee7e`, 27 focused tests and lint/ship gate passed. Runner stays disabled until its required configuration and production table are actually available; no live worker acceptance was claimed.

### Agent: `/root/audit_3282_recovery` and `/root/audit_2357_recovery` preservation note
- These audit agents did not assume ownership of the predecessor's protected original D: author worktrees. Their analysis/refresh does not authorize cleanup, claim release or PR merge.
