# Promoting to production when a backlog exists

> **This was `AGENTS.md` §5.1 until 2026-08-20.** Moved because `AGENTS.md` had reached 229 KB
> against its own 80 KB ceiling (issue #1331). Text below is unchanged, and `AGENTS.md §5.1`
> still points here.

### 5.1 Promoting to production when a backlog exists — NEVER `--include-all` on the full repo set, ALWAYS inside the pruned temp checkout (learned 2026-07-23; recipe corrected 2026-07-27; wording made self-consistent 2026-08-09)

> ✅ **The #611 gate is DISCHARGED — corrected 2026-08-12.** It **RAN** on 2026-08-10 against
> `main` tip `bc29d36` on the pinned **Supabase CLI 2.105.0**
> ([`scripts/experiment_611_db_push_atomicity.sh`](scripts/experiment_611_db_push_atomicity.sh);
> full result in
> [`docs/verification/issue-611-db-push-atomicity-20260810.md`](docs/verification/issue-611-db-push-atomicity-20260810.md)).
> **Licensor batches are no longer blocked by #611.** This block previously still read *"no
> licensor batch may go until … has been RUN"*, directly contradicting §5.1-A two hundred lines
> below, which has recorded the gate as discharged since 2026-08-10. A reader following the old
> wording would have blocked a promotion that is in fact cleared.
>
> ⚠️ **The gate REOPENS on any Supabase CLI version bump** — the result is pinned to **2.105.0**.
> If you are not on 2.105.0, re-run the script and re-record before promoting. **Read §5.1-A in
> full before you promote anything**: everything else it says still binds, in particular that
> `db push` is atomic **per FILE, not per batch**, and that **"PREFLIGHT OK" is not an approval**.

Production almost always has **pending migrations from other workstreams that sit *before* your
own** (e.g. DB Data Admin write paths, DAM taxonomy cutover, PopSG — several deliberately
unpromoted). When that is true, `supabase db push` **refuses to run** and suggests
`--include-all`.

**The rule has two halves, and they are not in conflict — read both before you run anything:**

- **Forbidden:** `--include-all` against the **full repo set** in `$GITHUB_WORKSPACE` (or any
  checkout that still contains other workstreams' pending files). There it promotes *every* pending
  migration at once, including work another team has deliberately kept off production.
- **Required:** `--include-all` **inside the pruned bounded temp checkout** built in step 2 below,
  once the dry run has confirmed the file list. There the migrations you must not promote are no
  longer on disk, so the flag cannot reach them, and without it the push will not finish.

What decides it is **which set of files is on disk**, never the flag itself.

Apply **only your own** migration with a bounded temp checkout:

1. `git worktree add --detach <tmp> origin/main`
2. In the temp checkout, delete **only the PENDING migration files you are not promoting**
   (repo copy is untouched — you only shrink the local set the CLI compares).
   **Do NOT delete the already-applied files.** The CLI compares the local folder against
   *every* `schema_migrations` row, so removing applied files makes `db push` abort with
   `Remote migration versions not found in local migrations directory` and suggest
   `supabase migration repair --status reverted …` — do **not** run that repair; restore the
   files instead (`git checkout -- supabase/migrations`, then delete just the pending ones).
   *(Corrected 2026-07-27 — "delete everything except your own file" does not work.)*
3. `supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"`
4. `supabase db push --dry-run` → **confirm it lists only your migrations**.
   If your file sorts *before* the remote max, the dry run says "Found local migration files to
   be inserted before the last migration on remote database" and asks for `--include-all`.
   **In this bounded temp checkout that flag is the correct and safe way to finish** — the
   migrations you must not promote are no longer on disk, so it cannot reach them. Run
   `supabase db push --include-all --dry-run` first and confirm it names **exactly** your files,
   then drop `--dry-run`. The §5.1 prohibition is on `--include-all` against the **full repo
   set**, never against a verified bounded set.
5. Verify the real objects in the DB (`pg_constraint`/`pg_trigger`/`pg_get_viewdef`), **not** just
   `supabase_migrations.schema_migrations` — the ledger can record a migration whose object is
   absent (seen on preview 2026-07-23).
6. Remove the temp worktree.

Two traps: (a) "pending" is **not** "filename version > remote max" — production had gaps far
below its highest version; diff the full local file list against every `schema_migrations` row.
(b) This shared working copy is actively churned by other sessions — its branch and untracked
files shift between turns; do sensitive git work (branch off `origin/main`, apply) in a dedicated
`git worktree`, not the main checkout.

A third habit worth breaking: **promote the original file — do not hand-copy it into a new
"bounded forward" migration.** Copying the SQL under a fresh timestamp does reach production,
but the original stays pending forever and hundreds of lines get duplicated. Two sessions did
this in July 2026 (`20260723183000_step11_bounded_production_forward.sql`,
`20260727154500_db_data_admin_bounded_production_forward.sql`), which is why three already-live
migrations still had to be replayed as no-ops on 2026-07-27 just to close the ledger gap. Full
worked example, including the verification queries:
[`docs/migration-backlog-triage-2026-07-27.md`](docs/migration-backlog-triage-2026-07-27.md).

#### 5.1-A The lane is now RUNNABLE — how a production apply actually happens (built 2026-08-10, issue #617/#660)

**Everything in §5.1 above still describes the mechanics.** What changed is that you no longer
perform them by hand. The workflow
[`.github/workflows/shared-supabase-migrations.yml`](.github/workflows/shared-supabase-migrations.yml)
now has an `apply` mode that does the whole bounded-temp-checkout recipe for you, under gates.
Before 2026-08-10 that job opened with a step called `Refuse production apply`, so the lane could
never run at all — which is why four licensor features queued up behind it.

**To promote, dispatch the workflow with:** `target: production`, `mode: apply`, the exact
`origin/main` SHA, the comma-separated allowlist, `confirmation: APPLY <sha>`, and
the successful review-evidence workflow run ID plus its `sha256:` artifact digest (see gate 2).
A wrong confirmation string fails on the first step, before any credential is used.

**Three gates, and NONE of them is sufficient alone:**

1. **`production-apply-review`** — deterministic. The typed string, the exact SHA, and the whole
   guard chain (`parse_allowlist` → hard blocks, the §6.8 all-four bundle, the §6.5 hold, the
   co-presence rules → `validate_candidates` → whole-batch preflight). This job fails the run.
2. **IMMUTABLE REVIEW EVIDENCE.** Dispatch the non-writing
   `production-apply-review-evidence.yml` workflow with the exact current 40-character main SHA,
   exact ordered allowlist, and verdict. GitHub records the authenticated reviewer actor and
   uploads strict canonical JSON. Only `APPROVE` succeeds. The apply dispatch must pin that run by
   its decimal run ID and canonical `sha256:` artifact digest. The verifier rejects URLs, paths,
   stale or failed runs, another repository/workflow/SHA, altered or expired artifacts, unknown
   JSON fields, a non-APPROVE verdict, a different actor, and any missing, duplicate, reordered,
   subset or superset allowlist. It runs both before and after the environment wait. Because
   GitHub artifacts expire, the second check copies the verified JSON into the final apply
   evidence. This contract is provider- and model-neutral. Never add a provider or model name.
3. **`environment: production`.** Keep this binding. It remains the deployment boundary even
   after its separate manual-reviewer rule is removed.

**OWNER RULING, 2026-08-12:** permanently remove Albert's required-reviewer click only after this
repo-side evidence gate merges and passes CI/read-only proof. Albert does not review code, so the
click adds no technical safety. Removing it is not permission to weaken any exact-SHA,
confirmation, dependency, preview, fresh-ledger, bounded-checkout, dry-run, apply, post-ledger,
catalog-verification, or artifact gate. The GitHub environment change is a separate phase and is
not made by this repository patch.

**Issue #646, also fixed here:** `production-dry-run` is **off** the `production` environment.
It used to sit on it, so Albert was asked to approve every practice run — and a gate that fires
on harmless events trains its holder to click approve without reading, which is the last habit
you want on the one run that writes. The dry-run job is now read-only (`link`,
`migration list`, `db push --dry-run`) and ungated. **If you ever add a mutating command to it,
put the environment back first.**

**Customer #1 is a canary, not a licensor feature.** `20260810140000_production_lane_canary.sql`
creates one table, inserts one row, and is read by nothing. It goes through the lane first so a
lane failure can never be confused with a migration failure. This lane has already produced two
failures that looked like migration faults and were neither — both lexer bugs in
`scripts/production_migration_guard.py` (`$$` inside a comment, then prose inside a string
literal). Do not send Disney, Paramount, NBCU or Warner through untested write machinery.

> ## ⚠️ A MIGRATION CAN BE MERGED, CORRECT, REHEARSED — AND STILL UNPROMOTABLE FOREVER
>
> **Learned the expensive way on 2026-08-25 (issue #679). Two migrations died of this in one
> afternoon.** The production business-risk gate byte-binds a rehearsal to the run that actually
> applied the bytes (`prove_historical_original_apply_runs`). That run's commits must belong to
> the authoring pull request or to exact `main`'s history. **A squash merge deletes the branch
> commit**, so a pre-merge preview rehearsal can end up bound to a commit that exists nowhere in
> `main` — and the gate refuses it. Refusal wording:
>
>     preview run commit <sha> is not contained in the history of exact main (compare status 'diverged')
>     original apply run <id> dispatched at <sha> produced evidence with a different
>     .github/workflows/shared-supabase-migrations.yml than the merge commit <sha> of the pull
>     request that authored <version>
>
> **There is no recovery.** Preview already has the version applied, and an applied version never
> re-applies there, so it can never acquire a qualifying rehearsal. The only route is a fresh
> version number carrying the same SQL, and hard-blocking the original — which is what
> `20260825124200` and `20260825130500` are.
>
> **So: rehearse from MERGED main (`merged_preview_source_pr`), not from the PR branch**, and
> when a rehearsal was pre-merge, expect to replace the version rather than argue with the gate.
> The gate is right — nobody ever ran those bytes under that change's own machinery.
>
> Two second-order traps this exposed, both real: replacing a version whose file ALSO rewrote a
> function means the replacement must NOT re-assert that function if a later migration already
> carries the repaired body (you would silently revert it — #1459's own trap, reintroduced by its
> fix); and `main` moves under you mid-promotion, invalidating the exact-SHA evidence (#1344), so
> pin the SHA and re-check it immediately before every dispatch.
>
> Related open work: #1200, #1321, #1344, #1391, #1436.

**Three limits you must not read past.**

- ⚠️ **"PREFLIGHT OK" IS NOT AN APPROVAL.** `strip_sql` removes dollar-quoted bodies on purpose
  (names inside a function body resolve at CALL time), which means a `do $$ … $$` block hides its
  apply-time references from the scanner completely. A batch whose real dependency lives inside a
  DO block passes preflight and still aborts on production. The preflight may REJECT; it can never
  certify. The authoritative gate is the rehearsal against a production-shaped database.
- ⚠️ **`db push` is atomic PER FILE, NOT per batch. Issue #611 was MEASURED, and the gate is
  DISCHARGED.** The experiment
  [`scripts/experiment_611_db_push_atomicity.sh`](scripts/experiment_611_db_push_atomicity.sh)
  RAN on the hetz VPS on 2026-08-10 against `main` tip `bc29d36`, on the pinned **Supabase CLI
  2.105.0**, with the tripwires `ledger rows seeded: 424` and `container TLS: on` both confirmed.
  Full result, both binary checksums, every Q1–Q6 block and the complete raw log:
  [`docs/verification/issue-611-db-push-atomicity-20260810.md`](docs/verification/issue-611-db-push-atomicity-20260810.md).
  **Licensor batches are no longer blocked by #611.**

  **What was FOUND — say it this way, and no wider:**
  - A migration's SQL and its `supabase_migrations.schema_migrations` row **are written in one
    transaction, per FILE.** Proven, not inferred: blocking the ledger insert with a `BEFORE
    INSERT` trigger took the file's perfectly valid SQL down with it (exception seen **t**, table
    absent **f**, ledger row absent **f**).
  - **The BATCH is NOT one transaction.** File A stayed applied **with its ledger row** after file
    B failed. **A 63-migration run that dies on file 40 leaves files 1–39 applied and ledgered. A
    mid-batch failure does NOT leave production unchanged.**
  - **The feared state did not appear.** Nothing produced SQL-applied-without-a-ledger-row.

  **The operational consequences — these are the point:**
  - **Promote in SMALL, BOUNDED batches.** The bigger the batch, the more of it is already
    committed and unrecoverable-as-listed after a mid-run failure.
  - **Expect the recovery path to be "the fix ALONE."** The applied files stay applied; the next
    allowlist contains only what still needs to run.
  - **The one-directional co-presence rules below, and the already-applied refusal in
    `validate_candidates` (`scripts/production_migration_guard.py`), are CORRECT AS WRITTEN. The
    experiment confirms the assumption they rest on. DO NOT SOFTEN THEM** and do not "tidy" the
    asymmetry away — the asymmetry is exactly what keeps "the fix alone" a legal recovery.

  **Scope — do not overstate this, which is why the gate existed.** The result is for **CLI
  2.105.0 only** and is **conditional on file contents**, not a universal law about `db push`. A
  CLI version bump **reopens #611**: re-run the script and re-record. During earlier review a
  reviewer asserted this answer by reasoning, was challenged, retracted, and dropped its own
  confidence from 85% to 30% — the answer above is measured, and only what was measured.

  **Why it mattered — the two bad outcomes it ruled out:**
  - *SQL without a ledger row:* a re-run replays the same SQL and dies on duplicate-object
    errors, and a `CREATE` can be left standing on production without the security migration
    that was supposed to follow it.
  - *Ledger row without SQL:* `validate_candidates` refuses that version forever (it rejects any
    allowlist containing an applied version), and preflight starts trusting objects that do not
    exist. Recovery requires manual ledger surgery on production.

- 🚫 **MIGRATION AUTHORS: `CREATE INDEX CONCURRENTLY` CANNOT BE PUSHED AT ALL.** The same
  experiment (Q4) found that CLI 2.105.0 sends a migration file down a **pipeline**, and
  PostgreSQL refuses `CREATE INDEX CONCURRENTLY` inside one:
  `ERROR: CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)`.
  The whole file rolls back cleanly — safe, but the migration **fails outright** and takes the
  rest of its batch with it. The same applies to anything else PostgreSQL refuses inside a
  transaction block or pipeline: `REINDEX … CONCURRENTLY`, `VACUUM`,
  `REFRESH MATERIALIZED VIEW … CONCURRENTLY`, `CREATE DATABASE`, `ALTER SYSTEM`. **Write a plain
  `CREATE INDEX`.** If a concurrent build is genuinely required for a large table, it must be run
  as a deliberate out-of-band operation, never as a migration file.
  **Scan result, 2026-08-10 at `bc29d36`:** all **424** migrations were searched
  case-insensitively (multi-line tolerant) — **ZERO hits**, including **zero in the 63-migration
  production backlog `20260724060000` → `20260810140000`**. The promotion plan is unaffected. The
  only matches for the word "concurrently" are prose inside two error messages
  (`20260802140000_acknowledge_taxonomy_sync_alert_rpc.sql`,
  `20260802150000_taxonomy_alert_actor_heuristic_word_anchors.sql`). That is a point-in-time
  result; this bullet is a standing constraint on new migrations.

**The co-presence rules are ONE-DIRECTIONAL, and that is not an oversight.** Three security
pairings are enforced in `parse_allowlist`: `20260810020000` requires `20260810090000` (between
them `service_role` holds TRUNCATE on 23 tables, and TRUNCATE does not fire row-level triggers);
`20260810070000` requires `20260810080000`; `20260810030000` requires both `20260810110000` and
`20260810120000`. **The reverse is deliberately NOT enforced.** `validate_candidates` refuses any
allowlist containing an already-applied version, so if a run dies between a create and its fix,
the fix ALONE is the only legal recovery allowlist. A symmetric rule would refuse that recovery
and force an operator to edit the safety guard under pressure while production sits exposed.
Do not "tidy" it into symmetry.
