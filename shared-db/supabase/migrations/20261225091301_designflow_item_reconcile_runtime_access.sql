-- #4707: reconcile DesignFlow rows edited or removed after the initial copy.
-- The Data Syncing runtime may update copied rows (re-checked against the live
-- source with the insert rules), replace an item's child rows, and must first
-- record every prior row in an append-only before-image table for rollback.
-- Licensing statuses and replies are never deleted: history is preserved.
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table plm.designflow_reconcile_before_image (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  target_table text not null check (target_table in ('designflow_item', 'item_merch_group',
    'item_custom_value', 'item_price', 'licensing_status', 'licensing_feedback',
    'licensing_status_assignee', 'licensing_feedback_mention', 'licensing_attachment',
    'designflow_item_copy_file_object', 'file_object')),
  operation text not null check (operation in ('update', 'delete', 'insert')),
  target_key jsonb not null,
  before_row jsonb,
  captured_at timestamptz not null default now()
);
create index designflow_reconcile_before_image_run_idx on plm.designflow_reconcile_before_image (run_id);
alter table plm.designflow_reconcile_before_image enable row level security;
revoke all on plm.designflow_reconcile_before_image from public, anon, authenticated;
grant select, insert on plm.designflow_reconcile_before_image to designflow_prod_data_sync_grants;
create policy designflow_reconcile_before_image_read on plm.designflow_reconcile_before_image
  for select to designflow_prod_data_sync_grants using (true);
create policy designflow_reconcile_before_image_insert on plm.designflow_reconcile_before_image
  for insert to designflow_prod_data_sync_grants with check (true);

grant update on plm.designflow_item to designflow_prod_data_sync_grants;
create policy designflow_item_shadow_update on plm.designflow_item
  for update to designflow_prod_data_sync_grants using (true) with check (
    exists (
      select from dflow_prod."itemHeader" h
      where h.item_id_pk = legacy_item_id and h.item_num_id is not distinct from legacy_item_number
        and (canonical_item_id is null or exists (
          select from plm.item p where p.id = canonical_item_id
            and p.source_system = 'coldlion'
            and upper(nullif(btrim(p.item_number), '')) = upper(nullif(btrim(h.item_num_id), ''))
            and p.raw->>'divisionCode' in ('CW001', 'EH001', 'SP001')
            and p.raw->>'nonInventoryItem' = 'N'
            and (p.raw->>'divisionCode' <> 'CW001' or upper(btrim(h.udf_merchgroup05_fk)) is distinct from 'GEN')
        ))
    )
  );

grant update, delete on plm.item_merch_group, plm.item_custom_value, plm.item_price
  to designflow_prod_data_sync_grants;
create policy item_merch_group_designflow_shadow_update on plm.item_merch_group
  for update to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id))
  with check (exists (select from plm.designflow_item h where h.canonical_item_id = item_id)
    and (merch_group_id is null or not exists (
      select from core.merch_group_review_hold h where h.dflow_mg_id = legacy_merch_group_id)));
create policy item_merch_group_designflow_shadow_delete on plm.item_merch_group
  for delete to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));
create policy item_custom_value_designflow_shadow_update on plm.item_custom_value
  for update to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id)) with check (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));
create policy item_custom_value_designflow_shadow_delete on plm.item_custom_value
  for delete to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));
create policy item_price_designflow_shadow_update on plm.item_price
  for update to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id)) with check (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));
create policy item_price_designflow_shadow_delete on plm.item_price
  for delete to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));

grant update (status, designflow_status_value, designflow_event_date, designflow_milestone_flag,
  designflow_package, designflow_feedback, designflow_source_label, designflow_modified_by,
  designflow_assignor_id, designflow_tagged_group_id, designflow_pop_comments,
  designflow_source_assignee_id, designflow_source_assignee_ids,
  designflow_milestone_at, designflow_milestone_checked_by_id, designflow_milestone_checked_by_name,
  designflow_milestone_updated_at)
  on plm.licensing_status to designflow_prod_data_sync_grants;
create policy licensing_status_designflow_shadow_update on plm.licensing_status
  for update to designflow_prod_data_sync_grants
  using (source_system in ('designflow_licensing_status', 'designflow_item_milestone'))
  with check (
    (source_system = 'designflow_licensing_status'
      and designflow_status_id is not null and source_id = designflow_status_id::text
      and exists (
        select from dflow_prod."licensingStatus" s
        where s.id = designflow_status_id and s.itemheader_id_fk is not distinct from designflow_source_item_id
          and s.assignee_id is not distinct from designflow_source_assignee_id
          and s.assignee_ids is not distinct from designflow_source_assignee_ids
      ))
    or (source_system = 'designflow_item_milestone' and (
      (designflow_milestone_id is null and designflow_item_id is not null
        and source_id = designflow_item_id::text || ':' || milestone)
      or exists (select from dflow_prod."licensingMilestone" m
        where m.id = designflow_milestone_id and m.itemheader_id_fk = designflow_source_item_id
          and m.stage = milestone)
    ))
  );

grant update (body) on plm.licensing_feedback to designflow_prod_data_sync_grants;
create policy licensing_feedback_designflow_shadow_update on plm.licensing_feedback
  for update to designflow_prod_data_sync_grants
  using (source_system = 'designflow_licensing_feedback') with check (
    source_system = 'designflow_licensing_feedback'
    and designflow_feedback_id is not null and source_id = designflow_feedback_id::text
    and exists (
      select from plm.licensing_status s
      join dflow_prod."licensingFeedbackReply" r on r.licensing_status_id_fk = s.designflow_status_id
      where s.id = licensing_status_id and s.source_system = 'designflow_licensing_status'
        and r.id = designflow_feedback_id
    )
  );

grant delete on plm.licensing_status_assignee, plm.licensing_feedback_mention, plm.licensing_attachment
  to designflow_prod_data_sync_grants;
create policy licensing_status_assignee_designflow_shadow_delete on plm.licensing_status_assignee
  for delete to designflow_prod_data_sync_grants using (exists (select from plm.licensing_status s
    where s.id = licensing_status_id and s.source_system = 'designflow_licensing_status'));
create policy licensing_feedback_mention_designflow_shadow_delete on plm.licensing_feedback_mention
  for delete to designflow_prod_data_sync_grants using (exists (select from plm.licensing_feedback f
    where f.id = licensing_feedback_id and f.source_system = 'designflow_licensing_feedback'));
create policy licensing_attachment_designflow_shadow_delete on plm.licensing_attachment
  for delete to designflow_prod_data_sync_grants using (
    source_reference ~ '^(itemAttachment|licensingStatus|licensingFeedbackReply):[0-9]+(:[0-9]+)?$');

commit;
