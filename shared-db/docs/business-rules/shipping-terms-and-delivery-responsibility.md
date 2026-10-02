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
| Warehouse | shipped to the **NJ seaport**, customs cleared, US duty paid, **trucked to POP's domestic warehouse**, and available for the customer to pick up **at POP's warehouse**. (Reconciled the same day: POP has a warehouse in **L.A. as well as NJ**; Warehouse runs through whichever port serves that warehouse — see below.) |
| mDDP | see *mDDP* below (added later on 2026-10-02). |

## Second ruling: factory terms, mDDP, transit times, and customer dates

**Status:** Settled. **Authority:** Albert Hazan (owner), in his chat, 2026-10-02 (EDT),
relayed verbatim by the coordinating session:

> "99% of our production POs have FOB terms which means our responsibility starts at the seaport
> of the manufacturer's country (Ningbo, China; Qingdao, China; Cochin, India; etc.) and
> depending on the corresponding sales order terms either we or our customer are responsible for
> shipping and USA customs clearance and duties. 1% is DDP where the factory is responsible for
> arranging & paying freight and clearing customs and paying duties. There is also another
> shipping term on sales orders which is hardly, if ever, used anymore: mDDP. That means that the
> customer pays freight and arranges shipping but we are still responsible to clear customs and
> pay duties. China to USWC (L.A. = west coast) is about 19 days transit time. China to USEC
> (N.J. = east coast) is about 35 days transit time. Warehouse (depending on which warehouse, L.A.
> or NJ) is another 7 days transit time added on to their respective port-to-port transit times.
> the customer's start and cancel dates relate to the terms on their sales orders. document all
> of this"

### Production-PO (factory) terms

| Production-PO term | Share | Meaning |
|---|---|---|
| FOB (origin port) | about 99% | POP's responsibility **starts at the seaport of the manufacturer's country** (for example Ningbo or Qingdao, China; Cochin, India). From there, the **sales-order term** decides whether POP or the customer handles shipping, US customs clearance, and duty. |
| DDP | about 1% | The **factory** arranges and pays freight, clears customs, and pays duty. |

### mDDP (sales-order term, rarely if ever used now)

The **customer** pays freight and arranges shipping; **POP** is still responsible for clearing US
customs and paying duty. Implied: the goods are handed to the customer's shipping arrangement
at origin, as with FOB China, with POP's customs and duty obligation at the US port. The
**delivery point that the customer's dates are measured at is Unknown** (not stated).

### Warehouse term: L.A. or NJ

POP has a warehouse in **L.A.** and one in **NJ**. The Warehouse term ships through the port that
serves the chosen warehouse (L.A. port or NJ port), clears customs, pays duty, trucks to that
warehouse, and makes the goods available there. This reconciles the first ruling's
"Warehouse → NJ seaport" wording, which described the NJ case.

### Transit times (approximate, calendar days) — condition-dependent and dated

**Transit times change with world shipping conditions.** "Standard" is the normal-conditions
figure; "Current" is what Albert reported as of the date shown. Anyone using these numbers
(for example to compute a required factory ship date) must treat the Current column as dated
and re-confirm it with Albert or the forwarder when it is old; never silently fall back to
Standard while a Current disruption is on record.

| Leg (port to port) | Standard | Current (as of 2026-10-02) | Source |
|---|---|---|---|
| China → L.A. (US West Coast) | about 19 days | about 19 days (no disruption stated) | Albert, 2026-10-02 |
| China → NJ (US East Coast) | about 35 days | about 35 days (no disruption stated) | Albert, 2026-10-02 |
| Kochi (Cochin), India → NJ/NY | 25 days, standard Suez routing | **45 days via the Cape of Good Hope — Suez closed** | Albert, 2026-10-02 |
| Kochi (Cochin), India → L.A. | usually 30–35 days | **about 60 days — Panama Canal capacity constrained** | Albert, 2026-10-02 |
| Port → POP warehouse (L.A. or NJ, Warehouse term) | +7 days on top of that port's transit | +7 days | Albert, 2026-10-02 |

These are Albert's approximate figures, not guarantees.

**US customs clearance adds no time when all goes well (Settled, Albert, 2026-10-02).** Albert's
words: "customs clearance, if everything goes well, is done concurrently with shipping, while
the container is on the water." The transit figures above therefore already cover clearance in
the normal case; a clearance problem can add time that is not modelled here.

### Customer start and cancel dates

The customer's start and cancel dates relate to the **sales-order term**: they are measured at
the point where POP's responsibility ends under that term.

| Sales-order term | Start/cancel dates are measured at |
|---|---|
| FOB China | the origin port / the customer's freight forwarder's facility in China |
| POE NJ / POE L.A. | goods available for pickup at that US port (customs cleared, duty paid) |
| Warehouse (L.A. or NJ) | goods available for pickup at that POP warehouse |
| mDDP | Unknown (see *mDDP*) |

Consistent with (not replaced by) the earlier Settled statements in
[`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) (*POE vs DDP*, Albert,
2026-09-17 — sales-order DDP adds trucking to the **customer's** warehouse, which is different
from the Warehouse term above) and the cost bases in [`rfq-pricing.md`](rfq-pricing.md)
(*Deductions and cost bases*).

## Unknown — not yet answered (do not guess)

- **Transit times from origins other than China and Kochi, India** (other Indian ports, other countries).
- **Which warehouse a given sales order uses** (L.A. or NJ) and which data field records it.
- **DDP production-PO timing**: how the factory's ship date relates to delivery when the factory
  carries freight, customs, and duty.
- The **mDDP delivery point** for the customer's start/cancel dates.
- The delivery-responsibility meaning of other ERP routing codes (POE Savannah/Norfolk,
  sales-order DDP-by-state, FOB India/USA) in this frame.

## Open question (not a rule)

- **Production-tracking promise date.** `popcre/designflow-tracking`
  `plan_prod-tracking-on-time-early-warning.md` step 7 anchors the schedule on the sales
  order's start/cancel date and compares against the production order's ship date. Under these
  rules the required factory ship date depends on the sales-order term (roughly: FOB China ≈
  the customer date; POE L.A. ≈ 19 days earlier, POE NJ ≈ 35 days earlier, Warehouse +7 more,
  customs normally concurrent; Kochi origins use the dated India rows). How the plan should convert dates is a design decision for that
  plan, still blocked on the warehouse-source Unknown above and must use the dated Current transit figures.
