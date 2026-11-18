-- #6452: follow-up to #6418 (20261218043336) review findings.
--
-- 1. Service-role readers (popdam3 popsg-readiness-baseline) were cut to zero
--    rows: app.has_app_access('dam') is false without a user JWT. The gate now
--    also admits the verified service_role request role.
-- 2. Snapshot matviews get an explicit service_role SELECT grant and lose any
--    PUBLIC grant; the gated views lose any PUBLIC/anon grant.
-- 3. Views keep `select *` (frozen column list). Documented on each view and
--    asserted below: column count must equal its snapshot's. Any future
--    ALTER on a snapshot must recreate its view.
-- 4. Verification checks BOTH refresh targets, and PostgREST reloads schema.
--
-- ROLLBACK (forward migration): recreate both views with the 20261218043336
-- gate text `where (select app.has_app_access('dam'::app.app_name))`.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace view public.style_guide_folders with (security_invoker = false) as
  select * from public.style_guide_folders_snapshot
  where (select app.has_app_access('dam'::app.app_name) or auth.role() = 'service_role');

create or replace view public.style_guide_file_groups with (security_invoker = false) as
  select * from public.style_guide_file_groups_snapshot
  where (select app.has_app_access('dam'::app.app_name) or auth.role() = 'service_role');

revoke all on public.style_guide_folders_snapshot from public, anon, authenticated;
revoke all on public.style_guide_file_groups_snapshot from public, anon, authenticated;
grant select on public.style_guide_folders_snapshot to service_role;
grant select on public.style_guide_file_groups_snapshot to service_role;

revoke all on public.style_guide_folders from public, anon;
revoke all on public.style_guide_file_groups from public, anon;
grant select on public.style_guide_folders to authenticated, service_role;
grant select on public.style_guide_file_groups to authenticated, service_role;

comment on view public.style_guide_folders is
  'Caller-gated projection of style_guide_folders_snapshot (#6418/#6452). select * is frozen at creation: recreate this view after any column change on the snapshot.';
comment on view public.style_guide_file_groups is
  'Caller-gated projection of style_guide_file_groups_snapshot (#6418/#6452). select * is frozen at creation: recreate this view after any column change on the snapshot.';

do $verify$
declare
  v text;
  v_def text;
  v_body text;
begin
  foreach v in array array['style_guide_folders', 'style_guide_file_groups'] loop
    v_def := pg_get_viewdef(format('public.%I', v)::regclass);
    if v_def not like '%has_app_access%' or v_def not like '%service_role%' then
      raise exception '#6452: view public.% gate incomplete', v;
    end if;
    if (select count(*) from pg_attribute where attrelid = format('public.%I', v)::regclass and attnum > 0 and not attisdropped)
       <> (select count(*) from pg_attribute where attrelid = format('public.%I_snapshot', v)::regclass and attnum > 0 and not attisdropped) then
      raise exception '#6452: view public.% column list differs from its snapshot', v;
    end if;
    foreach v_def in array array['public', 'anon', 'authenticated'] loop
      if has_table_privilege(v_def, format('public.%I_snapshot', v), 'select') then
        raise exception '#6452: snapshot public.%_snapshot readable by %', v, v_def;
      end if;
    end loop;
    if has_table_privilege('public', format('public.%I', v), 'select')
       or has_table_privilege('anon', format('public.%I', v), 'select') then
      raise exception '#6452: view public.% readable by public/anon', v;
    end if;
    if not has_table_privilege('service_role', format('public.%I_snapshot', v), 'select')
       or not has_table_privilege('service_role', format('public.%I', v), 'select') then
      raise exception '#6452: service_role lost read on public.%', v;
    end if;
  end loop;

  select pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure) into v_body;
  if v_body not like '%concurrently public.style_guide_file_groups_snapshot%'
     or v_body not like '%concurrently public.style_guide_folders_snapshot%'
     or v_body ~ 'concurrently public\.style_guide_(file_groups|folders)\s*;' then
    raise exception '#6452: refresh function does not target both snapshots';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;
