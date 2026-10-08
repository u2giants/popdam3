-- Issue #2662 bounded six-view subset; claim #3294, version 20261008211322.
-- derived-from: none
-- Remove only authenticated SELECT. No definitions, ownership, other grants,
-- policies, or service-role capabilities change. Broader issue findings stay open.
-- Historical 2026-09-20 source search found no application callers; production 24h
-- edge logs had zero mentions for these six (845279 entries; positive controls).
-- Authenticated access is deliberately denied even for application administrators.

REVOKE SELECT ON TABLE api.crm_factory_picker_list FROM authenticated;
REVOKE SELECT ON TABLE api.opa_disney_property FROM authenticated;
REVOKE SELECT ON TABLE api.opa_lucasfilm_property FROM authenticated;
REVOKE SELECT ON TABLE api.opa_marvel_property FROM authenticated;
REVOKE SELECT ON TABLE api.pm_factory_list FROM authenticated;
REVOKE SELECT ON TABLE api.source_capture_inventory FROM authenticated;
