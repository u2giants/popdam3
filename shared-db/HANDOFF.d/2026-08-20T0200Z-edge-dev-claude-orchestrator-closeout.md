---
issue: 1225
status: OPEN
owner: claude-20260819-092000Z
---

# HANDOFF — shared-db orchestrator closeout (2026-08-20 02:00 UTC, edge-dev/Claude)

Marker: **#1229**. Predecessor: #1207 (closed), whose closeout was
`HANDOFF.d/2026-08-19T0810Z-edge-dev-claude-orchestrator-closeout.md`.

**This file supersedes `HANDOFF.d/2026-08-19T1450Z-edge-dev-claude-orchestrator-closeout.md`,
which was written by THIS session at 14:50 and is deleted in the same pull request.**

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking now
None.

### Waiting on Albert, not blocking
- **#1249 is CLOSED — he answered it.** Ruling: *"scrape data should be visible to
  Licensing department users."* Implemented and in production. Recorded here so nobody
  re-asks.
- **#1251 is CLOSED as already-done.** He answered *"restrict Disney to match every
  other licensor"* and it turned out that had been true since 2026-08-07. **My question
  was raised on a stale reading and should not have reached him.** See §9.
- **#1166 — queue triage.** 96 open `db-work` issues. Only Albert can say which of his
  own business items are still live.
