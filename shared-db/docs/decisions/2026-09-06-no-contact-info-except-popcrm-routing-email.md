---
summary: "Do not import or store contact information anywhere in the database except PopCRM email routing addresses."
kind: decision
status: current
read-when: adding vendor, customer, or licensor contact fields (email, phone, address)
---

# No contact information except PopCRM routing email (§6.19)

**Decided by:** Albert Hazan, 2026-09-06

## Decision

Do not import contact information (addresses, phone numbers, personal emails) into any part of this system, except email addresses in PopCRM used to route emails.

> "we shouldn't be importing any contact information into any part of this system except email addresses in popcrm to determine routing for emails." — Albert Hazan, 2026-09-06

## Why

Minimizes PII exposure and aligns with the declined `/vendors` contact fields decision.

## Rejected

Ingesting vendor or customer phone numbers, street addresses, or general contact directories.

## Source

Original record (left in place): [`docs/owner-rulings-part-3.md` §6.19](../owner-rulings-part-3.md#619-owner-ruling--contact-information-does-not-belong-in-this-system-at-all-except-popcrm-routing-email-albert-hazan-2026-09-06)
