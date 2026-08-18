# Master Data access

**Status:** Settled

## Styles grid editing

Every signed-in POP user may add and update rows in the Master Data / Styles grid. This is deliberate business access, not an accidental open permission. A person's general application role must not be used to remove that access.

This rule is limited to the Styles grid. It does not grant the same access to Assets, Style Groups, licensing catalog curation, or every table that happens to be called Master Data. Those objects follow their own approved access rules.

The rule was reconfirmed after a 2026-07-26 restriction locked ordinary users out and had to be reversed the same day.

## Unknowns

Companywide view and edit permissions for other Master Data objects remain **Unknown** unless their business topic contains a dated decision.

## Implementation and evidence

The database access details and incident record remain in [`../../AGENTS.md`](../../AGENTS.md), section 0.4. This page owns the business meaning of the access decision.
