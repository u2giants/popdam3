# Step 11 enforcement ledger — 2026-07-23

Authoritative plan: [`DB_Data_Admin.md`](../../DB_Data_Admin.md) §10 sub-step 11.  
This ledger records every serialized sub-step, evidence, and remaining gates.

## Shared-db in-flight (start of session)

| Check | Result |
|---|---|
| Open PRs | none |
| Branch base | `origin/main` @ `950f62d` (PR #174 plan rewrite) |
| One schema change | started only after audit |

## 1. Consumer audit

Evidence: [`step11-consumer-audit-20260723.md`](step11-consumer-audit-20260723.md)

| Repo | Key hit | Resolution |
|---|---|---|
| poppim-web | 3× `api.customer_list` | fixed → `api.pm_customer_list` |
| popcrm-web | picker on segment `all`; dead promote RPC | fixed → picker list + retire promote |
| popdam3 | `core.factory` vendor picker; `dam-customer-hub-picker` overlap | vendor → `api.dam_factory_list`; library hub deferred |
| designflow-* | pickers already active-only | master-data export + admin PLM status path (PR open) |

## 2. shared-db: preserve curated customer status

| Item | Evidence |
|---|---|
| Migration | `20260723140000_plm_import_master_data_preserve_customer_status.sql` |
| Test | `supabase/tests/plm_import_master_data_preserve_customer_status.sql` |
| Preview apply | project `rjyboqwcdzcocqgmsyel`; dry-run listed only this migration; apply OK; post dry-run clean |
| Contract | NOTICE OK suffix `924f112c25e6` |
| PR | https://github.com/u2giants/shared-db/pull/175 |
| Merge SHA | `c777d74351dff8e331dcc568952e5d44c5cf83b5` |
| Production | **not promoted** (Step 11 boundary) |
| Detail | [`step11-plm-import-status-preserve-20260723.md`](step11-plm-import-status-preserve-20260723.md) |

## 3. poppim-web (main)

| Item | Evidence |
|---|---|
| Commit | `275bbcd386ec09cea22c8b8b82f6a38eda1a7e67` |
| Callers | `domain/reference/api.ts`, `features/accounts/api.ts`, `features/board/collab.ts` → `pm_customer_list` |
| Error surfacing | `TaskDetailModal` shows retailer load failure (no silent empty) |
| Grep gate | zero `.from('customer_list')` in `src/` |
| Tests | Vitest `pmCustomerList.test.ts` 3 passed |
| Build | `npm run build` OK |

## 4. popdam3 (main)

| Item | Evidence |
|---|---|
| Commit | `b061de29f825134d1bf6e4cf946aa73ba3e70b74` |
| Vendor picker | `fetchFactoryOptions` → `api.dam_factory_list` |
| Customer Styles | already on main via `api.dam_customer_list` + `customer_id` |
| Branch reconcile | `dam-customer-hub-picker` library half **deferred** until production can apply `20260722222000` (after prod head `20260722221700`) under bounded migration protocol |
| factory_id FK | **not** done (separate additive tranche) |
| Tests | `src/test/dam-factory-picker.test.ts` 2 passed |
| Detail | [`../../popdam3 docs`](../../../popdam3/docs/verification/step11-dam-factory-picker-20260723.md) (in popdam3 repo) |

## 5. popcrm-web (main)

| Item | Evidence |
|---|---|
| Commit | `4a2db95aa15768a5ab43576de6d69bc4a49a6fb1` |
| Picker feed | `useCustomerPickerQuery` → `api.crm_customer_picker_list` |
| Historical | `withCurrentCustomer` + `buildRetailerById` keep inactive assigned labels |
| Search | `searchCrm` uses picker list (status-gated) |
| Promote | retired loudly; no `crm.promote_ingested_domain` call |
| Customers tab | hides global hub inactive even if legacy `customer_status` looks active |
| Tests | Vitest `_shared.test.ts` 3 passed |
| Build | `npm run build` OK |

## 6. DesignFlow (sandbox-albert → develop)

| Item | Evidence |
|---|---|
| Repo | `popcre/designflow-backend` |
| Commit | `55de7d4244fafbb8307d962cc11cf47bdd144124` on `sandbox-albert` |
| PR | https://github.com/popcre/designflow-backend/pull/64 (Uma merges) |
| Endpoints | `GET getCustomersForMasterData`, `GET getFactoriesForMasterData`, `PATCH :id/plm-status` (admin) |
| Tests | `masterDataExport.test.js` 4 passed |
| Production writes | **not enabled** |
| Factory source-ref population | export ready; one-time reviewed match **not** executed |
| Other five DesignFlow repos | no picker rewrite required this tranche |

## 7. Cross-app visibility matrix (code-level)

| Record state | CRM | PM | DAM | PLM |
|---|---|---|---|---|
| Global inactive | hidden by picker view | hidden by `pm_customer_list` | hidden by dam views | PLM endpoints still active-only |
| App-only inactive | CRM ext via picker view | PM ext via view | DAM factory via view | PLM status separate |
| Historical assigned | preserved | UUID company_id | customer_id UUID | id-based pickers |
| Merged loser | aliases/source-ref (shared-db) | same | same | via source refs when present |

### Remaining browser evidence (not completed this session)

- Live screenshot of PM TaskDetailModal Retailer picker populated
- Live CRM CommandSearch excluding inactive
- Live DAM Styles vendor dropdown from dam_factory_list
- Assigned-historical + merged-loser UUID resolution fixtures in SQL suite

## Production approval boundary (stop here)

Do **not** without Albert's explicit production window:

- promote `20260723140000` to production
- promote pending DB Data Admin write/merge/tree migrations
- enable production status/merge gates
- run PLM status writes against production DesignFlow
- populate production `core.factory_source_ref` designflow_plm rows without reviewed match
- use `supabase db push --include-all` on production
