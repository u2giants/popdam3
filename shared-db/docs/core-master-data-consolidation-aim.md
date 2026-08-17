# Licensing Master Data architecture

**Status:** SETTLED central database and application architecture

**Owner:** Albert Hazan

**Effective:** 2026-08-16

**Canonical repository:** `u2giants/shared-db`

**Applies to:** every POP application using the shared Supabase project

This is a permanent design decision, not an issue, proposal, backlog item, or
temporary migration plan. Future database structures, source loaders, API
contracts, admin screens, and application behavior must follow it.

The executable build sequence is
[`../plan_licensing_master_data_implementation.md`](../plan_licensing_master_data_implementation.md).
Read its STATUS table first; do not re-plan completed phases.

## 1. Decision in one paragraph

The official licensing Master Data consists of **Licensor, Property, Character,
Style Guide, Asset metadata, and Franchise**. For every licensor portal POP
scrapes, the authorized licensor scrape is canonical for the official property
name, the property's owning licensor, and the characters, style guides, asset
metadata, franchises, and direct relationships published by that source.
ColdLion has one separate authority: its current Property list decides which
canonical Properties are **Active**. A canonical Property absent from a complete,
successful ColdLion pull is **Inactive**, never deleted. DesignFlow, including
the one stale pull previously copied into Supabase, has no authority in this
model. Authorized licensor scrapes run weekly.

## 2. Scope and current licensed sources

The rule applies to every authorized licensor source POP scrapes. Four source
programs have been undertaken so far:

- Disney, through OPA and DCP Vault;
- NBCUniversal, through Creative Asset Factory;
- Paramount, through Creative Library;
- Warner Bros., through STARLABS.

The same rules automatically apply to an additional licensor source once POP
authorizes and implements its scrape. A source has authority only inside its own
licensed scope. Warner cannot rename a Disney Property, for example.

## 3. Source authority matrix

| Fact | Canonical authority | ColdLion role | DesignFlow role | Absence or conflict |
|---|---|---|---|---|
| Licensor identity and official name | Authorized licensor scrape where supplied; otherwise licensing review | Operational source reference only | None | Scrape wins; internal spelling may remain as an alias |
| Property official name | Authorized licensor scrape | May help match the operational record | None | Scrape spelling replaces internal spelling |
| Property owning Licensor | Authorized licensor scrape | No authority | None | Scrape relationship wins; unresolved rows wait for licensing review |
| Property Active/Inactive | Current complete, successful ColdLion Property set | Sole authority | None | Present means Active; absent means Inactive; never delete |
| Character identity and name | Authorized licensor scrape | None | None | Preserve the last canonical row and flag source disappearance for review |
| Property-to-Character relationship | Direct relationship published by the licensor source | None | None | Never infer from an internal list or filename |
| Style Guide identity and name | Authorized licensor scrape | None | None | Preserve the last canonical row and flag source disappearance for review |
| Style Guide relationships | Direct relationship published by the licensor source | None | None | Do not convert co-occurrence into a direct relationship |
| Asset metadata | Authorized licensor scrape | None | None | Store metadata and source location, not licensed files in this public repo |
| Asset relationships | Direct relationship published by the licensor source | None | None | Preserve evidence type and source provenance |
| Franchise identity and name | Authorized licensor scrape | None | None | Preserve source terminology such as NBCU “IP Family” |
| Franchise relationships | Direct relationship published by the licensor source | None | None | Co-occurrence remains labelled evidence, not a canonical relationship |

### Conflict rule

When an authorized licensor scrape disagrees with ColdLion, DesignFlow, the
stale Supabase DesignFlow mirror, a spreadsheet, or an older internal record
about Property spelling or Property ownership, the licensor scrape wins.
Alternate internal wording may be retained as an alias to support matching and
search. It must not remain the canonical value.

## 4. DesignFlow is explicitly excluded as an authority

Disregard the one stale DesignFlow pull that previously reached Supabase. It
must not seed, overwrite, arbitrate, confirm, or fill gaps in canonical
licensing Master Data.

DesignFlow values may be retained only as clearly labelled historical source
references or aliases when useful for tracing an old application record. They
must never:

- decide which Licensor owns a Property;
- decide how a Property is spelled;
- supply a Character, Style Guide, Asset, or Franchise universe;
- make a Property Active or Inactive;
- create a canonical relationship merely because a licensor scrape has not yet
  been run.

