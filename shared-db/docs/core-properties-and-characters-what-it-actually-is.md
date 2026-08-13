# `core.properties_and_characters` is NOT a property list

**Owner ruling, 2026-08-13.** Recorded so this is never confused again.

> "10,122 rows is not properties. Properties should be somewhere around 500, so that
> table must be many things together."

He is right, and the database confirms it exactly.

---

## The one-line rule

**`core.properties_and_characters` is a MIXED table. It holds two different kinds of thing
in one pile, distinguished by its `type` column. Never quote its total row count as a
count of properties.**

## What is actually in it

Measured live against production `qsllyeztdwjgirsysgai` on 2026-08-13:

| `type` | rows | distinct names |
|---|---|---|
| `PROPERTY` | **500** | 500 |
| `CHARACTER` | **9,622** | 8,370 |
| **total** | **10,122** | |

So the property count is **500**, not 10,122. The other 9,622 rows are characters, and
they are **appearance rows, not entities** — 9,622 rows carry only 8,370 distinct names,
because the same character appears under more than one property.

### Therefore
- **A count of properties is `where type = 'PROPERTY'`.** It is 500.
- **A count of characters is `count(distinct name) where type = 'CHARACTER'`.** It is 8,370.
- **`count(*)` on this table answers no business question at all.** It is the sum of two
  unrelated things.

## Why this keeps going wrong

The table's name reads as one list. It is not. It is two lists sharing a table, and the
`type` column is the only thing separating them. Every document that has quoted "10,122
properties" took the row count without the filter.

Related and equally important: **there are two disjoint property universes in `core`**, and
they do not reference each other. See issue #865.

| | Universe A | Universe B |
|---|---|---|
| licensor table | `core.licensor` (uuid) | `core."licenseList"` (integer) |
| entity table | `core.property` — **256 rows** | `core.properties_and_characters` — 10,122 rows (**500 properties**) |
| link table | `core.property_character` — **0 rows** | `core.property_character_associations` — 9,622 rows |
| source IDs | **none** | `source_licensed_property_id`, `source_character_id` |

`pg_constraint` confirms they are separate trees: `property_licensor_id_fkey → core.licensor(id)`
and `properties_and_characters_licensor_id_fkey → core."licenseList"("licenseList_id")`.
**There is no foreign key between the two universes.**

So there are really **three** different numbers, and each answers a different question:

| number | what it is |
|---|---|
| **256** | `core.property` — the merch-group/franchise list imported from DesignFlow PLM |
| **500** | the `PROPERTY` rows inside `core.properties_and_characters` |
| **10,122** | the raw row count of a mixed table — **not a property count, not anything** |

## What to write instead

Never write:
- ~~"10,122 properties"~~
- ~~"core.properties_and_characters has 10,122 properties"~~
- ~~"about 10,000 properties to match by hand"~~

Write instead:
- "500 properties and 8,370 distinct characters, held together in
  `core.properties_and_characters` and separated by its `type` column."

## How to check it yourself

```sql
select type, count(*) as rows, count(distinct name) as distinct_names
from core.properties_and_characters
group by type
order by 2 desc;
```

If that ever returns something other than roughly 500 `PROPERTY` rows, the table's grain
has changed and this document needs revisiting — do not silently adopt the new number.
