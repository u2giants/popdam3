---
summary: "Google Sheets Master Data import is transitional; curated database edits outrank it and must not be overwritten."
kind: decision
status: current
read-when: importing or updating curated Master Data tables from Google Sheets
---

# Master Data import is transitional and curated data outranks it (§6.4)

**Decided by:** Albert Hazan, 2026-08-03

## Decision

Google Sheets Master Data import is temporary until employees work directly in Master Data; curated improvements in Supabase must never be overwritten by sheet imports.

> "importing Master Data info from Google Sheets is a temporary thing until all the employees are ready to do all work in our Master Data and then Google Sheets version gets deprecated and never touched again. so any improvements we've made should no longer be overwritten by..."

## Why

Employees are migrating off spreadsheets into the shared database; letting legacy imports clobber curated fixes destroys manual curation.

## Rejected

Allowing Google Sheets imports to overwrite curated Master Data fields.

## Source

Original record (left in place): [`docs/owner-rulings-part-1.md` §6.4](../owner-rulings-part-1.md#64-owner-ruling--the-master-data-import-is-transitional-and-curated-data-outranks-it-albert-hazan-2026-08-03)