Applications must read the canonical Supabase contracts. They must not rebuild
licensing truth from DesignFlow tables or cached DesignFlow payloads.

## 5. Canonical entity model

### 5.1 Licensor

One canonical row represents one licensing company or separately administered
licensing entity. It retains aliases and every contributing source reference.
A portal-supplied official name wins over an internal spelling.

Relationship: one Licensor can own many Properties. Each canonical Property has
one owning Licensor unless a future authoritative source proves that the real
business relationship has changed. Do not add a Licensor-to-Property junction
table without a new owner decision supported by source evidence.

### 5.2 Property

One canonical row represents one real licensed Property or title. It contains:

- the canonical name from the applicable authorized licensor scrape;
- one owning Licensor;
- Active or Inactive operational status derived from ColdLion membership;
- aliases for alternate internal names and spellings;
- source references, first-seen, last-seen, and audit facts.

No refresh hard-deletes a Property. Inactive means POP is not currently carrying
it in ColdLion. It does not mean the Property stopped existing.

A Property first created from an authorized licensor scrape starts in review as
**Potential**, never Active by default. Only the separate guarded ColdLion
membership reconciliation can later set it Active or Inactive.

### 5.3 Character

One canonical row represents one real Character. A Character may belong to
multiple Properties. Property-to-Character is therefore many-to-many and must
not be reduced to a single `property_id` stored on Character.

Only direct licensed-source evidence creates or removes a current relationship.
Removing or inactivating a Property must not destroy its Characters.

### 5.4 Style Guide

One canonical row represents one source-defined Style Guide or a source-defined
collection that genuinely serves as a Style Guide. Preserve the source's own
type and terminology so “collection,” “style guide,” and similar concepts are
not silently flattened without evidence.

Style Guide-to-Character is many-to-many: one Style Guide can contain many
Characters and one Character can appear in many Style Guides. Other direct
source-published links, including Property and Asset links, are preserved with
their provenance.

### 5.5 Asset

The canonical Asset record stores **metadata**, not licensed artwork files in
this public repository. Metadata may include:

- the source's stable identifier and namespace;
- official filename, source path, or source locator;
- media type, size, dimensions, checksum, and timestamps when supplied;
- first-seen, last-seen, and capture facts;
- direct links published by the source to Property, Character, Style Guide, and
  Franchise.

These relationships are many-to-many wherever the source allows more than one
value. A filename, folder name, or co-occurrence is not silently promoted into
a direct relationship.

### 5.6 Franchise

One canonical row represents one source-defined Franchise or equivalent family.
Preserve source terminology, including NBCU's “IP Family.”

Franchise relationships are recorded only when the licensed source directly
publishes them. Paramount's Property and Franchise appearing on the same Asset
is the standing example of **co-occurrence evidence**, not proof that the
Property belongs to that Franchise. Evidence may be retained and displayed,
but it must stay explicitly labelled and separate from canonical direct links.

## 6. Relationship model

```text
Licensor 1 ──────── * Property
Property * ──────── * Character
Style Guide * ───── * Character
Property * ──────── * Style Guide   when directly supplied
Asset * ─────────── * Property      when directly supplied
Asset * ─────────── * Character     when directly supplied
Asset * ─────────── * Style Guide   when directly supplied
Asset * ─────────── * Franchise     when directly supplied
Franchise * ─────── * Property      only with a direct source statement
```

Every relationship retains its source, source key, evidence type, first-seen,
last-seen, and current/retired state. The model must distinguish a direct source
relationship from an inference or co-occurrence observation.

## 7. Provenance, identity, and aliases

Every canonical entity keeps all contributing source identities. A short code
is never assumed globally unique. Source identity uses the source system plus
the complete source-specific key or namespace required to prevent collisions.

Canonical consolidation must be safe to rerun:

- the same source identity updates the same canonical row;
- two sources referring to the same real entity can attach to one canonical
  row after automatic or human-reviewed resolution;
- uncertain matches wait for licensing review instead of guessing;
- aliases preserve alternate spellings without competing with the canonical
  name;
- merge and mapping decisions are audited and reversible.

Licensed row data remains inside its approved private source repository and the
shared database. It must not be copied into this public repository, GitHub
issues, pull requests, logs, or external review prompts.

## 8. ColdLion Active/Inactive contract

