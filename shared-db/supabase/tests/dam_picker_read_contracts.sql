begin;

do $$
declare
  v_user_id uuid;
  v_profile_id uuid;
  v_email extensions.citext;
  v_customer_count bigint;
  v_factory_count bigint;
begin
  select p.auth_user_id, p.id, p.email
    into v_user_id, v_profile_id, v_email
  from app.profile p
  order by p.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'No existing profile is available for the rollback-only DAM access contract test';
  end if;

  delete from app.app_access
  where profile_id = v_profile_id
    and app = 'dam'::app.app_name;

  insert into public.profiles (user_id, email)
  values (v_user_id, v_email)
  on conflict (user_id) do nothing;

  insert into public.app_access (user_id, app)
  values (v_user_id, 'popdam')
  on conflict do nothing;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  if not public.has_app_access(v_user_id, 'popdam') then
    raise exception 'Legacy PopDAM access fixture was not recognized';
  end if;
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
