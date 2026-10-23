-- Issue #4428 ownership InitPlan contracts.
-- LOCAL THROWAWAY DATABASE ONLY. Never execute against production.
-- Asserts the 17 target policies carry the wrapped auth.uid() form.
begin;
do $rls4428_contracts$
declare
  v_unwrapped int;
begin
  select count(*) into v_unwrapped
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
  and not (
    coalesce(qual, '') like '%( SELECT auth.uid() AS uid)%'
    or coalesce(with_check, '') like '%( SELECT auth.uid() AS uid)%'
  );
  if v_unwrapped <> 0 then
    raise exception 'rls4428: % target policies lack the wrapped auth.uid() form', v_unwrapped;
  end if;
end
$rls4428_contracts$;
rollback;
