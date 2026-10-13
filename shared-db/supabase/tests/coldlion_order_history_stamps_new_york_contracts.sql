-- Rolled-back structural contracts for issue #4150: the four ColdLion /orderHistory
-- stamps on coldlion.order_history_line, nullable, typed, and read as New York time.
begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'coldlion.order_history_line'::regclass
    and a.attnum > 0 and not a.attisdropped and not a.attnotnull and not a.atthasdef
    and ((a.attname in ('created_time','mod_time') and a.atttypid = 'timestamptz'::regtype)
      or (a.attname in ('created_user','mod_user') and a.atttypid = 'text'::regtype));
  if v_count <> 4 then
    raise exception 'order_history_line carries % of 4 nullable, default-free stamp columns', v_count;
  end if;

  -- The column comment is deliberately not asserted: the from-empty CI replay can re-run
  -- 20261009170724 in its second pass AFTER this migration, restoring that file's older
  -- comment text, an ordering artefact that cannot occur on a real target.

  -- The acceptance example: 2026-05-05 16:25:21.159 New York (EDT) is 20:25:21.159 UTC.
  if ('2026-05-05 16:25:21.159'::timestamp at time zone 'America/New_York')
     <> '2026-05-05 20:25:21.159+00'::timestamptz then
    raise exception 'America/New_York reading of the acceptance example is wrong';
  end if;
end $$;

rollback;