- **#1204 / #1226 — Coldlion phases 2-6** (~25 tables) and the seven-year backfill. The
  PLAN landed today (#1263); the implementation has not started.

### Settled today — do NOT re-ask
- **Stop using Kimi; restore GLM; trial Gemini and Muse** (owner decision, 2026-08-19,
  in response to a measured 11-failures-vs-5-successes count). The trial is done and
  written up — see §7 and ai-devops PR #44. **The roster change itself is NOT yet made;
  see §6 item 2.**
- The owner-decision approval ritual stays RETIRED for technical sign-off.
- Standing authorization: act without per-step approval; the evidence discipline is
  unchanged.

## 1. What this application is

`u2giants/shared-db` owns the STRUCTURE of the shared Supabase database used by about
nine POP Creations applications. **Preview is `mvpkijzfmfcxhnzqogzs`. Production is
`qsllyeztdwjgirsysgai`.** One orchestrator, three migration-author lanes, every
structural change through an exact issue, permanent version reservation, claim, branch,
worktree, PR, preview rehearsal from merged main, independent review, and bounded
production promotion.

## 2. What this session was asked to do

1. *"push through to completion the coldlion ingest tables and the licensor scrape
   tables and anything else you can do simultaneously"*
2. *"scrape data should be visible to Licensing department users"* (owner ruling)
3. *"restrict Disney to match every other licensor"* (owner ruling — already true)
4. *"can you concurrently work on PR #1263"*
5. *"can you simultaneously do #1216 sesame street"*
6. *"Which reviewers are causing problems? We have to stop using them"* → stop Kimi,
   restore GLM, trial Gemini and Muse, document in ai-devops
7. *"fix #1280"*, then *"finish promoting it to production"*
8. *"how do we prevent this from ever happening again?"* (the GLM false-pause)
9. *"document the one-bug-four-wrappers problem and link it from HANDOFF.md"*

## 3. Current state — VERIFIED 2026-08-20T01:56Z, re-derive before trusting

- `origin/main` = `ee8aaea36de5beb3713713aa5877e131fe209fe3`
- Highest migration on main: `20260820004338_wildbrain_inventory_and_finalize_sweep_catalogue_verified.sql`
- **Lanes: 0 of 3 occupied. No open `db-claim` issues. No expired claims.**
- **Main moved ~10 times during this session** from other active sessions. Re-derive it
  immediately before every dispatch, rehearsal and promotion input.
- Open PRs, none of them mine: **#1270** (Playwright per-attempt timeout), **#1269**
  (EP001 filter ruling), **#1212** (`docs/slim-agents-handoff`).
- Worktrees: `C:/repos/shared-db` (main, clean), `.claude/worktrees/docs-slimming`
  (PR #1212, not mine), `C:/repos/shared-db-worktrees/preview-provenance` (not mine).
  **Every worktree I created is retired and its branch deleted.**
- No untracked or modified files in the main checkout.

### Production `qsllyeztdwjgirsysgai` — TEN migrations applied today

| Version | What |
|---|---|
| `20260818232639` | ColdLion landing spine (#1198) |
| `20260819014639` | WildBrain DAM landing |
| `20260819015333` | Sega DSI landing |
| `20260819112524` | WildBrain + Sega gate fixes (#1221/#1222) |
| `20260819123658` | NBCU count-gate hardening (#1219) |
| `20260819125713` | Peanuts (Tenovos) landing (#1217) |
| `20260819151536` | **FAILED TWICE, rolled back cleanly, NOT applied** — see §9 |
| `20260820004338` | WildBrain inventory + sweep, catalogue-verified (#1280) |

Every applied version was verified by reading production's own `supabase migration list`
inside the apply run, not by the workflow's word.

**NOT on production:** `20260818203751` (mgCategory), `20260819011639` (PopDAM lease),
`20260819151510` (Licensing read access), `20260819151527` (FR authorization),
`20260819151536` (superseded by `20260820004338`), `20260819212002` (Sesame).

### Preview `mvpkijzfmfcxhnzqogzs`
Carries everything production carries, **plus** `20260818203751`, `20260819011639`,
`20260819151510`, `20260819151536` and `20260819212002`.

**Preview is MISSING four migrations production has:** `20260817124545`,
`20260817150944`, `20260817225127`, `20260818174350`. This is left over from the
2026-08-18 preview rebuild and is why `20260819151527` cannot be rehearsed (§6).
Tracked as #901.

## 4. Merged this session — EIGHT pull requests

| PR | What | Review path |
|---|---|---|
| #1233 | NBCU count-gate hardening (#1219) | Grok 203 REVISE (1 High) → Kimi 206 APPROVE |
| #1234 | Peanuts landing (#1217) | Grok 207 REVISE (3 High) → Kimi 208 APPROVE → Kimi 210 APPROVE |
| #1236 | WildBrain + Sega gate fixes (#1221/#1222) | Grok 205 APPROVE, no defects |
| #1255 | Licensing read access (#1249) | Grok 215 (4 findings) → Grok 221 REVISE → Grok 223 APPROVE |
| #1256 | FR transaction-bound authorization (#1140) | Kimi 212 APPROVE (void, design changed) → Grok 217 REVISE → Grok 219 APPROVE |
| #1257 | WildBrain inventory + sweep (#1239/#1240) | Grok 213 APPROVE, no defects |
| #1263 | ColdLion phases 2-6 plan (docs, another session's) | Grok, pre-existing |
| #1265 | CI: bound every apt install (#1261) | Grok 225 APPROVE (3 Low) → Grok 227 APPROVE |
| #1274 | Sesame Workshop landing (#1216) | Grok 229 REVISE (1 Med) → Grok 231 REVISE (1 High) → Grok 233 APPROVE |
| #1282 | WildBrain verify-cost supersession (#1280) | **GLM 5.3 + Muse, both APPROVE, no findings** |

Issues closed: #1198, #1216, #1217, #1219, #1221, #1222, #1249, #1251, #1280.
Issues opened: #1229 (marker), #1235, #1239, #1240, #1249, #1251, #1258, #1259, #1261,
#1262, #1280, #1283, #1284, #1285, #1287, plus ai-devops#45 and ai-devops PR #44.

## 5. Sub-agent reports — SEPARATED BY AGENT

### Agent: NBCU count-gate author — worktree `issue-1219-null-count-gate` (RETIRED, branch deleted)
- **Asked to do:** #1219. Claim #1230, version `20260819112451` → superseded to `20260819123658`.
- **Actually did:** PR #1233, merged `ff26a7f`.
- **Found beyond the brief:** a THIRD defect shape nobody had named — a numeric-looking
  JSON *string* (`"12"`) casts cleanly through `->>` and is ACCEPTED as a count. A silent
  wrong answer, not a crash. Also found `excluded_unlicensed_assets` is an `integer`
  column needing its own narrower limit.
- **Disproved half its own claim:** `plm.finalize_warner_capture` **does not exist**. The
  real object is `plm.finalize_wb_capture` and it is NOT affected. Paramount and both
  Disney schemas have no jsonb `expected_counts`. The "systemic" defect was NBCU-only.
- **Its own fix reopened the defect once**, caught in review: `1.0` passes
  `jsonb_typeof = 'number'` and `= trunc(1.0)`, then dies on the leftover text-to-int cast.
- **Deliberately did NOT do:** rename its backdated migration; add the repo-wide
  `check-sql.sh` guard (would redden main — that is #1235).

### Agent: Peanuts landing author — worktree `issue-1217-peanuts-landing` (RETIRED, branch deleted)
- **Asked to do:** #1217. Claim #1231, version `20260819112505` → superseded to `20260819125713`.
- **Actually did:** PR #1234, merged `9002da9`. Four rounds.
- **Corrected its own draft:** its first `finalize_` raised on rejection, which would roll
  back the very row recording why the capture failed.
- **Found a defect in its OWN tests:** C6 and C7 raised only a `warning`, which does not
  fail a psql run, so dropping a CHECK left the suite green. It then audited all 36 other
  `raise warning` statements in the file.
- **Retracted an overstated coverage claim twice**, the second time unprompted.
- **Rewrote another schema's tripwire correctly** — adding 19 tables fired Sega's F1; it
  rewrote F1 so an unknown prefix fails with a message naming the one-line fix.

### Agent: WildBrain/Sega follow-ups author — worktree `issue-1221-1222-landing-followups` (RETIRED, branch deleted)
- **Asked to do:** #1221 + #1222 in one migration. Claim #1232, version `20260819112524`.
- **Actually did:** PR #1236, merged `e920441`. One round, APPROVE with no defects.
- **Found beyond the brief:** #1222's fix list never mentioned the Sega **reported** side's
  own cast, used twice. Same wedge, fixed and tested.
- **Was honest about weak tests:** said openly that F13 and F14 pass both ways by design.
- **Deliberately did NOT do:** add an extra-key sweep to the WildBrain gate (#1240); alter
  `wildbrain_era_root_matches_parent_chk`.

### Agent: Licensing read access author — worktree `issue-1249-licensing-read-access` (RETIRED, branch deleted)
- **Asked to do:** #1249, the owner ruling. Claim #1252, version `20260819151510`.
- **Actually did:** PR #1255, merged `d00812e`. Three rounds.
- **Proved the ruling behaviourally on a real database:** `B: 54 passed / 0 failed` —
  licensing, sales, administrator and a `plm` app-access principal each read both landing
  schemas; vendor, viewer and a role-less principal read nothing; `anon` refused at the
  grant; `service_role` still reads. Plus `A: 281 passed`, `C: 38 passed`.
- **Found three assertions in two OTHER committed test files** that asserted the old
  posture and would have failed on merge; split each so the protection survived.
- **Disclosed a weakness in its own test suite** in the test file itself.
- **Deliberately did NOT do:** narrow Paramount (which also admits `designer`); touch
  Disney OPA; adopt another author's tables.

### Agent: FR transaction-bound authorization author — worktree `issue-1140-fr-txn-authorization` (RETIRED, branch deleted)
- **Asked to do:** #1140. Claim #1253, version `20260819151527`.
- **Actually did:** PR #1256, merged `e66ad50`. **Two complete designs.**
- **Found that #1140 was already half-done and the shipped half was the useless half.**
  `20260817225127` widened the `write_kind` CHECK to admit `owner_ruling_fr_inactivation`
  and taught the guard function nothing — making it **the widest authorization in the
  system**: any licensor row, any status, any metadata, no ordering proof. That gap was
  live on main.
- **Its first design broke a merged, held migration.** CI proved `20260818174350` would
  fail on its own INSERT. It redesigned to bind from the row being written; the earlier
  approval was declared void rather than carried forward.
- **Settled a reviewer disagreement by measurement:** with `core.taxonomy_owner_ruling`
  absent it **fails CLOSED** — SQLSTATE `42P01`, write aborted, FR stayed `active`, 0
  audit rows, 0 authorizations consumed. Pinned by a proof asserting that specific
  SQLSTATE.
- **Found `ci_authorize_licensing_contract_test()` pre-issues 100 blanket authorizations**
  inside each test's own transaction, silently authorizing exactly the writes a guard
  contract needs refused (#1262).
- **Rewrote a merged test that asserted the bug** (`fr_owner_ruling_guarded_forward_contracts.sql`),
  under my explicit permission.

### Agent: Sesame Workshop landing author — worktree `issue-1216-sesame-landing` (RETIRED, branch deleted)
- **Asked to do:** #1216. Claim #1271, version `20260819212002`.
- **Actually did:** PR #1274, merged `41b8f74`. Three rounds.
- **Found a hole in the SPECIFICATION:** two columns the spec defines
  (`guide_character_rows_excluded`, `error_summary`) had no write path at all, so the
  excluded count could only ever have been 0.
- **Added a guard the spec did not ask for** — and got it wrong twice, then right. Round 1:
  it rejected a truthful zero and rubber-stamped any fabricated nonzero. Round 2: it
  accepted every integer between 1 and the true count. **Its own fixture refuted its
  justification** — the pair count it called "legitimately smaller" was larger on that
  fixture, and its own "excessive" arm demanded that number be rejected.
- **Explained why its own testing could not have caught it:** it had mutated the guard's
  BRANCHES and never its STRICTNESS, and its fixture had one excludable row, so the
  under-report mutant was *not expressible*. It rebuilt the fixture with two rows and
  added an assertion stopping anyone shrinking it back.
- **Deliberately did NOT do:** extend `api.source_capture_inventory` (that is #1283); add
  a `(depth = 0) = (parent is null)` check, because the portal's root convention is unknown.

### Agent: CI apt-stall author — worktree `ci-psql-install` (RETIRED, branch deleted)
- **Asked to do:** #1261. No claim needed (repo-maintenance, no DB objects).
- **Actually did:** PR #1265, merged `e3b340b`. 8 steps across 4 workflows.
- **Verified `psql` is preinstalled twice** — the runner-image manifest via `gh api`, and
  live on its own run where the new step completed in **under one second**.
- **Admitted its first sweep was useless:** it grepped old step NAMES, not the command
  LITERALS inside them, so it could not have found the test that broke.
- **Named one mutation it did NOT run** (deleting the gate step outright) as
  reasoned-not-observed rather than claiming it.

### Agent: WildBrain verify-cost author — worktree `issue-1280-wildbrain-verify-cost` (RETIRED, branch deleted)
- **Asked to do:** #1280. Claim #1281, version `20260820004338`.
- **Actually did:** PR #1282, merged `ee8aaea`, promoted to production.
- **Found the non-obvious root cause:** the old block's eleven queries **already carried
  `where table_name like …` filters and still timed out**, because `query_to_xml` is
  `VOLATILE` so the planner cannot push the qualifier under the subquery.
- **Raised, unprompted, that its own fix is unguarded** (#1285) and explained why the two
  obvious guards cannot work.
- **Was wrong about one thing and said so:** it believed `20260819151536` had to be
  unstranded first. I disproved it from production's ledger — `20260818203751` stranded
  while the LATER `20260818232639` applied over it.

### Reviewers
- **Grok 4.6** — 19 successes, 1 failure (a 20-turn cancellation on an oversized brief;
  splitting it fixed it). Recurring nuisance: omitted the `## Verdict` section on eight
  sequences, always recoverable in one extra turn.
- **Kimi K3** — 5 successes, **11 terminal failures**. Recorded as reviewer issue
  `20260820T004602Z-edge-dev-kimi-k3-385556`.
- **GLM 5.3** — restored and works. See §7.
- **Muse Spark 1.2** — good reviewer, broken verdict detection. Reviewer issue
  `20260820T013646Z-edge-dev-muse-spark-1.2-contributor-394599`.
- **Gemini 3.7 Flash High** — two attempts, nothing usable.

## 6. Exact next steps

1. **#1225 — four migrations still need promoting, each blocked differently:**
   - `20260819151510` (Licensing read access) — **BLOCKED on stale rehearsal evidence.**
     Its preview rehearsal ran at `b660e08`, BEFORE PR #1265 changed
     `shared-supabase-migrations.yml`. The business-risk gate correctly refuses:
     *"preview run checked out at b660e08… produced evidence with a different
     .github/workflows/shared-supabase-migrations.yml than exact main"*. It is already
     applied to preview, so the post-merge lane cannot re-rehearse it. **Its route is the
     historical-recovery lane.** This is the single most valuable outstanding item — it is
     Albert's own ruling, merged and proven, and not yet in production.
   - `20260819151527` (FR authorization) — **BLOCKED: preview lacks `20260817124545`.**
     The guard refuses correctly, naming the missing table. Needs the preview drift (#901)
     resolved first.
   - `20260819011639` (PopDAM lease) — **BLOCKED on the app team**, not on us. See #1199.
   - `20260818203751` (mgCategory) — historical-recovery case, untouched today.
   - `20260819212002` (Sesame) — rehearsed on preview, **not yet promoted**. No known
     blocker; it simply ran out of session.
2. **The reviewer roster change is NOT made.** Albert decided it; I did not implement it.
   In `scripts/manage-migration-author-lanes.mjs`: add `kimi-k3` to `RETIRED_REVIEWERS`,
   remove `glm-5.3` from it, and consider adding Muse to `REVIEWERS` (it is not in the
   registry at all, so that is a registry change, not an un-pause). **Do not delete any
   name** — one lookup there is not null-guarded and historical verdicts must stay
   readable. Tracked on #1203.
3. **#1283** (Sesame unclassified in the inventory view), **#1284** (that view counts every
   row on every read), **#1285** (nothing guards a verify block's cost).
4. **#1262** — the blanket-authorization test-fixture defect. Systemic; only two files
   clear it today, the rest of the suite is unaudited.
5. **#1287 + ai-devops#45** — see §10, which Albert asked to be stated explicitly.
6. **#1258** (from-empty replay leaves `core.taxonomy_owner_ruling` absent), **#1259** (FR
   follow-ups), **#1235** (the deferred static guard, now unblocked).
7. **#678 / #679 / #680 / #681** — Disney, Paramount, NBCU, Warner promotions. Still open
   from an earlier session and never started.

## 7. The reviewer trial — owner asked for this specifically

Written up in full at **ai-devops PR #44**
(`docs/reviewer-trial-2026-08-19-glm-gemini-muse.md`), with an entry appended to
`models_comparison_grok_kim_glm.md`.

- **GLM 5.3 — restored; the pause was a FALSE DIAGNOSIS.** It was paused 2026-08-18 for
  three `provider_unavailable` failures. `ai-glm doctor` showed every check passing except
  `health endpoint answers`: **its local `opencode` server was not running.**
  `opencode-glm-launch` fixed it. A working reviewer sat out two days because a background
  process had stopped.
- **Muse Spark 1.2 — good reviewer, broken wrapper.** Produced a complete seven-point
  review ending in `VERDICT: APPROVE`; the wrapper failed to detect its own verdict and
  wrote *"This is not a review result"* over correct work. **It SAVES the output**, so the
  review was fully recoverable — the material difference from Kimi, which discards.
- **Gemini 3.7 — not usable on this evidence.** Two attempts: `no usable Gemini verdict`,
  then a bare `PASS` with an **empty report**. Do not add to `ACTIVE_REVIEWERS` yet.
- **One bug in FOUR wrappers:** the false `.ai/reviews is not git-ignored` warning, which
  makes the wrapper silently skip writing the review file — the artifact that made Muse's
  review recoverable and Kimi's not. Documented at
  `docs/reviewer-wrapper-gitignore-false-warning.md` and linked from ai-devops
  `HANDOFF.md`.

## 8. Coordination debt other sessions must know

- **Main moved about ten times today** from concurrent sessions. Every rehearsal and
  promotion input is pinned to the exact current main tip, so each move invalidated
  in-flight inputs. Re-derive immediately before every dispatch.
- **A hung CI job blocks that PR's ENTIRE validation queue.** `shared-supabase-migrations.yml`
  sets `cancel-in-progress: false`, so a job hung on an apt stall makes every later run sit
  `pending` with ZERO jobs assigned — which looks identical to account-level runner
  starvation and was misread as such for hours. **Cancelling the hung run is the fix;
  closing and reopening the PR is not** (the new run joins the same blocked queue). PR
  #1265 removes the source.
- **I cancelled a run on another session's PR #1263** (hung 2h+ on `Install SQL check
  dependencies`). Cancelling marks all its jobs failed, so that PR briefly showed five red
  checks that were mine, not its author's. I re-ran it and said so on the PR.
- **`HANDOFF.d/2026-08-19T0050Z-al8960ofc-claude-orchestrator-closeout.md` is STALE** — its
  contract names issue #1205, which is CLOSED. Not my file; not deleted. Owner per its
  contract block: `al8960ofc`.
- **ai-devops has an untracked `MUSE_CANARY=blue-heron-39`** (90 bytes, 2026-08-18 17:23),
  apparently from an earlier containment test of Muse. Not mine, left in place, recorded so
  it is not a mystery.

## 9. What did NOT work, and what to avoid repeating — MANDATORY

- **I brought Albert a decision based on a stale reading, and he acted on it.** I reported
  Disney OPA as wide open (`using (true)`) and asked whether vendors should read it. He
  said restrict it. **It had already been restricted on 2026-08-07** by
  `20260807190000`, applied to production. The investigation had read the migration that
  FIRST created the policy and never checked whether a later one superseded it. The same
  shortcut produced a second wrong claim the same hour — that Sega exposed licensed data
  to every signed-in user, when its RLS narrows it. **For any "what does the database
  currently do" question, the authority is the CURRENT object definition across ALL
  migrations plus the production ledger — never the migration that first created the
  object.** This repo is forward-only.
- **I endorsed an author's reasoning that a review then demolished.** The Sesame author
  argued a distinct-pair count would be legitimately smaller than a row count, so exact
  equality would reject honest captures. I called it persuasive. The reviewer showed the
  author's own fixture had the pair count LARGER, and the author's own test demanded that
  number be rejected as a fabrication. **Relaying an author's rationale approvingly is
  taking a position on it.**
- **A promotion review flagged a cost and I let it pass on precedent.** Grok noted
  `20260819151536`'s verify block would pay "the same shared-read cost Peanuts already
  paid today". Peanuts had — narrowly. That migration then could not apply to production
  at all. **"The last one got away with it" is not a measurement.**
- **`20260819151536` is stranded**: applied to preview, unappliable to production,
  uneditable under §4. Superseded by `20260820004338`. The cost of not measuring a verify
  block against production was one wasted migration version and a full replacement cycle.
- **Do not batch a whole promotion set into one review.** A four-migration brief exceeded
  the reviewer's turn budget and died with no verdict. Two smaller briefs worked.
- **Preview dispatches are globally serialised.** I fired four dry-runs in parallel; two
  were cancelled by the workflow's own concurrency group.
- **A claim must declare EVERY object the SQL writes** — indexes and policies included, not
  just tables and functions. Two PRs were refused for this.
- **`--expand-active-claim-from-issue` self-collides with the claim's own open PR.** Use
  `--expand-active-claim-from-pr` with `--pr` and `--head-sha`.
- **Two approved PRs in flight backdate each other.** Merge ascending by version, or pay a
  governed supersession per PR. I merged #1255 → #1256 → #1257 in version order for exactly
  this reason.
- **`--replace-failed-reviewer` REFUSES when the PR is merged** (*"requires the exact open
  PR head"*), which is every production-promotion review. A failed reviewer on a promotion
  cannot be repaired through the tool and must be worked around by hand.
- **A `verify` block is production code.** One that is cheap on an empty preview and
  expensive on a full production database converts a passing rehearsal into an unappliable
  migration. Assert shape from the catalogue; count rows only inside your own tables.

## 10. The two items that stay in shared-db from #1287 — Albert asked for these explicitly

Albert challenged my first framing of the GLM false-pause fix, correctly: **the
substantive fix belongs in `ai-devops`, not here**, because putting it here would teach
this repository provider-specific health models and would protect only one caller. That is
now **ai-devops#45**: each wrapper self-checks the local dependencies it owns and fails
with a distinct named error naming the fix, instead of dying quietly and surfacing as
`provider_unavailable`.

**Two things genuinely remain in shared-db, on #1287. Neither can live in a wrapper,
because both are this repository's own rotation bookkeeping:**

1. **A distinct `local_dependency_unavailable` failure code.** `replaceFailedReviewer`
   currently accepts `insufficient_quota`, `provider_unavailable`,
   `wrapper_terminal_failure`, `turn_limit_cancelled`. **`provider_unavailable` conflates
   "the remote provider is down" with "a local dependency of the wrapper is not
   running".** Those deserve different responses — the first waits, the second is a
   thirty-second fix — and the durable rotation record should be able to tell them apart
   after the fact. This is what made GLM's three failures look like a pattern of provider
   unreliability.

2. **A pause must NAME the failing check.** This is the actual cause of the two-day bench,
   and it is an evidence asymmetry inside
   `scripts/manage-migration-author-lanes.mjs`:
   - **Pausing** a reviewer requires no evidence about *why* it failed — three
     `provider_unavailable` codes suffice, and that is exactly the code a stopped local
     service produces.
   - **Restoring** it requires a probe; the existing note says *"restore it by deleting
     'glm-5.3' from this list once the provider answers a probe."*

   **The cheap check is required only on the path nobody is in a hurry to take.** A pause
   entry in `RETIRED_REVIEWERS` must record either the specific failing health check, or an
   explicit statement that the health check passed and the failure was elsewhere. A pause
   note that cannot name the failing check is a guess — and the GLM one was.

Both remain worth doing even after ai-devops#45 lands: the failure code because the durable
record should distinguish two different faults, and the pause rule because it is what
turned one stopped process into a two-day outage.

## 11. Secrets sweep and documentation pass

- **Secrets sweep: swept, nothing new.** No credential appeared in this session that is not
  already in 1Password. The one credential-shaped string encountered — a production DSN in
  PR #1263's plan document — was **removed rather than stored**, because it was being
  published into a PUBLIC repository and the repo's own convention is to name host, port,
  database and user separately with the password referenced by 1Password item. No value was
  written to any file, doc, commit, report or chat.
- **Documentation pass: two things outside this handover WERE stale and are fixed.**
  (a) ai-devops now documents the four-wrapper `.ai/reviews` defect and the reviewer trial
  (PR #44). (b) `20260819151536`'s failure invalidates nothing that a doc still teaches, but
  the lesson — a verify block is production code — is recorded on #1280, #1285 and here.
  **Nothing in `AGENTS.md` is now wrong because of this session.** No rehearsal or evidence
  artifact was voided by a later migration in this session, with one exception stated
  explicitly in §6: `20260819151510`'s preview rehearsal is VOID for promotion purposes
  because PR #1265 changed the workflow that produced it.

## 12. How to verify all of this yourself

```bash
gh issue view 1229 --repo u2giants/shared-db          # this session's marker
node scripts/manage-migration-author-lanes.mjs --audit
node scripts/manage-migration-author-lanes.mjs --queue-audit
gh run view 32322307507 --repo u2giants/shared-db --log | grep 20260820004338
```

The last one prints production's ledger before and after the final apply, read from
production itself.
