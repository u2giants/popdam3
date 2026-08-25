# Customers, contacts, and organizations

**Status:** Proposed

## Business identities

POP does not use one generic Company category. The kind of relationship matters:

- A **Customer** is an organization POP may sell to or has sold to.
- A **Potential Customer** is deliberately being tracked but has not yet done business with POP.
- An **Active Customer** is a Customer the CRM records as currently worth selling to and working. ERP invoicing history supports that judgement but does not make it; see "What the ColdLion customer list is and is not" below.
- A **Factory/Vendor** supplies products or services and is not a Customer merely because it is a company.
- A **Licensor** owns or controls licensed intellectual property and is not a Customer merely because it is a company.
- An **ingested email domain** is evidence that an email was received. It is not a business relationship.
- A **Contact** is a person. The person's relationship to a Customer, Factory, Licensor, or department must be recorded separately from the person's identity.
- A **Department** exists only as part of an organization. It is not an independent company.

## Customer lifecycle

A Potential Customer and the Active Customer it later becomes are the same business identity. Activation adds authoritative ERP/PLM evidence to the existing Customer; it must not create a duplicate Customer and repoint every relationship.

An ingested email domain has no promotion path into Customer Master Data. Email workers and triage screens must never create, link, source-reference, or silently promote a Customer from domain noise.

Customer status has two separate meanings that must not be conflated:

- **Business relationship:** potential or active, based on whether POP has done business with the Customer.
- **CRM workflow:** the sales team's current classification or follow-up state.

Changing a CRM workflow label does not establish that POP has done business with the Customer.

## Contacts and departments

A Contact may participate in more than one organizational relationship. Department, role/type, and scope describe a particular Contact-to-organization relationship, not the person globally.

Customer-facing contact views include Contacts linked to Active or Potential Customers. A Contact linked only to a reviewed non-customer or to no Customer belongs in triage, not in customer-contact counts.

Changing a Contact's Customer must clear or reselect any Department that does not belong to the newly selected Customer.

## What the ColdLion customer list is and is not

**Status:** Settled (Albert Hazan, 2026-08-25)

ColdLion's customer table is an **accounting and shipping master, not a list of
POP's customers**. Three kinds of records in it are not CRM customers:

1. **Ship-to records.** Anything POP ships from its warehouse — including to a
   Licensor — must exist in ColdLion as a customer before a pick ticket can be
   issued. Those records exist to move a carton, not because the party buys
   from POP.
2. **Defunct history.** The list reaches back to the company's founding in 2006.
   Roughly 99% of those customers are dead today: out of business, or buyers of
   a line POP has discontinued (for example books).
3. **Too small to matter.** Some customers are current and genuinely active in
   ColdLion yet too small to be worth CRM attention.

Therefore presence in ColdLion is **not** evidence that a company belongs in the
CRM, is a customer, or is active. Absence from ColdLion is not evidence that a
company is not a customer.

## Linking CRM customers to ColdLion

**Status:** Settled (Albert Hazan, 2026-08-25)

The link runs **one way: from the CRM outward**. When a company appears in the
CRM, link it to its corresponding ColdLion customer record. Never walk the
ColdLion list and pull its entries into the CRM.

The two systems legitimately disagree, and neither disagreement is an error to
be repaired:

- A CRM **Active Customer may have no ColdLion record** — POP has the order but
  has not invoiced it yet.
- A CRM **Potential Customer may have a ColdLion record** — POP sold them in the
  past and no longer does business with them (for example At Home). Past
  invoices do not make a company currently active.

A ColdLion match therefore enriches a CRM customer (ERP identity, history,
shipping and billing detail). It never sets, promotes, or demotes the CRM
classification, and a missing match never blocks or downgrades one. A single CRM
customer may match more than one ColdLion customer code.

## Source authority

- The CRM's own customer classification is authoritative for whether a company
  is a customer of interest and whether it is active or potential. That
  judgement is made by people, not derived from another system.
- ERP/PLM evidence is authoritative for invoicing and order history, and
  supports but does not decide CRM classification.
- CRM and PM may create or curate Potential Customers.
- Email ingestion is authoritative only for the fact that a message/domain was observed.
- Factories/Vendors and Licensors retain their own identities and must not be inserted into Customer lists as a shortcut.

`core.factory` is specifically for merchandise vendors that make products. Freight providers, government bodies, banks, couriers, real-estate firms, and other service providers are not Factories merely because an ERP endpoint once returned them together.

The rule that ingested email domains never promote into Customer Master Data is Settled. The ColdLion sections above ("What the ColdLion customer list is and is not", "Linking CRM customers to ColdLion") are Settled by Albert Hazan on 2026-08-25. The broader organization and contact model above is a consolidated proposal until Albert confirms it as the companywide model.

## Implementation and evidence

Detailed identity architecture and migration evidence remain in [`../shared-database-vision.md`](../shared-database-vision.md). Application files may explain their own screens and data contracts but do not own a different definition of Customer, Contact, Factory, Licensor, Department, or ingested domain.
