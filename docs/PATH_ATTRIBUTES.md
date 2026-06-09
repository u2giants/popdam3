# Path-Derived Attributes: stage / customer / program

Three columns — `stage`, `customer`, `program` — on **both** `assets` and `style_groups` are inferred from the NAS folder a file sits in. They power the Stage / Customer / Program filters and make a search like `Ross Wall 2026` surface every file and group in that program.

Added in migration `20260608110025_add_path_attrs_customer_program_stage.sql` (commit `8c0508d`). This is the single source of truth for the derivation rules; the SQL is authoritative, this doc explains it.

> **Scope (v1):** customer/program are only derived inside the **In Development → Customer Adopted** branch. Assigning customer/program from the subfolders under **Concept Approved Designs** is intentionally deferred — those files get a `stage` but `customer`/`program` stay null.

---

## 1. Where the values come from

The anchor folder is **`____New Structure`** (four leading underscores), which lives under `Decor/Character Licensed/...`. All derivation is positional relative to that segment.

Source field per table:
- `assets.stage/customer/program` ← derived from `assets.relative_path`
- `style_groups.stage/customer/program` ← derived from `style_groups.folder_path`

Both call the same IMMUTABLE SQL function `public.infer_path_attrs(p_path text) RETURNS jsonb`.

### Derivation rules

Let `idx` = position of `____New Structure` in the path segments. If the path has no `____New Structure` segment, all three are NULL.

| Slot | Rule |
|---|---|
| `stage` | the segment **directly after** `____New Structure` (`segs[idx+1]`). Set for **all** files under the anchor. |
| `customer` / `program` | only when `stage = 'In Development'` **and** `segs[idx+2] = 'Customer Adopted'`. Otherwise NULL. |

Inside the `In Development / Customer Adopted` branch, the segment at `idx+3` decides the layout:

| `segs[idx+3]` | customer | program |
|---|---|---|
| a real customer name (e.g. `Ross`) | `segs[idx+3]` | `segs[idx+4]` |
| `_FINISHED` (wrapper bucket) | `segs[idx+4]` with trailing `_finished` stripped (case-insensitive) | `segs[idx+5]` |
| any other `_`-prefixed bucket (`_NOT APPROVED`, `_REJECTED`, `_No Customer`, `_NOT SUBMITTED`, …) | NULL | NULL |
| empty | NULL | NULL |

**Program guard** — the program slot is nulled if it doesn't look like a real program folder:
- matches `\.[A-Za-z0-9]+$` → looks like a filename
- no whitespace **and** matches `^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$` with length ≥ 8 → looks like a SKU code (i.e. there was no program folder, the SKU folder is sitting directly under the customer)

### Worked example

`…/____New Structure/In Development/Customer Adopted/Ross/Ross Wall 2026/CAC62DCJK01/CAC62DCJK01.psd`

→ `stage = "In Development"`, `customer = "Ross"`, `program = "Ross Wall 2026"`.

`_FINISHED` variant: `…/Customer Adopted/_FINISHED/Ross_finished/Ross Wall 2026/CAC62DCJK01/…`
→ same result (`customer = "Ross"`).

---

## 2. Stage vs `workflow_status` — they are NOT the same

This is the most common point of confusion. Both come from the folder path, but they answer different questions and are computed differently.

| | **`stage`** | **`workflow_status`** |
|---|---|---|
| Written by | DB trigger on path insert/update | edge-function ingest code (`_shared/metadata-derivation.ts`) |
| Method | **positional** — the folder directly under `____New Structure` | **scan** — deepest-to-shallowest match against a configurable folder map (`admin_config.WORKFLOW_FOLDER_MAP`) |
| Values | the 5 top-level lifecycle buckets: `In Development`, `Concept Approved Designs`, `Product Ideas`, `Freelancer art`, `Discontinued` | slugs incl. **adoption/approval** states: `customer_adopted`, `licensor_approved`, `in_development`, `concept_approved`, `other`, … |
| Scope | the `____New Structure` tree only | the whole library (old + new structure) |

For the worked example above, `stage = "In Development"` but `workflow_status = "customer_adopted"` — because the deepest-first scan hits `Customer Adopted` before `In Development`. **Stage reports the lifecycle bucket; workflow_status reports the adoption/approval state.** Stage was added precisely because `workflow_status` is ambiguous under the new tree (it conflates lifecycle with approval, and intentionally drops the `Concept Approved Designs` signal under `____New Structure`).

