---
issue: 1681
status: OPEN
owner: claude/age-group-c2-handoff
---

# HANDOFF — `age_group` Cloud SQL → Supabase cutover, steps C2/C3 (2026-08-27 ~17:30Z, edge-dev/claude)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in ONE message before starting work.

**BLOCKING**
- **Nothing blocking Albert.** C2 is blocked on a *reviewer* for
  https://github.com/popcre/designflow-backend/pull/75, not on an owner decision. DesignFlow policy
  forbids self-merge. Recommendation: route it to an AI reviewer; Albert does not review code.

**RECOVERABLE**
- **Should `age_group` be read-only from DesignFlow's side?** The same one-line change also points
  `createAgeGroup` / `updateAgeGroup` / `deleteAgeGroup` at the shared `core` schema. They are
  unreachable from the UI today, but if ever wired up an application write would land in shared
  master data. **Recommendation: yes, make it read-only.** One word answers this.

**NOT PART OF THIS WORK, AND NOBODY IS ON IT**
- **The migration ledger drift (issue #1663).** The default branch carries a `MIGRATIONS_FAILED`
  flag that nobody has explained, and `20260729120000_lock_down_public_security_definer_execute` —
  a *security* lockdown — is unapplied and not covered by any existing verification doc. Two of the
  drifted migrations (`20260814223552`, `20260825094455`) are under a standing hard-block ruling and
  must never be promoted. Needs a ruling on who owns unwinding this.
- **`core.age_group` has zero grants.** It is readable only because the pooler user maps to
  `postgres`. Any future least-privilege tightening will silently break DesignFlow.

**Already settled — do NOT re-ask**
- 2026-08-27: Albert authorized the cutover ("yes, do the age group cutover"). Do not re-ask.
- 2026-08-04 (the plan): **Phase D — production — is NOT APPROVED and NOT SCHEDULED.** Do not start
  it. Dropping the old `age_group` table is deliberately not part of the plan and is not reversible
  by redeploying.

## 1. What this application is

DesignFlow is POP Creations' product-lifecycle app: the team creates art pieces, merch groups and
licensed product records in it. Backend `popcre/designflow-backend` (Node/Sequelize, Cloud Run,
region `us-east4`), frontend `popcre/designflow-frontend` (Angular). Its data is being moved off
Google Cloud SQL onto Supabase, project `qsllyeztdwjgirsysgai`. Shared master data lives in the
`core` schema and is governed by `u2giants/shared-db` (branch + PR, never direct writes).
DesignFlow's own per-environment schemas are `dflow` (sandbox/dev/staging) and `dflow_prod`
(production, port 6543 through the pooler).

`age_group` is a two-row list — Adult and Juvenile — chosen as the smallest possible rehearsal for
that migration.

## 2. What we set out to do this session, and why

Execute `docs/age-group-cloudsql-migration-plan-20260804.md`: run its Phase A gates, then step C1
(point the sandbox backend at the shared copy). The point was never the list itself; it was to
rehearse the mechanics of moving a table from a private schema to `core` on a change small enough
that a mistake is trivial.

## 3. Current state — what is true right now

**Done and verified**
- **Phase A, all three gates PASS.** Evidence in the merged doc
  `docs/verification/age-group-cutover-phase-a-and-c1-20260827.md` (squash merge
  `b49a5665060fcc9a100f12a096460ea44a30451c`, PR https://github.com/u2giants/shared-db/pull/1667).
- **C1 implemented.** `designflow-backend` `models/db/AgeGroup.js` gained `schema: 'core'`, commit
  `1506639` on branch `sandbox-albert`, pushed.
- **C1 deployed.** Cloud Build `a12b46f0-329c-40ac-8027-f9bd3781989a` SUCCESS 15:51:40Z; Cloud Run
  ready revision `popcre-albert-core-sandbox-00173-8ff`.
- **Read target proved**, which is the whole point — see §5.
- Issues filed: #1681 (this workstream), #1663 (migration drift, separate).

**Half-done**
- **C2** — the same change reaching `develop` then `staging`. The commit rides the standing PR
  https://github.com/popcre/designflow-backend/pull/75 with the evidence posted as a PR comment
  (`#issuecomment-5441624911`). Not self-merged. Nothing further is in flight.

**Not started**
- **C3** — grading the plan's §7 claims PROVED / NOT PROVED / NOT TESTED.
- **Phase D** — production. Forbidden, see §0.

**Not tested**
- A live authenticated `GET /api/admin/getAgeGroups`. It sits behind `authRole([...])` and returned
  403 without a session token. That proves the service is up and auth-gated; it does not prove the
  response body. Marked NOT TESTED rather than claimed.

Both working trees (`shared-db` worktree, `designflow-backend`) are clean and pushed.

## 4. Everything we tried that did NOT work

- **A `DO` block with a temp table** to collect per-schema row counts →
  `ERROR: 25006: cannot execute CREATE TABLE in a read-only transaction`. The Supabase MCP
  connection is read-only. Worked around with `query_to_xml(format(...))`, which runs dynamic SQL
  without writing. Keep the error: it is itself proof this session could not have written anything.
- **Guessing column names** on `dflow."merchGroupRelations"` and `dflow."merchGroupHeaders"` →
  `column "merchGroupCode" does not exist`, then `column h.name does not exist`. Query
  `information_schema.columns` first; those tables are camel-cased and quoted.
- **`curl https://api.sandbox-albert.designflow.app/`** → exit status 000, while github.com returned
  200 from the same shell. The vanity host is not resolvable/reachable from this machine. Use the
  Cloud Run URL directly: `https://popcre-albert-core-sandbox-mi7si7t62a-uk.a.run.app`.
- **`gh pr merge 1667`** printed `fatal: 'main' is already used by worktree at 'C:/repos/shared-db'`.
  That is local branch cleanup failing AFTER a successful merge. Confirm with
  `gh pr view <n> --json state,mergeCommit` before believing it failed. Then
  `git push origin --delete <branch>` may say "remote ref does not exist" — also fine, because
  `--delete-branch` already removed it.
- **Filing issue #1663 before reading `docs/verification/`.** The drift was already partly
  documented there, including a hard-block ruling on two migrations. Posted a scope-narrowing
  correction comment. **Read `docs/verification/` before filing anything about migration state.**
- **Trying to use `dflow_prod` as a production stand-in.** Both `dflow_prod.age_group` and
  `dflow_prod.art_piece` are empty. That schema is a prepared shell from
  `20260824011750_create_dflow_prod_and_audit_archive`, not a copy of production data.

## 5. Root causes and key findings

- **The plan's §6.2 constraint is the hard part, and it is solved.** Both the old and new tables
  hold identical rows, so any "it works" check is worthless unless it proves *which table was read*.
  Solved without touching a table: the generated SQL was captured with `process.env.schema`
  deliberately set to `dflow`, and it still emitted
  `SELECT * FROM "core"."age_group" AS "AgeGroup" WHERE ... ORDER BY "created_at" DESC`. Stronger
  than the rename-the-old-table trick the plan suggested, and non-destructive. **Reuse this
  technique for every remaining table in the migration.**
- **THE finding: the column was never an `age_group` reference at all.**
  `dflow.art_piece.age_group_id` holds ids 3760, 3761, 3762, 3808, 3809, 3810 (and 8 nulls) across
  1,116 rows. `core.age_group` holds ids 1 and 2. **Zero matches.** The values are not merch-group
  header or relation ids either. The plan predicted this at step D2; it is now measured fact.
  Consequence: this cutover cannot break anything, which is a strong *safety* result and a weak
  *rehearsal* result. C3 must grade at least one §7 claim NOT PROVED.
- **The UI "Age Group" dropdown is fed by merch groups, not this table.** Decisive line:
  `designflow-frontend/src/app/pages/art-piece/newArtPiece/newArtPiece.component.ts:112` declares the
  control as `new FormControl({ value: new merchGroup(), disabled: true })`. And
  `getAgeGroups()` in `designflow-frontend/src/app/helpers/services/admin.service.ts:157` is called
  from nowhere — repo-wide search returns only the definition.
- **Schema binding is per-model, not global.** `AgeGroup` is now pinned to `core`; `users` still
  resolves through `process.env.schema`. `getAgeGroups` joins them, so it is a live cross-schema
  join. It was executed against production and returns correctly.
- **Production identity is enforced in code**:
  `designflow-backend/config/database-connection-contract.js:73-95` throws unless
  `SCHEMA === 'dflow_prod'`. That is how you prove which environment you are in.

## 6. Exact next steps

1. **Answer the read-only question in §0** (one word). *You'll know it worked when* the PR #75
   conversation records a decision.
2. **Get PR https://github.com/popcre/designflow-backend/pull/75 reviewed and merged to `develop`.**
   Do not self-merge. *You'll know it worked when* `gh pr view 75 --json state` says `MERGED`.
3. **Verify on develop/staging.** Re-run the target proof against the deployed staging service:
   capture the generated SQL with `process.env.schema` set to `dflow` and confirm it still says
   `"core"."age_group"`. *You'll know it worked when* the emitted SQL names `core`, not `dflow`.
4. **Attempt one authenticated `GET /api/admin/getAgeGroups`** against staging to close the NOT
   TESTED gap. *You'll know it worked when* it returns Adult and Juvenile with a 200.
5. **Write C3 grading** as a new file under `docs/verification/` in `u2giants/shared-db` via branch
   and PR, grading each §7 claim of the plan PROVED / NOT PROVED / NOT TESTED. *You'll know it
   worked when* the PR merges and #1681 can be closed.
6. **Delete this handoff file in the same PR that closes #1681.**
7. **Stop.** Do not begin Phase D.

## 7. Constraints and gotchas in force

- **Phase D is forbidden** without a fresh per-change owner instruction naming the environment.
- **Never drop the old `age_group` table.** Explicitly outside the plan and not reversible by
  redeploying.
- **DesignFlow branch policy:** work on `sandbox-albert`, PR to `develop`, **never self-merge**,
  never to `main`. Everywhere else Claude merges its own PRs — Albert never does.
- **`shared-db` structure changes go through branch + PR** with a large required-check gate suite.
  Reading schema and safe sample data is open.
- **AI sessions are read-only against production and shared cloud infrastructure** unless Albert
  names the exact resource and action in the live chat.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees.
- **Prove the target database immediately before every write**, and prove the target *table* before
  claiming any read result means anything here.

## 8. Access and environment

- **Supabase MCP** — authenticated, **read-only**. `get_project_url` →
  `https://qsllyeztdwjgirsysgai.supabase.co`. Call it before every session's first query to prove
  identity.
- **`gh` CLI** — authenticated as `u2giants`. `popcre` is the org that owns the DesignFlow repos.
- **`gcloud`** — authenticated, region `us-east4`, Cloud Build trigger on `designflow-backend`.
  Read-only for production by policy.
- **Repos:** `C:/repos/shared-db` (plus linked worktrees under `.claude/worktrees/`),
  `C:/repos/dflow_plm/designflow-backend`, `C:/repos/dflow_plm/designflow-frontend`.
- **Secrets:** 1Password vault `vibe_coding`. Never in chat, arguments, logs or commits.

## 9. Open questions and risks

- **Risk: C2 stalls indefinitely** because nobody reviews PR #75. The sandbox change is harmless
  either way, so the risk is a forgotten half-finished workstream, not breakage. #1681 exists to
  prevent that.
- **Risk: the rehearsal is over-trusted.** Because nothing referenced `age_group`, a clean C2 does
  NOT demonstrate that a table with real foreign keys can be moved. Anyone citing this as proof for
  a bigger table is wrong. Say so explicitly in C3.
- **Open: what do ids 3760–3810 in `art_piece.age_group_id` actually point at?** Not established.
  Not needed for this cutover, but it means a column is named for a table it does not reference —
  a latent trap for anyone else reading that schema.
- **Risk: a future grant tightening on `core` breaks DesignFlow silently**, because the read works
  by role privilege with no explicit grant.
- **Decision, 2026-08-27:** proved the read target by inspecting generated SQL rather than by
  renaming the old table. Chosen because it requires no write and is repeatable. Do not contradict
  this later by reintroducing the rename trick.
