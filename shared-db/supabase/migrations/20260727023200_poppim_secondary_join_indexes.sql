-- Preview evidence for pm_department_report showed 606k shared-buffer hits.
-- These indexes support its department-attribution joins and the secondary
-- screen grouped-count contracts without changing data or permissions.

create index if not exists pim_product_project_id_idx
  on pim.product (project_id) where project_id is not null;

create index if not exists pim_product_design_id_idx
  on pim.product (design_id) where design_id is not null;

create index if not exists pim_customer_order_product_id_idx
  on pim.customer_order (product_id) where product_id is not null;

create index if not exists pim_customer_order_project_id_idx
  on pim.customer_order (project_id) where project_id is not null;

create index if not exists app_activity_pm_target_idx
  on app.activity (target_schema, target_table, target_id, action)
  where action in ('pm_dependency', 'pm_decision');

create index if not exists app_notification_pm_target_idx
  on app.notification (target_schema, target_table, target_id)
  where app = 'pm';

create index if not exists pim_stage_history_product_changed_idx
  on pim.stage_history (product_id, changed_at desc, id desc);
