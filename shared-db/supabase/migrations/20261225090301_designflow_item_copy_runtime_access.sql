-- #4707: the deployed Data Syncing runtime can read the exact migration inputs
-- and insert DesignFlow shadow rows. Other applications keep their privileges.
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant usage on schema plm to designflow_prod_data_sync_grants;

grant select (id, date, itemheader_id_fk, status, package, feedback, "from", moduser,
  assignor_id, tagged_group_id, pop_comments, assignee_id, assignee_ids, attachments)
  on dflow_prod."licensingStatus" to designflow_prod_data_sync_grants;
grant select (id, licensing_status_id_fk, comment, created_at, created_by, tagged_user_ids, attachments)
  on dflow_prod."licensingFeedbackReply" to designflow_prod_data_sync_grants;
grant select (id, itemheader_id_fk, stage, milestone_date, checked_by_user_id, checked_by_name, created_at, updated_at)
  on dflow_prod."licensingMilestone" to designflow_prod_data_sync_grants;
grant select (id) on dflow_prod.users to designflow_prod_data_sync_grants;
grant select (id, item_number, raw, source_system) on plm.item to designflow_prod_data_sync_grants;
grant select (id, code, level, metadata) on core.merch_group to designflow_prod_data_sync_grants;
grant select (dflow_mg_id, reason) on core.merch_group_review_hold to designflow_prod_data_sync_grants;

create policy item_designflow_shadow_read on plm.item
  for select to designflow_prod_data_sync_grants using (source_system = 'coldlion');
create policy merch_group_designflow_shadow_read on core.merch_group
  for select to designflow_prod_data_sync_grants using (metadata ? 'dflow_mg_id');
create policy merch_group_hold_designflow_shadow_read on core.merch_group_review_hold
  for select to designflow_prod_data_sync_grants using (true);

grant select, insert on plm.designflow_item, plm.item_merch_group, plm.item_custom_value, plm.item_price
  to designflow_prod_data_sync_grants;
grant select (id, source_system, source_id, status, milestone, designflow_item_id, designflow_source_item_id,
  designflow_status_id, designflow_status_value, designflow_event_date, designflow_milestone_flag,
  designflow_package, designflow_feedback, designflow_source_label, designflow_modified_by,
  designflow_assignor_id, designflow_tagged_group_id, designflow_pop_comments,
  designflow_source_assignee_id, designflow_source_assignee_ids,
  designflow_milestone_id, designflow_milestone_at, designflow_milestone_checked_by_id,
  designflow_milestone_checked_by_name, designflow_milestone_created_at, designflow_milestone_updated_at),
  insert (source_system, source_id, status, milestone, designflow_item_id, designflow_source_item_id,
  designflow_status_id, designflow_status_value, designflow_event_date, designflow_milestone_flag,
  designflow_package, designflow_feedback, designflow_source_label, designflow_modified_by,
  designflow_assignor_id, designflow_tagged_group_id, designflow_pop_comments,
  designflow_source_assignee_id, designflow_source_assignee_ids,
  designflow_milestone_id, designflow_milestone_at, designflow_milestone_checked_by_id,
  designflow_milestone_checked_by_name, designflow_milestone_created_at, designflow_milestone_updated_at)
  on plm.licensing_status to designflow_prod_data_sync_grants;
grant select (id, source_system, source_id, licensing_status_id, body, created_at,
  designflow_feedback_id, designflow_author_id),
  insert (source_system, source_id, licensing_status_id, body, created_at, designflow_feedback_id, designflow_author_id)
  on plm.licensing_feedback to designflow_prod_data_sync_grants;
grant select (licensing_status_id, designflow_user_id, position), insert (licensing_status_id, designflow_user_id, position)
  on plm.licensing_status_assignee to designflow_prod_data_sync_grants;
grant select (licensing_feedback_id, designflow_user_id, position), insert (licensing_feedback_id, designflow_user_id, position)
  on plm.licensing_feedback_mention to designflow_prod_data_sync_grants;
grant select (item_id, licensing_status_id, licensing_feedback_id, file_object_id, source_reference, position),
  insert (item_id, licensing_status_id, licensing_feedback_id, file_object_id, source_reference, position)
  on plm.licensing_attachment to designflow_prod_data_sync_grants;
grant select (id, source_system, source_table, source_id, url, filename, mime_type, byte_size),
  insert (source_system, source_table, source_id, url, filename, mime_type, byte_size)
  on app.file_object to designflow_prod_data_sync_grants;

-- Keep app's schema unavailable. The view uses the caller's exact column
-- grants and file RLS, so it cannot carry the view owner's access to the caller.
create view dflow_prod.designflow_item_copy_file_object
  with (security_invoker = true, security_barrier = true) as
select id, source_system, source_table, source_id, url, filename, mime_type, byte_size
from app.file_object
where source_system = 'designflow_licensing_attachment'
with local check option;

revoke all on dflow_prod.designflow_item_copy_file_object from public, anon, authenticated;
grant select on dflow_prod.designflow_item_copy_file_object to designflow_prod_data_sync_grants;
grant insert (source_system, source_table, source_id, url, filename, mime_type, byte_size)
  on dflow_prod.designflow_item_copy_file_object to designflow_prod_data_sync_grants;

create policy designflow_item_shadow_read on plm.designflow_item
  for select to designflow_prod_data_sync_grants using (true);

