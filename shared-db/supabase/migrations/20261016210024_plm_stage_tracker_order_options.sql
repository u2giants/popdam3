-- shared-db#4373, claim #4376: per-order Linesheet choice for Stage Catalog.
-- derived-from: none
-- Additive server-owned state. Existing orders read false when no row exists.
-- No foreign key to the sync-owned ProdOrderHeader; identifiers match its int key.
-- Rollback: drop table plm.prod_stage_option after its application reader is retired.
create table plm.prod_stage_option (
  prod_order_header_id integer primary key,
  needs_linesheet boolean not null default false,
  updated_by integer null, -- dflow.users.id of the internal editor; tracking API sets it.
  updated_at timestamptz not null default now()
);
alter table plm.prod_stage_option enable row level security;
revoke all on plm.prod_stage_option from anon, authenticated;
grant select, insert, update, delete on plm.prod_stage_option to service_role;
comment on table plm.prod_stage_option is 'DesignFlow Stage Catalog per-order choices. Linesheet eligibility still comes from licensor_stage_option; this flag records whether this order needs it. Internal production permissions enforced by tracking API. shared-db#4373.';

-- Keep process ownership independent from the intertwined tracker display order.
alter table plm.stage add column tracker_position integer null;
comment on column plm.stage.tracker_position is 'Global tracker display order, independent of process-list membership. NULL stages are placed beside their list siblings until assigned. Display order does not create dependencies. shared-db#4373.';
update plm.stage s set tracker_position=v.position
from (values ('tech_pack_done',1),('sample_start_date',2),('photos_done',3),('pps_done',4),
 ('buyer_approval_date',5),('material_done',6),('mass_prod_start_date',7),('assembly_start_date',8),
 ('actual_prod_complete',9),('packing_start_date',10),('qc_inspection_date',11),('actual_etd',12)) v(signal,position)
where s.done_signal=v.signal and s.shown_on_tracker;
-- Bind actual licensing events for readers after maintainers rename a stage.
update plm.stage s set done_signal=case s.name when 'Submission' then 'concept_submitted' when 'Re-Submission (1 Time)' then 'concept_resubmitted' end
from plm.stage_list l where s.list_id=l.id and l.key='licensing' and s.name in ('Submission','Re-Submission (1 Time)') and s.done_signal is null;

do $$
begin
 if (select count(*) from plm.stage where tracker_position is not null) <> 12
    or (select count(*) from plm.stage where done_signal in ('concept_submitted','concept_resubmitted')) <> 2 then
   raise exception 'stage catalog seed diverged; stop instead of guessing event bindings';
 end if;
end $$;
