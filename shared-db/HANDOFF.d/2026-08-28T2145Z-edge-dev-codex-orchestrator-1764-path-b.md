---
issue: 1778
status: OPEN
owner: codex/orchestrator-1764-path-b
---

# Orchestrator #1764 Path B handover

## 0. Decisions only Albert can make

### Blocking

1. **#1767 follow-up hardening:** a separate repair task found additional allocator concurrency/cleanup defects after PR #1774 merged, but Albert told that task not to commit. Recommendation: authorize that task to publish its already-tested follow-up; until then use the merged allocator carefully and retain exact-SHA recovery discipline. This does **not** block ordinary work.

### Already settled — do not re-ask

- 2026-08-28: Albert authorized and this session completed the live CRM customer-update repair (#1646) and the two curated licensor inserts (#1719).
- 2026-08-28: Albert ruled that operational blockers are part of orchestration; start a separate repair task rather than sitting silently. Canonical `popcre/ai-devops` PR #157 merged this rule.

## 1. What this repository is

`u2giants/shared-db` is the governed source of truth for the shared database structure used by POP applications. One orchestrator owns structural triage, isolated author lanes, independent review, serialized preview, merge, and production promotion. Ordinary application rows stay with their application; curated Master Data remains separately gated.

## 2. What this session set out to do

Run marker #1764 continuously across the waiting issues, keep five protective author lanes filled where eligible, repair a GitHub rate-limit incident, move ready migrations through review/preview/production, and never bypass shared preview or production locks.

## 3. Current state at 2026-08-28T21:45:44Z

- `origin/main`: `f62dcfd974e3683f5028f3f9eda37d8f0152ebb2`.
- Maximum migration filename observed in the primary checkout: `20260827114625`; do not trust filename ordering alone because active claims reserve later versions. Re-run the governed collision/version checks.
- Marker #1764 remains open until this handoff PR merges and all queue issues below exist; close it last.
- **Preview:** project `mvpkijzfmfcxhnzqogzs` contains applied version `20260828113920` from #1722 rehearsal run `33189683651`, but that version is not yet on `main`. It is the sole actionable applied-not-main ledger entry. Do not blind-reapply it.
- **Production completed:** governed run `33195051397` applied ordered versions `20260827095753,20260828030532` for #1646 and verified the nine-argument Administrator-gated CRM function. #1646 closed and claim #1766 released.
- **Curated production completed:** exactly `PAUL FRANK` and `STEAL-A-BRAINROT` were inserted as active `core.licensor` rows with NULL codes under two consumed one-use authorizations; #1719 closed. No contract-property bulk load ran.
- Four live claims remain: #1747/#1722, #1711/#1684, #1659/#1658, #1656/#1645. The fifth lane is empty because live audit found no eligible structural successor. Stale queue items #1259 and #1452 were verified already delivered and closed.

## 4. What did not work

- The old reviewer allocator scanned historical assignments and exhausted GitHub REST quota. The exact reset header was `1787933288` = 2026-08-28 12:08:08 EDT. Governed stale-lock recovery was used; no ref was deleted by hand.
- #1645 preview run `33189866565` stopped safely because preview already contained #1722 version `20260828113920`, which #1645's branch did not contain. No #1645 SQL ran.
- #1684 preview run `33189464663` initially failed because `LOCK TABLE` ran outside a transaction. Head `486218f...` fixes the framing. Later two Grok reviews hit the 20-turn ceiling without verdict, costing $0.21083434 and $0.202844 ($0.41367834 total); governed failure evidence reassigned the unchanged head to Muse sequence 456.
- #1658 preview residue initially collided with tables left by successful run `33095556822` after reconciliation run `33100418436` removed the ledger row. The migration was rewritten to accept only exact clean-bootstrap or exact proven-residue states and refuse partial/drifted states. A later ephemeral failure exposed missing PUBLIC EXECUTE revocation; head `e9f4df...` fixed it.
- The first #1646 production apply attempt `33194633570` stopped before locking/writing because `main` moved. Evidence was regenerated against `a8df734...`; run `33195051397` then succeeded.
- Reserved claims were incorrectly reported as active workers. At most three subagents plus the coordinator can run in this environment. Canonical instructions now forbid that misreporting.

## 5. Root causes and findings

- Preview is a shared ordered ledger: a rehearsed-but-unmerged migration blocks later branches even when their SQL is correct.
- Any branch refresh, sidecar addition, or merge changes a PR head and invalidates exact-head review evidence.
- A valid independent review needs a coverage statement tied to the full 40-character head; silence or a bare verdict is not evidence.
- #1767 PR #1774 bounded the historical scan, but its continuing task found rare concurrency/cleanup defects and has uncommitted tested follow-up changes in `C:\Users\ahazan\.codex\worktrees\f0bf\shared-db`.
- The primary checkout is intentionally dirty with another session's `AGENTS.md`, licensing docs, `.agents/`, many `.ai/` artifacts, and `tmp/`. None was modified or cleaned by this closeout.

## 6. Exact next steps

1. Resume #1722 first. Obtain **two** independent exact-head reviews for `9b20f13645e9156d92cf5f0b5dd75343dd67efa1`, each with coverage and no unresolved Critical/High. Gate: both comments/reviews name that exact head.
2. Re-fetch `main`; if it moved from `f62dcfd...`, refresh #1722 again and repeat reviews. Then acquire preview for PR #1748/head and run ledger-aware verification of already-applied `20260828113920` rather than reapply. Gate: bound preview evidence proves catalog and ledger at the exact head.
3. Guarded-merge #1722. Gate: PR #1748 state MERGED and merge commit is on `main`; preview's `20260828113920` is now main-backed.
4. Resume #1658: refresh PR #1660 onto exact new main, add the required hash-bound verification sidecar for `20260828151309`, rerun full CI, and obtain a new exact-head approval (the current `e9f4df...` Muse approval becomes stale). Then preview, merge, and promote under normal gates.
5. Resume #1684: execute Muse replacement sequence 456 on unchanged head `486218f...`; after #1722 merges, refresh main, rerun tests/reviews, preview, and merge. Do not count the two cancelled Grok turns as reviews.
6. Resume #1645 after #1722: refresh PR #1749 from current main, rerun exact checks/reviews, then preview `20260828113931`. The earlier failed preview wrote nothing.
7. #1669 depends on #1658; after #1658 lands, re-derive its scope and dispatch normally.
8. Resolve the owner decision for #1767 follow-up hardening; if authorized, have its existing task publish, review, merge, verify bounded real assignment, and close the new handover issue.
9. On every freed lane run live `--queue-audit`; close proven stale delivered items, and dispatch only a genuinely eligible successor. Gate: audit shows no dispatchable issue before reporting an empty lane.

## 7. Constraints and gotchas

- One open orchestrator marker only. The successor opens its own marker with its own route after #1764 closes; never reuse this route ID.
- Structure only in author lanes; repo maintenance uses a separate task. Operational blockers must still be started and followed by the orchestrator.
- Five lanes are protective claims, not five workers. Report both counts separately.
- Use exact-SHA governed lock recovery only after live readback and stale threshold.
- Preview, merge, and production are serialized. Never manually edit the migration ledger.
- Preserve private licensed evidence; issue comments contain only sanitized counts/identifiers.
- Do not clean dirty worktrees or the primary checkout during takeover.

## 8. Access and environment

- Machine: `EDGE-DEV`, Windows, PowerShell. Use `C:\Program Files\Git\bin\bash.exe` for Git-Bash checks.
- GitHub CLI and protected Supabase management access were working at closeout.
- Secrets remain in 1Password vault `vibe_coding` and protected configuration; no values belong in chat, issues, or this file.
- Production project identity used and verified: `qsllyeztdwjgirsysgai`; preview: `mvpkijzfmfcxhnzqogzs`. Re-prove immediately before every write.

## 9. Open questions and risks

- #1767 follow-up is tested but uncommitted by owner instruction; rare lock cleanup/budget edges remain until published.
- Current PR heads can become stale whenever `main` moves. Never carry review/preview evidence across a head change.
- Preview contains #1722 before main. Any later preview will fail or mislead until #1722 is main-backed.
- No additional owner decision is known beyond #1767 follow-up publication.

# Part B — sub-agent state

### Agent: diagnose_1658_preview / `C:\repos\shared-db-worktrees\issue-1658-1649`
- **Asked:** diagnose residue failure, author dual-state repair, then verify post-review readiness.
- **Did:** pushed PR #1660 head `e9f4df7c38917c183505e7e6b0e6f3403fc67bee`; all checks green; Muse APPROVE recorded with coverage fingerprint `b9f2be8772549662d0f40776527e66a8945f669c9c2f7a03ea3b651ccf710150`.
- **Found:** branch base/merge-base is old `cdcebfc...`; #1722 preview ledger entry blocks it. A refresh and sidecar will invalidate approval.
- **PR/branch:** #1660, live/resumable. Claim #1659, version `20260828151309`.
- **Did not:** refresh head, preview, merge, production, or release claim because #1722 must merge first.

### Agent: lane_1722 / worktree recorded by claim #1747
- **Asked:** refresh #1722 to current main and restore exact readiness.
- **Did:** PR #1748 head `9b20f13645e9156d92cf5f0b5dd75343dd67efa1`, exact base `f62dcfd...`; migration SQL byte-identical; added required hash-bound production catalog sidecar/evidence closure. Local suites 151/151, 792 with 8 skips, 127/127, 833/833; CI green.
- **Found:** preview already has version `20260828113920`; exact-head verification must be ledger-aware. Current rules require two reviews.
- **PR/branch:** #1748, live/resumable. Claim #1747.
- **Did not:** assign reviewers, preview, merge, production, or release claim.

### Agent: resume_1684 / `C:\repos\shared-db-worktrees\issue-1684-character-separation`
- **Asked:** repair transaction framing and obtain review.
- **Did:** PR #1712 head `486218fdb01a0194161d388e85fcab5a85f177a0`; all checks green. Recorded two Grok no-verdict failures and durable Muse replacement sequence 456, failure SHA `aab1436f6fe09c5f854a4d29bc2f3dfb4e71a2a0`, replacement SHA `6e6a4c0f2f9190d90e6bd78115d71a6b8f28abd6`.
- **Found:** Grok quality degraded by repeated turn-limit cancellation; no valid coverage exists.
- **PR/branch:** #1712, live/resumable. Claim #1711, version `20260828111507`.
- **Did not:** treat cancelled turns as approval, run Muse replacement, preview, merge, production, or release claim.

### Agent: separate #1767 repair task / `C:\Users\ahazan\.codex\worktrees\f0bf\shared-db`
- **Asked:** implement bounded reviewer allocator.
- **Did:** PR #1774 merged the principal bounded design and closed #1767. Continued review found additional concurrency and cleanup-budget defects; focused/full suites reached at least 382 passing during hardening.
- **Found:** rare races can strand a shared lock or exhaust cleanup capacity.
- **PR/branch:** merged base plus dirty uncommitted follow-up in the listed worktree; preserve it.
- **Did not:** commit/push follow-up because Albert explicitly told that task not to commit.

## Closeout audits

- **Secrets sweep:** session prompts, diffs, and new handoff material were checked; no new credential requiring 1Password storage was found. Existing protected values were not printed.
- **Docs pass:** canonical anti-idling rules already merged in `popcre/ai-devops` PR #157. Nothing outside this handoff is known to require another documentation change.
- **Fresh-developer gate:** sections 0–9 state decisions, state, failures, findings, exact gated next steps, constraints, access, and risks; Part B separates every sub-agent and deliberate omission. A new orchestrator can continue without chat context.