create policy designflow_item_shadow_insert on plm.designflow_item
  for insert to designflow_prod_data_sync_grants with check (
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

create policy item_merch_group_designflow_shadow_read on plm.item_merch_group
  for select to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));

create policy item_merch_group_designflow_shadow_insert on plm.item_merch_group
  for insert to designflow_prod_data_sync_grants with check (
    exists (select from plm.designflow_item h where h.canonical_item_id = item_id)
    and (merch_group_id is null or not exists (
      select from core.merch_group_review_hold h where h.dflow_mg_id = legacy_merch_group_id
    ))
  );

create policy item_custom_value_designflow_shadow_read on plm.item_custom_value
  for select to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));

create policy item_custom_value_designflow_shadow_insert on plm.item_custom_value
  for insert to designflow_prod_data_sync_grants with check (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));

create policy item_price_designflow_shadow_read on plm.item_price
  for select to designflow_prod_data_sync_grants using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));

create policy item_price_designflow_shadow_insert on plm.item_price
  for insert to designflow_prod_data_sync_grants with check (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));

create policy licensing_status_designflow_shadow_read on plm.licensing_status
  for select to designflow_prod_data_sync_grants using (source_system in ('designflow_licensing_status', 'designflow_item_milestone'));

create policy licensing_status_designflow_shadow_insert on plm.licensing_status
  for insert to designflow_prod_data_sync_grants with check (
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

create policy licensing_feedback_designflow_shadow_read on plm.licensing_feedback
  for select to designflow_prod_data_sync_grants using (source_system = 'designflow_licensing_feedback');

create policy licensing_feedback_designflow_shadow_insert on plm.licensing_feedback
  for insert to designflow_prod_data_sync_grants with check (
    source_system = 'designflow_licensing_feedback'
    and designflow_feedback_id is not null and source_id = designflow_feedback_id::text
    and exists (
      select from plm.licensing_status s
      join dflow_prod."licensingFeedbackReply" r on r.licensing_status_id_fk = s.designflow_status_id
      where s.id = licensing_status_id and s.source_system = 'designflow_licensing_status'
        and r.id = designflow_feedback_id
    )
  );

create policy licensing_status_assignee_designflow_shadow_read on plm.licensing_status_assignee
  for select to designflow_prod_data_sync_grants using (exists (select from plm.licensing_status s where s.id = licensing_status_id
    and s.source_system = 'designflow_licensing_status'));

create policy licensing_status_assignee_designflow_shadow_insert on plm.licensing_status_assignee
  for insert to designflow_prod_data_sync_grants with check (
    exists (select from plm.licensing_status s where s.id = licensing_status_id
      and s.source_system = 'designflow_licensing_status')
    and exists (select from dflow_prod.users u where u.id = designflow_user_id)
  );

create policy licensing_feedback_mention_designflow_shadow_read on plm.licensing_feedback_mention
  for select to designflow_prod_data_sync_grants using (exists (select from plm.licensing_feedback f where f.id = licensing_feedback_id
    and f.source_system = 'designflow_licensing_feedback'));

create policy licensing_feedback_mention_designflow_shadow_insert on plm.licensing_feedback_mention
  for insert to designflow_prod_data_sync_grants with check (
    exists (select from plm.licensing_feedback f where f.id = licensing_feedback_id
      and f.source_system = 'designflow_licensing_feedback')
    and exists (select from dflow_prod.users u where u.id = designflow_user_id)
  );

create policy file_object_designflow_shadow_read on app.file_object
  for select to designflow_prod_data_sync_grants using (source_system = 'designflow_licensing_attachment'
    and source_table in ('itemAttachment', 'licensingStatus', 'licensingFeedbackReply'));

create policy file_object_designflow_shadow_insert on app.file_object
  for insert to designflow_prod_data_sync_grants with check (source_system = 'designflow_licensing_attachment'
    and source_table in ('itemAttachment', 'licensingStatus', 'licensingFeedbackReply')
    and source_id like source_table || ':%' and storage_provider = 'external');

create policy licensing_attachment_designflow_shadow_read on plm.licensing_attachment
  for select to designflow_prod_data_sync_grants using (
    source_reference ~ '^(itemAttachment|licensingStatus|licensingFeedbackReply):[0-9]+(:[0-9]+)?$'
  );

create policy licensing_attachment_designflow_shadow_insert on plm.licensing_attachment
  for insert to designflow_prod_data_sync_grants with check (
    exists (select from app.file_object f where f.id = file_object_id
      and f.source_system = 'designflow_licensing_attachment' and f.source_id = source_reference)
    and case split_part(source_reference, ':', 1)
      when 'itemAttachment' then exists (
        select from plm.designflow_item h
        join dflow_prod."itemAttachment" a on a.item_num_id_fk = h.legacy_item_id
        where h.canonical_item_id = item_id and a.licensing_attachment is true
          and source_reference = 'itemAttachment:' || a.item_attachment_id::text
      )
      when 'licensingStatus' then exists (select from plm.licensing_status s where s.id = licensing_status_id
        and s.source_system = 'designflow_licensing_status' and s.source_id = split_part(source_reference, ':', 2))
      when 'licensingFeedbackReply' then exists (select from plm.licensing_feedback f where f.id = licensing_feedback_id
        and f.source_system = 'designflow_licensing_feedback' and f.source_id = split_part(source_reference, ':', 2))
      else false
    end
  );

commit;
