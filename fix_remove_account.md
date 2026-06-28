# Remove Legacy CRM Account Naming — DAM/PopSG Audit

Date: 2026-06-28

## Plain-English Summary

This DAM/PopSG app shares the Supabase database with CRM and PM, but it should
not use CRM's legacy account-named customer contracts.

Deprecated CRM names:

- `api.crm_account_list`
- `api.crm_account_overview`
- `api.crm_update_account`

New CRM names:

- `api.crm_customer_list`
- `api.crm_customer_overview`
- `api.crm_update_customer`

DAM should normally use DAM-owned contracts for assets/style groups and
`api.customer_list` only when it needs a plain shared customer picker. DAM should
not use CRM-specific `crm_customer_*` unless a screen intentionally needs CRM
workflow fields such as CRM customer status, routing aliases, or sales ownership.

## Current DAM/PopSG Status

An audit of active code found no direct calls to the legacy CRM account
contracts.

Run this check before final shared-db compatibility removal:

```bash
rg "crm_account|crm_update_account|accountSegment|AccountSegment" src apps supabase
```

Expected result: no active callers.

## What Future AI Sessions Should Do

After `/worksp/shared-db` PR `https://github.com/u2giants/shared-db/pull/19` is
applied to the target schema:

1. Regenerate Supabase types in this repo from the target project if this repo's
   generated types include `api` schema contracts.
2. Run the audit grep above.
3. If DAM needs customer picker data, use `api.customer_list`.
4. If DAM needs a richer customer/logo/style-tracker contract, add a DAM-owned
   view/RPC in canonical `/worksp/shared-db`; do not reuse old
   `api.crm_account_*` names.

## Do Not Do This

- Do not edit `/worksp/popdam3/shared-db`; it is a mirror.
- Do not remove `company_id` columns or `core.company_source_ref`; those names
  intentionally remain to limit backend churn.
- Do not drop legacy CRM account compatibility objects from shared-db until CRM,
  PM/PIM, DAM/PopSG, and any workers have clean scans.