ColdLion controls one fact only: whether POP currently carries a Property.

After a complete, successful ColdLion cycle and approved reconciliation:

- every mapped canonical Property present in the current ColdLion Property set
  is Active;
- every canonical Property absent from that set is Inactive;
- no canonical row is deleted;
- ColdLion cannot rename a scrape-covered Property or change its Licensor;
- unmatched ColdLion records enter the licensing review queue and do not create
  guessed canonical ownership.

The review queue may offer a create-new action for a ColdLion record that has no
canonical match, but ColdLion is only the proposal source. A Licensing user must
confirm the canonical Property name and owning Licensor before the row is
created. The row starts Potential, then the membership calculation may make it
Active. If a later authorized licensor scrape covers that Property, the scrape's
name and ownership win and the earlier reviewed wording is retained as an alias.

The status calculation must fail closed. A failed, short, incomplete, or
suspicious ColdLion response cannot deactivate the catalogue. Required guards
include expected source scope, minimum counts, maximum shrink limits, complete
pagination, duplicate-key checks, and a reviewable proposed change set before
status changes are applied.

An unresolved ColdLion record does not freeze status for the entire catalogue.
It protects only the specific canonical candidate rows it might represent: those
rows retain their prior status, or remain Potential if new, until reviewed.
Mapped rows and canonical rows with a resolved absence may still receive the
guarded Active/Inactive result. An unmatched record cannot be dismissed with a
generic “unknown” reason; exclusions require a reviewed non-Property, duplicate,
out-of-scope, ignored, or dismissed decision with audit facts.

## 9. Weekly scrape and consolidation contract

Every authorized licensor scrape runs at least weekly. This is an application
and operations requirement supported by the database design, not merely a
database schedule.

Each weekly cycle must:

1. capture the source faithfully into source-specific landing tables;
2. retain capture identity, source identifiers, and capture history;
3. validate completeness before canonical consolidation;
4. reconcile source entities into the canonical tables without duplicates;
5. update canonical names and direct relationships when the authoritative
   source changes;
6. preserve records missing from the new scrape, record last-seen state, and
   send them to review rather than deleting them;
7. run the guarded ColdLion membership reconciliation separately to calculate
   Property Active/Inactive;
8. record success, failure, counts, freshness, and exceptions without exposing
   licensed row contents;
9. alert loudly when capture, validation, consolidation, or scheduling fails.

The weekly process must be idempotent, which means rerunning the same completed
capture produces the same canonical result without duplicates.

## 10. Application contract

All POP applications use the same canonical Supabase records and relationships.
Application-specific screens may expose different views, but they must not own
competing Licensor, Property, Character, Style Guide, Asset, or Franchise truth.

DB Data Admin is the management surface for licensing review, matching, aliases,
status review, and audit. Licensing users resolve uncertain matches. They do not
manually override source authority without a recorded owner decision.

Source-specific landing tables remain faithful mirrors. They are evidence and
input to consolidation, not alternative canonical application tables.

## 11. Structural requirements

The shared database structure must provide:

- one canonical home for each of the six entity types;
- explicit relationship tables wherever the relationship is many-to-many;
- complete source references and aliases;
- first-seen, last-seen, capture, freshness, and audit facts;
- a distinction between direct relationships and evidence-only observations;
- review queues for unresolved or conflicting identities;
- reversible merges and mapping decisions;
- guarded Active/Inactive calculation from ColdLion;
- read contracts for applications and controlled write contracts for loaders and
  licensing administration;
- no cascade behavior that destroys canonical entities merely because a source
  record or relationship disappears.

Existing canonical tables and relationships should be reused where they satisfy
this contract. Competing replacements must not be created. Any structural change
needed to reach this model still follows the shared-db branch, preview, review,
pull-request, merge, and production safety process. That delivery process does
not turn this settled architecture decision into an “issue.”

## 12. Superseded statements

This decision supersedes earlier statements that:

- DesignFlow seeds or arbitrates the canonical Property-to-Licensor edge;
- the stale Supabase DesignFlow mirror can fill gaps left by scrapes;
- ColdLion controls canonical Property spelling or ownership;
- Active/Inactive is manually independent of ColdLion membership;
- a Character must belong to only one Property;
- co-occurrence alone proves a direct Franchise relationship.

Historical documents may describe how the system previously worked. When they
conflict with this file, this file wins.
