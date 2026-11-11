-- u2giants/popdam3#804 task 1: trim the supabase_realtime publication to the
-- tables an application actually listens to.
--
-- WHY
-- ---
-- Supabase Realtime polls realtime.list_changes continuously (production,
-- pg_stat_statements since 2026-11-06 11:20 AM EST: 995,771 calls, 39.1 ms mean,
-- ~7,760 s of database time per day). Every poll rebuilds the publication's
-- table list from pg_publication_tables, and that step costs catalog reads per
-- published table (22 published tables: 1,251 buffer hits per poll; a 7-table
-- publication: 649).
--
-- AUDIT (2026-11-11, default branches of every popcre and u2giants repository,
-- searched for `postgres_changes`, plus live realtime.subscription rows)
-- ---------------------------------------------------------------------------
-- Listened to, KEPT (9): public.admin_config, public.agent_registrations,
--   public.style_tracker_rows (PopDAM web and bridge agent); crm.email_message,
--   crm.task, crm.note, crm.meeting_note, crm.opportunity, crm.department
--   (PopCRM live refresh).
-- No listener in any repository, no live subscription, REMOVED (13): the tables
--   below. They were published by 20260621151155 and 20260621151419 ahead of
--   features that never subscribed. Re-publishing one later is a one-line
--   additive migration.
--
-- SCOPE
-- -----
-- Publication membership only. No table, policy, grant, index or replica
-- identity changes. Each statement is guarded so a database with no realtime
-- stack, a missing table, or an already-trimmed publication is a clean no-op.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $trim$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication absent; nothing to trim.';
    return;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'activity') then
    alter publication supabase_realtime drop table app.activity;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'comment') then
    alter publication supabase_realtime drop table app.comment;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'notification') then
    alter publication supabase_realtime drop table app.notification;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'crm' and tablename = 'licensor_approval_thread') then
    alter publication supabase_realtime drop table crm.licensor_approval_thread;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'dam' and tablename = 'asset') then
    alter publication supabase_realtime drop table dam.asset;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'dam' and tablename = 'style_group') then
    alter publication supabase_realtime drop table dam.style_group;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'customer_order') then
    alter publication supabase_realtime drop table pim.customer_order;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'product') then
    alter publication supabase_realtime drop table pim.product;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'product_assignee') then
    alter publication supabase_realtime drop table pim.product_assignee;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'product_sample') then
    alter publication supabase_realtime drop table pim.product_sample;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'product_submission') then
    alter publication supabase_realtime drop table pim.product_submission;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'revision_request') then
    alter publication supabase_realtime drop table pim.revision_request;
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'pim' and tablename = 'stage_history') then
    alter publication supabase_realtime drop table pim.stage_history;
  end if;
end;
$trim$;

commit;
