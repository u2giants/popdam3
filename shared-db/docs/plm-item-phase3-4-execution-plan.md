# PLM item migration — Phase 3 & Phase 4 execution plan

**Repo:** `u2giants/shared-db` · **Issue:** #853 (claim #857) · **Status:** PLAN ONLY — NOTHING HERE HAS BEEN EXECUTED
**Parent document:** [`fix_schema_for_api.md`](../fix_schema_for_api.md) §6, Phases 3–4
**Written:** 2026-08-12 · **Verified against:** production `qsllyeztdwjgirsysgai` (read-only) and preview `rjyboqwcdzcocqgmsyel`

> **This document is a proposal for the owner.** It authorises nothing. Phases 3 and 4
> move real data and repoint a real foreign key; both are owner-gated. Every number below
> was measured, not quoted — re-measure before acting, because they move.

---

## 0. The finding that changed the shape of this work

**Phase 2 is already shipped.** It was believed pending because `fix_schema_for_api.md`
still lists it that way. It is not.

`plm.item_import` and `plm.import_item_master_data()` have existed in **production and
preview since 2026-07-20**, delivered by the *item-taxonomy* workstream
(`fix_item_taxonomy_wiring.md`) via migrations:

- `20260720120000_item_taxonomy_phase2a_foundation.sql`
- `20260720121000_item_taxonomy_phase2b_resolver.sql`

Both versions are in both ledgers. A new Phase 2 migration was therefore **not authored**;
writing one would have re-created or diverged from a live contract.

### The shipped shape differs from what the plan asked for

| | `fix_schema_for_api.md` line 339–345 asked for | What actually shipped 2026-07-20 |
|---|---|---|
| Mirror key | `(source_system, source_id)` | `(company_code, division_code, item_no)` |
| Sync linkage | a `sync_run_id` column on the mirror | written to `ingest.sync_run` + `ingest.raw_record` by the resolver |
| Resolver signature | `plm.import_item_master_data(p_sync_run_id uuid)` | `plm.import_item_master_data(import_payload jsonb)` |
| Staging | not specified | extra `plm.item_import_staging` sweep table |
| Source label | open decision (`coldlion` vs `designflow`) | **decided in code: `'coldlion'`** |

The shipped design is defensible and in several ways stronger (it carries sweep-sanity
guards the plan never asked for). But the divergence is **exactly** what makes Phase 3
harder than the parent document assumes — see §2.

Contract tests pinning the deployed behaviour:
[`supabase/tests/plm_item_import_phase2_contracts.sql`](../supabase/tests/plm_item_import_phase2_contracts.sql).
Preview run 2026-08-12: **28 passed / 0 failed**.

---

## 1. The hazard this whole plan exists to neutralise

`public.erp_items_current.id` values are **random UUIDs** (`default gen_random_uuid()`).
They are **not** derived from anything in the source system, so they **do not survive a
truncate-and-re-pull** — a re-pull assigns entirely new ones.

`plm.style_tracker_item_bridge.erp_item_id` is foreign-keyed to that column
**`ON DELETE SET NULL`** — confirmed from the catalog, not from a document:

```
FOREIGN KEY (erp_item_id) REFERENCES erp_items_current(id) ON DELETE SET NULL
```

**Therefore a careless cutover silently NULLs bridge rows and raises nothing at all.**
There is no error, no constraint violation, no failed migration. The style tracker simply
loses its item links, and the only symptom is a screen that looks emptier than it did
yesterday. Row counts on the bridge table stay identical, so a count-based check passes.

**The mitigation, and it is already structurally in place:** resolution must happen on a
**durable** key, never on an `erp_items_current.id`. `plm.item` carries
`UNIQUE (source_system, source_id) NULLS NOT DISTINCT`, and the shipped resolver upserts
on exactly that pair. So `plm.item.id` is allocated once and never re-allocated across
re-pulls. That property is what makes a Phase 4 FK repoint provable rather than hopeful.

---

## 2. The Phase 3 blocker: the two key spaces do not match

This is the single most important technical fact in this document, and the parent plan
does not anticipate it.

- The shipped resolver builds the canonical key as a **composite**:
  `plm.item.source_id = companyCode || '|' || divisionCode || '|' || itemNo`,
  with `source_system = 'coldlion'`.
- `public.erp_items_current.external_id` is a **bare item number** —
  e.g. `VDR83DYLS01`, `VDP83ABSUC01`. Measured: **0 of 17,703** values contain a `|`.

So `erp_items_current.external_id` and `plm.item.source_id` **cannot be joined directly**.
Backfilling `plm.item` from the legacy table requires deriving a `companyCode` and a
`divisionCode` for every one of the 17,703 legacy rows.

