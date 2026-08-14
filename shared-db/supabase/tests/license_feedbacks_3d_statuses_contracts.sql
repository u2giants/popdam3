-- Synthetic catalog contract for issue #961. Contains no licensed source data.
do $$
declare
  v_bad integer;
begin
  with expected(status, access, item_order, duplicable) as (values
    ('3D Submitted', 'POP', 7, false),
    ('3D Resubmitted', 'POP', 8, true),
    ('3D Not Approved at All', 'Licensor', 9, false),
    ('3D Needs Revisions', 'Licensor', 10, true),
    ('3D Approved with Revisions', 'Licensor', 11, false),
    ('3D Approved', 'Licensor', 12, false)
  ), actual as (
    select 'dflow' as schema_name, status, access, item_order, duplicable, phase, "order"
      from dflow."LicenseFeedBacks" where status in (select status from expected)
    union all
    select 'plm', status, access, item_order, duplicable, phase, "order"
      from plm."LicenseFeedBacks" where status in (select status from expected)
  )
  select count(*) into v_bad
  from (
    select s.schema_name, e.status
    from (values ('dflow'), ('plm')) s(schema_name) cross join expected e
    left join actual a on a.schema_name = s.schema_name and a.status = e.status
      and a.access = e.access and a.item_order = e.item_order
      and a.duplicable = e.duplicable
      and a.phase = 'Phase 1.1 - 3D Approval' and a."order" = e.item_order::text
    group by s.schema_name, e.status
    having count(a.status) <> 1
  ) failures;

  if v_bad <> 0 then
    raise exception '3D licensing catalog contract failed for % schema/status pair(s)', v_bad;
  end if;
end;
$$;
