-- CRM RLS adjustments, realtime, and PostgREST schema exposure for popcrm-web.

-- ---------------------------------------------------------------------------
-- Staff can see each other's profile (internal-tool stance). Needed so the CRM
-- security_invoker views can resolve assignee/owner/salesperson display names,
-- and so assignee/owner pickers work. Baseline only allowed self+admin, which
-- would null out every other user's name in the CRM. Additional permissive
-- SELECT policy: it ORs with the existing profile_select_self_or_admin.
-- ---------------------------------------------------------------------------
drop policy if exists profile_select_staff on app.profile;
create policy profile_select_staff on app.profile
  for select to authenticated
  using (
    app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[])
  );

comment on policy profile_select_staff on app.profile is
  'Internal directory: any authenticated user with a role can read profiles (display name/email/avatar) for assignee/owner pickers.';

-- ---------------------------------------------------------------------------
-- Realtime: add the CRM tables the UI watches that are not already published by
-- the baseline (which already publishes crm.opportunity/task/note/email_message).
-- ---------------------------------------------------------------------------
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'crm.meeting_note',
      'crm.department',
      'crm.licensor_approval_thread'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = split_part(table_name, '.', 1)
          and tablename = split_part(table_name, '.', 2)
      ) then
        execute format('alter publication supabase_realtime add table %s', table_name);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Expose the api/crm/pim/core schemas to PostgREST so supabase-js can reach the
-- CRM api views, the crm.* base tables (direct writes), and the api.* RPCs.
-- Supabase only exposes public + graphql_public by default. This is a shared
-- project setting; it is additive (only adds schemas) and RLS still governs all
-- access. PM/PIM also needs api/pim exposed, so this benefits both rewrites.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter role authenticator set pgrst.db_schemas = '
    || quote_literal('public, graphql_public, api, crm, pim, core');
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
