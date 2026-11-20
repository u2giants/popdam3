-- Disposable database contract test for #4707. The test harness rolls back.
do $$
declare
  item_uuid uuid := gen_random_uuid();
  status_uuid uuid := gen_random_uuid();
  feedback_uuid uuid := gen_random_uuid();
  file_uuid uuid := gen_random_uuid();
  removed_file_uuid uuid := gen_random_uuid();
  profile_uuid uuid := gen_random_uuid();
  child_table regclass;
begin
  insert into plm.item (id, source_system, source_id)
    values (item_uuid, 'contract-fixture', item_uuid::text);
  insert into plm.licensing_status (id, item_id, status, source_system, source_id)
    values (status_uuid, item_uuid, 'fixture', 'contract-fixture', status_uuid::text);
  insert into plm.licensing_feedback (id, licensing_status_id, source_system, source_id)
    values (feedback_uuid, status_uuid, 'contract-fixture', feedback_uuid::text);
  insert into app.file_object (id, source_system, source_table, source_id)
    values (file_uuid, 'contract-fixture', 'test', file_uuid::text),
           (removed_file_uuid, 'contract-fixture', 'test', removed_file_uuid::text);
  insert into app.profile (id) values (profile_uuid);

  insert into plm.licensing_status_assignee
    (licensing_status_id, designflow_user_id, profile_id, position)
  values (status_uuid, 15, profile_uuid, 1), (status_uuid, 16, null, 2);
  insert into plm.licensing_feedback_mention
    (licensing_feedback_id, designflow_user_id, position)
  values (feedback_uuid, 16, 1);

  begin
    insert into plm.licensing_status_assignee
      (licensing_status_id, designflow_user_id, position)
    values (status_uuid, 17, 1);
    raise exception 'two assignees occupied the primary position';
  exception when unique_violation then
    null;
  end;
  begin
    insert into plm.licensing_feedback_mention
      (licensing_feedback_id, designflow_user_id, position)
    values (feedback_uuid, 16, 2);
    raise exception 'a reply mentioned the same user twice';
  exception when unique_violation then
    null;
  end;
  delete from app.profile where id = profile_uuid;
  if not exists (
    select from plm.licensing_status_assignee
    where licensing_status_id = status_uuid and designflow_user_id = 15
      and position = 1 and profile_id is null
  ) then
    raise exception 'removing the optional profile lost the DesignFlow assignee';
  end if;

  insert into plm.licensing_attachment
    (item_id, licensing_status_id, licensing_feedback_id, file_object_id, source_reference, position)
  values
    (item_uuid, null, null, file_uuid, 'itemAttachment:1', 1),
    (null, status_uuid, null, removed_file_uuid, 'licensingStatus:1:1', 1),
    (null, null, feedback_uuid, file_uuid, 'licensingFeedbackReply:1:1', 1);
  begin
    insert into plm.licensing_attachment
      (item_id, licensing_status_id, file_object_id, source_reference, position)
    values (item_uuid, status_uuid, file_uuid, 'invalid-two-owners', 2);
    raise exception 'attachment accepted two owners';
  exception when check_violation then
    null;
  end;
  begin
    insert into plm.licensing_attachment (file_object_id, source_reference, position)
      values (file_uuid, 'invalid-no-owner', 2);
    raise exception 'attachment accepted without an owner';
  exception when check_violation then
    null;
  end;
  delete from app.file_object where id = removed_file_uuid;
  if not exists (select from plm.licensing_attachment
                  where licensing_status_id = status_uuid and file_object_id is null
                    and source_reference = 'licensingStatus:1:1') then
    raise exception 'file cleanup removed licensing provenance';
  end if;

  foreach child_table in array array[
    'plm.licensing_status_assignee'::regclass,
    'plm.licensing_feedback_mention'::regclass,
    'plm.licensing_attachment'::regclass
  ]
  loop
    if not (select relrowsecurity from pg_class where oid = child_table)
       or has_table_privilege('anon', child_table, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', child_table, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '% lacks the expected access boundary', child_table;
    end if;
  end loop;

  delete from plm.item where id = item_uuid;
  if exists (select from plm.licensing_status_assignee where licensing_status_id = status_uuid)
     or exists (select from plm.licensing_feedback_mention where licensing_feedback_id = feedback_uuid)
     or exists (select from plm.licensing_attachment
                where source_reference in ('itemAttachment:1', 'licensingStatus:1:1', 'licensingFeedbackReply:1:1'))
     or not exists (select from app.file_object where id = file_uuid) then
    raise exception 'removing the item did not preserve the file and remove its licensing links';
  end if;
end
$$;
