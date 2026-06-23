-- Imported from production migration history so Supabase CLI can compare
-- local files with the already-applied shared database migration ledger.
-- Version: 20260621164759
-- Name: service_role_grants


-- Grant service_role full access to all shared-db schemas for server-side data ops.
grant usage on schema app, core, crm, pim, plm, ingest, api to service_role;
grant all on all tables in schema app to service_role;
grant all on all tables in schema core to service_role;
grant all on all tables in schema crm to service_role;
grant all on all tables in schema pim to service_role;
grant all on all tables in schema plm to service_role;
grant all on all tables in schema ingest to service_role;
grant all on all tables in schema api to service_role;
grant all on all sequences in schema app to service_role;
grant all on all sequences in schema core to service_role;
grant all on all sequences in schema crm to service_role;
alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema core grant all on tables to service_role;
alter default privileges in schema crm grant all on tables to service_role;

