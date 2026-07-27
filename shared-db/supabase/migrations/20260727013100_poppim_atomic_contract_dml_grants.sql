-- RLS policies already restrict PM writes to administrators, licensing,
-- designers, and sales. PostgreSQL table privileges are an independent gate:
-- grant only the DML required by the new security-invoker atomic RPCs.

grant update on pim.product to authenticated;
grant insert on pim.stage_history to authenticated;
grant insert, update on pim.view_pref to authenticated;

comment on function api.pm_set_product_stage(uuid, uuid) is
  'Atomically validates a department-specific stage UUID, updates the product stage, and records stage history. Security-invoker table grants remain constrained by pim.pm_write RLS.';
comment on function api.pm_patch_product_metadata(uuid, jsonb, timestamptz) is
  'Atomically merges PM product metadata and optionally rejects stale updated_at versions with PM_METADATA_CONFLICT. Security-invoker table grants remain constrained by pim.pm_write RLS.';
comment on function api.pm_upsert_view_pref(text, jsonb) is
  'Atomically merges the current profile saved-view preference using the existing unique (profile_id, scope) constraint. Security-invoker table grants remain constrained by pim.pm_write RLS.';
