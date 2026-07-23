# Step 11 consumer audit — 2026-07-23

Evidence for DB Data Admin Step 11 sub-step 1 (serialized §9 audit + in-flight
check). Read-only inspection only; no consumer merges in this document.

## Shared-db in-flight check

| Check | Result |
|---|---|
| Branch | `codex/step11-preserve-plm-customer-status` (from `origin/main` @ `950f62d`) |
| Open PRs | none (`gh pr list` empty) |
| Working tree before work | only untracked `.grok-step11-*` brief/logs (not committed) |
| Latest on-disk migrations | head files through `20260723113100`; production head still `20260722221700` per plan |
| Conflicting schema PR | none |
| One-change rule | this tranche is the only schema change started |

Remote interest heads still present for history only (not open PRs):
`codex/document-step11-findings`, `codex/revise-step11-after-kimi`,
`codex/db-data-admin-runtime-deploy`.

## Consumer repository state

| Repo | Branch | Dirty? | HEAD note |
|---|---|---|---|
| `u2giants/poppim-web` | `main` | clean | shared-db sync chore |
| `u2giants/popcrm-web` | `main` | clean | shared-db sync chore |
| `u2giants/popdam3` | **`dam-customer-hub-picker`** | clean | unmerged customer-hub work — **coordinate before DAM Step 11** |
| `popcre/designflow-backend` | `sandbox-albert` | clean | |
| `popcre/designflow-bff` | `sandbox-albert` | clean | |
| `popcre/designflow-frontend` | `sandbox-albert` | clean | |
| `popcre/designflow-item-master` | `sandbox-albert` | clean | |
| `popcre/designflow-tracking` | `sandbox-albert` | clean | |
| `popcre/designflow-data-syncing` | `sandbox-albert` | clean | |

DesignFlow paths on this machine: `C:\repos\dflow plm\designflow-*`.

## Grep hits and planned fixes

### poppim-web — three dead `api.customer_list` callers (confirmed)

| File | Hit | Fix (sub-step 3) |
|---|---|---|
| `src/domain/reference/api.ts:10` | `.from('customer_list')` | migrate or delete dead `fetchRetailers` |
| `src/features/accounts/api.ts:18` | `.from('customer_list')` | → `api.pm_customer_list` |
| `src/features/board/collab.ts:314` | `.from('customer_list')` | → `api.pm_customer_list`; stop TaskDetailModal swallow |

Also: `TaskDetailModal.tsx` still swallows fetch errors (plan cites `:162`).

### popcrm-web — picker path partially correct; five gaps remain

| Hit | Location | Fix (sub-step 5) |
|---|---|---|
| Client-side global filter + historical row | `src/features/crm/pages/_shared.ts` `isSelectableCustomer` / `withCurrentCustomer` | keep `withCurrentCustomer`; feed from `api.crm_customer_picker_list` |
| Segment feeder | `src/features/crm/queries.ts` via `crm_customer_segment_list('all')` | repoint picker feeder |
| Global search unfiltered | `src/features/crm/api.ts` `searchCrm` (~830+) | gate status |
| Dead RPC | `src/features/crm/api.ts:465` `crm.promote_ingested_domain` | remove/replace; **do not restore ingested-domain→customer association** |
| Generated types still list RPC | `src/lib/database.types.ts` | regenerate or leave until types refresh |

No Vendor picker exists today.

### popdam3 — Customer OK; Vendor gap + branch overlap

| Hit | Location | Fix (sub-step 4) |
|---|---|---|
| Customer already on hub | `src/hooks/useDamCustomers.ts` → `dam_customer_list` | keep |
| Vendor reads `core.factory` | `src/pages/StylesPage.tsx` `fetchFactoryOptions` (~647) | → `api.dam_factory_list` |
| Other direct `core.*` reads | StylesPage packaging/etc. | out of scope unless picker-related |
| Branch overlap | local/checkout on `dam-customer-hub-picker` | **land or reconcile before Step 11 DAM code** |

Stable `style_tracker_rows.factory_id` is a **separate additive** shared-db tranche; not smuggled into the picker visibility fix.

### DesignFlow (six repos) — enforcement already present

Per plan: active-only pickers and stable ids already exist. Step 11 work is
integration plumbing (protected Customer PLM path, Factory export/mapping), not
picker rewrites. Vendor PLM remains blocked on Factory export + source-ref match.

## Resolved environment contract (record)

| Environment | Provider | Port |
|---|---|---|
| Production DesignFlow | Cloud SQL | `5432` |
| Non-production DesignFlow | hosted Supabase `dflow` | pooler `6543` |
| Production mirror-back | cross-system via protected API + master-data sync | never intra-Supabase SQL hop |

## First implementation tranche after this audit

Repair `plm.import_master_data()` so matched re-pulls cannot overwrite curated
`core.customer.status`. Migration
`20260723140000_plm_import_master_data_preserve_customer_status.sql` + test
`supabase/tests/plm_import_master_data_preserve_customer_status.sql`. Preview
only; no production promotion; no PLM sync restart.
