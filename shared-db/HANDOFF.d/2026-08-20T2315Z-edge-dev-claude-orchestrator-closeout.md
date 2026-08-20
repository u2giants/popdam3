---
issue: 1350
status: OPEN
owner: claude-20260820-2015Z / orchestrator marker #1338
---

# Orchestrator closeout — session `claude-20260820-2015Z` (edge-dev)

**Written:** 2026-08-20T23:15Z · **Machine:** edge-dev · **Agent:** claude
**Marker:** #1338 (opened 20:15Z, closed at the end of this session)
**Predecessor:** #1333, closed on takeover — that session stopped mid-workstream and Albert authorised the takeover in chat.

**One line:** the Batman artwork repair went all the way to production and is verified; the FRIENDS TV erasure is written, green and waiting only on a reviewer; the reviewer tooling is broken two separate ways and that is now the single biggest blocker in this repo.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking — one, and it is small

**Should deleting curated master data stay this hard?** After #1347 merges, no `core.licensor` and no `core.property` row can be deleted by anything, ever, except the two rows Albert named. There is deliberately no authorization shape for an arbitrary one. He was told this plainly and did not object, but he was also offered the alternative and has not answered. **Do not re-ask it as a technical question** — it is "do you want deleting a licensor to be easy or deliberate", and the current answer is deliberate.

### Already settled — do NOT re-ask

