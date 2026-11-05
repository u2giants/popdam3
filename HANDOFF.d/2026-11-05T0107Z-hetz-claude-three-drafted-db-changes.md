---
issue: 5581
status: OPEN
owner: claude/handoff-545-db-changes
---

# Three shared-db changes set aside during popdam3#545

All states checked Nov 4, 2026, 8:07 PM EST. Recheck them first: this repo moves hourly.

## 0. Business decisions only the owner can make

None block this work. Nothing here needs Albert's judgement; do not ask him about these changes.

Already settled, do not re-ask:
- Oct 27: Microsoft-login @popcre.com staff get PopDAM and PopPIM; staff without Microsoft login get no PopPIM.
- Nov 4: deborah.asalles@gmail.com is staff. Her account is dsalles@popcre.com, not the Gmail address.

Not part of this work: Deborah must sign in with Microsoft as dsalles@popcre.com, and her role is then set in Settings → Users. Recorded on [#545](https://github.com/u2giants/popdam3/issues/545).

## 1. What this application is

PopDAM and PopSG are POP Creations' art library and style guide search, in [u2giants/popdam3](https://github.com/u2giants/popdam3). All POP apps share one Supabase database, whose structure is changed only through [popcre/shared-db](https://github.com/popcre/shared-db).

## 2. What we set out to do

popdam3#545 is finished and closed. To land its signup change (popcre/shared-db#5587), this session moved three older pull requests to draft, because the merge queue refuses any migration while an open non-draft PR holds an older version. Albert asked for one nested session per change. Starting them was refused because he was on Remote Control, so he asked for them to be handed off here.

## 3. Current state

Nothing from these three is applied to preview or production by this session. No claims or locks are held (closeout check passed with zero).

| PR | Purpose | State | Migration version |
|---|---|---|---|
| [#5541](https://github.com/popcre/shared-db/pull/5541) | Automatic fix of finding #5540 (PDF rescan) | Draft, conflicts; #5540 CLOSED | 20261103142609 |
| [#5550](https://github.com/popcre/shared-db/pull/5550) | Automatic fix of finding #5549 (Grogu/Child) | Draft, conflicts; #5549 and #5551 CLOSED | 20261104000346 |
| [#5582](https://github.com/popcre/shared-db/pull/5582) | Search ranking, closes #5581 | **CLOSED unmerged at 7:50 PM EST by someone else, not this session**; #5581 still OPEN | 20261104212216, 20261104212217 |

#5582 was drafted at about 6:26 PM EST with a failing `supabase/tests against an ephemeral database` check. A later head, d7d3d175, carries an advisory REVISE review. Its branch is `fix/search-eval-ranking-680`.

main is 20a05064175974236e2e51d58c2166ed77c36eb8; newest migration is `20261105002300`. Both may be stale.

## 4. What did not work

- Queueing #5587 while these were open: refused with "behind open PR". Drafting is the mechanism that clears this; a draft holds no reservation.
- A new migration version alone did not clear the refusal, for the same reason.
- Re-running the normal preview after main moved: refused with "already applied on preview". The automation then re-ran evidence itself at the new main and production applied. Do not fight this; check before dispatching.
- Production refused once because main moved past the rehearsed commit.
- `gh pr merge` while queued only says "already queued". The poll guard blocks shell loops over PR reads, and `gh run watch` was denied here.
- `ai-task-gates check --before shipping` is not a valid action.

## 5. Key findings

- Rule source: [merge-queue-contract.mjs](https://github.com/popcre/shared-db/blob/main/scripts/merge-queue-contract.mjs), queue-order check.
- `Closes #N` closes the work issue at merge, but production admission needs one open linked work issue. This session reopened it after merge and closed it after production.
- #5594 (popdam3#706) later changed `public.search_style_guide_library_v2`. Any #5581 work must derive from the current live body, not the #5582 copy.

## 6. Exact next steps

Do these as one session per change if Albert's message came from the desktop app.

1. #5541: compare its fixes with main ([test source on its branch](https://github.com/popcre/shared-db/blob/review-fix/5540/supabase/tests/pdf_indra_rescan_contracts.sql)). If covered, close it with evidence. Otherwise refresh onto main with a new version and merge. You'll know it worked when the PR is closed with reason, or merged with the version in the production ledger.
2. #5550: same test. Its finding and #5551 are closed, and later Grogu commits (#5547, #5563) may cover it. You'll know it worked by the same gate.
3. #5581: first learn who closed #5582 at 7:50 PM EST and why, and look for a successor PR. If one exists, leave it to that owner and note it on #5581. If none, rebuild from `fix/search-eval-ranking-680` with new versions, fix the failing test and consider the REVISE findings. You'll know it worked when a live search for "mat" ranks real mats above product codes, PopSG file and folder names lead over PDF body mentions, and evidence is on #5581 and popdam3#680.
4. Delete this file when all three are settled.

## 7. Constraints

Read [AGENTS.md](https://github.com/popcre/shared-db/blob/main/AGENTS.md) and [current-workflow.md](https://github.com/popcre/shared-db/blob/main/docs/agents/current-workflow.md); load `shared-db-change`. Use your own worktree. Reviews are advisory. Never reuse a version or backdate one. Merged-main preview, then automatic production; no manual production command. Prove the target before every write.

## 8. Access

`gh` is authenticated on hetz. The Supabase MCP points at production; preview goes through the workflow. Secrets are in 1Password `vibe_coding`. None appeared in this session.

## 9. Open questions and risks

- Unknown: who closed #5582 and why; a sibling session may own it.
- Marking #5541 or #5550 ready without a new version would block the queue again.
- Drafting decisions, Nov 4, 2026: reversible, explained in a comment on each PR.

## Part (b): sub-agents

None were dispatched. The three nested sessions were never started.

## Self-audit

1. Newcomer can continue: yes, §1-3 and §6.
2. As well as this session: yes, §4-5 and §7.
3. All details: yes, §2-9; §9 names the one unknown and §6 step 3 resolves it.
4. Owner decisions in §0: yes, none needed; a walk of §1-9 found only Deborah's sign-in, listed there.
