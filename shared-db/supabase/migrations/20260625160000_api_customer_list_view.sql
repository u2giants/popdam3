-- Shared "front desk" for customers: api.customer_list.
--
-- Why
-- ---
-- Apps should read customers through a stable browser-facing VIEW, not by
-- selecting from the core.customer table directly. A view insulates app code from
-- table changes: when the underlying table is renamed/reshaped, we adjust the
-- view once and no app breaks, and there is no need to redeploy apps in lockstep
-- with a schema change. CRM and DAM already read through api.* views/RPCs; this
-- gives PM (poppim-web) the same insulation for the customer lookups it does in
-- src/domain/reference/api.ts, src/features/board/collab.ts, and
-- src/features/accounts/api.ts.
--
-- Read-only: PM only reads customers. A view is the right tool for reads. If an
-- app ever needs to WRITE a customer, add a SECURITY DEFINER RPC (like
-- api.crm_update_account) rather than granting table writes.
--
-- security_invoker = true so the caller's RLS on core.customer is enforced
-- (core.customer has the shared_read policy for all app roles).

create or replace view api.customer_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.customer_status,
  c.is_potential,
  c.domain,
  c.status,
  c.metadata,
  c.updated_at
from core.customer c;

comment on view api.customer_list is
  'Shared read-only customer list over core.customer. Apps read customers through this view, never the core.customer table directly, so table changes never break app code. is_potential=false means an active/PLM-confirmed customer.';

grant select on api.customer_list to authenticated;
