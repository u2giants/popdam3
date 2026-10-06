---
issue: 3947
status: BLOCKED
owner: codex/3947-production
---

# 0. Business decisions only the owner can make

None. Albert already requested completion of shared-db #3947 through production. Do not ask him for technical approval, access, a command, or a merge. All unresolved work below is technical and belongs to the successor doing this issue. Read current AGENTS.md: claim-first supersedes historical orchestrator/marker rules.

# 1. Application and purpose

DB Data Admin is the business-facing shared-data administration application at https://data.designflow.app. Its application code lives in u2giants/popdam3 under apps/db-data-admin; popcre/shared-db owns the shared Supabase schema and the inventory function. Licensing users use the Scraped Properties page to review portal source identities and map them. Duplicate display rows should be hidden without deleting captured source rows or making saved mapping decisions unreachable.

# 2. Requested outcome

User request: complete https://github.com/popcre/shared-db/issues/3947 through production. The issue now contains three patterns: Warner fallback/source-ID twins, Sesame legacy/current generation twins, and Disney property identities appearing again under Lucasfilm. The existing PR covers only the first two. All three must be included in completion and independently verified live. This is structural work: the intended write is the existing function api.db_data_admin_scraped_source_inventory(text,text,text,integer), with character/style-guide arms, security posture and paging preserved.

# 3. Verified current state

Checked October 6, 2026, approximately 4:39 PM EDT. Refresh all mutable facts before acting.

- Origin/main inspected at c86be424f89162bbf9b450a02597616e5dcde298. Other sessions are actively merging unrelated work. This session's isolated app worktree is /home/ahazan/.codex/worktrees/0f9e/shared-db, branch codex/3947-production. It contains no migration edits.
- Open PR https://github.com/popcre/shared-db/pull/3957, branch mimo/3947-scraped-dedupe, exact head 89a7b8e2ede66558ed4d2b2f573e41e7932781b7. The PR is attached to this chat. It contains .agent/work/3947/1/{contract,completion}.json, the new migration supabase/migrations/20261006123803_scraped_inventory_warner_fallback_sesame_value_key_dedupe.sql, and two SQL test files. Applicable CI is green, including Database Contract Tests 37495906848 and Tools Offline Tests 37495906752. Earlier red replay failures belong to earlier heads. Green CI does not establish preview or production execution.
- Claim https://github.com/popcre/shared-db/issues/3955 remains OPEN, owner mimo/3947-scraped-dedupe, active through October 7, 2026, 8:37 AM EDT. Last GitHub claim update was October 6, 2026, 8:38 AM EDT. Its recorded remote worktree is C:\repos\shared-db\.claude\worktrees\3947-scraped-dedupe. Uncommitted remote state has NOT been inspected. The migration reservation 20261006123803 is permanent.
- Production MCP get_project_url returned https://qsllyeztdwjgirsysgai.supabase.co, matching the repository production target. Read-only ledger query found NEITHER declared base 20261002193034 NOR proposed 20261006123803. This session performed no database writes.
- Base 20261002193034 is supabase/migrations/20261002193034_peanuts_sesame_submission_property_options.sql, merged PR https://github.com/popcre/shared-db/pull/3899, work issue https://github.com/popcre/shared-db/issues/3897. Source head 2cc6416914eb3fc2a285727cd6b3e6128b5fa30a; merge c97fd5dea073ef57244590e44bfcab231c1dc27a. Its merge-time approval audit passed. Current production recovery still lacks slot-6 durable approval (assignment sequence 5122, qwen-3.8-max). Prior comments are stale; several earlier missing slots now have durable verdicts.
- Issue #3947 was updated in place to status blocked and depends_on 3897. Original signature and live-proof checkbox were preserved. Extra checkboxes cover legitimate ownership, review corrections, Lucasfilm scope, prerequisite delivery, and production/live proof. No follow-up proof issue was created.

## Completed reviews in this session

Both reviews completed and were recorded by scripts/run-governed-review.mjs. They are real recorded verdicts, not parent-agent opinions.

1. Slot 1: allocator returned replacement sequence 5325 / original failed sequence 5323, Muse Spark 1.3 Contributor. Muse APPROVE at exact head 89a7b8e2ede66558ed4d2b2f573e41e7932781b7. Durable ref refs/db-review-verdict-replacements/3947-3957-89a7b8e2ede66558ed4d2b2f573e41e7932781b7-5323, commit 872769503e9fb7633b457987f1edde3a0cd9dc63. Findings https://github.com/popcre/shared-db/pull/3957#issuecomment-6025011097. Named Muse conversation codex-3947-3957-89a7; use the same conversation for same-source continuation where supported.
2. Slot 2: allocator sequence 5333, DeepSeek V4.1 Flash. REVISE at the same head. Durable ref refs/db-review-verdicts/3947-3957-89a7b8e2ede66558ed4d2b2f573e41e7932781b7-slot2, commit b9c39930b1e2bd2d3c5a46afa70792db176bf900. Findings https://github.com/popcre/shared-db/pull/3957#issuecomment-6024996684. Because one assigned slot refused, merge is prohibited regardless of Muse approval or green CI.

