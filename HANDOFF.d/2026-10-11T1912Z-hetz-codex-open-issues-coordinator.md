---
issue: 143
status: OPEN
owner: codex/open-issues-coordinator-20261011
---

# New-session coordinator prompt: clear the PopDAM issue queue

Snapshot: October 11, 2026, 3:12 PM EDT. Repository: https://github.com/u2giants/popdam3. Baseline origin/main: f34a789976ca. This is an execution handoff, not a claim that the remaining issues are finished. Copy the prompt in section 6 into a new PopDAM session; have that session read this entire file before dispatching work. Later issue comments, deployed evidence and standing instructions take precedence over this snapshot.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

Consolidate genuine unanswered business questions into one concise message after checking current issue history; continue independent technical work. Never ask Albert for technical approval, sign-in, commands or infrastructure setup.

- **#277: source corrections.** Albert's recorded instruction is “No answers yet; keep uncertain records unchanged.” The protected 443-row review workbook is unanswered. Recommendation: preserve the hold until business reviewers provide row-level decisions; no inferred corrections, guessed identifiers or blanket imports. This blocks only those corrections, not other issues. Do not re-ask an already answered hold as permission to proceed.
- **#196: Enterprise license.** The earlier documented vault search found no AG Grid Enterprise key. Recheck authorized records first. If no purchased entitlement exists, recommend keeping the existing capabilities and obtaining the required license. A purchase/business decision is Albert's; technical installation and verification are the AI's. Never disable features to make the warning disappear.
- **#96: pilot business acceptance.** Produce the approved 28-SKU pilot scorecard before asking Albert to judge it. Recommendation: assess the existing plan's criteria, preserving the approved model and metadata scope. Full rollout and dependent #97 enablement remain gated by that business acceptance; do not invent acceptance from successful processing.

Already settled — do not re-ask:
- Albert explicitly requested this artifact in chat: “give me a prompt to have a new session act as coordinator and spin up individual subagents to clear all the Issues”. This authorizes the new coordinator to dispatch subagents for this PopDAM campaign. It does not authorize guessing business data or bypassing production/database review.
- Owner standing rule: “never ask a human to approve”; technical actions use assigned AI reviewers and task gates.
- #277 uncertain records stay unchanged. Source dates and provenance remain exact; Customer PO# means sales order #.
- #179 history explicitly says the re-exposed NAS **popdam** credential was “Not rotated, per Albert”. Preserve that no-re-rotation direction. Separately, the secrets skill protects the hetzner_vps 1Password token; distinguish these credentials instead of extrapolating a universal prohibition.
- #162 requires boot without interactive logon; do not force a reboot or alter Windows Update merely to obtain a receipt without an independently reviewed exact plan.
- #96's 28-SKU pilot was approved September 23. The retained handoff records Muse Spark 1.3 Contributor as the only model for Image Tagging/profiling/PDF text and same-model JSON repair. Reconcile live MODEL_RULES and owner history before any call; this prompt does not authorize a model substitution.

## 1. What this application is

PopDAM is POP Creations' artwork library, used by the design and licensing teams. PopSG is the related licensor style-guide library. The same React frontend serves https://dam.designflow.app and https://sg.designflow.app. Supabase edge functions and the shared Virginia database support both; a Railway worker processes bulk jobs; Synology bridge and Windows render agents handle files/thumbnails; an Electron Helper handles checkout/check-in.

Application source is /worksp/popdam (u2giants/popdam3). Shared database structure and curated Master Data loads belong in /worksp/shared-db (popcre/shared-db). Durable host configuration belongs in /worksp/ansible. GitHub identities u2giants and popcre have distinct repository scopes; use the actual repository identity.

## 2. What this session set out to do, and why

Albert first requested a stale/superseded audit, then updates and necessary live verification for #162, #143, #96, #97, #201 and #223. Those six body updates were delivered and read back. He now wants a fresh coordinator to clear the whole remaining PopDAM queue with individual subagents, preserving ownership, dependencies and direct live evidence.

The goal is to finish every presently actionable issue, safely coordinate genuine dependencies, and leave exact owned blockers on the original issues. An empty issue list is not an excuse to close unmet requirements or override business holds. This session creates the prompt; it launches no campaign subagents or background work.

## 3. Current state — what is true right now

