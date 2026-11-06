-- Issue #5758 — contract for coldlion.rotate_change_log (migration 20261106021547).
-- Albert 2026-11-05: "everything for the past 7 days, then once a day for the
-- previous 2 months, then once a week for year". Each record's newest entry is
-- never deleted. Everything below is synthetic (ZZ*) and rolled back.
begin;

do $$
declare
  v_run uuid;
  v_now timestamptz := now();
  v_tiers int;
  v_rows bigint;
  v_bad bigint;
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/items', 'ZZTEST', 'ZZTEST') returning id into v_run;

  -- Key A: one entry every hour for 400 days.
  insert into coldlion.change_log (table_name, natural_key, change_kind, previous_source_hash, new_source_hash, previous_raw, new_raw, run_id, changed_at)
  select 'zz_rotation', '{"k":"A"}'::jsonb, 'updated', repeat('a', 64), repeat('b', 64), '{"v":0}'::jsonb, jsonb_build_object('v', h), v_run,
         v_now - make_interval(hours => h)
    from generate_series(0, 400 * 24) h;
  -- Key B: one lone entry, three years old.
  insert into coldlion.change_log (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id, changed_at)
  values ('zz_rotation', '{"k":"B"}'::jsonb, 'inserted', repeat('c', 64), '{"v":1}'::jsonb, v_run, v_now - interval '3 years');

  select count(*) into v_rows from coldlion.change_log where table_name = 'zz_rotation';

  -- Dry run reports all three tiers and deletes nothing.
  select count(*) into v_tiers from coldlion.rotate_change_log(true)
   where tier in ('daily_7_days_to_2_months', 'weekly_2_months_to_1_year', 'older_than_1_year') and deleted > 0;
  if v_tiers <> 3 then raise exception 'A FAILED: dry run returned % non-empty tiers, expected 3', v_tiers; end if;
  if (select count(*) from coldlion.change_log where table_name = 'zz_rotation') <> v_rows then
    raise exception 'A FAILED: dry run deleted rows';
  end if;
  raise notice 'A PASSED: dry run returns the three tiers and deletes nothing.';

  perform coldlion.rotate_change_log(false);

  if (select count(*) from coldlion.change_log where table_name = 'zz_rotation' and natural_key = '{"k":"A"}' and changed_at >= v_now - interval '7 days')
     <> (select count(*) from generate_series(0, 400 * 24) h where v_now - make_interval(hours => h) >= v_now - interval '7 days') then
    raise exception 'B FAILED: an entry younger than 7 days was deleted';
  end if;
  select count(*) into v_bad from (
    select date_trunc('day', changed_at at time zone 'America/New_York') d from coldlion.change_log
     where table_name = 'zz_rotation' and natural_key = '{"k":"A"}'
       and changed_at < v_now - interval '7 days' and changed_at >= v_now - interval '2 months'
     group by 1 having count(*) <> 1) x;
  if v_bad <> 0 then raise exception 'C FAILED: % New York days between 7 days and 2 months do not hold exactly one entry', v_bad; end if;
  select count(*) into v_bad from (
    select date_trunc('week', changed_at at time zone 'America/New_York') w from coldlion.change_log
     where table_name = 'zz_rotation' and natural_key = '{"k":"A"}'
       and changed_at < v_now - interval '2 months' and changed_at >= v_now - interval '1 year'
     group by 1 having count(*) <> 1) x;
  if v_bad <> 0 then raise exception 'D FAILED: % ISO weeks between 2 months and 1 year do not hold exactly one entry', v_bad; end if;
  if exists (select 1 from coldlion.change_log where table_name = 'zz_rotation' and natural_key = '{"k":"A"}' and changed_at < v_now - interval '1 year') then
    raise exception 'E FAILED: an entry older than 1 year survived for a record with newer history';
  end if;
  if not exists (select 1 from coldlion.change_log where table_name = 'zz_rotation' and natural_key = '{"k":"B"}') then
    raise exception 'F FAILED: the newest (only) entry of a quiet record was deleted';
  end if;
  raise notice 'B-F PASSED: tiers hold and every record keeps its newest entry.';

  if has_function_privilege('anon', 'coldlion.rotate_change_log(boolean)', 'execute')
     or has_function_privilege('authenticated', 'coldlion.rotate_change_log(boolean)', 'execute')
     or not has_function_privilege('service_role', 'coldlion.rotate_change_log(boolean)', 'execute') then
    raise exception 'G FAILED: rotate_change_log must be executable by service_role only';
  end if;
  if not exists (select 1 from cron.job where jobname = 'coldlion-change-log-rotation' and schedule = '0 8 * * 0') then
    raise exception 'H FAILED: weekly rotation cron job is not scheduled';
  end if;
  raise notice 'G-H PASSED: service_role only, weekly cron scheduled.';
end;
$$;

rollback;
