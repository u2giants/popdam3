---
issue: 1363
status: OPEN
owner: claude-20260820-2345Z / orchestrator marker #1355
---

# Orchestrator closeout — session `claude-20260820-2345Z` (edge-dev)

**Written:** 2026-08-21T12:50Z · **Machine:** edge-dev · **Agent:** claude
**Marker:** #1355 (opened 2026-08-20T23:45Z, closed at the end of this session)
**Predecessor:** #1338, closed cleanly at 2026-08-20T23:35Z. No takeover; a clean handover.

**One line:** the FRIENDS TV erasure and the five migrations it held are **applied to production and verified behaviourally**; getting there required fixing a deadlock between two safety gates that made the batch unshippable, and the reviewer round robin failed hard enough overnight to cost a working day.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Answered this session — act on it, do not re-ask

| Question | Answer | Where |
|---|---|---|
| Deleting Universe A removes the DB Data Admin **Licensor Tree** and **Property Table** screens at `data.designflow.app`. Do you still use them? | **"Rebuild them on the good list first."** He uses both. Rebuild on Universe B, then delete. Order changes; scope does not. | #1238, and #1358 raised for the rebuild |

### Still open, and NOT re-asked by me

- **#1352** — adopt the fresh-empty-schema Cloud SQL cutover (his own proposal; better than the plan of record).
- **#1353** — dev, staging and sandbox all write into the **production** Supabase project.
- **#1291** — three items waiting on him.
- **#1204** — ColdLion phases 2–6 authorised; the 7-year backfill question.
- **#778** — orphan `designflow` schema backup and removal.
- **#1238** — now unblocked on the screens question, still gated on technical work (see §6).

### Settled — do NOT re-ask

- **Never ask Albert to sign off on technical risk.** Standing, retired as a gate.
- **Should deleting curated master data stay this hard?** Carried from the previous closeout, still unanswered, still parked deliberately. It is "do you want deleting a licensor to be easy or deliberate", and the current answer is deliberate.
- **Universe A is deleted** (§6.15, reaffirmed 2026-08-20). **`core.licensor` STAYS** — settled by evidence this session, do not reopen.

---

## 1. What this repository is

`u2giants/shared-db` is the only place the **shape** of the shared Supabase database is changed — tables, columns, views, functions, triggers, security rules. Several applications read and write that one database, so a structural change made from an app repo would break the others. Every structural change is authored here as a numbered forward-only SQL file, independently reviewed, rehearsed on a copy, then applied to production through an evidence chain.

- **Production:** Supabase `qsllyeztdwjgirsysgai`
- **Preview / rehearsal:** Supabase `mvpkijzfmfcxhnzqogzs`
- Confusing them is the worst mistake available here. Prove the target immediately before every write and quote the proof (§4.2).

---

## 2. State at write time — RE-DERIVE, DO NOT REUSE

Checked **2026-08-21T12:50Z**. `origin/main` moves within minutes in this repo.

