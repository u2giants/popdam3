---
issue: 6998
status: BLOCKED
owner: codex/6998-sandbox-handoff
---

# DesignFlow customer source and standalone sandbox rollout

## 0. Business decisions only Albert can make

None. Albert's direction in chat covers the customer source, POP-owned values and inactive-customer verification. The remaining dependency concerns how the standalone test database verifies its historical schema.

## 1. Application and scope

DesignFlow uses ERP customers for item master and production tracking, including existing orders tied to inactive customers. [Shared-db](https://github.com/popcre/shared-db) supplies the shared Supabase database contract. [DesignFlow Data Syncing](https://github.com/popcre/designflow-data-syncing/issues/192) is the app-side dependency in the [shared-data plan](https://github.com/popcre/shared-db/blob/main/plan_shared_data_no_copies_db.md). The scheduled ColdLion API feed lands in `coldlion.customer`. The shared customer record is `plm.erp_customer`, which combines landed ERP values with POP-managed values. Both existing DesignFlow read views now use the shared record in production. Customer lookups use Supabase.

## 2. Goal and authority

[Issue #6998](https://github.com/popcre/shared-db/issues/6998) tracks stage D1. Albert said in this chat, “reconcile the two missing codes and make DesignFlow read from plm.erp_customer. that should be the only customer table that pulls from the landing table. keep our POP-side values and verify the 767 inactive customers before it ships.”

## 3. Delivered production work and remaining sandbox work

- [#7008](https://github.com/popcre/shared-db/pull/7008) initially moved the existing views to the landing projection. [#7013](https://github.com/popcre/shared-db/pull/7013) fixed verification of the table schema move. [#7032](https://github.com/popcre/shared-db/pull/7032) replaced the projection with the shared record. All merged. The [#7032 merge commit](https://github.com/popcre/shared-db/commit/40d759fdb5d3ab0439eb74749c6e5750b458f6a4) contains migration [20261225091206](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261225091206_shared_erp_customer_landing.sql).
- For the initial rollout this session seeded ColdLion feed data into the protected shared rehearsal and standalone sandbox. Both received the earlier #7008 migration. For the #7032 correction, the full shared rehearsal applied the migration successfully. The standalone sandbox attempt was dry-run only and made no writes. Production received the correction via the [automatic production workflow](https://github.com/popcre/shared-db/actions/runs/45444174360).
- [Before production](https://github.com/popcre/shared-db/issues/6998#issuecomment-7138597209) and [live](https://github.com/popcre/shared-db/issues/6998#issuecomment-7138765335), all 767 flagged inactive customers kept their IDs and remained available as inactive. All 838 ColdLion codes were present, including both missing codes. The 836 existing POP link, contact and import records matched, including all 830 POP links. Existing noncontact DesignFlow output matched. The [database reference](https://github.com/popcre/shared-db/blob/main/docs/database-design-and-schema.md) reflects the shipped source.
- The standalone DesignFlow sandbox still has the #7008 views. Its shared customer table had zero rows before cutover. No further sandbox database changes were started during closeout.

## 4. Attempts that failed

The [sandbox dry-run for #7032](https://github.com/popcre/shared-db/actions/runs/45443066610) refused before any apply because it could not find historical migration record `20260716140000`. The shared rehearsal had the historical record and passed. In the sandbox the installed customer importer already matched the historical function definition, but the historical migration also installs a retired vendor importer. Reapplying that migration would restore unrelated retired behavior. The [sandbox orphan-reconciliation workflow](https://github.com/popcre/shared-db/blob/main/.github/workflows/sandbox-ledger-orphan-reconciliation.yml) deletes pinned orphan rows. This case concerns a missing record and a partially superseded historical migration, so that workflow does not cover it. A Google Cloud secret read was denied during earlier investigation. The bounded GitHub sandbox workflow and protected Supabase reads were the working routes.

## 5. Findings

The sandbox has the exact `plm.import_coldlion_customers(jsonb)` historical definition (body digest `bdd7f4c529facf54bbcff941abb3d6da`), while `plm.import_coldlion_vendors(jsonb)` is absent. Compare both against the [historical source](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20260716140000_erp_coldlion_status_app_owned.sql). The dependency must be satisfied through a supported sandbox route that verifies the customer definition and preserves the absent vendor importer.

The last standalone baseline had 838 landing customer codes, 769 inactive codes and 766 of the historically flagged customers retained. The authenticated Tracking customer filters had 51 code entries (digest `d7f89b590df88171`) and 51 description entries (digest `02b4bb02b4dfdfd2`). The production count of 767 belongs to a different environment. Use fresh sandbox evidence for sandbox acceptance.

## 6. Next steps and completion gates

1. Re-read [#6998](https://github.com/popcre/shared-db/issues/6998) and [the sandbox failure](https://github.com/popcre/shared-db/actions/runs/45443066610) from current main. Query the standalone sandbox read-only for the two historical functions, migration record and customer baseline. This step passes when target identity, function equivalence, vendor absence and current baseline are independently established.
2. Check the current [sandbox migration workflow](https://github.com/popcre/shared-db/blob/main/.github/workflows/designflow-sandbox-migrations.yml) and its named preflight tools for a supported prerequisite equivalence route. If none exists, specify the smallest governed sandbox-only change on #6998 under the appropriate task gate. Prove that it accepts only the exact customer dependency and refuses wrong environments or definitions. This step passes when a supported route demonstrably preserves vendor-importer absence and leaves production untouched.
3. Use the sandbox workflow to dry-run the exact correction, allowlist `20261225091206`, source [#7032](https://github.com/popcre/shared-db/pull/7032) and pin current main. Use its successful run to apply the exact same SHA and allowlist. This step passes when the workflow reports the expected ledger delta and catalog proof.
4. Confirm the shared table has the fresh baseline's expected codes, both views source it, the vendor importer remains absent, inactive customers retain IDs and status, POP-owned fields survive, and existing authenticated Tracking customer filters and Item Master customer lookup still work. Compare the Tracking filter counts and digests to a fresh pre-apply capture. Also check the consumer settings view under its normal role. This step passes when those live results are recorded on #6998 and the sandbox checklist is checked. Close #6998 and retire this handoff after that proof.

## 7. Operating constraints

Use [shared-db rules](https://github.com/popcre/shared-db/blob/main/AGENTS.md) and the [current workflow](https://github.com/popcre/shared-db/blob/main/docs/agents/current-workflow.md). Claim exact objects on #6998 if structural work is needed. Keep applied migrations immutable. The sandbox release must use its bounded workflow. Restoring the vendor importer, inventing a history row or editing production by hand would violate the stated conditions. The production correction already has release and live evidence.

## 8. Access and custody

GitHub Actions provides environment-bound credentials for the standalone sandbox. Read-only inspection used protected Supabase access. Secrets live in the team 1Password vault `vibe_coding`. Obtain authorized access through the normal protected injection route. The GitHub issue holds release links and aggregate evidence. No implementation PR or delegated agent remains open for this session. Preserve the session workspace and branches for evidence. The issue retains the existing owner assignment.

## 9. Open questions and risks

The technical blocker is whether the current sandbox tooling can express the exact customer prerequisite without applying the historical vendor change. Baseline counts, GitHub main and migration ledger state can drift. Capture them again before the next attempt. This is the sole unfinished rollout on #6998.

### Handoff self-audit

1. A new developer can resume from §§1–3 and follow the ordered gates in §6.
2. The next developer has the original failure, historical function digest, tested release paths and baseline in §§3–5 and §8.
3. §§2–9 cover authority, verified results, failures, constraints, risks and evidence for each next step. Production and standalone sandbox results are explicit.
4. A sweep of §§1–9 found no decisions that need Albert's judgment. §0 records that outcome.
