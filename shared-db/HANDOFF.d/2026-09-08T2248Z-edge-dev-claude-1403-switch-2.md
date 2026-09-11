---
issue: 1403
status: OPEN
owner: claude/handoff-1403-switch-2
---

# Issue #1403 — Switch 2: retire the `objects:` alias

Written 2026-09-08T22:48Z on EDGE-DEV by the repo session that ran the
"five oldest non-orchestrator issues" queue. Every fact below was re-derived from
`git`/`gh` at that time; anything older is flagged in section 9.

## 1. What this session was doing, and why

Standing request: pick up the five oldest non-orchestrator open issues in
`u2giants/shared-db` and complete them through to production. "Non-orchestrator"
was resolved by the repo's own governance tool, not by judgement:

```bash
node scripts/manage-migration-author-lanes.mjs --queue-audit
```

and taking the issues in its `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION`
block, oldest first. This session is **not** the orchestrator; marker issue
**#2597** is open and belongs to another session (`shared-db.orch EDGE-DEV-2`).
It was never touched.

## 2. What was actually done

| Issue | Outcome | Evidence |
|---|---|---|
| #1090 settled licensing Master Data architecture | DONE, closed | earlier in this session |
| #1322 DesignFlow: mark a Property inactive | DONE, closed | earlier in this session |
| #2244 governed review runner cannot record a codex verdict | DONE, merged and closed | earlier in this session |
| #1868 HANDOVER: run the worktree reap | DONE | PR #2606 merged `a9d509098325b1759ab248ea62fe2e28372ca198` at 2026-09-08T22:24:45Z; issue closed with evidence; remote branch deleted |
| #1403 activate agent-contract enforcement / retire `objects:` | **Switch 1 only** | PR #2613 merged `75cd89fee2107cd53d942eed04a699ca656e14eb` at 2026-09-08T22:43:25Z; issue **left OPEN** for Switch 2 |

#770 and #1275 are older but are structural/orchestrator work and were correctly
excluded by the same audit.

Durable review verdicts:

- #1868 / PR 2606 — `refs/db-review-verdict-replacements/1868-2606-4e4a8ddb9cd15cda62700ad0e527a3d7b7f8916f-1873`
- #1403 / PR 2613 — `refs/db-review-verdicts/1403-2613-1e82ca4e162482848533090cf7fb1cbd42e8f796`

What Switch 1 actually shipped: the agent work contract became a **required
status context** on `main` (12 contexts, live, changed through
`scripts/update-required-checks.mjs`), plus the fix that made that activation
survivable — the required-checks pre-flight now reads its pinned floor from the
trusted `origin/main` copy of its own source instead of from the proposed head,
so a PR can no longer shrink the pin by editing the file it is judged against.
The pin may only grow. Landed as `289bcbab` on `main`.

## 3. Applied to preview / production

**Nothing.** No migration, no DDL, no data row, on either preview or production.
Both PRs were repository tooling and CI configuration. The only live mutation
outside git was the branch-protection required-checks list on `main`, which is
part of Switch 1 and was made through the governed script.

## 4. Half-finished or abandoned

Nothing is half-finished. **Switch 2 of #1403 was deliberately not started**, and
that is the one open item this file exists for — see section 6.

## 5. What this session owns right now

- Branch `claude/handoff-1403-switch-2` — this file only; merges as a docs-only PR.
- Worktree `.claude/worktrees/funny-nightingale-f17479` — clean after this PR, branch merged, safe to retire.
- Worktree `.claude/worktrees/land-1868` — branch `claude/1868-worktree-reap-liveness` merged, remote branch deleted, safe to retire.
- No open PR other than the docs one. No migration-author lane: both issues were
  `repo-maintenance`, confirmed by `--audit` (7 of 8 leases occupied, none ours),
  so there was nothing to relinquish.
- No database-object claim of any kind.

## 6. What comes next — Switch 2, exactly

**Goal:** retire the `objects:` alias in migration-author claim blocks so
`writes:` / `reads:` are the only accepted spellings. (Corrected 2026-09-08T23:55Z:
an earlier draft of this file said `db_objects:`, which is not a key the parser
knows. The parser carries three list keys — `objects:`, `writes:`, `reads:` — and
already refuses a block that mixes the legacy list with the new pair.)

**Gate status, re-measured 2026-09-08T23:55Z.** The gate in issue #1403 has three
conditions, and two are now met:

- zero open **work issues** using `objects:` — was 29 on 2026-08-23, now **0** across 107 open issues. MET.
- at least 14 days of docs and examples using `writes:`/`reads:` — landed 2026-08-23 in `docs/agents/section-4-anti-collision-rules.md` (`a1d6bbb0`), so **16 days**. MET.
- zero open **claims** using `objects:` — still **1**, claim #2418. NOT MET.

