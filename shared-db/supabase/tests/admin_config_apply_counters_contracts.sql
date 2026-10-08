begin;

-- shared-db#4064: public.admin_config_apply_counters adds increments atomically,
-- merges p_set, creates missing rows, and is service_role-only. Rolled back.
do $$
declare
  v jsonb;
  k text := 'ZZ_TEST_COUNTERS_' || gen_random_uuid();
begin
  v := public.admin_config_apply_counters(k, '{"processed":2,"stats":{"a":1}}', '{"status":"running"}');
  if v <> '{"processed":2,"stats":{"a":1},"status":"running"}'::jsonb then
    raise exception 'first call wrong: %', v;
  end if;
  v := public.admin_config_apply_counters(k, '{"processed":3,"refused":1,"stats":{"a":4,"b":1}}', '{}');
  if (v->>'processed')::int <> 5 or (v->>'refused')::int <> 1
     or (v->'stats'->>'a')::int <> 5 or (v->'stats'->>'b')::int <> 1
     or v->>'status' <> 'running' then
    raise exception 'second call wrong: %', v;
  end if;
  v := public.admin_config_apply_counters(k, '{}', '{"status":"completed","live_current_file":null}');
  if v->>'status' <> 'completed' or (v->>'processed')::int <> 5 then
    raise exception 'set-only call wrong: %', v;
  end if;
  if (select value from public.admin_config where key = k) <> v then
    raise exception 'stored value does not match returned value';
  end if;
  -- Every refusal must raise its own expected message; any other error fails the test.
  declare
    v_cases text[][] := array[
      array['{"processed":"x"}', '{}', k, 'increment processed must be a number or object'],
      array['{"stats":{"a":"x"}}', '{}', k, 'stats.a is not a number'],
      array['[1]', '{}', k, 'p_increments and p_set must be JSON objects'],
      array['{}', '"s"', k, 'p_increments and p_set must be JSON objects'],
      array['{}', '{}', '', 'p_key is required']
    ];
    v_msg text;
    i int;
  begin
    for i in 1 .. array_length(v_cases, 1) loop
      v_msg := null;
      begin
        perform public.admin_config_apply_counters(v_cases[i][3], v_cases[i][1]::jsonb, v_cases[i][2]::jsonb);
      exception when raise_exception then
        v_msg := sqlerrm;
      end;
      if v_msg is null or position(v_cases[i][4] in v_msg) = 0 then
        raise exception 'case % expected "%", got "%"', i, v_cases[i][4], coalesce(v_msg, 'no error');
      end if;
    end loop;
    -- Null key.
    v_msg := null;
    begin
      perform public.admin_config_apply_counters(null, '{}', '{}');
    exception when raise_exception then v_msg := sqlerrm;
    end;
    if v_msg is null or position('p_key is required' in v_msg) = 0 then
      raise exception 'null key not refused: %', coalesce(v_msg, 'no error');
    end if;
    -- A non-object stored value is refused and left unchanged.
    insert into public.admin_config (key, value) values (k || '_ARR', '[1,2]');
    v_msg := null;
    begin
      perform public.admin_config_apply_counters(k || '_ARR', '{"processed":1}', '{}');
    exception when raise_exception then v_msg := sqlerrm;
    end;
    if v_msg is null or position('is not a JSON object' in v_msg) = 0 then
      raise exception 'non-object stored value not refused: %', coalesce(v_msg, 'no error');
    end if;
    if (select value from public.admin_config where key = k || '_ARR') <> '[1,2]'::jsonb then
      raise exception 'non-object stored value was changed';
    end if;
  end;
  -- Stored members of the wrong kind are refused and left unchanged.
  declare
    v_stored jsonb := '{"stats":"oops","processed":"text","nested":{"n":"x"}}';
    v_calls text[] := array['{"stats":{"x":1}}', '{"processed":1}', '{"nested":{"n":1}}'];
    v_expect text[] := array['stored stats is not a JSON object', 'stored processed is not a number', 'stored nested.n is not a number'];
    v_msg text;
    i int;
  begin
    insert into public.admin_config (key, value) values (k || '_KIND', v_stored);
    for i in 1 .. 3 loop
      v_msg := null;
      begin
        perform public.admin_config_apply_counters(k || '_KIND', v_calls[i]::jsonb, '{}');
      exception when raise_exception then v_msg := sqlerrm;
      end;
      if v_msg is null or position(v_expect[i] in v_msg) = 0 then
        raise exception 'kind case % expected "%", got "%"', i, v_expect[i], coalesce(v_msg, 'no error');
      end if;
    end loop;
    if (select value from public.admin_config where key = k || '_KIND') <> v_stored then
      raise exception 'wrong-kind stored value was changed';
    end if;
  end;
  -- SQL NULL arguments mean nothing; JSON null stored member counts as 0.
  v := public.admin_config_apply_counters(k || '_NULLS', null, null);
  if v <> '{}'::jsonb then raise exception 'null arguments not treated as empty: %', v; end if;
  perform public.admin_config_apply_counters(k || '_NULLS', '{}', '{"processed":null}');
  v := public.admin_config_apply_counters(k || '_NULLS', '{"processed":2}', '{}');
  if (v->>'processed')::int <> 2 then raise exception 'JSON-null member not counted as 0: %', v; end if;
  -- p_set replaces an existing object member wholesale.
  v := public.admin_config_apply_counters(k, '{}', '{"stats":{"z":9}}');
  if v->'stats' <> '{"z":9}'::jsonb then raise exception 'p_set did not replace object member: %', v; end if;
  -- p_set is applied after increments and wins on the same member.
  v := public.admin_config_apply_counters(k, '{"processed":1}', '{"processed":0}');
  if (v->>'processed')::int <> 0 then
    raise exception 'p_set did not take precedence over the increment: %', v;
  end if;
  if has_function_privilege('anon', 'public.admin_config_apply_counters(text,jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_config_apply_counters(text,jsonb,jsonb)', 'execute') then
    raise exception 'browser roles can execute admin_config_apply_counters';
  end if;
  if not has_function_privilege('service_role', 'public.admin_config_apply_counters(text,jsonb,jsonb)', 'execute') then
    raise exception 'service_role cannot execute admin_config_apply_counters';
  end if;
end $$;

rollback;
