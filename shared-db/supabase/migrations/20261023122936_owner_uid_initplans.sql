-- Issue #4428; claim #4624; reserved version 20261023122936.
-- Wrap only the request-constant auth.uid() value in 17 ownership policies.
-- user_id comparisons stay row-dependent. WITH CHECK inheritance preserved.
-- catalog-verification: policies only (ALTER POLICY expressions); no new relations.

set local search_path = public, pg_catalog;

do $rls4428_before$
declare
  v_count int;
  r record;
begin
  if (select provolatile from pg_proc where oid = 'auth.uid()'::regprocedure) <> 's' then
    raise exception 'auth.uid() must be STABLE';
  end if;

  select count(*) into v_count
  from pg_policies
  where (schemaname, tablename, policyname) in (
    ('public','app_access','Users read own app_access'),
    ('public','asset_checkouts','users insert own checkouts'),
    ('public','asset_checkouts','users update own checkouts'),
    ('public','helper_devices','users insert own devices'),
    ('public','helper_devices','users see own devices'),
    ('public','helper_devices','users update own devices'),
    ('public','helper_tokens','users insert own tokens'),
    ('public','helper_tokens','users see own tokens'),
    ('public','order_list_user_views','order_list_user_views_owner_delete'),
    ('public','order_list_user_views','order_list_user_views_owner_insert'),
    ('public','order_list_user_views','order_list_user_views_owner_select'),
    ('public','order_list_user_views','order_list_user_views_owner_update'),
    ('public','profiles','Users read own profile'),
    ('public','profiles','Users update own profile'),
    ('public','style_tracker_user_views','Users insert their own style tracker views'),
    ('public','style_tracker_user_views','Users read their own style tracker views'),
    ('public','style_tracker_user_views','Users update their own style tracker views')
  );
  if v_count <> 17 then
    raise exception 'expected 17 target ownership policies, found %', v_count;
  end if;

  -- Fail closed unless every target still has the exact original expressions.
  for r in
    select policyname, tablename, cmd, roles, permissive, qual, with_check
    from pg_policies
    where (schemaname, tablename, policyname) in (
      ('public','app_access','Users read own app_access'),
      ('public','asset_checkouts','users insert own checkouts'),
      ('public','asset_checkouts','users update own checkouts'),
      ('public','helper_devices','users insert own devices'),
      ('public','helper_devices','users see own devices'),
      ('public','helper_devices','users update own devices'),
      ('public','helper_tokens','users insert own tokens'),
      ('public','helper_tokens','users see own tokens'),
      ('public','order_list_user_views','order_list_user_views_owner_delete'),
      ('public','order_list_user_views','order_list_user_views_owner_insert'),
      ('public','order_list_user_views','order_list_user_views_owner_select'),
      ('public','order_list_user_views','order_list_user_views_owner_update'),
      ('public','profiles','Users read own profile'),
      ('public','profiles','Users update own profile'),
      ('public','style_tracker_user_views','Users insert their own style tracker views'),
      ('public','style_tracker_user_views','Users read their own style tracker views'),
      ('public','style_tracker_user_views','Users update their own style tracker views')
    )
  loop
    if r.qual is not null and r.qual is distinct from '(user_id = auth.uid())' then
      raise exception 'policy %.% qual drifted: %', r.tablename, r.policyname, r.qual;
    end if;
    if r.with_check is not null and r.with_check is distinct from '(user_id = auth.uid())' then
      raise exception 'policy %.% with_check drifted: %', r.tablename, r.policyname, r.with_check;
    end if;
  end loop;
end
$rls4428_before$;

ALTER POLICY "Users read own app_access" ON "public"."app_access"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users insert own checkouts" ON "public"."asset_checkouts"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users update own checkouts" ON "public"."asset_checkouts"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users insert own devices" ON "public"."helper_devices"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users see own devices" ON "public"."helper_devices"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users update own devices" ON "public"."helper_devices"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users insert own tokens" ON "public"."helper_tokens"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "users see own tokens" ON "public"."helper_tokens"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "order_list_user_views_owner_delete" ON "public"."order_list_user_views"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "order_list_user_views_owner_insert" ON "public"."order_list_user_views"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "order_list_user_views_owner_select" ON "public"."order_list_user_views"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "order_list_user_views_owner_update" ON "public"."order_list_user_views"
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users read own profile" ON "public"."profiles"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users update own profile" ON "public"."profiles"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users insert their own style tracker views" ON "public"."style_tracker_user_views"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users read their own style tracker views" ON "public"."style_tracker_user_views"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER POLICY "Users update their own style tracker views" ON "public"."style_tracker_user_views"
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

do $rls4428_after$
declare
  v_count int;
  r record;
begin
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and (qual like '%( SELECT auth.uid() AS uid)%' or with_check like '%( SELECT auth.uid() AS uid)%')
    and tablename in (
      'app_access','asset_checkouts','helper_devices','helper_tokens',
      'order_list_user_views','profiles','style_tracker_user_views'
    );
  if v_count < 17 then
    raise exception 'after-guard: expected at least 17 wrapped ownership policies, found %', v_count;
  end if;

  for r in
    select policyname, tablename, qual, with_check
    from pg_policies
    where (schemaname, tablename, policyname) in (
      ('public','app_access','Users read own app_access'),
      ('public','asset_checkouts','users insert own checkouts'),
      ('public','asset_checkouts','users update own checkouts'),
      ('public','helper_devices','users insert own devices'),
      ('public','helper_devices','users see own devices'),
      ('public','helper_devices','users update own devices'),
      ('public','helper_tokens','users insert own tokens'),
      ('public','helper_tokens','users see own tokens'),
      ('public','order_list_user_views','order_list_user_views_owner_delete'),
      ('public','order_list_user_views','order_list_user_views_owner_insert'),
      ('public','order_list_user_views','order_list_user_views_owner_select'),
      ('public','order_list_user_views','order_list_user_views_owner_update'),
      ('public','profiles','Users read own profile'),
      ('public','profiles','Users update own profile'),
      ('public','style_tracker_user_views','Users insert their own style tracker views'),
      ('public','style_tracker_user_views','Users read their own style tracker views'),
      ('public','style_tracker_user_views','Users update their own style tracker views')
    )
  loop
    if coalesce(r.qual, '') = '' and coalesce(r.with_check, '') = '' then
      raise exception 'policy %.% lost both clauses', r.tablename, r.policyname;
    end if;
    if r.qual is not null and position('( SELECT auth.uid() AS uid)' in r.qual) = 0 then
      raise exception 'policy %.% qual not wrapped: %', r.tablename, r.policyname, r.qual;
    end if;
    if r.with_check is not null and position('( SELECT auth.uid() AS uid)' in r.with_check) = 0 then
      raise exception 'policy %.% with_check not wrapped: %', r.tablename, r.policyname, r.with_check;
    end if;
  end loop;
end
$rls4428_after$;
