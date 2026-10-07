# Remove Legacy CRM Account Naming — DAM/PopSG Audit

Date: 2026-06-29

## Plain-English Summary

This DAM/PopSG checkout shares the Supabase database with CRM and PM, but it
should not use CRM's legacy account-named customer contracts.

Deprecated CRM names:

- `api.crm_account_list`
- `api.crm_account_overview`
- `api.crm_update_account`

Customer-named CRM replacements:

- `api.crm_customer_list`
- `api.crm_customer_overview`
- `api.crm_update_customer`

PopDAM should normally use DAM-owned asset/style/customer-linking contracts.
Do not use `api.customer_list`; it was removed because it exposed polluted broad
customer data. DAM/Master Data customer pickers must use PLM-filtered or
DAM-owned contracts. Add a DAM-owned view/RPC in canonical `/worksp/shared-db`
if DAM needs richer customer data.

## Current Status

An audit of active code in this checkout found no direct calls to the legacy CRM
account contracts.

Run this before final shared-db compatibility removal:

```bash
rg "crm_account|crm_update_account|accountSegment|AccountSegment" src apps supabase
```

Expected result: no active callers.

## Future AI Instructions

1. Do not edit `/worksp/popdam/shared-db`; it is a mirror. Update canonical
   `/worksp/shared-db`, then sync the mirror.
2. If generated types still show `crm_account_*`, verify whether they were
   generated from a schema where the deprecated compatibility objects still
   exist. That alone is not an active caller.
3. Do not drop/revoke legacy CRM account compatibility objects from shared-db
   until CRM, PM/PIM, DAM/PopSG, and any workers have clean scans.
4. Never reintroduce `api.customer_list` as a DAM/Master Data picker.
