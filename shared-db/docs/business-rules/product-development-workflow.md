# Product-development workflow business rules

**Status:** Proposed

**Why this exists:** the only detailed account of POP's product-development
workflow currently lives in an old PM/PIM implementation plan. A plan is not a
safe permanent rulebook. This page is the companywide collection point for the
workflow, regardless of which application presents it.

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

- The complete current POP lifecycle, including required approvals and rollback paths.
- The complete current Spruce lifecycle.
- Which job owns each next action.
- Which transitions are allowed to skip stages and who may approve the exception.
- How CRM opportunities, DAM assets, DesignFlow items, samples, and orders join the same lifecycle.

