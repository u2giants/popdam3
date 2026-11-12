-- Contracts for 20261111233202_realtime_publication_add_subscribed.sql
-- (u2giants/popdam3#804 task 2).
--
-- Where the supabase_realtime publication exists, the three crm/core tables
-- PopCRM subscribes to are published. The three public tables are not asserted
-- here: the ephemeral test database creates them outside migration order, so
-- the migration cannot publish them there. Production is asserted by the
-- catalog contract realtime_publication_add_subscribed_v1. The
-- publication is created by the Supabase platform, so a database without a
-- realtime stack is reported as an explicit skip.

begin;

do $contracts$
declare
  v_missing text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'SKIP: the supabase_realtime publication does not exist in this database, so membership cannot be asserted here.';
    return;
  end if;

  select string_agg(expected.name, ', ')
    into v_missing
  from unnest(array['crm.ingested_domain','core.contact','core.contact_company']::text[]) expected(name)
  where to_regclass(expected.name) is not null
    and not exists (
      select 1 from pg_publication_tables p
       where p.pubname = 'supabase_realtime'
         and p.schemaname = split_part(expected.name, '.', 1)
         and p.tablename = split_part(expected.name, '.', 2));

  if v_missing is not null then
    raise exception 'CONTRACT: subscribed table(s) missing from supabase_realtime: %. An application listens to these with postgres_changes.', v_missing;
  end if;

  raise notice 'OK: supabase_realtime publishes every table added by 20261111233202.';
end;
$contracts$;

rollback;