What we know:
- `erp_items_current.division_code` exists as a column — a candidate source for the
  division component. **Its completeness has not been verified and must be** (step 3.2).
- `company_code` has **no column at all** in `erp_items_current`. The ColdLion company is
  believed to be the constant `EDGEHOME`, per `plm.erp_customer.company_code` usage and
  the customer/vendor importers. **This is an assumption and is owner decision D3.**
- `external_id` **is unique** across all 17,703 legacy rows, so a 1:1 mapping is at least
  *possible*. Uniqueness of the derived triple is a separate proof (step 3.3).

If any legacy row cannot be mapped to exactly one triple, that row's bridge links cannot
be repointed safely, and Phase 4 must not proceed for it.

---

## 3. Phase 3 — populate `plm.item` (the one real data move)

**Target: 17,703 rows in `plm.item`; every non-dismissed legacy item resolving to exactly
one `plm.item`.**

Current measured baseline (preview, 2026-08-12):

| Object | Rows |
|---|---:|
| `public.erp_items_current` | 17,703 |
| ...of which `dismissed = true` | **0** |
| `plm.item` | 0 |
| `plm.item_import` | 0 |
| `plm.item_import_staging` | 0 |
| `plm.style_tracker_item_bridge` | 15,533 (production: 15,619) |
| ...with `erp_item_id IS NOT NULL` | 13,701 (production: 13,700) |

Note the preview/production bridge counts differ. **Re-measure both immediately before
executing; never carry these numbers forward.**

### 3.0 Preconditions (all must hold before starting)

- Owner has answered every decision in §5.
- A snapshot of `plm.style_tracker_item_bridge` exists (§4.1) — taken *before* any write.
- Preview and production ledgers are reconciled. **Today they are not:** preview is
  missing 7 migrations that sort before its newest version, including
  `20260810140000` and `20260810180000` which ARE on production. `supabase db push`
  refuses without `--include-all`. Rehearsing Phase 3 on a preview that does not match
  production proves less than it appears to.

### 3.1 Choose and fix the source strategy — **owner decision D1**

Either keep sourcing through the dflow item API, or pull ColdLion `/items` directly. The
shipped resolver already hard-codes `source_system = 'coldlion'`, so the decision is
partly made in code; confirm it deliberately rather than inheriting it.

### 3.2 Prove the division mapping is complete

```sql
-- Every legacy row must have a division. Any NULL is an unmappable row.
select count(*) filter (where division_code is null) as missing_division,
       count(*)                                     as total
from public.erp_items_current;
```

**Gate:** `missing_division = 0`. If not, list the offenders and stop; do not guess.

### 3.3 Prove the derived triple is unique and total

```sql
-- Candidate mapping. 'EDGEHOME' is decision D3 — do not hard-code it before it is agreed.
with mapped as (
  select id,
         external_id,
         'EDGEHOME' || '|' || division_code || '|' || external_id as derived_source_id
  from public.erp_items_current
)
select count(*)                             as rows_total,          -- expect 17703
       count(derived_source_id)             as rows_mapped,         -- expect 17703
       count(distinct derived_source_id)    as distinct_keys        -- expect 17703
from mapped;
```

**Gate:** all three equal, and equal to the live `erp_items_current` count. Any shortfall
is an unmappable or colliding row. **Stop on any mismatch.** A collision here is precisely
what would collapse two legacy items into one canonical item and silently drop a bridge link.

### 3.4 Load the pipeline

Run the **live sweep** through the shipped path rather than hand-writing rows:
`ColdLion /items` → `plm.import_item_master_data(import_payload)` with
`terminalReached: true` and the default `minimumSilverRatio`. The resolver populates
`ingest.sync_run`, `ingest.raw_record`, `plm.item_import_staging`, `plm.item_import`, and
upserts `plm.item`.

This is preferable to a hand-built backfill because the sweep-sanity guards (empty sweep,
zero-row division, ratio band, division-coverage) are only exercised on the real path.
Those guards are verified working — see the contract tests.

**Run on preview first.** Capture the resolver's returned counters
(`rows_seen, rows_inserted, rows_updated, rows_resolved, rows_partially_resolved,
rows_ambiguous, rows_unresolved`).

### 3.5 Reconciliation proof (this is the gate, not the counters)

```sql
-- (a) Canonical coverage: every legacy item has exactly one canonical row.
select count(*) as legacy_rows,
       count(i.id) as resolved_rows,
       count(*) - count(i.id) as UNRESOLVED   -- MUST be 0
from public.erp_items_current e
left join plm.item i
  on i.source_system = 'coldlion'
 and i.source_id = 'EDGEHOME' || '|' || e.division_code || '|' || e.external_id;

-- (b) No canonical row serves two legacy items.
select source_id, count(*) from plm.item
where source_system = 'coldlion' group by source_id having count(*) > 1;   -- MUST be empty

-- (c) No orphan canonical rows invented from nowhere.
select count(*) from plm.item i
where i.source_system = 'coldlion'
  and not exists (select 1 from public.erp_items_current e
                  where 'EDGEHOME' || '|' || e.division_code || '|' || e.external_id = i.source_id);

-- (d) Ambiguity was FILED, not guessed.
select count(*) from ingest.dedupe_candidate
where entity_schema = 'plm' and entity_table = 'item' and resolved_at is null;
```

