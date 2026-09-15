---
issue: 2873
status: OPEN
owner: marker-2925
---

# HTS production Supabase cutover orchestrator handoff

Session: Codex thread `01a08e33-3091-7d53-a153-019932d6879a`, marker #2925,
machine EDGE-DEV. Written 2026-09-15 01:19 UTC (2026-09-14 local). Moving
facts below were refreshed from GitHub and Git during closeout unless explicitly
marked as inherited evidence.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None. Albert already directed this session to finish the entire HTS production
Supabase cutover against project `qsllyeztdwjgirsysgai`, including all open
issues, and explicitly said not to send him routine copy/paste, merge, or command
work. Do not re-ask for target or completion authorization. That authorization
does not bypass canonical review, preview, guarded merge, exact write-target proof,
DesignFlow's owner merge lane, or live acceptance.

## 1. What this application is

`u2giants/shared-db` governs database structure for POP Creations' shared Supabase
project. The DesignFlow PLM services are moving their operational database from
Cloud SQL to Supabase while Alsand and production use one privacy-limited HTS RAG
store. Application code remains in the `popcre/designflow-*` repositories; database
tables, functions, policies, grants, and production promotion belong here. Read
`AGENTS.md` and the `shared-db-orchestrator` skill before accepting or dispatching
work.

The application execution contract is
`C:\repos\dflow_plm\.codex-worktrees\hts-sandbox-deploy-backend\plan_hts-production-supabase-shared-rag.md`.
Its STATUS table is current at backend commit `b823cf86` and must be read first.

## 2. What we set out to do, and why

Albert asked the DesignFlow session to implement the production Supabase/shared
HTS plan completely and keep going until every issue from the chat is closed and
live. This session implemented and rehearsed the application side, then monitored
the shared-db dependencies. When predecessor orchestrator #2893 closed without a
successor, Albert's current-chat instruction was used to claim marker #2925 so the
database queue would not be abandoned. Closeout was invoked before #2925 dispatched
any authors, so this handoff preserves the exact queue for a fresh successor.

## 3. Current state — verified during 2026-09-15 01:19–01:24 UTC

### Shared database

