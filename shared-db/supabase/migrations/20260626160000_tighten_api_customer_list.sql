-- Tighten the shared plain customer-list contract.
--
-- api.customer_list is for picker/basic customer reads across PM/CRM/DAM. It
-- deliberately exposes only stable, picker-safe columns. App-specific account
-- screens that need CRM/PM metadata should use their own api.* views/RPCs.
--
-- Dropping/recreating is intentional: PostgreSQL cannot remove a column from an
-- existing view with CREATE OR REPLACE VIEW, and this migration removes the old
-- raw metadata column from the shared contract.

drop view if exists api.customer_list;

create or replace view api.customer_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.customer_status,
  c.is_potential,
  c.domain,
  c.status,
  c.updated_at
from core.customer c;

comment on view api.customer_list is
  'Shared plain customer list for picker/basic reads. Exposes only stable, picker-safe columns. Includes listable active and potential customers; is_potential is not a visibility filter. App-specific account views/RPCs should expose specialized fields.';

grant select on api.customer_list to authenticated;