### Completed predecessor work

- The October 11 audit of all 23 then-open issues is on #143, comment https://github.com/u2giants/popdam3/issues/143#issuecomment-6111553636. Its stale snapshot is superseded by later receipts below.
- All six requested issue bodies were updated and read back. #223 and #219 are closed after nine signed-in search checks across admin/designer/viewer, appropriate admin-only embedding-status access, and invalid-token rejection. Do not re-open these simply because older comments reported a transient unauthorized response.
- #97's **saved** semantic floor was tested through the actual Settings UI and search: 46 baseline results, six keyword matches retained, 40 weak semantic-only matches removed at floor 0.99. The temporary setting was guardedly removed and original absent-row configuration restored. Keyword mode remains default; automatic embedding remains off. The independent review and this live check both finished. No temporary production setting remains waiting for restoration.
- Other sessions subsequently closed #153, #169 and #197. #153 now auto-resolves after clean scheduled measurements (#337); #169 closed with explicitly inconclusive attribution and structural follow-up at shared-db #1966; #197 has live proof for all component splits. Preserve their acceptance limits rather than restart closed work.

### Every open issue at the snapshot (19)

| Issue | Current remaining requirement | Dependency / closure gate |
|---|---|---|
| [#335](https://github.com/u2giants/popdam3/issues/335) | Nightly PopSG refresh timeout and misleading reconciling failure state. App retry/lifecycle fix #336 merged cfb36150 and edge deployment succeeded 2:12 PM EDT October 11. | Observe ordinary 10 PM EDT crawls after deployment; verify truthful terminal state and refresh_completed_at. Durable off-request-path refresh may still be needed; coordinate with #107/#293. |
| [#107](https://github.com/u2giants/popdam3/issues/107) | Library completeness mostly verified; second-change-night acceptance fails because five of ten nights timed out. | #335; verify required changed nights, write final acceptance and retire completed plan/docs as specified. Latest aggregates: 220,218 active, 217,998 previewed, 2,220 classified exceptions, search queue zero. |
| [#162](https://github.com/u2giants/popdam3/issues/162) | Fresh edge-alien installation currently has only interactive/logon task, no boot trigger. Agent heartbeat works. | Restore boot behavior through canonical host route/review and prove render capability after boot without login. Historical September installation proof is invalid. |
| [#179](https://github.com/u2giants/popdam3/issues/179) | Least-privilege render account, drive mappings, NAS ai credential/scripts, hetz ai exposed password, and plaintext storage closeout. | Preserve popdam no-rotation instruction. Latest Claude chat 7623097e-a8da-4712-8cab-fb86b5076289 at 2:45 PM EDT October 11 records four rejected exact plans for hetz ai rotation; nothing executed. Freshly verify activity/ownership before touching credentials. |
| [#92](https://github.com/u2giants/popdam3/issues/92) | Restart-safe tagging code and receipt-loss fix #317 shipped; actual provider batch crossing restart with same provider ID/exactly-once clear unproven. | Diagnose/reconcile protected historical external jobs without duplicate submission; recover jobs under review before #96. Never deploy old rejected WIP branch. |
| [#96](https://github.com/u2giants/popdam3/issues/96) | Current approved 28 groups/475 active assets/468 previews have no current group profiles or accepted group tags. | Latest 2:28 PM EDT check found destructive rebuild already fixed by 67685c55 on October 2; missing profiles are from that wipe, not ongoing destruction. Re-profile approved cohort after governed #92 recovery, tag files, prove profiles survive next rebuild, produce scorecard, obtain business acceptance, then finish rollout. |
| [#97](https://github.com/u2giants/popdam3/issues/97) | Saved floor passed. Embedding coverage, restart/lease/retry acceptance, relevance/access/pagination/fallback, guarded enablement still open. | #96 acceptance. Earlier aggregates: 149,703 docs, 4,584 embedded, 145,119 pending. Old interrupted embedding operation is not proof of progress. Keep keyword default and automatic embedding off until gates pass. |
| [#95](https://github.com/u2giants/popdam3/issues/95) | Eleven AAH62NBEX01 assets need canonical licensor/property; no current NBC attribution, still unclassified. | Warner source resolves WARNER BROS / “Exorcist, The (1973)”. Curated property shared-db #4172 / PR #4176 blocked by contradictory allocator admission. Repair canonical tooling under proper scope; no guessed join or ad hoc curated row. Then reviewed application-data reclassification; 11 rows exceed small-owner-entry limit. |
| [#194](https://github.com/u2giants/popdam3/issues/194) | Browser write-only fix #313 shipped; server-only/Vault storage plus live secret containment pending. | shared-db #4168 dispatched to claim #4181. Inspect current claim, actual owner, PR and production proof before dependent app steps. |
| [#196](https://github.com/u2giants/popdam3/issues/196) | Empty Enterprise license remains. | Genuine purchased-entitlement/business prerequisite; do not strip grid capabilities. |
| [#201](https://github.com/u2giants/popdam3/issues/201) | Children #198/#199/#200 closed; #264/#301 shipped. Needs real post-fix installer-upload run with bounded memory and overlap safety. | Earlier UI Downloads works; direct /downloads reload returned 403, recheck current frontend. Existing mirrored state predates #301. Weekly eligible October 16 at 7:44 PM EDT; unchanged-version check alone is not upload proof. Do not falsify timestamps/version to trigger proof. |
| [#206](https://github.com/u2giants/popdam3/issues/206) | Cleanup/relink batching #306 shipped, no post-merge ordinary operation proof in last comment. | Observe matching ordinary worker receipts, validate correctness/final counts, not just deployment. |
| [#216](https://github.com/u2giants/popdam3/issues/216) | CORS tightening #308 shipped; live acceptance undocumented. | Browser workflows from both allowed production origins; reject unintended origins with minimal response; verify legitimate app access remains. |
| [#229](https://github.com/u2giants/popdam3/issues/229) | Agent containment #307 / Helper #311 shipped; deployment/build and live acceptance pending. | Safe escaping-path rejection with normal render, checkout and check-in proof. Do not test against real files with destructive traversal. |
| [#277](https://github.com/u2giants/popdam3/issues/277) | Refresh/integration delivered; held overlap/source corrections unanswered. | Business hold in section 0. Preserve source dates, provenance, corrected PO meaning, row-level workbook decisions; no automatic canonical writes. |
| [#293](https://github.com/u2giants/popdam3/issues/293) | Measured drained backlog and expensive refresh cadence; proposed schedule-only reduction. | shared-db #4190 / claim #4191 / PR #4192 currently refused as non-structural cron.alter_job. Resolve canonical route/tooling without adding token DDL or direct production workaround. Preserve cron safety net while #335 fails; prove schedules, successful runs, staleness and cost after any change. |
| [#294](https://github.com/u2giants/popdam3/issues/294) | App coalescing #325 shipped; database serialization and live overlap proof pending. | shared-db #4174 dispatched to claim #4177. Per-isolate coalescing does not serialize cron/other runtimes. |
| [#295](https://github.com/u2giants/popdam3/issues/295) | Latest measurement found selected=changed inside clear function; waste was whole clear/rebuild stage, already skipped by 67685c55. | No new app fix currently needed. After ordinary nightly rebuild prove zero clear calls and correct/idempotent assignment. Legacy persisted clear state requires reconciliation, not deletion by assumption. |
| [#143](https://github.com/u2giants/popdam3/issues/143) | Original closeout tracker with remaining #92/#95/#96/#97/#107 and #162. | Use as coordination card, link this broader campaign without silently changing original acceptance. Close tracker only when its own obligations finish; other PopDAM issues remain independently accountable. |

### Ownership and shipping status

The predecessor Codex session 01a12bef-d5c6-7ea0-914f-cce83649015c has no campaign agents running. Its local read-only/approved aggregate proof is under /worksp/popdam-live-verification-20261011/.ai/live-verification/20261011; this local path is supplemental, not a dependency for the new session. Durable findings are in the six issue bodies and linked receipts. Do not commit this private proof folder or authentication artifacts.

Other-chat activity was inferred only from fresh GitHub comments, not a live task view; **current activity is unverified**. Shared-db claims already exist for several dependencies. At startup identify current owners and obtain fresh status, then either coordinate existing work or claim unowned obligations. Do not overwrite another session's claim or assert it is working based on an old comment.

This handoff is documentation only, authored in a dedicated current-upstream worktree. Its PR must be merged before delivery; no frontend deployment is needed. Actual PR/merge receipt is posted separately on #143, avoiding a self-referential future commit SHA in this file.

## 4. Everything tried that did NOT work

- Old #96 completion counters claimed 28 profiles, but current cohorts were empty. Group IDs historically changed nightly. Latest evidence shows stable IDs since the October 2 fix; use approved SKU identities, re-profile and observe persistence rather than write a redundant retention fix.
- The September #92 rejected WIP at 653cb150 is historical. Current merged recovery code is newer; production protected jobs still need safe reconciliation. Never deploy that WIP or clear job slots to get around update refusal.
- Supabase search transiently returned unauthorized/HTML during earlier auth validation; repeated fresh signed-in admin/designer/viewer proof passed. Preserve capability, reproduce current behavior first; never broaden roles or bypass authentication.
- SeaDrive memory at idle (~40 MB current, 125 MB two-hour max during prior check) cannot prove installer upload memory. HTTP HEAD 200 cannot prove browser page reload or full upload. Already-current weekly checks may only update checked_at and yield no real upload receipt.
- Raising the request timeout, removing periodic refresh, or merely accepting a failed crawl would suppress symptoms. #336 bounded retry shipped; only ordinary terminal-success proof establishes improvement, and a durable refresh route remains potentially necessary.
- Shared-db curated migration #4176 and scheduler PR #4192 hit contradictory/non-structural admission refusals. Do not add dummy schema changes, relabel work deceptively, inject direct SQL or ask Albert for technical permission. Repair/report the exact canonical routing deficiency with existing owner coordination.
- #179's latest hetz ai rotation plan was REJECTED four times (earlier history had a longer rejection loop). Reasons included consumer completeness, rollback, session persistence, template serialization, /data/coolify search and scrub boundaries. Preserve exact latest reviewer findings and repair the plan before execution; don't restart blind or repeat credential rotation.
- Historical #169 observer activation had rejected provenance/run-boundary proof. That issue now closed explicitly inconclusive with structural follow-up, not permission to activate rejected measurement or change storage.
- Playwright MCP transport closed during prior verification. Local Playwright using installed Chrome worked; repair the connector if appropriate, use supported local harness without reducing application capabilities. Shared auth-session refresh across concurrent contexts caused avoidable contention; give each browser its own fresh sign-in.

## 5. Root causes and key findings

Current source references are stable paths; resolve line numbers against fresh upstream before edits because concurrent work is moving main.

- apps/worker/src/handlers/style-groups.ts and its regression test contain 67685c55's idempotent upsert-first rebuild. Destructive clear/delete previously erased group profiles; current fresh runs skip clear_assets. #96 and #295 share this historical cause but have different live acceptance.
- supabase/functions/agent-api/index.ts implements runSteppableSgRefresh; #336 retries timeouts through bridge continuation for bounded 15 minutes and records lifecycle failures. #335/#107 acceptance must refer to deployed code and later ordinary crawl receipts.
- plan_openrouter_batch_restart_recovery.md STATUS and remaining Steps 8–9 govern #92 provider recovery. plan_style_group_scoped_ai_metadata.md STATUS and Steps 8–10 govern #96 scope, pilot and rollout. plan_hybrid_search_rollout.md governs #97. Read plans through their ends; completing one phase does not complete downstream obligations.
- plan_popsg_production_readiness.md governs #107, including final verification/popsg-readiness/final-acceptance.md and retirement. Do not use old human technical approval text in the September 30 handoff; current standing reviewer gates supersede it.
- A green Railway deployment proves the worker only. Verify frontend served build for browser changes and deployed edge-function behavior for API changes. A completed enqueue cron row proves scheduling only, not worker acceptance.
- Database target is Virginia qsllyeztdwjgirsysgai; retired Ohio ryltkzzernhwnojzouyb can still look active. Prove target immediately before any write; safe management reads previously reported supabase_read_only_user and transaction_read_only=on.

## 6. Exact next steps — COPY/PASTE THIS PROMPT

```text
Act as the PopDAM open-issues coordinator. Albert requested: “give me a prompt to have a new session act as coordinator and spin up individual subagents to clear all the Issues”. Read HANDOFF.d/2026-10-11T1912Z-hetz-codex-open-issues-coordinator.md in full and current AGENTS.md before acting. Scope is every currently open issue in u2giants/popdam3, including newly opened ones; coordinate canonical dependencies without treating this as permission to clear every repository's issue queue.

Own the work through live verification and honest issue closure. Start immediately. Dispatch individual subagents with bounded issue assignments, their own worktrees, exact acceptance criteria and clear limits. Keep up to three subagents active alongside yourself when four slots exist; queue the rest, and do not run conflicting production jobs or edit shared paths concurrently. You own technical decisions, reviewer selection, merges, production actions, business questions and final acceptance; do not delegate those decisions.

1. Fetch upstream and reconcile current open issues, all relevant comments, merged/open PRs, plan STATUS and actual deployed state. Inspect existing worktrees without changing others' work. Obtain fresh ownership/activity for already-claimed issues, especially #179 and shared-db #4168/#4174/#4172/#4190. A historical comment is not current activity. Preserve older handoffs; read only relevant obligations. Verification gate: every current issue has a named owner, exact unfinished outcome, dependency, proof requirement and current activity state on #143.

2. Build the dependency/resource map on #143. Separate business-held #277/#196 and #96 scorecard acceptance from technical gates. Consolidate genuinely unanswered business questions; do not re-ask settled holds. Independent technical work continues. Inspect rejected shared-db routing rather than inheriting a predecessor's route or adding fake DDL. Verification gate: no item is unowned and no dependency is represented as already delivered without evidence.

3. Dispatch initial separate read-only discovery assignments:
   - render_boot: #162, coordinated with #179/#229; establish current Windows installation/task/build and canonical host route, preserving no-reboot/no-rotation restrictions until an exact reviewer-approved action exists.
   - popsg_nightly: #335/#107, coordinated with #293; verify deployed #336, current crawl receipts and missing change-night requirements; propose only the minimum durable fix if retry fails. Do not trigger production or mutate schedules.
   - app_acceptance: #216/#201/#229; verify allowed-origin app flows, direct Downloads reload, deployed agent/helper builds and existing ordinary upload receipts. Record exact gaps; no secret/role bypass, destructive traversal or fake upload trigger.
   Give each worker a primary issue, owned paths/resource exclusions, deliverable and evidence gate; related issues are dependencies, not an unlimited assignment. For writes, each starts its own fresh-upstream worktree and applicable task class. Verification gate: each subagent returns finished evidence/artifact or a specific blocker with the verbatim decisive evidence line, plus its branch/worktree and what it did not do.

4. While these run, reconcile the #92 -> #96 -> #97 pipeline, #95 curated property dependency, #194/#294 database claims, #206/#295 next-night receipts and the #179 security owner. Assign additional individual workers as slots free. Obtain fresh worker status at transitions; resume incomplete reports and act on actionable coordinator blockers. Avoid paid duplicate tagging and simultaneous bulk rebuild/profile/search operations. Mechanical approved implementation follows the repository's model-tier delegation rule; use its named harness rather than inventing a cheaper model. Verification gate: every actionable lane advances; no ready work is left untouched while claiming to wait.

5. Follow each current plan to completion. For #96, re-profile the approved SKU cohort after safe external-job recovery, verify scoped file tags and next-night profile retention, then show the business scorecard before full rollout. For #97, prove embeddings/restart/leases/retry/terminal coverage, role access, relevance, pagination and fallback before gated enablement. For #335/#107, wait for ordinary post-deployment changed-night receipts; for #201, require a real post-fix installer upload, not an unchanged-version poll. For #206/#295, verify actual later worker receipts and zero redundant clear calls. Verification gate: evidence is after the relevant deployment and proves the issue's customer-visible or ordinary-run outcome.

6. Route all structure/curated Master Data through current popcre/shared-db claim/preview/PR rules; durable host changes through canonical Ansible; app source through PopDAM. Start/check ai-task-gates before stronger actions and get independent exact-head AI review where required. If a technical gate refuses, repair the actual capability/routing or preserve an exact owned blocker; never bypass or ask Albert for technical approval. Keep vault access serialized and secrets out of chat, arguments, logs, reviewer snapshots and Git. Verification gate: correct target, independent review, exclusive resource ownership and required preview exist before every stronger action.

7. Integrate in dependency order. Rebase against fresh upstream, stage only owned files, run meaningful required checks, push feature branch, create/attach PR, wait via the repository's bounded event-aware waiter for code, merge authorized PRs through normal policy, then verify the deployed outcome directly. Documentation-only PRs merge immediately normally. Never force-push or write directly to protected main. Sign all GitHub bodies/comments with Posted by Codex chat <actual thread id> on <machine>. Verification gate: shipped changes have correct PR, passing applicable checks, actual runtime proof and updated plan/issue checklists.

8. Close an issue only when every retained acceptance requirement is satisfied. Superseded work needs an explicit replacement link proving all obligations were carried; age and merged code alone are insufficient. Leave missing live proof on the SAME issue, no leftover-proof ticket. Track unexpected real failures on an appropriate existing issue or one genuine new application-need issue. Close #143 only on its original obligations, without masking unfinished separate issues. Verification gate: re-fetch all open issues and account for every deliverable against real evidence.

9. Continue while authorized actionable work exists. If only genuine external/business/chronological dependencies remain, leave each exact state, named owner, next action and required observable proof on its original issue and write your own comprehensive handoff. Do not promise background activity after ending the turn. Every reply to Albert stays within 120 words and ends with Still open for anything unfinished; waiting lines name holder, actual activity and last verified EDT/EST time. Verification gate: final status distinguishes completed work, active observed work, idle holds and blocked dependencies with no unowned item.
```

The coordinator should reuse subagents with follow-up assignments once their owned work is delivered. Root plus three workers is a concurrency ceiling, not a requirement to create busywork. Expand assignments only after proving absence of file/resource collisions. If more capacity exists, preserve the same resource map and gates.

### Approved #96 pilot SKU identities

3DWC01JK, 3FZ66VMNT02, AA866HDPET01, AAA66SSSS01, AAD57DFBNK02, AAH62WBNE03, BGQ55DYCP01, GF162WSEN01, HGP0FDYLS01, HSB88DYLS01, HSR68DYMM01, MDD4FMVSP02, MDX00CBCC02, MEZH1MVSP01, MEZH7DCJG01, MF162DYPN06, MFZ62SWSV01, MFZ96SWMD01, MQZ05DYDV02, MTP57DYMM05, VKP3SCBCC03, VS162WREG01, VSZ21VMPP02, VSZ36HPHP03, VSZ36NBJR02, VSZ4RNBHN01, VSZ66DYLS04, WDT4DDYLS01. Validate against current plan and live SKU identities; never pin acceptance solely to historical group UUIDs.

## 7. Constraints and gotchas in force

Read current AGENTS.md first and the task router's relevant documents only. Dedicated current-upstream worktrees for every write-capable repository; canonical checkouts are landing-only. Preserve dirty, unique, active or uncertain concurrent work. No force-push, broad stage, generated-type edits, app-owned DDL or manual server source edits.

Use ai-task-gates start with actual class and check before reviews, shipping, deployment, database or production actions. Declaring prose does not bypass this file's reviewer-safety classification. Independent reviewers gate exact technical inputs; decisions remain with coordinator. Database reads/safe aggregates are open; application-data writes still need target proof and review, except the narrow owner-requested <=10-row guarded non-deleting exception. #95's eleven-row correction does not qualify.

No new issue merely for outstanding proof. No setting changes to manufacture evidence. Retain existing functions and workflows while repairing failures. Never replace the selected model because of Muse capacity errors; follow current retry/capacity rules. Keep raw licensed content, customer rows, secrets, tokens and private auth state outside Git and reviewer snapshots. Scratch under the session's protected TMPDIR; serialize 1Password. Human-facing times always America/New_York with EDT/EST explicitly named.

## 8. Access and environment

Reverify all access; these are locations, not secret values. GitHub CLI authenticated during this handoff; gh issue/PR views are the source of truth. Git author must be Albert Hazan <u2giants@users.noreply.github.com>. Assigned reviewer via ai-review must differ from implementer and be in current rotation; shared-db uses its allocator. Do not call provider internals or 1Password from inside reviewers.

1Password vault: vibe_coding. Resolve vault live rather than reuse stale vault UUIDs. Current runtime credential item 3hhxwrljnaq2tykxi7hplq5ryi has SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY fields; management PAT item 3t2xoqk5luyz7ffgdhj24gvtpq has credential. Tester admin item 7s5uzpbjenka4fpvrqogh44bre, designer ysmvwwhcj7t2gmvcvg3ibvudca and viewer mbspkosvp2rf25qxhqufipxqca have username/password. These opaque IDs are references only. Follow secrets-to-1password and op run with protected op:// env references; never paste retrieved values or raw responses.

Production database target qsllyeztdwjgirsysgai. Management query endpoint https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/database/query supports read_only:true; prove role and transaction read-only and use bounded aggregate queries. The default MCP has historically targeted retired Ohio; verify its current configured target, never trust a project label.

Railway worker: project 8645c5fe-ae60-413e-8464-508456c65365, service f777713f-d0f8-4f9b-9685-37c9090c98ef, production environment 70aef28e-b9f8-4aa6-b902-c9a06aec08d5. CLI authenticated at prior check. Bounded deployment/log/metrics reads; never print all environment variables or unfiltered authenticated logs.

Windows edge-alien currently Tailscale 100.112.207.98, ahazan read-only SSH available via existing /home/ai/.ssh/916-alien. Old 100.65.60.70 is stale. Verify host identity before any command. Read-only bounded PowerShell task/service/boot queries are safe; durable modifications belong to canonical host route and reviewer. For NAS reads use current topology and Synology skills: read edge2, writes edge1; current agent location must be verified rather than inferred from inconsistent older notes.

Browser: use connected Playwright or supported local Playwright/installed Chrome. Discover package location afresh; previous cached path is not portable. Use fresh UI email/password sign-in per browser, with secrets injected privately. App auth storage key is sb-popdam-auth-token; do not assume the default project-key name. Report safe counts/outcomes; avoid full licensed-data snapshots. Actual /downloads UI versus direct/reload behavior must both be checked.

## 9. Open questions and risks

Dated October 11, 2026, 3:12 PM EDT: issue count and deployed commits change quickly; refresh before acting. Current other-chat activity is unverified; newest relevant #179 owner comment was 2:45 PM EDT. Root must identify active sessions and coordinate, not double-rotate credentials or race claims.

The next ordinary 10 PM EDT crawl/rebuild is future chronological evidence, not work an AI can honestly declare complete now. #201's genuine upload may depend on a later release/incomplete mirror; a next weekly current-version poll may never satisfy upload acceptance. Keep precise ownership/receipt requirements, avoid invented background execution.

#95 curated-property and #293 schedule-only admission are real technical platform/tooling blockers. Their existing PRs/claims remain open, with no production write. Assign a qualified canonical tooling owner after checking current claims; no dummy DDL, manual SQL or Albert approval workaround. #194/#294 already-dispatched claims may advance independently while this prompt is prepared.

#96 profile retention code is now present; re-profiling is still paid production work and requires current gates, protected-job reconciliation and existing model authority. Broad rollout is not authorized by a historical completed pilot counter. #97 default settings restored after the predecessor test; don't repeat writes just to recreate this receipt.

Business decisions and settled owner instructions are consolidated in section 0. This session dispatched no campaign subagents; therefore no subagent-result appendix is applicable. The new coordinator must record actual subagent results, branches, worktree status, exclusions and evidence in its own eventual handoff.

### Self-audit — completed before delivery

1. Can a street-newcomer continue without session context? **Yes:** application/purpose in sections 1–2, all 19 issues and dependencies in 3, executable coordinator instructions in 6, access in 8.
2. Can they continue as effectively as this session? **Yes:** fresh comments supersede old assumptions in 3, dead ends in 4, root causes/plans in 5, approved cohort and dispatch/resource map in 6.
3. Are background, intended outcome, actual state, failures, decisions, constraints, next actions and proof included? **Yes:** sections 1–9 cover each; every numbered action in 6 ends with an observable verification gate. Shipping receipt is linked on #143; local private evidence is supplemental only.
4. Would section 0 alone show every owner business decision and no technical approval? **Yes:** sweep found #277 source decisions, #196 purchased-license entitlement and #96 future scorecard acceptance, all consolidated with recommendations. Credential no-rotation/model restrictions are settled authority, not new approval requests. Technical gate/routing failures remain with AI owners in sections 3/6/9.

Posted by Codex chat 01a12bef-d5c6-7ea0-914f-cce83649015c on hetz
