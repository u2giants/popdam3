-- Issue #6735. Restore the existing admin role editor's create.
-- derived-from: none
-- RoleService.createRole inserts these four columns; "Id" is an identity column.
-- Keep UPDATE, DELETE, "Id" and app_role_id access unchanged.
-- Recovery: a new reviewed migration revoking this exact column INSERT grant.
GRANT INSERT ("Name", kind, parent_id, is_active) ON TABLE dflow_prod."Roles" TO designflow_prod_backend_grants;
