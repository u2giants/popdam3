---
issue: 1225
status: OPEN
owner: claude-20260819-011000Z
---

# HANDOFF — shared-db orchestrator closeout (2026-08-19 08:10 UTC, edge-dev/Claude)

Marker: #1207. Predecessor: #1169 (closed), whose closeout was
`HANDOFF.d/2026-08-19T0050Z-al8960ofc-claude-orchestrator-closeout.md`.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking now
None.

### Waiting on Albert, not blocking
- **#1166 — queue triage.** ~90 open `db-work` issues. Only Albert can say which of his own business items are still live. Tracked, not urgent, and it did not block anything this session.
- **#1204 — Coldlion phases 2-6** (~25 tables) and the seven-year backfill. Deliberately unstarted.
- **#1195 — Coldlion spine follow-ups.** One is free because of Albert's own 2019 ruling; the other breaks CI repo-wide the day phase 2 lands. Neither needs a decision, only doing.

### Settled this session — do NOT re-ask
- **Do not go around the safety gate.** Albert asked for the two stranded migrations to be pushed to production by bypassing the promotion process. I declined once with reasons — the database was never unusable, nothing was down, and building a bypass would have cost about what the real fix cost while unblocking only two changes instead of every future one. He did not repeat the instruction, and the fix landed. **If a future session is asked the same thing, the honest answer is that this gate has now caught eleven real defects in this exact code path, three of which would have let unrehearsed SQL reach production.**
- Standing authorization from #1169 still applies: act without per-step approval; the evidence discipline is unchanged.
- The owner-decision approval ritual stays RETIRED for technical sign-off.

## 1. What this application is

`u2giants/shared-db` owns the STRUCTURE of the shared Supabase database used by about nine POP Creations applications. **Preview is `mvpkijzfmfcxhnzqogzs`** — the old `rjyboqwcdzcocqgmsyel` was DELETED and rebuilt on 2026-08-18. Production is `qsllyeztdwjgirsysgai`. One orchestrator, three migration-author lanes, every structural change through an exact issue, permanent version reservation, claim, branch, worktree, PR, preview evidence, independent review and bounded production promotion.

## 2. What this session was asked to do

Open as orchestrator. Then, verbatim: *"go around the safety process and push them through to production… find all the issues to set up database structures for licensor scrapes and complete them through to production."*

## 3. Current state — VERIFIED 2026-08-19T08:10Z, re-derive before trusting

- `origin/main` = `f9755187a2addb72ad90fefa361c6bd8c0d50246`
- Highest migration on main: `20260819015333_sega_dsi_source_landing.sql`
- **Lanes: 0 of 3 occupied.** Claims #1174, #1209, #1210 all released and closed.
- No stuck exclusive locks — `refs/db-coordination/*` holds only `reviewer-round-robin`.
- Open PRs: **#1212 only** (`docs/slim-agents-handoff`) — **not mine**, another session's live work, deliberately untouched.
- Queue audits `fullyAudited: true`, `malformed: []`, `unclassified: []`.

### Production `qsllyeztdwjgirsysgai`
**NOTHING was applied to production this session. Not one write.** Newest applied is still `20260818141220`.

### Preview `mvpkijzfmfcxhnzqogzs`
**NOTHING was applied to preview this session either — no migrations and no data rows.** Newest applied is still `20260818203751` (mgCategory). One preview run was attempted at 01:01Z and **refused before touching the database** (run 32203393978); that refusal is what exposed #1208.

**So five migrations are now merged and absent from both databases:** `20260818203751`, `20260818232639`, `20260819011639`, `20260819014639`, `20260819015333`.

## 4. Merged this session — FIVE pull requests

