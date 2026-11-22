---
summary: "popcre/shared-db is public; never commit personal identifiers, credentials, or new infrastructure project refs."
kind: decision
status: current
read-when: committing docs, verification evidence, fixtures, or migrations to shared-db
---

# Public repository boundary: no personal identifiers or secrets (§6.14)

**Decided by:** Albert Hazan, 2026-08-07 and 2026-08-09

## Decision

`popcre/shared-db` is a public repository and stays public. Never commit personal identifiers (names, emails, phones, addresses), secret values, or new stable infrastructure identifiers into committed files or evidence.

Recorded in §6.7 (2026-08-07) and §6.14 (2026-08-09): this repository is public; no personal identifiers in anything written from now on.

## Why

Committed files are publicly visible and mirrored into consumer repositories; leaks require rotation and history cleanup.

## Rejected

Making the repo private as a workaround or committing raw vendor/personal payloads in verification docs.

## Source

Original record (left in place): [`docs/owner-rulings-part-2.md` §6.14](../owner-rulings-part-2.md#614-owner-ruling--this-repository-is-public-no-personal-identifiers-in-anything-you-write-from-now-on-albert-hazan-2026-08-09)
