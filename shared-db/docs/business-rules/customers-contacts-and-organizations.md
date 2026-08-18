# Customers, contacts, and organizations

**Status:** Proposed

## Business identities

POP does not use one generic Company category. The kind of relationship matters:

- A **Customer** is an organization POP may sell to or has sold to.
- A **Potential Customer** is deliberately being tracked but has not yet done business with POP.
- An **Active Customer** has done business with POP, confirmed by ERP or PLM evidence.
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

## Source authority

- ERP/PLM evidence is authoritative for whether a Customer is active.
- CRM and PM may create or curate Potential Customers.
- Email ingestion is authoritative only for the fact that a message/domain was observed.
- Factories/Vendors and Licensors retain their own identities and must not be inserted into Customer lists as a shortcut.

`core.factory` is specifically for merchandise vendors that make products. Freight providers, government bodies, banks, couriers, real-estate firms, and other service providers are not Factories merely because an ERP endpoint once returned them together.

The rule that ingested email domains never promote into Customer Master Data is Settled. The broader organization and contact model above is a consolidated proposal until Albert confirms it as the companywide model.

## Implementation and evidence

Detailed identity architecture and migration evidence remain in [`../shared-database-vision.md`](../shared-database-vision.md). Application files may explain their own screens and data contracts but do not own a different definition of Customer, Contact, Factory, Licensor, Department, or ingested domain.
