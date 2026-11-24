---
issue: 4707
status: OPEN
owner: claude/4707-handoff
---

# DesignFlow item migration: reconcile built; production run and live acceptance remain

Supersedes the handoff from 2026-11-23 15:00 UTC (deleted in the same commit; every open obligation is carried forward below).

## 0. Business decisions only the owner can make

None. Nothing in this workstream needs Albert. Already settled (do not re-ask): the 489 approved-exclusion items stay out of the copy and keep their legacy vendor visibility (settled before 2026-11-22). ColdLion is canonical for its own data. Current GATEKEEPER (ruling 2026-11-22) lets the AI merge its own scoped DesignFlow PRs once the rules are met. Reviews are advisory only (2026-10-29).

## 1. What this application is

DesignFlow is POP Creations' product-lifecycle app. It has six repos `popcre/designflow-*` (frontend, bff, backend, tracking, item-master, data-syncing), which deploy through Cloud Build. Branch flow: `sandbox-albert` → `develop` → `main` (production). Release rules: [GATEKEEPER.md](https://github.com/popcre/designflow-data-syncing/blob/develop/GATEKEEPER.md).

The apps read and write legacy tables in schema `dflow_prod` on the shared POP Supabase database. Issue [#4707](https://github.com/popcre/shared-db/issues/4707) moves items and licensing history into canonical `plm.*` tables. The plan is [docs/designflow-item-and-licensing-migration.md](https://github.com/popcre/shared-db/blob/main/docs/designflow-item-and-licensing-migration.md).

The DesignFlow sandbox database is a separate Supabase project (non-production shared). It is not the shared-db preview branch.

## 2. Goal

Keep the canonical copy reconciled with records that are added, edited or removed after the initial copy. Then switch Item Master, Tracking and Backend to the canonical paths with real-role live proof, in the sandbox and then production. Prove rollback and vendor isolation, then close #4707.

## 3. Current state (2026-11-24 1:40 PM EST)

- **Read-only production audit** ([comment](https://github.com/popcre/shared-db/issues/4707#issuecomment-7137435655)), measured against the 2026-11-22 copy: 19 new items, 16–17 edited items (some with changed custom values or merchandise slots), 69 new statuses, 5 new replies, 0 removals. The 489 exclusions are intact.
- **Shared-db access**: [PR #7029](https://github.com/popcre/shared-db/pull/7029) merged at 12:42 PM EST. It adds migration `20261225091301_designflow_item_reconcile_runtime_access` and claim issue [#7028](https://github.com/popcre/shared-db/issues/7028), which should be closed once production delivery is proven. **Production promotion is not yet verified.** **It is not applied to the DesignFlow sandbox, by design**: the sandbox lacks the `dflow_prod` schema and its runtime roles, so the sandbox dry run correctly blocked ([run 45451852254](https://github.com/popcre/shared-db/actions/runs/45451852254)). Do not force it.
- **Data Syncing code** (`sandbox-albert`):
  - [#196](https://github.com/popcre/designflow-data-syncing/pull/196) merged. It adds `reconcile <digest>` and `rollback <runId>` modes to [run-designflow-item-state-copy.js](https://github.com/popcre/designflow-data-syncing/blob/sandbox-albert/scripts/run-designflow-item-state-copy.js) and the writer [reconcile-designflow-item-state.js](https://github.com/popcre/designflow-data-syncing/blob/sandbox-albert/scripts/reconcile-designflow-item-state.js).
  - [#200](https://github.com/popcre/designflow-data-syncing/pull/200) merged with a red `forbid-shared-db-bypass` check. It contained inline `plm` DDL in the rehearsal, which was a mistake.
  - [#201](https://github.com/popcre/designflow-data-syncing/pull/201) is the fix-forward, open with checks pending. **Merge it first.**
  - None of this is on `develop` or `main` yet.
- **Sandbox rehearsal passed**: one transaction, rolled back, sandbox unchanged ([evidence](https://github.com/popcre/shared-db/issues/4707#issuecomment-7139693997)). Edits to an item, its custom values, a status and the assignee order were applied. A new status on an ERP-less draft was inserted. The held merchandise reference stayed null. The rerun wrote 0 rows. Rollback restored exactly, and the new history stayed.
- **Second-AI review** (Codex, 2 rounds) is recorded on [#196](https://github.com/popcre/designflow-data-syncing/pull/196#issuecomment-7137873417).
- Not started: the production run, the Item Master / Tracking / Backend read paths, and the live role checks.

## 4. What did not work

- **Insert-only copy rerun**: it cannot update or remove rows. That is why the reconcile mode exists.
- **Production copy-job login from 1Password** (item "Supabase Runtime Login - DesignFlow data-sync (production, dflow_prod)") fails: plain username gives "password authentication failed", and username.projectref gives "user not found". The deployed job reads its user from Cloud Run secret `DB_USER_SYNC`; the vault item is stale.
- **Sandbox migration via `designflow-sandbox-migrations.yml`** blocks on the missing `core.merch_group_review_hold`, as expected.
- **Inline DDL in the app rehearsal** was refused by the guard. Use temporary tables only.

## 5. Key findings

- A zero-row DELETE in a data-modifying CTE still needs the DELETE privilege. History tables therefore never get a DELETE step.
- Link tables (assignees, mentions, attachment links) have no UPDATE right. Changed links are saved, deleted, and re-inserted (`replaceChangedLinksSql`).
- An item whose canonical link or eligibility changes, or that leaves the eligible set while its source still exists, makes the whole run refuse. This protects the 489 exclusions and child rows.
- Rollback refuses if a later run touched the same rows. It cannot restore an item-attachment link whose source row is gone; the file itself is kept.
- Comparing `mod_time_date` as text gives false "changed" counts. Use typed comparison.

## 6. Exact next steps

1. Merge [#201](https://github.com/popcre/designflow-data-syncing/pull/201) after its checks pass (`ai-pr-wait 201`). Done when it shows MERGED with `forbid-shared-db-bypass` passing.
2. Verify production promotion of `20261225091301`: query `supabase_migrations.schema_migrations` read-only on production, and check `has_table_privilege('designflow_prod_data_sync_runtime','plm.designflow_reconcile_before_image','INSERT')`. If it is parked or held, use the `shared-db-promotion` repair routes only. Done when the version is in the production ledger. Then close claim #7028.
3. Repair the stale 1Password credential from the Cloud Run secret (`secrets-to-1password` skill). Done when a read-only `select current_user` as the runtime succeeds.
4. Promote the Data Syncing code `sandbox-albert` → `develop` → `main` under GATEKEEPER. Rule 2 needs the rehearsal and the second-AI debate linked on the PR, both of which exist. Rule 1 needs Uma's written approval only for `dflow_prod` changes, and this change only reads `dflow_prod`; say so on the PR. Done when it is deployed to the production job image.
5. Run the production job `popcre-item-header-sync-prod` with `plan`, then `reconcile <digest>` from that plan. Record the run id and counts on #4707. Expect about 19 items inserted, about 17 updated, and new statuses/replies inserted. Done when a fresh `plan` followed by `reconcile` reports 0 writes.
6. Build the read paths in Item Master, Tracking and Backend (plan §6 step 4): a fallback that keeps legacy authoritative, server-side vendor scope, and the 489 legacy lookups. Then verify with real roles in the sandbox, then in production: an authorized vendor, a denied cross-vendor read, an ERP-less draft, held merchandise, milestones, assignees, replies, mentions and attachments, plus Tracking's latest action and reminders. Use the `designflow-e2e-tester` skill.
7. Prove rollback in production with `rollback <runId>` on a run, or explain why not, and post the evidence. Close #4707 only when both unchecked items are verified. Delete this file in that commit.

## 7. Constraints

Production is read-only except through the job and governed promotion, with no manual production DDL. Use one worktree per repo task. Never broaden production permissions for a green check. Keep the original app routes authoritative until the new paths pass. Use EST times. Sign GitHub posts.

## 8. Access

The Supabase MCP is bound to shared production (read-only use). The sandbox DB credentials are in 1Password `vibe_coding` under "Supabase DB Password - DesignFlow non-production shared"; use `pooler_*` fields. The production runtime login is the stale item noted in §4. The `gh` CLI is authenticated as u2giants. The DesignFlow live tester login is "DesignFlow PLM AI tester login - designflow.app LIVE production (sales, read-only)". The production Sales QA login previously returned HTTP 403.

## 9. Risks

Production data keeps changing; always plan, then reconcile with that digest. Rollback keeps new source rows, which is intentional (Codex agreed, 2026-11-24). The read-path switch can hide vendor-visible records if the 489 fallback is skipped.

Self-audit (2026-11-24):
- Q1: Yes, via §1–§3 and §6.
- Q2: Yes; dead ends and findings are in §4–§5.
- Q3: Yes; §3, §6 and §9 carry the evidence links.
- Q4: Yes; a sweep found no owner question, and the Uma rule-1 note is a release-rule fact, not a business ask.
