---
issue: 5026
status: OPEN
owner: mimo/ses_ffe5e524b9374ffeBpP5sZjXXa (EDGE-DEV)
---

# Handoff — Core Product Type: production half remains (sandbox half is DONE and live)

Written 2026-11-06, ~9:00 AM EST (13:58Z), EDGE-DEV, MiMo (session ses_ffe5e524b9374ffeBpP5sZjXXa).

Workstream: **Core Product Type on every item** — https://github.com/popcre/designflow-item-master/issues/150 (plan: https://github.com/popcre/designflow-item-master/blob/sandbox-albert/plan_core-product-type.md , read its STATUS table first). Structural issues: https://github.com/popcre/shared-db/issues/5020 (sandbox half — delivered) and https://github.com/popcre/shared-db/issues/5026 (production half — THIS handoff). The nine-thing handover note is also on #5026: https://github.com/popcre/shared-db/issues/5026#issuecomment-6686528292

## 0. Business decisions only the owner can make

**None outstanding — nothing in this workstream needs the owner.**

Already settled — do NOT re-ask:
- **2026-10-29 (Albert):** the method — items created ≥ 2025-05-01, grouped by MG01+MG02+MG03, one ScaleDown Summarize call per group over ALL its descriptions, Classify verifies every item; bar **95%+ overall and in every group**; failing groups stay blank on a review list; human overrides never overwritten by machine.
- **2026-10-29 (owner ruling):** AI review is advisory and never a merge gate — shared-db included. Do not hold merges for reviewer approval.
- **2026-11-06, ~11:40 PM EST (Albert, direct chat):** "take it out by force and get the queue moving" — authorized force-closing idle lower-version PRs blocking the shared-db merge queue (done: nine closed with reopen notes; nothing deleted).
- **2026-11-05 (Albert):** "resume the database step" — authorization for everything this session did.

## 1. What this application is

DesignFlow PLM is POP Creations' product-lifecycle app (item master, RFQs, duty rates, tracking). Repos `popcre/designflow-{frontend, bff, backend, item-master, tracking, data-syncing}` (branch `sandbox-albert`, live at https://alsand.designflow.app ); all durable database STRUCTURE lives in `popcre/shared-db` (the shared Supabase back end used by CRM, DAM, PM/PIM and PLM). "Core Product Type" = a clean per-item description of what the product physically is (licensor/property/size/artwork stripped), stored once per MG combination and shown on every item.

## 2. What we set out to do this session, and why

