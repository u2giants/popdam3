---
issue: 1646
status: OPEN
owner: codex/01a040cd-19a0-7d70-8f85-9ec2e5d6abba
---

# Orchestrator Path B handover — marker #1632

## 0. Owner decisions

None for this workstream. Existing owner-decision issues remain outside this session and retain `needs-albert`. Do not ask Albert again for authorization to finish #1646; the remaining production promotion is already authorized and is governed by the normal preview, exact-head, production, and verification gates.

## 1. System and repository context

`u2giants/shared-db` is the source of truth for shared database structure and for DB Data Admin at `data.designflow.app`. One open `orchestrator-marker` owns structural routing. The outgoing owner is task `01a040cd-19a0-7d70-8f85-9ec2e5d6abba` on EDGE-DEV, marker #1632. A successor must open its own marker and resolve it before dispatching anything.

## 2. Goal and scope

This session governed #1631 (Scraped Properties DCP/OPA presentation), #1615 (explicit CRM domain clearing), and urgent #1640 (lossless Marvel ASGARD filename observations). #1631 and #1640 reached production and direct verification. #1615's structural change merged and preview ledger was reconciled, but its production apply and final direct verification remain in #1646. New structural intake #1645 is classified and queued. Issue #1607 remains in active lane 1 through claim #1621 and PR #1623.

## 3. Current state and evidence

### Completed

- #1631 / PR #1634 merged as `b2fee568dd544944be60e182a679f0b643362f79`; migration `20260827012253` was promoted. Supported headings render as `Disney - Creative (DCP Vault)` and `Lucasfilm / Star Wars - Creative (DCP Vault)`; Marvel Creative is ASGARD only. Sanitized unresolved/conflict guidance and the authority-conflict tooltip were live-accepted. Aggregate-only acceptance confirmed the requested Star Wars record inside the Lucasfilm/Star Wars DCP group; no other licensed row was exposed.
- #1615 / PR #1637 merged as `ce88c5de653268112b127707567e997746e07313`; migration `20260827095753` adds optional `p_clear_domain` to `api.crm_update_customer`. Preview run `33059235415`, artifact `9640989399`, digest `sha256:d41f5cc6250eb783b4e17399e3927cd9ada32ac26a12adcc8124a1f5d3262d03` originally applied version `20260827031236`. PR #1644, merge `5366c09cccc60928111a9dcc025aa44bc98af8ca`, authorized exact ledger reconciliation to `20260827095753`; run `33064019675` succeeded without replaying non-replayable SQL. #1615 now has an immutable merged completion record and is closed.
- #1640 / PR #1643 merged as `4f0b857fbbd30647ccc88e4ed602ff2db9620060`; migration `20260827101135`. Exact-head approval covered `1e5ba21ca9331702978975b9a466b3b66468fb2a`. Preview run `33065416643`, artifact `9643526864`, digest `sha256:a51ea65a87976316245e9b94ffb1ab4c9c40d7bf1a8d9ab0d7ddec1dfa3d9efc`; production dry-run `33065659372`; production review `33065657559`, digest `sha256:baca8d3339ad8eb24749628585f609f672494c1479a22cd5ecc330b84a42967a`; production apply `33065761735` succeeded. Direct catalog proof found the ledger version, both RLS-enabled tables, the UUID/text/text/jsonb loader signature, and service-role-only execute. #1640 and claim #1641 are closed.

### Outstanding and queued

- #1646 is the sole handover for #1615 production promotion. Production dry-run `33062023926` passed against an earlier main, but production APPLY DID NOT RUN. Re-derive current main and repeat every guarded gate.
- #1645 is classified structural intake for `public.asset_effective_tags` and four public filter functions. It is queued and has not been claimed.
- Active five-slot state at the final audit: lane 1 #1621/#1607; lane 2 #1584/#1452; lane 3 #1581/#1259; lane 4 #1580/#1467; lane 5 empty with #1646 dispatchable and #1645 queued behind it. Open PRs were #1623, #1587, #1586, and #1585 respectively. Re-derive all heads before acting.
- #1639 is classified documentation/repo-maintenance and belongs to a separate repo session, not the orchestrator.

### Environment state

- Preview contains #1631, the reconciled #1615 version `20260827095753`, and #1640 version `20260827101135`.
- Production contains #1631 and #1640. Production does not contain #1615's migration as of this handover.
- The outgoing orchestrator made no licensed row-data writes. Preview ledger reconciliation was a guarded migration-metadata repair authorized by #1642/#1644.

## 4. Failed approaches and dead ends

