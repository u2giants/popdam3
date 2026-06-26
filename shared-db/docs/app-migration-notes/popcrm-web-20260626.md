# POP CRM contact relationship clear RPC — 2026-06-26

## Explicit clear flags for contact relationships

What changed:
`20260626171000_crm_update_contact_clear_relationship_fields.sql` replaces
`api.crm_update_contact` with a superset signature that accepts
`p_clear_company`, `p_clear_crm_department`, `p_clear_contact_type`, and
`p_clear_scope`.

Why:
POP CRM edits canonical `core.contact` rows and CRM relationship attributes on
`core.contact_company` through the same RPC. The previous `coalesce()` contract
made `null` mean "leave unchanged", so the frontend could not intentionally
clear account, department, contact type, or scope values.

Future sessions should:
Keep app changes that edit relationship-owned contact fields on this RPC
contract. When a frontend needs to clear a relationship value, send the matching
`p_clear_*` flag; do not rely on `null` alone. Because `company_id` is required
on `core.contact_company`, clearing a contact's CRM account deletes the CRM
`buyer` relationship row instead of setting `company_id` null.

Affected apps:
POP CRM. PM/PIM, DAM, and PLM share the same `core.contact` and
`core.contact_company` tables, so they should not assume this RPC belongs to
their flows unless they also use the CRM app-access contract.
