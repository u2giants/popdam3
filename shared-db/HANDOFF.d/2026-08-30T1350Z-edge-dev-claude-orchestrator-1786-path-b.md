---
issue: 1786
status: OPEN
owner: claude/orchestrator-1786-handover (shared-db.orch EDGE-DEV, session c1427a16)
---

# Orchestrator closeout — marker #1786 (EDGE-DEV, Claude), path B

All moving facts re-verified **2026-08-30T13:47Z** unless stamped otherwise.

- `origin/main` tip: `ac51457d2e3a140716199e8f20d848f923b3dc48` ("Fix pass-2 migration
  replay supersession ordering (#1859)") — **not mine**; another session merged it
  while I was closing out.
- Maximum migration version on `main`: `20260830130345_opa_authority_for_dcp_creative.sql`
  (563 migration files).
- Author lanes: **2 of 8** occupied, 2 protected claims, 0 expired locked.

---

## 1. What this session was doing, and why

Sole shared-db orchestrator for `u2giants/shared-db` under marker issue **#1786**.
Brief: keep the maximum concurrent author lanes filled continuously across issues
1658, 1662, 1684, 1669, 1645, 1722, 1692, 1656, 1703, 1719 — coordinate only, never
personally author structural SQL, dispatch every implementation to an agent in an
isolated worktree.

## 2. What actually landed

**Three pull requests merged (verified in `origin/main`):**

| PR | Issue | Merge commit | Evidence |
|----|-------|--------------|----------|
| #1829 | #1822 | `6109ac10219e115d7520a03baab99cb840cd8eff` | grok-4.6 APPROVE, assignment seq 544 |
| #1749 | #1645 | `6b29d4a2466f72f3f5a8ab0e8e283beab07d7e10` | guarded workflow run 33312999817 |
| #1660 | #1658 | `71938eb5826008382ae7f21a37a20dd26593faac` | three review cycles; three real grok findings fixed; muse and kimi approved independently |

**Four migrations applied to the protected shared preview project** (ledger
**550 → 554**). Target `mvpkijzfmfcxhnzqogzs` was confirmed from each run's own
output; production `qsllyeztdwjgirsysgai` was named only as the ref *not* written to.

| Version | Issue | Runs |
|---------|-------|------|
| `20260828232207` | #1769 | 33308168016 |
| `20260829004145` | #1684 | 33308886928 (dry) / 33308966671 (apply) — **DESTRUCTIVE** |
| `20260830110517` | #1645 | 33313310553 |
| `20260830130345` | #1658 | 33313809864 (dry) / 33313915158 (apply) |

Every apply used a positive control on the selector and by-name verification with
fake-name controls before it was believed.

**Issues filed:** #1848, #1850, #1851, #1852, #1855, #1856, #1857.
**Issues closed out:** #718 (non-recurrence, re-routed `owner-decision` /
`security-settings` / `owner-only`), #974 (not planned), #748 (completed).
**#508 split** → new issue #1848.

**No data rows were written to preview.** Migrations only.

## 3. Production

**NOTHING was promoted to production this session.** That is deliberate: every
promotion below needs Albert's window.

## 4. Preview's actual state — honestly

Preview is **not clean** and never is. As of my last verified apply
(2026-08-30 ~13:20Z) it held ledger 554 and was caught up with everything merged
**that I applied myself**.

⚠️ **One version I did NOT verify on preview: `20260830013942`**
(`orderlist_bridge_covering_index`, issue #1722). It merged into `main` inside my
window but was applied by an earlier session, and #1846 ("allowlist the #1722
preview ledger orphan reconciliation") suggests its preview history was irregular.
**Do not assume it is applied. Check it before the next preview run.**

Also live on preview: retired version `20260827183011` (the HARD_BLOCKED predecessor
of #1645). It stays applied on preview — that is what makes the reissue idempotent
there — and it is **not** a selector blocker because it sits on `main`.

## 5. Sub-agent blocks

### Agent: `a2ce2ccc` — PR #1818 (issue #1816), worktree `.claude/worktrees/pr1818-merge` and `shared-db-orchestrator-status-49e9e6`
- **Asked to do:** make the guarded merge refuse a head with no APPROVE at the exact head; fix the divergent approval predicate.
- **Actually did:** head `e3278f1048585c8ef5f6da5a9e311b6af9fdd030`. Fixed three real defects in `isApprovalFor`, mutation-tested: (a) `VERDICT: APPROVE ONLY WITH CONDITIONS` and `VERDICT: APPROVE -- WITH CONDITIONS` were read as **clean approvals** because the conditional lookahead tested adjacency to `WITH` rather than the claim — and this predicate feeds the **fail-open preview gate**, so a refusal-with-remedy authorized; (b) `## VERDICT: **APPROVED**` was refused because emphasis was stripped only before the label; (c) `__APPROVE__` was refused because `\b` does not fire on an underscore.
- **Found:** grok's blocking finding (unpaginated ref listing against ~370 refs) was **wrong** — measured live, `git/matching-refs` is not a paged collection; both forms return all 421 assignment and 114 replacement refs. Claim AND measurement are recorded at the call site so nobody "fixes" it again. Also found that its own governance comment permanently locked the PR head (see #1855).
- **PR / branch:** #1818, `claude/issue-1816-exact-head-approval-gate`, OPEN, MERGEABLE, all non-skipped checks green.
- **Worktree:** **live (resumable)** — two worktrees sit at this head.
- **Deliberately did NOT do:** did not make the lanes file import the shared predicate. That is a deliberate follow-up **after** #1818 merges; a second copy still exists in `manage-migration-author-lanes.mjs`.
- **Died:** HTTP 429 session limit, resets 11:50am America/New_York. Its last action was re-running muse with corrected vocabulary. **My four-way lease census (live / finished / void / superseded) was never answered.**

### Agent: `a4159d8d` — issue #1772, worktree `.claude/worktrees/orderlist-input-contract-1772`
- **Asked to do:** enforce the OrderList input-only write contract in the PopDAM order RPCs.
- **Actually did:** pushed **PR #1853**, head `d06d511feacd8722f2b933027db004c0ef4162b5`. (Confirmed live — this was unknown at the time it died.)
- **PR / branch:** #1853, `claude/1772-orderlist-input-contract`, OPEN, MERGEABLE, but ⚠️ **the `SQL migration guards` check is FAILING.** That is the first thing the next lane must fix.
- **Worktree:** **live (resumable)**.
- **Deliberately did NOT do:** did not take a second reviewer slot — it verified that every other provider was genuinely leased to PRs #1818 and #1823, not stale, and correctly waited rather than forcing a draw.
- **Died:** HTTP 429 session limit, same reset.

### Agent: `a73ee9a` — reviewer-lease hand-back attempt
- **Asked to do:** release a muse lease so another lane could commission.
- **Actually did:** **read the live refs and refused**, correctly. The lease was live and belonged to PR #1749; executing my instruction would have deleted it and drawn a replacement at a void head. **The agent was right and I was wrong.**
- **Worktree:** finished.

### Agent: PR #1823 lane (issue #505)
- **Actually did:** head `1a5de86f119663d5db9fb4a39d3464a7d77adc08`, version `20260830130801`, all 17 checks green at the time.
- ⚠️ **STALE AS OF 13:47Z: PR #1823 is now `CONFLICTING`** — `main` moved under it. It must be updated from the new main tip and re-checked before anything else.
- **Blocked on:** one clean reviewer signature. Codex disqualified (repetition), glm and kimi disqualified (their own findings shaped the content — findings-only, not verdict-eligible), deepseek unavailable (unfunded), grok and muse were both inside PR #1818's four.
- **Worktree:** live.

## 6. What I was about to do next

Name a clean reviewer for PR #1823 and answer the #1818 lease census. Both are
superseded by this handover.

## 7. Blocked on

**One genuine owner question — see issue tagged `needs-albert`:** fund the DeepSeek
reviewer account or bench it. Verified dead twice today (`ai-deepseek-agent doctor
--live` → HTTP 402 "Insufficient Balance"). It is still handed out by the rotation,
so every lane burns a draw on it; it also occupies a lease it cannot use and has
forced multiple replacement draws.

**Production promotion window** (Albert's, in timestamp order):
`20260828232207` (#1769) · `20260829004145` (#1684, **DESTRUCTIVE** — truncates 5
tables, drops a table and a view, retypes to uuid) · `20260830013942` (#1722) ·
`20260830110517` (#1645 — a **first install**, because the HARD_BLOCKED predecessor
never reached production) · `20260830130345` (#1658) · plus #1848
(`20260802171000`).

**Held owner questions:** the title-spelling ruling (recorded on issue #640 comment
`5467015816`, scoped to *Mortal Kombat II (2026)* only); whether to pursue removing
the licensing reviewer's name from two pre-ruling committed files.

## 8. What I tried that did NOT work — MANDATORY

1. **I released author claim #1711 on "the PR merged."** Wrong. #1684's acceptance
   test is a **production** verification, so the claim still owed work. Then
   `--cleanup-stale` closed it independently, and I concluded the #1684 rehearsal
   helper was blocked and nearly built a claim-restoration command. **The agent
   corrected me twice:** the post-merge rehearsal *workflow* authorises on merge-commit
   ancestry of the current main tip and explicitly refuses `claim_pr` — it needs no
   live claim at all. **The helper's precondition is not the lane's precondition.**
   Filed as #1852.
2. **I ordered `a73ee9a` to release a muse lease it no longer held.** It refused and
   was right. Do not instruct a lane against the live refs.
3. **I told `a2ce2ccc` to "release every non-live lease through the governed path."**
   There is no plain release command — the only governed release is the *replacement*
   path, which releases and draws a successor in one operation and therefore refuses
   when the pool is empty. A slot becomes unreturnable exactly when returning it
   matters. Its refusal text also **misstates its own cause**
   (`every active provider has already failed on this exact head` — nobody had
   failed; all were busy elsewhere). Filed on #1851.
4. **A lane's red-then-green proof was worthless** because a script silently ate
   word-boundary markers and produced a red run for the wrong reason. Fixed by taking
   the pre-fix code from `git show HEAD:…`. **Never reconstruct a "before" state.**
5. **A repo-wide grep returned empty because of shell escaping** and read as "no
   residual copies". A fixed-string positive control found two real copies instantly.
   **A clean result is evidence only after the instrument has produced a positive.**
6. **A NUL byte written into source by an agent's own edit** silently broke a mutation
   probe. Found, stripped, and every changed file scanned.
7. **Kimi returned a REVISE whose main blocking finding was wrong** (claimed a
   baseline pinned a pre-change hash; admitted it could not compute the hash). The
   lane measured, presented the numbers, and explicitly invited refusal rather than
   asking for a withdrawal — kimi withdrew on its own reading. Its second finding was
   real and was fixed. **Tell a reviewer not to soften a finding to be agreeable;
   a recorded open objection beats one talked down.**
8. **I acted as the reviewer queue by hand**, because the machinery has none, and then
   **reordered** my own queue to put #1818 first once its lane measured that a live
   fail-open gate was reading `APPROVE ONLY WITH CONDITIONS` as a clean approval.
9. **I twice refused to free a live reviewer lease** to unblock a lane — that is a
   straight transfer of cost, not a fix. Handing back a *dead* slot is different and
   I did encourage it.
10. **The shared checkout `C:\repos\shared-db` was ~30 commits behind `origin/main`**,
    silently. Read verification facts from `origin/main` through a temporary detached
    worktree.

## 9. Facts that may already be stale

- **PR #1823 is CONFLICTING** as of 13:47Z (it was green earlier today). Anything
  said about it being merge-ready is stale.
- **PR #1853's `SQL migration guards` check is FAILING** as of 13:47Z.
- Preview ledger **554** was read at ~13:20Z, and `20260830013942` was never verified
  there by me at all (see §4).
- The reviewer-lease census for PR #1818 was never completed; treat every lease
  attribution in this file as at-best hours old.
- `main` moved to `ac51457d` under me. Re-derive every version and object name from
  the merge commit's own file list on `origin/main`, never from a working tree, an
  issue title, or this file.

## 10. The four compounding reviewer-allocation defects (all on #1851)

Recorded here because they are what actually stopped this session, and they compound:

1. **No queue.** A freed lease goes to whoever calls at the instant it drops, not to
   whoever waited longest. Measured: grok freed from #1818 and went to a *later*
   arrival while a lane had polled ~1 hour. The failure mode is **starvation, not
   delay**, and nothing anywhere records that a lane was waiting.
2. **No per-PR ceiling.** PR #1818 accumulated **four of six** reviewers through
   individually-correct replacement draws. Adding reviewers does not fix this — it
   only raises how much one PR can absorb.
3. **No governed exit for a disqualified draw.** The replacement path accepts only
   *terminal provider-failure* codes, so a lane facing a conflicted reviewer must
   either burn the slot or **file a false provider failure against a working
   provider** — reportedly how glm was benched for two days.
4. **A lease cannot be handed back** (see §8.3).

Underneath all four: **review is self-consuming.** Every fix authored in response to
a finding disqualifies the reviewer that raised it, so a thorough review shrinks the
clean pool one draw at a time. And **nothing reclaims a lease on verdict or on merge** —
a lease is only overwritten by the next taker of that same reviewer, which happens
reliably only under contention, i.e. exactly when the lost capacity hurts most.

## 11. Worktrees — every one accounted for

Retired nothing. `reap-merged-worktrees.mjs` refuses while an `orchestrator-marker`
issue is open, which is correct, and I am closing that marker as my final action —
so **worktree reaping is the next orchestrator's first easy win**, not an oversight.

Live and resumable: `pr1818-merge`, `shared-db-orchestrator-status-49e9e6` (both #1818),
`orderlist-input-contract-1772` (#1772/PR #1853), `shared-db-orchestrator-3feb07` (mine,
this handover). Everything else under `.claude/worktrees/`, `.agents/worktrees/`,
`C:\repos\shared-db-worktrees\` and `C:\repos\shared-db-1810` predates this session and
was **deliberately left untouched** — I did not open them, and I have no evidence about
whether they are dirty.

## 12. Secrets sweep

**Swept, nothing new.** No credential appeared in this session, nothing was pasted into
chat, no `.env` or connection string was written to a scratch file, and the diff and
untracked files were checked. Nothing was added to or changed in the `vibe_coding` vault.
The one credential-adjacent fact is a *funding* state, not a secret: the DeepSeek reviewer
account has a zero balance (§7).

## 13. Documentation pass

`AGENTS.md` is not wrong as a result of this session. The durable lessons are recorded
where they belong — the reviewer-allocation defects on **#1851**, the unauthenticated
verdict evidence on **#1855**, the claim/rehearsal precondition on **#1852** — and
in this file. **Docs pass: nothing outside the handover and those issues is stale.**

One evidence obligation to state plainly: the #1658 migration rewrote
`api.db_data_admin_scraped_properties(text,text,integer)` with `CREATE OR REPLACE`.
Any earlier rehearsal of that function is **void**. It was re-verified on preview at
body level (markers `explicit_dcp_to_opa_property_id`, `style_guide_names`,
`contract_opa_conflict`, `opa_scope_conflict` present; the
`plm.dcp_property_licensor_resolution` join and both clean-row prose strings removed),
because **for a reissue or a replace, object presence proves nothing** — the
predecessor already created the names.
