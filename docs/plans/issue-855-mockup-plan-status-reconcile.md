---
summary: Issue #855 plan: make the two mockup auto-match plans agree that the work (#544) is finished, fix their stale version numbers, and store real screenshots as the live-proof evidence. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-855, plan_mockup_auto_match.md, issue-544 plan status, mockup live-proof screenshots
---

# Plan: Mockup auto-match plans — one consistent "done" record with real screenshots (u2giants/popdam3#855)

Issue: https://github.com/u2giants/popdam3/issues/855 (review finding on merged docs PR u2giants/popdam3#854)
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md)
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS — 2026-11-25

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Capture live screenshots of the five matching cases and store them in the repo | ⬜ open | — |
| 2 | Root plan `plan_mockup_auto_match.md`: header, version references, Done text, step 9 evidence, status | ⬜ open | — |
| 3 | Companion plan `docs/plans/issue-544-mockup-auto-match.md`: mark superseded-and-done, point to root STATUS | ⬜ open | — |
| 4 | Regenerate `docs/INDEX.md`; PR, CI, merge | ⬜ open | — |
| 5 | Comment on #855 with links and close it | ⬜ open | — |

A fresh session starts at step 1.

## Part 1 — Why

### 1. The ultimate goal
Anyone (person or AI) who opens the mockup auto-match plans must immediately
see one truthful answer: **the feature is finished and live**, with pictures
that prove it — so nobody redoes finished work or trusts a claim that has no
proof behind it. *If a step conflicts with this goal, the goal wins — stop
and flag it.*

### 2. What this application is
PopDAM (`u2giants/popdam3`, branch `main`) — POP Creations' internal art
library at https://dam.designflow.app. It ships a product-mockup tool at
`/mockup/` (vendored from `u2giants/pop-mock`, synced automatically). The
**auto-match** feature (#544) makes the mockup button on a style group open
the right product (lenticular, framed, clock, canvas…) with the right
picture(s). Plans in this repo are Markdown files read STATUS-table first
(`AGENTS.md`); `docs/INDEX.md` lists every doc by its header.

### 3. What triggered this work
Issue #544 was closed 2026-11-06 after PR #853 shipped the feature. Docs PR
#854 then marked root-plan steps 8–9 done. The advisory reviewer found three
contradictions, still true on `origin/main` `787c20b8` (2026-11-25):
1. `plan_mockup_auto_match.md` header (line 2 summary, line 10 STATUS title)
   says "refreshed for pop-mock 7.3"; STATUS rows cite 7.4; step 8 gate (line
   317) says `/mockup/` serves **6.10**; Definition of Done (line 407) says
   production shows **v6.10**. File header `status: open` although every row
   is ✅.
2. `docs/plans/issue-544-mockup-auto-match.md` STATUS (lines 21-34) shows
   steps 0–9 ⬜ open ("nothing started") and claims to win on tool details;
   the root plan never links to it.
3. Step 9 evidence (root line 22) says screenshots were "captured
   (headless session could not attach image files)" — no durable artifact, so
   the live-proof claim is unverifiable.

Also now true: the live tool is **v8.9** (`curl -s
https://dam.designflow.app/mockup/ | grep -o 'APP_VERSION *= *"[0-9.]*"'`
→ `APP_VERSION="8.9"`, 2026-11-25), so the feature has survived later
releases — screenshots taken now prove it on today's tool.

### 4. Scope
In: the two plan files, new screenshot files, INDEX regeneration.
**NOT in this plan:** any code change; changing mockup matching rules;
reopening #544 (unless step 1 finds the feature broken — then stop, reopen
#544 with the screenshot, and report); editing `docs/MOCKUP_TOOL.md` beyond
a version mention if it is wrong.

## Part 2 — What we already know

### 5. Current state
- Root plan STATUS rows 1–9 ✅ with commit/PR/run evidence; row 9 lacks images.
- #544 closing comment holds reproduction URLs, e.g. lenticular A/B:
  `https://dam.designflow.app/mockup/?art=%2Fspaces%2Fthumbnails%2F39b82e1d-b061-403a-91b2-2fa77f255082.jpg&name=3FZ93MVSP09+packaging.ai&artB=%2Fspaces%2Fthumbnails%2F32ee47c3-37f3-4dbc-a71d-aa9632d40112.jpg&nameB=3FZ93MVSP09+tech+pack.pdf#/lenticular`
  (read the rest with `gh issue view 544 --repo u2giants/popdam3 --comments`).
- `docs/verification/` is the repo's evidence tree (ignored by AI context
  loading but committed).
