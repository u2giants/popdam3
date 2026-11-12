-- u2giants/popdam3#804 task 2: publish the tables applications already listen
-- to, so their live refreshes fire.
--
-- WHY
-- ---
-- Applications subscribe with postgres_changes to tables that are not in the
-- supabase_realtime publication, so no event is ever delivered:
--   public.render_queue      PopDAM settings diagnostics render-queue card
--   crm.ingested_domain      PopCRM live refresh (src/features/crm/realtime.ts)
--   core.contact             PopCRM live refresh
--   core.contact_company     PopCRM live refresh
-- Separately, public.admin_config and public.agent_registrations are published
-- in production only from outside migration history (PopDAM web and bridge
-- agent listen to them); a from-scratch build would not publish them. They are
-- added here only when missing, so production is unchanged for those two.
--
-- COST: each added table adds roughly 0.2-0.5 ms to every realtime poll
-- (publication table-list rebuild); measured before/after on popdam3#804.
--
-- SCOPE
-- -----
-- Publication membership only. No table, policy, grant, index or replica
-- identity changes. Each statement is guarded so a database with no realtime
-- stack, a missing table, or an already-published table is a clean no-op.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $add$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication absent; nothing to add.';
    return;
  end if;

  if to_regclass('public.render_queue') is not null
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'render_queue') then
    alter publication supabase_realtime add table public.render_queue;
  end if;

  if to_regclass('crm.ingested_domain') is not null
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'crm' and tablename = 'ingested_domain') then
    alter publication supabase_realtime add table crm.ingested_domain;
  end if;

  if to_regclass('core.contact') is not null
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'core' and tablename = 'contact') then
    alter publication supabase_realtime add table core.contact;
  end if;

  if to_regclass('core.contact_company') is not null
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'core' and tablename = 'contact_company') then
    alter publication supabase_realtime add table core.contact_company;
  end if;

  if to_regclass('public.admin_config') is not null
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_config') then
    alter publication supabase_realtime add table public.admin_config;
  end if;

  if to_regclass('public.agent_registrations') is not null
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_registrations') then
    alter publication supabase_realtime add table public.agent_registrations;
  end if;
end;
$add$;

commit;