| Fact | Value |
|---|---|
| `origin/main` | `cb9225137b30412b98d743e49971c94a60f7c25d` |
| Max migration version on main | `20260821010215` (unapplied — it is PR #1360's, still open) |
| **Production ledger** | **481 entries**, high-water `20260820183334` |
| **Preview ledger** | all six FR-bundle versions applied; `20260820183334` is its high-water too |
| Open PRs | **#1359** and **#1360**, both MERGEABLE and green |
| Author lanes | **1 of 3** occupied (claim #1357, Sample Tracking release B), 0 expired |
| Open handoff files | 6 including this one, after retiring 3 stale ones |

---

## 3. What was DELIVERED to production this session

**Six migrations, as ONE bounded event, exactly as owner ruling §6.5 requires:**

`20260802170000` → `20260817124545` → `20260817225127` → `20260818174350` → `20260819151527` → `20260820183334`

### Evidence chain

| step | evidence |
|---|---|
| Reviewer | `glm-5.3` via `ai-glm`, sequence 245 — APPROVE at `5d5bacf38579`, re-confirmed APPROVE at `25faae99786a`, both with full coverage statements. Critical/High/Medium: none. |
| Failed predecessor reviewer | sequence 244 `grok-4.6`, terminal hang — see §7.1 |
| Guarded merge | run **32478607900** → merge commit `080cf00df958ef47ec93df30160ba0dd9dabf5d1` |
| Deadlock fix | PR **#1361**, independently reviewed and re-confirmed, merged `66607681bc6b` |
| Parse-bug fix | PR **#1362**, merged `cb9225137b30` |
| Preview rehearsal | run **32483145979**, artifact `sha256:d1086c65ff2a…` |
| Immutable review evidence | run **32483347624**, artifact `sha256:82e0f14b8f14…` |
| Production apply | run **32483394133**, SUCCESS |

### Verified behaviourally against production — not "the job said success"

| check | result |
|---|---|
| all six versions in the production ledger | all present |
| `core.licensor` id `2b2caddf-4fb0-4fc3-8245-ccd8f8177e48` / `code='FR'` | **0 / 0** |
| `core.property` id `cb26ec58-0edb-4d45-8c0b-ba283ffb23f8` / `code='FK'` | **0 / 0** |
| `core.taxonomy_owner_ruling` | **4 rows** — now the ONLY surviving explanation of why either row vanished |
| `core.licensor` total | 26 → **25** (exactly one) |
| `core.property` total | 256 → **255** (exactly one) |
| ledger total | 475 → **481** (exactly six) |

**Nothing was over-deleted.**

### Also delivered

- **#1188 closed** — the preview outage. Preview is healthy: all six Sample Tracking Release A objects present, ledger head matches `main`, and the hard-coded preview project ref is now the repository variable `PREVIEW_PROJECT_REF` = `mvpkijzfmfcxhnzqogzs`. Follow-up raised as **#1356**.
- **#1339 and #1350 closed** on the production evidence above.

---

## 4. What is IN FLIGHT

### PR #1360 — Sample Tracking release B (issue #1307)

- Branch `claude/sample-tracking-release-b-flow1-visits`, worktree `C:\repos\shared-db-worktrees\sample-tracking-release-b` — **LIVE, do not retire**
- Claim **#1357**, version `20260821010215`, **25 objects**, lease renewed to **2026-08-22T01:54Z**
- **All checks green.** Additive only; nothing in Release A altered.
- **Next:** independent reviewer → guarded merge → preview rehearsal in the same breath → production. Then regenerate `types/database.types.ts` (it reads preview, so only post-apply) and post the captured `EXPLAIN` plans to #1307.
- Three orchestrator rulings are recorded on #1307 and are implemented: a real FK to `dflow."Factory"(id)`, direct `shipped -> returned` and `at_factory -> returned` edges, and event-driven state in the Release A shape.
- **Two consequences the app teams must act on**, both on #1307: `popcre/designflow-tracking` will now get SQLSTATE `23503` for an unknown factory id and must surface it as a validation error, not a 500; and `popcre/designflow-frontend`'s spec contradicts itself on the return path and should be corrected.

### PR #1359 — reviewer-assignment keying fix (issue #1351)

- Green, MERGEABLE, **deliberately unmerged** — it was held behind the FR promotion so it could not move `main` mid-flight (§7.4 of the previous closeout). That reason is now gone.
- **Next:** merge it. It touches `scripts/manage-migration-author-lanes.mjs`; PRs #1361 and #1362 have since merged into the same file, so **re-check the merge is still clean before merging**.

---

## 5. Sub-agent register

### Agent: reviewer-tooling fix, `ai-devops` half (#1351)
- **Asked to do:** fix `ai-muse`'s over-broad repo-state probe, and the allegedly-unwritten durable reviewer record.
- **Actually did:** `u2giants/ai-devops` **PR #60**, 2 files. Proved it with a **live `ai-muse new` against the real `C:\repos\shared-db`** — doctor 5/5, report written, tree stayed clean, all 25 tracked reports untouched. Wrapper suite **77 pass, 0 fail**.
- **Found — and this corrected the issue's premise:** the durable records were **never missing**. Sequences 242 and 243 both exist. The `404` lines are ordinary "does this exist yet?" probes. Also found and fixed a latent bash bug: `local root="$1" dir="$root/…"` never sees the `root` it just declared.
- **Worktree:** none in shared-db. Finished.
- **Deliberately did NOT do:** the `--assign-reviewer` half, because that code lives in shared-db's own `scripts/`. Correctly routed back rather than edited.

### Agent: reviewer-assignment keying, shared-db half (#1351)
- **Asked to do:** fix the keying conflict and the misleading 404 noise.
- **Actually did:** **PR #1359**, all 12 checks pass. Tests **154 pass, 0 fail** (143 before).
- **Found:** the record is keyed on issue + PR + **head commit**, while `--replace-failed-reviewer` demands the PR's **current** head — impossible to satisfy once anyone pushes. Kept the commit in the key (collapsing it would let a verdict silently cover unreviewed code) and added an index instead.
- **Deliberately did NOT do:** add a fourth failure code — recommended against, and I agree.
- **Left one instance of the pattern deliberately:** `resolveCommandPath` discards `where.exe`/`which` stderr; flagged in the PR rather than edited mid-session. **Pick this up under #1287.**

### Agent: Universe A blast radius (#1238) — read-only, no worktree
- **Actually did:** read-only pass against production (`get_project_url` quoted). Wrote nothing.
- **Found:** three figures in #1238 are wrong — `core.property` has **4** populated inbound FK columns not 3; the "16 character-grain rows" does not reproduce (**35** name-match, 19 character-only); **`core.licensor` STAYS** (7 populated referrers, ~48,000 rows, 13 app read sites). `core.property` **cannot** be dropped today: 9 views depend on it, 7 PostgREST-exposed, popdam3 reads it at 14 sites. **A shim cannot help — the blocker is 26,077 live FK values and a view is not FK-targetable.**
- **Salvage verdict:** 59 redundant, 14 recoverable with a real portal ID, 183 with no portal identity, **0 actually lost**. Universe B is the licensor-PORTAL scrape list, not the ColdLion list; Universe A is ColdLion-derived and its identity already lives in `plm.property_import`. **Move nothing.**
- **Biggest open risk it raised:** the DesignFlow **writer** that populates `core.property` was not found. Until it is, a drop could be silently re-created by the next sync.
- **Deliberately did NOT do:** author anything. Objects were locked by claim #1345 at the time.

### Agent: Sample Tracking release B author (#1307), two phases
- **Actually did:** phase 1 scoping, then **PR #1360**.
- **Found:** the provisional object list was wrong three ways — it named a table that is actually a **view** (`dflow.sample_visit_plan`), **omitted the append-only history table entirely**, and listed no functions, triggers or indexes. Confirmed the route legs already exist and all three structural arguments hold. Added a rule the proposed DDL had no mechanism for: **a piece with a `not_returned` visit cannot be shipped again.**
- **Worktree:** `C:\repos\shared-db-worktrees\sample-tracking-release-b` — **LIVE.**
- **Deliberately did NOT do:** apply, merge or promote. Correct.

### Agent: rehearsal-lane deadlock fix (#1361, then #1362)
- **Actually did:** **PR #1361** (merged) then **PR #1362** (merged) after its own bug was caught during the real dispatch.
- **Found:** see §7.2 and §7.3.
- **Worktree:** finished.

---

## 6. Outstanding work, each with an issue

| # | Issue | What it needs |
|---|---|---|
| 1 | **#1307** / PR #1360 | Review → merge → rehearse → production. Lane live to 2026-08-22T01:54Z. |
| 2 | **#1351** / PR #1359 | Merge it — the reason it was held is gone. Re-check merge cleanliness first. Also ai-devops#60 to merge. |
| 3 | **#1238** | Universe A. **Three gates:** #1358 (rebuild the two screens), find and stop the `core.property` writer, retire the remaining read sites. `core.character` and `core.property_character` are empty with no referrers and can go **first, independently**. |
| 4 | **#1358** | Rebuild Licensor Tree + Property Table on Universe B. App work in `apps/db-data-admin/`, in this repo. |
| 5 | **ai-devops#61** | `ai-grok-review`'s wait timeout never fires. Blocked this repo for a working day. |
| 6 | **#1356** | Repeatable preview seed/teardown so clearing fixtures never means rebuilding the branch. |
| 7 | **#1352, #1353, #1291, #1204, #778** | Waiting on Albert. |
| 8 | **#1344, #1315, #1287** | Carried forward, unaddressed by me. |

**Closed this session:** #1188, #1339, #1350, plus claim #1345.

### ⛔ #1090 — do NOT dispatch as written

`--queue-audit` reports it as dispatchable. **It is not.** Its ~50-object list is stale on its face and names tables ruled for deletion, and not one object on the list exists in production. See its 2026-08-20 comment. Rewriting that object block is itself a governed change.

---

## 7. What we tried that did NOT work — MANDATORY, read before repeating any of it

### 7.1 `grok-4.6` hung for 11h32m and nothing stopped it

Assigned sequence 244 at 2026-08-20 19:48. It worked for ~2.5 hours (verified: a freshly created HTTPS connection at 22:13, near-idle CPU between calls, which is normal while awaiting a model response). By 07:20 the next morning it was **alive with zero TCP connections and still zero bytes of output**.

`AI_GROK_WAIT_TIMEOUT` documents a 900-second default. The run was allowed **41,500+ seconds**, ~46x the ceiling, and ended only because I killed it.

**Why nobody caught it sooner:** with `--output-format json` the wrapper buffers everything to the end and registers the named session only on completion. `ai-grok-review list` showed nothing and `show` reported no such session throughout, so **a 0-byte output file is indistinguishable from "still working normally"**. The standing rule is to read the raw provider stream before recording a reviewer failure — there was no stream to read.

**It is not a one-off.** A second grok process (pid 1504, `--cwd C:/repos/ai-devops`, max-turns 20) sat in the identical state for 17+ hours. It belonged to another session and was left untouched.

**The wrapper does not clean up its lock when killed** — `repo--c45fa053410d.lock.d` had to be removed by hand or it would have blocked the next run in that repo.

Recorded as `ai-reviewer-issue 20260821T113256Z-edge-dev-grok-1103721` and **ai-devops#61**. **`glm-5.3` via `ai-glm` worked flawlessly all session and registers its session at start, so it is monitorable. Prefer it.**

### 7.2 Two safety gates that could not both be satisfied — the FR bundle was unshippable

- **§6.5** (owner ruling, 2026-08-03) requires the FR ship set to move as exactly ONE bounded event.
- **The post-merge rehearsal lane** required every allowlisted version to have been added by the **single** PR named in `merged_preview_source_pr`.

The six versions came from six PRs (#408, #1108, #1142, #1145, #1256, #1347). One gate forbade splitting the batch; the other forbade a batch spanning PRs. **Both refusals were correct and fail-closed. Nobody had ever composed them.**

Neither of the other lanes helps: **historical recovery** accepts a multi-PR map but also demands the preview run that ORIGINALLY applied each version — these had never been applied anywhere, and recovery cannot originate. The **ordinary preview lane** wants a live author claim on an OPEN PR; #1347 was merged and its branch gone.

Fixed in **PR #1361** by teaching the rehearsal lane a version→PR map, the shape the recovery lane already used. The proof became per-version rather than per-batch. **No gate was weakened** — independently reviewed, which verified all eight safety properties at named lines and confirmed the map cannot route around §6.5 because set assembly still goes through `parse_allowlist`.

### 7.3 The fix had its own bug — one `tr` destroyed the batch

The parse line stripped `[:space:]`, which **deletes newlines as well as blanks**. All six PR numbers were welded into `40811081142114512561347`; the loop ran **once**, the all-digit `case` check passed, and the resulting `gh api …/pulls/40811081142114512561347` 404'd. Under `set -euo pipefail` that killed the step before any REFUSED message printed — so the only symptom was a single bare `gh: Not Found (HTTP 404)`. Failed twice: runs 32481867839 and 32482067440.

**It passed every unit test and a hard independent review**, because both covered the JavaScript lane and the bug was in the workflow shell.

Fixed in **PR #1362** with a per-line trim, a harness (`scripts/check-workflow-rehearsal-map-parse.test.mjs`) that lifts the marked shell block out of the workflow and runs it — **including a test that re-introduces the exact defect and proves the guard refuses it** — and an independent second parse in `awk` that refuses on any count disagreement. Verified locally: **7 pass, 0 fail**. The sweep found no other instance; the historical lane splits its map in Python, not shell.

### 7.4 Three of MY OWN mistakes, so the next session does not repeat them

1. **I assumed triggers and indexes "ride along" on a claimed table.** They do not — `Migration Author Lease` requires every object named, and it was right to refuse PR #1360. Claim #1357 went from 11 objects to 25.
2. **I acquired the merge and preview locks by hand.** Both workflows acquire them themselves, so my lock made the job refuse `refs/db-coordination/… is occupied`. **Never pre-acquire an exclusive lane before dispatching its workflow.**
3. **I patched the wrong fenced block** in issue #1339 — it carries two object lists, and a `sed` range printed one while I edited the other. Caught before it mattered. **Count the fenced blocks before editing an issue body.**

Also: a claim's renewal validates the claim's objects against the **work issue's** scope block, so an expanded claim silently makes renewal impossible until the issue's scope block is expanded to match. Hit on #1345 and again on #1357.

### 7.5 Assumptions that turned out false

- **"The five held migrations are already in production."** They are not, and were not. Verified twice, before and after: production held **475** entries, and **481** after this promotion. `20260819151510` was present while `20260819151527` was not — seventeen seconds apart, which is very likely how the misreading happened. **#1225 was closed on 2026-08-20 partly on that belief.** I did not reopen it blind — the two sets may not be the same five — but whoever revisits it must re-measure.
- **"The durable reviewer records were never written."** False; see §5.
- **"`ai-muse` is unusable here."** It was, and now it is not — ai-devops#60.
- The independent reviewer's condition that `tools/gitignore-tracked-contradiction.test.mjs` was unwired: **false, and it retracted it.** The test runs via a `tools/*.test.mjs` glob in `tools-offline-tests.yml`, proven executing on run 32479832809.

---

## 8. Facts that may already be stale

Everything in §2 was read at 12:50Z and `origin/main` moves within minutes.

- The Universe A blast-radius counts were measured ~2026-08-21T00:10Z against production. Re-measure before any DROP; rows move.
- **The `core.property` writer has still not been found.** That is a gating unknown, not a background note.
- Claim #1357's lease expires **2026-08-22T01:54Z**. Renew or release it; expiry is an audit warning, not a release.
- The Cloud SQL findings behind #1352 include one estimate: **live row counts in Cloud SQL production have never been read.**
- `max_connections = 90` on production Supabase — read on 2026-08-20, a live number.

---

## 9. Environment and access

- **Main checkout `C:\repos\shared-db` is DETACHED** at a PR head used for review, and is clean. Note `main` is checked out by another worktree and cannot be checked out twice.
- **`.ai/reviews/` holds new untracked review reports** from this session's `ai-glm` runs. They are correctly ignored by `.gitignore` and are **not** among the 25 tracked exceptions. Leave them or delete them; do **not** untrack or delete the 25 tracked ones (PR #1348 tried and was correctly failed).
- **Supabase MCP is read-only and points at production.** Prove with `get_project_url` and quote it.
- **Preview is NOT clean** — it now carries the full FR bundle. That is intended.
- **Reviewers:** `glm-5.3` (`ai-glm`) — working, preferred, monitorable; `grok-4.6` (`ai-grok-review`) — **hangs, see §7.1**; `muse-spark-1.2-contributor` (`ai-muse`) — fixed by ai-devops#60, unverified in rotation. **Never delete a name from `REVIEWERS`**; pause via `RETIRED_REVIEWERS`.
- `ai-glm` needs its local server: `ai-glm server start`, then wait ~20s. On Windows only `ai-glm.cmd` exists — there is no bash `ai-glm` on PATH.
- **Management API queries** against either project use the Supabase CLI PAT in 1Password vault `vibe_coding`, item ID `3t2xoqk5luyz7ffgdhj24gvtpq`, field `credential`.
- **Commit identity** verified this session: `Albert Hazan <u2giants@users.noreply.github.com>`.

---

## 10. Worktrees — every one accounted for

| Worktree | Status |
|---|---|
| `C:\repos\shared-db-worktrees\sample-tracking-release-b` | **LIVE — mine.** PR #1360 open. Do not retire. |
| `C:\repos\shared-db-worktrees\issue-1339-fr-removal` | **FINISHED** — PR #1347 merged and in production. Safe to reap. |
| `.claude/worktrees/shared-db-orchestrator-ae40c6` | Mine, this session. Safe to clean after this PR merges. |
| `.claude/worktrees/issue-1297-test-n-minus-1-ce7b71` | Not mine; **holds `main` checked out**. Left alone deliberately. |
| `.claude/worktrees/plm-art-piece-attachment-audit-0df5f8` | Not mine. Left alone deliberately. |
| `.claude/worktrees/rebase-finish-1212-eea93b` | Not mine; PR #1212 merged. Likely retirable, not by me. |
| `.claude/worktrees/shared-db-orchestrator-filtering-8c129d` | Not mine. Left alone deliberately. |
| `C:\repos\shared-db-worktrees\preview-provenance` | Not mine. Left alone deliberately. |
| `.claude/worktrees/shared-db-orchestrator-69417c` | Previous session's, finished. Safe to clean. |

`scripts/reap-merged-worktrees.mjs` refuses while any `orchestrator-marker` issue is open, so reaping is a next-session job — and it asks GitHub whether the PULL REQUEST merged, never `git branch --merged`, which cannot see a squash merge.

---

## 11. Handoff files retired in this PR

Three, all with CLOSED contract issues, none with live work:

| File | Issue | Why |
|---|---|---|
| `2026-08-20T0200Z-edge-dev-claude-orchestrator-closeout.md` | #1225 CLOSED | flagged stale by the previous orchestrator, which correctly declined to delete another session's file |
| `2026-08-20T1528Z-edge-dev-claude-orchestrator-closeout.md` | #1225 CLOSED | same |
| `2026-08-20T2315Z-edge-dev-claude-orchestrator-closeout.md` | #1350 CLOSED | **its workstream is the one I finished** — the FR bundle is in production |

**The count was never the problem** (owner ruling 2026-08-13). These three are retired because their issues are closed, not because there were too many.

---

## 12. Secrets sweep and documentation pass

- **Secrets sweep: done, nothing new.** No credential appeared in chat, no token was written to a scratch file, and no `.env` was created. The only secret used was the existing Supabase CLI PAT, read from 1Password by reference (`op://`) and never materialised into any file, commit or message. It is referenced above by item ID only. Untracked files were checked, not just memory.
- **Docs pass: nothing outside this handover is stale.** No standing fact or numbered rule in `AGENTS.md` was disproved this session. The two durable lessons — the gate deadlock and the reviewer hang — are recorded where they will actually be read: in code (`scripts/check-workflow-rehearsal-map-parse.test.mjs` pins the parse defect as an executable regression test) and in issues (ai-devops#61, #1356, #1358). Deliberately not sprayed across further documents.
- **One evidence caveat, stated rather than assumed:** the preview rehearsal for the FR bundle was run at merge commit `080cf00d` and production applied from `cb922513`. `main` moved between them only by PRs #1361 and #1362, which touch the lane machinery and the workflow, **not** any migration or any SQL in the bundle. No migration replaced anything the rehearsal validated, so the rehearsal is not void.
