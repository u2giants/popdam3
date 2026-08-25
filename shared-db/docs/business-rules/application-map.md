# Business-rules application and task map

Use this map to find the business topics relevant to the work. It deliberately
does not divide ownership by application. The same rule applies wherever the
same business object or process appears.

## Map by application

| Application or service | Start with these topics |
|---|---|
| PopDAM / Master Data / PopSG | Customers/organizations; Licensing Master Data; merchandise/product taxonomy; product/item identity; ERP and OrderList meaning; digital-asset integrity; digital-asset classification/tags; product workflow when linking assets to products, samples, or orders |
| PopCRM | Customers, contacts, and organization identity; Licensing Master Data when opportunities or approvals reference Licensors or Properties; product-development workflow when CRM opportunities create or follow product work |
| PopPIM / PM | Customers/organizations; Licensing Master Data; merchandise/product taxonomy; product/item identity; product-development workflow; samples/custody; RFQ pricing when acting on pricing decisions; digital assets when linking source artwork |
| DesignFlow frontend | All topics, selected by feature: Item Library uses product identity, taxonomy, and licensing; RFQ uses RFQ pricing; Sample and Production Tracking use product workflow, samples/custody, and ERP meaning; asset/style-guide work uses licensing and digital assets |
| DesignFlow backend | The same topic as the route or service it supports. Backend status or permission logic never creates a separate business rule |
| DesignFlow Item Master | Customers and organization identity; Licensing Master Data; Merchandise groups and product taxonomy; Products, Items, SKUs, and identifiers; RFQ pricing for Item Master endpoints that supply pricing inputs; product-development workflow for item lifecycle behavior |
| DesignFlow BFF, Tracking, and Data Syncing | Select by the business object being transported or synchronized. A sync source does not become the owner of the business rule |
| DB Data Admin | Customers and organization identity; Licensing Master Data; Merchandise groups and product taxonomy; ERP meaning when reviewing source-fed data |

## Map by task or business object

| If the work touches... | Read |
|---|---|
| Customer, potential customer, active customer, contact, department, factory/vendor, Licensor as organization, or ingested email domain | [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md) |
| Which emails are captured into the system, whose mailboxes are ingested, or how email links to a program | [`email-capture-and-program-linkage.md`](email-capture-and-program-linkage.md) |
| Licensor, Property, Character, Style Guide, Franchise, licensed Asset, source authority, or Active/Inactive licensing status | [`licensing-master-data.md`](licensing-master-data.md) |
| MG01-MG14, `mgCategory`, Product Type, subtype, size, Age Group, merchandise-group code, division meaning, which product categories we produce, or which categories a division (POP / Spruce Licensed / Spruce Generic) sells | [`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md) |
| Product, Item, SKU, style number, source identifier, reusable design, or controlled item description | [`product-items-and-identifiers.md`](product-items-and-identifiers.md) |
| ColdLion order history, production history, `COS`, contractual samples, DAVID samples, or ERP code meaning | [`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) |
| RFQ cost, sell price, buyer target, buyer margin, royalty, dilution, logistics, or Incoterm | [`rfq-pricing.md`](rfq-pricing.md) |
| Marvel talent likeness or the additional likeness royalty | [`licensing-master-data.md`](licensing-master-data.md) and [`rfq-pricing.md`](rfq-pricing.md) |
| CRM Opportunity, sales pursuit, or follow-up that creates product work | [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md) and [`product-development-workflow.md`](product-development-workflow.md) |
| Who may edit the Master Data / Styles grid | [`master-data-access.md`](master-data-access.md) |
| Project, offer, SKU, design, submission, sample, revision, approval, purchase order, production stage, or next-action ownership | [`product-development-workflow.md`](product-development-workflow.md) |
| Physical sample, inventory, Box, Shipment, custody, Factory visit, remote inventory, QC confirmation, carrier, or tracking number | [`samples-inventory-and-shipping.md`](samples-inventory-and-shipping.md) |
| Production milestone, needed date, Ship Date, Due Date, licensing schedule, Purchase-Order date, or per-SKU production date | [`production-milestones-and-dates.md`](production-milestones-and-dates.md) |
| HTS code, tariff classification, customs ruling, duty component, Section 301, reciprocal tariff, or classification confidence | [`tariff-and-hts-classification.md`](tariff-and-hts-classification.md) |
| Asset, source file, original modified date, file movement, PopSG source, or file-derived business metadata | [`digital-assets-and-file-integrity.md`](digital-assets-and-file-integrity.md) |
| Asset tags, classification, aliases, tag provenance, folder/filename evidence, manual rejection, or AI tagging | [`digital-asset-classification-and-tags.md`](digital-asset-classification-and-tags.md) |

## Reading rule

Read only the topics the task touches, then follow their links to evidence or
implementation documentation as needed. Do not ingest every topic by default.
When a task crosses topics, read every applicable topic. The application column
is a starting point, not a limit.
