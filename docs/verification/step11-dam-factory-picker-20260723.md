# Step 11 — PopDAM vendor picker → `api.dam_factory_list`

Date: 2026-07-23  
Repo: `u2giants/popdam3`  
Branch: `main`

## Reconciliation with `dam-customer-hub-picker`

| Topic | Finding |
|---|---|
| Local branch | `dam-customer-hub-picker` @ `4010d328` / app commit `5f2ed815` |
| Styles Customers | **Already on main**: `fetchCustomerOptions` reads `api.dam_customer_list` and writes `customer_id` UUID |
| Library customer hub | Still free-text on main; branch rewires to `useDamCustomerFacets` + `get_path_facets(uuid)` |
| Why not land library half now | Migration `20260722222000_dam_path_facets_by_customer_id` is **after** production head `20260722221700`. Deploying the library rewire before that production apply would break program facets on live DAM |
| Decision | Keep library hub work on the branch until production can take `222200` under the bounded-migration protocol. Do **not** force-merge the whole branch onto main in this tranche |

## This change

- `src/pages/StylesPage.tsx` `fetchFactoryOptions()` now reads **`api.dam_factory_list`** (not `core.factory`).
- Labels use `display_name` when present, else `name`.
- Still persists free-text vendor labels (no `factory_id` column). Stable base-table `factory_id` remains a **separate additive** shared-db tranche per `DB_Data_Admin.md`.
- Unit test: `src/test/dam-factory-picker.test.ts`.

## Grep gate

```text
rg -n "schema\\([\"']core[\"']\\).*from\\([\"']factory[\"']\\)|from\\([\"']factory[\"']\\)" src/pages/StylesPage.tsx
# fetchFactoryOptions path must not match core.factory
```

## Not done here

- Library free-text customer filter → hub (blocked on prod `222200`)
- `public.style_tracker_rows.factory_id` FK
- Production migration promotion
