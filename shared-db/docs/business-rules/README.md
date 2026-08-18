# POP Creations business rules

This directory is the companywide home for business logic: how POP Creations
defines its business objects, who owns a decision, how work moves, what a status
means, how a calculation works, and which facts are authoritative.

Business rules are organized by **business topic**, never by application. A rule
does not become a DAM rule, CRM rule, PM rule, or PLM rule merely because one
application currently uses it. Applications are views into the same business.

Start with [`application-map.md`](application-map.md). It tells each application
or task which topics to read, so a session can load the relevant rules without
reading the entire company handbook.

## What belongs here

- meanings of business objects and terms;
- source and decision authority;
- relationships between business objects;
- workflows, stage gates, approvals, and permitted transitions;
- roles and business permissions;
- calculations, pricing, royalty, margin, and reporting meaning;
- business exceptions and known unknowns.

Code behavior, database structure, deployment instructions, and programming
conventions do not become business rules merely because they implement one.
Those documents must link here when their behavior depends on a rule.

## Rule status

Every topic must distinguish these four states:

| Status | Meaning |
|---|---|
| **Settled** | Confirmed by the business owner or an explicitly named business authority. This is how POP operates. |
| **Proposed** | A suggested rule awaiting business approval. It must not be implemented as settled behavior. |
| **Historical** | Previously true or previously documented, but no longer controlling. Kept only to explain existing data or behavior. |
| **Unknown** | The evidence does not answer the business question. Do not infer an answer from code or data shape. |

## How rules are collected

1. Capture the exact business question.
2. Record the answer from Albert or the named business authority, with the date.
3. Put the answer in the existing topic document. Create a new topic only when
   no existing topic fits.
4. Mark conflicting older text Historical or add a correction at the point a
   reader would encounter it. Never leave two statements both looking current.
5. Update [`application-map.md`](application-map.md) when the rule becomes
   relevant to another application, role, workflow, or task.
6. Keep evidence and implementation detail in their own documents. Link them
   from the rule when they help explain or verify it.

Data, code, and screens may reveal a question or show that a documented rule is
not being followed. They cannot establish a new business rule by themselves.

## How rules are stored

- One official statement per business topic.
- No copies in application repositories.
- A document may contain multiple related rules when a reader needs them
  together to understand the business process.
- Use plain business language first. Database names and implementation details
  belong in a clearly separated implementation-reference section.
- Keep owner decisions, effective dates, superseded statements, and unresolved
  questions visible in the topic document.
- Plans and handoffs are not permanent rulebooks. When a proposal becomes a
  settled rule, promote it here and leave the plan as history.

## How rules are disseminated

The complete `shared-db` repository is mirrored into every application repo.
Each application's `AGENTS.md` and `README.md` should link to the mirrored
[`application-map.md`](application-map.md), not reproduce business rules.

The map supports two entry paths:

- **By application:** what topics commonly affect this application.
- **By task or business object:** what to read when working on Customers,
  Licensors, Properties, merchandise groups, RFQs, samples, orders, assets, and
  other shared work.

The map is a discovery aid, not an ownership boundary. A session must follow a
rule whenever its work touches the subject, even if its application is not yet
listed in the map.

## Current topic documents

| Topic | Official document |
|---|---|
| Customers, contacts, departments, factories/vendors, and ingested domains | [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md) |
| Licensing Master Data authority and relationships | [`licensing-master-data.md`](licensing-master-data.md) |
| Merchandise groups and product taxonomy | [`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md) |
| Products, Items, SKUs, style numbers, and identifiers | [`product-items-and-identifiers.md`](product-items-and-identifiers.md) |
| ERP field, order, and source meaning | [`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) |
| RFQ pricing, margin, and royalty | [`rfq-pricing.md`](rfq-pricing.md) |
| Product-development workflow | [`product-development-workflow.md`](product-development-workflow.md) |
| Samples, inventory, shipping, and custody | [`samples-inventory-and-shipping.md`](samples-inventory-and-shipping.md) |
| Production milestones and needed dates | [`production-milestones-and-dates.md`](production-milestones-and-dates.md) |
| Tariff and HTS classification | [`tariff-and-hts-classification.md`](tariff-and-hts-classification.md) |
| Digital assets and source-file integrity | [`digital-assets-and-file-integrity.md`](digital-assets-and-file-integrity.md) |
| Digital-asset classification, tags, and source evidence | [`digital-asset-classification-and-tags.md`](digital-asset-classification-and-tags.md) |
| Master Data access | [`master-data-access.md`](master-data-access.md) |

The dated audit inventory is evidence of the migration, not a business-rule topic:
[`audit-inventory-2026-08-18.md`](audit-inventory-2026-08-18.md).

## Maintenance rule

When a business rule changes, the same documentation change must:

1. update its official topic;
2. correct or mark Historical every known conflicting current document;
3. update the application map if relevance changed; and
4. leave application repositories with links, not copied replacement prose.

Broken links and two current statements that disagree are documentation defects.
Fix them in the same workstream that discovers them.
