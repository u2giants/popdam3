# Re-verification of the DS → DY plan against live production — 2026-08-29

Issue #505. Companion to [`README.md`](README.md) (2026-08-07, merged in PR #483).
**This file does not replace the plan.** It records what was re-checked against live
state 22 days later, what moved, and what did not.

Database contacted: **production `qsllyeztdwjgirsysgai`** only, confirmed via
`get_project_url` immediately before the reads. Every statement was `select` or a
catalog read. **No write of any kind was issued.** Preview was not contacted.

---

## 1. The plan's one honest blocker is now CLOSED

The 2026-08-07 plan stopped short of a go recommendation for a single reason:

> ⛔ **`popdam3` is not checked out on this machine and was NOT read.** It owns the
> only live write path.

**`popdam3` is now present at `C:\repos\popdam3` (HEAD `e3c41a0`, 2026-08-26) and has
been read.** Findings, searching app source only and excluding its vendored
`shared-db/` mirror:

| What was searched | Result |
|---|---|
| The UUID `10a445bc-cdb8-4384-ad6f-a46fd029f2bc` | **zero hits in app source** (only in the vendored shared-db docs) |
| Any read or write of `public.licensors` | **zero.** `apps/worker/src/handlers/popsg-tags.ts:498` states in-line that the canonical source is core, "NOT the retired public.licensors/properties tables" |
| Any read of `public.licensors.external_id` | **zero.** `src/components/settings/ApisTab.tsx:281` reads `core.licensor` and *aliases* `code` to the name `external_id` for its own view model — it is not the legacy column |
| The legacy taxonomy writer | **retired.** `supabase/functions/sync-external/index.ts` now returns HTTP **410** on every request and contains no `.upsert(`. A repo test (`src/test/core-licensor-property-contract.test.ts`) enforces that it stays retired |

**The literal codes `"DS"` and `"WWE"` do appear** in popdam3, at
`src/components/settings/ApisTab.tsx:29-31`, in a `DEFAULT_SOURCES` list that pairs
each code with a DesignFlow autofill URL. That list is **not** a reader of
`public.licensors`: it is seed configuration for the Taxonomy Source Editor, and the
only thing it drives (`action: "sync-one"`, line 130) posts to the `sync-external`
function that now answers 410. It is dead configuration pointing at a retired
endpoint. **It is unaffected by this change and is deliberately left alone** — editing
it would be an app change in another repo, outside this issue.

## 2. Two new live database consumers exist that the plan did not know about

The plan's §1.3 listed `public.dam_character_catalog` as the sole live reader. A fresh
catalog scan finds **two** additional objects mentioning `public.licensors`:

| Object | How it matches | Reads `external_id`? |
|---|---|---|
| `public.style_tracker_rows_with_bridge` (view) | `LEFT JOIN licensors public_lic ON public_lic.id = b.public_licensor_id` | **No** — joins on `id` |
| `plm.refresh_style_tracker_item_bridge()` (function) | `public_licensor_matches` CTE groups on `lower(regexp_replace(trim(name), …))` | **No** — matches on `name` |

Neither touches the licensor code. **The plan's core claim survives: after this
change `public.dam_character_catalog` remains the only live database object that
reads `public.licensors.external_id`.**

## 3. Facts that held exactly

- All **10** `public.licensors` rows present; `DS` = Disney
  (`10a445bc-…`), `WWE` = WWE (`1e3ebfce-…`), created 2026-03-13, matching the plan.
- `core.licensor` `7d141a6f-…` still has `code = 'DY'`; `7575d1db-…` still has
  `code = 'WW'`.
- **`DY` and `WW` are still free** in `public.licensors` — 0 rows each, so the unique
  index `licensors_external_id_key` cannot be violated.
- **No `WWF` row exists** in `core.licensor`. The only `W` codes are `WB` (Warner
  Bros) and `WW` (WWE). The WWE → WW rename remains a format normalisation inside one
  company, not a merge of two.
- RLS on `public.licensors` is unchanged: `Authenticated read licensors` (SELECT,
  `true`) and `Admin write licensors` (ALL, `has_role(auth.uid(), 'admin')`).
- `public.dam_character_catalog` still carries the `'DS'` / `'WWE'` case expression in
  its stored definition.
- **The §3 no-op simulation was re-run live for all 10 licensors.** Under the view's
  own join expression, every licensor resolves to exactly **1** `core.licensor` row
  both before and after the proposed change. The hard-code degrades to a pass-through,
  and the independent name-matching arm holds too.
- `public.dam_character_catalog` currently returns **162** rows; the migration asserts
  that count is identical after.

## 4. What moved — the denormalised counts shrank

The plan's §2.4 table is stale. Live counts, with table totals stated beside them:

| Table.column | plan, 2026-08-07 | live, 2026-08-29 | table total |
|---|---:|---:|---:|
| `public.assets` `licensor_code = 'DS'` | 30 | **7** | 144,546 |
| `public.assets` `licensor_code = 'DY'` | 30,894 | **6,319** | 144,546 |
| `public.assets` `licensor_code = 'WWE'` | 15 | **15** | 144,546 |
| `public.assets` `licensor_code = 'WW'` | 381 | **79** | 144,546 |
| `public.style_groups` `licensor_code = 'DS'` | 6 | **1** | 10,829 |
| `public.style_groups` `licensor_code = 'DY'` | 2,746 | **1** | 10,829 |

