# Prepack exclusion: re-derivation before implementing issue #2611

**Date:** 2026-09-11. **Target:** production, project ref `qsllyeztdwjgirsysgai`,
read-only. **Issue:** #2611.

This note records the probes, not their answers. Per
`docs/business-rules/AGENTS.md` §4.3 a measured count must never be pasted into a
document as a standing fact: run the query to get today's number. Where a number
appears below it is dated and attached to the query that produced it, because the
decision it drove has to be auditable.

## Why this was re-derived at all

Issue #2611 was filed against `public.erp_items_current.prepack_code` as the head
marker. The standing instruction is to verify an issue's premise before building
on it. The premise did not survive.

## 1. Is the exclusion already implemented?

Scan every non-system function body, view and materialized view for the concept:

```sql
select n.nspname, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prokind = 'f'
  and n.nspname not in ('pg_catalog','information_schema')
  and p.prosrc ~* '(prepack|pre_pack|assortment)';

select table_schema, table_name
from information_schema.views
where table_schema not in ('pg_catalog','information_schema')
  and view_definition ~* '(prepack|pre_pack|assortment)';
```

**Answer on 2026-09-11: not implemented.** The matches are DAM-order objects and
`api.plm_item_list`; none of them filters a missing-Licensor or missing-Property
population. Note that issue #2611's claim that a `pg_proc` scan "returned empty"
is itself inaccurate — it returns unrelated matches. The conclusion is the same.

## 2. Is `erp_items_current` a head marker?

```sql
select
  count(*) filter (where e.prepack_code is not null) as prepack_rows,
  count(*) filter (
    where e.prepack_code is not null
      and exists (select 1 from coldlion.prod_history_component c
                  where btrim(c.prepack_item_no) = btrim(e.item_number))
  ) as live_heads,
  count(*) filter (
    where e.prepack_code is not null
      and exists (select 1 from coldlion.item_detail d
                  where btrim(d.item_no) = btrim(e.item_number)
                    and nullif(btrim(d.pre_pack_code),'') is not null)
  ) as live_members
from public.erp_items_current e;
```

**Answer on 2026-09-11: no.** Of 1,454 prepack rows, 1,437 are live prepack
**members** and exactly 1 is a live head. `erp_items_current` is a frozen
DesignFlow snapshot (`source_system = 'designflow'`, last synced 2026-05-21), so
its low Property-resolution rate is an artefact of age, not of role. It is also
being retired by issue #2482. The implementation therefore does not reference it,
and `docs/business-rules/product-items-and-identifiers.md` has been corrected.

## 3. What is the authoritative head test?

```sql
-- grain: is the component table a head -> member explosion, or a flag?
select count(*) filter (where btrim(sub_item_no) = btrim(prepack_item_no)) as self_referencing,
       count(*) as head_bearing_rows
from coldlion.prod_history_component
where nullif(btrim(prepack_item_no),'') is not null;
```

**Answer on 2026-09-11: it is a flag, not an explosion.** Every head-bearing row
is self-referencing, so each head has exactly one "component" — itself. This is
the trap in this table: read as an explosion it invites the conclusion that the
head/member labels are inverted, on a false grain. The table attests *that* an
ordered item is a prepack head; it does not enumerate members.

Members come from `coldlion.item_detail.pre_pack_code`. Corroboration that the
roles are the right way round:

```sql
-- head codes vs member codes, and items holding both roles
-- inventory as an alternative head source
select count(*) filter (where nullif(btrim(prepack_code),'') is not null) from coldlion.inventory;
-- order lines should carry MEMBER codes
select count(*) from coldlion.order_history_line l
where nullif(btrim(l.pre_pack_code),'') is not null
  and exists (select 1 from coldlion.item_detail d
              where btrim(d.pre_pack_code) = btrim(l.pre_pack_code));
```

On 2026-09-11 head codes and member codes overlapped in zero codes and four
items; `coldlion.inventory.prepack_code` was populated on **no** row, which
retires it as a head source and falsifies the claim previously made in
`product-items-and-identifiers.md`; and every order line carrying a prepack code
matched a member code.

## 4. What does the exclusion actually remove?

The documented chain in
[`unmapped-licensor-population.md`](unmapped-licensor-population.md) applies the
non-licensed-division exclusion **first**, and that ordering is load-bearing:

```sql
select coalesce(i.raw ->> 'divisionCode','(none)') as division,
       count(*) as missing_attribution,
       count(*) filter (where plm.prepack_role(i.item_number,
                                               i.raw ->> 'companyCode',
                                               i.raw ->> 'divisionCode') = 'head') as heads,
       count(*) filter (where plm.prepack_role(i.item_number,
                                               i.raw ->> 'companyCode',
                                               i.raw ->> 'divisionCode') = 'member') as members
from plm.item i
where i.licensor_id is null or i.property_id is null
group by 1 order by 2 desc;
```

On 2026-09-11 this reproduced the settled document's licensed-division figure of
**2,016** exactly, which is an independent validation of that document. Within
those 2,016 the prepack exclusion removes **1,770**, leaving **246**. The
document recorded 214 on 2026-09-07, so the population has moved; that is a
separate matter and is not addressed here.

**The material finding, and the reason the issue was re-scoped.** #2611 is framed
entirely around heads. In licensed divisions heads contribute only **7** rows —
members contribute **1,763**. Almost all apparent heads (954 of 961) sit in
EH001/EP001, which the division rule removes anyway. Head coverage is not the
problem. The implementation therefore excludes **both** roles behind one
function, and the regression guard covers both.

Ongoing measurement: count `plm.item_missing_attribution` and group by
`plm.prepack_role`. Do not re-derive by hand.

## 5. The regression fixture

The seven heads that sit in a licensed division and are missing attribution today
are the only useful fixture — an EH001 head proves nothing, because the division
rule would exclude it regardless of whether the prepack filter works:

```sql
select i.item_number
from plm.item i
where (i.licensor_id is null or i.property_id is null)
  and i.raw ->> 'divisionCode' in ('CW001','SP001')
  and plm.prepack_role(i.item_number, i.raw ->> 'companyCode',
                       i.raw ->> 'divisionCode') = 'head';
```

On 2026-09-11: `AA814DYCR01`, `AAH62NBEX01`, `AAH62WBLB01`, `VF122FKFK01`,
`VF122FKFK02`, `VF122FKFK03`, `VFS22FKFK01` — all company `EDGEHOME`, division
`CW001`. These are carried in `scripts/check-prepack-exclusion.mjs`.

## 6. Object-claim collision check

Open claim #2778 holds `api.plm_item_list` and `public.erp_items_current`. Neither
is referenced by this change, by design.
