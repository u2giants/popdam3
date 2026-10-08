-- =====================================================================================
-- PopDAM: atomic progress counters for public.admin_config JSON values.
-- Work issue #4064, claim #4065 (version reissued from 20261007233337 by the lane tool). App issue u2giants/popdam3#218.
-- Owner request (Albert Hazan, verbatim): "have a subagent do the shared database change
-- for lost progress counts."
--
-- The PopDAM agent-api edge function updates PDF_BACKFILL / POPSG_PDF_BACKFILL progress by
-- reading the JSON value, adding to it in the function, and upserting the whole object back.
-- Concurrent agents overwrite each other and counts are lost. This function performs the
-- read-add-write in one statement-level transaction under a row lock.
--
--   p_increments: JSON object. A numeric member is added to the same top-level member
--                 (a missing or JSON-null stored member counts as 0). An object member is
--                 added one level deep, member by member (e.g. {"stats":{"gemini":3}}).
--                 A stored member of the wrong kind (non-number where a number is added,
--                 non-object where an object is added) is refused, never replaced.
--   p_set:        JSON object shallow-merged AFTER the increments (plain overwrite).
--   SQL NULL for p_increments or p_set means "nothing" (same as the '{}' defaults);
--   any JSON value that is not an object is refused.
-- The row is created with '{}' if the key does not exist. A stored value that is not a JSON
-- object is refused (never silently replaced). Returns the new value.
--
-- Additive only: one new function. SECURITY INVOKER (callers keep their own RLS), empty
-- search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role.
-- =====================================================================================

do $$
begin
  if (select c.relkind from pg_class c where c.oid = to_regclass('public.admin_config')) is distinct from 'r' then
    raise exception 'preflight: public.admin_config is missing or not an ordinary table';
  end if;
  if to_regprocedure('public.admin_config_apply_counters(text,jsonb,jsonb)') is not null then
    raise exception 'preflight: public.admin_config_apply_counters already exists';
  end if;
  -- ON CONFLICT (key) needs a primary key or unique constraint on exactly (key).
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.admin_config'::regclass and c.contype in ('p', 'u')
      and not c.condeferrable and c.convalidated
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.admin_config'::regclass and a.attname = 'key')]::int2[]
  ) then
    raise exception 'preflight: public.admin_config has no primary key or unique constraint on (key)';
  end if;
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = 'public.admin_config'::regclass and a.attname = 'value' and not a.attisdropped) is distinct from 'jsonb' then
    raise exception 'preflight: public.admin_config.value is not jsonb';
  end if;
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = 'public.admin_config'::regclass and a.attname = 'updated_at' and not a.attisdropped)
     is distinct from 'timestamp with time zone' then
    raise exception 'preflight: public.admin_config.updated_at is not timestamptz';
  end if;
end $$;

create function public.admin_config_apply_counters(
  p_key text,
  p_increments jsonb default '{}'::jsonb,
  p_set jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value jsonb;
  v_inc record;
  v_sub record;
  v_nested jsonb;
  v_cur jsonb;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'admin_config_apply_counters: p_key is required';
  end if;
  p_increments := coalesce(p_increments, '{}'::jsonb);
  p_set := coalesce(p_set, '{}'::jsonb);
  if jsonb_typeof(p_increments) <> 'object' or jsonb_typeof(p_set) <> 'object' then
    raise exception 'admin_config_apply_counters: p_increments and p_set must be JSON objects';
  end if;

  insert into public.admin_config (key, value)
  values (p_key, '{}'::jsonb)
  on conflict (key) do nothing;

  select ac.value into v_value
  from public.admin_config ac
  where ac.key = p_key
  for update;

  if v_value is null or jsonb_typeof(v_value) <> 'object' then
    raise exception 'admin_config_apply_counters: stored value for % is not a JSON object', p_key;
  end if;

  for v_inc in select * from jsonb_each(p_increments) loop
    if jsonb_typeof(v_inc.value) = 'number' then
      v_cur := v_value -> v_inc.key;
      if coalesce(jsonb_typeof(v_cur), 'null') not in ('number', 'null') then
        raise exception 'admin_config_apply_counters: stored % is not a number', v_inc.key;
      end if;
      v_value := jsonb_set(v_value, array[v_inc.key], to_jsonb(
        (case when jsonb_typeof(v_cur) = 'number' then v_cur::text::numeric else 0 end)
        + v_inc.value::text::numeric));
    elsif jsonb_typeof(v_inc.value) = 'object' then
      if coalesce(jsonb_typeof(v_value -> v_inc.key), 'null') not in ('object', 'null') then
        raise exception 'admin_config_apply_counters: stored % is not a JSON object', v_inc.key;
      end if;
      v_nested := case when jsonb_typeof(v_value -> v_inc.key) = 'object'
                       then v_value -> v_inc.key else '{}'::jsonb end;
      for v_sub in select * from jsonb_each(v_inc.value) loop
        if jsonb_typeof(v_sub.value) <> 'number' then
          raise exception 'admin_config_apply_counters: %.% is not a number', v_inc.key, v_sub.key;
        end if;
        v_cur := v_nested -> v_sub.key;
        if coalesce(jsonb_typeof(v_cur), 'null') not in ('number', 'null') then
          raise exception 'admin_config_apply_counters: stored %.% is not a number', v_inc.key, v_sub.key;
        end if;
        v_nested := jsonb_set(v_nested, array[v_sub.key], to_jsonb(
          (case when jsonb_typeof(v_cur) = 'number' then v_cur::text::numeric else 0 end)
          + v_sub.value::text::numeric));
      end loop;
      v_value := jsonb_set(v_value, array[v_inc.key], v_nested);
    else
      raise exception 'admin_config_apply_counters: increment % must be a number or object', v_inc.key;
    end if;
  end loop;

  v_value := v_value || p_set;

  update public.admin_config ac
  set value = v_value, updated_at = now()
  where ac.key = p_key;
  if not found then
    raise exception 'admin_config_apply_counters: row % vanished before update', p_key;
  end if;

  return v_value;
end;
$$;

comment on function public.admin_config_apply_counters(text, jsonb, jsonb) is
  'Atomically add numeric increments (one nested level) to an admin_config JSON value and shallow-merge p_set; creates the row if missing. Service-role only. shared-db#4064, u2giants/popdam3#218.';

revoke all on function public.admin_config_apply_counters(text, jsonb, jsonb) from public;
revoke all on function public.admin_config_apply_counters(text, jsonb, jsonb) from anon, authenticated;
grant execute on function public.admin_config_apply_counters(text, jsonb, jsonb) to service_role;
