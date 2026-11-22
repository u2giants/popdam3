---
summary: "ColdLion MG groups are division-specific; MG05=Licensor and MG06=Property apply only in CW001 and SP001."
kind: decision
status: current
read-when: querying or syncing ColdLion MG05/MG06 merchandise groups
---

# ColdLion MG groups are division-specific (§6.42)

**Decided by:** Albert Hazan, 2026-11-16 (issue #6463)

## Decision

MG05 means Licensor and MG06 means Property only in licensed divisions `CW001` and `SP001`. In `EH001`/`EP001` the same slots mean other things (e.g., `EH001` MG05 values are art themes like Abstract and Animal). Always filter MG queries by division and resolve MG06 parents within their own division.

> "art themes like Abstract and Animal are the MG05 values for division EH001. MG groups are specific to divisions."

## Why

Unfiltered MG05/MG06 queries pollute licensor and property lists with non-licensed art themes.

## Rejected

Reading ColdLion MG05 or MG06 without filtering by division (`CW001`/`SP001`).

## Source

Original record (left in place): [`docs/owner-rulings-part-4.md` §6.42](../owner-rulings-part-4.md#642-owner-ruling--coldlion-mg-groups-are-division-specific-licensors-come-only-from-cw001sp001-mg05-albert-hazan-2026-11-16)
