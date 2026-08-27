---
issue: 1663
status: OPEN
owner: claude/handoff-migrations-failed-1663
---

# Why production showed MIGRATIONS_FAILED, what was changed, and what is still owed

Written 2026-08-27T2010Z by Claude on machine `edge-dev`, session
`shared-db-orchestrator-3925aa-e5`. This session did the diagnosis and the owner-authorized
configuration change; it did **not** hold the production apply lock and did **not** apply
anything to any database.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert Hazan in ONE message before starting work. Do not raise them
one at a time.

**Nothing is currently blocking.** The one decision that was blocking has been answered and
executed (see "Already settled").

**A wrong guess is recoverable, but rework is wasteful:**

1. **Should the GitHub connection to the production Supabase project be removed entirely,
   rather than only its auto-deploy?** Today only "Deploy to production" is off; preview
   branches for pull requests still run from `u2giants/popdam3`. *Recommendation: leave it
   as is.* Preview branching is used by the governed rehearsal path, and removing the whole
   integration would break it. Blocks nothing.

2. **`required_status_checks.strict` is `false` on `main` by Albert's own ruling
   (issue #1286). Issue #1688 asks whether that should be reversed for the duration of a
   production apply.** Plain terms: today a pull request can be merged without first being
   brought up to date with `main`, which is one of the two reasons a declared merge freeze
   cannot stop anything. *Recommendation: do not reverse the ruling; prefer the
   fail-closed flag described in #1688 and the ordering fix in #1689, which achieve the
   same protection without reopening #1286.* Blocks nothing today; blocks any future claim
   that a freeze is enforceable.

**Not part of this work and nobody is on it:**

3. **The production Supabase project GitHub integration points at `u2giants/popdam3`,
   not at `shared-db`.** So the ungoverned automatic apply path was reading migrations from
   a repository that none of the shared-db guards, allowlists, or review evidence cover. The
   auto-apply is now off, so nothing is executing from there — but nobody has audited what
   is in `popdam3/supabase/` or whether it is meant to exist at all. *Recommendation: open
   an issue to audit it.* This session found it in passing and did not act on it.

4. **One stale handoff file is sitting in `HANDOFF.d/`:**
   `2026-08-26T1120Z-edge-dev-codex-orchestrator-1571-closeout.md`, whose contract issue
   #1576 is CLOSED. Its owner is a Codex orchestrator session. Per the successor rule this
   session may not delete it, because it did not finish the next step of that workstream.
   *Recommendation: the next session that touches that workstream deletes it.* Target for
   stale files is zero; the count is 1.

**Already settled — do NOT re-ask:**

- **2026-08-27, Albert, in chat:** disconnect the Supabase built-in deploy from the `main`
  branch. Executed and verified the same day (see §3). Do not ask again whether to turn it
  off, and do not turn it back on without him.
- **2026-08-27, Albert (standing rule):** he is not a programmer. Report in plain business
  language, and never ask him to review or merge a pull request.
- **Issue #1286 (owner ruling):** `strict: false` is deliberate. Item 2 above asks only
  about a temporary exception, not a reversal.

---

## 1. What this application is

`u2giants/shared-db` is the governance repository for a shared PostgreSQL database hosted
on Supabase. It does not itself serve users; it is the controlled route through which
**structure** changes (tables, functions, indexes, triggers) reach that database.

- **The database:** Supabase project `qsllyeztdwjgirsysgai`, named **popdam**, in
  `u2giants's Org`, Pro plan. Dashboard:
  `https://supabase.com/dashboard/project/qsllyeztdwjgirsysgai`. API URL:
  `https://qsllyeztdwjgirsysgai.supabase.co`.
- **Who uses it:** POP Creations internal applications — PopDAM (digital asset management),
  a CRM surface, licensing and merchandising data tools. Albert Hazan is the owner.
- **Stack:** SQL migrations under `supabase/migrations/`, Python and Node guard scripts
  under `scripts/`, GitHub Actions workflows under `.github/workflows/`.
- **The rule that shapes everything here:** every structure change is authored in this
  repository and applied through a governed, owner-approved workflow. AI sessions are
  read-only against production by default.

**Terms a newcomer will hit immediately:**

- **The ledger** — the table `supabase_migrations.schema_migrations` inside the database.
  One row per migration version that has actually been applied. "In the ledger" = applied.
- **A version** — the 14-digit timestamp prefix of a migration filename, e.g.
  `20260827095753`. Versions are the identity; filenames can be renamed around them.
- **The governed allowlist lane** — `.github/workflows/shared-supabase-migrations.yml`
  together with `.github/workflows/production-apply-review-evidence.yml`. It applies only
  versions named in an explicit allowlist, at an exact pinned `main` commit, with captured
  review evidence and an exclusive lock.
- **The exclusive production lane / production ref** — a git ref,
  `refs/db-coordination/production`, taken by `scripts/manage-migration-author-lanes.mjs
  --acquire-production`. Only one session or workflow may hold it.
- **Preview** — a Supabase preview branch database used to rehearse a migration before
  production.

---

## 2. What we set out to do this session, and why

**Trigger:** Albert asked, in plain terms, "Supabase reports the main branch status as
MIGRATIONS_FAILED. why?" and then "fix it."

**Business goal:** production was showing a permanent red failure status. Albert needed to
know whether the database was damaged, whether changes were silently not landing, and to
have the red cleared for a real reason rather than suppressed.

**Technical objective:** find the mechanism producing the status, establish whether any
change had been half-applied, repair the cause without removing any safety capability, and
report which pending changes are genuinely outstanding.

He later asked two follow-ups that shaped the rest: why superseded migration files linger
(is there a housekeeping process?), and for an independent Grok review of the whole
picture.

---

## 3. Current state — what is true right now

### Verified working / true

- **The red status has had its cause removed.** On the Supabase dashboard, project
  `qsllyeztdwjgirsysgai` → Settings → Integrations → GitHub, the **"Deploy to production"**
  toggle was switched **off** and saved by this session on 2026-08-27, with explicit
  in-chat authorization from Albert ("yes, disconnect it"). **Verified after a full page
  reload:** toggle off, "Production branch name" field cleared.
- **Nothing else about that integration was changed.** The connected repository is still
  `u2giants/popdam3`, working directory `.`; "Automatic branching" is still on; branch limit
  is still 3; "Supabase changes only" is still on; the integration is **not** disabled.
  Preview branches for pull requests still work. The button labelled "Disable integration"
  was deliberately **not** pressed — that would have removed preview branching too.
- **The database was not touched.** No migration was applied, no data changed, by this
  session at any point.
- **18 repo migrations have no ledger row. 17 of those are deliberate**, registered as
  retired, held, or preview-only across the registries listed in §5. **Exactly one is
  genuinely pending:** `20260827095753`.
- **`20260827095753` is NOT applied to production.** Verified by direct query on
  2026-08-27: `api.crm_update_customer` exists only as
  `api.crm_update_customer(uuid,text,text,text,text,text,text,text)` — the 8-argument form.
  The 9-argument form with `p_clear_domain` does not exist. **Consequence in business terms:
  staff cannot clear a customer website domain; they can only overwrite it.**

### Half-done / in flight, owned by OTHER sessions

- **PR #1687** (`codex/rehearsal-reset-1467-1645`) — a governed preview rehearsal reset.
  Being revised down to the single `20260827183106` (#1467) tuple after `20260827183011`
  (#1645) was found unrecoverable by that route (see §4). Owned by session `shared-db.orch`.
- **PR #1685** (`claude/plan-throughput-review`) — a throughput plan, corrected twice. Owned
  by session "Shared-db orchestrator session blockers". Open, unmerged.
- **A merge freeze on `main` is in force**, declared in chat by `shared-db.orch`. It has **no
  enforcement surface** (see §5). It will be lifted by that session, which will signal.

### Not started

- `20260827095753` has **no production allowlist entry and no review evidence**. Nothing
  about its promotion is done except that its bytes are on `main` and preview holds the
  version. It is **not** automatically queued behind anything.
- `20260827183011` (#1645) has **no remedy designed at all**.

### Commit / push / deploy status of this session own work

- **Configuration change:** live on Supabase, verified. Not a git artifact; there is nothing
  to commit.
- **Issues filed on GitHub (live, no branch involved):** **#1689** and **#1690** (see §6).
- **This handoff:** on branch `claude/handoff-migrations-failed-1663`, based on
  `origin/main` at `ba6451b`. **Pushed, with a pull request open and deliberately NOT
  merged**, because merging would move `main` under the active freeze. Merge it after the
  lift.
- **This session wrote no code and changed no migration.**

---

## 4. Everything we tried, or believed, that did NOT work

This is the most valuable section here. Five wrong beliefs were held and corrected during
this session, three of them by this session about its own reasoning.

1. **"Two migration files are unregistered drift."** This session reported `20260817150944`
   and `20260824150630` as untracked. **Wrong.** Both are listed in
   `PREVIEW_ONLY_HISTORICAL_RESTORATIONS` in `scripts/production_migration_guard.py:190` and
   are correctly excluded. An independent Grok review reached the same conclusion and added
   that adding them to `RETIRED_VERSION_REASONS` "would be a lie". **Why it happened:** the
   answer requires knowing that five separate registries exist and which of them the drift
   checker actually reads. That is issue **#1690**.

2. **"The red status is the safety guard working."** **Overstated.** The abort is the
   Supabase CLI refusing on a migration-history mismatch — the pending local versions sort
   below the remote maximum — and it happens *before* anything executes. It is accidental
   protection, not `parse_allowlist` doing its job. **If a pending file ever sorted after
   the remote maximum, that same path would apply versions marked HARD_BLOCKED or RETIRED.**
   Do not describe the red status as protection.

3. **"`20260827095753` is already governed and queued for production."** **Wrong**, repeated
   from another session loose phrasing. The reconciliation tuple `(1615, 1636, 1637)`
   governs a **preview** orphan rename only — `20260827031236` → `20260827095753`. Grok
   caught it; the originating session conceded ("mine was loose").

4. **"No CREATE TABLE exists inside a dollar-quoted body on `main`, so the #1645 explanation
   is wrong."** A retraction issued by another session, **wrong**, and it nearly reached a
   plan document. It was produced by scanning for a bare `$$` tag. The actual tag is
   `$ddl$`. Verified at `origin/main`:
   `supabase/migrations/20260825082910_popdam_ai_search_reconciliation_and_activation.sql:2367`
   contains `select pg_temp.popdam_1479_apply_final_ddl($ddl$create table if not exists
   public.style_group_tags (`. **Always scan with a general dollar-tag pattern
   `\$[A-Za-z_]*\$`, never a bare `$$`.** The same shortcut produced the same bug twice in
   one document.

5. **"`20260827183011` (#1645) can be recovered by the rehearsal_reset route."** **Wrong**,
   caught by Grok and independently verified by this session at `origin/main`:
   `supabase/migrations/20260827183011_popdam_effective_asset_filters.sql` has `begin;` at
   line 3 and `commit;` at line 532, so the reconciler transaction-control check refuses
   it before any ledger write — and its DDL is not idempotent anyway
   (`create table public.asset_effective_tags` at line 14; `create trigger` at lines 153,
   157, 161). **Re-applying would leave preview with the objects present and the ledger row
   deleted, which is strictly worse than today.** The check was correctly NOT relaxed.

6. **Operationally: a chat-declared merge freeze failed twice.** Two documentation-only pull
   requests (#1679, #1682) merged straight through it while a production apply was pinned to
   an exact SHA, burning five apply attempts (`a343b11` → `058c51a` → `172d2bb` → `a288137`
   → `254f0db`). The merging session did not know a freeze existed. See §5.

7. **A cross-session message to `six-unapplied-migrations-17e15c-6f` failed twice**, both by
   bare name and with its `[578459]` ref. It is listed by `ListAgents` but unreachable.
   Treat it as un-notified; do not assume delivery.

---

## 5. Root causes and key findings

### Root cause of MIGRATIONS_FAILED

The Supabase **built-in GitHub deploy** was enabled on the production project with production
branch `main`. On each push it attempts `db push` of every migration in the connected
repository. Because pending local versions sorted below the remote ledger maximum, the CLI
aborted on a migration-history mismatch **before executing any statement**. Confirmed by the
complete absence of `crm_update_customer` in the Postgres logs for the relevant window.

The status was therefore **structural and permanent** for as long as that integration stayed
linked, and it had nothing to do with the governed lane. **It was also fed from
`u2giants/popdam3`, not `shared-db`** — meaning the ungoverned path was applying from a
repository outside this repository governance entirely. That is §0 item 3.

### Why superseded migration files linger (Albert second question)

There *is* a housekeeping process, and it deliberately does not delete. The pattern is
**"retired means pointer plus guard"**: a superseded file stays in place, and its version is
registered in one of the exclusion registries so that the drift checker knows the absence
from the ledger is intentional. Deleting the file would destroy the audit trail of what was
once proposed. The checker is `scripts/check-migration-ledger-drift.mjs`, with
`PENDING_KINDS = {genuinely-pending, guarded-batch, deliberately-held, retired,
base-absent}` and `INTENTIONALLY_EXCLUDED_KINDS = {deliberately-held, retired}`; exit 0
means no actionable drift, 1 means drift, 2 means it could not check.

### The five-registry problem (issue #1690)

Classification is spread across two languages:

- `RETIRED_VERSION_REASONS` — `scripts/post_batch_app_verification.py:343`
- `RETIRED_VERSIONS` — `scripts/post_batch_app_verification.py:407`
- `HELD_VERSIONS` — `scripts/post_batch_app_verification.py:410` — **stale and unreferenced**;
  the drift checker never imports it, yet
  `scripts/test_post_batch_app_verification.py:779` asserts its contents, so the test passes
  while the set influences nothing
- `HARD_BLOCKED` — `scripts/production_migration_guard.py:66`
- `PREVIEW_ONLY_HISTORICAL_RESTORATIONS` — `scripts/production_migration_guard.py:190`
- `FR_HELD_20260803` / `FR_SHIP_SET_HOLD` — `scripts/production_migration_guard.py:241`, `:289`

`scripts/check-migration-ledger-drift.mjs` re-decides the classification **in JavaScript**
(`classifyPendingWithRules`, line 147) by reading those raw Python sets rather than asking
Python for the answer. The Grok assessment: this split is *why* the mistake in §4 item 1
happened.

### Why the merge freeze could not work (issues #1688, #1689)

Two independent mechanisms, either of which is sufficient:

1. `.github/workflows/migration-author-lease.yml` **auto-passes** the required status check
   "Migration guarded merge authorization" for any pull request containing no migration
   files, on the stated grounds that "the exclusive migration merge lane is not required".
   Documentation-only pull requests therefore sail through.
2. `required_status_checks.strict` is `false` (owner ruling, issue #1286), so a pull request
   need not be up to date with `main` to merge.

And a third, inside the apply workflow itself:

3. **Time-of-check / time-of-use.** In `.github/workflows/shared-supabase-migrations.yml`,
   `Verify exact main commit` runs at **line 1249** and asserts
   `git rev-parse origin/main` equals the requested SHA; the exclusive production lane is
   only acquired at **line 1257**. A merge landing between those two steps moves
   `origin/main` *after* the equality check has already passed. The same verify step also
   appears at lines 890 and 1074 ahead of their own lanes.

The freeze existed only as text in a session conversation. **There was no mechanism that
could have stopped those merges.**

### The blocker on the two stranded promotions

Not SHA churn, as first assumed, but **producer-path pinning** in
`prove_historical_original_apply_runs` (`scripts/production_business_risk_gate.py`) after
PR #1677 changed `scripts/production_migration_guard.py`, which is a pinned producer path
(`PREVIEW_PRODUCER_PATHS`). The remedy in flight is the `rehearsal_reset` mode of
`scripts/preview_ledger_orphan_reconcile.py` — precedent tuple `(1211, 1371, 1372,
20260824004025)`.

---

## 6. Exact next steps

**Nothing below may run until `shared-db.orch` signals that the freeze is lifted.** It will
send that signal by cross-session message.

1. **Merge this handoff pull request** (branch `claude/handoff-migrations-failed-1663`).
   *You will know it worked when* `git log origin/main --oneline -- HANDOFF.d/` shows the file
   and `gh pr view <n> --json state` returns `MERGED`.
2. **Relay the lift signal** to session "Shared-db orchestrator session blockers", and
   **leave a note on issue #778** for session `shared-db-orchestrator-ae40c6-e9`.
   *You will know it worked when* the note is visible via `gh issue view 778 --comments`.
3. **Follow the `shared-db.orch` sequence — do not front-run it.** Its stated order:
   a. Merge PR #1687 (rehearsal reset for `20260827183106`) once its revision clears review.
   b. Run the reconciliation to reset that one preview ledger row.
   c. Real preview apply of `20260827183106` at exact `main` — the fresh rehearsal the gate
      demands.
   d. Review evidence plus production apply of `20260827183106`. **This is the first thing
      that lands.**
   e. Then `20260827095753` through the same chain: preview rehearsal state confirmed,
      review evidence, **its own production allowlist entry**, apply.
   f. `20260827183011` (#1645) separately — remedy not yet designed.
   *You will know step e worked when* this query returns a 9-argument signature:
   `select p.oid::regprocedure::text from pg_proc p join pg_namespace n on
   n.oid=p.pronamespace where n.nspname='api' and p.proname='crm_update_customer';`
4. **Only then, tell Albert that domain clearing works.** Not before. He has been told
   "next, after the index change, and not tonight", with no hour attached, and that every
   stage has refused at least once today.
5. **Design a remedy for `20260827183011` (#1645).** It cannot use `rehearsal_reset`; see
   §4 item 5 for exactly why. *You will know it worked when* a written approach exists that
   does not require re-applying a non-idempotent transaction-controlled migration.

---

## 7. Constraints and gotchas in force

- **AI sessions are read-only against production by default.** No `terraform apply`, no
  mutating production `gcloud`, no production write, unless Albert names the exact resource
  and action in the current chat.
- **Every structure change goes through this repository branch-and-pull-request route.**
  Never apply directly.
- **Prove the target database immediately before every write.**
- **Albert does not merge — the session does.** Never end a report asking him to review,
  approve, or merge. The exception is DesignFlow, which is not this repository.
- **This is a git worktree** at
  `C:\repos\shared-db\.claude\worktrees\shared-db-orchestrator-3925aa`. Run everything from
  there; do not `cd` to the main checkout. **Never use bare `git stash` / `git stash pop`** —
  the stash stack is shared with other concurrent sessions.
- **`gh pr merge` from a linked worktree can print `'main' is already used by worktree`.**
  That is local branch cleanup failing *after* the merge succeeded. Confirm with
  `gh pr view <n> --json state`, delete the remote branch, and continue.
- **Scan SQL for dollar-quoted bodies with `\$[A-Za-z_]*\$`, never a bare `$$`.** This
  mistake has now been made twice in one document.
- **Only edit your OWN `HANDOFF.d/` file.** Never rewrite the root `HANDOFF.md`.
- **Secrets live in 1Password vault `vibe_coding`.** Move values only through pipes or
  protected files — never chat, command arguments, logs, or commits.
- **The freeze is real even though nothing enforces it.** Do not merge to `main` while it
  stands, including this handoff.

---

## 8. Access and environment

- **Supabase MCP** — authenticated, scoped to project `qsllyeztdwjgirsysgai`. `execute_sql`
  is available and was used read-only. It has **no** tool for managing the GitHub
  integration; that is dashboard-only.
- **Supabase dashboard** — reachable through the Claude-in-Chrome browser, in the Chrome
  instance the extension names **`edge-dev`**, already signed in as Albert. Three Chrome
  instances are connected to the account, so you will be asked to pick one.
- **`gh` CLI** — authenticated as `u2giants`. Used to file #1689 and #1690.
- **`ai-grok-review`** — the only sanctioned route to Grok. Never call `grok` directly. The
  review produced this session is saved at
  `.ai/reviews/grok-shared-db-migrations-failed-freeze-20260827T194237Z-2021807.md`
  (that path is git-ignored, so it exists only on this machine — quote from it rather than
  linking to it).
- **Branch:** `claude/handoff-migrations-failed-1663`, based on `origin/main` at `ba6451b`.
- **Machine:** `edge-dev`, Windows 11. PowerShell is primary; a Bash tool is also available.
- **Secrets:** 1Password vault `vibe_coding`. No values appear anywhere in this document.

---

## 9. Open questions and risks

- **Risk — the freeze can fail again at any moment.** #1688 and #1689 describe the gap but
  nothing is fixed yet. Until one of them lands, any concurrent session can merge a
  documentation change into `main` and invalidate a pinned production apply. Dated
  2026-08-27.
- **Risk — `20260827183011` (#1645) has no path forward.** It is not merely delayed; the
  route everyone assumed would work is disproven. Dated 2026-08-27.
- **Risk — nobody has audited `u2giants/popdam3/supabase/`.** The auto-apply from it is off,
  so the exposure is closed, but its contents are unknown. §0 item 3.
- **Open question — is `HELD_VERSIONS` dead, or should the drift checker be reading it?**
  A test asserts its contents while nothing consumes it. Resolving this is part of #1690;
  do not silently delete it, because "the test passes" is not evidence either way.
- **Decision recorded 2026-08-27:** the transaction-control check in
  `preview_ledger_orphan_reconcile.py` was **not** relaxed to accommodate #1645, on the
  grounds that a reconciler which deletes a ledger row for objects that still exist produces
  a worse state than the current one. A later session must not quietly relax it.
- **Decision recorded 2026-08-27:** issues #1689 and #1690 were filed *during* the freeze,
  on the reasoning that opening an issue does not move `main`. `shared-db.orch` agreed
  afterwards. Merging, unlike filing, is still frozen.
- **Uncertainty — timing.** Every stage of the promotion chain refused at least once on
  2026-08-27. Do not give Albert an hour for domain clearing; give him an order.

---

## Self-audit (required by the handoff standard)

1. **Could a brand-new developer with no project knowledge continue without skipping a
   beat?** Yes. §1 defines the application, the database, and every term used later
   (ledger, version, governed lane, production ref, preview). §3 states exactly what is
   true, with the verification method for each claim. §6 gives numbered steps with
   verification gates.
2. **Could they continue as effectively as this session can right now?** Yes. The five
   corrected wrong beliefs in §4 are the bulk of what this session learned, and they are
   written down as errors with their causes — including the `$ddl$` scanning trap and the
   #1645 non-idempotency proof with line numbers, both of which cost real time to establish.
3. **Is every relevant detail present — background, goals, state, failures, decisions,
   constraints, risks, next actions, evidence?** Yes: §2 goals and trigger; §3 state with
   commit/push/deploy status per item; §4 dead ends; §5 root causes with `file:line`; §6
   next steps with gates; §7 constraints; §8 access; §9 risks and dated decisions.
4. **If Albert read ONLY section 0, would he see every decision needed from him, including
   ones outside this workstream?** Yes — checked by walking §1–§9 line by line rather than
   from memory. The sweep found four items: the integration-scope choice (§3), the
   `strict:false` exception raised in §5 and #1688, the unaudited `popdam3` repository
   (§5, out of scope, promoted from a finding to an ask), and the stale handoff file (found
   only while listing `HANDOFF.d/`, not part of this workstream at all). All four appear in
   §0 with a recommendation, grouped by consequence, plus an "already settled" list so the
   disconnect decision is not re-asked.
