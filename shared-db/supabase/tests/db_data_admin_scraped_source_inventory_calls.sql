begin;

-- Issue #2797: CALL every entity arm of api.db_data_admin_scraped_source_inventory.
--
-- plpgsql resolves relations only when a statement runs. The definition-only
-- contract test passed while the Character and Style Guide arms named two
-- dropped tables (plm.wb_character, plm.wb_style_guide), and every real call for
-- those kinds failed on production. Executing each arm as a Licensing Manager
-- is the only check that catches a missing relation. Assertions read the
-- response shape and counts only, never row contents.

do $$
declare
  v_profile uuid;
  v_auth uuid;
  v_role_id uuid;
  v_kind text;
  v_result jsonb;
  v_definition text;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_source_inventory(text,text,text,integer)'::regprocedure)
    into v_definition;

  if v_definition ~ 'plm\.wb_character([^_a-z]|$)'
     or v_definition ~ 'plm\.wb_style_guide([^_a-z]|$)' then
    raise exception 'inventory still names a retired Warner legacy relation';
  end if;

  if position('plm.wb_character_normalized' in v_definition) = 0
     or position('plm.wb_style_guide_normalized' in v_definition) = 0 then
    raise exception 'inventory does not read the normalized Warner relations';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  if v_profile is null then
    raise exception 'fixture requires an active authenticated profile';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  foreach v_kind in array array['property', 'character', 'style_guide'] loop
    begin
      v_result := api.db_data_admin_scraped_source_inventory(v_kind, null, null, 5);
    exception when undefined_table or undefined_column then
      raise exception 'inventory arm % references a missing object: %', v_kind, sqlerrm;
    end;
    if v_result is null or jsonb_typeof(v_result) <> 'object' then
      raise exception 'inventory arm % returned no object', v_kind;
    end if;
    -- Issue #2905: every returned row names a canonical licensor group.
    if exists (
      select 1 from jsonb_array_elements(v_result -> 'rows') r
      where coalesce(r ->> 'licensor_group_key', '') = ''
         or coalesce(r ->> 'licensor_group_name', '') = ''
    ) then
      raise exception 'inventory arm % returned a row without a canonical licensor group', v_kind;
    end if;
  end loop;

  -- Searching exercises the filtered path of every arm as well.
  foreach v_kind in array array['character', 'style_guide'] loop
    v_result := api.db_data_admin_scraped_source_inventory(v_kind, 'zz-no-such-label', null, 5);
    if v_result is null then
      raise exception 'inventory search on arm % returned null', v_kind;
    end if;
  end loop;
end $$;

rollback;