These populations were re-derived between the two dates. **The movement is not caused
by anything in this issue and is not diagnosed here** — it is recorded so nobody reads
the plan's numbers as current. It is flagged as an open question in §6 below.

**The discriminator still works, which is what matters.** All 7 `DS` assets and the 1
`DS` style group carry `licensor_name IS NULL`, `licensor_id IS NULL`,
`is_licensed = false`, and their SKUs are the same artifact shape the plan identified:

```
GF152DSEN01   MCZ6XDSPT01   MWB21DSPT01 (x3)   VDE83HDSUC01   VS162DSPT01
```

**And the guard now tests all three of those columns, not just the name.** An earlier
draft asserted the three-column discriminator in this prose while the migration checked
only `licensor_name IS NOT NULL`. A guard described as stronger than it is gets trusted
at its description, so the guard was widened to match the claim rather than the claim
softened to match the guard: it aborts if any `DS` row in `public.assets` or
`public.style_groups` has a non-null `licensor_name`, a non-null `licensor_id`, or
`is_licensed` anything other than `false`. Re-verified read-only against production
`qsllyeztdwjgirsysgai` on 2026-08-30: **0** of the 7 assets rows and **0** of the 1
style-group row trip the widened guard, so it passes on today's data while genuinely
proving what it says.

All 15 `WWE` assets still carry `licensor_name = 'WWE'` and SKUs containing `WW`, not
`WWE` (`AA036WWSU01`, `AAA36WWSU01`, `CSW1TWWSU01`, …). They are genuine stragglers.

**Scope change against the plan: item 3 is DEFERRED, not delivered.** The plan's §5.1
lists three in-scope statements; the third is the `public.assets` `WWE` → `WW` rider
covering exactly these 15 rows. This migration deliberately drops that rider (see the
note at migration lines 132–137): `public.assets` rows are owned by author claim #1656
under issue #1645, which this lane does not hold. So after this migration applies, the
two `public.licensors` rows are canonical and the 15 `public.assets` rows are still
`WWE`. That is a known, intended, temporary inconsistency — not an oversight, and not
something a reader should infer from the plan's "3 statements" wording.

## 5. Blast radius as enumerated today — and the gaps in it

**Enumerated and cleared:**

| Surface | Status |
|---|---|
| `public.dam_character_catalog` | reads `external_id`; proven no-op live (§3) |
| `public.style_tracker_rows_with_bridge` | joins on `id` — unaffected |
| `plm.refresh_style_tracker_item_bridge()` | matches on `name` — unaffected |
| FK `plm.style_tracker_item_bridge.public_licensor_id` | on `id` — unaffected |
| FK `public.properties.licensor_id` | on `id` — unaffected |
| Every other view/matview/function in `public/core/plm/dam/api/app/crm` | catalog scan for `public.licensors`, `'DS'`, `'WWE'` returns nothing else |
| `popdam3` | read; no reader and no writer of `external_id` (§1) |
| `poppim-web` | read; its `LICENSOR_DISPLAY` map is keyed by lowercase **name** (`wwe`, `disney`), never by code — unaffected |
| `popcrm-web`, `oracle`, the six `designflow-*` repos | no licensor-code hard-code in app source (plan §2.1, unchanged) |
| Migration `20260828232207_wwe_licensor_capture_tables.sql` (new since the plan) | contains no quoted code literal `'WWE'`, `'WW'`, `'DS'` or `'DY'`, and no reference to the objects this change touches (`public.licensors`, `external_id`, `core.licensor`) — no overlap with this change. It *is* named for WWE and its comments and `plm.wwe_*` object names mention WWE throughout; that is why the claim is stated as literals-and-objects rather than as the word. |

**Gaps I could not close — an unenumerated consumer is the risk here:**

1. **`monitor` and `hiclaw` are still not on this machine** and were not searched.
   Neither is known to touch the DAM legacy catalog, but that is an expectation, not a
   verified fact.
2. **Supabase Storage object paths and Edge Function source were not exhaustively
   searched for an embedded `DS`.** popdam3's own `supabase/functions/` tree was
   searched and is clean, but Storage key naming is outside a catalog read.
3. **Anything reading `public.licensors.external_id` over PostgREST from a client not
   in a repository on this machine** — a saved report, a spreadsheet connector, a
   no-code tool — would be invisible to every check above. There is no query log
   analysis behind this statement.
4. **Why the denormalised counts moved** (§4) is not diagnosed.

## 6. Open questions carried forward, not resolved here

- The `public.assets` / `public.style_groups` licensor-code population change between
  2026-08-07 and 2026-08-29 (§4).
- `tools/process-style-guide-licensing-review.mjs:123` uses `'WW'` to mean **Wonder
  Woman** while `core.licensor` uses `WW` for **WWE**. Different namespaces, nothing
  breaks today, still a live trip hazard. Untouched.
- popdam3's dead `DEFAULT_SOURCES` entry (§1) pointing at the retired 410 endpoint.
