# Email capture and program linkage

**Status:** Settled

Authority: Albert Hazan, 2026-08-25. Both rules below are Settled: rule 1 is the
interim behaviour in force today, and rule 2 is the settled intent that replaces
it and is not yet implemented.

## What email belongs in the system

An email belongs in the system when it is evidence about POP's business — a
customer conversation, or the internal work of running a program. Whose mailbox
it arrived in, and whether an outside address appears on it, are clues about
that, not the test itself.

Two rules follow, and the second one wins wherever both apply.

### 1. External participation — the interim rule (Settled, interim)

Until program linkage exists, a message is captured only if at least one
participant is outside POP. Purely internal mail is not captured.

This is a deliberate stand-in for a judgement the system cannot yet make. It is
cheap, it keeps internal chatter out of a customer-facing record, and it is
right often enough to be useful today. It is **not** a statement that internal
email is worthless.

### 2. Program linkage takes precedence (Settled, not yet implemented)

Once a message can be linked to a program — for example by subject-line data
that identifies the program — **that linkage decides capture, and it overrides
the external-participation rule.** An internal-only email that belongs to a
program is valuable and must be captured, because the program's history is the
thing being recorded, not the customer's presence on the thread.

Consequences when this is built:

- Internal-only mail that links to a program is captured, and the external
  participant test is not consulted for it.
- Internal-only mail that links to no program stays out, under rule 1.
- The external-participation rule survives only as the fallback for messages
  with no program linkage. It must not be applied first as a filter, or
  program-linked internal mail is discarded before linkage is ever evaluated.
- Order of evaluation is therefore part of the rule, not an implementation
  detail.

### Why this is written down before it is built

The interim rule is enforced by a switch in an application worker. Someone
reading only that code would reasonably conclude POP had decided internal email
does not belong in the CRM. That is the opposite of the decision. This topic
exists so the interim rule is never mistaken for the settled intent.

## Whose mail is captured

Capturing a salesperson's mailbox is a per-person decision, not automatic on
hire. A mailbox is captured only when POP intends that person's customer and
program correspondence to be part of the business record.

## Related

- Ingested email domains are observation evidence and never become Customers —
  see [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md).
  Nothing in this topic changes that: capturing more email must never create or
  promote a Customer.
- Programs and the product work they drive:
  [`product-development-workflow.md`](product-development-workflow.md).

## Implementation evidence (not authority)

POP CRM enforces rule 1 today through the `OUTLOOK_GATED` setting on its host
worker; captured mailboxes are listed in `OUTLOOK_MAILBOXES`. Those names are
evidence of how the interim rule is currently implemented, and carry no
authority over the rules above.
