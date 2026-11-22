---
summary: "Licence contracts are not a database source; licence term and territory do not belong in the database at all."
kind: decision
status: current
read-when: modeling licence metadata, contracts, terms, or territories
---

# No licence contracts, term, or territory in the database (§6.16)

**Decided by:** Albert Hazan, 2026-08-19

## Decision

Do not use licence contracts as a source for this database, and do not store licence term or territory columns/tables.

> "you're not supposed to be referring to or using the contracts. the data scrapes + coldlion api feed are canonical. this is the 400th time i am saying this. why are we still talking about contracts over and over and over again?"

## Why

The licensor portal scrapes and ColdLion API feed are the canonical operational sources; contract PDFs are out of scope.

## Rejected

Parsing licence contracts or adding term/territory fields to Master Data tables.

## Source

Original record (left in place): [`docs/owner-rulings-part-3.md` §6.16](../owner-rulings-part-3.md#616-owner-ruling--licence-contracts-are-not-a-source-for-this-database-and-licence-term-and-territory-do-not-belong-in-it-at-all-albert-hazan-2026-08-19)
