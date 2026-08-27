---
issue: 1694
status: OPEN
owner: claude/orchestrator-1668-closeout
---

# Orchestrator #1668 closeout — edge-dev, Claude, 2026-08-27T2035Z

Marker issue: **#1668** (closed by this session). Umbrella handover issue: **#1694**.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in ONE message before starting work. Do not meet them one at a time.

### Blocking — nothing moves until answered

**None.** Every item below is recoverable or out-of-band. The structural queue can be worked without waiting on Albert.

### A wrong guess is recoverable, but rework is wasteful

1. **Is `u2giants/popdam3` allowed to contain a `supabase/` directory at all?** (issue **#1693**, `needs-albert`)
   That repo — not shared-db — was the repository wired into the Supabase GitHub integration with "Deploy to production" ON for the live database. Albert already authorized a peer session to switch that off, and it is off. What nobody has done is look at what is in that directory or whether anything from it ever reached production.
   **Recommendation:** authorize a read-only audit of it and a comparison against production's real schema; and rule that `popdam3` must not carry migrations touching the shared database.
   **Blocks:** closing out #1663 and #1675 honestly. Not blocking anything structural.

2. **Should the merge freeze become a real, enforced lock?** (issue **#1688**, plus peer issues **#1689** and **#1690**)
   A "merge freeze" today is a chat message between sessions. Two independent structural holes make it unenforceable — see §5.4. During this session `main` moved five times in thirty minutes, three of those moves invalidated production evidence packets that had to be regenerated, and one killed a production apply outright.
   **Recommendation:** yes, build the enforcement. Explicitly **do not** make the gate tolerant of documentation-only commits — that exemption is the hole, not the fix.
   **Blocks:** nothing immediately; it is a throughput and safety tax paid every promotion.

3. **How much manual, per-case allowlisting are we willing to keep doing?** (issue **#1692**)
   Every time an unrelated pull request touches a "producer path", any migration that had already rehearsed on preview becomes permanently un-promotable and needs a hand-written, hand-reviewed, hand-merged allowlist tuple to recover. That happened twice today. The fix is a design change, not a bigger allowlist.
   **Recommendation:** treat #1692 as real structural work and queue it, rather than absorbing the cost each time.

### Not part of this work, and nobody is on it

4. **Six older `HANDOFF.d/` files may be stale.** One is confirmed: `HANDOFF.d/2026-08-26T1120Z-edge-dev-codex-orchestrator-1571-closeout.md`, whose contract issue **#1576 is closed**. Owner per its contract block: `codex/orchestrator-1571-owner-index`. Under the successor rule the session that finishes that workstream deletes it; this session did not do that work and so did not delete it.
   **Recommendation:** the next orchestrator retires it in its own closeout PR.

5. **`main` has 100+ live git worktrees on this machine** (`git worktree list`). Most are on squash-merged branches and are invisible to `git branch --merged`. `scripts/reap-merged-worktrees.mjs` exists for exactly this but refuses to run while an `orchestrator-marker` issue is open. Once marker #1668 is closed and before the next marker opens, it can run.
   **Recommendation:** run it dry, then `--apply`, in the gap between orchestrators.

### Already settled — do NOT re-ask

- **2026-08-18:** Albert does not sign off on technical risk. He is not a programmer and cannot evaluate the SQL a risk flag refers to. Never gate on a human judgement the human cannot make.
- **2026-08-26:** Albert does not merge pull requests. Claude opens them, gets them reviewed, and merges them.
- **2026-08-13:** there is no cap on the number of files in `HANDOFF.d/`. Count *stale* files, target zero; never count total files.
- **2026-08-27 (this session):** Albert authorized a peer session, in chat, to turn OFF "Deploy to production" for project `qsllyeztdwjgirsysgai`. Done and verified. Do not re-ask; do not re-enable.

---

## 1. What this application is

`u2giants/shared-db` is the **governance repository for the shape of POP Creations' shared Supabase database** — every table, column, view, function, trigger, RLS policy, index, constraint and grant. It holds no application code of consequence; what it holds is migrations plus the machinery that decides whether a migration is allowed to reach the live database.

Several separate applications read and write that one database: PopDAM (digital asset management), DesignFlow, whose `data.designflow.app` surface is the DB Data Admin application (licensing and product development), ColdLion (a customer-facing feed), and a CRM surface. Those applications own their own row data. They do **not** own the schema — every structural change is authored here, in a branch, in a pull request.

- **Repos:** `u2giants/shared-db` (this one), `u2giants/popdam3`, DesignFlow under the `popcre` org.
- **Databases:** Supabase. Preview project ref `mvpkijzfmfcxhnzqogzs`. Production project ref `qsllyeztdwjgirsysgai` — **never written to by any session directly, ever.**
- **How a change reaches production:** author on a branch → rehearse ("apply") on preview via GitHub Actions → get an independent external AI review → guarded merge → generate a review-evidence artifact → run a production apply that re-proves every link in that chain before it executes a single statement. Each of those is a GitHub Actions workflow; none of them can be done by hand.
- **Who runs it:** one **orchestrator** session at a time (this was #1668), which dispatches all actual authoring to sub-agent sessions in isolated git worktrees and never writes migrations itself.

---

## 2. What we set out to do this session, and why

Albert opened the session with a status request on four issues (#1658, #1662, #1645, #1607), then escalated it:

> "go ahead and don't stop until you've completed and put into production every open issue on this repo. once something goes fully into production, alert me."

So the objective was: drive every open structural issue all the way to the live database, concurrently where possible, reporting each production landing as it happened.

Late in the session Albert changed the instruction:

> "don't take on any new tasks. this session is getting old and needs to be handed over when currently running tasks are completed"

and then asked for this closeout. So the session ends deliberately, not because it failed — it ends because it had run long and its context was aging.

**In business terms:** two small database improvements were supposed to go live today and did not, because a safety check that is working exactly as designed has a trap in it that makes certain changes permanently un-shippable. Most of this session's real value was finding, proving, and partially fixing that trap.

---

## 3. Current state — what is true right now

**All facts below were re-derived from `git`/`gh` at 2026-08-27T20:35Z. Anything older is called out.**

### 3.1 Repository

- `origin/main` tip: **`466ffbc091c4b883732c74fc030aec42e1f3444e`** (checked 20:23Z, then again at 20:35Z — unchanged; the merge freeze held).
- Highest migration version on `main`: **`20260827183106`** (`supabase/migrations/20260827183106_drop_asset_tags_normalization_index.sql`).
- Next-highest: `20260827183011_popdam_effective_asset_filters.sql`.

### 3.2 What landed in production today

Two migrations reached the live database earlier in the session and were reported to Albert at the time:

- `20260827132637` — index for DesignFlow unread notification badge counts (issue #1452).
- `20260827133720` — harden the FR authorization metadata contract (issue #1259).

**Nothing has reached production since.** Both remaining candidates are blocked; see §3.4.

### 3.3 What was completed this session and is on `main`

**PR #1687 — merged at `466ffbc091c4b883732c74fc030aec42e1f3444e`.** Three files only:
- `.github/workflows/preview-ledger-orphan-reconciliation.yml`
- `scripts/preview_ledger_orphan_reconcile.py`
- `scripts/test_preview_ledger_orphan_reconcile.py`

What it does:
1. Adds one `rehearsal_reset` case, tuple `(1467, 1580, 1585, "20260827183106", "20260827183106")`, which permits deleting exactly that one row from `supabase_migrations.schema_migrations` **on preview only**, so version `20260827183106` can be genuinely re-rehearsed at the exact current `main`.
2. Adds the matching tuple to the workflow's `case` allowlist.
3. **Generalises** the same-version intent guard, which previously hard-coded `test "$ORPHAN" = "20260824004025"` — that hard-coding is why the second case could not simply be added.
4. Adds `test_every_rehearsal_reset_target_can_actually_be_reapplied`, which walks **every** same-version `rehearsal_reset` case and asserts, through the real `load_replacement()`, that its migration is non-empty and carries no transaction control. 21 tests pass.

That last test is the durable win: re-adding the dangerous #1645 tuple (see §4.3) would now fail CI rather than needing a human to notice.

Reviewed twice by Grok 4.6 (`shared-db-1687` → REVISE with one Critical; `shared-db-1687-v2` → **APPROVE**).

### 3.4 What is half-done — the two stranded migrations

**`20260827183106`** (issue #1467, claim #1580, PR #1585) — drops a temporary index left behind by the #1427 family.
State: merged to `main`; applied to preview; **refused at production**. The `rehearsal_reset` remedy is now merged and available but **has not been run**. Remaining chain in §6.1.

**`20260827183011`** (issue #1645, claim **#1656**, PR #1664) — PopDAM effective-tag and grouped-identity filtering with facet-count parity.
State: merged to `main`; applied to preview; **refused at production**; **and its remedy has been proven invalid.** This version can never be `rehearsal_reset`. It must be re-authored as a fresh idempotent successor version, with the stuck version retired so it can never promote. See §4.3 and §6.2. **Not started.**

> ⚠️ The claim issue for #1645 is **#1656**, not #1649. #1649 is a previous orchestrator marker. An agent asserted #1649 during this session and was wrong. #1656's body binds `version: 20260827183011`.

### 3.5 Lanes and claims

`node scripts/manage-migration-author-lanes.mjs --audit` → **3 of 5 lanes occupied, 0 expired claims.**

| Claim | Issue | Version | Worktree | State |
|---|---|---|---|---|
| #1659 | #1658 (DCP contract + OPA authority) | — | `C:/repos/shared-db-worktrees/issue-1658-1649` | PR **#1660** open, held by the freeze |
| #1656 | #1645 (PopDAM effective filters) | `20260827183011` | `C:/repos/shared-db-worktrees/issue-1645-effective-filters-1649` | PR #1664 merged; version stranded |
| #1580 | #1467 (drop normalization index) | `20260827183106` | `C:/repos/shared-db-worktrees/rehearsal-reset-1467-1645` | PR #1585 merged; version stranded |

**Do not release #1580 or #1656.** Their migrations are on `main` and unpromoted; releasing the claim loses the object lock while the work is still live. `--release-claim` refuses without `--owner` and `--confirm-finished`, and it refused twice during this session — correctly.

### 3.6 Open pull requests (checked 20:23Z)

| PR | Title | Owner | Why still open |
|---|---|---|---|
| #1691 | handoff for the MIGRATIONS_FAILED diagnosis and the freeze gap (#1663) | peer `shared-db-orchestrator-3925aa-e5` | held by the merge freeze; docs-only, safe to merge on lift |
| #1685 | correct throughput plan after GLM-5.3 review | blockers session | held by the freeze; docs-only |
| #1670 | Freeze orphan designflow schema instead of dropping it (#778) | `shared-db-orchestrator-ae40c6-e9` | held by the freeze; **contains migration `20260827160000`** — this one is NOT docs-only and needs the full chain |
| #1660 | Enforce authoritative contract and OPA scope for DCP (#1658) | claim #1659 | held by the freeze; structural |

PR **#1379** (issue #1358) was also listed as freeze-held earlier in the session but no longer appears in the open list — **re-derive its state before acting on it.**

### 3.7 The merge freeze

**A merge freeze declared by this session is still nominally in force, and this session is ending.** It was declared because `main` moved five times in thirty minutes (`a343b11` → `058c51a` → `172d2bb` → `a288137` → `254f0db`), every move being a docs or plan pull request, and three of those moves invalidated production evidence that had to be regenerated from scratch.

It was relayed to `shared-db-orchestrator-3925aa-e5`, to the "Shared-db orchestrator session blockers" session, and to `shared-db-orchestrator-ae40c6-e9`. A fourth session, `six-unapplied-migrations-17e15c-6f`, was listed but could not be reached.

**§6.6 tells the successor exactly how to dispose of it.** Do not leave it undeclared-but-believed.

### 3.8 Preview's actual state — not clean

Preview (`mvpkijzfmfcxhnzqogzs`) holds `20260827183011` **and** `20260827183106` in `supabase_migrations.schema_migrations`, both applied and neither promoted. That is precisely why neither can be re-rehearsed by an ordinary apply — the apply becomes a no-op and produces no bytes-applied evidence.

`PREVIEW_ONLY_HISTORICAL_RESTORATIONS = {"20260817150944", "20260824150630"}` in `scripts/production_migration_guard.py` are deliberately preview-only and must **never** be promoted to production.

### 3.9 Uncommitted work in this session's worktree — READ THIS

`C:/repos/shared-db/.claude/worktrees/shared-db-orchestrator-status-49e9e6`, on branch `claude/preflight-applied-dynamic-ddl` at `cb9e834`, has a **dirty, staged index** that this session did not create and did not commit:

```
M  AGENTS.md
A  HANDOFF.d/2026-08-27T1730Z-edge-dev-claude-age-group-cutover-c2.md
A  HANDOFF.d/2026-08-27T1730Z-edge-dev-claude-needs-albert-sweep.md
A  HANDOFF.d/2026-08-27T2000Z-edge-dev-claude-plan-throughput-guard-truth.md
A  plan_orchestrator_throughput_guard_truth.md
M  scripts/production_catalog_verification.py
A  supabase/migrations/20260827183106_drop_asset_tags_normalization_index.sql
M  supabase/tests/popdam_ai_search_batched_forward_contract.sql
M  supabase/tests/popdam_ai_search_forward_recovery_contract.sql
M  supabase/tests/popdam_ai_search_recovery_b_contract.sql
M  supabase/tests/popdam_asset_tag_normalization_accelerator_contract.sql
```

**This is a deliberate leave, not an oversight.** Those files belong to other workstreams (three are other sessions' handoff files; the migration and contract tests are #1467's, already merged via PR #1585). This closeout was therefore written in a **separate clean worktree** (`C:/tmp/wt-1668`, branch `claude/orchestrator-1668-closeout`) precisely so that nothing here was swept into a commit. **Do not `git add -A` in that worktree.** Someone who owns those files should reconcile them; nothing is lost, and everything staged there also exists on `main` or in another session's branch.

---

## 4. Everything we tried that did NOT work

This is the section that saves the next session a day. Read it before touching either stranded version.

### 4.1 Production apply, six separate failures, three distinct causes

| Run | Failed at | Actual cause |
|---|---|---|
| 33107642687 | "Verify exact main commit" | `main` had moved to `172d2bb0` mid-flight. Evidence regenerated against the new tip. |
| 33107978731 | preview recovery REFUSED | "historical preview recovery requires the exact current main SHA" — `main` moved to `a2881370` **during the run**. Fixed with a re-pinning retry loop. |
| 33108266329 | business risk gate | "original apply run 33106059012 dispatched at `4355d056`… produced evidence with a different `scripts/production_migration_guard.py` than the merge commit `058c51a1`…" — **the real cause**, see §5.1. |
| 33109639903 | business risk gate | "original apply run 33108122567 … is itself a historical recovery" |
| 33109940566 | business risk gate | same |
| 33110202832 | business risk gate | same |

**The lesson in one line:** the last three failures happened while `main` was completely stable at `254f0db`. **This was never the SHA race.** Anyone who diagnoses it as a race will re-run the retry loop, burn the GitHub API rate limit again, and land in the same place.

### 4.2 Historical preview recovery cannot substitute for a real rehearsal

The obvious move — re-run the "historical preview recovery" lane to mint a fresh evidence artifact at current `main` — **is explicitly refused**:

> "original apply run … is itself a historical recovery; a recovery is only ever bound to a run that actually applied bytes"

That refusal is correct and should not be relaxed. A recovery is a *no-write proof* that re-emits an artifact naming the current main SHA. It never applies bytes, so it can never be the thing a later recovery points at. Recovery-of-a-recovery is an infinite regress that would let any evidence be manufactured.

### 4.3 `rehearsal_reset` for `20260827183011` — proposed, reviewed, and correctly killed

PR #1687 v1 contained a **second** tuple, `(1645, 1656, 1664, "20260827183011", "20260827183011")`, applying the same remedy to the #1645 version. Grok 4.6 returned **VERDICT: REVISE** with one Critical, and it was right. I verified the claim myself in the file before acting:

`supabase/migrations/20260827183011_popdam_effective_asset_filters.sql` contains
- `begin;` at line 3 and `commit;` at line 532 — transaction control, and
- `create table public.asset_effective_tags` at line 14, with `create trigger` at lines 153, 157 and 161.

Consequences, both fatal:
1. `load_replacement()` refuses any replacement that is empty or contains transaction control, so the tuple **could never execute at all** — it would have shipped a workaround that silently did nothing.
2. If someone "fixed" that by relaxing the transaction-control check, the reset would delete preview's ledger row **while the tables and triggers it created still exist**. The next apply would then fail on `create table` / `create trigger`. Preview would be strictly worse off than it is now.

**Fixed by removing the tuple, its workflow allowlist line, and `20260827183011` from the same-version `case` — explicitly WITHOUT relaxing the transaction-control check.** Then a regression test was added so the mistake cannot be re-made silently (§3.3).

> ⛔ **DO NOT add `20260827183011` to `rehearsal_reset` and DO NOT relax the transaction-control refusal in `load_replacement()`.** Both are load-bearing. If a future session hits this wall, the answer is §6.2, not a looser guard.

### 4.4 A peer session's retraction was itself wrong — do not let it spread

A peer session claimed that the dollar-quoted `CREATE TABLE` finding behind merged PR #1677 was a phantom produced by a bad regex. I checked the file directly. It is real:

`supabase/migrations/20260825082910_popdam_ai_search_reconciliation_and_activation.sql:2367`
```sql
select pg_temp.popdam_1479_apply_final_ddl($ddl$create table if not exists public.style_group_tags (
```

The dollar tag is `$ddl$`, **not** a bare `$`. A scan for a bare `$` finds nothing and produces exactly that false retraction. Scan with `\$[A-Za-z_]*\$`.

**Why this matters:** if the retraction spreads, someone will "correct" the guard back into the false REJECT that stranded #1645 in the first place. The peer was told to re-scan and to keep the retraction out of any plan or handoff.

### 4.5 GitHub API rate limit

The re-pinning retry loops exhausted the API rate limit for user id 55610577. Recovery was to wait and then poll with rate-limit-tolerant matching. **Do not build tight retry loops against `gh api` when chasing a moving `main`** — declare a freeze instead.

### 4.6 A wording mistake of mine, corrected

I told a peer session not to put the freeze-enforcement question to Albert because I was reporting the whole picture myself. The peer pushed back: Albert had asked *it* why production was red, and the freeze holes were part of the honest answer. **The peer was right, and I withdrew the instruction.** Recorded because the general rule matters: one session does not get to filter what another session tells the owner.

### 4.7 A framing mistake of mine, corrected to Albert

I initially described the preview branch's `MIGRATIONS_FAILED` status as "the guard working". That was too generous. It is an **accidental** protection: the Supabase CLI aborts on a migration-history mismatch before executing anything. Our allowlist guard never actually stopped it. The correction was reported.

---

## 5. Root causes and key findings

### 5.1 The producer-path pin — the single fact that explains both stranded migrations

`scripts/production_business_risk_gate.py::prove_historical_original_apply_runs` (~lines 880–1030) pins **both** the original preview run's dispatch ref (`head_sha`) **and** the artifact-named checkout commit to the **merge commit of the pull request that authored the version**, comparing every file in `PREVIEW_PRODUCER_PATHS` byte-for-byte:

```python
for commit, role in ((run_head, "dispatched at"), (original_commit, "checked out at")):
    prove_preview_producer_matches_main(
        commit, authored_merge(merge_sha), main_sha, api,
        what=f"original apply run {run_id} {role} {commit}",
        against=f"the merge commit {merge_sha} of the pull request that authored {version}",
    )
```

- `prove_preview_producer_matches_main` — `scripts/production_business_risk_gate.py:647`
- `PREVIEW_PRODUCER_PATHS` — `scripts/production_business_risk_gate.py:432`. It includes `supabase/config.toml`, `config/atomic-migration-allowlist.json`, and the whole executed closure of scripts — **including `scripts/production_migration_guard.py`**, because that file runs inside the preview job.

**The mechanism that stranded both branches:**
1. Both rehearsed on preview **before** PR #1677 landed on `main`.
2. #1677 changed `scripts/production_migration_guard.py` — a pinned producer path.
3. Both branches then merged `main`, as they must.
4. Their merge commits therefore carry the **new** `guard.py`, while their rehearsal evidence was produced with the **old** one.
5. The pin refuses. **Correctly** — the evidence genuinely was produced by different code than what `main` now runs.

Escape routes and why each is closed: recovery is refused as recovery-of-a-recovery (§4.2); a fresh real rehearsal is a no-op because preview already holds the version (§3.8).

**Filed as issue #1692.** This will happen again to the next migration whose rehearsal predates an unrelated producer-path change.

### 5.2 `rehearsal_reset` is the sanctioned remedy, and its shape matters

`scripts/preview_ledger_orphan_reconcile.py` carries `SUPPORTED_CASES` (~line 20), keyed by the tuple `(issue, claim, source_pr, orphan_version, replacement_version)`. Modes: `replacement_pending`, `replacement_already_applied`, `byte_identical_rename`, and `rehearsal_reset`.

`rehearsal_reset` deletes exactly one row from `supabase_migrations.schema_migrations` **on preview**, so the version can be applied for real again. Precedent case:

```python
(1211, 1371, 1372, "20260824004025", "20260824004025"): {
    "mode": "rehearsal_reset",
    "original_run_head": "88ebd0272a163d32aefe748d59c7096c8fe54d0e",
},
```

Two guards deliberately special-case it:
- line ~145: refuses when the orphan version still exists on current `main` — **unless** mode is `rehearsal_reset` (for a reset the file *should* still be there).
- line ~302: refuses `orphan == replacement` unless mode is `rehearsal_reset`.

**It only works for a migration that is safely re-runnable from a clean ledger row.** A migration that creates objects and wraps itself in a transaction is not — which is the whole of §4.3.

### 5.3 The `$ddl$` dollar-quote finding is live

See §4.4. `supabase/migrations/20260825082910_...sql:2367`. Scan with `\$[A-Za-z_]*\$`, never a bare `$`.

### 5.4 The merge freeze has no enforcement surface — two structural holes

Both surfaced by an independent Grok review commissioned by a peer session, and both confirmed:

1. **TOCTOU on the production lock.** `refs/db-coordination/production` is acquired at `.github/workflows/shared-supabase-migrations.yml:1257`, but the "Verify exact main commit" check runs earlier at `:1249`. Anything that merges between those two lines invalidates the verification that already passed.
2. **The docs-only bypass.** `.github/workflows/migration-author-lease.yml` reports the required `Migration guarded merge authorization` context as **success** for any pull request with no migration files. Combined with `required_status_checks.strict` being **FALSE**, a docs-only pull request merges straight through both a chat-declared freeze and an active production apply lock.

Filed as **#1688** (blockers session), **#1689** and **#1690** (peer session). I agreed with the reviewer's recommendation **against** making the gate tolerant of documentation-only commits — that tolerance is the hole.

### 5.5 The production auto-deploy path was fed from the wrong repository

See §0 item 1 and issue **#1693**. `u2giants/popdam3`, not `shared-db`, was the repo connected to the Supabase integration with "Deploy to production" ON for `qsllyeztdwjgirsysgai`. Albert authorized a peer session to turn it off; it is off and verified — automatic branching, branch limit 3, and "Supabase changes only" were left untouched, and the integration itself was not disabled. **The contents of that repo's `supabase/` directory have never been audited.**

### 5.6 Operational facts worth keeping

- Tests run **directly**; `pytest` is not installed here. `python scripts/test_*.py`, `node --test scripts/*.test.mjs`, `bash scripts/check-sql.sh`.
- `mcp__supabase__get_project_url` returns the **PRODUCTION** url in this session. Never use it to derive a preview target.
- `gh pr merge` from a linked worktree prints `'main' is already used by worktree`. That is **local branch cleanup failing after a successful merge**, not a failed merge. Confirm with `gh pr view <n> --json state`. It happened on #1687 and the merge was fine.

---

## 6. Exact next steps

### 6.1 Finish `20260827183106` (issue #1467) — the remedy is merged and ready

1. **Re-derive `main`.** `git fetch origin && git rev-parse origin/main`. Every SHA below must be recomputed; the ones in this document are from 20:35Z.
2. **Run the reconciliation** to reset preview's ledger row:
   ```bash
   gh workflow run preview-ledger-orphan-reconciliation.yml --ref main -f issue=1467 -f claim=1580 -f source_pr=1585 -f orphan_version=20260827183106 -f replacement_version=20260827183106
   ```
   **You'll know it worked when** the run is green and its log shows one row deleted from `supabase_migrations.schema_migrations` on `mvpkijzfmfcxhnzqogzs`, and the tuple was matched by the `case` allowlist rather than refused.
3. **Real preview apply at the exact current `main`:**
   ```bash
   gh workflow run shared-supabase-migrations.yml --ref main -f target=preview -f mode=apply -f preview_allowlist=20260827183106 -f claim_pr=1585 -f claim_head_sha=<current main sha>
   ```
   **You'll know it worked when** the run reports bytes actually applied (not a no-op) and produces a `preview-migration-apply-<mainSha>` artifact naming the current main SHA.
4. **Review evidence:**
   ```bash
   gh workflow run production-apply-review-evidence.yml -f reviewed_main_sha=<main> -f ordered_allowlist=20260827183106 -f verdict=APPROVE -f reviewer_label="grok-4.6 seq<N> PR#1585 issue#1467"
   ```
5. **Capture both artifact digests:**
   ```bash
   gh api repos/u2giants/shared-db/actions/runs/<run id>/artifacts -q '.artifacts[]|.digest'
   ```
6. **Production apply:**
   ```bash
   gh workflow run shared-supabase-migrations.yml --ref main -f target=production -f mode=apply -f production_allowlist=20260827183106 -f commit_sha=$M -f confirmation="APPLY $M" -f source_pr=1585 -f preview_run_id=<id> -f preview_artifact_digest=sha256:<…> -f review_run_id=<id> -f review_artifact_digest=sha256:<…>
   ```
   **You'll know it worked when** the run is green and `mcp__supabase__list_migrations` against production shows `20260827183106`. **Then tell Albert** — he asked to be alerted on every production landing.

> ⚠️ **Freeze `main` for the whole of steps 2–6.** If `main` moves after step 3, steps 4–6 must be redone from step 3. That is exactly what cost this session three failed runs.

### 6.2 Re-author `20260827183011` (issue #1645) — new work, not a recovery

`20260827183011` is permanently un-promotable. Do not try to rescue it.

1. Reserve a **fresh** 14-digit version through the lane manager. Never pick one by hand.
2. Re-author the PopDAM effective-tag / grouped-identity work as an **idempotent** migration: `create table if not exists`, `create or replace`, `drop trigger if exists` before each `create trigger`, so it is safe to run against a preview that already carries `20260827183011`'s objects.
3. **Retire `20260827183011`** so it can never promote — follow the repo's supersession path for a retired version (see the `PREVIEW_ONLY_HISTORICAL_RESTORATIONS` precedent in `scripts/production_migration_guard.py` and the retirement examples under the `codex/retire-*` branches).
4. Full chain as in §6.1.

**You'll know it worked when** production carries the new version, preview is consistent, and no promotion path anywhere can select `20260827183011`.

### 6.3 Promote `20260827095753` (issue #1646)

The CRM `api.crm_update_customer` change adding `p_clear_domain`. Production currently has only the 8-argument form.

⚠️ **It needs its own production allowlist entry and its own review evidence.** The `(1615, 1636, 1637)` reconciliation tuple that already exists governs only the **preview orphan rename** — it is not a promotion. Anyone who reads that tuple as "already handled" will skip a live production gap.

**You'll know it worked when** production's `api.crm_update_customer` exposes `p_clear_domain`.

### 6.4 Dispatch issue #1662 — mgCategory cutoff

Enforce `mgCategory` only for post-2025-05-13 items. **Never dispatched by this session.** Classify it against the admission test before assigning a lane.

### 6.5 Release the freeze-held pull requests

In this order: docs-only first (#1691, #1685), then structural (#1670, which carries migration `20260827160000`, then #1660). Re-derive each PR's state first — #1379 was listed as held earlier but no longer appears open.

### 6.6 Dispose of the merge freeze — do this FIRST, before anything above

The freeze is a chat convention with no enforcement (§5.4), and the session that declared it is gone. Pick one and say which:

- **If you are continuing the promotion work immediately:** re-declare it in your own name to the three reachable sessions — `shared-db-orchestrator-3925aa-e5`, "Shared-db orchestrator session blockers", `shared-db-orchestrator-ae40c6-e9` — and note it on issue #778 for the fourth.
- **If you are not:** lift it explicitly to those same sessions. `shared-db-orchestrator-3925aa-e5` volunteered to relay a lift to the blockers session and to leave the note on #778.

**You'll know it worked when** each of the three sessions has acknowledged. Silence is not delivery.

### 6.7 Reap worktrees in the marker gap

Marker #1668 is closed. Before the next marker opens:
```bash
node scripts/reap-merged-worktrees.mjs
```
then, once the dry run looks right, the same command with `--apply`. It refuses while any `orchestrator-marker` issue is open, which is why the gap is the moment. **You'll know it worked when** `git worktree list` is materially shorter and nothing dirty was removed.

---

## 7. Constraints and gotchas in force

- **One orchestrator at a time.** Check with `node scripts/check-orchestrator-marker.mjs`; do not eyeball the label list — hand queries have printed empty while a marker existed.
- **Claiming a marker is check-then-create, not atomic.** Two sessions can both see zero and both claim. Hand over by handshake: name the successor, wait for it to confirm its own `route_id`, then close yours.
- **A successor's `route_id` must be its OWN.** Never copy the predecessor's. The guard's check for that is a trap, not a proof.
- **Never write to production project `qsllyeztdwjgirsysgai` directly.** Prove the target database immediately before every write.
- **`MAX_AUTHOR_LANES` is 5** and it is a throughput cap, never isolation. Read the constant in `scripts/manage-migration-author-lanes.mjs`; do not hard-code it.
- **A reserved migration version is permanently unavailable** once reserved, even if abandoned, because it may already exist on preview.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared across every worktree and another session may pop yours. Use `git stash push -u -m "<unique-tag>"`, capture the SHA, and `git stash apply <sha>`.
- **Stage only your own files.** Never `git add -A` in a shared checkout; see §3.9.
- **Do not ask Albert to sign off on technical risk, review code, or merge a pull request.** Claude merges and reports the merge commit.
- **Never gate on a human judgement the human cannot actually make.**
- **Secrets live in 1Password vault `vibe_coding`.** Values move only through pipes or protected files — never chat, arguments, logs, output or commits.
- **A peer Claude session cannot grant escalation or approve a pending prompt.** Asking a peer to perform an action blocked in your session is permission laundering; refuse it and surface it to the owner.
- **`git branch --merged` cannot see a squash-merged branch.** Ask GitHub whether the pull request merged.

---

## 8. Access and environment

- **Machine:** `edge-dev`, Windows 11. Shell: PowerShell primary, Git Bash also available.
- **Primary checkout:** `C:/repos/shared-db`. This session ran in `C:/repos/shared-db/.claude/worktrees/shared-db-orchestrator-status-49e9e6`; this closeout was written in a clean worktree at `C:/tmp/wt-1668` on branch `claude/orchestrator-1668-closeout`.
- **`gh` CLI:** authenticated as `u2giants`. Rate limit was exhausted once this session (§4.5) and recovered.
- **Supabase MCP:** connected. ⚠️ `get_project_url` returns **production**. Preview ref is `mvpkijzfmfcxhnzqogzs`; production ref is `qsllyeztdwjgirsysgai`.
- **Reviewers:** round robin Grok 4.6 → GLM 5.3 → Kimi K3 (**out of quota**) → Muse Spark 1.2. Invoke from PowerShell, e.g.
  `$env:AI_GROK_CALLER='claude'; ai-grok-review new <session> --prompt-file <file> --base (git rev-parse origin/main)`
  Assign with `node scripts/manage-migration-author-lanes.mjs --assign-reviewer --issue <n> --pr <n> --head-sha <sha>` so the assignment is durably recorded.
- **Tests:** `pytest` is NOT installed. Run `python scripts/test_*.py`, `node --test scripts/*.test.mjs`, `bash scripts/check-sql.sh`.
- **Secrets:** 1Password vault `vibe_coding`. **No new credential appeared in this session** — swept, nothing new; see the closing report.

---

## 9. Open questions and risks

- **2026-08-27 — Will #1692 be treated as real work, or absorbed case by case?** Every producer-path change silently arms the same trap for every migration currently rehearsed-but-unpromoted. Right now that is two. It could as easily be five.
- **2026-08-27 — The freeze is unenforceable and now unowned.** Until #1688/#1689/#1690 land, a docs-only pull request can merge during a live production apply and invalidate its evidence. This is not theoretical; it happened repeatedly today.
- **2026-08-27 — Production may carry schema that shared-db has no record of.** The auto-deploy path from `u2giants/popdam3` was live and is now off, but unaudited (#1693, #1675, #1663).
- **2026-08-27 — `20260827183011` will be re-attempted as a `rehearsal_reset` by someone** unless §4.3 is read. The regression test added in PR #1687 now fails CI if they try, which is the real protection; this document is the explanation of why.
- **2026-08-27 — Decision, recorded:** the transaction-control refusal in `load_replacement()` was deliberately NOT relaxed, even though relaxing it was the shortest path to shipping #1645 today. Relaxing it would let a reset delete a ledger row while the objects it created still exist.
- **2026-08-27 — Decision, recorded:** the same-version guard was generalised rather than given a second hard-coded version string, so the next legitimate case does not need a code change to the guard itself.
- **2026-08-27 — Unresolved review finding carried forward:** GLM-5.3's High on PR #1585 (the ephemeral-lane ordering problem, part (b) below) was never addressed. It must be resolved as part of #1467's continuation.
- **Stale-fact warning:** every SHA, run id, lane count and pull-request state in this document was checked at **2026-08-27T20:23–20:35Z**. In this repository documents have gone stale within the hour. Re-derive from `git` and `gh` before acting on any of them; where this document and an issue disagree, believe neither — believe the live repo.

---

# PART (b) — Sub-agent and delegated work, one block each

### Agent: `codex/issue-1467-drop-normalization-index-1579` → `codex/rehearsal-reset-1467-1645`
- **Worktrees:** `C:/repos/shared-db-worktrees/issue-1467-1579`, `C:/repos/shared-db-worktrees/rehearsal-reset-1467-1645`
- **Asked to do:** author and promote the drop of #1427's temporary asset-tags normalization index (issue #1467, claim #1580).
- **Actually did:** authored `20260827132608`, superseded to **`20260827183106`** after a version collision (supersession `65352a56aceb258be3b3263fd2fdb2dda88e7dfd`, new head `a547f95953ab3b46bbd8f75eb5df127b8a344b69`); PR **#1585** merged; applied to preview.
- **Found:** GLM-5.3's review of #1585 v2 returned **REVISE** with a genuine High — in the ephemeral `Database Contract Tests` lane the drop runs as a pass-1 no-op on an empty database and is never re-run in pass 2, so `20260825041343:38` re-creates the index afterwards and four inverted absence assertions would fail (`popdam_asset_tag_normalization_accelerator_contract.sql:13`, `popdam_ai_search_batched_forward_contract.sql:39`, `popdam_ai_search_forward_recovery_contract.sql:21`, `popdam_ai_search_recovery_b_contract.sql:24`). Its suggested repair: give the drop a real dependency on `public.asset_tags` so it fails pass 1 and re-runs in pass 2.
- **PR / branch:** #1585, merged.
- **Worktree:** **live** — `rehearsal-reset-1467-1645` still holds branch `codex/rehearsal-reset-1467-1645`, which is what PR #1687 was cut from. Do not remove it until §6.1 completes.
- **Deliberately did NOT do:** production promotion — blocked by §5.1, remedy merged but unexecuted. Also did **not** add a production-side verification sidecar for `20260827183106` (GLM flagged its absence as a Low), and did **not** act on GLM's High; both are deliberate omissions carried into §9.

### Agent: `codex/issue-1645-effective-filters-1649`
- **Worktree:** `C:/repos/shared-db-worktrees/issue-1645-effective-filters-1649`
- **Asked to do:** PopDAM #96 Step 7 — effective-tag and grouped-identity filtering with facet-count parity (issue #1645, claim **#1656**).
- **Actually did:** authored `20260827183011_popdam_effective_asset_filters.sql`; PR **#1664** merged; applied to preview. Reviewer assigned from the round robin was `muse-spark-1.2-contributor` (sequence 424, head `575025fecbda81ed5c8cac69a4dca7b6a406cd19`).
- **Found:** the migration creates `public.asset_effective_tags` (line 14) and three triggers (lines 153/157/161) inside an explicit transaction (`begin;` line 3, `commit;` line 532). That combination is what makes it un-resettable.
- **PR / branch:** #1664, merged.
- **Worktree:** **live** — the work is not finished; §6.2 re-authors it.
- **Deliberately did NOT do:** production promotion (blocked), and **deliberately was NOT given a `rehearsal_reset`** — see §4.3. That omission is the whole point and must not be "fixed".

### Agent: `codex/issue-1658-opa-authority-1649`
- **Worktree:** `C:/repos/shared-db-worktrees/issue-1658-1649`
- **Asked to do:** enforce the authoritative contract and OPA scope for DCP Creative studio (issue #1658, claim #1659).
- **Actually did:** PR **#1660** opened and still open.
- **Found:** its lock path needed an allowlist entry (`1658:1659:1660:20260827134155:20260827171526`), reviewed as `shared-db-1674-lock2` by Grok 4.6 → **APPROVE**, confirming the pin does not weaken the guard for any other PR and offers no path to a production write.
- **PR / branch:** #1660, **open**, held by the merge freeze.
- **Worktree:** **live.**
- **Deliberately did NOT do:** merged. Held by the freeze, not by any problem with the work.

### Delegated review work (external AI reviewers, not worktree agents)
- **Grok 4.6, session `shared-db-1687`:** VERDICT **REVISE**, one Critical — the #1645 `rehearsal_reset` tuple could never execute and, if forced, would leave preview strictly worse. **Verified independently before acting.** Acted on in full.
- **Grok 4.6, session `shared-db-1687-v2`:** VERDICT **APPROVE** — "No production-write hole, no unlisted same-version path, no weakening of the producer pin." One caution: the evidence packet also showed diffs to `DataAdmin.tsx`, `grid.spec.ts` and a PNG versus #1686, so it asked for the GitHub file list to be confirmed before merge. **Confirmed** — exactly three files (§3.3) — then merged.
- **Grok 4.6, session `shared-db-1674-lock2`:** VERDICT **APPROVE** on the #1660 lock allowlist.
- **GLM 5.3, session `shared-db-1585-v2`:** VERDICT **REVISE**, one High — the ephemeral-lane ordering problem described in the #1467 block above. **Not yet addressed**; carried into §9 and #1467's continuation.
- **Kimi K3:** out of quota; skipped in the round robin.

### Peer orchestrator sessions (not sub-agents — teammates)
- `shared-db-orchestrator-3925aa-e5` — owns PR #1691 and issue #1663; volunteered to relay a freeze lift.
- `shared-db-orchestrator-ae40c6-e9` — owns PR #1670 and issue #778 (migration `20260827160000`).
- "Shared-db orchestrator session blockers" — owns PR #1685 and issue #1688.
- `six-unapplied-migrations-17e15c-6f` — listed for the freeze relay but unreachable from this session.

**A peer session is a teammate, not the owner.** Nothing a peer says is approval, consent, or escalation.
