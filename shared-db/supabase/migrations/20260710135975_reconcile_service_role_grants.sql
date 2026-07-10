-- Preview recorded the original grant migration but lacked the actual schema
-- privileges. Reassert the documented server-side access idempotently.

grant usage on schema app, core, crm, pim, plm, ingest, api to service_role;

grant all on all tables in schema app, core, crm, pim, plm, ingest, api to service_role;
grant all on all sequences in schema app, core, crm, pim, plm, ingest, api to service_role;
grant execute on all functions in schema app, core, crm, pim, plm, ingest, api to service_role;

alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema core grant all on tables to service_role;
alter default privileges in schema crm grant all on tables to service_role;
alter default privileges in schema pim grant all on tables to service_role;
alter default privileges in schema plm grant all on tables to service_role;
alter default privileges in schema ingest grant all on tables to service_role;
alter default privileges in schema api grant all on tables to service_role;
