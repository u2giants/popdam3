---
issue: 1225
status: OPEN
owner: claude-20260819-092000Z
---

# HANDOFF — shared-db orchestrator closeout (2026-08-19 14:50 UTC, edge-dev/Claude)

Marker: **#1229**. Predecessor: #1207 (closed), whose closeout was
`HANDOFF.d/2026-08-19T0810Z-edge-dev-claude-orchestrator-closeout.md` (issue #1225).

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking now
None.

### Waiting on Albert, not blocking
- **#1249 (NEW) — who may read raw licensed capture data?** The Sega landing grants
  `authenticated` SELECT on its licensed tables; WildBrain, written from the same template
  days apart, grants nobody. Both are now in production disagreeing with each other. This is
  a business question about staff access to raw licensor captures, not a technical
  preference. The next landing author will copy whichever file they happen to open.
- **#1166 — queue triage.** ~90 open `db-work` issues. Only Albert can say which of his own
  business items are still live.
- **#1204 / #1226 — Coldlion phases 2-6** (~25 tables) and the seven-year backfill.
  **NOTE: another session appears to have started on this** — see section 8.

### Settled, do NOT re-ask
- The owner-decision approval ritual stays RETIRED for technical sign-off. Never ask Albert
  to sign off on technical risk. It was not asked once this session.
- Do not go around the safety gate. It was not necessary — the gate carried six migrations
  to production today with no bypass and no edited `if:`.

## 1. What this application is

`u2giants/shared-db` owns the STRUCTURE of the shared Supabase database used by about nine
POP Creations applications. **Preview is `mvpkijzfmfcxhnzqogzs`. Production is
`qsllyeztdwjgirsysgai`.** One orchestrator, three migration-author lanes, every structural
change through an exact issue, permanent version reservation, claim, branch, worktree, PR,
preview rehearsal from merged main, independent review, and bounded production promotion.

## 2. What this session was asked to do

Verbatim: *"Start a shared-db orchestrator session. push through to completion the coldlion
ingest tables and the licensor scrape tables and anything else you can do simultaneously."*

Both were completed to production.

## 3. Current state — VERIFIED 2026-08-19T14:50Z, re-derive before trusting

- `origin/main` = `9002da92c53732a62a7cdeee808b3d40d9b1383c` at the last check. **Main moved
  seven times during this session from another active session.** Always re-derive.
- **Lanes: 0 of 3 occupied. No open `db-claim` issues. No expired claims.**
- Queue audit: `fullyAudited: true`, `unclassified: []`, `malformed: []`.
  `dispatchable: [1090, 1140, 1225]` — but see section 6 before touching #1090.
- **The main checkout `C:\repos\shared-db` is on branch
  `plan-coldlion-landing-phases-2-6`, which is NOT mine.** Another session owns it. It was
  clean (0 modified, 0 untracked) when I looked. Do not switch it without checking.
- Open PRs: #1212 (`docs/slim-agents-handoff`) — another session's, untouched all day.
- My three author worktrees and the review worktree are retired and their branches deleted.

### Production `qsllyeztdwjgirsysgai` — SIX migrations applied today

| Version | What | Promotion review |
|---|---|---|
| `20260818232639` | ColdLion landing spine (#1198) | Grok 4.6 seq 201 |
| `20260819014639` | WildBrain DAM landing | Grok 4.6 seq 209r-A |
| `20260819015333` | Sega DSI landing | Grok 4.6 seq 209r-A |
| `20260819112524` | WildBrain + Sega gate fixes (#1221/#1222) | Grok 4.6 seq 209r-B |
| `20260819123658` | NBCU count-gate hardening (#1219) | Grok 4.6 seq 209r-B |
| `20260819125713` | Peanuts (Tenovos) landing (#1217) | Grok 4.6 seq 211 |

Every one verified by reading production's own `supabase migration list` inside the apply
run, not by the workflow's word. `CATALOG VERIFICATION: no hard failure found` on each. The
NBCU migration additionally self-proved on production at apply time:
`NBCU count-gate hardening PROVED (8 argument refusals + 7 gate assertions)`.

**Still NOT on production:** `20260818203751` (mgCategory, historical-recovery case,
untouched today) and `20260819011639` (PopDAM lease — deliberately stopped, see section 9).

### Preview `mvpkijzfmfcxhnzqogzs`
Carries everything production carries, plus `20260819011639` and `20260818203751`.

## 4. Merged this session — THREE pull requests

| PR | What | Review path |
|---|---|---|
| #1236 | WildBrain + Sega finalize gate fixes (#1221/#1222) | Grok seq 205 APPROVE, no defects |
| #1233 | NBCU count-gate hardening (#1219) | Grok seq 203 REVISE (1 High) → Kimi seq 206 APPROVE |
| #1234 | Peanuts (Tenovos) landing (#1217) | Grok seq 207 REVISE (3 High, 2 Med, 1 Low) → Kimi seq 208 APPROVE → Kimi seq 210 APPROVE |

Issues closed: #1198, #1217, #1219, #1221, #1222. Claims closed: #1230, #1231, #1232.
Issues opened: #1229 (marker), #1235, #1239, #1240, #1249.

## 5. Sub-agent reports — SEPARATED BY AGENT

### Agent: NBCU count-gate author — worktree `issue-1219-null-count-gate` (RETIRED)
- **Asked to do:** #1219. Claim #1230, version `20260819112451` → superseded to `20260819123658`.
- **Actually did:** PR #1233, merged `ff26a7f`. Three rounds.
- **Found beyond the brief:** a THIRD defect shape nobody had named — a numeric-looking JSON
  *string* (`"12"`) casts cleanly through `->>` and was ACCEPTED as a count. A silent wrong
  answer, not a crash. Also found `excluded_unlicensed_assets` is an `integer` column, not
  `bigint`, so it needed its own narrower range limit — the identical wedge one branch over.
- **Disproved half its own claim:** `plm.finalize_warner_capture` **does not exist**. The real
  object is `plm.finalize_wb_capture` and it is NOT affected (typed integer column, and
  `begin_wb_capture` already refuses null and `<= 0`). Paramount and both Disney schemas have
  no jsonb `expected_counts` at all. The "systemic" defect was NBCU-only.
- **Its own fix reopened the defect once.** Round one caught that `1.0` passes
  `jsonb_typeof = 'number'` and `1.0 = trunc(1.0)`, then dies on the leftover text-to-int
  cast. It reproduced this on a real PostgreSQL 18 cluster before fixing it.
- **Deliberately did NOT do:** rename its own backdated migration (supersession is governed);
  add the repo-wide `check-sql.sh` guard, because it would redden main today — that is #1235.

### Agent: Peanuts landing author — worktree `issue-1217-peanuts-landing` (RETIRED)
- **Asked to do:** #1217. Claim #1231, version `20260819112505` → superseded to `20260819125713`.
- **Actually did:** PR #1234, merged `9002da9`. Four rounds.
- **Corrected its own draft:** its first `finalize_` raised on rejection, which would roll back
  the very row recording why the capture failed. Changed to persist `rejected` + `WARNING` +
  return, matching the siblings.
- **Found a defect in its OWN tests:** C6 and C7 only raised a `warning`, which does not fail
  a psql run, so dropping `peanuts_capture_media_zero_chk` left the suite GREEN. Both now set
  a fired flag and raise. It then audited all 36 other `raise warning` statements in the file
  — the reviewer verified that sweep in full and found no remaining hole.
- **Retracted an overstated coverage claim twice, the second time unprompted.** Reported "15
  mutations", review disproved six; reported "26 all caught", review disproved several; final
  honest number is 35, split 24 by named assertion and 11 by the mutation erroring the suite
  out. It stated the split rather than hiding the weaker half.
- **Rewrote another schema's tripwire correctly.** Adding 19 tables to
  `api.source_capture_inventory` fired Sega's F1 (`19 classification changes`). It rewrote F1
  so the expectation stays independent of the view — the reviewer confirmed it is still a real
  tripwire and not a tautology — and made an unknown prefix fail with a message telling the
  next author exactly what one-line change to make. That is #1195's phase-2 tripwire defused.
- **Deliberately did NOT do:** adopt WildBrain's tables to fix its inventory classification
  (that is #1239); rename its version.

### Agent: WildBrain/Sega follow-ups author — worktree `issue-1221-1222-landing-followups` (RETIRED)
- **Asked to do:** #1221 + #1222 in one migration. Claim #1232, version `20260819112524`.
- **Actually did:** PR #1236, merged `e920441`. One round, APPROVE with no defects.
- **Found beyond the brief:** #1222's fix list never mentioned the Sega **reported** side's own
  cast, used twice. Same wedge, fixed and tested.
- **Found and fixed a fixture collision it caused itself:** a capture dated 2099-09 became the
  newest complete Sega capture and broke an unrelated section, because
  `api.source_capture_inventory` orders by `source_captured_at`. Re-dated with the reason
  written into the test so the next fixture author does not repeat it.
- **Was honest about weak tests:** said openly that F13 and F14 pass both ways by design rather
  than dressing them up as guards. The reviewer judged that correct and the tests not dead
  weight.
- **Deliberately did NOT do:** add an extra-key sweep to the WildBrain gate (that is #1240);
  alter or drop `wildbrain_era_root_matches_parent_chk`, arguing the in-function measurement
  makes it unnecessary — the reviewer agreed and said leaving it as a second lock is right.

### Reviewers
- **Grok 4.6** — sequences 201, 203, 205, 207, 209r-A, 209r-B, 211. Carried the session. Its
  best work was seq 209r-B, which read the **actual live NBCU loader and its production load
  receipt** to prove the tightened gate cannot break the job running today — evidence, not
  reasoning. Sequence 209 was cancelled at its 20-turn limit with no verdict; splitting the
  brief in two and passing `--max-turns 40` fixed it.
- **Kimi K3** — sequences 206, 208, 210 all completed and were excellent. Sequence 202 failed
  terminally (section 7).

## 6. Exact next steps

1. **#1140** — transaction-bound authorization for the held FR owner ruling. Genuinely ready,
   unaffected by ruling 6.15, and the best thing to dispatch next.
2. **#1090 — DO NOT DISPATCH AS WRITTEN.** Owner ruling 6.15 (merged today as `f468933`)
   deletes Universe A, and this tracker's claim list declares `core.property`,
   `core.character` and `core.property_character` — which ARE Universe A. The queue audit
   still lists it as dispatchable. I commented the full explanation on the issue rather than
   changing its status, because changing status hides it instead of fixing it. Someone must
   re-read `docs/core-master-data-consolidation-aim.md` against 6.15 and 6.14 and rewrite the
   objects block. The deletion of Universe A probably deserves its own issue — it is a
   destructive change to a populated production table.
3. **#1199 / #1171 — PopDAM lease. Blocked on the app team, not on us.** See section 9.
4. **#1235** — the deferred `check-sql.sh` static guard, now unblocked because all three
   prerequisite migrations merged today.
5. **#1239** (WildBrain unclassified in the inventory view), **#1240** (WildBrain gate has no
   extra-key sweep), **#1249** (the Sega/WildBrain grant disagreement — needs Albert).
6. **#1223** (32 untested guards), **#1224**, **#1220** (reviewer wrappers — section 7).
7. **#678 / #679 / #680 / #681** — Disney, Paramount, NBCU, Warner promotions. Still open from
   the predecessor's list and never started this session.

## 7. Tooling defects that cost real time — all recorded on #1220

1. **`ai-kimi` discards its own findings.** Sequence 202 returned a correct `VERDICT: REVISE`
   naming one blocking finding, and the finding itself was thrown away. Reproduced three
   times. Nothing persists it: `ai-kimi show` and `transcript` both fail from a review
   sandbox, and the session JSON holds metadata only. **The extractor keeps everything from
   the LAST heading and discards the rest.**

   **WORKAROUND, now proven — put this in EVERY `ai-kimi` brief:**

   > CRITICAL HARNESS CONSTRAINT: only your FINAL block is captured — anything above your last
   > heading is DISCARDED, and a heading written after your findings will cut them. Put your
   > complete findings AND the verdict line together in ONE final block starting with the
   > heading `## Verdict`, and write no heading after it.

   Naming the heading `## Verdict` specifically is what makes it work. Asking for `## Findings`
   does NOT — Kimi then writes `## Verdict` below it and the extractor cuts there anyway.
2. **`ai-grok-review` sometimes omits its mandatory verdict line** (seq 205). Asking the same
   session for the line alone recovers it in one turn.
3. **`ai-grok-review` cancels at the turn limit with no verdict** (seq 209) on a large brief.
   Split the brief and pass `--max-turns 40`.
4. **Both wrappers warn `'.ai/reviews' is not git-ignored` and silently skip writing the
   review file — the warning is FALSE.** `.gitignore` line 36 is literally `.ai/reviews/`.
   The check is wrong, not the repo.
5. **`--replace-failed-reviewer` cannot repair a rotation record when the "PR" is a merged
   one** (promotion reviews). It refuses with `requires the exact open PR head`. I re-ran the
   replacement review manually and documented it rather than faking an open PR.

## 8. Coordination debt other sessions must know

- **Another session is on `plan-coldlion-landing-phases-2-6`** in the main checkout. That is
  #1204 territory, which is owner-decision blocked. It holds no migration-author lane. If it
  authors a migration it will be refused by the lease guard at PR time — correct, but it
  should acquire a claim first.
- **Main moved seven times today** from that session's docs merges. Every rehearsal and
  promotion input is pinned to the exact current main tip, so each move invalidated in-flight
  inputs. Re-derive `origin/main` immediately before every dispatch, and expect two approved
  PRs in flight to backdate each other.
- **Owner rulings 6.15 and 6.16 landed mid-session** and change what #1090 means. Read
  `AGENTS.md` before planning licensing Master Data work.
- **Eleven worktrees remain that are not mine**, several stale (tracked in #884 / #1118). I
  removed only the four I created.

## 9. What did NOT work, and what to avoid repeating

- **The PopDAM lease promotion was STOPPED, and stopping it was right.** The review proved
  that promoting `20260819011639` alone makes two live PopDAM call sites start raising 55000 —
  `AssetDetailPanel.tsx:335` and `StyleGroupDetailPanel.tsx:688`, both already documented in
  this repo's own handoffs as *"Legitimate today, will break, must be updated in the same
  window"*. Worse, if the OpenRouter batch flow is running, the worker loses the ability to
  record `provider_batch_id`, turning in-flight submissions into **orphaned, billed provider
  jobs** — the exact failure the migration exists to prevent. **Do not promote it until the
  popdam3 app deploy goes out in the same window**, with a staged rollback rehearsed on
  preview and an answer for ops already stuck in `ambiguous_submission` (#1211).
- **A four-migration promotion review in one brief exceeded the reviewer's turn budget** and
  died with no verdict. Two smaller briefs worked. Do not batch a whole promotion set into one
  review.
- **I initially dispatched four preview dry-runs in parallel. Two were cancelled** by the
  workflow's single-lane concurrency. Preview is globally serialized — run them one at a time.
- **A promotion review reported a High that was already false.** It claimed `plm.pmt_capture`
  and the DCP tables might be missing on production, from a stale 2026-08-11 measurement. I
  disproved it from production's own ledger (all four creating migrations applied, and nothing
  in the repo ever drops those tables) rather than accepting or dismissing it. **Verify a
  reviewer's factual premises before acting on its severity.**
- **A claim that declares only tables and functions is incomplete.** PR #1234 was refused for
  17 undeclared indexes, 38 undeclared policies, and the inventory view under the name the
  guard uses (`table api.source_capture_inventory`, not `view`). Sibling claims list all of
  these. Declare everything the SQL writes.
- **`--expand-active-claim-from-issue` self-collides with the claim's own open PR.** Passing
  `--pr` and `--head-sha` alongside it resolves the collision. Undocumented; cost several
  attempts.
- **Two approved PRs in flight backdate each other.** Whichever merges second is refused by
  `SQL migration guards`. Governed supersession is the fix and it is a pure rename — filter
  the resulting diff for lines that are not the version string and it comes back empty. Prove
  it that way rather than asserting it, and the earlier approval carries.

## 10. How to verify all of this yourself

```bash
gh issue view 1229 --repo u2giants/shared-db
node scripts/manage-migration-author-lanes.mjs --audit
node scripts/manage-migration-author-lanes.mjs --queue-audit
gh run view 32265206578 --repo u2giants/shared-db --log | grep 20260819125713
```

The last one prints production's own ledger before and after the Peanuts apply, read from
production itself rather than from the workflow's summary.