**Gates:** (a) UNRESOLVED = 0 and `resolved_rows` = 17,703; (b) empty; (c) 0 or every row
explained; (d) reviewed by a human before Phase 4 — a non-zero queue is not a failure, but
it is a decision.

### 3.6 Migrate the `dismissed` flag — **owner decision D2**

`dismissed` is **our** curation flag, not ColdLion's, and it deliberately does not exist
on `plm.item_import` (a truncate-and-replace mirror). It currently has **0 rows set to
true**, so today this is free. It will not stay free. Decide its canonical home *now*:
a column on `plm.item`, or a small side table keyed on `plm.item.id`.

**Reversible:** stop reading the new tables. The legacy path is untouched and remains
authoritative throughout Phase 3.

---

## 4. Phase 4 — cut over reads and repoint the bridge FK

**Do not begin until every Phase 3 gate has passed and the owner has signed off.**

### 4.1 Snapshot first — non-negotiable

```sql
create table plm.style_tracker_item_bridge_prephase4_snapshot as
  select * from plm.style_tracker_item_bridge;

select count(*) as snapshot_rows,
       count(erp_item_id) as snapshot_linked
from plm.style_tracker_item_bridge_prephase4_snapshot;
```

Record both numbers. **This snapshot is the only thing that can undo a silent NULLing.**

### 4.2 The BEFORE proof

```sql
select count(*)                                  as bridge_rows,
       count(erp_item_id)                        as linked_rows,
       count(*) - count(erp_item_id)             as already_null
from plm.style_tracker_item_bridge;

-- Every currently-linked bridge row must have a resolvable canonical target.
-- If this is not 0, repointing WILL lose links. Stop.
select count(*) as WOULD_BE_ORPHANED
from plm.style_tracker_item_bridge b
join public.erp_items_current e on e.id = b.erp_item_id
left join plm.item i
  on i.source_system = 'coldlion'
 and i.source_id = 'EDGEHOME' || '|' || e.division_code || '|' || e.external_id
where i.id is null;
```

**Gate: `WOULD_BE_ORPHANED = 0`.** This is the check that the parent document's "verify
zero orphaned/nulled bridge rows" reduces to, and it must be run **before** any DDL.

### 4.3 The repoint procedure

In **one transaction**, in this order. Order matters: add the new column and backfill it
*before* dropping the old constraint, so the mapping is materialised while the old links
still exist.

1. `alter table plm.style_tracker_item_bridge add column item_id uuid;`
2. Backfill `item_id` by joining through `erp_items_current` on the **durable** key
   (never on `erp_items_current.id` as a persisted value):
   ```sql
   update plm.style_tracker_item_bridge b
      set item_id = i.id
     from public.erp_items_current e
     join plm.item i
       on i.source_system = 'coldlion'
      and i.source_id = 'EDGEHOME' || '|' || e.division_code || '|' || e.external_id
    where e.id = b.erp_item_id;
   ```
3. **In-transaction assertion — abort if it fails:**
   ```sql
   do $$
   declare v_lost integer;
   begin
     select count(*) into v_lost
       from plm.style_tracker_item_bridge
      where erp_item_id is not null and item_id is null;
     if v_lost > 0 then
       raise exception 'ABORT: % bridge rows would lose their link', v_lost;
     end if;
   end $$;
   ```
4. Add the new FK: `item_id references plm.item(id)`. **Use `ON DELETE RESTRICT`, not
   `SET NULL`** — the whole reason this migration is dangerous is that the old FK failed
   silently. Do not reproduce that property on the new one. (**Owner decision D4.**)
5. Repoint `public.product_category_predictions` the same way.
6. Drop the old `erp_item_id` FK **only after** the assertion passes. Keep the *column*
   through the soak period so the mapping stays inspectable; drop it in Phase 5.

### 4.4 The AFTER proof

```sql
select count(*)                        as bridge_rows,      -- MUST equal the BEFORE count
       count(item_id)                  as linked_rows,      -- MUST equal BEFORE linked_rows
       count(*) - count(item_id)       as null_links
from plm.style_tracker_item_bridge;

-- Zero-tolerance: no row that was linked before is unlinked now.
select count(*) as REGRESSED
from plm.style_tracker_item_bridge_prephase4_snapshot s
join plm.style_tracker_item_bridge b using (id)
where s.erp_item_id is not null and b.item_id is null;      -- MUST be 0

-- No dangling canonical references.
select count(*) as DANGLING
from plm.style_tracker_item_bridge b
where b.item_id is not null
  and not exists (select 1 from plm.item i where i.id = b.item_id);   -- MUST be 0
```

