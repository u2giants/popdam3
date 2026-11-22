-- Disposable database test for #4707. The harness rolls back the fixtures and policies.
do $$
declare
  linked_item_id uuid := gen_random_uuid();
  canonical_status_id uuid := gen_random_uuid();
  draft_status_id uuid := gen_random_uuid();
begin
  insert into plm.item (id, source_system, source_id)
    values (linked_item_id, 'test_item_identity', linked_item_id::text);
  insert into plm.designflow_item (legacy_item_id, design_reference, match_disposition)
    values (4707001, 'FIXTURE-REF', 'blank_number');
  insert into plm.designflow_item (legacy_item_id, canonical_item_id, match_disposition)
    values (4707002, linked_item_id, 'eligible');

  begin
    insert into plm.designflow_item (legacy_item_id, canonical_item_id, match_disposition)
      values (4707003, linked_item_id, 'eligible');
    raise exception 'an ERP item accepted a second DesignFlow owner';
  exception when unique_violation then
    null;
  end;
  begin
    insert into plm.designflow_item (legacy_item_id, match_disposition)
      values (4707004, 'excluded_retired');
    raise exception 'retired source data entered the app workspace';
  exception when check_violation then
    null;
  end;

  delete from plm.item where id = linked_item_id;
  if not exists (select from plm.designflow_item where legacy_item_id = 4707002 and canonical_item_id is null) then
    raise exception 'removing a canonical link erased its DesignFlow identity';
  end if;

  insert into plm.licensing_status (id, status, source_system, source_id)
    values (canonical_status_id, 'canonical', 'test_item_identity', 'visible-status');
  insert into plm.licensing_status (
    id, status, source_system, source_id, designflow_status_id, designflow_item_id,
    designflow_source_item_id, designflow_status_value, designflow_event_date
  ) values (
    draft_status_id, 'legacy_unspecified', 'designflow_licensing_status', '4707001', 4707001,
    4707001, 4707001, null, 'Historical date text'
  );

  insert into plm.licensing_feedback (licensing_status_id, body, source_system, source_id)
    values (canonical_status_id, 'shared fixture', 'test_item_identity', 'visible-reply');
  insert into plm.licensing_feedback (
    licensing_status_id, body, source_system, source_id, designflow_feedback_id, designflow_author_id
  ) values (draft_status_id, 'private fixture', 'designflow_licensing_feedback', '4707001', 4707001, 42);

  begin
    update plm.licensing_status set designflow_source_item_id = 4707002 where id = draft_status_id;
    raise exception 'status accepted mismatched original and linked DesignFlow identities';
  exception when check_violation then
    null;
  end;
  begin
    insert into plm.licensing_status (status, source_system, source_id, designflow_status_id)
      values ('done', 'designflow_item_milestone', '4707001:concept_approved', 4707001);
    raise exception 'a DesignFlow milestone accepted an action status ID';
  exception when check_violation then
    null;
  end;
  begin
    update plm.licensing_feedback set source_system = 'canonical' where licensing_status_id = draft_status_id;
    raise exception 'DesignFlow reply fields accepted a non-DesignFlow source';
  exception when check_violation then
    null;
  end;

  delete from plm.designflow_item where legacy_item_id = 4707001;
  if not exists (
    select from plm.licensing_status
    where id = draft_status_id and designflow_item_id is null
      and designflow_source_item_id = 4707001 and designflow_status_value is null
      and designflow_event_date = 'Historical date text'
  ) then
    raise exception 'detaching a draft lost historical licensing provenance';
  end if;

  if has_table_privilege('anon', 'plm.designflow_item', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'plm.designflow_item', 'SELECT,INSERT,UPDATE,DELETE')
     or not (select relrowsecurity from pg_class where oid = 'plm.designflow_item'::regclass) then
    raise exception 'DesignFlow item working data could be accessed by a browser role';
  end if;
end
$$;

-- Simulate an authenticated reader who qualifies for the existing permissive policy.
do $$
begin
  grant usage on schema plm to authenticated;
  grant select, insert, update on plm.licensing_status, plm.licensing_feedback to authenticated;
  create policy test_designflow_status_baseline on plm.licensing_status
    to authenticated using (true) with check (true);
  create policy test_designflow_reply_baseline on plm.licensing_feedback
    to authenticated using (true) with check (true);
  set local role authenticated;
  if not exists (select from plm.licensing_status where source_system = 'test_item_identity' and source_id = 'visible-status')
     or exists (select from plm.licensing_status where source_system = 'designflow_licensing_status' and source_id = '4707001')
     or not exists (select from plm.licensing_feedback where source_system = 'test_item_identity' and source_id = 'visible-reply')
     or exists (select from plm.licensing_feedback where source_system = 'designflow_licensing_feedback' and source_id = '4707001') then
    raise exception 'existing PLM licensing access did not isolate DesignFlow data';
  end if;
  begin
    insert into plm.licensing_status (status, source_system, source_id)
      values ('blocked', 'designflow_licensing_status', 'authenticated-status-test');
    raise exception 'a generic PLM writer created a DesignFlow status';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update plm.licensing_feedback set source_system = 'designflow_licensing_feedback'
      where source_system = 'test_item_identity' and source_id = 'visible-reply';
    raise exception 'a generic PLM writer reassigned a reply to DesignFlow';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  drop policy test_designflow_status_baseline on plm.licensing_status;
  drop policy test_designflow_reply_baseline on plm.licensing_feedback;
end
$$;