---

## 3. They follow the folder automatically (triggers)

Two `BEFORE` triggers keep the columns in sync — there is no batch step for ongoing maintenance:

- `assets.trg_set_path_attrs` — `BEFORE INSERT OR UPDATE OF relative_path` → `trg_set_asset_path_attrs()`
- `style_groups.trg_set_path_attrs` — `BEFORE INSERT OR UPDATE OF folder_path` → `trg_set_sg_path_attrs()`

When a designer moves a file between folders:
1. The scanner re-ingests; `agent-api` detects the move by `quick_hash` (same content, new path) and runs `UPDATE assets SET relative_path = <new path>` (`supabase/functions/agent-api/index.ts`, move-detection branch). That fires the asset trigger → stage/customer/program recompute.
2. The same ingest calls `assignToStyleGroup`, which upserts the `style_group` with `folder_path` recomputed from the new path (`onConflict: sku`) → fires the group trigger → the group's attributes recompute.

Caveats:
- Recompute relies on **move-detection by content hash**. If the file's content also changed (new `quick_hash`) at the same time as the move, it's treated as a new insert (still correct attributes via the INSERT trigger), and the old row lingers until reconciled/deleted.
- **Group attributes are last-writer-wins.** `style_groups` is keyed by SKU; `folder_path` is overwritten by whichever member file was ingested most recently. If a SKU's files straddle stages mid-transition, the group shows wherever the last-ingested file landed — not a majority.

The existing ~100k rows were backfilled once via batched `UPDATE`s after the DDL (see [project memory on backfill batching]; large single-statement backfills on `assets` time out and can crash the compute).

---

## 4. Filters, search, and facets

- **Filters:** `src/types/assets.ts` (`STAGE_OPTIONS`, `AssetFilters.stage/customer/program`); applied in `src/hooks/useAssets.ts` and `src/hooks/useStyleGroups.ts` (`.in("stage", …)`, `.eq("customer", …)`, `.eq("program", …)`).
- **Search:** the library search `.or()` matches `filename`, `program`, and `customer` (PostgREST reserved chars `(),` are stripped from the term first), so `Ross Wall 2026` returns its files and groups.
- **Filter combos (customer/program dropdowns):** `get_path_facets(p_customer text DEFAULT NULL) RETURNS jsonb` — returns distinct `customers` and `programs` with group-level counts; programs are scoped to the selected customer. Consumed by `usePathFacets()` in `useAssets.ts`. SECURITY DEFINER, STABLE, granted to `anon, authenticated`.
- **Facet counts:** `get_filter_counts(jsonb)` (migration `20260608110908`) parses `stage`/`customer`/`program`, applies them to every facet subquery, and emits a `stage` facet for the checkbox group.

---

## 5. Indexes

btree on `stage`, `customer`, `program` for both `assets` and `style_groups`; plus GIN trigram (`gin_trgm_ops`) on `assets.program` and `assets.customer` to back the `ILIKE` search.

---

## 6. Generated TypeScript types

`src/integrations/supabase/types.ts` (auto-generated, and `.claudeignore`d) now includes these columns on `assets` and `style_groups`, plus the `get_path_facets` and `infer_path_attrs` function signatures — regenerated by the deploy-supabase types job in commit `bf3ae86`. The feature initially shipped before that regen ran, so the frontend still uses a few `as any` casts (e.g. `(asset as any).stage`, `(supabase.rpc as any)("get_path_facets", …)`). Those casts are now redundant and can be tightened to the generated types when next touching those files — they are correct as-is, not a bug.

---

## 7. Verify against the live DB

```sql
-- columns exist on both tables
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('assets','style_groups')
  AND column_name IN ('stage','customer','program') ORDER BY 1,2;

-- population (prod, 2026-06-08): with_stage≈95k, with_customer≈35k, with_program≈34k
SELECT count(*) FILTER (WHERE stage IS NOT NULL)    AS with_stage,
       count(*) FILTER (WHERE customer IS NOT NULL) AS with_customer,
       count(*) FILTER (WHERE program IS NOT NULL)  AS with_program
FROM public.assets WHERE is_deleted = false;

-- spot-check the derivation on any path
SELECT public.infer_path_attrs('Decor/Character Licensed/____New Structure/In Development/Customer Adopted/Ross/Ross Wall 2026/CAC62DCJK01/CAC62DCJK01.psd');
```
