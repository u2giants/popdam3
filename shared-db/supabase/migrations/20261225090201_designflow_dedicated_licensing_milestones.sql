-- #4707: preserve dedicated DesignFlow milestone rows, including native local
-- timestamps. Header milestone flags and licensing actions remain distinct.
-- Preserve the alternative legacy assignee inputs for existing consumer rules.
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table plm.licensing_status
  add column designflow_source_assignee_id integer,
  add column designflow_source_assignee_ids jsonb,
  add constraint licensing_status_designflow_assignee_provenance check (
    num_nonnulls(designflow_source_assignee_id, designflow_source_assignee_ids) = 0
    or source_system is not distinct from 'designflow_licensing_status'
  ),
  add column designflow_milestone_id integer,
  add column designflow_milestone_at timestamp without time zone,
  add column designflow_milestone_checked_by_id integer,
  add column designflow_milestone_checked_by_name text,
  add column designflow_milestone_created_at timestamp without time zone,
  add column designflow_milestone_updated_at timestamp without time zone,
  add constraint licensing_status_designflow_milestone_provenance check (
    num_nonnulls(designflow_milestone_id, designflow_milestone_at,
      designflow_milestone_checked_by_id, designflow_milestone_checked_by_name,
      designflow_milestone_created_at, designflow_milestone_updated_at) = 0
    or (
      source_system is not distinct from 'designflow_item_milestone'
      and designflow_milestone_id is not null and designflow_milestone_id > 0
      and source_id is not distinct from ('milestone:' || designflow_milestone_id::text)
      and designflow_milestone_at is not null
      and designflow_source_item_id is not null
      and milestone is not null
    )
  );

create unique index licensing_status_designflow_milestone_id_idx
  on plm.licensing_status (designflow_milestone_id) where designflow_milestone_id is not null;

comment on column plm.licensing_status.designflow_source_assignee_id is
  'Original optional scalar assignee. Item Master combines it with the list, while Tracking uses it only as fallback.';
comment on column plm.licensing_status.designflow_source_assignee_ids is
  'Original DesignFlow assignee payload, retained alongside normalized ordered relationships.';
comment on column plm.licensing_status.designflow_milestone_id is
  'Original row ID from DesignFlow licensingMilestone. Header milestones and actions do not have this ID.';
comment on column plm.licensing_status.designflow_milestone_at is
  'Original local DesignFlow milestone timestamp, with no timezone inferred or applied.';
comment on column plm.licensing_status.designflow_milestone_checked_by_name is
  'Original milestone attribution. A name does not establish a user profile identity.';

commit;
