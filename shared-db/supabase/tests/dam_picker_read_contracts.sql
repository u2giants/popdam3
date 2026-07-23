begin;

do $$
declare
  v_user_id uuid;
  v_profile_id uuid;
  v_customer_count bigint;
  v_factory_count bigint;
begin
  select p.auth_user_id, p.id
    into v_user_id, v_profile_id
  from app.profile p
  order by p.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'No existing profile is available for the rollback-only DAM access contract test';
  end if;

  insert into app.app_access (profile_id, app)
  values (v_profile_id, 'dam'::app.app_name)
  on conflict do nothing;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select count(*) into v_customer_count from api.dam_customer_list;
  select count(*) into v_factory_count from api.dam_factory_list;

  if v_customer_count = 0 then
    raise exception 'DAM-access user received zero customer picker rows';
  end if;
  if v_factory_count = 0 then
    raise exception 'DAM-access user received zero vendor picker rows';
  end if;
end
$$;

rollback;
