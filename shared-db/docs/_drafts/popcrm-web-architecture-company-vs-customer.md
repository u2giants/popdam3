<!--
DRAFT to insert into popcrm-web `docs/architecture.md`, immediately after the
"## Data loading" section (before "## Key modules"). popcrm-web is an app repo,
so this commits straight to main once approved. Do NOT edit popcrm-web's
vendored `shared-db/` folder — that is auto-synced from u2giants/shared-db.
-->

## Data model: customer vs. company vs. ingested domain

The CRM works with three different things that are easy to conflate. They are
**not** the same and they do not live in the same place. ("Company" is not a
useful bucket — a factory and a licensor are also companies, and neither is a
customer; those live in `core.factory` / `core.licensor`.)

| Concept | What it is | Storage | Visible to other apps? |
|---|---|---|---|
| **Ingested domain** | A domain that merely appeared in an ingested email. We get email from ~1000 kinds of companies (recruiters, vendors, spam, partners) — the triage **inbox**, not a relationship. | `crm.ingested_domain` (CRM-private) | No. Only the CRM sees it. |
| **Potential customer** | A company we have **not yet done business with** but are tracking. | `core.customer`, `is_potential = true` | Yes — a normal `core.customer` row. |
| **Active customer** | A company we **have actually done business with**. Authoritative source is PLM/ERP (ColdLion) only. | `core.customer`, `is_potential = false` (+ a `designflow_plm`/`coldlion` source ref) | Yes (shared by CRM/PM/PLM/DAM). |

Why this matters for the frontend:

- `core.customer` is the **shared hub** that PM, PLM, and DAM also join to. Email
  noise must never land there. The Fireflies/email worker records noise via
  `crm.record_ingested_domain(...)`, never by inserting into `core.customer`.
- **Garbage never enters the customer table.** The **Accounts → Triage** tab is
  the review queue, fed from `api.crm_ingested_domain_list` (i.e.
  `crm.ingested_domain`), *not* from the customer list. A domain never becomes a
  `core.customer` row, never source-refs a customer, and never FKs to a customer.
  Curated customers come from customer-specific contracts such as
  `api.crm_customer_list`.
- **Active vs. potential is owned by PLM/ERP, not the CRM.** Only ColdLion makes a
  customer active (`is_potential = false`); CRM/PM-created customer rows are
  potential until confirmed by PLM/ERP. Use `is_potential` for the factual "have we done business with
  them," and treat `customer_status` (`ACTIVE_CUSTOMER` / `POTENTIAL_CUSTOMER` /
  `OTHER` / `UNASSIGNED`) as the CRM's *subjective* triage opinion on a separate
  axis.

Lifecycle:

```txt
crm.ingested_domain  ── no customer association
core.customer (potential, from customer workflow) ──ColdLion import──▶ core.customer (active, same row)
```

A potential customer and the active customer it becomes are the **same**
`core.customer` row, so opportunities/contacts/programs attached in the CRM never
need to be moved when the customer graduates into ColdLion. The canonical
rationale and cross-app rules live in `shared-db/docs/shared-database-vision.md`
→ "Customer vs. Company vs. Ingested Domain".

> Migration note: the shared hub was **hard-renamed** `core.company` →
> `core.customer` (no compatibility view). The CRM frontend is unaffected at
> runtime because it reads through `api.*` views and RPCs (unchanged names), not
> `core.company` directly. After the migration lands, regenerate
> `src/lib/database.types.ts`; fix any compile-time references to the old
> `core.company` type, and use `is_potential` from `api.crm_account_list` to tell
> potential from active customers.
