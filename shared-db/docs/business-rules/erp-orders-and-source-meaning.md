# ERP, orders, and source meaning

**Status:** Settled

## General rule

An ERP field name does not establish its business meaning. Every imported field must retain its source, time scope, and interpretation. Applications must not give the same source value different meanings.

## Orders and items

Google OrderList rows and future ColdLion rows describe the same real orders. They are not competing order systems. One canonical order and line must retain separate source references for each system. The ultimate item list belongs to the canonical PLM item identity.

## The customer master is not a customer list

ColdLion's customer table includes ship-to-only records (a Licensor POP ships to
must be a customer there to get a pick ticket), customers dating to 2006 that are
now defunct, and active customers too small to warrant CRM attention. It must
never be read as POP's list of customers, and it never sets a CRM
classification. See [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md).

## Historical classification

ERP merchandise data before the approved cutoff may use codes whose historical meaning differs from current codes. Historical items must follow the approved description-based remediation process rather than being forced through the current mapping.

## Samples and production indicators

A Production PO number ending `COS` means extra pieces of a customer's item are being made for the Licensor as contractual samples and/or for POP's internal purposes as DAVID samples.

- These pieces are a real POP cost with no customer revenue and must be classifiable separately.
- `salesOrderNo = 0` on a `COS` line is correct. It is not a missing link.
- The Customer on the line is the Customer from the original order, not the sample recipient.
- `COS` does not distinguish contractual samples from DAVID samples. That split is Unknown unless another source supplies it.
- Older data also contains other sample markers, so `COS` must not be treated as the only possible indicator.

The production-history feed covers four divisions: `CW001`, `EH001`, `EP001`, and `SP001`. A short time window may show fewer divisions and must not be generalized.

`1900-01-01` is the ERP's empty-date marker. It is not a real business date. Outside `COS`, `salesOrderNo = 0` means there is no linked sales order.

A source value that is absent or ambiguous must remain Unknown rather than being silently converted to zero, false, or not applicable.

## Implementation and evidence

The field-by-field source evidence and formula findings remain in [`../business-rules-erp-data.md`](../business-rules-erp-data.md), [`../app-migration-notes/popdam-order-list.md`](../app-migration-notes/popdam-order-list.md), and the linked formula audit. This page is the companywide entry point.