A detached review-only worktree /tmp/shared-db-3947-review holds the exact head and private review evidence. It was not used to author source changes. Protected packets/receipts live under its .ai/reviews; keep private. These temporary files are convenient local evidence; GitHub verdict refs and findings links are the durable authority.

# 4. Failed attempts and non-authorizing results

- git merge --ff-only origin/mimo/3947-scraped-dedupe on the fresh main-based branch refused divergence; no merge or source mutation occurred. Do not force-reset, overwrite, or force-push the predecessor's branch.
- First review assignment lacked --admit-issue 3947 and was refused. Corrected assignments supplied --admit-issue.
- Named-claim preview preparation with current SHARED_DB_SESSION_ID and --claim-number 3955 refused verbatim: claim lease owner mimo/3947-scraped-dedupe is not this session. Do not impersonate that owner or change its lease manually.
- Issue-level preview preparation without a named claim is separately supported by githubFlowAdapter: a declared session is sufficient, while named-claim operations enforce owner equality. It refused on absent durable APPROVE (before the reviews). It did not authorize or dispatch a preview. Do not use the distinction to override object ownership when editing.
- Prerequisite #3897 issue-level preview preparation refused verbatim: review slot 6 has no durable APPROVE for its latest exact-head assignment. No recovery dispatch was launched.
- check-exact-head-approval.mjs takes PR_NUMBER in the environment, not --pr. APPROVAL_AUDIT=merged PR_NUMBER=3899 passed its historical merge audit, but that does not prove current production readiness.
- Read-only abandonment audit returned REPORT_ONLY and did not classify active claim #3955 as expired. No owner transfer, quarantine or lease release was performed.

# 5. Findings and remaining code work

Read DeepSeek's full linked findings before coding. Its requested round: explicitly state Warner anti-join cardinality/index assumption (do not add an index without expanding exact claimed objects and scope); add exact relied-on table/column checks to migration self-check; assert the Sesame survivor's exact current-generation label; accumulate pagination counts across all pages rather than overwriting them or exiting early; refresh evidence binding; account for residual duplicate patterns. Character/style-guide duplicate patterns were report-only, outside the Properties request; do not invent structural follow-up tickets for them as a substitute for finishing this issue.

Production read-only aggregates verified in this session: zero plm.source_resolution decisions for source_system LIKE warner%; zero for LIKE sesame%; 30 plm.lucasfilm_dcp_property rows with a same-source_id match in plm.dcp_property where source_system='disney_dcpvault'; zero Lucasfilm resolution decisions for those 30 shared identities. Only aggregate counts were returned, no licensed asset rows were exported.

Lucasfilm display arm is in the current inventory body's property CTE: see the plm.lucasfilm_dcp_property SELECT around predecessor migration lines 447–470. Preserve Disney's surviving row and hide only a Lucasfilm row whose exact source_id has an existing Disney dcp_property twin. Preserve unique Lucasfilm identities. Before writing, recheck all mapping-decision homes (including embedded core_property_id/resolution fields), source namespace and routing semantics; the aggregate source_resolution count alone is not every possible decision. Existing cross-vault resolution joins can influence group placement, so test the actual returned group, not just absence of a source-table row.

The issued contract refs/db-contracts/3947/1 (sha256 e9e0e5f5c303de048312c6e7f6adad4b97e129a6eb540d52ae8d5d97925ccf83) permits only Warner/Sesame files and reads. Lucasfilm scope needs a new approved work-contract generation and exact reads. Do not silently enlarge generation 1 or edit an applied migration. Determine through live ledger whether the existing reserved migration remains unapplied anywhere before editing; otherwise fix forward using a new lane-reserved version.

# 6. Exact next steps and success gates

