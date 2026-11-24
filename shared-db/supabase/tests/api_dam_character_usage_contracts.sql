-- Verification for migration 20261225091609_api_dam_character_usage (popcre/shared-db#6995).
-- Proves: the api view and publish function exist with the agreed grants, the
-- view is security invoker, and publish upserts rows atomically. Rolls back.
begin;

do $$
declare
  v_char uuid := gen_random_uuid();
  v_n integer;
begin
  if to_regclass('api.dam_character_usage') is null then
    raise exception 'api.dam_character_usage missing';
  end if;
  if not coalesce((select 'security_invoker=true' = any(reloptions) from pg_class
                   where oid = 'api.dam_character_usage'::regclass), false) then
    raise exception 'api.dam_character_usage must be security_invoker';
  end if;
  if not has_table_privilege('authenticated', 'api.dam_character_usage', 'select')
     or not has_table_privilege('service_role', 'api.dam_character_usage', 'select')
     or has_table_privilege('anon', 'api.dam_character_usage', 'select')
     or has_table_privilege('authenticated', 'api.dam_character_usage', 'insert') then
    raise exception 'api.dam_character_usage grants wrong';
  end if;
  if not has_function_privilege('service_role', 'api.dam_publish_character_usage(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'api.dam_publish_character_usage(jsonb)', 'execute')
     or has_function_privilege('anon', 'api.dam_publish_character_usage(jsonb)', 'execute') then
    raise exception 'api.dam_publish_character_usage grants wrong';
  end if;
  if not (select prosecdef from pg_proc where oid = 'api.dam_publish_character_usage(jsonb)'::regprocedure) then
    raise exception 'api.dam_publish_character_usage must be security definer';
  end if;

  insert into core.character (id, name) values (v_char, 'zz6995 usage character');
  v_n := api.dam_publish_character_usage(jsonb_build_array(
    jsonb_build_object('core_character_id', v_char, 'usage_count', 7, 'is_priority', false)));
  if v_n <> 1 or (select usage_count from api.dam_character_usage where core_character_id = v_char) <> 7 then
    raise exception 'publish insert failed';
  end if;
  v_n := api.dam_publish_character_usage(jsonb_build_array(
    jsonb_build_object('core_character_id', v_char, 'usage_count', 12, 'is_priority', true)));
  if v_n <> 1 or (select usage_count from api.dam_character_usage where core_character_id = v_char) <> 12
     or not (select is_priority from api.dam_character_usage where core_character_id = v_char) then
    raise exception 'publish update failed';
  end if;
  if api.dam_publish_character_usage('[]'::jsonb) <> 0 then
    raise exception 'empty publish must affect 0 rows';
  end if;
end $$;

rollback;