| PR | What | Review path |
|---|---|---|
| #1206 | predecessor's closeout handoff | docs-only |
| #1176 | PopDAM bulk-operation revision + submission lease (#1171) | Grok 179 APPROVE → version superseded → Kimi 180 APPROVE at exact head |
| #1214 | **WildBrain DAM source landing schema (#1197)** | Grok 183 REVISE (2 Highs) → Kimi 186 FAILED → Grok 187 APPROVE |
| #1215 | **Sega DSI source landing schema (#1196)** | Grok 185 REVISE (1 High) → Kimi 188 FAILED → Grok 189 APPROVE |
| #1213 | **the preview-rehearsal path (#1208)** — the session's blocker | **TEN rounds, ten real defects** |

PR #1194 closed as superseded by #1213.

## 5. #1213 — ten rounds, and what they mean

Every round found a real defect. **Three shared one shape: a check that silently passes while its tests stay green.** Twice the root cause was a test helper that could not express the thing its test claimed to prove.

The rounds, so nobody re-walks them:

1. `7bfd6ca7` **High** — pin aimed at the artifact-name commit; doctored-workflow forge.
2. `ee44cc82` APPROVE, three Lows.
3. `f294f8e3` **High** — the `supabase/migrations` exemption defended by a control that **does not exist on the historical-recovery lane**; plus a comment citing a test that did not exist.
4. `5cba0102` **High** — the same forge reappeared on the new field; the original run's `head_sha` and producer files were never pinned.
5. `3486f69` **High** — both original-run pins could be the SAME attacker-chosen PR commit, so the comparison was a no-op. This repo squash-merges, so any commit ever on a PR stays citable forever.
6. `d94a637` **High** — the merge-commit pin then refused **100% of the recoveries the lane exists for**, because it walked TODAY's producer list against OLD commits where four of ten files did not yet exist.
7. `11d2a3be` **High** — the absence rule turned a non-recursive tree listing into a **no-op producer pin**: drop `?recursive=1` and the pin compared nothing while every test stayed green.
8. `b7ea4be6` — the tenth instance: the original-run shape loop checks four keys and **only `conclusion` was falsifiable**. APPROVE.