| Settled | Date | Answer |
|---|---|---|
| Leave / renumber / delete the two test art records (#1326) | 2026-08-20 | **B, renumber.** Executed and verified in production. |
| Does `FRIENDS TV` disappear entirely or stay as a retired record? | 2026-08-20 | **"erase FRIENDS TV completely"** — recorded on #1339. |
| What happens to the `FRIDA KAHLO` property row blocking it? | 2026-08-20 | **DELETE it.** *"FRIDA KAHLO was never supposed to be under Friends. they have no relation to each other. and FRIDA KAHLO is a defunct license anyway. you can delete it if that's the easiest way to get this done."* Recorded on #1339. |
| Universe A (`core.property`, `core.character`, `core.property_character`) | 2026-08-20 | **"so Universe A is garbage. get rid of it."** Reaffirms owner ruling 6.15 (2026-08-19). Blast-radius work first — see §6. |
| Rename the doomed `core.property` to avoid the name collision with the future canonical table? | 2026-08-20 | **No.** Albert: delete the old one first, then build the new one — no overlap, nothing to rename. He is right; the suggestion was dropped. |
| Should Albert sign off on technical risk? | standing | **No.** Retired for technical sign-off. Never ask. |

### Answered by Albert, needs action rather than a decision

- **Cloud SQL cutover shape.** Albert proposed: make an EMPTY copy of the structure, point production at it, load production's data. **This is better than the plan of record** and is now #1352. It eliminates the id-collision risk entirely — an empty schema has nothing to collide with — and separates production from dev/staging/sandbox for free.

---

## 1. What this repository is

`u2giants/shared-db` is the only place the **shape** of Albert's shared Supabase database is changed — tables, columns, views, functions, triggers, security rules. Several applications read and write that one database, so a structural change made from an app repo would break the others. Every structural change is authored here as a numbered forward-only SQL file, independently reviewed, rehearsed on a copy, then applied to production through an evidence chain.

- **Production:** Supabase `qsllyeztdwjgirsysgai`
- **Preview / rehearsal:** Supabase `mvpkijzfmfcxhnzqogzs`
- These two are easy to confuse and getting it wrong is the worst mistake available here. Prove the target immediately before every write and quote the proof.

---

## 2. State at write time — RE-DERIVE, DO NOT REUSE

Every value below was checked at **2026-08-20T23:12Z**. `origin/main` moves within minutes in this repo.

| Fact | Value at 23:12Z |
|---|---|
| `origin/main` | `0cef120bec0d04e7ca7a8693c629ba9ea7209ce9` |
| Max migration version on main | `20260820165926` |
| Open PRs | **#1347 only** (MERGEABLE, all 12 required checks pass) |
| Author lanes | 1 of 3 occupied (claim #1345, the FR removal) |
| Expired claims | 0 |
| Open handoff files | 7 before this one, 8 with it |

**Production ledger high-water mark:** `20260820165926`, applied this session.

---

## 3. What was DELIVERED to production this session

**One migration: `20260820165926_restore_art_piece_1024_1025_to_batman.sql`** — the repair of the Batman artwork records.

Full evidence chain:

| Step | Evidence |
|---|---|
| Reviewer | `glm-5.3` via `ai-glm`, seq 242, `VERDICT: APPROVE` at head `25a4f7de`, re-confirmed at `a12ccf8a` with a coverage statement |
| Guarded merge | run 32402017898, merge commit `1247d125` |
| Preview rehearsal | run 32402123930 from merged main `1247d125` |
| Preview evidence re-issued via recovery lane | run 32402833543, digest `sha256:5627595f…` |
| Immutable review evidence | run 32402471268, digest `sha256:7a3a651f…` |
| Production apply | run 32402996954, SUCCESS |

**Verified behaviourally against production afterwards, not merely "the job said success":**

- id 1024 = `PDCBM-01024`, *Batman and Catwoman in a dynamic rain-soaked confr…*
- id 1025 = `PDCBM-01025`, *Batman running in a dynamic pose with cape spread…*
- Test records alive at 10001 (`P1PA4-10001`) and 10002 (`PCCCDC-10002`) — prefixes preserved, only the id suffix rewritten
- Row count 1,114 → **1,116**. Nothing deleted.
- `plm.art_piece_attachment`'s 4 rows now resolve to the Batman artwork
- `art_number` suffix invariant across **all** rows: **0 breaks**

---

## 4. What is IN FLIGHT — PR #1347, the FRIENDS TV erasure

**This is the one live workstream. It is 90% done and blocked on one thing.**

- **PR:** #1347, branch `feat/issue-1339-fr-removal`, head **`5d5bacf385792aaf02d22c9ce6ce847b705c31b9`**
- **Worktree:** `C:\repos\shared-db-worktrees\issue-1339-fr-removal` — **LIVE, clean, do not retire**
- **Claim:** #1345, version `20260820183334`, **8 objects** (both guard triggers and `core.property` were added mid-session via `--expand-active-claim-from-pr`)
- **Checks:** all 12 required pass. 4 preview/production jobs skip, which is correct pre-merge.
- **Issue:** #1339

**Blocked on: no reviewer verdict exists, and the reviewer tooling refuses two different ways (§7).**

### What it does

Erases `core.licensor` `2b2caddf-4fb0-4fc3-8245-ccd8f8177e48` (`FR`, FRIENDS TV) and `core.property` `cb26ec58-0edb-4d45-8c0b-ba283ffb23f8` (`FK`, FRIDA KAHLO), both under explicit owner rulings, re-homing or removing their dependants first, through one-use transaction-bound authorizations. It registers its own version in `FR_REMOVAL_VERSIONS`, which is what **releases five other merged-but-unapplied migrations**.

### Three things a reviewer must look at hardest

1. **It extends a security guard to DELETE.** `app.enforce_licensing_write_authority` previously fired `before insert or update`. Both `core.licensor` and `core.property` triggers now cover DELETE, with two narrow write kinds (`owner_ruling_fr_removal`, `owner_ruling_fk_removal`) pinned per table in both directions. A mistake here changes what the guard permits for every future write, not just these two rows.
2. **It edits FOUR pre-existing contract tests** that its own change broke (across two rounds). That is a legitimate consequence of extending DELETE coverage, and it is also exactly how a real regression gets normalised. Judge each edit on whether it still proves what it was written to prove.
3. **The permanent consequence:** after this, no `core.licensor` or `core.property` row is deletable by anything except those two. Deliberate — see §0.

### The finding that would have broken the first version

The author's first draft nulled `plm.property_import`'s licensor link and separately expected to handle the FRIDA KAHLO link. On re-measurement, **it is one row doing both jobs** (`plm_property_id` 4156), and its `property_id` is NOT NULL under RESTRICT — so nulling the licensor link would have left the property delete blocked. Caught by re-measuring rather than trusting the earlier reading.

---

## 5. Sub-agent register

### Agent: `#1090` state assessment (read-only, no worktree)
- **Asked to do:** determine the next executable phase of tracker #1090 and its exact object claim.
- **Actually did:** read-only ground-truth pass against production and the issue chain. Wrote nothing.
- **Found:** #1090's declared ~50-object list is **stale on its face** — it includes `core.property`/`core.character`/`core.property_character`, which owner ruling 6.15 orders deleted. **Not one object on that list exists in production.** The real next phase was an FR removal migration that **had never been authored**, because #553 (which carried it) was closed COMPLETED in a triage sweep on the grounds that a *different* migration was superseded.
- **Worktree:** none. Finished.
- **Deliberately did NOT do:** rewrite #1090's object block — that is itself a governed change. Recorded as a comment instead.

### Agent: FR removal author (two rounds)
- **Asked to do:** author the FR removal migration under claim #1345; later, rework it for the FRIDA KAHLO ruling.
- **Actually did:** PR #1347, head `5d5bacf3`, all checks green. Round 1 head was `ded28faf`.
- **Found:** the ON DELETE actions and nullability of all five FR dependants (never previously recorded); that `plm.property_import` row 4156 is a single row serving both links; that `core.property` has 35 inbound FK columns of which exactly 3 carry an FK row. Also that `coldlion_licensor_property_phase1_contracts.sql` had been **failing silently under quarantine** before this work fixed it.
- **PR / branch:** #1347 / `feat/issue-1339-fr-removal`
- **Worktree:** `C:\repos\shared-db-worktrees\issue-1339-fr-removal` — **LIVE**, clean, resumable.
- **Deliberately did NOT do:** merge, rehearse or promote (correctly — those are the orchestrator's). Did not touch `core.property` in round 1, because it was #1238's; that changed only when the owner ruling arrived and the claim was expanded first.

### Agent: Cloud SQL migration research (read-only, no worktree)
- **Asked to do:** establish what is actually still on Cloud SQL and what remains to move to Supabase.
- **Actually did:** read-only pass over `gcloud`, the dflow repos and production Supabase. Wrote nothing.
- **Found:** see §6 item 4. Also corrected a briefing error of mine — the `plm` schema is licensor **scrape** data, not the DesignFlow PLM app; anyone planning the migration around `plm` is planning around the wrong schema.
- **Worktree:** none. Finished.

---

## 6. Outstanding work, each with an issue

| # | Issue | What it needs |
|---|---|---|
| 1 | **#1350** | Finish PR #1347: reviewer verdict → guarded merge → preview rehearsal → production. Releases 5 held migrations. |
| 2 | **#1238** (updated) | Universe A deletion. Owner authorised 2026-08-20. Blast radius FIRST — 6.15 requires proving what reads the 256 rows and moving anything worth keeping, because nothing not moved survives. |
| 3 | **#1351** | Reviewer tooling is broken two ways (§7). This blocks every migration in the repo, not just #1347. |
| 4 | **#1352** | Cloud SQL cutover via a fresh empty schema — Albert's proposal, better than the plan of record. |
| 5 | **#1353** | dev/staging/sandbox all point at the **production** Supabase project. |
| 6 | **#1344** | Production promotion is not actually an exclusive lane. Cost three restarts today. |
| 7 | **#1315** (raised) | Sequence audit now gates the #771 rehearsal. |

Closed this session as already delivered: **#1199**, **#1225**, **#1326**, **#1334**.

---

## 7. What we tried that did NOT work — MANDATORY, read before repeating any of it

### 7.1 Untracking `.ai/reviews` to unblock the Muse reviewer — WRONG, and the repo said so

**What was tried:** PR #1348, untracking the 25 review files, because `.gitignore` line 48 declares that path ignored while 25 files sat tracked in it (#1304).

**Why it seemed reasonable:** the issue title reads as an open defect, and `ai-muse` refuses to run while tracked files are there.

**How it failed:** `tools/gitignore-tracked-contradiction.test.mjs` failed the PR with `not ok 338 - the 25 cited review files are still tracked and no longer ignored`. Those files are **deliberate named exceptions** — cited BY PATH from a migration header (`20260729180000_…`) and four permanent documents that can never be edited. The test's own comment says *"If this test fails, do NOT 'fix' it by untracking the file"*, and records that a previous session read the ignore rule, ran `rm -rf .ai`, and destroyed all 25.

**PR #1348 is closed.** Nothing in shared-db should change. **The recovery matters too:** the untracking left 25 identical-but-untracked copies in `C:\repos\shared-db`, which blocked a checkout. They were proven byte-identical to `origin/main` (ignoring line endings — `git show` gives LF, the checkout gives CRLF) before being removed and restored from git. All 25 are back and tracked. **Do not compare these files without stripping `\r` first, or all 25 will look modified.**

**Also note:** on Git Bash for Windows, `git show "origin/main:$f"` mangles into `origin\main;…` unless `MSYS_NO_PATHCONV=1` is exported. That produced a false "all 25 differ" reading before it was caught.

### 7.2 The reviewer round robin cannot currently be repaired in-band

Two separate refusals, both hit today:

1. **`ai-muse` will not start** while `.ai/reviews` holds tracked files — which it always does, by design. `ai-muse doctor` reports **all five checks PASS**, so this is not an environment fault. The wrapper should probe whether *its own new report path* is ignored (which `.gitignore` guarantees and the third test in that file pins), not assert the whole directory is untracked. **Fix belongs in `u2giants/ai-devops`.**
2. **`--replace-failed-reviewer` cannot record it.** `local_dependency_unavailable` is refused without `--failing-check`, and naming one would be a lie because doctor passes. `wrapper_terminal_failure` with `--confirm-no-verdict --confirm-no-artifact` then failed with **`REFUSED: original durable reviewer assignment is missing`**, after five `gh: Not Found (HTTP 404)` lines. **The durable assignment record from `--assign-reviewer` is not actually being written** — the same 404s appeared during assignment for both #1335 (seq 242) and #1347 (seq 243).

**Consequence: the next session must assign #1347's reviewer fresh, and should expect the replacement path to be unusable.** Related: #1287, #1303.

### 7.3 Promotion refused three times, all correctly

Detailed on **#1344**. Summary: an unrelated PR merged mid-promotion, invalidating (a) the sealed review evidence, then (b) the preview evidence via the producer-file pin, and (c) re-rehearsing was impossible because the migration was already applied on preview. **Do not weaken any of those three gates.** The recovery is in 7.4.

### 7.4 The recovery lane DOES work post-merge — #1321's headline conclusion is too broad

#1321 concludes the historical recovery lane cannot recover a post-merge rehearsal, and on that belief `20260819011639` was superseded and re-reviewed at real cost. **It recovered cleanly today** (run 32402833543) with:

```
-f historical_preview_source_pr=1335 -f historical_preview_original_run_map=20260820165926:32402123930
```

**The real discriminator is not pre-merge versus post-merge.** The lane pins producer files to the authoring PR's merge commit; today's rehearsal ran *at* that merge commit, because it was run immediately after merging with nothing landing in between. **A post-merge rehearsal run promptly is recoverable; one run after other PRs land is not.** Recorded as a comment on #1321. Practical rule: **rehearse in the same breath as the merge.**

### 7.5 Assumptions that turned out false

- **"Twelve of sixteen DesignFlow services already run on Supabase"** — misleading, and Albert corrected it. **No production service does.** The twelve are dev, staging and sandbox.
- **The `plm` schema is not DesignFlow.** It is licensor portal scrape data (318 tables, 8 GB).
- **#1090 is not dispatchable as written** (§5).
- **#1199 and #1225 were both already delivered** and had been sitting open.

---

## 8. Facts that may already be stale

Everything in §2 was read at 23:12Z and `origin/main` moves within minutes. Also:

- The 5-dependant FR blast radius was measured ~18:15Z and re-measured by the author before writing; **re-measure again before applying**, because rows can move.
- The Cloud SQL findings in §6/#1352 were read ~20:40Z and include one estimate: **live row counts in Cloud SQL production were never read** — every row figure in circulation is a planner estimate.
- The claim that the two schemas diverge by only three objects was measured **2026-08-11**; nine days of migrations have landed since.
- `max_connections = 90` on production Supabase with 34 in use — read once, and it is a live number.

---

## 9. Environment and access

- **Main checkout:** `C:\repos\shared-db`, left **detached at `origin/main`** and clean. It was on the now-deleted `chore/untrack-ai-reviews` branch; that is why it is detached rather than on `main` — `main` is checked out by the `issue-1297-test-n-minus-1-ce7b71` worktree and cannot be checked out twice.
- **Worktrees deliberately left alone** (not this session's, not audited): `issue-1297-test-n-minus-1-ce7b71`, `plm-art-piece-attachment-audit-0df5f8`, `rebase-finish-1212-eea93b`, `shared-db-orchestrator-filtering-8c129d`, `preview-provenance`. **These are decisions, not oversights.** The only worktree this session owns is `C:\repos\shared-db-worktrees\issue-1339-fr-removal` (LIVE).
- **Supabase MCP is read-only and points at production.** Prove with `get_project_url` before every read and quote it.
- **Preview state:** `20260820165926` is applied to preview and cannot be re-applied. Preview is not clean and never was.
- **Reviewers in rotation:** `grok-4.6` (`ai-grok-review`), `glm-5.3` (`ai-glm`), `muse-spark-1.2-contributor` (`ai-muse` — currently unusable, §7.2). **Never delete a name from `REVIEWERS`**; pause via `RETIRED_REVIEWERS`.
- `ai-glm` needs its local server up: `ai-glm server start`, then wait — `server status` reports `health: unreachable` for roughly 20 seconds before it comes good.
- **Commit identity:** `git var GIT_COMMITTER_IDENT` must read `Albert Hazan <u2giants@users.noreply.github.com>`. Verified this session.
- **Secrets:** swept, nothing new — see the closing report.

---

## 10. Stale handoff files — reported, deliberately NOT deleted

Both name issue **#1225** in their contract block, and I closed #1225 today as already delivered (its five "stranded" migrations are all in production). Their work is therefore done, but **they belong to other sessions and I did not touch them** — the standard is that a session deletes its own file and never another's.

| File | Contract issue | Owner |
|---|---|---|
| `HANDOFF.d/2026-08-20T0200Z-edge-dev-claude-orchestrator-closeout.md` | #1225 (CLOSED) | `claude-20260819-092000Z` |
| `HANDOFF.d/2026-08-20T1528Z-edge-dev-claude-orchestrator-closeout.md` | #1225 (CLOSED) | `claude-20260820-113000Z` |

**Recommended action for the next orchestrator:** retire both, in one docs-only PR, having confirmed nothing in them is still live. Neither owner session is running.

**Note the count is NOT the problem** (owner ruling 2026-08-13). Eight open files with eight live workstreams would be correct. These two are flagged because their issue is closed, not because there are too many.

## 11. Worktrees — every one accounted for

| Worktree | Status |
|---|---|
| `C:\repos\shared-db-worktrees\issue-1339-fr-removal` | **LIVE — mine.** PR #1347 mid-review. Clean. **Do not retire.** |
| `C:\repos\shared-db` (main checkout) | Left **detached at `origin/main`**, clean, all 25 `.ai/reviews` files restored and tracked. |
| `.claude/worktrees/shared-db-orchestrator-69417c` | Mine, this session. Finished after PR #1354 merges — safe to clean. |
| `.claude/worktrees/issue-1297-test-n-minus-1-ce7b71` | **Not mine. Holds `main` checked out** — which is why the main repo is detached. Left alone deliberately. |
| `.claude/worktrees/plm-art-piece-attachment-audit-0df5f8` | Not mine. Left alone deliberately. |
| `.claude/worktrees/rebase-finish-1212-eea93b` | Not mine. PR #1212 merged today by another session; likely retirable, but **not by me**. |
| `.claude/worktrees/shared-db-orchestrator-filtering-8c129d` | Not mine — another session on `claude/curated-master-data-forks`. Left alone deliberately. |
| `C:\repos\shared-db-worktrees\preview-provenance` | Not mine. Left alone deliberately. |

`scripts/reap-merged-worktrees.mjs` refuses while any `orchestrator-marker` issue is open, so worktree reaping is correctly a next-session job — and it must ask GitHub whether the PULL REQUEST merged, never `git branch --merged`, which cannot see a squash merge.
