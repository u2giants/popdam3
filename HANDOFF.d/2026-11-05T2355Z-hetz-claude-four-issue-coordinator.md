---
issue: 706
status: OPEN
owner: claude/coordinator-handoff-nov5 (coordinator chat d9004d18)
---

# Coordinator handoff: four PopDAM issues, Nov 4–5, 2026

All states verified Thursday, Nov 5, 2026, 6:55 PM EST unless dated otherwise. Recheck before acting.

## 0. Business decisions only the owner can make

None open. Already settled, do not re-ask:
- Nov 5, 6:53 PM EST. Albert, verbatim: "reworked." Meaning-based search in PopSG is to be **reworked**, not dropped. It stays switched off until it passes the same tests.
- Nov 5. Albert upgraded the shared database hardware (to Medium at about 12:19 PM EST per #804; restart seen 1:46 PM EST). Any further paid upgrade is his call. Bring him one recommendation with cost and measured benefit, never a menu.
- Oct 27. Every Microsoft-login @popcre.com user gets PopDAM and PopPIM (owner rule, quoted on #545).

## 1. What this application is

PopDAM is POP Creations' art library and PopSG is its style-guide search, both in [u2giants/popdam3](https://github.com/u2giants/popdam3). All POP apps share one Supabase database (production project `qsllyeztdwjgirsysgai`). Its structure changes only through [popcre/shared-db](https://github.com/popcre/shared-db), which promotes to production automatically after a preview rehearsal. Picture embeddings for PopSG are produced by a GPU poller on the `edge-dev` machine.

## 2. What we set out to do

Albert asked for one nested session per issue: PopSG indexing ([#706](https://github.com/u2giants/popdam3/issues/706)), excluded search documents ([#663](https://github.com/u2giants/popdam3/issues/663)), retailer tags ([#698](https://github.com/u2giants/popdam3/issues/698)) and PopPIM access ([#545](https://github.com/u2giants/popdam3/issues/545)). This session coordinated them and changed no code itself.

## 3. Current state

- **#698 retailer tags: CLOSED, verified.** Fixed by [#729](https://github.com/u2giants/popdam3/pull/729). Misses fell from 2,991 of 5,902 to 410 of 5,958, and about 3,600 tags were backfilled.
- **#663 excluded search documents: CLOSED, verified.** Fixed by [#728](https://github.com/u2giants/popdam3/pull/728), [shared-db#5585](https://github.com/popcre/shared-db/pull/5585) and [#5603](https://github.com/popcre/shared-db/pull/5603). Excluded documents went from 1,123 to 0, with a one-time reset at about 8:08 PM EST on Nov 4.
- **#545 PopPIM access: CLOSED, verified.** All 28 SSO staff have both apps; the signup hook ([shared-db#5587](https://github.com/popcre/shared-db/pull/5587)) is live, and the revoked logins are signed out. Fallout: three older shared-db PRs were drafted. #5541 and #5550 were retired with replacements #5615 and #5564 live. The search ranking fix [shared-db#5581](https://github.com/popcre/shared-db/issues/5581) was rebuilt as #5612 and #5614, is live and CLOSED, and its handoff is retired.
- **#706 PopSG indexing: OPEN.**
  - Done: claim timeout fixed and backfill resumed ([shared-db#5588](https://github.com/popcre/shared-db/pull/5588)). Keyword-first ranking and grants are live (#5594, #5607). UI wiring, with the switch off, landed in popdam3 #730 and #741.
  - The test account is deleted. The picture index was rebuilt live, 662 MB to 416 MB (#5691, #5697, #5710, #5728, #5734), and picture indexing reached about 217,780 of about 219,000 usable files at 6:29 PM EST.
  - **Final tests failed at 6:45 PM EST:**
    - meaning-based search fixed 0 of 10 misspellings the keyword search misses;
    - it returned results for both nonsense queries;
    - it added 1–1.7 s per search.
  - The switch `POPSG_SEARCH_MODE` stays absent, so PopSG runs keyword search.
  - The rework order was delivered to session `local_24c734a5-9e85-4f4c-9354-7b8777b53046` (chat 6f863884) at 6:53 PM EST. That session owns #706.
- **#804 database slowness: OPEN.** [#804](https://github.com/u2giants/popdam3/issues/804) has its own coordinator, which handed over at 6:29 PM EST. Remaining: compaction rollout (shared-db #5744 merged, #5775 queued, production pending), a search test set rerun, and the final ranked account.
  - After the upgrade, saves dropped from about 2.5 s to 0.13 s.
  - Search is still slow: typical about 2.6 s, slowest 4–7 s, against a 3 s target.
  - This coordinator added scope items 8–11 there: other apps, the tagging run, PopDAM search speed and the re-score, and application layers.
- **PopDAM search re-score after the tagging run (#680):** owned by #804's scope item 10. The tagging run was at 5,633 of 117,535 items at 9:18 AM EST Nov 5.
- Nothing of this coordinator's is uncommitted. This file is its only change, delivered by PR from branch `claude/coordinator-handoff-nov5`.

## 4. What did not work

- **Trusting session notes as fact.** Several reports were wrong.
  - A 7:50 PM closing time, which was really 6:50 PM.
  - "Waiting" items that nobody was actually running: the index rebuild and the final tests on Nov 5 morning.
  - A stall alert that stayed silent at 0.3 and 0.8 files per second.
  - Verify live: the issue state, a database count, or the session transcript.
- **shared-db releases repeatedly refused** for several reasons:
  - a missing "Closes #" link;
  - a version older than main;
  - an open non-draft PR holding an older version;
  - main moving past the rehearsed commit;
  - a review note closed the wrong way, which holds promotion.
  - Do not bypass these. Fix the cause and let automation retry.
- **Hand-written PR polling loops** are blocked by a hook. Use `bin/ai-pr-wait`.
- **Starting proposal cards** fails while Albert is on Remote Control. Route follow-ups by messaging an existing session instead.
- **Database restart.** A database restart, including the hardware upgrade, empties memory, so measure search speed only after warm-up.

## 5. Key findings

- The overnight indexing crawl had two causes:
  - popdam3 PR 750 cut the batch size to 1 at 10:38 PM EST Nov 4; PR 799 and PR 811 restored adaptive batching;
  - database disk starvation, which the hardware upgrade largely fixed.
- The text-tower vectors for PopSG were the wrong modality: nonsense scored higher than real queries. They were cleared and replaced with picture vectors (locked decision #4664, `plan_vector_consolidation.md`).

## 6. Exact next steps

1. Confirm #706's session took the rework order: read its transcript, or the newest #706 comment, for Albert's "reworked" being recorded. You'll know it worked when #706 shows a dated rework plan.
2. When #706's rework retests, verify the gates yourself:
   - misspellings fixed beyond keyword;
   - zero results for nonsense;
   - a speed cost within target.

   Only then may `POPSG_SEARCH_MODE` be set. You'll know it worked when PopSG on sg.designflow.app returns meaning-based results live, and #706's checkboxes are ticked with evidence.
3. Check #804 for a successor coordinator after its 6:29 PM EST handover. If no activity for 30 minutes, the compaction rollout and test rerun are unowned: take them over on #804. You'll know it worked when #804 has a ranked before/after account and search p95 is at or under 3 s, or a stated reason why not.
4. Delete this file in the PR that closes #706, once steps 1–3 pass.

## 7. Constraints in force

- Albert's standing rules apply: [AGENTS.md](https://github.com/u2giants/popdam3/blob/main/AGENTS.md), plain replies of 120 words or fewer, times in EST.
- No human approvals. Never push to main.
- Shared-db is claim-first and promotes automatically; never manually apply to production.
- Do not switch on meaning-based search early. Do not stop indexing, and do not remove indexes for speed.

## 8. Access and environment

- Supabase MCP reaches the live project; confirm `qsllyeztdwjgirsysgai`.
- Secrets live in 1Password `vibe_coding`, never in chat.
- Linked sessions (Claude Desktop on hetz):
  - #706: `local_24c734a5-9e85-4f4c-9354-7b8777b53046` (running);
  - #545: `local_964f1828-db07-4c61-98b6-6a0e200c51af` (idle; its work is complete).

## 9. Open questions and risks

- Meaning-based search may never beat keyword search on this data. The rework could end with evidence that it should stay off. If so, report it to Albert as a business choice, Nov 5.
- Search speed may stay above 3 s after compaction. A further hardware step costs money and is Albert's call.

## Self-audit (Nov 5, 6:55 PM EST)

1. A newcomer can continue: §1–§3 give the app, issues and states, and §6 gives ordered steps. Yes.
2. They can continue as well as this session: §4 and §5 hold the dead ends and findings. Yes.
3. Details are complete: background (§1–2), state (§3), failures (§4), decisions (§0), risks (§9), next actions with gates (§6). Yes.
4. Owner sweep: walking §3, §6 and §9 finds two owner items, rework (settled) and a paid upgrade (possible). Both appear in §0. Yes.
