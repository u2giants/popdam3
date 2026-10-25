# Product-development workflow business rules

**Status:** Proposed

**Why this exists:** the only detailed account of POP's product-development
workflow currently lives in an old PM/PIM implementation plan. A plan is not a
safe permanent rulebook. This page is the companywide collection point for the
workflow, regardless of which application presents it.

Individual sections may carry their own status. A section marked **Settled**
below is current authority for that subject even though the page as a whole is
still Proposed.

## Consolidated proposed business model

Product-development work is organized around real business objects, not generic
tasks alone:

- projects and offers;
- products, SKUs, and style numbers;
- designs and design collections;
- submissions and approvals;
- samples and revisions;
- pricing and factory requests;
- purchase orders and production orders;
- stage history, lifecycle state, evidence, and next-action ownership.

Applications may present different views for different jobs, but the underlying
business object and lifecycle remain the same. A status must say what happened
to the business object, not merely which screen or task list currently shows it.

## Required properties of a workflow rule

A workflow transition is not complete unless its rule states:

- the business object moving;
- the starting and ending state;
- who is allowed to move it, expressed as a job or role rather than a person's name;
- required evidence or approval;
- who owns the next action;
- what happens when the transition is rejected or reversed;
- which related objects must be notified or updated.

## Licensing status — backwards moves

**Status: Retired. Authority: Albert Hazan, chat 2026-10-21 and 2026-10-25.**

Albert Hazan's exact words (2026-10-21): “completely remove the backwards
licensing prevention. it's doing more damage than it's helping”. Confirmed
retired on 2026-10-25. Licensing statuses may now move in any order; no
application may block, or require a reason or role for, a backwards move.
Everything below in this section is historical record only and must not be
implemented.

**Former status: Settled 2026-10-09 (retired 2026-10-21).**

A licensing item may move backwards only when **all** of the following hold:

1. **From:** an approval state — Approved, Approved with changes, or Approved
   with revisions (including the stage-qualified forms Concept / 3D /
   Pre-production / Production Approved and their with-changes / with-revisions
   variants).
2. **Reason (required):** `buyer requested changes` OR `factory cannot
   mass-produce as approved`. No other reason permits a backwards move.
3. **Requested by:** Sales or Design only.
4. **Approved and applied by:** a Licensing Manager. The requester alone cannot
   apply the move.
5. **To:** a Resubmitted state only — Concept Resubmitted, 3D Resubmitted, or
   Pre-production Resubmitted — the stage that must be redone. Never an
   arbitrary earlier status.

If any condition is missing, the status does not move backwards.

### Packaging and product are separate workstreams

**Status: Settled. Authority: Albert Hazan, chat 2026-10-20. Effective: 2026-10-20.**

Packaging and product are separate licensing workstreams and are never
evaluated against each other for moves. A product status is compared only with
product statuses, and a packaging status only with packaging statuses. Moving
from a product status to a packaging status, or the reverse, is never a
backwards move. Within each workstream the backwards rule above applies in full.

### Verified delegated requests

**Status: Settled. Authority: Albert Hazan, direct human reply in the
coordinating Codex chat, 2026-10-14.** Source reference: question call
`call_6614409938fe4a20b440bf6d2004976a`, item 0 (no clock time recorded).

**Exact business question:** “For licensing requests, may an authorized
employee submit on behalf of a named Sales or Design employee, provided that
person’s identity and role are verified?”

**Albert’s exact answer:** “Yes, allow verified requests on their behalf.”

An authorized employee may submit a licensing request for a named Sales or
Design requester when that person’s identity and role are verified. The named
person is the requester for condition 3 above; the employee submitting the
request does not supply or replace that person’s role.

#### What this changes

This settles the requester side of the licensing-status rule: a verified
delegate may submit for a named Sales or Design requester. It leaves the other
conditions above unchanged, including the requirement that a Licensing Manager
approve and apply a backwards move. The business decision does not prescribe a
technical verification method.

### What this changes

This is the only controlling rule for backwards licensing-status movement. It
replaces earlier long enumerations of allowed status pairs and any reading that
permits free jumps to an arbitrary earlier status. Applications must implement
all five conditions; a business reason alone is not enough, and a Licensing
Manager action alone is not enough.

### Historical examples (not separate rules)

The following pairs, previously circulated as a standalone list, are
**examples of condition 5**, retained as Historical. They do not compete with
the rule above and are not an exhaustive allowlist. Two refinements from the
2026-10-09 owner statement apply: the requester is Sales **or Design** (not
Sales only), and the factory-cannot-mass-produce reason is equally valid (the
list only named buyer requested changes).

| From | To | Illustrates |
|---|---|---|
| Production Approved | Pre-production Resubmitted | later approval, pre-pro must be redone |
| Production Approved with changes | Pre-production Resubmitted | same |
| Pre-production Approved | Concept Resubmitted | concept must be redone |
| Pre-production Approved with changes | Concept Resubmitted | same |
| Concept Approved | Concept Resubmitted | same stage redone |
| Concept Approved with changes | Concept Resubmitted | same |
| 3D Approved | Concept Resubmitted | concept must be redone |
| 3D Approved with revisions | Concept Resubmitted | same |
| Pre-production Approved | 3D Resubmitted | 3D must be redone |
| Pre-production Approved with changes | 3D Resubmitted | same |

## Proposed rules awaiting confirmation

The historical PM/PIM plan describes detailed POP and Spruce transitions,
including concept approval, sample requests and receipts, factory resamples,
Licensor submission, pre-production approval, production approval, buyer
selection, price requests, and factory waiting states.

Those sequences are valuable evidence of intended process but remain **Proposed**
here until Albert or the responsible business authority confirms them as the
current company workflow. Do not silently promote a sequence merely because a
screen or database status already implements it.

The workflow-rules section of the [source plan](https://github.com/u2giants/poppim-web/blob/main/docs/architecture-update-implementation-plan.md)
is historical evidence, not the official current rule.

## Unknowns to collect

- The complete current POP lifecycle, including required approvals. (Rollback
  paths for licensing status are settled above; rollback for other statuses is
  still open.)
- The complete current Spruce lifecycle.
- Which job owns each next action.
- Which transitions are allowed to skip stages and who may approve the exception.
- How CRM opportunities, DAM assets, DesignFlow items, samples, and orders join the same lifecycle.