- Nothing started.

### 6. Key findings
The work is done; only the record is inconsistent. Fixing the record plus
storing images settles all three findings.

### 7. Rejected approaches
- **Delete the companion plan** — loses history that later sessions may
  search for; mark it superseded instead.
- **Accept "screenshots captured" text** — violates the evidence rule (a
  done row cites an artifact). Rejected.
- **Rewrite old "6.10" text everywhere** — history sections (e.g. line 215
  already annotated "Superseded 2026-11-06") stay; only live gates/Done text
  change.

### 8. Design decisions
- **Locked:** root plan stays the single authoritative record; header
  `status: done`; summary "…completed 2026-11-06 (pop-mock 7.4; still working
  on 8.9 as of <date>)".
- **Locked:** companion plan header `status: done`, STATUS replaced with one
  line "Superseded — all steps completed under the root plan; see its STATUS"
  plus a link; keep the body as history.
- **Locked:** screenshots go to `docs/verification/issue-544/` named
  `<case>-<YYYYMMDD>.png` (lenticular-ab, framed, clock, canvas-unmatched,
  plaque-note).

## Part 3 — How to build it

### 9. Steps
**Step 1 — Screenshots.** `lead-only` (live visual judgment). Open each
reproduction URL from #544 in a real browser signed in to PopDAM, wait for
the art to render, screenshot the whole tool; confirm the product shown
matches the case (lenticular shows A and B in both windows, etc.). If any
case is wrong, stop (see §4). Save PNGs per §8. Gate: five PNG files exist
and each visibly shows its product with art.

**Step 2 — Root plan.** `helper-ok` (exact edits listed). Stop-and-ask: if
any other line asserts a version as a current requirement. In
`plan_mockup_auto_match.md`: line 2 summary and line 10 STATUS heading per
§8; line 317 "`/mockup/` serves 6.10" → "serves 7.4 or later"; line 407
"v6.10" → "v7.4 or later"; row 9 evidence: replace the parenthetical with
links to the five PNGs; header `status: done`; add a line under STATUS:
"Companion plan `docs/plans/issue-544-mockup-auto-match.md` is superseded by
this file." Gate: `grep -n "6\.10" plan_mockup_auto_match.md` shows only
history lines (≤ line 216 annotated).

**Step 3 — Companion plan.** `helper-ok`. Stop-and-ask: none. Apply §8 to
`docs/plans/issue-544-mockup-auto-match.md`. Gate: its STATUS shows no ⬜.

**Step 4 — Land.** `lead-only` (merge). `ai-doc-health --repo .
--fix-index`; branch `claude/issue-855-mockup-plan-record`, PR, CI green, AI
merges.

**Step 5 — Close.** `lead-only`. Comment on #855 with the merged PR and the
screenshot paths, signed with the session signature; close #855.

### 10. Tests
None new (docs only). Must stay green: doc-health workflow (advisory), CI.

### 11. Constraints and gotchas
- Never edit another session's `HANDOFF.d/` file.
- `docs/verification/` is in `.claudeignore`; that is fine — it is still committed.
- Don't paste login values; screenshots must not show tokens or emails —
  crop the browser chrome.
- Branch + PR; AI merges.

### 12. Access and environment
`gh` as `u2giants`. Browser with a PopDAM login (1Password `vibe_coding`,
search "PopDAM"). `ai-doc-health` from `popcre/ai-devops` on PATH.

### 13. Done, risks, open questions
Done: steps 1–5 ✅; both plans `status: done` and consistent; five PNGs
committed and linked; #855 closed with links.
Risk: a case no longer matches on v8.9 → that is a real regression; reopen
#544 instead of papering over it. Rollback: revert the docs PR.
Open: none for the owner.

## Self-audit
1. Executable without questions? Yes — §3 cites every bad line, §9 gives each edit and gate.
2. Background carried? Yes — §3 the three findings + today's tool version, §7 rejections.
3. Goal clear? Yes — §1: one truthful record with proof; §4 says what to do if proof fails.

## Lead launch prompt
```
You are the lead for u2giants/popdam3 issue #855. Read AGENTS.md, then
docs/plans/issue-855-mockup-plan-status-reconcile.md (STATUS first). Do
step 1 yourself, hand steps 2 and 3 to your helper, then do steps 4 and 5.
Your helper is your own tool's smaller model — Haiku (high effort) for
Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for
Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design
decisions, never merges or posts, asks you when a stop-and-ask trigger
fires, and is taken back after 30 minutes stuck. You check every gate,
merge, and close the issue.
```
