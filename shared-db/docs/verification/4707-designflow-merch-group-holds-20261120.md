---
summary: "Production proof and a read-only check for every DesignFlow merchandise-group ID held before item migration #4707."
kind: proof
status: done
read-when: "Mapping DesignFlow item merchandise groups or rechecking which source IDs must stay parked."
---

# DesignFlow merchandise-group holds for the item migration

[Item migration #4707](https://github.com/popcre/shared-db/issues/4707) uses the ColdLion merchandise-group hierarchy delivered under [#4706](https://github.com/popcre/shared-db/issues/4706#issuecomment-7024323839). ColdLion owns the identity. A DesignFlow ID can attach only when one DesignFlow record and one ColdLion record share company, division, type, category and code.

## Production check on November 20, 2026, 9:58 AM EST

All **4,417** DesignFlow IDs were accounted for. **1,318** were already attached and **3,099** were held. Zero IDs were both attached and held. Every held ID got one disposition from the current sources. **Zero** qualified for attachment, so all 3,099 are explicitly parked in the existing hold table. No database changes were made.

| Reason to keep parked | IDs | Active in DesignFlow |
| --- | ---: | ---: |
| Multiple DesignFlow IDs share the same full ColdLion identity | 1,458 | 920 |
| Category missing in DesignFlow | 1,525 | 146 |
| Division missing in DesignFlow | 42 | 1 |
| Retired division EP001 | 49 | 0 |
| Code appears in one other category for the same company, division and type | 11 | 8 |
| Code appears in multiple other categories for the same company, division and type | 10 | 9 |
| Company, division or type missing from the feed | 1 | 1 |
| Code absent for the same company, division and type | 3 | 3 |
| **Total** | **3,099** | **1,088** |

The 1,458 duplicate IDs still point to the same 627 canonical candidates recorded under #4706. The stored peer counts agree with DesignFlow. Of those 627 groups, 479 have one active DesignFlow ID, 145 have multiple active IDs, and three have none. Active status cannot identify which legacy ID an item used or establish that a duplicate can be retired.

Of the 1,525 rows without a category, 83 have a single four-field candidate, one has several, and 1,441 have none. Category is part of identity, so a four-field candidate does not supply a mapping. The live ColdLion landing feed had 1,991 values, one more than the 1,990 canonical values loaded under #4706. The extra value had no full match among the 3,099 held IDs.

## Item migration boundary

Keep the current holds until source evidence establishes a full one-to-one identity or an approved mapping explicitly addresses the affected legacy item references. Before item mapping, run the check again against the current production sources and reconcile any changes. Resolve attached IDs through the canonical bridge. Exclude every held ID from automatic mapping and account for any affected item slots during the migration. Track item mapping, migration delivery and live application acceptance on #4707.

## Repeat the read-only check

Use the approved production read-only identity on the verified shared Supabase target. The query derives one disposition per live hold and prints only counts. For an authorized investigation, the final summary can be replaced by `select dflow_mg_id, disposition from checked order by dflow_mg_id;` inside the approved private evidence boundary.

The verified set has 3,099 rows and 3,099 distinct IDs. The SHA-256 of the newline-separated entries `ID:disposition`, in ascending numeric ID order with no trailing newline, was `d7813db0771b2a092b48c846fcdb900049ca0a8f95f595d00203399fe7d79630`.

```sql
begin read only;
with df as (
 select d.*, count(*) over(partition by "companyCode_fk","divisionCode_fk","mgTypeCode","mgCategory",mg_code) as peers
 from dflow_prod."merchGroup" d
), checked as (
 select h.dflow_mg_id, h.reason, h.shared_with_count, d.peers, d.is_active,
 case
  when d.mg_id is null then 'DesignFlow ID missing'
  when d."divisionCode_fk"='EP001' then 'retired division'
  when nullif(btrim(d."divisionCode_fk"),'') is null then 'missing division'
  when nullif(btrim(d."companyCode_fk"),'') is null then 'missing company'
  when nullif(btrim(d."mgTypeCode"),'') is null then 'missing type'
  when nullif(btrim(d.mg_code),'') is null then 'missing code'
  when f.mg_code is not null and d.peers > 1 then 'duplicate full identity'
  when f.mg_code is not null then 'unique full identity; review for attachment'
  when nullif(btrim(d."mgCategory"),'') is null then 'missing category'
  when t.n > 1 then 'code appears in multiple other categories'
  when t.n = 1 then 'code appears in one other category'
  when not exists (
    select 1 from coldlion.merch_group_detail p
    where (p.company_code,p.division_code,p.mg_type_code)=(d."companyCode_fk",d."divisionCode_fk",d."mgTypeCode")
  ) then 'company, division or type missing from feed'
  else 'code absent in company, division and type'
 end as disposition
 from core.merch_group_review_hold h left join df d on d.mg_id=h.dflow_mg_id
 left join coldlion.merch_group_detail f
 on (f.company_code,f.division_code,f.mg_type_code,f.mg_category,f.mg_code)=
    (d."companyCode_fk",d."divisionCode_fk",d."mgTypeCode",d."mgCategory",d.mg_code)
 left join lateral (
   select count(*) as n from coldlion.merch_group_detail p
   where (p.company_code,p.division_code,p.mg_type_code,p.mg_code)=
         (d."companyCode_fk",d."divisionCode_fk",d."mgTypeCode",d.mg_code)
 ) t on true
)
select reason, disposition, count(*) as ids, count(*) filter (where is_active) as active,
       count(*) filter (where reason = 'ambiguous' and shared_with_count <> peers - 1) as peer_count_drift
from checked
group by reason, disposition
order by reason, disposition;
rollback;
```
