-- Issue #3154: index the factory-time foreign key on the milestone schedule.
-- derived-from: none
--
-- Follow-up to #3091. plm.prod_order_milestone_schedule.factory_time_id references
-- plm."FactoryTime"(id) with no supporting index. Additive only; no data, grant or
-- RLS change.

CREATE INDEX IF NOT EXISTS prod_order_milestone_schedule_factory_time_id_idx
  ON plm.prod_order_milestone_schedule (factory_time_id);
