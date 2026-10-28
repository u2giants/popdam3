---
issue: 4964
status: OPEN
owner: mimo/item-retailer-selling-signal
---

# Handoff — item retailer selling signal (issue #4964): database done and live; app screen + grants follow-up remain

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

1. **Build the color-entry screen in the product app so Albert can actually set red/yellow/green per item per retailer?** (blocking: everything user-facing; the database columns exist but no screen writes them). **Recommendation: yes** — otherwise the feature cannot be used. Ask before building; the app repo is `u2giants/poppim-web`.
2. **Confirm the color meanings assumed during the build: red = poor selling, yellow = middling, green = strong.** (a wrong guess is recoverable — it is just how the data is read). **Recommendation: keep the assumption.**

Put BOTH questions to the owner in ONE message before starting work.

**Already settled — do NOT re-ask:** "never ask a human to approve" technical actions (2026-09-28); one independent review is enough (2026-10-14); production risk classes are accepted by the assigned AI reviewer's written assessment, never by Albert (2026-09-30, §6.23).

## 1. What this application is

POP Creations shares one Supabase Postgres across CRM, DAM, PM/PIM and DesignFlow PLM. This repo (`popcre/shared-db`) is the **shape of the database** source of truth: migrations, contracts, business rules. Apps read the same tables, so every schema change is claimed, reviewed, rehearsed on preview, then applied to production through governed workflows. Retailers in the data model are customers (`core.customer`); items live in the Item Master (`plm.item`).

## 2. What we set out to do this session, and why

Albert (2026-10-28): add rudimentary selling data (red / yellow / green) to each item, by retailer — "add those columns to the database". Goal: a place to store one traffic-light selling judgment per (item, retailer) pair. Technical objective: one additive migration — a new table keyed by item and retailer, wired so merging duplicate retailer records keeps the judgments.

## 3. Current state — what is true right now

Verified 2026-10-28 4:03 PM EDT against live GitHub:

