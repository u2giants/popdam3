-- popcre/shared-db#6995 (stage C2 follow-up): PopDAM reaches dam.character_usage
-- through the exposed `api` schema (`dam` is not exposed by PostgREST and stays so).
--   api.dam_character_usage            security-invoker view, read by authenticated + service_role
--   api.dam_publish_character_usage()  security definer, service_role only; PopDAM computes
--                                      usage_count / is_priority and publishes changed rows
--                                      in one atomic upsert.

create or replace view api.dam_character_usage with (security_invoker = true) as
  select core_character_id, usage_count, is_priority, updated_at
  from dam.character_usage;
comment on view api.dam_character_usage is
  'PopDAM character usage per core.character (dam.character_usage), popcre/shared-db#6995.';
revoke all on api.dam_character_usage from public, anon, authenticated, service_role;
grant select on api.dam_character_usage to authenticated, service_role;

create or replace function api.dam_publish_character_usage(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'dam_publish_character_usage: p_rows must be a JSON array'
      using errcode = '22023';
  end if;
  insert into dam.character_usage as u (core_character_id, usage_count, is_priority, updated_at)
  select r.core_character_id, r.usage_count, r.is_priority, now()
  from jsonb_to_recordset(p_rows) as r(core_character_id uuid, usage_count integer, is_priority boolean)
  on conflict (core_character_id) do update
    set usage_count = excluded.usage_count,
        is_priority = excluded.is_priority,
        updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function api.dam_publish_character_usage(jsonb) is
  'Upsert PopDAM character usage rows [{core_character_id, usage_count, is_priority}] into dam.character_usage; returns rows affected (popcre/shared-db#6995).';
revoke all on function api.dam_publish_character_usage(jsonb) from public, anon, authenticated;
grant execute on function api.dam_publish_character_usage(jsonb) to service_role;
