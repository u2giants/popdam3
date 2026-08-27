# Implementation plan — cut the time it takes to clear a `shared-db` issue

**Repository:** `u2giants/shared-db` (branch for this plan: `claude/plan-throughput-guard-truth`, cut from `origin/main` at `42f0b77`)

**Tracking issue:** [u2giants/shared-db#1680](https://github.com/u2giants/shared-db/issues/1680)

**Created:** 2026-08-27

**Work class:** **repository maintenance.** This plan does **not** authorize a database structure change, a data change, a migration, a preview apply, or a production apply. It changes scripts, tests, workflows and documentation only. Do **not** route its implementation to the structure/schema orchestrator (`AGENTS.md` §0.0-B, §0.0-C, owner ruling 2026-08-21 / issue #1366).

**Session handoff for this plan:** [`HANDOFF.d/2026-08-27T2000Z-edge-dev-claude-plan-throughput-guard-truth.md`](HANDOFF.d/2026-08-27T2000Z-edge-dev-claude-plan-throughput-guard-truth.md)

**Adjacent plan, deliberately NOT duplicated:** [`plan_multi_agent_database_coordination_hardening.md`](plan_multi_agent_database_coordination_hardening.md) (issue #1366) is **complete**. It solved *concurrency* — two sessions colliding on one object. This plan solves a **different** problem: a single session, with no collision at all, losing hours to a guard that is wrong, a diagnosis that is wrong, or a wait that is unbounded. Read its STATUS table before touching anything it owns (`scripts/agent-work-contract.mjs`, `scripts/lib/exclusive-lease.mjs`, `scripts/manage-migration-author-lanes.mjs`); this plan does not modify those.

---

## STATUS — read this before doing anything

| Step | Outcome | State | Evidence |
|---|---|---|---|
| 0 | Plan written, registered in `AGENTS.md` and `HANDOFF.d/`, tracking issue opened | ✅ done 2026-08-27 | issue #1680; `grep -n plan_orchestrator_throughput_guard_truth AGENTS.md HANDOFF.d/*.md` returns a hit in both; merge commit recorded below |
| 1 | One SQL lexer, shared by every scanner; dollar-quoted DDL is never invisible | ⬜ open | — |
| 2 | `scripts/catalog-truth.mjs` — one command that answers "does this object actually exist, and what created it" | ⬜ open | — |
| 3 | Guards must consult catalog truth before concluding "missing", and must say so in their failure text | ⬜ open | — |
| 4 | False-alarm corpus — every historical false positive becomes a permanent regression test | ⬜ open | — |
| 5 | Blocker ledger — `config/blocker-ledger.json` + backfill of the known incidents | ⬜ open | — |
| 6 | `scripts/triage-gate.mjs` — the first thing any session runs when a check goes red | ⬜ open | — |
| 7 | Diagnosis discipline written into `AGENTS.md` (no root cause without a re-runnable command) | ⬜ open | — |
| 8 | Reviewer chain: one reviewer for structure-only, liveness probe before waiting, hard wait cap | ⬜ open | — |
| 9 | Measurement — re-run the time-to-close baseline and record it | ⬜ open | — |

**A fresh session starts at Step 0.** Steps 1→4 are the load-bearing ones; if context runs out, that is the cut point (see §9 phases).

**Evidence rule for this table.** A row may only move to ✅ when its cell names something a reader can open and re-derive: a commit SHA, a file under `docs/verification/`, a CI run id, or an exact command. An issue or PR number alone is **not** evidence — it says where a discussion happened, not what was proven.

---

# Part 1 — Why

## 1. The ultimate goal — what we are actually trying to achieve

**Today, getting one database issue from "opened" to "live in production" takes far longer than the work itself deserves, and almost none of the lost time is spent on the database.** It is spent discovering that a safety check was wrong, chasing a diagnosis that turns out to be wrong, or waiting on a reviewer that has silently stalled.

When this plan is done, the following will be true and is not true today:

1. **A safety check that blocks work tells you, in its own failure message, whether the thing it is worried about is actually true of the live database.** Today it tells you what it read in a text file, and a session then spends an hour finding out the file was not the truth.
2. **A false alarm can only happen once.** Every false positive we have ever hit becomes a permanent test, so no later change can bring it back and no session ever re-investigates it.
3. **A session that hits a red check runs one command and gets the answer** — is this a known false alarm, what does the live catalog say, what is this guard actually for — instead of reading a 2,000-line Python file from scratch.
4. **We can see where the time goes.** There is a ledger of blockers with a cost against each, so the next thing to fix is chosen from evidence rather than from whoever complained loudest.

**Business measure.** Baseline taken 2026-08-27 over the last 400 closed issues in `u2giants/shared-db`: median time-to-close **4.0 hours**, mean **21.1 hours**, p90 **60.3 hours**; **18%** of issues take more than a day and **10%** take more than three days. The long tail is the target. Success is halving the p90 (60.3h → ≤30h) and cutting the >72h share (10% → ≤5%) without weakening a single safety guarantee.

> **If a step in this plan conflicts with this goal, the goal wins — stop and flag it.**
> In particular: **never reach the goal by removing, loosening, or bypassing a safety guard.** A guard that is *wrong* gets made *correct* (usually by giving it access to the truth it was guessing at). A guard that is *right* and inconvenient stays. If a step as written would reduce safety, stop and open an issue instead of implementing it. `AGENTS.md` is the authority and it outranks this document.

## 2. What this application is

`u2giants/shared-db` is the **governance repository for one shared Supabase/PostgreSQL database** used by several separate applications: PM/PIM `poppim-web`, CRM `popcrm-web`, DAM `popdam3` / `popdam-web`, and the six `popcre/designflow-*` PLM repositories. The repository does not run an application. It holds:

- `supabase/migrations/*.sql` — 546 forward-only SQL migrations, the entire structural history of the database.
- `scripts/` — ~17 guard/verification programs (Node `.mjs` and Python `.py`) that decide whether a change is allowed to merge and whether an apply actually did what it claimed.
- `.github/workflows/` — 29 workflows that run those guards, run preview rehearsals, and run the bounded production apply lane.
- `AGENTS.md` — ~101 KB operating contract. It is the authority for everything below and must be read before acting.
- `docs/`, `HANDOFF.d/`, `plan_*.md` — evidence, session handoffs, and active implementation plans.

**Who uses it:** AI sessions, coordinated by a single "orchestrator" session that dispatches implementation to sub-agents in isolated git worktrees. The human owner (Albert Hazan) is a business owner, not a programmer, and approves owner decisions.

**Where it runs:** GitHub Actions on `github.com/u2giants/shared-db`. The databases are Supabase projects — a **preview** project and a **production** project. Nothing in this plan touches either database except through the existing **read-only** Management API path already used by `scripts/production_catalog_verification.py`.

**Branch model:** `main` is the trunk and is branch-protected (11 required contexts, `strict: false` as of 2026-08-23). Work is done in a **worktree cut from `origin/main`**, never in the shared `C:\repos\shared-db` checkout (`AGENTS.md` §2.1-W, standing rule since 2026-08-12). Changes land by branch + pull request, and **the AI merges its own PR** once the §5 checklist passes — the PR is not paperwork for the owner.

## 3. What triggered this work

On 2026-08-27 the owner reviewed the recorded Claude session transcripts for this repository (archive: `u2giants/ai-devops-transcripts`, collection `collection-2026-08-27/claude_chats/edge-dev/projects/C--repos-shared-db*`, 38 sessions between 2026-08-18 and 2026-08-27) and asked why issues take so long to clear, citing this example verbatim:

> "Found why #1645 couldn't reach production: the safety scanner blamed a missing table on a migration that is permanently banned from production, when production has actually had that table since 25 August. The scanner couldn't see the creation because it was written inside a quoted block."

An analysis of those 38 sessions (8 of them orchestrator sessions, identifiable because they open with the literal phrase *"You are the coordinator for C:\repos\shared-db. Start a shared-db orchestrator session."*) found the same four shapes over and over. They are written out in §6 with quoted evidence.

**How to reproduce the headline symptom** (do this first, in Step 1's verification):

```bash
python - <<'PY'
import re, glob
for f in sorted(glob.glob('supabase/migrations/*.sql')):
    t = open(f, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'\$\$(.*?)\$\$', t, re.S):
        if re.search(r'create\s+(table|view|index|materialized)', m.group(1), re.I):
            print('relation created INSIDE a dollar-quoted body:', f); break
PY
```

As of `42f0b77` this prints exactly **three** files:
`20260717163500_reconcile_dflow_backend_startup_contract.sql`,
`20260728174500_clickup_incremental_task_import_reissue.sql`,
`20260810140000_production_lane_canary.sql`.
Every relation created in those three files is **invisible** to any consumer of `strip_sql()` — see §6.1.

## 4. Scope — in and out

**IN scope**

- One shared SQL lexer, and making every text scanner in the repo use it.
- A single "what is actually true right now" catalog query command, and wiring guard failure messages to it.
- A permanent false-alarm regression corpus, backfilled from history.
- A blocker ledger (data file + backfill + a workflow that keeps it honest).
- A triage command for red checks.
- Documentation rules in `AGENTS.md` about diagnosis evidence and reviewer waits.
- Reviewer-chain policy: reviewer count by change class, liveness probe, wait cap.

**NOT in scope — do not do these, even if they look tempting**

- ❌ **Any database change.** No new migration, no preview apply, no production apply, no data load. If a step seems to need one, stop and open an issue.
- ❌ **Removing, disabling, or loosening any existing guard, required check, or branch-protection context.** Making a guard *more accurate* is in scope; making it *quieter* is not.
- ❌ Changing the three-lane cap, the merge queue, the claim/lease model, or anything owned by `plan_multi_agent_database_coordination_hardening.md`. Lane capacity was investigated separately on 2026-08-25 (session `three-lane-cap-expansion`); it is not this plan's problem.
- ❌ Rewriting `AGENTS.md` structurally, or shrinking it. Add the two short sections Step 7 names; change nothing else.
- ❌ Replacing the external reviewers (Grok / GLM / Kimi / Codex) or changing their harnesses in `u2giants/ai-devops`. Step 8 changes only **how this repo decides to wait for them**.
- ❌ Retrofitting the ledger onto issues older than 2026-08-18. The transcript archive only covers 2026-08-18 onward for this machine; older entries would be guesses.
- ❌ Touching the `C:\repos\shared-db` shared checkout. Work in a worktree (§12).

---

# Part 2 — What we already know

## 5. Current state of the code

Everything below is on `origin/main` at `42f0b77` and **works**. Nothing in this plan is half-finished; Step 0 starts from a clean trunk.

| Area | File | State |
|---|---|---|
| Python SQL lexer | `scripts/production_migration_guard.py`, `strip_sql()` at **line 1474** | Works, well-documented, single left-to-right lexer. **Discards dollar-quoted bodies by default** (`keep_dollar=False`). Has a `keep_dollar=True` option that no consumer uses for DDL discovery. |
| Python statement splitter | `scripts/production_catalog_verification.py`, `split_statements()` at **line 906** | Works. Explicitly documented as safe *only* after `strip_sql`. |
| Python target derivation | `scripts/production_catalog_verification.py`, `derive_targets()` at **line 1365** | Works, deliberately conservative — "when it cannot tell, it stays silent". Calls `strip_sql(raw)` at line 1394, so it cannot see dollar-quoted DDL. |
| Node SQL lexer | `scripts/check-pr-object-collisions.mjs` (~line 677 onward) | A **second, independent** lexer with its own quote/prose handling and its own scar history. 1,237 lines. |
| Post-apply catalog check | `scripts/production_catalog_verification.py` (2,775 lines) | Works. Already queries **production**, read-only, via the Supabase Management API `database/query` endpoint with `read_only: true`. **This is the existing, proven path Step 2 reuses — do not invent a new one.** |
| Ledger drift | `scripts/check-migration-ledger-drift.mjs` (598 lines) | Works. Compares merged-on-`main` versions against `supabase_migrations.schema_migrations` in both directions. Its header already states the rule this plan generalises: *"THE LIVE CATALOG IS NOT PROOF THAT WORK WAS NEVER DONE."* |
| Cancelled-work guard | `scripts/check-cancelled-work.mjs` (314 lines) | Works, and was already narrowed on 2026-08-23 after a false positive (see §6.2). |
| Business risk gate | `scripts/production_business_risk_gate.py` | Works, and was already narrowed for `ON UPDATE CASCADE` (line ~1284) after a false positive. |
| Guard tests | `scripts/*.test.mjs`, `scripts/test_*.py` | ~677 tests pass on `main`. Each guard has its own tests. **There is no cross-guard corpus** — that gap is Step 4. |
| Blocker ledger | — | **Does not exist.** Step 5 creates it. |
| Triage command | — | **Does not exist.** Step 6 creates it. |
| False-alarm registry | — | **Does not exist.** `find docs -iname "*false*"` returns nothing relevant. |

Repository scale as of `42f0b77`: 546 migrations, 29 workflows, 17 guard scripts, 107 open issues, 5 open pull requests, `AGENTS.md` 100,934 bytes.

## 6. Key findings and root cause

Four failure shapes, ranked by cost. Each is evidenced.

### 6.1 Guards judge **text**, and treat "I did not see it" as "it does not exist" — the largest class

`scripts/production_migration_guard.py:1474` `strip_sql()` **deletes dollar-quoted bodies on purpose**, with a sound reason recorded in its own docstring: names inside a function body resolve at CALL time, not apply time, so they are not batch-ordering dependencies. That reasoning is correct **for function bodies**. It is wrong for the `do $$ begin ... create table ... end $$;` idiom, where the DDL really does run at apply time.

Downstream, `derive_targets()` (`production_catalog_verification.py:1365`) calls `strip_sql(raw)` and then only recognises objects it can see. Its docstring is honest about being conservative — "when it cannot tell, it stays silent" — but the *callers* do not distinguish **"this migration does not create X"** from **"I could not see whether this migration creates X."** That collapse is the root cause the owner hit on #1645: a scanner concluded a table was missing and attributed it to a hard-blocked migration, when production had held the table since 25 August.

The blast radius is small and enumerable — **three** migration files (§3). That makes this cheap to fix and cheap to verify.

This exact defect class has bitten this repository **at least four times already**, each recorded in `strip_sql()`'s own docstring:
- a `$$` inside a *comment* opened a phantom dollar-quote and deleted every statement in between, hiding all 17 objects created by an **already-applied** migration (`20260727154500`) and all three created by `20260728174500`;
- English prose inside a `comment on ... is '...'` literal was parsed as SQL — 30 phantom references across 23 files;
- the literal string `'CREATE TABLE AS'` used as a comparison value parsed as a table named `as` (`check-pr-object-collisions.mjs:677`);
- prose `"... do not grant read on their own ..."` parsed as a table named `their` (same file).

Each was fixed **individually, after it cost a session.** There is no mechanism that stops the *class*. That is Step 4.

### 6.2 Guards fire on honest, benign input — and the fix always arrives after the cost

Quoted from the session transcripts:

> "Your gate was crying wolf. 'Existing production data may be lost' fired on `ON UPDATE CASCADE` inside a foreign key, and on `DROP TRIGGER IF EXISTS` immediately before recreating it. Neither touches data."
> "The guard caught a false positive — a pure file move looks like re-adding cancelled text. Let me look at the guard rather than work around it."
> "A false positive — my code comment says 'rewrite history' about completion records, which matched a guard about rewriting *git* history."
> "Both failures are false positives from *moving* text, not adding it."

Both of those specific guards have since been narrowed correctly — `check-cancelled-work.mjs` on 2026-08-23 (it now requires an explicit git-history signal, and its comment says why: *"A guard that fails honest prose gets worked around, and a worked-around guard protects nothing"*), and `production_business_risk_gate.py:1284`. The repair quality is high. **The problem is that each repair costs a session, and nothing carries the lesson to the next guard.**

### 6.3 A diagnosis is announced before it is proven

Across the 8 orchestrator sessions there are dozens of self-corrections. A representative sample, verbatim:

> "My diagnosis was wrong. The guards job finished in one minute. Something else held the workflow open."
> "My fix works — the approval is now visible and it retried five times. But the merge is *still* refused, so my diagnosis was incomplete."
> "Found the real cause, and my earlier diagnosis was only half right."
> "Fair challenge — I asserted that without checking the code."
> "I was wrong again, and this one I should have caught — it's documented in this morning's handoff under 'things that did not work.'"

That last line is the important one: **the answer was already written down, in that same session's own handoff, and was not read.** Handoffs are long and past-facing; nothing points a blocked session at the one paragraph it needs. That is Step 6.

Independent reviewers repeatedly caught real errors, which is the system working — *"Codex is right and I was wrong"*, *"Grok is right and I was wrong"*, *"GLM 5.3 ... returned a REJECT ... four were correct, including two places where I was wrong."* But catching an error after the wrong path has been taken is far more expensive than one confirming query before it.

### 6.4 Unbounded and mis-read waits

The orchestrator sessions are full of serialized background waits: *"Wait for preview rehearsal"*, *"Wait for re-sealed evidence"*, *"Wait for production apply retry"*, *"Wait passively for Grok lock to clear"*, *"Wait 4.5min, poll GLM progress"*. Twenty-plus distinct wait tasks in the sampled sessions.

Compounding it, the reviewer harnesses **misreport their own state**:

> "GLM's status field said it was idle. Is that a problem in our opencode harness?" (owner, 2026-08-20 — this became issue #1298)
> "Kimi wasn't stalled — it was just slow, and it came back with a **blocking** finding. I was wrong to call it dead."
> "Found the real root cause. The scheduled task meant to keep GLM's server alive **exists but is not running**."
> "Model confirmed as **glm-5.3** — direct proof the registry label was wrong."

So sessions wait on reviewers that are not running, and abandon reviewers that are.

## 7. Approaches considered and REJECTED

Read this before "improving" the plan.

1. **❌ Loosen or delete the guards that produce false alarms.** Rejected outright. It is the owner's standing rule (*"Preserve the capability... never present symptom suppression as a fix"*) and it is also self-defeating: the repo already documents that a worked-around guard protects nothing. **Every step here makes guards more accurate, never quieter.**
2. **❌ Make `strip_sql()` keep dollar-quoted bodies by default.** Tempting one-line fix; **wrong**. The docstring's reasoning is correct for its primary purpose (batch-ordering dependency derivation): names inside a function body resolve at CALL time and must not become apply-time dependencies. Flipping the default would create *false dependencies* on 546 migrations — the opposite failure, and a worse one. Step 1 keeps the default and adds a **separate, explicitly-named** extraction path for apply-time DDL inside `do $$` blocks.
3. **❌ Write a third SQL parser, or pull in a real Postgres parser library (`pglast`, `libpg_query`).** Rejected for this plan: it adds a compiled dependency to CI, it is a large change to guards that are currently correct, and the enumerable blast radius (three files) does not justify it. **Reconsider only if Step 4's corpus keeps finding lexer gaps after Step 1.** Recorded here so the next session does not relitigate it silently.
4. **❌ Have every guard query the live database.** Rejected. Most guards run on pull requests, where the live catalog is *not* the right authority (a PR's migration has not been applied yet — that is the whole point). Only guards that conclude **"this object is missing / was never created"** need catalog truth. Step 3 wires exactly those.
5. **❌ Trust the live catalog as the source of truth for "was this work done".** Explicitly rejected by history: issue #892 (2026-08-13), where six merged migrations were never applied and an orchestrator told the owner Disney's model had never been built. Seventeen tables existed as reviewed, merged SQL. The rule is already written in `check-migration-ledger-drift.mjs`: *"THE LIVE CATALOG IS NOT PROOF THAT WORK WAS NEVER DONE."* Catalog truth is **one of three** inputs (file, ledger, catalog) and Step 2 must return all three.
6. **❌ Add a "known false alarms" list as a Markdown document.** Rejected: prose rots and nothing enforces it. Step 4 makes it **executable tests** and Step 5 makes it **structured data with a CI check**. A Markdown page is generated *from* those, never hand-maintained.
7. **❌ Drop independent review to go faster.** Rejected. The transcripts show reviewers catching real errors repeatedly. Step 8 changes only *how many* reviewers for a *structure-only* change and *how long* to wait — never whether to review.
8. **❌ Raise the three-lane cap.** Investigated separately on 2026-08-25 and out of scope (§4). The evidence in §6 says the bottleneck is diagnosis time, not lane capacity — one session found *"the real cause of the hours-long blockage, and it wasn't capacity."*
9. **❌ Fix this by shortening or restructuring `AGENTS.md`.** Attempted before (session `0566e836`, 2026-08-19: AGENTS.md was 204 KB against an 80 KB ceiling). It is now ~101 KB and still over. Size is a real problem but a *different* one; solving it does not stop a guard being wrong.

## 8. Design decisions already made

**LOCKED — do not relitigate:**

- **L1.** Guards get more accurate, never quieter. No guard is removed, disabled, or given a bypass. (Owner standing rule; §7.1.)
- **L2.** `strip_sql()`'s default stays `keep_dollar=False`. Apply-time DDL discovery gets a separate named function. (§7.2.)
- **L3.** No new SQL parser dependency in this plan. (§7.3.)
- **L4.** "Was this work done?" is answered from **three** sources — migration files on `main`, the `supabase_migrations.schema_migrations` ledger, and the live catalog — never from one. (§7.5, issue #892.)
- **L5.** All database access added by this plan is **strictly read-only**, through the existing Management API `database/query` path with `read_only: true` already used by `scripts/production_catalog_verification.py`. No new credential, no new connection method. (`AGENTS.md` §9 runbook.)
- **L6.** The false-alarm corpus is executable tests, not prose. (§7.6.)
- **L7.** This is repository maintenance. It never opens a migration, and it is not routed to the structure orchestrator. (`AGENTS.md` §0.0-B/§0.0-C.)
- **L8.** Work happens in a worktree cut from `origin/main`; the shared `C:\repos\shared-db` checkout is never used. (`AGENTS.md` §2.1-W.)

**OPEN — the implementer's judgment, decide and record the reasoning in the STATUS table:**

- **O1.** Language for the new scripts. `scripts/catalog-truth.mjs` and `scripts/triage-gate.mjs` are specified as Node `.mjs` to match the other `check-*.mjs` guards and the existing test runner. If the implementer finds the read-only Management API call is materially easier to reuse from Python (because `production_catalog_verification.py` already owns that code path), a Python module with a thin `.mjs` wrapper is acceptable — **as long as one command-line entry point exists** and it is covered by tests. Record the choice.
- **O2.** Exact JSON shape of `config/blocker-ledger.json`. §9 Step 5 gives the required fields; extra fields are fine. Do not remove a required field.
- **O3.** Whether `scripts/triage-gate.mjs` becomes a workflow comment on failing PRs, or stays a command a session runs. Start with the command (cheaper, no permissions change); add the comment only if it is trivially safe.
- **O4.** Whether Step 8's wait cap is enforced in code or documented as a rule. Documented is acceptable for the first pass.

---

# Part 3 — How to build it

## 9. The plan

**Phases and context cut points.** Phase A = Steps 0–4 (the load-bearing work). Phase B = Steps 5–7. Phase C = Steps 8–9. **Start a fresh session at each phase boundary**, re-read this plan from that phase onward before starting (drift check), and use the `fresh-session` skill. Update this file's STATUS table as you go — a plan goes stale the moment someone executes part of it, and whoever does the work owns updating it.

---

### Step 0 — Register the work

**What to do**
1. Open the tracking issue:
   ```bash
   gh issue create --repo u2giants/shared-db --label db-work --title "Cut issue lead time: guard truth, false-alarm corpus, blocker ledger" --body-file <file>
   ```
   The body **must** carry a `db-work-scope` block (`AGENTS.md` — every issue in this repo carries the `db-work` label *and* a scope block, no exceptions; #1188/#1238/#1242/#1266/#1268 were all missed for weeks because the label was omitted). Scope it as **repository maintenance, no structure change**.
2. Put the issue number at the top of this file. **Done — #1680.**
3. Confirm the `AGENTS.md` "Active contracts and implementation plans" entry and the `HANDOFF.d/` backlink both exist (they are created by the plan-writing commit; verify, do not duplicate).

**Behaviour when done:** a session that runs the orchestrator queue audit sees this work; a session that reads `AGENTS.md` finds this plan.

**Verification gate**
```bash
gh issue list --repo u2giants/shared-db --state open --label db-work --search "guard truth" --json number,title
grep -n "plan_orchestrator_throughput_guard_truth" AGENTS.md HANDOFF.d/*.md
node scripts/check-orchestrator-marker.mjs --queue-audit
```
The `grep` must return a hit in **both** files. The queue audit must **not** list this issue under `UNLABELLED ISSUES`.

**Depends on:** nothing. **Parallel with:** nothing.

---

### Step 1 — One lexer, and dollar-quoted DDL stops being invisible

**What to change**

1. In `scripts/production_migration_guard.py`, beside `strip_sql()` (line 1474), add a new exported function — suggested name `apply_time_ddl_bodies(raw: str) -> list[str]` — that returns the **contents of every dollar-quoted body that contains apply-time DDL** (`create table`, `create view`, `create materialized view`, `create index`, `alter table ... add column`). It must use the same single left-to-right lexer discipline (`AGENTS.md` and the `strip_sql` docstring explain why three regex passes is a defect, not a style choice). Do **not** change `strip_sql`'s default behaviour (**L2**).
2. In `scripts/production_catalog_verification.py`, `derive_targets()` (line 1365): after the existing pass over `split_statements(strip_sql(raw))`, run the same recognisers over the statements returned by `apply_time_ddl_bodies(raw)`. Objects found this way go into the **same** `tables` / `views` / `indexes` sets.
3. **Introduce the third state.** Today a scanner has "found" and "not found". Add `unresolved` — a name the lexer saw in a position it could not classify. Every consumer that today concludes *"this migration does not create X"* must be able to say instead *"I could not tell."* At minimum: `derive_targets()` returns an `unresolved` collection alongside `notes`, and it is surfaced in the Markdown report written by the module.
4. In `scripts/check-pr-object-collisions.mjs`, do **not** rewrite the Node lexer. Add a test-only assertion that its extraction agrees with the Python lexer on the shared corpus from Step 4. If they disagree, the corpus test fails and a human decides which is right. (Unifying the two lexers into one implementation is explicitly deferred — see §7.3.)

**How it should behave when done:** for the three migrations named in §3, the derived object list includes the relations created inside their `do $$ ... $$` blocks. For every other migration, the derived list is **unchanged** — this must not become a source of new false dependencies (**L2**).

**Verification gate**
```bash
python -m pytest scripts/test_production_migration_guard.py scripts/test_production_business_risk_gate.py -q
```
Then run the §3 reproduction script again and confirm the three files' inner relations now appear in `derive_targets()` output, and run the full Node suite:
```bash
node --test scripts/*.test.mjs
```
Both suites must be **green**, and the full suite count must not drop below the ~677 tests passing on `main`.

**Depends on:** Step 0. **Judgment call:** which DDL verbs count as apply-time. Criterion: *does this statement change the catalog at the moment the migration runs?* `create table` yes; a `select` inside a function body no.

---

### Step 2 — `scripts/catalog-truth.mjs`: one command for "what is actually true"

**What to build**

A single command that takes an object name and answers **all three questions at once** (**L4**):

```bash
node scripts/catalog-truth.mjs public.style_group_tags
```

Output must contain, for each requested object:

| Question | Source | Note |
|---|---|---|
| Does it exist in **production** right now? | `to_regclass` via the read-only Management API path already in `production_catalog_verification.py` | **L5** — read-only, no new credential |
| Does it exist in **preview** right now? | same, preview project | |
| Which migration **file on `origin/main`** creates it? | Step 1's lexer, including dollar-quoted bodies | must report `unresolved` honestly |
| Is that migration **in the applied ledger**? | `supabase_migrations.schema_migrations`, as `check-migration-ledger-drift.mjs` already reads it | |
| Is that migration **hard-blocked** from production? | `HARD_BLOCKED` list in `production_migration_guard.py` (~line 24 onward) | this is the #1645 trap: blocked ≠ absent |

Support `--version <migration-version>` and `--json` as well as a bare object name.

**How it should behave when done:** running it on the #1645 object returns "production: EXISTS (since the applied ledger row for version N)" **and** "creating file: … (hard-blocked: yes)" **in the same output**, so nobody can conclude "missing" from "blocked" again. When it cannot reach a database it must **fail loudly** — never print a reassuring "not found". (`check-migration-ledger-drift.mjs`'s header states this rule: *"the dangerous answer here is a reassuring one"*; every ungatherable input raises and exits `2`.)

**Verification gate**
```bash
node --test scripts/catalog-truth.test.mjs
```
Plus three hand checks, recorded in `docs/verification/catalog-truth-<date>.md`:
- a known-present object prints production EXISTS, preview EXISTS, a creating file, and a ledger row;
- a nonsense object name prints a clean ABSENT and exits 0;
- with the Supabase access token removed from the environment it exits **2** with an explicit "could not read" message and does **not** print "absent". This is the single most important test in this step.

**Depends on:** Step 1. **Parallel with:** Step 4 (different files).

---

### Step 3 — Guards consult catalog truth before saying "missing"

**What to change**

Find every place that concludes an object is absent and turn that conclusion into a **three-source statement**. The known sites:

- `scripts/production_catalog_verification.py` — the `to_regclass is NULL` hard-fail (~line 1947, message at ~line 2470: *"to_regclass is NULL — the apply reported…"*).
- `scripts/check-migration-ledger-drift.mjs` — both drift directions.
- Any guard that names a hard-blocked migration as the cause of a missing object (this is the #1645 site; if the implementer cannot locate it from the failure text, reproduce it by re-running the failing check on issue #1645's branch and capture the exact job log first).

For each: the **failure message** must include the catalog-truth answer, not just the file-derived one. Minimum wording:

```
X is not derivable from the allowlisted files.
  production: EXISTS since <ledger version / applied-at>
  preview:    EXISTS
  creating file: <path> (hard-blocked from production: yes/no)
  => This is NOT a missing object. Read docs/blocker-ledger.md entry <id> before investigating.
```

**How it should behave when done:** a session reading a red check learns, from the check itself, whether the thing is really missing. It should not need to open a single script.

**Verification gate**
```bash
node --test scripts/*.test.mjs
```
```bash
python -m pytest scripts/test_production_migration_guard.py -q
```
Plus a **hand check**: force one guard to fail on a known-present object in a scratch branch and read its message. Paste that message into `docs/verification/guard-truth-messages-<date>.md`. That file is the evidence for this row.

**Depends on:** Step 2. **Do not weaken any exit code** — a real missing object must still hard-fail (**L1**).

---

### Step 4 — The false-alarm corpus

**What to build**

`scripts/guard-false-alarm-corpus.test.mjs` (plus a Python companion `scripts/test_guard_false_alarm_corpus.py` for the Python guards) and a fixture directory `scripts/fixtures/false-alarm-corpus/`. Each fixture is a small file with a header comment naming the incident, the date, and the issue/PR. Every guard that reads text runs over **every** fixture and **must not fire**.

Backfill these, all confirmed from history:

| # | Fixture | The guard that wrongly fired | Recorded at |
|---|---|---|---|
| 1 | FK with `ON UPDATE CASCADE` / `ON DELETE RESTRICT` | `production_business_risk_gate.py` "existing production data may be lost" | script line ~1263–1284 |
| 2 | `DROP TRIGGER IF EXISTS` immediately followed by `CREATE TRIGGER` | same gate | same |
| 3 | Prose comment containing "an attempt to rewrite history" | `check-cancelled-work.mjs` R-SEC-1c row | script lines ~60–78, PR #1388, narrowed 2026-08-23 |
| 4 | A pure file **move** of text listed as cancelled work | `check-cancelled-work.mjs` | transcript, 2026-08-24 |
| 5 | `create table` inside `do $$ … $$` | `strip_sql` consumers | §3, §6.1 — the #1645 class |
| 6 | `$$` appearing inside a `--` comment | `strip_sql` (fixed) — regression lock | `strip_sql` docstring; hid 17 objects of `20260727154500` |
| 7 | English prose inside `comment on … is '…'` naming `core.style_guide_character` | `strip_sql` (fixed) — regression lock | `strip_sql` docstring; 30 phantom refs across 23 files |
| 8 | Literal `'CREATE TABLE AS'` used as a comparison value | `check-pr-object-collisions.mjs` (fixed) — regression lock | script ~line 677 |
| 9 | Prose "do not grant read on their own" | `check-pr-object-collisions.mjs` (fixed) — regression lock | script ~line 679 |
| 10 | `create trigger %I … on plm.%I` (format placeholders) | `check-pr-object-collisions.mjs` (fixed) — regression lock | script ~line 678 |
| 11 | `'plm.seq'::regclass` — the one literal that IS a real reference | `strip_sql` — **must still be seen**, a negative-negative | `strip_sql` docstring |
| 12 | A `pg_temp.` session-temporary table | `derive_targets` — must be excluded from durable verification | `production_catalog_verification.py` ~line 1401 |

**How it should behave when done:** adding a thirteenth fixture is the *cheapest possible* response to the next false alarm — one file, one row in the ledger, done. A future change that reintroduces any of the twelve fails CI immediately, with the incident named in the failure output.

**Verification gate**
```bash
node --test scripts/guard-false-alarm-corpus.test.mjs
```
```bash
python -m pytest scripts/test_guard_false_alarm_corpus.py -q
```
Then prove the corpus **actually bites**: temporarily revert the 2026-08-23 narrowing in `check-cancelled-work.mjs` (the explicit git-history-signal requirement) in your worktree, confirm fixture 3 **fails**, then restore. Record that in the STATUS evidence cell. A corpus that passes because it tests nothing is worse than no corpus.

**Depends on:** Step 1 (for fixture 5). **Parallel with:** Step 2.

**Wire it in:** add the corpus to the existing test workflow (`tools-offline-tests.yml` is the natural home — it is offline and needs no secrets). **Do not add a new required branch-protection context in this step**; that is a protection change and needs its own deliberate decision.

---

### Step 5 — The blocker ledger

**What to build**

`config/blocker-ledger.json` — an array of entries, each with at minimum:

```json
{
  "id": "BL-0001",
  "date": "2026-08-27",
  "issue": 1645,
  "class": "false-alarm",
  "surface": "scripts/production_catalog_verification.py",
  "symptom": "scanner reported a missing table and blamed a hard-blocked migration",
  "truth": "production has held the table since 2026-08-25",
  "why_invisible": "the CREATE TABLE is inside a dollar-quoted body, which strip_sql removes",
  "hours_lost": 3,
  "fixed_by": "open",
  "corpus_fixture": "scripts/fixtures/false-alarm-corpus/05-create-table-in-dollar-block.sql"
}
```

Allowed values for `class`: `false-alarm`, `stale-state`, `wrong-diagnosis`, `serialization`, `reviewer-harness`.

Backfill the twelve §6 incidents plus the §6.4 reviewer-harness ones (GLM idle-while-working → issue #1298; GLM keep-alive task not running; Kimi called dead while slow; registry model label wrong). `hours_lost` is an estimate — say so in the file's header; an honest estimate beats no measurement, and the ledger's job is ranking, not accounting.

Add `scripts/check-blocker-ledger.mjs`: validates the JSON shape, checks every `corpus_fixture` path exists, and checks every `fixed_by` SHA resolves. Generate `docs/blocker-ledger.md` from the JSON (**never** hand-edit the Markdown — §7.6).

**How it should behave when done:** "what is costing us the most time" is answerable with `jq`, not memory.

**Verification gate**
```bash
node scripts/check-blocker-ledger.mjs
```
```bash
node --test scripts/check-blocker-ledger.test.mjs
```
```bash
jq '[.[] | .class] | group_by(.) | map({class: .[0], n: length})' config/blocker-ledger.json
```
The `jq` output is the evidence cell for this row.

**Depends on:** Step 4 (fixtures must exist to be referenced).

---

### Step 6 — `scripts/triage-gate.mjs`: the first command when a check goes red

**What to build**

```bash
node scripts/triage-gate.mjs "SQL migration guards"
```

It also accepts `--run <workflow-run-id>`. It prints, in this order:

1. **What this guard is for** — the header comment of the script the check runs. (These headers are excellent; nobody reads them because nobody knows which file to open.)
2. **Known false alarms for this guard** — matching entries from `config/blocker-ledger.json`, newest first.
3. **Catalog truth** for every object named in the failure output — by calling Step 2's `catalog-truth`.
4. **Open handoffs and issues that mention this guard** — `HANDOFF.d/*.md` and `gh issue list --search`. This directly answers the *"it's documented in this morning's handoff"* failure (§6.3).
5. A one-line verdict: **`LIKELY FALSE ALARM (see BL-xxxx)`** or **`NO KNOWN MATCH — investigate`**.

**How it should behave when done:** a blocked session spends ~60 seconds, not an hour, deciding whether the guard is wrong.

**Verification gate**
```bash
node --test scripts/triage-gate.test.mjs
```
Plus a hand check: `node scripts/triage-gate.mjs "cancelled-work-guard"` must surface the ledger entry for the "rewrite history" prose false positive and print the guard's purpose. Paste the output into `docs/verification/triage-gate-<date>.md`.

**Depends on:** Steps 2 and 5. **Judgment call (O3):** command only, for now.

---

### Step 7 — Write the diagnosis rule into `AGENTS.md`

**What to change**

Add exactly two short subsections to `AGENTS.md`, in the §5.2 family (which already holds *"A red check on `main` can be a STALE verdict"* and §5.2-A *"a SECOND flavour of false red"* — this is the third flavour and belongs beside them):

- **§5.2-B — A THIRD flavour of false red: the guard read text, not the database.** State the #1645 case in three sentences. Give the one command: `node scripts/triage-gate.mjs <check>`. State the rule: **before concluding an object is missing, run `node scripts/catalog-truth.mjs <object>`; "the file does not say so" is not "it is not there."**
- **§5.2-C — State a diagnosis only with the command that proves it.** No session announces a root cause without either a re-runnable command or a `docs/verification/` line. If it cannot be proved in 10 minutes, say *"working hypothesis"* and keep going — an unproven hypothesis presented as a finding is what sends the next session down the wrong path. Quote two of the §6.3 self-corrections so the rule carries its own evidence.

Also add the plan to the "Active contracts and implementation plans" list at `AGENTS.md:26` with the standard *"read its STATUS table first"* wording.

**Behaviour when done:** a session that has never seen this plan still gets the rule, because it reads `AGENTS.md`.

**Verification gate**
```bash
grep -n "5.2-B\|5.2-C\|catalog-truth.mjs\|triage-gate.mjs" AGENTS.md
```
```bash
node scripts/check-skill-drift.mjs
```
`wc -c AGENTS.md` must not grow by more than ~4 KB.

**Depends on:** Steps 2 and 6 (the commands must exist before `AGENTS.md` tells people to run them).

---

### Step 8 — Reviewer chain: one reviewer, one liveness probe, one cap

**What to change** (documentation and a small probe; **no reviewer harness changes** — §4)

1. **Reviewer count by change class.** Write it into `AGENTS.md` §5: **structure-only** change with no data movement and no production apply → **one** independent reviewer. Production apply, data movement, or a security/RLS change → **two**. Today the number is ad-hoc and the transcripts show three reviewers on changes that did not need them.
2. **Liveness before waiting.** Before any wait on an external reviewer, probe that it is actually running. The failure this prevents is recorded: *"the scheduled task meant to keep GLM's server alive exists but is not running"*, and *"GLM's status field said it was idle"* (issue #1298). A reviewer that cannot be proved alive is **not waited on** — dispatch to a different one and record a ledger entry with class `reviewer-harness`.
3. **Hard wait cap.** 20 minutes per reviewer round. On expiry: record the ledger entry, re-dispatch or proceed with the other reviewer's verdict, and say so in the PR. Never sit in an open-ended poll loop.
4. **Log every reviewer failure** in the existing `u2giants/ai-devops` reviewer-issue log (the `log-reviewer-issue` skill already exists for this). Cross-reference the ledger id.

**Verification gate**
```bash
grep -n "one independent reviewer\|liveness\|20 minutes" AGENTS.md
```
```bash
jq '[.[] | select(.class=="reviewer-harness")] | length' config/blocker-ledger.json
```
The `jq` count must be at least 4 after the backfill.

**Depends on:** Step 5.

---

### Step 9 — Measure it

**What to do**

Add `scripts/issue-lead-time.mjs` that reproduces the §1 baseline, and write `docs/verification/issue-lead-time-<date>.md` with the numbers.

```bash
node scripts/issue-lead-time.mjs --repo u2giants/shared-db --limit 400
```

Record the 2026-08-27 baseline in that file as the "before" row: median 4.0h, mean 21.1h, p90 60.3h, >24h 18%, >72h 10%, n=400. Re-run it 30 days after Step 4 merges and add the "after" row. **Do not claim improvement before the second run exists** — a number with no artifact behind it is exactly the failure mode this plan's evidence rule exists to prevent.

**Verification gate**
```bash
node --test scripts/issue-lead-time.test.mjs
```
The command above must produce `docs/verification/issue-lead-time-<date>.md`, and that file is the evidence cell.

**Depends on:** nothing technically; it is last so the baseline file is not orphaned.

---

## 10. Tests required

**New tests — by name and behaviour:**

| File | Must assert |
|---|---|
| `scripts/guard-false-alarm-corpus.test.mjs` | Each of the 12 §4 fixtures passes every Node text guard **without firing**. Fixture 11 (`::regclass`) asserts the literal **is** still seen — a negative-negative. |
| `scripts/test_guard_false_alarm_corpus.py` | Same 12 fixtures against `production_business_risk_gate.py` and `production_migration_guard.py`. |
| `scripts/test_production_migration_guard.py` (extend) | `apply_time_ddl_bodies()` finds the three relations in `20260728174500`; `strip_sql()`'s existing behaviour is **byte-identical** to before for all 546 migrations (snapshot test). |
| `scripts/catalog-truth.test.mjs` | Present object → EXISTS from all three sources. Absent object → clean ABSENT. **Unreachable database → exit 2 with an explicit error, never "absent".** Hard-blocked migration whose object exists → reported as present *and* blocked. |
| `scripts/check-blocker-ledger.test.mjs` | Rejects a missing required field, a dangling `corpus_fixture` path, and an unresolvable `fixed_by` SHA. |
| `scripts/triage-gate.test.mjs` | Given a known guard name, prints the guard's purpose, the matching ledger entries, and the `LIKELY FALSE ALARM` verdict. Given an unknown one, prints `NO KNOWN MATCH` and exits 0. |
| `scripts/issue-lead-time.test.mjs` | Median/mean/p90 computed correctly on a fixed fixture array. |

**Existing suites that must stay green (all of them, every step):**

```bash
node --test scripts/*.test.mjs
```
```bash
python -m pytest scripts/ -q
```

The `main` baseline is ~677 passing tests. **A drop in the count is a failure even if nothing reports red** — check the number, not just the colour.

---

## 11. Constraints, standing rules, and gotchas in force

Named explicitly; do not assume they have been read elsewhere.

- **No database change.** This plan authorizes none. No migration file, no preview apply, no production apply, no data load. If a step appears to need one, **stop and open an issue** (`AGENTS.md` §0.0-B).
- **AI sessions are read-only for production and shared cloud infrastructure by default.** Never run `terraform apply` / `terragrunt apply` / a mutating production `gcloud` command. All database access here is read-only (**L5**).
- **Worktree only.** Never work in `C:\repos\shared-db` (`AGENTS.md` §2.1-W). Create the worktree from `origin/main`:
  ```bash
  git -C C:/repos/shared-db worktree add -b <branch> C:/repos/shared-db-worktrees/<name> origin/main
  ```
- **Squash-merge trap when retiring a worktree** — `AGENTS.md` §2.1-W.1. Read it before deleting a worktree; it has defeated every previous attempt.
- **Branch + PR, and the AI merges it.** `AGENTS.md` §5. The PR is not paperwork for the owner. Do not end a session asking Albert to merge. If `gh pr merge` prints `'main' is already used by worktree`, that is **local branch cleanup failing after a successful merge** — confirm with `gh pr view <n> --json state`, delete the remote branch, and continue.
- **Every issue carries the `db-work` label AND a `db-work-scope` block.** No exceptions, including tooling and CI complaints. Five issues were missed for weeks over exactly this.
- **A red check on `main` can be a stale verdict** (`AGENTS.md` §5.2) and **a job that never ran reads as red too** (§5.2-A, hosted-runner starvation, issue #513). Check which flavour before investigating. This plan adds the third flavour.
- **The live catalog is not proof that work was never done** (issue #892). Three sources, always (**L4**).
- **Never rewrite this repository's git history.** `check-cancelled-work.mjs` enforces the ruling and it is correct.
- **No silent failures.** Every new script must exit non-zero when it could not gather an input. "No problems found" from a run that could not look is the precise defect this repo has been burned by.
- **Do not add a new required branch-protection context** without a deliberate, separately-recorded decision. Protection currently has 11 contexts, `strict: false`.
- **Secrets by location only.** 1Password vault `vibe_coding`, by vault + item title. Never in chat, command arguments, logs, or commits.
- **Line numbers in this document will go stale.** Re-anchor by function name before editing:
  ```bash
  grep -n "def strip_sql" scripts/production_migration_guard.py
  ```
  The adjacent coordination plan carried six stale line citations, three pointing into unrelated functions. Do not trust a number written here.
- **Stage only your own hunks.** The shared checkout routinely has other sessions' modifications (`AGENTS.md`, `.ai/*.json` were dirty on 2026-08-27). Never `git add -A` across a shared checkout.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees. Use a WIP commit instead.

## 12. Access and environment

- **Repository:** `github.com/u2giants/shared-db`. Identity `u2giants`. Verify before the first commit:
  ```bash
  git var GIT_COMMITTER_IDENT
  ```
  It must show `Albert Hazan <u2giants@users.noreply.github.com>`. Never use the `popcre` identity here — that is DesignFlow only.
- **Base branch:** `main`. **Work branch:** your own, cut from `origin/main`.
- **Worktree location:** `C:\repos\shared-db-worktrees\<name>`.
- **Authenticated CLIs/MCPs available:** `gh` (GitHub), `supabase` CLI, the Supabase MCP, 1Password MCP (vault `vibe_coding`). Credentials for the read-only Management API path are already resolved by `scripts/production_catalog_verification.py` — **reuse that path, do not add a credential** (**L5**). The runbook is `AGENTS.md` §9.
- **Secrets:** 1Password vault `vibe_coding`, by **vault + item title only, never by value**. Load the `secrets-to-1password` skill before touching any secret. Serialize 1Password access.
- **Run the tests locally:**
  ```bash
  node --test scripts/*.test.mjs
  ```
  ```bash
  python -m pytest scripts/ -q
  ```
  Node and Python 3 are both on PATH on `edge-dev` (Windows 11, PowerShell primary, Git Bash available).
- **Databases:** a Supabase **preview** project and a Supabase **production** project. Project refs live in `AGENTS.md` §8. **Note:** preview ref `rjyboqwcdzcocqgmsyel` was **deleted on 2026-08-18** and replaced; if you find it hard-coded anywhere, that is a stale reference (session `jovial-hellman`, 2026-08-19). Always prove the target database immediately before any operation.
- **Transcript evidence** for everything in §6: `u2giants/ai-devops-transcripts`, `collection-2026-08-27/claude_chats/edge-dev/projects/C--repos-shared-db*`. Files are `xz`-compressed; decompress with `xz -dk`.

---

# Part 4 — Landing it

## 13. Definition of done + risks and open questions

### Definition of done

- [ ] Tracking issue open, labelled `db-work`, carrying a `db-work-scope` block, visible to `--queue-audit`.
- [ ] `AGENTS.md` lists this plan under "Active contracts and implementation plans", and carries new §5.2-B and §5.2-C.
- [ ] `HANDOFF.d/2026-08-27T2000Z-edge-dev-claude-plan-throughput-guard-truth.md` exists and links to this plan; this plan links back. Root `HANDOFF.md` untouched.
- [ ] `apply_time_ddl_bodies()` exists; the three §3 migrations yield their inner relations; `strip_sql()`'s output for all 546 migrations is byte-identical to before.
- [ ] `scripts/catalog-truth.mjs` exists, is tested, and **exits 2 rather than reporting "absent"** when it cannot read a database.
- [ ] Every "object missing" failure message names the three sources.
- [ ] 12 corpus fixtures exist; the corpus is proven to bite (a deliberately reverted narrowing makes it fail); it runs in `tools-offline-tests.yml`.
- [ ] `config/blocker-ledger.json` backfilled (≥16 entries: 12 false alarms + ≥4 reviewer-harness); `scripts/check-blocker-ledger.mjs` green; `docs/blocker-ledger.md` generated, not hand-written.
- [ ] `scripts/triage-gate.mjs` exists and returns the right verdict for `cancelled-work-guard`.
- [ ] Reviewer rules written into `AGENTS.md` §5.
- [ ] `docs/verification/issue-lead-time-<date>.md` holds the 2026-08-27 baseline.
- [ ] Full suite green; test count ≥ the `main` baseline (~677).
- [ ] Committed, pushed, **PR opened and merged by the AI**, CI green on `main` after merge, merge commit SHA recorded.
- [ ] This file's STATUS table updated with artifact-backed evidence in every cell.
- [ ] `session-docs-update` run at session end (it carries a mandatory plan-file gate for exactly this).

### Risks and rollback

| Risk | Likelihood | Mitigation / rollback |
|---|---|---|
| Step 1 changes `strip_sql` behaviour by accident and creates **false dependencies** across 546 migrations — the opposite, worse failure | Medium | The byte-identical snapshot test over all 546 migrations is mandatory and must be written **before** the change. Rollback: revert the commit; nothing else depends on it yet. |
| The corpus is written so loosely that it passes without testing anything | Medium | The "prove it bites" verification in Step 4 is not optional. |
| `catalog-truth` silently returns "absent" on a credential failure and someone quotes it | Low, catastrophic | Dedicated test with credentials stripped; exit 2 required. Reproducing this repo's own worst failure mode inside the fix for it would be absurd. |
| Guard messages get longer and noisier | Medium | Acceptable trade. Keep the three-source block to five lines. |
| A step drifts into a database change | Low | §4 and §11 forbid it; the tracking issue is scoped as repository maintenance. Stop and open an issue. |
| Work collides with another session in `shared-db` | Medium | Worktree from `origin/main`; the coordination machinery from `plan_multi_agent_database_coordination_hardening.md` is already live; stage only your own hunks. |
| `hours_lost` in the ledger is guessed and later quoted as fact | Medium | The file header must say the figures are estimates for **ranking only**. Never cite them as measurement. |

### Open questions

1. **Where exactly is the #1645 scanner?** This plan identifies the **mechanism** with certainty (`strip_sql` removes dollar-quoted bodies; consumers collapse "did not see" into "does not exist") and the three affected files. It does **not** name the specific job that produced the owner's quoted message, because the session that hit it is not in the 2026-08-27 transcript archive. **Decide by evidence:** re-run the failing check on #1645's branch, capture the job log, and record the exact script and line in ledger entry `BL-0001` before starting Step 3. If it turns out to be a different mechanism, **update this plan rather than implementing around it.**
2. **Is one reviewer genuinely enough for structure-only changes?** The transcripts show reviewers catching real errors, but also show the second and third reviewer adding hours and, in at least one case, being wrong. **Criterion for deciding:** after 30 days under the Step 8 rule, if any structure-only change reaches `main` with a defect a second reviewer would have caught, revert to two. Record the decision either way.
3. **Do the Node and Python lexers need to become one?** Deferred (§7.3). **Criterion:** if Step 4's cross-lexer agreement test finds more than two disagreements, open a follow-up issue to unify them.
4. **Does `AGENTS.md` need splitting?** It is ~101 KB against an 80 KB ceiling. Out of scope here (§7.9), but it is a real constraint and Step 7 adds ~4 KB. If Step 7 pushes it materially further over, open a separate issue; do not solve it inside this plan.

---

## Self-audit (recorded per the `implementation-plan-writer` standard)

**1. Could a brand-new AI session with no project knowledge and no context from this conversation execute this plan to perfection, without asking anything?**
Yes. §2 explains what the repository is, who uses it, where it runs, and the branch model, for someone who has never seen it. §5 gives the current state of every file the plan touches with function-name anchors and current line numbers, plus an explicit re-anchoring command in §11 because those numbers will move. §9 gives every step named target files, the intended behaviour, dependencies, and a runnable verification gate. §12 names the CLIs, the identity check, the worktree command, and how to run the tests. The one genuine unknown — the precise scanner behind the owner's #1645 quote — is stated as open question 1 with a decision procedure and an instruction to update the plan rather than implement around it, instead of being papered over.

**2. Does the plan carry every piece of background, nuance and reasoning currently held — including what was ruled out and why?**
Yes. §6 records all four failure shapes with verbatim transcript quotes and in-repo code evidence. §7 records nine rejected approaches, including the two most tempting ones (flip `keep_dollar`, loosen the noisy guards) with the specific reason each is wrong — flipping the default would create false dependencies across 546 migrations, and a worked-around guard protects nothing, which is the repository's own recorded conclusion. §8 separates eight locked decisions from four open ones. §7.5 records why the live catalog must never be the sole authority, citing issue #892 by name.

**3. Is the ultimate goal stated clearly enough that the implementer could make a correct judgment call if a step turns out to be wrong?**
Yes. §1 states the goal in business terms first, gives a measured baseline (median 4.0h, p90 60.3h, n=400, taken 2026-08-27) and a numeric target, then states the override explicitly: the goal wins over any step, **and** never reach the goal by weakening a guard. That second clause is the one an implementer needs, because every step in this plan is adjacent to a safety mechanism and the fast wrong answer is always to turn one off.

**Checklist grade:** all 13 sections present; goal in business English with the override; rejected approaches recorded; every step has files and a verification gate; locked vs open labelled; explicit out-of-scope list; tests named by behaviour; identifiers, paths and SHAs defined; secrets by location only; definition of done includes commit/push/CI/merge verification; plan ↔ handoff cross-links present. **Pass.**