The lease clock on #2418 is not the gate. Expiry is an audit warning and never a
release; the claim stays authoritative until released explicitly. Switch 2
unblocks when **PR #2425 merges and that claim is released** — as of
2026-09-08T23:53Z #2425 is open and CONFLICTING, and belongs to another session.

**The gate, and it is a real one:** the alias is still read as a WRITE by the
claim parser. Claim **#2418** (`CLAIM: #2403 create empty hts_rag_split schema
with nine structurally identical tables`) is an **active author lease** whose
fenced block still uses `objects:`. Retiring the alias while that claim is live
makes the parser stop seeing its object locks, which lets a second author start
on objects that are already claimed — a collision, not a cosmetic break. Fenced
claim blocks are never hand-edited, so the claim cannot simply be rewritten.

**Precondition to check first, every time:**

```bash
gh issue list --repo u2giants/shared-db --label db-claim --state open --json number,body --jq '.[] | select(.body | test("(?m)^objects:")) | .number'
```

If that prints nothing, Switch 2 is unblocked. If it prints #2418 or any other
number, it is still blocked — say so and stop; do not "just update" the block.

**Then the work itself:** remove the `objects:` branch from the claim-block
parser in `scripts/manage-migration-author-lanes.mjs`, make an `objects:` line
a hard refusal that names `writes:`/`reads:` as the fix, update the tests, and update
whatever documentation still shows the old spelling (`AGENTS.md` and the
orchestrator skill both do). Normal governed route: contract + completion pair
as the LAST commit, governed review, guarded merge.

**Do not treat the lease expiry (2026-09-09T02:53:18Z) as the unblocking event.**
It is an audit warning only. Watch PR #2425 instead.

## 7. Blocked on

Only the above — an active claim held by another session's work. Nothing is
waiting on Albert. No owner decision is owed.

## 8. What was tried that did NOT work — MANDATORY

- **Guarded merge refused PR #2606** with `REFUSED: origin/main (d669c43e…) has
  moved past the dispatched commit (5caf1b30…) with changes that are not
  documentation`. The exact-head rule and the current-tip rule fight each other:
  every refresh spends the verdict. The only thing that works is running review
  and dispatch back-to-back with `origin/main` re-verified immediately before
  the dispatch. Do not refresh a branch "to be safe" after a verdict lands.
- **`git checkout --theirs .agent/contract.json` installed a stranger's
  contract.** Every PR changes both `.agent` files, so every refresh conflicts on
  them, and `--theirs` takes main's copy — which belongs to whichever issue
  merged last (here, work_issue 2535). Recover with
  `git show <your own prior head>:.agent/contract.json > .agent/contract.json`,
  same for completion, then bump **your own** generation.
- **`git for-each-ref 'refs/db-contracts/1868/*'` printed nothing** and read as
  "no generations exist". Contract refs are **remote-only**; use
  `git ls-remote origin 'refs/db-contracts/<issue>/*'`. Believing the empty local
  result put generation 5 on a file that should have been 4.
- **Two reviews refused with `the wrapper reported a usage limit`** — kimi-k3 is
  genuinely out of credit, twice. Recorded honestly with
  `--replace-failed-reviewer … --failure-code insufficient_quota` and re-drawn
  (gemini for 2606; muse then grok for 2613). The replacement run then needs
  `--replacement-sequence <the FAILED sequence>` or it refuses with a lease error
  that names neither cause nor fix.
- **A review refused with `ai-kimi doctor reports "doctor could not be run"
  … this is a LOCAL dependency fault`.** The cause was a missing
  `AI_KIMI_CALLER=claude`, not a broken install. Every wrapper needs its
  `AI_*_CALLER` variable, and the wrappers are on PATH in PowerShell, not Bash.
- **`REFUSED: reviewer preflight worktree is not at the exact assigned head`** —
  the review clone was still detached at the previous head. Re-detach it and
  force its local `main` to the new base before re-running.
- **CI failed on "Tools offline tests" and the 51 test results above the failure
  all passed.** The real line was the last one: `truth-audit semantic inventory
  drift: re-review changed call sites (found 268, recorded 267)`. Any new error
  message anywhere in `scripts/` or `.github/workflows/` containing the word
  "missing" breaks CI until it gets a dispositioned entry with a 20-character
  minimum reason in `docs/verification/throughput-guard-truth-audit-20260828.json`.
  Bumping the count alone is not a fix.
- **A review was left running against a head that was about to be superseded.**
  It was stopped rather than allowed to produce a verdict for a dead commit.
  Re-review once, at the final head.

## 9. Facts that may already be stale

- `origin/main` tip `75cd89fe` — read 2026-09-08T22:48Z.
- Claim #2418 open with an `objects:` block, lease to 2026-09-09T02:53:18Z — read
  ~22:40Z. **Re-check before acting; this is the one fact Switch 2 turns on.**
- Reviewer pool state, read this session: kimi-k3 out of quota;
  gemini-3.8-flash-high, grok-4.6, glm-5.3, muse-spark-1.3-contributor
  allocatable; codex-gpt-5.6-sol quota-retired (#2485). Quota comes back.
- Author lanes 7 of 8 occupied — read before the merges; other sessions move it.
- Orchestrator marker #2597 open, owned by `shared-db.orch EDGE-DEV-2` — read
  2026-09-08T22:46Z.

## 10. Stale handoff files (reported, not touched)

Twenty-two files in `HANDOFF.d/` name an issue that is now closed. They belong to
other sessions and were left in place. Listed as `<file> — issue — owner`:

- 2026-08-14T2236Z-al8960ofc-claude-coldlion-history-endpoints.md — 1031 — al8960ofc/claude-coldlion-history-endpoints-13b4f3 (session ended)
- 2026-08-17T0016Z-al8960ofc-codex-licensing-plan-review-fixes.md — 1090 — codex/licensing-master-data-plan-review-fixes-20260817
- 2026-08-31T1457Z-edge-dev-codex-historical-mg-apply-plan.md — 1984 — codex/mg-historical-implementation-plan
- 2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md — 1031 — claude/coldlion-api-validation-proofread-1d2edd
- 2026-09-03T1750Z-edge-dev-claude-orchestrator-2193-closeout.md — 2218 — claude/shared-db-orchestrator-4d089e
- 2026-09-04T0030Z-edge-dev-claude-orchestrator-2224-closeout.md — 2247 — claude/orchestrator-2224-closeout
- 2026-09-04T0129Z-edge-dev-claude-coldlion-reply-20260903-ready-to-send.md — 1031 — claude/coldlion-api-validation-proofread-1d2edd
- 2026-09-04T0310Z-edge-dev-codex-priority-orchestrator-cutover.md — 2267 — codex/orchestrator-2249-handoff
- 2026-09-04T1103Z-edge-dev-codex-priority-orchestrator-2269-closeout.md — 2283 — successor-orchestrator
- 2026-09-04T1108Z-edge-dev-codex-post-cutover-closeout.md — 2267 — codex/01a069d8-3c1a-7d03-bc9f-fd0e1c0577a2
- 2026-09-04T1109Z-edge-dev-claude-non-orchestrator-queue.md — 2258 — claude/1223-guard-mutation-sweep
- 2026-09-04T1109Z-edge-dev-codex-expired-claim-recovery.md — 2280 — codex/2280-expired-claim-recovery
- 2026-09-04T1303Z-edge-dev-codex-orchestrator-2288-closeout.md — 2293 — codex/orchestrator-2288-handoff
- 2026-09-04T1625Z-edge-dev-2-claude-orch-2297-closeout.md — 2297 — claude/handover-orch-2297-closeout
- 2026-09-04T2010Z-edge-dev-codex-unauthorized-orchestrator-handover.md — 2317 — codex/01a06d5e-837c-7423-abd6-d3964f8539da
- 2026-09-06T0030Z-edge-dev-claude-orchestrator-2330-closeout.md — 2400 — claude/shared-db-orchestrator-8ca8f3
- 2026-09-06T1330Z-edge-dev-2-claude-orch-2404-closeout.md — 2432 — claude/shared-db-orchestrator-ed94bd
- 2026-09-07T0620Z-edge-dev-claude-orchestrator-blocker-issues.md — 2494 — claude/handover-orch-6172c135
- 2026-09-07T1634Z-edge-dev-codex-five-issue-closeout.md — 1090 — codex/session-closeout-20260907-1634
- 2026-09-07T2224Z-edge-dev-codex-orchestrator-transfer.md — 2552 — codex/orch-2536-closeout
- 2026-09-08T1735Z-edge-dev-codex-orchestrator-queue-handoff.md — 2586 — shared-db.orch/01a0812c-13ca-75e2-992c-b309b882a37d
- 20260906T205200Z-edge-dev-shared-db-orch-5e0e7c81-orchestrator-closeout.md — 2469 — claude/shared-db.orch-5e0e7c81

Still genuinely open, leave alone: issues 2301, 2323, 770, 2401, 2530, 2572.
