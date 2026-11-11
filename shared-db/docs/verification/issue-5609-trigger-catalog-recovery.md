---
summary: "Issue 5609 verification-only recovery contract: hash-bound catalog check of ten public.assets trigger identities after run 41974228042 applied the migration."
kind: proof
status: done
read-when: understanding how the 5609 catalog verification was recovered without reapplying SQL
---

# #5609 verification-only recovery contract

Owner: the #5609 release coordinator retains production and release custody.

Production run 41974228042 applied version 20261105033827 successfully and then
failed its enforcing catalog check because this trigger-only migration yielded
zero lexer targets. The repair adds a hash-bound named catalog contract without
changing the migration or reapplying its SQL. Recovery uses the existing
`production-catalog-verification-recovery.yml` workflow and original apply evidence.

The contract verifies all ten exact trigger identities on `public.assets`, their
original implementation routines, row/event coverage, ordinary enabled state,
no column-only restriction, no arguments or deferral, and exact PostgreSQL 17
trigger-definition prefixes including every WHEN predicate. Routine identity is
checked by OID separately from the deparser prefix to avoid search-path-dependent
qualification of the implementation function name.

A private isolated PostgreSQL 17 fixture compiled the ten original CREATE TRIGGER
statements using minimal local tables and inert trigger routines. The contract
accepted the complete installed state and rejected seven transactional changes:
a missing trigger, disabled trigger, replica-only trigger, different routine,
BEFORE timing, unconditional WHEN, and UPDATE OF column restriction. Each change
rolled back. No shared project was mutated by these drills.

Offline tests exercise the hash-bound sidecar, exact original trigger inventory,
and full enforcing verifier entry point: successful, failed, and absent catalog
results. The established empty-target and failed-contract guards remain intact.

Production acceptance remains the coordinator's read-only installed-definition
comparison and the existing verification-only recovery workflow. This document
is local verification evidence, not a claim that recovery has been dispatched.

The coordinator subsequently ran the exact read-only contract on the confirmed
production project at approximately 12:43 AM EST, November 5, 2026. It returned
true. This confirms all ten live trigger deparser fingerprints match; the
verification-only recovery receipt remains a separate delivery requirement.