Albert asked "where do we stand" on ScaleDown distilling item descriptions to core product type, then ordered the database step resumed (item-master #150 Phase 1: create the storage tables in both DesignFlow databases) and later, when a merge-queue blockade stalled delivery, ordered it force-cleared. Goal: land the sandbox-half tables and apply them; hand over the production half.

## 3. Current state — what is true right now

**DONE and live (verified):**
- Migration **20261106050346** (`dflow` product-description tables, audit + human-override guard) is on `popcre/shared-db` main: https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261106050346_dflow_product_description.sql — merged by PR https://github.com/popcre/shared-db/pull/5812 (merge commit https://github.com/popcre/shared-db/commit/b402568fe68f50cb20374683cef1f059d9d6394e ) plus the self-check split PR https://github.com/popcre/shared-db/pull/5844 (merge https://github.com/popcre/shared-db/commit/42af50fa26c83d9a4b74c26c1362b67994227beb ).
- **APPLIED to the DesignFlow sandbox** (Supabase `xupnyeifmpsacrqahwwm`, schema `dflow`) via the DesignFlow Sandbox Migrations workflow: dry-run run 42177658028, **apply run 42177732286** (post-apply ledger proof green). The four tables, four indexes, two functions and three triggers now exist there.
- Evidence contracts: https://github.com/popcre/shared-db/blob/zcode/5020a-dflow-pd/.agent/work/5020/15/contract.json (generations 15–17, refs/db-contracts/5020/15–17).
- Sandbox apply checklist items on https://github.com/popcre/shared-db/issues/5020 are satisfied for (1.1 schema) and (1.2 non-prod apply); its "live proof (read-only catalog check BOTH projects)" item stays open until the production half applies.
- `ai-shared-db-closeout-check` run 2026-11-06 ~9:00 AM EST: **ok:true, zero owned claims, zero owned stages** (10 open claims checked, 84 open issues seen). Claims #5772/#5793/#5836 all closed.

**PRESERVED but NOT mergeable from its current branch (the work to do):**
- Branch `zcode/5026-dflow-prod-pd` at commit **6154b3c32** (https://github.com/popcre/shared-db/commit/6154b3c32 ) carries the production half: migration https://github.com/popcre/shared-db/blob/zcode/5026-dflow-prod-pd/supabase/migrations/20261029175542_dflow_prod_product_description.sql (with the round-5 H1 grant fix: `grant usage on schema core`, `grant select on core."merchGroup"`, `grant select on dflow_prod."itemHeader"`), its sidecar `scripts/production-verification-sidecars/20261029175542.json`, contract tests `supabase/tests/dflow_prod_contract.sql` and `supabase/tests/dflow_prod_product_description_contracts.sql`, the `production_migration_guard.py` foreign-target entry, the sidecar-registry row and the disposition file. **Its lineage predates a shared-db history rewrite — `git merge origin/main` refuses ("unrelated histories").** Rebuild on a fresh branch from current main instead (step 6).
- Old evidence pair: https://github.com/popcre/shared-db/blob/zcode/5026-dflow-prod-pd/.agent/work/5026/6/contract.json (generation 6).

**NOT started:** the production-half rebuild/retimestamp/claim/PR; the production promotion lane; the shared-db #5020 live-proof checkbox (needs both projects); item-master Phase 2 onward (generator, 95% dry run, backfill, API/UI — plan steps 2.1+).

**No commits are unpushed. No PR of this session is open.** Nothing was applied to the shared preview project or shared production — these migrations are foreign-target (DesignFlow sandbox / DesignFlow production only) and the shared lanes never receive them.

## 4. Everything we tried that did NOT work

1. **Merging parked branches into moving main without a version plan.** Guard B (check-sql) requires the migration version to sort above main's newest AT MERGE TIME; the merge queue refuses a PR whose version sorts behind any OPEN lower-version PR. Main gained a migration every ~30–60 minutes. Result: three retimestamps burned (`20261029161229` → `20261105222623` → `20261105231250` → `20261106050346`; each prior version permanently reserved). Lesson: retimestamp, push, enqueue and merge within minutes.
2. **Waiting on the merge queue behind idle PRs.** Nine open PRs carried lower migration versions (oldest since Oct 22) and ejected every attempt at the "Revalidate migration order" gate. Waiting was futile (owners idle for hours); Albert authorized force-closing them (recoverable: branches intact, reopen notes on each PR explaining the re-timestamp-then-reopen path).
3. **Zombie workflow runs.** Two runs queued at the first push spawned zero jobs for 30+ minutes and held their per-ref concurrency groups (`cancel-in-progress: false`); cancellation was ignored and run deletion returned 403. Workaround that works: open a FRESH PR number (new ref = new concurrency group) — done for #5029 → #5812.
4. **Editing a merged migration's self-check in place without splitting it.** The DesignFlow sandbox preflight (absent-schema statement conditioning, shared-db issue #2986) refused the single mixed-schema `do` block ("names the absent conditioned schema [dflow_prod] and also live schema(s) [core, dflow]; mixed-schema statements are never conditioned"). Fix: split into a pure `dflow_prod` guard (conditioned to run exactly where that schema exists) + a live-schemas prerequisite block (PR #5844). Do not re-merge them.
5. **Dispatching DesignFlow Sandbox Migrations with the amending PR as `source_pr`.** "REFUSED: migration 20261106050346 was not added by source PR #5844" — `source_pr` must be the PR that ADDED the migration (#5812).
6. **Merging `origin/main` into the preserved production branch.** `git merge` refuses with "unrelated histories" — the branch's lineage (root `e4d782d25`) predates a shared-db history rewrite; `git merge-base` is empty while sibling branch `zcode/5020a-dflow-pd` bridges both lineages and merged fine. Rebuild from main; do not force.
7. **Running the sandbox dry-run before the split (twice).** First failure was the mixed-schema refusal (#4). Second: wrong `source_pr` (#5). Both are preflight refusals with clear messages — read the run log's `REFUSED:` line.
8. **psql behavior-contract runs inside the tool harness.** The harness's process cleanup kills psql mid-run and takes the postgres backend with it (0xC0000142). Run detached (a .bat via `Start-Process`) from the WORKTREE ROOT (psql `\i` paths resolve from cwd, not the SQL file).
9. **`ai-shared-db-closeout-check` overlapping invocations.** The `ai-gh` launcher serializes GitHub calls (~3s spacing, FIFO admission) and prints only at the end; concurrent attempts queue behind each other and look dead, and killed attempts leave orphans holding the queue. Run ONCE with a ≥15-minute budget; `AI_GH_QUOTA_PROBE_SECONDS=off` trims the runtime; kill orphaned trees before retrying.
10. **Sidecar checks before committing a retimestamp.** `check-production-verification-sidecars.mjs` derives its scan set from COMMITTED diffs but tests file existence in the WORKING TREE — a retimestamped-but-uncommitted rename reads as "mandatory migration … is missing". Commit first, then verify.
11. **Claim titles naming several issues.** `check-dispatch-collision` / preview admission refuse "open claim … ambiguously identifies work issue" — a claim title must name exactly ONE work issue.
12. **`ai-muse` / `ai-task-gates` from a non-repo cwd** (e.g. the `dflow_plm` parent folder) — both refuse ("not inside a Git repository"). Run from a real checkout.

## 5. Root causes and key findings

- **The shared-db merge lane changed since the 2026-10-29 handoffs:** `guarded-migration-merge.yml` is gone; merges go through GitHub's native merge queue with the advisory "Merge Queue Gate" (its failure on a merge group still ejects the group). Claims are object+version only (no `db-author-lease` fence on new claims). `--prepare-preview-dispatch` still expects a legacy lease fence and refused our claim for it. Review is advisory (2026-10-29 ruling).
- **Foreign-target migrations** (registered in `scripts/production_migration_guard.py` `FOREIGN_TARGET_MIGRATIONS`) never apply to the shared preview/production projects; their apply route is the per-app workflow (DesignFlow Sandbox Migrations for non-prod; the production promotion lane for dflow_prod).
- **The migration's self-check must be split per schema class** for the sandbox lane's conditioner (`scripts/sandbox_migration_preflight.py`, `wrap_guard` wraps a statement as "run only if schema X exists" — correct polarity for a raise-if-present guard).
- **Version/order dynamics:** Guard B (above main's max) + queue order (below all open lower-version PRs' versions — i.e. wait for them) are jointly satisfiable only while the PR is the lowest version above main's max and gets merged before main moves again.
- **Worktree 5020a** (`zcode/5020a-dflow-pd`) bridges the pre/post history-rewrite lineages and merges main normally; **worktree 5026b** (`zcode/5026-dflow-prod-pd`) does not. Both were kept.

## 6. Exact next steps (production half)

1. Create a fresh branch from current `popcre/shared-db` `origin/main` in a NEW worktree (do not reuse 5026b's branch; do not delete it).
2. Copy the production-half content from branch `zcode/5026-dflow-prod-pd` (commit 6154b3c32): the migration SQL (with the three H1 grants at the end of the grant block), the sidecar JSON, `supabase/tests/dflow_prod_contract.sql`, `supabase/tests/dflow_prod_product_description_contracts.sql`, the `FOREIGN_TARGET_MIGRATIONS` entry in `scripts/production_migration_guard.py`, the sidecar-registry row in `config/production-verification-sidecar-registry.json`, and `docs/verification/throughput-dispositions/scripts~production_migration_guard.py.json`.
3. Reserve a fresh migration version (`node scripts/check-dispatch-collision.mjs --objects "<15 objects from the claim fence on #5026's old claim>" --reserve-version`) above main's current max; rename the migration file and every version reference (the contract tests `\i` the migration by filename — sweep them too); re-hash the sidecar; fix marker-review line numbers if the edit shifts them.
4. File the claim (title names exactly ONE issue: #5026), commit, run `bash scripts/check-sql.sh`, `python -m unittest scripts.test_check_production_verification_sidecars`, `node scripts/check-production-verification-sidecars.mjs --base origin/main`, and the psql contract test detached on a throwaway postgres (see §4.8).
5. Open the PR to `main`, wait for required checks, enqueue (`gh api graphql … enqueuePullRequest`), watch it merge. You'll know it worked when `gh pr view <n> --json state` shows MERGED and the migration file is on `origin/main`.
6. Then the production apply goes through the **production promotion lane** (merged-main preview rehearsal → automatic serial production lane — see https://github.com/popcre/shared-db/blob/main/docs/production-promotion-procedure.md ; never hand-apply). `source_pr` for any per-app workflow must be the PR that ADDED the migration.
7. After both databases carry the tables: close the live-proof checklist on https://github.com/popcre/shared-db/issues/5020 and return to item-master Phase 2 (generator + Classify verifier + the 95% dry run — plan steps 2.1–2.3 at https://github.com/popcre/designflow-item-master/blob/sandbox-albert/plan_core-product-type.md ).

## 7. Constraints and gotchas in force

- Branch `sandbox-albert` only for designflow repos; never `main`; Uma (`devopswithkube`) reviews and merges designflow PRs. shared-db merges are the AI's job (queue, no `--admin`).
- Never edit a migration present in any ledger; versions are permanently reserved once claimed. Additive/idempotent SQL; fail-loud self-checks that keep each half off the wrong database.
- Sign every GitHub post: `Posted by MiMo chat <id> on <machine>` (`$MIMO_SESSION_ID`, else `unknown`).
- One work issue per application need; handover notes go on the EXISTING issue (never a new ticket); a claim title names exactly one issue.
- The merge queue locks a queued PR's branch — dequeue (`dequeuePullRequest` GraphQL) before pushing.
- `ai-gh` serializes GitHub calls machine-wide; do not overlap heavy automation.

## 8. Access and environment

- Machine EDGE-DEV (Windows). `gh` authenticated (u2giants). Node/Python available; psql via scoop PostgreSQL (`initdb -U postgres -A trust`, throwaway port 55432).
- Worktrees kept (machine-local, deliberate): `D:\repos\shared-db-worktrees\5020a` (branch `zcode/5020a-dflow-pd`, clean, finished — safe to clean later via `cleanup-worktree`), `D:\repos\shared-db-worktrees\5026b` (branch `zcode/5026-dflow-prod-pd`, clean at 6154b3c32 — the preserved production-half SOURCE; do not delete).
- Secrets: none appeared this session (local throwaway postgres only; Supabase tokens never handled). 1Password vault `vibe_coding` holds the Supabase CLI PAT if a successor needs the management API.
- Closeout receipt: `ai-shared-db-closeout-check --session-id bf033e21-e340-4983-9f47-9705c8d326b6` → ok:true at ~9:00 AM EST 2026-11-06 (stored in session evidence).

## 9. Open questions and risks

- **Version churn risk (2026-11-06):** the production half will face the same Guard-B/queue-order race; plan the retimestamp+merge as one fast pass.
- **Doc drift noted (2026-11-06, not fixed):** `docs/agents/anti-collision-summary.md` still describes `--check-in-author` and other flags that `manage-migration-coordination.mjs` no longer accepts (retired by #5409). A future docs pass should add dated supersession pointers; deliberately not touched during scope freeze.
- **The nine force-closed PRs** (e.g. #5640 t9 Styles bridge, #5647, #5653, #5663, #5709, #5719, #5720, #4620) belong to other sessions; each carries a reopen note. If one reopens with a version below the production half's, it will block the queue again — check `node scripts/merge-queue-contract.mjs` with `PR_NUMBER` before enqueuing.
- **Per-item vs per-group method note (2026-11-05):** a separate per-item ScaleDown distiller exists in `popcre/designflow-backend` (HTS path). The item-master program's settled method is per-MG-group; do not conflate them (see #150 comments).
