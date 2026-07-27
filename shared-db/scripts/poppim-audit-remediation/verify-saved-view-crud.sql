\set ON_ERROR_STOP on

begin;

do $$
declare
  v_profile uuid;
  v_other_profile uuid;
  v_view uuid;
begin
  select p.id
  into strict v_profile
  from app.profile p
  join app.app_access aa on aa.profile_id = p.id
  where aa.app = 'pm'
    and aa.revoked_at is null
  limit 1;

  select p.id
  into strict v_other_profile
  from app.profile p
  where p.id <> v_profile
  limit 1;

  perform set_config('request.jwt.claim.sub', (
    select auth_user_id::text from app.profile where id = v_profile
  ), true);
  set local role authenticated;

  insert into pim.saved_view (
    owner_profile_id, name, scope, config, is_default
  )
  values (
    v_profile,
    'Poppim saved-view CRUD rollback verification',
    'personal',
    '{"screen":"pipeline","business_unit":"Licensed"}',
    false
  )
  returning id into v_view;

  update pim.saved_view
  set name = 'Poppim saved-view CRUD rollback verification updated'
  where id = v_view;

  if not exists (
    select 1 from pim.saved_view
    where id = v_view
      and name like '%updated'
  ) then
    raise exception 'owner update was not visible';
  end if;

  begin
    insert into pim.saved_view (
      owner_profile_id, name, scope, config, is_default
    )
    values (
      v_other_profile,
      'Poppim forbidden foreign-owner view',
      'personal',
      '{}',
      false
    );
    raise exception 'foreign-owner insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  delete from pim.saved_view where id = v_view;

  if exists (select 1 from pim.saved_view where id = v_view) then
    raise exception 'owner delete did not remove the saved view';
  end if;
end $$;

rollback;
