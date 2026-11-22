---
summary: "shared-db governs database structure (schema, migrations, RLS, functions); ordinary application data belongs to app sessions."
kind: decision
status: current
read-when: deciding whether a task belongs in popcre/shared-db or an application repo
---

# shared-db governs structure, not application data (§0.0-B)

**Decided by:** Albert Hazan, 2026-08-13

## Decision

`popcre/shared-db` governs database shape (schemas, tables, columns, views, functions, triggers, RLS, indexes, migrations). Ordinary application row changes belong to the owning application session; only curated Master Data bulk loads remain gated here.

Recorded in AGENTS.md §0.0-B (2026-08-13): STRUCTURE, not DATA; curated Master Data stays gated.

## Why

Routing routine application data edits through the structural lane creates unnecessary contention and delays.

## Rejected

Opening structural `shared-db` issues or migrations for ordinary application row updates.

## Source

Original record (left in place): [`docs/agents/owner-rulings.md` §0.0-B](../agents/owner-rulings.md)
