-- Contracts for 20261111170334_realtime_publication_trim_unsubscribed.sql
-- (u2giants/popdam3#804 task 1).
--
-- Where the supabase_realtime publication exists:
--   1. the six crm tables PopCRM subscribes to are still published, so no live
--      update feature was removed. The three public tables PopDAM subscribes to
--      (admin_config, agent_registrations, style_tracker_rows) are not asserted
--      here: the ephemeral test database does not publish them, and this
--      migration never names them;
--   2. the 13 tables with no listener are no longer published.
-- The publication is created by the Supabase platform, so a database without a
-- realtime stack is reported as an explicit skip.

begin;

do $contracts$
declare
  v_missing text;
  v_leftover text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'SKIP: the supabase_realtime publication does not exist in this database, so membership cannot be asserted here.';
    return;
  end if;

  select string_agg(expected.name, ', ')
    into v_missing
  from unnest(array['crm.email_message','crm.task','crm.note','crm.meeting_note','crm.opportunity','crm.department']::text[]) expected(name)
  where to_regclass(expected.name) is not null
    and not exists (
      select 1 from pg_publication_tables p
       where p.pubname = 'supabase_realtime'
         and p.schemaname = split_part(expected.name, '.', 1)
         and p.tablename = split_part(expected.name, '.', 2));

  if v_missing is not null then
    raise exception 'CONTRACT: subscribed table(s) missing from supabase_realtime: %. An application listens to these with postgres_changes; removing them breaks a live update feature.', v_missing;
  end if;

  select string_agg(removed.name, ', ')
    into v_leftover
  from unnest(array['app.activity','app.comment','app.notification','crm.licensor_approval_thread','dam.asset','dam.style_group','pim.customer_order','pim.product','pim.product_assignee','pim.product_sample','pim.product_submission','pim.revision_request','pim.stage_history']::text[]) removed(name)
  where exists (
      select 1 from pg_publication_tables p
       where p.pubname = 'supabase_realtime'
         and p.schemaname = split_part(removed.name, '.', 1)
         and p.tablename = split_part(removed.name, '.', 2));

  if v_leftover is not null then
    raise exception 'CONTRACT: table(s) with no listener are still published by supabase_realtime: %. If a feature now subscribes to one, move it to the kept list in this contract in the same change that re-publishes it.', v_leftover;
  end if;

  raise notice 'OK: supabase_realtime publishes every subscribed table and none of the 13 trimmed tables.';
end;
$contracts$;

rollback;