**All three gates must pass in the same session as the change.** `REGRESSED = 0` is the
before-and-after proof of zero orphaned or NULLed bridge rows.

### 4.5 Then, and only then, cut over reads

Rebuild `api.plm_item_list` on `plm.item`, and repoint
`plm.refresh_style_tracker_item_bridge()` (deliberately deferred from Phase 1 to here).
Verify the PopDAM style tracker and category predictions **visually**, not by row count —
a view can return the right number of wrong rows.

**Reversible:** point `api.plm_item_list` back at `public.erp_items_current`; restore the
bridge from the §4.1 snapshot. Do not drop any legacy table in Phase 4; that is Phase 5,
after a soak.

---

## 5. Owner decisions required before Phase 3 starts

| # | Decision | Why it cannot be assumed | Recommendation |
|---|---|---|---|
| **D1** | Source strategy: dflow item API vs ColdLion `/items` direct — and the resulting `source_system` label | The shipped resolver already hard-codes `'coldlion'`. Leaving this implicit means the label was chosen by whoever typed fastest, and it is the join key for every future source-ref. | Confirm `'coldlion'` explicitly and record it, since the live code already commits to it. |
| **D2** | Canonical home for `dismissed` — column on `plm.item`, or a side table | It is our curation flag; a re-pull must not clobber it. Free today (0 rows set), expensive later. | Side table keyed on `plm.item.id`, so the canonical row stays a faithful mirror. |
| **D3** | Is `company_code` the constant `'EDGEHOME'` for all 17,703 legacy items? | `erp_items_current` has **no** company column. The canonical key is a composite that includes it. If this constant is wrong, **every** canonical key is wrong. | Verify against ColdLion before the backfill. Do not hard-code until confirmed. |
| **D4** | New bridge FK action: `ON DELETE RESTRICT` (recommended) vs `SET NULL` (status quo) | `SET NULL` is the exact property that lets a bad cutover fail silently. Keeping it preserves the trap. | `RESTRICT` — make future mistakes loud. |
| **D5** | Reconcile the preview ledger with production before rehearsing | Preview is missing 7 migrations that production has, so a preview rehearsal does not prove a production outcome. `db push` requires `--include-all`, which would apply other sessions' work. | Reconcile deliberately, coordinated by the orchestrator, before any Phase 3 rehearsal. |
| **D6** | `plm.production_order_import` (Phase 2 item 2) is still genuinely unbuilt | It was excluded here because the production-order surface is claimed by a concurrent workstream (#856). It remains outstanding and unowned by this plan. | Assign it explicitly; do not let it fall between the two claims. |

---

## 6. Known defects found while verifying Phase 2 (not fixed here)

Both were found by running the contract tests, not by reading code. Neither is a
data-safety emergency; both are recorded so nobody "verifies" behaviour that cannot occur.

1. **Dead-code guard in `plm.import_item_master_data`.** The explicit
   `raise exception 'items payload contains a row missing companyCode, divisionCode, or itemNo'`
   sits *after* the insert into `plm.item_import_staging`, whose columns are `NOT NULL`.
   The insert raises `23502` first, so the hand-written message is unreachable. Observable
   behaviour is still correct (refuse and roll back), so this is a clarity defect.

2. **No in-body privilege guard on `plm.import_item_master_data`.** It is
   `SECURITY DEFINER` with no role check whatsoever. Its *only* defence is the absence of
   `EXECUTE` grants — verified: no `anon`, `authenticated`, or `PUBLIC` grant exists today.
   That is currently sufficient but fragile; a single future `grant execute` would open it
   with nothing else standing in the way. If a guard is ever added, it must require a
   **non-null** role and a **positive** match. A guard shaped
   `if not ( ... or auth.role() = 'service_role' ) then raise` never fires when
   `auth.role()` is NULL — it reads strict and behaves open.

---

## 7. What was deliberately NOT done

- **No Phase 2 migration was authored or applied.** Phase 2 is already live; a second
  definition would have dropped or diverged from a working contract.
- **Nothing was applied to production.** Production was read only, through the read-only
  MCP, to establish the facts above.
- **Nothing in this document was executed** — no data moved, no backfill, no FK repointed,
  no view rebuilt, nothing dropped or renamed.
- `api.plm_item_list`, `plm.style_tracker_item_bridge`, and every legacy `public.erp_*`
  table are untouched, and the contract tests assert they stay that way.