1. Refresh issue #3947, claim #3955, PR #3957, current main, and both review findings. Verify no successor already completed any step. Start ai-task-gates as shared-db; declare SHARED_DB_AUTHOR_ENGINE=codex and a truthful SHARED_DB_SESSION_ID. Success: exact current state and ownership are established.
2. Resolve legitimate author ownership before source edits. The active claim cannot use expired-author operator adoption. If the incumbent still works, its owner must complete/relinquish through the supported tools. When expired or proven abandoned, use the abandonment lifecycle, inspect/preserve remote recoverable work, and run --transfer-claim-author with exact issue, claim, PR, head, old/new owner, old/new worktree, abandonment evidence, and the original user's completion authorization. Never manually shorten its expiry or type the old owner's identity as this session. Success: a durable supported ownership transfer/rebind, or completed incumbent work, with no recoverable work lost.
3. Restore scope status ready only when blockers are resolved. Expand the same issue's typed reads/live_assertion for Lucasfilm, publish a new work-contract generation, and apply the review fixes plus Lucasfilm display dedupe as one coherent head in a properly leased worktree. Preserve all security posture and non-property arms. Success: exact owned files only, fresh evidence pair, behavior tests prove hidden Warner twins, current Sesame survivor, Disney-group survivor and unique Lucasfilm identities.
4. Complete missing prerequisite #3897 through its own governed recovery lane. Re-prove all active reviewer slots, recover slot 6 through the allocator and wrapper if needed, get any exact-current-main production-risk assessment the classifier requires, then prepare and launch ONLY the stored matching historical-preview recovery instruction. Never manually dispatch production or bypass the absent base. Success: production ledger and live catalog/behavior prove 20261002193034 and its intended Peanuts/Sesame submission choices.
5. Run relevant SQL and behavioral checks, push one batched head, start both allocator-assigned governed migration reviews immediately in parallel with CI. New source/test changes invalidate old verdicts. Success: both required slots have durable exact-head APPROVE and required checks pass.
6. Prepare preview through the lane tool and fresh selector, prove repository-variable PREVIEW_PROJECT_REF immediately before writes, rehearse the intended bounded migration set, and verify the app behavior against preview. Then dispatch guarded-migration-merge.yml with exact PR/head. Success: qualifying preview and guarded merge with immutable evidence and no unresolved reviewer refusal.
7. After merge, ai-task-gates check --before shared-db-promotion, prepare governed merged-main preview and dispatch its exact stored input. Allow its automatic production qualification to dispatch the serial production lane. Missing/stale/multi-source evidence is a refusal, not permission for hand-made inputs. Success: successful bounded production workflow, exact migration ledger and catalog verification.
8. Prove actual production inventory under an existing authenticated Licensing principal, read-only: no Warner fallback row with same-namespace source-ID twin; one Sesame creative row per latest-capture value_key, preferring current; Disney-vault shared IDs displayed once under the requested group; unique Lucasfilm IDs preserved. Verify all pages and any materially relevant filters. Use the application repo's supported authentication/testing helpers; do not modify roles to create a production fixture. Success: all three patterns pass actual function/API/page acceptance, not just pg_get_functiondef substring checks.
9. Tick live proof on #3947, publish immutable completion evidence through the outcome lifecycle, close only after the whole expanded issue is delivered, and retire this handoff. Success: production behavior verified and no open delivery obligation hidden by merge closure.

# 7. Constraints and gotchas

Claim-first; no orchestrator marker/dispatch ritual. Own fresh upstream worktree for writes. Permanent lane-reserved versions; no applied-migration editing. Exclusive object claims remain effective when author capacity expires. Preview/merge/production serialize globally. Two independent migration approvals; no out-of-rotation substitution or verdict deletion. Source and test changes invalidate prior approval. Production writes only through activated automatic workflow. Branch+PR for shared-db; documentation-only recovery notes may use the existing prose route. Sign all human-authored GitHub posts. Human-facing dates/times use America/New_York with EDT/EST. Public repository: do not export licensed asset rows or private review packets. Leave live-proof gaps on the same issue.

# 8. Access and environment

Machine edge-dev3; Codex chat 01a112e9-b6a5-72b3-8447-35fb3bc0e2a5. Git identity checked: Albert Hazan <u2giants@users.noreply.github.com>. Installed ai-task-gates, ai-gh and ai-pr-wait are present. Use ai-gh for GitHub requests. Read docs/agents/current-workflow.md, active-contracts-and-plans.md, worktrees-and-handoffs.md, anti-collision rules and merge protocol as routed by current AGENTS.md. Production Supabase MCP is authenticated; call get_project_url before database queries. Preview ref must come from repository variable, never a historical literal. Credentials live in 1Password vault vibe_coding; none were read, generated or stored in this session. Muse doctor passed; DeepSeek and Muse completed governed turns. No subagents were spawned.

# 9. Open risks and questions

Technical owner: the successor continuing #3947; this chat records blockers but promises no background wakeup. The earlier remote author may hold uncommitted work; active lease plus inaccessible worktree is not evidence of abandonment. Production prerequisite absence is independently verified, not inferred from issue status. Lucasfilm duplicate mapping may exist in resolution fields outside source_resolution, so recheck before hiding identities. The current review split is APPROVE/REVISE: the strict outcome is blocked. Neither original PR nor this documentation publication constitutes production completion.

## Self-audit

1. Fresh developer can continue without chat context: YES, sections 1–3 define repositories, goal, exact objects, heads, claims and durable evidence; section 6 lists guarded steps and success criteria.
2. All session knowledge needed for continuation retained: YES, sections 3–5 record real production aggregates, review split, absent prerequisite, ownership state and failed commands.
3. Goals, failures, constraints, risks, next actions and verification are complete: YES, sections 2–9 cover these, including no-op and negative evidence boundaries.
4. Owner-decision sweep: YES. Read sections 1–9 line by line; no unresolved business decision needs Albert. Section 0 explicitly says none. Ownership, review, credentials and production gates are AI technical obligations.
