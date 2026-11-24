-- #4707: DesignFlow runtimes read live dflow_prod licensing rows for the plm
-- Asserted on the NOLOGIN grant roles: the CI replay cannot rebuild every
-- runtime membership (20261008022846 does not replay from empty).
-- comparison, by column, never writing; the stale plm camelCase copies stay closed.
do $test$
declare
  r text;
  tbl text;
begin
  if to_regnamespace('dflow_prod') is null
     or to_regrole('designflow_prod_tracking_grants') is null then
    return;
  end if;
  declare
    c record;
  begin
    for c in select * from (values
      ('designflow_prod_tracking_grants', 'dflow_prod."licensingMilestone"', 'milestone_date', true),
      ('designflow_prod_tracking_grants', 'dflow_prod."licensingFeedbackReply"', 'tagged_user_ids', true),
      ('designflow_prod_tracking_grants', 'dflow_prod."licensingFeedbackReply"', 'comment', false),
      ('designflow_prod_item_master_grants', 'dflow_prod."licensingMilestone"', 'itemheader_id_fk', true),
      ('designflow_prod_backend_grants', 'dflow_prod."licensingStatus"', 'assignee_ids', true),
      ('designflow_prod_backend_grants', 'dflow_prod."licensingFeedbackReply"', 'comment', true),
      ('designflow_prod_backend_grants', 'dflow_prod."licensingMilestone"', 'updated_at', true)) v(role, tbl, col, want)
    loop
      if to_regrole(c.role) is null or to_regclass(c.tbl) is null then
        raise exception 'missing % or %', c.role, c.tbl;
      end if;
      if has_column_privilege(c.role, c.tbl, c.col, 'SELECT') is distinct from c.want then
        raise exception '% SELECT %.% expected %', c.role, c.tbl, c.col, c.want;
      end if;
    end loop;
  end;
  foreach r in array array['designflow_prod_tracking_runtime', 'designflow_prod_item_master_runtime',
    'designflow_prod_backend_runtime'] loop
    foreach tbl in array array['plm."licensingStatus"', 'plm."licensingMilestone"', 'plm."licensingFeedbackReply"'] loop
      if to_regclass(tbl) is not null and has_any_column_privilege(r, tbl, 'SELECT, INSERT, UPDATE') then
        raise exception '% reaches the stale snapshot %', r, tbl;
      end if;
    end loop;
  end loop;
  if has_any_column_privilege('designflow_prod_backend_grants', 'dflow_prod."licensingMilestone"', 'INSERT, UPDATE')
     or has_table_privilege('designflow_prod_backend_grants', 'dflow_prod."licensingMilestone"', 'DELETE')
     or has_any_column_privilege('designflow_prod_tracking_grants', 'dflow_prod."licensingMilestone"', 'INSERT, UPDATE')
     or has_table_privilege('designflow_prod_tracking_grants', 'dflow_prod."licensingMilestone"', 'DELETE') then
    raise exception 'legacy milestone read gained a write';
  end if;
end
$test$;