- A fresh #1615 preview attempt after version supersession failed because the old version already occupied the preview ledger. Deleting and replaying the byte-identical but non-replayable migration was unsafe. #1644 instead proved statement identity and atomically renamed the exact ledger row.
- #1640's initial head `5580b3c` passed static checks, but exact review found a truncated SHA pattern, premature SQL block termination, and non-executable test coverage. It was rejected and repaired, then rebased; only fresh approval for final head `1e5ba21ca9331702978975b9a466b3b66468fb2a` counted.
- A Git Bash reviewer call failed because only the Windows `.cmd` launcher was installed. Invocation through `cmd.exe /d /s /c` preserved the reviewer capability.
- Main advanced repeatedly during both promotions. Earlier approvals and dry-runs were treated as stale and repeated against exact heads.

## 5. Key findings and decisions

- #1631 preserves #1599 security, append-only decision history, exact Disney/Lucas direct-scope authority, no landing-table or name-keyword fallback, and no licensed rows in public evidence.
- Marvel Creative is sourced only from ASGARD. DCP supports Disney and Lucasfilm/Star Wars presentation, with unresolved authority conflicts rendered rather than guessed.
- ASGARD legitimately reuses a source UUID across multiple visible filenames. The deployed #1640 contract groups by source UUID while preserving every filename observation losslessly.
- `p_clear_domain=true` is the only explicit clear path. Omitted/false preserves the existing domain; empty-string substitution is not the contract.

## 6. Exact next steps and gates

1. Prove there is no open marker, open a new `shared-db.orch` marker with the successor's own routable task ID, and verify resolution.
2. Run the live queue audit. Confirm #1646 remains dispatchable, #1645 remains queued, and the four active claims/PR heads still match GitHub.
3. Claim and dispatch #1646 in the empty lane. Do not reuse the outgoing task or author worktree.
4. For #1646, re-derive origin/main, the production ledger, current PR/merge evidence, preview identity, and migration digest. Obtain any required exact-head review, run a new guarded production dry-run, run production APPLY, then directly verify the production ledger and `api.crm_update_customer` signature/behavior. Publish completion and close #1646 and its claim only after all evidence agrees.
5. Intake #1645 when a compatible lane is eligible; preserve its exact object list and do not collide with active work.
6. Continue #1607/#1452/#1259/#1467 only from their own claims and exact current PR heads. Any main advance invalidates stale review or preview evidence where the guard says it does.

## 7. Constraints and safety rules

- Structure only: application/source row data stays with its owning application. Curated Master Data retains its separate gate.
- Prove the exact database target before every write. Preview proof is not production proof.
- Do not expose licensed rows in issues, PRs, logs, prompts, or public evidence; use aggregate/sanitized evidence only.
- Exact-head approval is mandatory after every head change. Never reuse a superseded review.
- Preserve append-only decision history and direct-source authority; never add landing-table or name-keyword inference.
- Never delete or replay a migration ledger row merely to make a version mismatch disappear.

## 8. Access and tools

GitHub CLI authentication and the repository's guarded preview/production workflows were functional on EDGE-DEV. Secrets remain in the approved `vibe_coding` vault and are not reproduced here. Windows command launchers may require `cmd.exe /d /s /c`. The authenticated Chrome tab used for #1631 acceptance was released after verification.

## 9. Risks and self-audit

- Highest risk: mistaking #1615's merged and preview-reconciled state for production completion. It is not complete until #1646 applies and directly verifies production.
- Queue facts and PR heads are moving facts; refresh them live.
- Secrets sweep: no secret value, credential, licensed row, or protected artifact was added to this handoff or session-owned diff.
- Documentation pass: no durable project document outside this handoff was found stale from these changes.
- Fresh-developer test: the issue, exact commits/runs, remaining production gap, queue order, failure history, and next commands/gates are all stated without relying on chat history.

## Agent block — `/root/issue_1631_author`

- Asked: implement #1631's evidence-backed Scraped Properties correction in an isolated worktree.
- Did: authored PR #1634 at head `0112ef1d8ddf8b51282553181d37dd8e0bcae38e`, including migration, UI rendering, browser coverage, and database contract tests.
- Did not: own guarded preview/production promotion or final authenticated acceptance; the orchestrator performed those gates.
- State: PR merged; issue and claim closed; worktree finished clean.

## Agent block — `/root/issue_1615_author`

- Asked: add the explicit domain-clear contract for #1615.
- Did: authored PR #1637 and tests; final merged head `558a606eb240b388f3d357121409c6553dfec836` became merge `ce88c5de653268112b127707567e997746e07313`.
- Did not: run preview reconciliation or production. The orchestrator governed preview; production remains #1646.
- State: PR merged; #1615 closed with immutable merged completion; worktree finished clean.

## Agent block — `/root/issue_1640_author`

- Asked: create a lossless ASGARD filename-observation structure keyed to stable source UUIDs.
- Did: repaired the exact-review findings, added executable database tests, and authored final PR #1643 head `1e5ba21ca9331702978975b9a466b3b66468fb2a`.
- Did not: own preview, merge, production promotion, or direct production verification; the orchestrator performed those gates.
- State: PR merged and production verified; #1640 and claim #1641 closed; worktree finished clean.