- `origin/main` is `9bbd28812bfc521af488e2bf8ca345663a810f45` (predecessor
  handoff PR #2924). Highest migration filename is `20260914172031`.
- Production Supabase is `qsllyeztdwjgirsysgai`. Seven-day PITR is enabled and
  physical backup coverage was verified by the DesignFlow session. Production
  operational services still use Cloud SQL; do not claim cutover is live.
- Required order: #2866 HTS insert provenance and #2870 two `dflow_prod` columns;
  after #2870, #2874 backend workflow parity and #2875 Tracking sample parity;
  after all four, #2873 creates four least-privilege service identities.
- #2866 and #2870 are OPEN. Their author claims #2867 and #2871 are protected but
  expired-unconfirmed. PR #2869 head `edc022ea` and PR #2872 head `be61ee3f` are
  OPEN and DIRTY/conflicting. They must be refreshed from current main, resealed,
  rechecked, previewed, independently reviewed, and guarded-merged; never resolve
  full-body function conflicts mechanically.
- #2874 and #2875 are OPEN and correctly wait on #2870. #2873 is OPEN and waits on
  the compatibility work. The 2026-09-15 queue audit reported seven protected
  expired-unconfirmed claims, no empty lane, no dispatchable issue, and urgent
  waiting capacity for #2866/#2870. Expiry releases neither object protection nor
  ownership.
- Preview state was not re-read in this short successor session. Predecessor
  handoff `HANDOFF.d/2026-09-15T0014Z-EDGE-DEV-claude-orchestrator-2893-closeout.md`
  proves only that preview run 34892299261 for #2905 succeeded. Treat preview as
  shared and dirty; read its ledger immediately before any preparation or apply.
- This session performed no preview or production database write, migration apply,
  merge, or author dispatch. Marker #2925 is its only shared-db external mutation.

### DesignFlow application delivery

- Backend production-Supabase guard code already landed in `develop` through PR
  #95. Backend PR #96 is OPEN and mergeable at `b823cf86`; three checks were green
  and the sandbox Cloud Build was still running at the final read. Commit `b823cf86`
  updates the plan, migration, configuration, and deployment documents with current
  evidence and was pushed to `sandbox-albert` during closeout.
- Item Master PR #56 head `06da24e1`, Tracking PR #58 head `beaf462b`, and Data
  Sync PR #34 head `945d5728` are OPEN with four green checks each. Tracking's head
  also contains a separately authorized milestone-chain change merged into the
  shared `sandbox-albert` branch; do not assume PR #58 is a one-feature diff.
- DesignFlow PRs target `develop` and must be merged by Uma (`devopswithkube`), not
  self-merged. Merge-ready comments have already been posted. Production deploy
  triggers watch `main`; `develop` is not production acceptance.
- Application worktrees are clean and intentionally retained because their PRs are
  open: `hts-sandbox-deploy-backend`, `hts-prod-supabase-item`,
  `hts-prod-supabase-tracking`, and `hts-prod-supabase-sync`. Tracking is behind the
  now-advanced shared sandbox branch but its pushed cutover commit remains in PR #58.
- Alsand revision `popcre-albert-core-sandbox-00354-vfv` uses production `hts_rag`.
  Authenticated D88738 ingestion succeeded twice with Alsand provenance. Two
  encrypted logical restores reproduced 103 tables and 1,007,244 rows with zero
  canonical differences in about 32 seconds. Private rehearsal revision
  `designflow-production-rehearsal-00003-ghp` passed authenticated health/vendor/RFQ
  reads, committed write/rollback, and 40 concurrent reads with zero failures while
  holding two DB sessions. A real isolated PITR clone, all-service rehearsal, final
  delta/write freeze, production deployments, authenticated live flows, and the
  24-hour rollback observation remain open.

## 4. Everything tried that did NOT work

- Waiting on predecessor marker #2893 did not advance these dependencies; it closed
  cleanly at 00:19 UTC with no successor. A dead marker was not left in place. This
  session claimed #2925 only after `check-orchestrator-marker --resolve --json`
  returned `state: none`.
- PRs #2869 and #2872 had once passed ephemeral/review work, but current main moved.
  Their heads are now conflicted; old exact-head evidence cannot be reused.
- A Supabase personal token can read and change billing add-ons through the official
  management API, but it cannot call the dashboard-only clone endpoint. Therefore
  enabling and verifying PITR did not prove an isolated PITR clone. Do not report the
  two logical restores as PITR restore evidence.
- Production health and HTTP 200 were deliberately not accepted as cutover proof.
  The private rehearsal proved selected flows only and production remains Cloud SQL.
- A first attempt to create the hourly continuation used an object-shaped recurrence
  and was rejected; a valid hourly heartbeat was then created. It must be deleted as
  part of this closeout because the current thread is ending.

## 5. Root causes and key findings

- #2873 cannot be solved with grants alone: `dflow_prod` lacks required backend
  workflow functions and Tracking sample tables/views/functions. That is why #2874
  and #2875 are structural predecessors rather than grant exceptions.
- The safe application binding is fail-closed: Supabase production requires port
  6543, TLS, the transaction pooler host, schema `dflow_prod`, and a dedicated
  service-specific user; it rejects the `postgres` administrator. Existing Cloud SQL
  production behavior remains available until the guarded switch.
- Application PR readiness is not production readiness. Shared-db compatibility and
  identities, DesignFlow owner merges, production trigger configuration, final data
  reconciliation, authenticated workflows, and observation are all separate gates.
- The single-orchestrator invariant prevented this application session from editing
  the conflicted migrations while #2893 was active. Once that session closed, a new
  marker with this thread's own route ID was required before orchestration could
  resume.

## 6. Exact next steps

1. Start a fresh shared-db orchestrator, using marker #2925 as predecessor. Open a
   new marker with the successor thread's own route ID and run
   `node scripts/check-orchestrator-marker.mjs --resolve`; success means it prints
   that new route and exactly one marker exists.
2. Re-run `--audit` and `--queue-audit`. Inspect claims #2867/#2871 and their live
   worktrees. Resume each protected author lease only after ownership, clean-tree,
   and capacity proof. Success means the queue no longer reports them merely as
   expired-unconfirmed and no object/version claim is lost.
3. Serialize #2866/PR #2869 and #2870/PR #2872 through current-main refresh,
   resealed evidence, SQL/contract checks, preview ledger proof, independent review,
   guarded merge, production promotion, direct catalog/behavior verification, and
   issue closure. Success means both issues are CLOSED and the exact migrations are
   verified on production—not merely merged.
4. After #2870 closes, admit and dispatch #2874 and #2875 in isolated worktrees with
   exact object claims and reserved versions. Serialize preview, merge, and production.
   Success means backend workflow and Tracking sample compatibility tests pass on
   `dflow_prod` and both issues close with live evidence.
5. Execute #2873 last: canonical NOLOGIN grant roles and four LOGIN service identities,
   least privilege only. Provision credentials through 1Password vault `vibe_coding`
   and normal Secret Manager paths without outputting values. Success means allowed
   service operations pass and cross-schema/admin operations are denied in production.
6. Follow the four DesignFlow PRs through Uma's merge lane. Re-resolve their exact
   heads and checks after every branch movement. Success means #56, #58, #34, and #96
   are MERGED to `develop` and their supported sandbox deployments are healthy.
7. From the DesignFlow application session, perform the final write freeze/delta,
   configure normal production triggers for Supabase, deploy exact approved `main`
   heads, and run authenticated login, RFQ read/write, Item Master, Tracking, Data Sync,
   standalone/RFQ HTS, history, Apply, monitoring, and rollback checks. Keep Cloud SQL
   intact/write-blocked for 24 hours. Success means post-cutover writes reconcile,
   monitoring is clean, production identifies Supabase `qsllyeztdwjgirsysgai` /
   `dflow_prod`, and rollback remains viable.
8. Update the implementation plan and close `popcre/designflow-backend#94` only after
   the live gates pass. Retire rehearsal assets and encrypted artifacts only after the
   rollback window using verified, recoverable cleanup. Success means no temporary
   asset remains without an explicit retention reason and every issue named here is
   closed with production evidence.

## 7. Constraints and gotchas in force

- One shared-db orchestrator; structural authors work only in isolated worktrees.
  Never create a competing marker or direct migration writer.
- Preview, merge, and production are single serialized lanes. Freeze merges during
  production apply. Prove the exact project ref immediately before every write.
- Never edit an applied migration or reuse a 14-digit version. Never mechanically
  merge full-body `CREATE OR REPLACE` conflicts.
- DesignFlow uses `sandbox-albert` to `develop`; never self-merge or work on `main`.
- Do not bypass missing compatibility by granting access to legacy `dflow`, widening
  service roles, using `postgres`, disabling tests, or reducing existing behavior.
- The canonical `C:\repos\shared-db` checkout contains unrelated untracked queue
  audit files, `.codex/`, two old untracked handoffs, and `acceptance-tests.log`.
  They predate this closeout and were deliberately not edited, staged, or deleted.
- The repository currently has many inherited worktrees. This session created only
  `C:\repos\shared-db-worktrees\orch-2925-closeout`; do not delete any other worktree
  based on age or this handoff.
- Stale handoff scan found 31 files whose contract issue is closed. This session did
  not delete another owner's handoff. Successor cleanup must use the governed
  stale-handoff route, not broad deletion. Exact stale files and contract owners:
  - `2026-08-14T2236Z-al8960ofc-claude-coldlion-history-endpoints.md` — `al8960ofc/claude-coldlion-history-endpoints-13b4f3 (session ended)`
  - `2026-08-17T0016Z-al8960ofc-codex-licensing-plan-review-fixes.md` — `codex/licensing-master-data-plan-review-fixes-20260817`
  - `2026-08-31T1457Z-edge-dev-codex-historical-mg-apply-plan.md` — `codex/mg-historical-implementation-plan`
  - `2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md` — `claude/coldlion-api-validation-proofread-1d2edd`
  - `2026-09-03T1750Z-edge-dev-claude-orchestrator-2193-closeout.md` — `claude/shared-db-orchestrator-4d089e`
  - `2026-09-04T0030Z-edge-dev-claude-orchestrator-2224-closeout.md` — `claude/orchestrator-2224-closeout`
  - `2026-09-04T0129Z-edge-dev-claude-coldlion-reply-20260903-ready-to-send.md` — `claude/coldlion-api-validation-proofread-1d2edd`
  - `2026-09-04T0310Z-edge-dev-codex-priority-orchestrator-cutover.md` — `codex/orchestrator-2249-handoff`
  - `2026-09-04T1103Z-edge-dev-codex-priority-orchestrator-2269-closeout.md` — `successor-orchestrator`
  - `2026-09-04T1108Z-edge-dev-codex-post-cutover-closeout.md` — `codex/01a069d8-3c1a-7d03-bc9f-fd0e1c0577a2`
  - `2026-09-04T1109Z-edge-dev-claude-non-orchestrator-queue.md` — `claude/1223-guard-mutation-sweep`
  - `2026-09-04T1109Z-edge-dev-codex-expired-claim-recovery.md` — `codex/2280-expired-claim-recovery`
  - `2026-09-04T1303Z-edge-dev-codex-orchestrator-2288-closeout.md` — `codex/orchestrator-2288-handoff`
  - `2026-09-04T1625Z-edge-dev-2-claude-orch-2297-closeout.md` — `claude/handover-orch-2297-closeout`
  - `2026-09-04T2010Z-edge-dev-codex-unauthorized-orchestrator-handover.md` — `codex/01a06d5e-837c-7423-abd6-d3964f8539da`
  - `2026-09-04T2053Z-edge-dev-codex-priority-12-orchestrator.md` — `codex/2323-priority-12-handoff`
  - `2026-09-06T0030Z-edge-dev-claude-orchestrator-2330-closeout.md` — `claude/shared-db-orchestrator-8ca8f3`
  - `2026-09-06T1330Z-edge-dev-2-claude-orch-2404-closeout.md` — `claude/shared-db-orchestrator-ed94bd`
  - `2026-09-07T0620Z-edge-dev-claude-orchestrator-blocker-issues.md` — `claude/handover-orch-6172c135`
  - `2026-09-07T1634Z-edge-dev-codex-five-issue-closeout.md` — `codex/session-closeout-20260907-1634`
  - `2026-09-07T2224Z-edge-dev-codex-orchestrator-transfer.md` — `codex/orch-2536-closeout`
  - `2026-09-08T1650Z-edge-dev-claude-four-blocked-issues.md` — `claude/shared-db-orchestrator-issues-27a129`
  - `2026-09-08T1735Z-edge-dev-codex-orchestrator-queue-handoff.md` — `shared-db.orch/01a0812c-13ca-75e2-992c-b309b882a37d`
  - `2026-09-09T0620Z-EDGE-DEV-2-claude-orchestrator-2597-closeout.md` — `claude/orch-closeout-20260909`
  - `2026-09-09T1141Z-edge-dev-codex-orchestrator-2625-closeout.md` — `shared-db.orch EDGE-DEV 2403-first`
  - `2026-09-10T0614Z-EDGE-DEV-codex-orchestrator-2629-closeout.md` — `codex/orch-2629-closeout`
  - `2026-09-10T1930Z-EDGE-DEV-claude-orchestrator-2669-closeout.md` — `claude/orch-2629-successor`
  - `2026-09-11T0350Z-EDGE-DEV-claude-orchestrator-2689-closeout.md` — `claude/orch-2689-closeout`
  - `2026-09-12T0820Z-edge-dev-claude-production-queue-blocked-on-repairs.md` — `claude/production-issues-automation-dfbb8c`
  - `2026-09-14T1245Z-edge-dev-codex-production-and-sandbox-closeout.md` — `shared-db.orch/01a09d92-454c-7421-98a2-2b0a95f0f17c`
  - `20260906T205200Z-edge-dev-shared-db-orch-5e0e7c81-orchestrator-closeout.md` — `claude/shared-db.orch-5e0e7c81`

## 8. Access and environment

- `gh` is authenticated as `u2giants`; Git identity is
  `Albert Hazan <u2giants@users.noreply.github.com>`.
- Supabase CLI is installed. The canonical checkout is currently linked to production
  ref `qsllyeztdwjgirsysgai`; do not infer preview state from that link.
- Secrets live in 1Password vault `vibe_coding` and GCP Secret Manager. No credential
  value belongs in chat, commands, logs, commits, or handoffs.
- Secrets sweep result: no new secret value was found in repository diffs or untracked
  work owned by this session. The protected temporary Supabase billing helper was
  removed after verifying its exact path. Existing credentials remain in their
  approved stores.
- Documentation pass: the DesignFlow plan and its migration/configuration/deployment
  docs were updated and pushed as `b823cf86`. Nothing outside this handoff in
  shared-db became stale during marker #2925 because it performed no database work.

## 9. Open questions and risks

- There is no remaining owner decision. Operational risks are the conflicted and
  expired-but-protected #2866/#2870 author state, unknown current preview contents,
  shared DesignFlow branch movement, unproven PITR clone, and incomplete production
  authenticated acceptance.
- Production cutover must not begin from a broad `develop` to `main` release without
  re-resolving the intended DesignFlow release contents; backend `main` and `develop`
  were materially divergent during implementation.
- Hourly monitoring was created only to continue this long-running task. It is not a
  substitute for an active successor and is deleted when this session closes.

## Per-agent handoff blocks

### Agent: none dispatched by marker #2925

- **Asked to do:** N/A; closeout was invoked immediately after the vacant orchestrator
  role was claimed.
- **Actually did:** No migration author, reviewer, preview, merge, or production agent
  was dispatched.
- **Found:** The inherited queue has seven protected expired-unconfirmed claims;
  #2866/#2870 are urgent waiting capacity and #2874/#2875 wait on #2870.
- **PR / branch:** No work PR created by marker #2925. This handoff branch is
  `codex/orch-2925-closeout`.
- **Worktree:** `C:\repos\shared-db-worktrees\orch-2925-closeout` is the docs-only
  closeout worktree and is safe to remove only after its handoff PR merges.
- **Deliberately did NOT do, and why:** Did not dispatch new work after closeout began;
  scope freeze requires the successor to resume the queue.

## Handoff completeness audit

1. **Yes, a newcomer can continue without chat context.** Sections 1–3 identify the
   systems, goal, exact repository/application state, issues, PR heads, production
   target, and remaining evidence.
2. **Yes, the newcomer has the session's non-obvious knowledge.** Sections 4–5 record
   failed approaches, why old evidence is invalid, the compatibility root cause, and
   the distinction between green application PRs and production readiness.
3. **Yes, execution can continue without missing a gate.** Section 6 gives ordered,
   testable next actions; §§7–9 cover constraints, access, secrets, preview uncertainty,
   worktree ownership, and risks; the per-agent block states exactly what was not
   dispatched.
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of §§1–9 and
   the per-agent block found no unanswered owner judgment. The already-settled target
   and completion authorization is consolidated in §0 with an explicit do-not-reask
   instruction.
