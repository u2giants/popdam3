-- Claim #5778 (work issue #5758, plan_db-anti-bloat-safeguards.md Step 2).
-- ColdLion change history rotation, Albert 2026-11-05: "everything for the past
-- 7 days, then once a day for the previous 2 months, then once a week for year".
--   * younger than 7 days: every entry kept;
--   * 7 days to 2 months: the last entry per record per New York calendar day;
--   * 2 months to 1 year: the last entry per record per ISO week (New York);
--   * older than 1 year: deleted;
--   * the newest entry of every record is NEVER deleted, whatever its age,
--     because the loaders read the latest change_log row per key (load-masters
--     "prior" join, prod-details latest new_raw).
-- Runs weekly from pg_cron. Dry run (the default) deletes nothing.

create or replace function coldlion.rotate_change_log(p_dry_run boolean default true)
returns table(tier text, deleted bigint)
language plpgsql
security definer
set search_path = pg_catalog, coldlion
set lock_timeout = '2s'
as $$
declare
  v_now timestamptz := now();
  v_week timestamptz := v_now - interval '7 days';
  v_two_months timestamptz := v_now - interval '2 months';
  v_year timestamptz := v_now - interval '1 year';
  v_batch int;
begin
  drop table if exists pg_temp._coldlion_rotation;
  create temp table _coldlion_rotation (id uuid primary key, tier text not null) on commit drop;

  insert into _coldlion_rotation (id, tier)
  select x.id, x.tier
    from (
      select c.id, c.changed_at,
             case when c.changed_at < v_year then 'older_than_1_year'
                  when c.changed_at < v_two_months then 'weekly_2_months_to_1_year'
                  else 'daily_7_days_to_2_months' end as tier,
             row_number() over (partition by c.table_name, c.natural_key
                                order by c.changed_at desc, c.id desc) as key_rank,
             row_number() over (partition by c.table_name, c.natural_key,
                                case when c.changed_at < v_year then null
                                     when c.changed_at < v_two_months
                                       then date_trunc('week', c.changed_at at time zone 'America/New_York')
                                     when c.changed_at < v_week
                                       then date_trunc('day', c.changed_at at time zone 'America/New_York')
                                     else c.changed_at at time zone 'UTC' end,
                                (c.changed_at < v_year)
                                order by c.changed_at desc, c.id desc) as bucket_rank
        from coldlion.change_log c
    ) x
   where x.changed_at < v_week
     and x.key_rank > 1
     and (x.tier = 'older_than_1_year' or x.bucket_rank > 1);

  if not p_dry_run then
    loop
      with batch as (
        select r.id from _coldlion_rotation r
         where exists (select 1 from coldlion.change_log c where c.id = r.id)
         limit 20000
      )
      delete from coldlion.change_log c using batch b where c.id = b.id;
      get diagnostics v_batch = row_count;
      exit when v_batch = 0;
    end loop;
  end if;

  return query
  select t.tier, coalesce(count(r.id), 0)::bigint
    from (values ('daily_7_days_to_2_months', 1), ('weekly_2_months_to_1_year', 2), ('older_than_1_year', 3)) t(tier, ord)
    left join _coldlion_rotation r on r.tier = t.tier
   group by t.tier, t.ord
   order by t.ord;
end;
$$;

revoke all on function coldlion.rotate_change_log(boolean) from public, anon, authenticated;
grant execute on function coldlion.rotate_change_log(boolean) to service_role;

comment on function coldlion.rotate_change_log(boolean) is
  'Issue #5758. Thins coldlion.change_log to the owner-ruled tiers (all < 7 days; last per record per New York day to 2 months; last per record per ISO week to 1 year; nothing older) and never deletes a record''s newest entry. Dry run by default; the weekly pg_cron job coldlion-change-log-rotation runs it for real.';

comment on table coldlion.change_log is
  'One row per observed change to a current-state (master) landing row in this schema, carrying the complete payload on BOTH sides of the change. Current-state tables upsert on their natural key, which would otherwise destroy the previous truth. `natural_key` is a jsonb OBJECT because the keys here are two-, four- and five-part - mgCode collides across types and categories inside one division, so a flattened key would lose exactly the part that disambiguates it. `05` is never assumed to mean Licensor. Hashes are SHA-256 lowercase hex throughout. Retention (#5758): every entry for 7 days, then the last per record per New York day for 2 months, then the last per record per ISO week to 1 year, nothing older - except each record''s newest entry, which is always kept. Issue #1184 phase 1.';

comment on column coldlion.change_log.new_source_hash is
  'SHA-256 (lowercase hex) of the `raw` payload. One algorithm across the whole schema on purpose. For the /items and /itemDetails feeds the merchGroupNNDesc fields are excluded from the hash (#5758: the vendor omits them intermittently on identical requests), so a description-only difference is not a change; the complete payload is still kept in new_raw.';

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'coldlion-change-log-rotation' loop
    perform cron.unschedule(v_job_id);
  end loop;
  -- Sundays 08:00 UTC = 3:00 AM EST (4:00 AM EDT), clear of the 05:20 UTC nightly sync.
  perform cron.schedule(
    'coldlion-change-log-rotation',
    '0 8 * * 0',
    $cron_body$ select coldlion.rotate_change_log(false) $cron_body$
  );
end;
$cron$;
