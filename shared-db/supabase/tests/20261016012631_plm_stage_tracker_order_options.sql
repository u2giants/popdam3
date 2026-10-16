begin;
-- shared-db#4373 (claim #4402): Stage Catalog tracker order, done signals and per-order options. Rolled back.
do $$
begin
  assert to_regclass('plm.prod_stage_option') is not null, 'order options table missing';
  assert (select relrowsecurity from pg_class where oid='plm.prod_stage_option'::regclass), 'RLS must be enabled';
  assert not has_table_privilege('anon','plm.prod_stage_option','SELECT'), 'anon must not read order choices';
  assert not has_table_privilege('authenticated','plm.prod_stage_option','UPDATE'), 'browser must not write order choices';
  assert has_table_privilege('service_role','plm.prod_stage_option','UPDATE'), 'service must retain write capability';
end $$;
do $$
begin
 assert (select count(*)=12 from plm.stage where tracker_position is not null), 'seed tracker slots';
 assert coalesce((select tracker_position=4 from plm.stage where done_signal='pps_done'),false), 'PPS remains interleaved';
 assert (select count(*)=2 from plm.stage where done_signal in ('concept_submitted','concept_resubmitted')), 'licensing event bindings';
end $$;
rollback;