**The mutation sweep (#1223) is the most valuable artifact of the session.** Asked to hunt further instances by reading, the author swept mechanically instead: every guard whose body raises replaced one at a time with `if False:`, full suite re-run against each. **117 guards, 41 survived.** Nine fixed on #1213; 32 deferred to #1223. **None were introduced by #1213** — nine rounds of careful reading had walked past them repeatedly.

**And the sweep has a blind spot**, found the same day. Its granularity is the guard, so a guard checking four things while only one is falsifiable scores as tested. **The 41 are a floor, not a ceiling.** Recorded on #1223.

## 6. Exact next steps

1. **#1225 — run the FIRST production promotion through the new lane.** Nothing has used it yet. Start with `20260818232639` (Coldlion spine, #1198): the merge-first order is now executable, so rehearse from merged main, then promote. Expect the first real run to surface things no test could.
2. **#1219 before any licensor load** — the systemic count-gate defect, BOTH patterns, across NBCU, Warner, Paramount and Disney, which were written from the same template.
3. **#1221 / #1222** before WildBrain's and Sega's first captures.
4. **#678 / #679 / #680 / #681** — Disney, Paramount, NBCU, Warner promotions. **The #611 gate those four cite as their blocker is CLOSED** (#674 and #611 both closed); they were only ever blocked on #1208, now merged.
5. **#1217 Peanuts landing schema** — classified and ready, with tonight's three defect patterns written into the issue so the author does not rediscover them.
6. **#1223** (32 untested guards) and **#1224** (three Lows from the final review).
7. **#1220** — the review wrappers. Six terminal failures tonight, every one exiting 0.

## 7. Sub-agent reports — SEPARATED BY AGENT

### Agent: WildBrain landing author — worktree `C:\repos\shared-db-worktrees\issue-1197-wildbrain` (RETIRED)
- **Asked to do:** #1197, the `plm.wildbrain_*` landing schema. Claim #1209, version `20260819010916`.
- **Actually did:** PR #1214, merged `fdb133c`. Two rounds. Version superseded to `20260819014639` by me when it backdated against main.
- **Found:** the reviewer's five findings were all real. While fixing High 1 it also closed **the identical defect two lines away in `observed_counts`**, which the reviewer had not raised. Its sweep for the broad-exception pattern found **11 more assertions**, three using `when others` — those would have passed on a typo in the test itself.
- **Deliberately did NOT do:** rename its own migration when it backdated. It reported and stopped, correctly, because supersession is a governed operation.
- **Worktree:** finished, retired, branch deleted.

### Agent: Sega landing author — worktree `C:\repos\shared-db-worktrees\issue-1196-sega` (RETIRED)
- **Asked to do:** #1196, the `plm.sega_*` landing schema plus an additive extension of `api.source_capture_inventory`. Claim #1210, version `20260819010933`.
- **Actually did:** PR #1215, merged `e9fb39e`. Two rounds plus a rewrite. Version superseded to `20260819015333` by me.
- **Found:** its first revision hid all RLS, revokes and grants behind a `DO` loop with `execute format('… plm.%I …')`, which defeated the object guard and hid the privilege model from any reader. Rewriting them as explicit per-table statements revealed **no privilege had been applied to a table it should not have been**. It copied the `authenticated` read predicate character-for-character from the existing `plm_read` policy rather than retyping it.
- **Pushed back on the review, correctly:** the reviewer counted one constraint as two defects. The agent said so and pinned both sites to the one constraint rather than inventing a second to make the count tidy.
- **Deliberately did NOT do:** rename its version; extend behavioural privilege denial to all eleven tables, arguing the catalogue half already proves all twelve grants — it chose a five-table spread, one per structural class, and said why.
- **Worktree:** finished, retired, branch deleted.

### Agent: preview-rehearsal path author — worktree `C:\repos\shared-db-worktrees\issue-1208-preview-rehearsal` (RETIRED)
- **Asked to do:** #1208, make the merge-first order executable and satisfy #1194's four review points.
- **Actually did:** PR #1213, merged `f975518`, across **eight authoring rounds**.
- **Found:** far more than it was sent for. The mutation sweep (#1223). **Two of its own false claims** from earlier rounds, including that the preview lock excludes merges and promotions — **it does not; nothing reads that ref**. Twelve multi-condition guards with a condition no test could drive, two of which were code defects rather than test gaps. An eleventh instance of the recurring shape hiding behind a **loose assertion** (`"message A|message B"`, where a different guard raised message B).
- **Verified against reality rather than mocks:** ran real `gh api` reads to confirm which producer files existed at the merge commits of #984, #992 and #1126 before deciding the absence rule. Four of ten were missing at the two oldest.
- **Deliberately did NOT do:** require the original run to bind to today's `PREVIEW_PROJECT_REF` — it would refuse **100%** of existing recoveries, since every one predates the preview rebuild. The residual is written into the code, a test and `AGENTS.md` so it cannot be reversed silently. Did not widen the preview lock. Did not fold the 32 remaining sweep survivors into an eighth-round review of the last gate before production. Reported **two mutants as equivalent** rather than claiming coverage it did not have, and left three unreachable guards in place with a note that deleting them reddens nothing.
- **Worktree:** finished, retired, branch deleted.

### Reviewers (read-only, wrote nothing)
- **Grok 4.6** — sequences 179, 183, 185, 187, 189, 193, 195, 197, 199. Carried the session. Found the doctored-workflow forge, the same-commit no-op, the 100%-refusal availability bug, the `?recursive=1` no-op, and the tenth instance.
- **Kimi K3** — sequences 180, 184 and 200 completed; **186, 188, 192, 194, 196 and 198 failed terminally.** Its completed reviews were excellent — sequence 200's APPROVE included a full per-exemption verification against the code. **Two of its dying runs left leads that became the next round's findings.**
- **Muse Spark 1.2** — tested at Albert's request on #1176. It read the change, narrated four review steps, then returned nothing. Treated as a failed review; no other model's opinion was substituted for it.

## 8. Coordination debt the app teams must know

**PopDAM `popdam3#92` must not proceed yet.** `20260819011639` is merged but **not in production**, so nothing has changed for live callers yet. When it is promoted, two callers break:

- `src/hooks/usePersistentOperation.ts` `start()` — "Start Fresh". **Should** raise; intended.
- `AssetDetailPanel.tsx:335` and `StyleGroupDetailPanel.tsx:688` — the `{status:"idle"}` cleanup. **Legitimate today, will break**, and must change in the same window.
- The worker must send `lease_token` and key off `lease_receipt_issued`, never off `ok` alone.
- `types/database.types.ts` still describes the three-argument form.
- **New (#1211 finding 1):** ambiguity is terminal with no API exit, even for the receipt holder. If the recovery plan expects automation to resume an operation through this API after reconciliation, **that path does not exist.**

## 9. What did NOT work — MANDATORY

- **Asking a reviewer twice.** I once started a round with Grok while the rotation had assigned kimi-k3. I killed it before reading any output and re-ran the assigned reviewer. The rotation exists so that nobody — including the orchestrator — can keep asking until something says yes.
- **Building a review packet from the current `main` SHA when the branch predated a merge.** It rendered main's own commits as deletions, and a reviewer accordingly described #1213 as reverting #1176. It does not. **Build packets from the merge base.** The same mistake could have hidden a real revert instead of inventing a fake one.
- **Leaving the old head SHA in a reused review brief.** The reviewer noticed the mismatch against the packet manifest and reviewed the sealed head, which was the right call. Had it followed my prose it would have produced evidence pinned to the wrong commit.
- **Poking a running `ai-kimi` job with `ask`.** It failed shortly after with `execution-context-denied`. Causation unproven; do not disturb a running review job.
- **`ai-kimi new --base main`** fails inside the review sandbox with `the requested base 'main' does not exist`. Pass the base as an explicit SHA.
- **Trusting a wrapper's exit code.** Six terminal reviewer failures tonight, **every one exiting 0**, all biased toward looking approved. `ai-kimi` records `phase: failed`, `terminal_reason` and `exit_code: 1` in its own `job.json` and then exits 0 — see #1220. Two completed reviews also had their full text truncated to the verdict line; the real review was recoverable only from `stream.jsonl`.
- **Cancelling a hung check, and not cancelling one.** The predecessor's warning about cancelling a *queued* run is right. But #1215's `SQL migration guards` ran **80 minutes on a check that normally takes 22 seconds** — that was hung, not queued, and it passed in under a minute after a cancel and re-run. Distinguish the two before applying the rule.
- **`--expand-active-claim-from-pr` does not always cover what the lease guard demands.** It missed indexes and policies twice. Re-run it after each push, then re-run the failed check — the guard's failure is often just stale.
- **A mutation sweep that times out leaves the file mutated** and silently poisons the next runs' baselines. Every sweep must assert a green baseline before it starts.

## 10. Facts that may already be stale

Everything in section 3 was checked at **2026-08-19T08:10Z**. `main` moved five times during this session. Re-derive the SHA, the maximum migration version and every PR state before acting.

**Worktrees I did NOT touch and did not create** — all pre-existing, all left deliberately, none abandoned by me: `codex-business-logic-system`, `handover`, `issue-1143-fr-ruling-forward`, `issue-1163-mg-category`, `issue-1171-bulk-operation-lease`, `issue-1184-coldlion`, `merge-race`, `pause-glm`, `preview-provenance`, `preview-ref`, and `.claude/worktrees/docs-slimming` (PR #1212, another session's live work). `scripts/reap-merged-worktrees.mjs` refuses while an orchestrator marker is open; run it after this marker closes.
