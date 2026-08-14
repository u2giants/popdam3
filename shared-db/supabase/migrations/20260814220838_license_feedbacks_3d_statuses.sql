-- Issue #961. Add the complete 3D approval phase to both DesignFlow catalogs.
-- Structural catalog rows only. Production promotion is separately governed.

insert into dflow."LicenseFeedBacks"
  (phase, status, explanation, duplicable, "order", access, item_order)
select * from (values
  ('Phase 1.1 - 3D Approval', '3D Submitted', '3D files are submitted to the licensor for approval.', false, '7', 'POP', 7),
  ('Phase 1.1 - 3D Approval', '3D Resubmitted', 'Revised 3D files are submitted to the licensor. This can happen more than once.', true, '8', 'POP', 8),
  ('Phase 1.1 - 3D Approval', '3D Not Approved at All', 'The licensor outright rejects the 3D submission.', false, '9', 'Licensor', 9),
  ('Phase 1.1 - 3D Approval', '3D Needs Revisions', 'Licensor requests changes to the 3D submission. This can happen more than once.', true, '10', 'Licensor', 10),
  ('Phase 1.1 - 3D Approval', '3D Approved with Revisions', '3D is approved, but minor revisions must be made before proceeding.', false, '11', 'Licensor', 11),
  ('Phase 1.1 - 3D Approval', '3D Approved', 'The licensor approves the 3D submission.', false, '12', 'Licensor', 12)
) as wanted(phase, status, explanation, duplicable, "order", access, item_order)
where not exists (
  select 1 from dflow."LicenseFeedBacks" current_row where current_row.status = wanted.status
);

insert into plm."LicenseFeedBacks"
  (phase, status, explanation, duplicable, "order", access, item_order)
select * from (values
  ('Phase 1.1 - 3D Approval', '3D Submitted', '3D files are submitted to the licensor for approval.', false, '7', 'POP', 7),
  ('Phase 1.1 - 3D Approval', '3D Resubmitted', 'Revised 3D files are submitted to the licensor. This can happen more than once.', true, '8', 'POP', 8),
  ('Phase 1.1 - 3D Approval', '3D Not Approved at All', 'The licensor outright rejects the 3D submission.', false, '9', 'Licensor', 9),
  ('Phase 1.1 - 3D Approval', '3D Needs Revisions', 'Licensor requests changes to the 3D submission. This can happen more than once.', true, '10', 'Licensor', 10),
  ('Phase 1.1 - 3D Approval', '3D Approved with Revisions', '3D is approved, but minor revisions must be made before proceeding.', false, '11', 'Licensor', 11),
  ('Phase 1.1 - 3D Approval', '3D Approved', 'The licensor approves the 3D submission.', false, '12', 'Licensor', 12)
) as wanted(phase, status, explanation, duplicable, "order", access, item_order)
where not exists (
  select 1 from plm."LicenseFeedBacks" current_row where current_row.status = wanted.status
);

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
    raise exception '3D licensing catalog assertion failed for % schema/status pair(s)', v_bad;
  end if;
end;
$$;
