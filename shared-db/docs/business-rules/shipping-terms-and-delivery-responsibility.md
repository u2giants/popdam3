# Shipping terms and delivery responsibility

**Status:** Settled

## Where POP's responsibility ends, by sales-order term

**Status:** Settled. **Authority:** Albert Hazan (owner), in his chat, 2026-10-02 (EDT).

Albert's words, verbatim:

> "we have shipping terms on our production POs to factories and shipping terms on sales order
> that come in from our customers. (customer) PO (what we also call a sales order) ship date
> depends on the order's shipping terms. If our terms with the customer (on the sales order, not
> production order) are FOB China, then our responsibility ends at the customer's freight
> forwarder's facility in china. If the terms are POE NJ, our responsibility is to ship it to NJ
> seaport, clear customs, pay US duty, and make it available for the customer to pick up from NJ
> seaport. POE L.A. obviously means the same but in L.A. Warehouse means it is our
> responsibility is to ship it to NJ seaport, clear customs, pay US duty, truck the shipment to
> our domestic warehouse and make it available for the customer to pick up from our warehouse."

The rule:

1. **A customer PO and a sales order are the same thing.** "Customer PO" is the customer's
   name for it; "sales order" is POP's.
2. **There are two separate sets of shipping terms.** The production PO POP issues to a
   factory carries its own terms; the sales order from the customer carries its own terms.
   They are not interchangeable and one must not be read as the other.
3. **The customer-facing ship / delivery date depends on the sales order's terms**, not the
   production PO's terms.
4. **Where POP's responsibility ends, by sales-order term:**

| Sales-order term | POP's responsibility ends when the goods are... |
|---|---|
| FOB China | delivered to the **customer's freight forwarder's facility in China**. |
| POE NJ | shipped to the **NJ seaport**, customs cleared, US duty paid, and available for the customer to pick up **at the NJ port**. |
| POE L.A. | the same as POE NJ, but at the **L.A. port**. |
| Warehouse | shipped to the **NJ seaport**, customs cleared, US duty paid, **trucked to POP's domestic warehouse**, and available for the customer to pick up **at POP's warehouse**. |

Consistent with (not replaced by) the earlier Settled statements in
[`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) (*POE vs DDP*, Albert,
2026-09-17 — DDP adds trucking to the **customer's** warehouse, which is different from the
Warehouse term above) and the cost bases in [`rfq-pricing.md`](rfq-pricing.md) (*Deductions
and cost bases*).

## Unknown — not yet answered (do not guess)

- What the **production-PO-to-factory** terms are, and what each one means for POP vs the factory.
- **Lead times per term**: transit time, customs clearance, and trucking days between factory
  ship date and the point where POP's responsibility ends.
- **Which warehouse** the Warehouse term means (name/location), and whether it is always via
  the NJ port.
- Whether **other sales-order terms** exist beyond these four (the ERP shows codes such as
  POE Savannah/Norfolk, DDP-by-state, MDDP, FOB India/USA — their delivery-responsibility
  meaning in this frame is not yet stated).
- How the customer's **start date and cancel date** relate to each term (for example, whether
  the start date is the date goods must reach the end-of-responsibility point).

## Open question (not a rule)

- **Production-tracking promise date.** `popcre/designflow-tracking`
  `plan_prod-tracking-on-time-early-warning.md` step 7 anchors the schedule on the sales
  order's start/cancel date and compares against the production order's ship date. Under this
  rule, whether a production order is "on time" depends on the sales-order term (a POE or
  Warehouse order needs transit, clearance, and possibly trucking time after factory ship
  date; FOB China does not). How to convert the sales-order date into a required factory
  ship date per term is undecided and depends on the lead-time Unknown above.
