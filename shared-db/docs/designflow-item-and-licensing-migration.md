---
summary: "Delivery plan and read-only production baseline for DesignFlow canonical item and licensing migration #4707."
kind: plan
status: open
read-when: "Building, releasing or verifying the DesignFlow item and licensing migration."
---

# DesignFlow item and licensing migration

[Issue #4707](https://github.com/popcre/shared-db/issues/4707) tracks the database structure, the DesignFlow data move, and the application acceptance. This plan implements the item and licensing scope of the [database migration](designflow-cloudsql-to-supabase-plan.md#value-mapping-decisions). Field ownership follows the [legacy column crosswalk](verification/cloudsql-piecemeal-cutover-20261002/designflow-legacy-column-crosswalk.md). Keep dependent RFQ and production-order moves on their existing issues.

## Status

| Step | Status | Evidence or next action |
| --- | --- | --- |
| Shared structures and live Data Syncing access | Complete | Initial schema and access live. [Production access proof](https://github.com/popcre/shared-db/actions/runs/44984975594) |
| Exact application release and first production copy | Complete | 19,761 copied item workspaces. Replay matched 478,613 rows and inserted zero. [Copy and replay evidence](https://github.com/popcre/shared-db/issues/4707#issuecomment-7084333446) |
| Changed and removed record reconciliation | Open | Read-only comparison implemented and rehearsed in isolation. A reversible write route and recovery proof remain open. |
| Item Master, Tracking and Backend cutover | Open | Confirm role-specific access and current application behavior before switching any consumer. |

## Delivery order

1. **Create the item child structures.** The first additive migration adds `plm.item_merch_group`, `plm.item_custom_value`, and `plm.item_price`. They attach to the existing `plm.item.id`. Record all unresolved nonblank merchandise slots with the original ID or code and a disposition. The database rejects a canonical link on a slot recorded as held. The loader must check actual hold membership and abort before attachment if a source ID is both held and linked. Custom fields retain their source type and numbering, including text `udfnum01` as a distinct field from `udf_num01`, and retain timestamp values without a timezone conversion. A–H price slots retain zero and signed numeric amounts. Browser roles receive no access. Rehearse and verify the new structures before any consumer uses them.
2. **Finish the item and licensing contracts.** Keep the ColdLion row and UUID authoritative on the existing item master. Keep DesignFlow-edited fields on the PLM item side without overwriting ColdLion's item number, description, licensing taxonomy, or source payload. Finalize the application-used fields and the stable DesignFlow integer-to-canonical UUID bridge with the backend, Item Master, Tracking and Data Syncing call sites. Preserve references from the existing item and licensing screens, RFQs, orders, files, notifications and audit history. Use existing `plm.licensing_status` and `plm.licensing_feedback` for milestone/status and reply threads. Model assignees, mentions and attachment relationships as rows. Distinguish item-header milestone flags/dates from independent licensing status actions. Keep attachment order, provider/object identity, parent type and attribution. Attach through `app.file_object` using the existing provider contract, preserving source provenance. Send no notifications during backfill.
3. **Publish the consumer code and data move.** DesignFlow owns the application rows. Use an idempotent, bounded DesignFlow loader and a dry-run manifest per environment. Freeze or capture writes during snapshot-to-cutover reconciliation. Reconcile each source identity and item child to exactly one result, including blanks, holds, missing parents and explicit exclusions. Keep the previous app read/write path as the rollback source and verify a catch-up replay can restore it without lost edits. Confirm real service roles and use only the access each contract needs. Publish schema/type proof and the application release contracts through the [DesignFlow release process](designflow-db-release.md). Production schema promotion follows the automated [shared database route](production-promotion-procedure.md). Uma owns the app merge and release.
4. **Prove the app behavior.** Before switching reads, compare old and new API values and behavior with the same roles in the DesignFlow sandbox. Exercise Item Library, item create/edit and drafts, price and custom fields, agreed merchandise slots, licensing milestones, multiple assignees, comment replies and mentions, attachment display/download and Tracking. Explicitly check an item with a held slot, an excluded item, and a draft without a ColdLion item number. Verify read and write behavior across a sync cycle, then repeat against the promoted production revisions. Reconcile unresolved items and child rows before turning off the previous path. Leave the live-proof checkbox on #4707 open until this passes.

## Current evidence and cutover conditions

The DesignFlow item workspace keeps the existing integer header key and the DesignFlow reference number. It can hold a draft without an ERP item number or a canonical item link. Only a unique, eligible ColdLion item can attach. The workspace keeps typed source header fields for compatibility and records why a link is absent. The read-only inventory counts excluded EP001, non-inventory and owner-excluded items, and those records stay outside the workspace. The canonical item and division stay ColdLion-owned. Existing screens retain the original route for unresolved items until their new read and write paths pass comparison tests.

DesignFlow licensing status and reply source IDs stay stable. The status records the original nullable status, date text, actor and group separately from its canonical representation. The loader gives header milestones their own stable keys and retains the original flag and date spelling. A status can reference a DesignFlow draft without requiring a ColdLion item. An orphan retains its original item ID. Direct authenticated database readers can continue reading the existing shared licensing sources. The existing DesignFlow service remains the repair path for its old records until the replacement server path, least-privilege database access, and application acceptance are ready.

Production read-only checks on November 20, 2026 found **20,241** DesignFlow item headers and **20,180** existing ColdLion items. The first match pass used normalized item number only when exactly one ColdLion candidate existed across the whole master, then applied the existing exclusion rules.

| Item disposition | Rows |
| --- | ---: |
| Unique eligible ColdLion item | 19,285 |
| More than one ColdLion candidate | 183 |
| Nonblank number with no ColdLion candidate | 148 |
| Blank item number | 136 |
| Retired EP001 | 449 |
| ColdLion non-inventory | 38 |
| Owner-excluded CW001 GEN | 2 |

All nonblank DesignFlow item numbers were unique after trim and case normalization. This does not establish which division owns an ambiguous ColdLion number. Resolve such rows using source evidence. Leave potentially active drafts accessible through the existing DesignFlow path until an explicit stable identity and routing rule is verified. Do not infer missing company or division from the item name.

The [held merchandise-group check](verification/4707-designflow-merch-group-holds-20261120.md) was rerun before this analysis. All 3,099 holds remained and none qualified for an automatic link. Among 19,285 eligible item headers, **15,499 populated slots** refer to held IDs. **10,890** slots passed the existing bridge, company, division, slot type and legacy code checks. **80,991** slots have a code alone. Do not resolve those by a bare code. Require the same full ColdLion identity, valid slot context and the applicable [merchandise rules](business-rules/merchandise-and-product-taxonomy.md#mgcategory). Where an owner-approved value rule already exists, such as MG04 size conversion, keep its canonical target distinct from an inferred legacy merchandise-group ID.

| Slot | Bridge verified | Code only | Held ambiguous | Held unmatched | No bridge | Wrong context | Code conflict | Blank |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 | 3510 | 14126 | 0 | 57 | 0 | 14 | 10 | 1568 |
| 02 | 2916 | 12816 | 532 | 104 | 0 | 12 | 18 | 2887 |
| 03 | 1318 | 12849 | 2103 | 91 | 0 | 3 | 30 | 2891 |
| 04 | 1 | 15072 | 47 | 3457 | 0 | 0 | 0 | 708 |
| 05 | 2411 | 11408 | 0 | 963 | 4 | 24 | 116 | 4359 |
| 06 | 502 | 12084 | 1989 | 992 | 0 | 3 | 27 | 3688 |
| 07 | 232 | 242 | 0 | 692 | 0 | 4 | 0 | 18115 |
| 08 | 0 | 1086 | 0 | 3427 | 46 | 0 | 0 | 14726 |
| 09 | 0 | 1049 | 0 | 0 | 0 | 0 | 0 | 18236 |
| 10 | 0 | 259 | 0 | 163 | 0 | 0 | 0 | 18863 |
| 15 | 0 | 0 | 0 | 882 | 35 | 197 | 0 | 18171 |

Slots 11–14 and 16–25 were blank in this population. A later run must measure all slots again.

A November 21 production read found 114 dedicated `licensingMilestone` records across five source stages. All had original timestamps and a legacy item parent. None had a numeric reviewer ID. Preserve the original attribution text without linking a guessed user. These have their own source IDs and carry the milestone, creation and update timestamps without assigning a timezone. The earlier crosswalk's empty-table assumption no longer applies. The separate 28-row licensing template catalog remains on its existing route.

Item Master combines a row's ordered assignee array and scalar. Tracking prefers a nonempty array and only falls back to the scalar. The November 21 production scan found no status action where the nonempty array omitted a populated scalar. Retain both original fields as well as ordered normalized links so each consumer can keep its rule even when a later row differs.

Of 16,302 legacy licensing status rows, 15,894 point to uniquely eligible items. The remainder include 385 with ambiguous item numbers, 11 with unmatched numbers, five with blank numbers, one tied to a non-inventory item and six without a matching legacy parent. Of 125 replies, 122 map to eligible items and three belong to blank-number items. The 14 licensing-marked item attachments were on eligible items. The status and reply payloads also contain 1,398 and 71 attachment entries respectively, before de-duplication. The permanent status and feedback tables were empty at this check.

Every sampled reference from the legacy assignee, assignor, reply-author and mention columns/arrays joined to a DesignFlow user. Exact email-to-profile comparison left 49 scalar assignee, 52 array assignee, two assignor, one reply-author and eight mention references without an `app.profile` identity. Some single and array assignees may overlap. Treat these as reference counts, not distinct users. Do not assign these references to another user, remove them or force a sign-in migration to fill a foreign key. The DesignFlow identity contract belongs on [backend #71](https://github.com/popcre/designflow-backend/issues/71) under [the DesignFlow user authority ruling](https://github.com/popcre/designflow-backend/issues/250). A transitional integer identity must stay inspectable; a canonical foreign key requires proven source identity.

## Sandbox and application release prerequisites

The DesignFlow sandbox has 21,699 item headers and 4,497 DesignFlow merchandise groups. The read-only catalog check found ten sandbox ColdLion merchandise feed records, no canonical ColdLion item rows or canonical group bridge rows, and no hold table. The production reconciliation uses the production DesignFlow source and cannot establish this separate sandbox data. Use an environment-specific, bounded rehearsal with known source and held cases. The [DesignFlow sandbox workflow](https://github.com/popcre/shared-db/actions/workflows/designflow-sandbox-migrations.yml) requires merged source and a successful exact-version dry run before any sandbox apply.

Item Master owns Item Library, create and edit, licensing actions and replies, and vendor item scope. Tracking reads the latest action by its original action ID, applies that status and its assignees to grid filters, updates header licensing fields, and runs the due reminder. Backend uses the original item ID in autofill, PDF import and the HTS phrase store. Move these paths together only after the shadow copy and changed and deleted row reconciliation pass. Preserve vendor item scope, internal Tracking access and due reminder idempotency. The licensing migration uses transitional DesignFlow user IDs and original names. It does not depend on migrating unrelated account or role data.

The [final hosted Data Syncing rehearsal](https://github.com/popcre/designflow-data-syncing/pull/171#issuecomment-7073687032) proved replay and rollback of item, milestone, assignee and licensing fixtures. The [production release](https://github.com/popcre/designflow-data-syncing/pull/173) used the approved managed job and the existing Data Syncing login for a read-only plan and a snapshot-bound copy. Independent production readback confirmed the copy counts and sampled the corresponding source fields. Held groups kept their original identifiers, with zero incorrect links. Item Master, Tracking and Backend still lack read access to the new item and licensing tables. The current Item Master active-status filter finds 489 vendor-coded items outside the approved copy population. Preserve the existing route for those exclusions and keep the current login-to-vendor-code check. The copied active items matched their original vendor codes.

## Data Syncing access and release

Grant the existing Data Syncing role the exact source columns, read-only ColdLion
item and merchandise bridge fields, and insert-only shadow targets. Licensing
records and attachments from other sources remain outside the role. Direct
browser access does not change. Keep the user authority on the existing
DesignFlow integer ID. The copy validates references using only the legacy
user ID column.

Bind the application release to the exact canonical migration sources. The
file copy uses a security-invoker view in the existing DesignFlow namespace.
The view exposes the exact file fields under the original file policies and
keeps the app namespace closed to the runtime. Before applying the access
migration, check on the verified hosted preview and production catalogs that
the runtime has no inherited executable PLM definer functions. The release catalog checks
column-level reads and relation-level writes. Database tests and the deployed
role rehearsal check the narrower writes and the single-column user lookup. Keep the existing
release digest in force until the replacement application manifest and the
production catalog proof can be checked together.

The released job used the existing production login for its read-only plan.
Independent reads matched the source counts, all seven item dispositions and
all 46 populated merchandise-group result categories. The copy and replay used
the same verified snapshot digest. Source updates and deletions still require
reconciliation before any consumer switches.

Use a read-only comparison of the original projections to identify missing,
changed and extra records. Account for a missing copied parent before comparing
its dependent children. Test a bounded, recoverable update and deletion route
under its own exact app role. The existing copy role can insert but cannot update
or delete the workspace. Preserve the original authoritative routes through a
full sync cycle and real-role Item Master, Tracking and Backend acceptance.

## Repeat the item and slot checks

Verify the shared production target and approved read-only identity first. These queries return aggregate counts only. Re-run the separate held-ID query first. Abort attachment if a source ID is both held and linked.

The first query counts items, statuses, replies and item attachments.

```sql
begin read only;
with l as (
 select item_id_pk as id, upper(nullif(btrim(item_num_id),'')) as item_no, udf_merchgroup05_fk legacy_mg05
 from dflow_prod."itemHeader"
), cand as (
 select l.id, count(p.id) n, count(p.id) filter(where p.raw->>'divisionCode'='EP001') retired, count(p.id) filter (where p.raw->>'nonInventoryItem'='Y') non_inventory, count(p.id) filter (where p.raw->>'divisionCode' = 'CW001' and upper(btrim(l.legacy_mg05))='GEN') gen,
 count(p.id) filter (where p.raw->>'divisionCode' in ('CW001','EH001','SP001') and p.raw->>'nonInventoryItem'='N') inventory
 from l left join plm.item p on upper(btrim(p.item_number))=l.item_no and p.source_system='coldlion' group by l.id
), outcome as (
select l.id, case when l.item_no is null then 'blank_number' when n=0 then 'unmatched_number' when n>1 then 'ambiguous_number' when retired=1 then 'excluded_retired' when non_inventory=1 then 'excluded_non_inventory' when gen=1 then 'excluded_gen' when inventory=1 then 'eligible' else 'unknown' end outcome from l join cand using(id)
)
select 'items' kind,outcome,count(*) n from outcome group by outcome
union all select 'status',coalesce(o.outcome,'missing_parent'),count(*) from dflow_prod."licensingStatus" s left join outcome o on o.id=s.itemheader_id_fk group by 2
union all select 'reply',coalesce(o.outcome,'missing_parent'),count(*) from dflow_prod."licensingFeedbackReply" r left join dflow_prod."licensingStatus" s on s.id=r.licensing_status_id_fk left join outcome o on o.id=s.itemheader_id_fk group by 2
union all select 'attachment',coalesce(o.outcome,'missing_parent'),count(*) from dflow_prod."itemAttachment" a left join outcome o on o.id=a.item_num_id_fk where a.licensing_attachment is true group by 2 order by 1,2;
rollback;
```

The second query counts merchandise slots on eligible items.

```sql
begin read only;
with l as (
 select item_id_pk as id, upper(nullif(btrim(item_num_id),'')) as item_no, udf_merchgroup05_fk legacy_mg05
 from dflow_prod."itemHeader"
), cand as (
 select l.id, min(p.raw->>'divisionCode') division, min(p.raw->>'companyCode') company, count(p.id) n, count(p.id) filter(where p.raw->>'divisionCode'='EP001') retired, count(p.id) filter (where p.raw->>'nonInventoryItem'='Y') non_inventory, count(p.id) filter (where p.raw->>'divisionCode' = 'CW001' and upper(btrim(l.legacy_mg05))='GEN') gen,
 count(p.id) filter (where p.raw->>'divisionCode' in ('CW001','EH001','SP001') and p.raw->>'nonInventoryItem'='N') inventory
 from l left join plm.item p on upper(btrim(p.item_number))=l.item_no and p.source_system='coldlion' group by l.id
), outcome as (
select l.id,cand.company,cand.division, case when l.item_no is null then 'blank_number' when n=0 then 'unmatched_number' when n>1 then 'ambiguous_number' when retired=1 then 'excluded_retired' when non_inventory=1 then 'excluded_non_inventory' when gen=1 then 'excluded_gen' when inventory=1 then 'eligible' else 'unknown' end outcome from l join cand using(id)
)
, slots as (
select o.outcome,s.slot,s.legacy_id,s.legacy_code,
 case when s.legacy_id is null then case when s.legacy_code is null then 'blank' else 'code_only' end
 when g.id is not null and t.dflow_mg_id is not null then 'bridge_and_hold'
 when t.dflow_mg_id is not null then 'held_' || t.reason
 when g.id is null then 'missing_id_bridge'
 when g.metadata->>'division_code' is distinct from o.division or g.metadata->>'company_code' is distinct from o.company or g.metadata->>'mg_type_code' is distinct from lpad(s.slot::text,2,'0') then 'wrong_item_context'
 when s.legacy_code is not null and upper(g.code) <> upper(s.legacy_code) then 'code_conflict'
 else 'resolved' end as status
from outcome o join dflow_prod."itemHeader" h on h.item_id_pk=o.id
cross join lateral (values (1,h.udf_merchgroup01_id,nullif(btrim(h.udf_merchgroup01),'')),
(2,h.udf_merchgroup02_id,nullif(btrim(h.udf_merchgroup02),'')),
(3,h.udf_merchgroup03_id,nullif(btrim(h.udf_merchgroup03),'')),
(4,h.udf_merchgroup04_id,nullif(btrim(h.udf_merchgroup04),'')),
(5,h.udf_merchgroup05_fk_id,nullif(btrim(h.udf_merchgroup05_fk),'')),
(6,h.udf_merchgroup06_fk_id,nullif(btrim(h.udf_merchgroup06_fk),'')),
(7,h.udf_merchgroup07_fk_id,nullif(btrim(h.udf_merchgroup07_fk),'')),
(8,h.udf_merchgroup08_fk_id,nullif(btrim(h.udf_merchgroup08_fk),'')),
(9,h.udf_merchgroup09_fk_id,nullif(btrim(h.udf_merchgroup09_fk),'')),
(10,h.udf_merchgroup10_fk_id,nullif(btrim(h.udf_merchgroup10_fk),'')),
(11,null::int,nullif(btrim(h.udf_merchgroup11_fk),'')),
(12,null::int,nullif(btrim(h.udf_merchgroup12_fk),'')),
(13,null::int,nullif(btrim(h.udf_merchgroup13_fk),'')),
(14,null::int,nullif(btrim(h.udf_merchgroup14_fk),'')),
(15,h.udf_merchgroup15_fk_id,nullif(btrim(h.udf_merchgroup15_fk),'')),
(16,null::int,nullif(btrim(h.udf_merchgroup16_fk),'')),
(17,null::int,nullif(btrim(h.udf_merchgroup17_fk),'')),
(18,null::int,nullif(btrim(h.udf_merchgroup18_fk),'')),
(19,null::int,nullif(btrim(h.udf_merchgroup19_fk),'')),
(20,null::int,nullif(btrim(h.udf_merchgroup20_fk),'')),
(21,null::int,nullif(btrim(h.udf_merchgroup21_fk),'')),
(22,null::int,nullif(btrim(h.udf_merchgroup22_fk),'')),
(23,null::int,nullif(btrim(h.udf_merchgroup23_fk),'')),
(24,null::int,nullif(btrim(h.udf_merchgroup24_fk),'')),
(25,null::int,nullif(btrim(h.udf_merchgroup25_fk),''))) s(slot,legacy_id,legacy_code)
left join core.merch_group g on (g.metadata->>'dflow_mg_id')::integer=s.legacy_id
left join core.merch_group_review_hold t on t.dflow_mg_id=s.legacy_id
where o.outcome='eligible'
)select slot,jsonb_object_agg(status,n) counts from (select slot,status,count(*) n from slots group by slot,status)x group by slot order by slot; rollback;
```