- **Done and LIVE in production.** Migration `20261028154414` merged in PR https://github.com/popcre/shared-db/pull/4966 (merge commit https://github.com/popcre/shared-db/commit/a77879e0c27336ab020db67fde768e63691dc8a3), rehearsed on preview, applied to production by run https://github.com/popcre/shared-db/actions/runs/40756853656 — its post-apply catalog verification passed. Live proof comment: https://github.com/popcre/shared-db/issues/4964#issuecomment-6479023944
- Table `plm.item_retailer_selling` (in production): `id`, `item_id -> plm.item(id) ON DELETE RESTRICT`, `retailer_id -> core.customer(id) ON DELETE RESTRICT`, `selling_signal` (only `red`/`yellow`/`green`), timestamps, `unique (item_id, retailer_id)`, index on `retailer_id`. Source: https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261028154414_item_retailer_selling.sql
- `core.merge_customer` (customer dedupe) now carries selling rows to the survivor (same file, `-- derived-from: 20261027223520`).
- Contract tests live at https://github.com/popcre/shared-db/blob/main/supabase/tests/plm_item_retailer_selling_contracts.sql and the merge-coverage fixture at https://github.com/popcre/shared-db/blob/main/supabase/tests/db_data_admin_merge_coverage.sql (both green in CI ephemeral run job 122955505370).
- **NOT done:** (a) no screen anywhere sets the colors; (b) the table is deny-by-default — RLS on, zero policies, all grants revoked — so **no app can write a row until a follow-up additive migration grants the consuming role**; (c) generated types (`generated_types: required`) and the issue's `--complete-outcome` (needs application commit + live app proof + generated-types evidence) are still open; (d) issue https://github.com/popcre/shared-db/issues/4964 stays OPEN on purpose ("one named owner until the app works live").
- `origin/main` tip at check time: `19451cee8cc7aea698a0ecbdfc43f349418a7917` (2026-10-28 4:03 PM EDT). Max migration version in the repo: `20261028161214` (another session's). My version `20261028154414` is applied to production and never reusable.
- Claim https://github.com/popcre/shared-db/issues/4965 (version reservation `20261028154414`) is RELEASED and closed. Author lease stopped (`--stop-author`, capacity relinquished). Promotion merge freeze released.

## 4. Everything we tried that did NOT work (do not repeat these)

1. **`comment on column` statements inflate claim objects.** The PR object parser counts them as `column schema.table.column` writes, so a migration with two column comments no longer matched the claimed objects (`table …`, `index …`). Fix: fold column meaning into the table comment. Always run `dispatchObjectKeys` (scripts/check-pr-object-collisions.mjs) on the exact migration text before claiming.
2. **Reviewer session-skip list keyed by a degenerate caller id.** With `MIMO_SESSION_ID` unset, the skip key collapsed to `ppid-1-unknown`, a shared file carrying week-old skips — reviewers were reported "skipped for this session" before any failure of mine. Fix: export `MIMO_SESSION_ID=<session uuid>` (and `AI_<PROVIDER>_CALLER=mimo`) before any review dispatch. Observed refusal texts: "stepfun skipped for this session (blocked…)", "deepseek skipped for this session (native-execution-failed…)".
3. **Recording a replacement-drawn verdict without `--replacement-sequence`.** A review run by a reviewer drawn through `--replace-failed-reviewer` must pass `--replacement-sequence <failed-sequence>` to `scripts/run-governed-review.mjs`; without it the verdict recorder looks up the ORIGINAL assignment ref and refuses ("reviewer does not hold the exact active lease … stepfun-step-5-preview holds no active lease at all"). One GLM review was lost this way; its findings comment remains on the PR with verdict lines voided (non-authorizing).
4. **Reviewers approving WITHOUT the required `production-risk-assessment` block.** The pool wrapper refuses such approvals ("approval lacks exactly one requested production-risk-assessment block"). GLM (exit 3) and StepFun (exit 1) both did this; DeepSeek and Muse complied. Never retry a reviewer that failed or was skipped this session (session-skip rule) — replace it (`--replace-failed-reviewer --failure-code wrapper_terminal_failure --confirm-no-verdict --confirm-no-artifact`) and draw again. GLM was additionally excluded (`--exclude-reviewer --reason terminal-unavailable`, evidence = its assignment ref SHA) after the skip list recorded `risk-block-missing`.
5. **`ai-task-gates check --before ship` / `--before shared-db-promotion` refused three times for reasons that look like review failures but are not:** (a) no task class recorded in the worktree — run `ai-task-gates start --class shared-db` FROM the worktree; (b) the reviewer lifecycle record had no tests evidence — dispatch the review with `--tests "bash scripts/check-sql.sh"` (tests must be recorded during the run; `ai-review-lifecycle record-tests` cannot bolt on afterwards — it refuses "lifecycle is not running"); (c) the gate compares the report's head to `git rev-parse HEAD`, so check out the exact reviewed commit first.
6. **Production apply pin refused after main moved.** `production lane requires the exact current main SHA or a verified prefix of it` — the prefix tolerance accepts only documentation/.agent/test/appended-migration drift; `tools/` changes (PR #4972) are not inert. Recovery used: acquire the promotion freeze (`--acquire-promotion-freeze`), draw a fresh merged-head review with `--production-risk-main <new tip>` (the v1 assessment block must name the EXACT pinned main SHA), dispatch `production-apply-review-evidence.yml` for the new tip (the old artifact is bound to the old SHA — "Verify immutable production review evidence" refuses), then re-dispatch `scripts/dispatch-production-apply.mjs` with the new `--review-run-id`. All of this is documented in https://github.com/popcre/shared-db/blob/main/docs/production-promotion-procedure.md — read it BEFORE the next promotion.
7. **`--prepare-preview-dispatch` needs `SUPABASE_ACCESS_TOKEN`** (reads the preview ledger; unset is NOT "no drift"). Read it from 1Password (`op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN`) into the env of that one command; never echo it.
8. **Author check-in is keyed to a hash of the claim body.** Any claim-body change (e.g. `--expand-active-claim-from-pr`) invalidates the check-in ref; re-run `--check-in-author` afterwards or CI's "Migration author lease" fails with "author check-in confirmation differs". Also: check-in needs `--claim-number --issue --pr --head-sha --owner --branch --worktree` all exact, and refuses an expired lease (`author check-in refuses stopped, expired…`).
9. **`refs/db-coordination/author-acquisition` is a global mutex** — several operations refused with "occupied" during other sessions' work; waiting 60–150 s and retrying worked every time. Never "recover" it unless it is proven stale.
10. **Merge-group "Agent work contract" (enforced mode) wants `.agent/work/<issue>/<generation>/{contract,completion}.json` in the PR.** It is NOT a required check, so PR #4966 merged without the pair; a pair written afterwards cannot ride a follow-up PR (the validator compares `report.pr` to the running PR number). The contract itself was published durably at `refs/db-contracts/4964/1` (commit `e4d1b0fe65b346d6aa5881473168ae61ea955028`, sha256 `5bb4293a367bdb361c8fdb914234ab33a92d997d5bccfa8619a5ead7c367067f`). An unpushed local commit `e21798526f89951990b96bd671267c7817df0901` on this machine's branch (now reset away) contains the pair files; treat as a curiosity, not live state.
11. **`--exclude-reviewer` takes no `--admit-issue`**, and it RETURNS every assignment the named reviewer holds on the PR (all slots/heads) — check which assignments come back before assuming a slot is untouched.

## 5. Root causes and key findings

- **Claim objects must exactly equal the PR's parsed objects.** `scripts/check-pr-object-collisions.mjs` `dispatchObjectKeys()` is the authority; `--claim`/`--expand-active-claim-from-pr` and admission all compare against it.
- **Durable review verdicts** live under `refs/db-review-verdicts/…` (original assignments) and `refs/db-review-verdict-replacements/…-<failedSequence>` (replacements). The production risk gate scans these for exactly one `production-risk-assessment` JSON block (schema `shared-db-production-risk-assessment/v1` naming the exact promoted main SHA; `v2` names the PR head and only exists pre-merge).
- **Risk classes are SQL-derived**: `expected_downtime`, `material_access_change`, `permanent_data_rewrite_or_loss`. Pass them verbatim to `--production-risk-classes`.
- **Outcome lifecycle** (issue `db-work-scope`): `entered → classified → dispatched → implementation_complete → review_ready → preview_verified → merged → production_authorized → production_applied → live_verified`, advanced via `--advance-outcome <state> --admit-issue N --issue N --owner … --evidence <github url>`. `--complete-outcome` demands a `db-outcome-evidence` JSON fence in the evidence COMMENT (production artifact id + sha256 digest, application repo/commit, live evidence, generated-types digests) — see `scripts/db-flow/outcome-lifecycle.mjs`.
- **`reviewTargetIsRecordable`** refuses merged PRs unless `SHARED_DB_MERGED_PR_ISSUE_BINDING=PR:ISSUE` is set (it proves the merged PR closes the issue). Needed for every merged-PR review operation.
- **Self-service-additive lane refuses foreign keys** (an FK locks the parent table), so any new table with REFERENCES goes `route: claim-first`.

## 6. Exact next steps

1. Ask Albert the two §0 questions in one message. You'll know it worked when he answers both.
2. If yes to the screen: in `u2giants/poppim-web`, build the item×retailer color picker writing `plm.item_retailer_selling` (upsert on `(item_id, retailer_id)`; values `red|yellow|green`; survivor-wins semantics documented in the migration). **Blocked until step 3 lands** — the table currently rejects every client.
3. Author a small additive shared-db migration granting the consuming role (e.g. `service_role` or the app's authenticated path) `select/insert/update/delete` on `plm.item_retailer_selling`, following claim-first (new claim on issue #4964, own worktree, version via `node scripts/manage-migration-author-lanes.mjs --claim --admit-issue 4964 …`). You'll know it worked when the app can insert a row in production.
4. Confirm generated types are regenerated (issue scope says `generated_types: required`; check whether `generate-database-types.yml` produced them after the preview apply — evidence for the outcome record). You'll know it worked when `types/database.types.ts` includes `item_retailer_selling`.
5. Finish issue #4964's outcome: advance to `live_verified` and `--complete-outcome` with a `db-outcome-evidence` fence (production artifact `production-migration-apply-19451cee8…` id 12847280866, digest `sha256:7f61fd2d4dcfe12c7477f3b5b201644c42e3727223b35e20fe5be8323561def0`; application fields once the app ships). Then close the issue and delete this handoff file in that session's PR (successor rule).
6. Optional (low, deferred): tighten `plm_item_retailer_selling_contracts.sql` phases 2–3 to exact `pg_get_constraintdef` comparisons (Muse/DeepSeek finding L1) and the migration's post-apply block to an exact name:type comparison (L2).

## 7. Constraints and gotchas in force

- Shared-db: claim-first, worktree-only, never edit an applied migration, never reuse version `20261028154414`, never spawn background task chips (repo rule), `SHARED_DB_AUTHOR_ENGINE` + `SHARED_DB_SESSION_ID` set for every lane command.
- Owner-bound `--check-in-author` every 60 minutes and before protected actions while a structural claim is live (this session is stopped — restart means a NEW claim).
- Production risk classes are accepted only by the assigned AI reviewer's written assessment (§6.23); never route them to Albert; `OWNER-OVERRIDE` exists only for undrawable reviewer tooling.
- Merge freezes block other sessions — release them (`--release-promotion-freeze`) and never hold one across a wait you do not need.
- Do not touch other sessions' `HANDOFF.d/` files or the root `HANDOFF.md` (static pointer).

## 8. Access and environment

- `gh` CLI authenticated for `popcre/shared-db` (this machine, hostname edge-dev / EDGE-DEV; MiMo Desktop session `ses_ffe5e7ce3d92fffeTPeI4wubCD`).
- Supabase CLI token: 1Password vault `vibe_coding`, item "Supabase CLI Personal Access Token" (field `SUPABASE_ACCESS_TOKEN`) — reference by `op://` only, never by value.
- Lane/review tooling lives in the installed `popcre/ai-devops` toolkit (https://github.com/popcre/ai-devops) plus `scripts/manage-migration-author-lanes.mjs` and `scripts/run-governed-review.mjs` in https://github.com/popcre/shared-db/tree/main/scripts.
- Review wrappers need `AI_<PROVIDER>_CALLER` set (e.g. `AI_MUSE_CALLER=mimo`) or they refuse with `caller_identity_missing`.
- Working machine paths (for THIS machine only): shared checkout `C:\repos\shared-db` (read-only by rule); this session's worktree `C:\repos\shared-db\.ai\worktrees\item-retailer-selling` (left in place deliberately — see §9).

## 9. Open questions and risks

- **(2026-10-28) Color semantics are an assumption** (red=poor…green=strong) — confirm with Albert (§0).
- **(2026-10-28) The table is write-proof until a grants migration lands** (deny-by-default by design). Any demo before that will show an empty, unwritable feature.
- **(2026-10-28) Survivor-wins on merge**: if both retailers carry a signal for the same item, the loser's value is discarded even if newer. Business-choice; worth UI copy later.
- **(2026-10-28) `docs/unified-supabase-schema-map.md` does not yet list `plm.item_retailer_selling`** — a row should be added when the app work lands (not done here; scope freeze).
- **(2026-10-28) Local-only artifact**: unpushed commit `e21798526…` (agent-work-contract pair) exists only in this machine's git object store; the published contract ref `refs/db-contracts/4964/1` is the durable record.
- **(2026-10-28) This worktree is deliberately left in place** (`C:\repos\shared-db\.ai\worktrees\item-retailer-selling`, branch `mimo/wrapup-4964-handoff` after the handoff PR merges, previously `mimo/item-retailer-selling-signal` reset to the merged head). Safe to retire later via `cleanup-worktree` once this handoff's successor rule passes; nothing unique is in its tree.

### Sub-agent blocks (part b)

N/A — no sub-agents were dispatched (shared-db forbids background task chips). All work was done by this one session.

---

Self-audit: all 10 sections present; §0 holds the two owner questions with recommendations and the settled list; dead ends (§4) cover every refusal this session hit; next steps (§6) each carry a verification gate; every reference is a GitHub URL or explicitly labelled machine-local under §8/§9; secrets named by vault/item only.
