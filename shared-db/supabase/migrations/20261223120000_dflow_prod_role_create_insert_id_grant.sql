-- Issue #6735. Finish restoring the admin role editor's create.
-- derived-from: none
-- The backend ORM lists "Id" with the DEFAULT keyword in its INSERT, which needs column INSERT on "Id".
-- "Id" is an identity column; app_role_id, UPDATE on "Id", and DELETE stay unchanged.
-- Recovery: a new reviewed migration revoking this exact column INSERT grant.
GRANT INSERT ("Id") ON TABLE dflow_prod."Roles" TO designflow_prod_backend_grants;
