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
   Production orders link to them by the customer PO number, never the sales-order number
   (Albert, 2026-10-09; see [`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md)).
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
| DDP | about 1% | The **factory** arranges and pays freight, clears customs, and pays duty. The **DDP production-PO ship date is the date the factory must hand the goods over to POP at the US port** (Settled, Albert, 2026-10-02). |

### mDDP (sales-order term, rarely if ever used now)

The **customer** pays freight and arranges shipping; **POP** is still responsible for clearing US
customs and paying duty.

**mDDP dates are measured the same as FOB (Settled, Albert, 2026-10-02).** Albert's words:
"since customer handles freight under mDDP, it is the same terms as FOB." POP's shipping
responsibility ends at origin exactly as under FOB China, and the customer's start/cancel dates
are measured there; POP's separate obligation to clear US customs and pay duty is unchanged.

### Warehouse term: L.A. or NJ

POP has a warehouse in **L.A.** and one in **NJ**. The Warehouse term ships through the port that
serves the chosen warehouse (L.A. port or NJ port), clears customs, pays duty, trucks to that
warehouse, and makes the goods available there. This reconciles the first ruling's
"Warehouse → NJ seaport" wording, which described the NJ case.

**Which warehouse comes from the ColdLion sales order (Settled, Albert, 2026-10-02).** Albert's
words: "the warehouse should be on the sales order in ColdLion." For a Warehouse-terms order, L.A.
vs NJ is read from the ColdLion sales order, never guessed. The field is the **ColdLion
sales-order line warehouse field** (stored in `coldlion.order_history_line`; the ColdLion API
also sends a plain-English name). ColdLion has **no separate terms field**: this one field
carries both the sales-order term and the location.

## Third ruling: origins, DDP factory date, and ColdLion warehouse values

**Status:** Settled. **Authority:** Albert Hazan (owner), in his chat, 2026-10-02 (EDT),
relayed verbatim by the coordinating session:

> "DDP factory ship date is the date they must hand over to Us at the US port. right now we
> don't make in other countries aside from china and india. Anthony's Warehouse is in L.A. West
> End Express is NJ. Deco Signs is a domestic USA manufacturer. Walmart picks up from Anthony's
> Warehouse in L.A. Amazon lately has been shipped via Amazon Global Logistics (AGL) where we
> deliver to their facility in China and they arrange shipping to their AWD and FBA facilities
> in the U.S. but we still own the inventory until it's sold"

- **Origin countries:** POP currently manufactures only in **China and India**.
- **DDP production PO:** the factory ship date is the date the factory must hand over to POP at
  the US port.

### Meaning of each ColdLion sales-order line warehouse value

Order counts are 2025-onward observations supplied by the coordinating session (evidence, not
rule).

| Warehouse value | Meaning | Where POP's responsibility ends / dates measured | 2025+ orders |
|---|---|---|---|
| FOB (China) | FOB China | the customer's forwarder facility in China | 658 |
| Anthony's Warehouse | **POP's L.A. warehouse** — Warehouse term, L.A. | available for pickup at Anthony's Warehouse, L.A. | 1,496 |
| West End Express | **POP's NJ warehouse** — Warehouse term, NJ | available for pickup at West End Express, NJ | 6 |
| Walmart Fulfillment Center | Walmart picks up from Anthony's Warehouse in L.A. — treat as **Warehouse, L.A.** | available for pickup at Anthony's Warehouse, L.A. | 11 |
| POE California | POE L.A. | available at the L.A. port | 108 |
| POE East Coast | POE NJ | available at the NJ port | 33 |
| mDDP | mDDP | the same point as FOB China | 49 |
| Amazon | **Amazon Global Logistics (AGL):** POP delivers to Amazon's facility in China; Amazon ships to its AWD and FBA facilities in the US; **POP still owns the inventory until it is sold** | Amazon's facility in China (measured like FOB China) | 4 |
| Deco Signs | a **domestic US manufacturer** — no ocean leg | Unknown (lead time Unknown) | 34 |
| DDP + US state (NJ 16, NC 7, PA 7, CA 5, five others 1 each) | sales-order DDP: POP also trucks to the customer's warehouse in that state ([`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md), *POE vs DDP*, 2026-09-17) | Unknown (see below) | 46 |
| blank | — | Unknown | 3 |

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
| mDDP | the same point as FOB China (origin / the customer's forwarder) |

Consistent with (not replaced by) the earlier Settled statements in
[`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) (*POE vs DDP*, Albert,
2026-09-17 — sales-order DDP adds trucking to the **customer's** warehouse, which is different
from the Warehouse term above) and the cost bases in [`rfq-pricing.md`](rfq-pricing.md)
(*Deductions and cost bases*).

## Unknown — not yet answered (do not guess)

- **"DDP <state>" sales orders:** the exact delivery point at which the customer's start/cancel
  dates are measured, and the trucking time from port to the customer's warehouse.
- **Deco Signs** (domestic US manufacturer): lead time and where dates are measured.
- **Blank** warehouse values on sales orders: what they mean.
- Transit times from Indian ports other than Kochi (China and India are the only origins today).
- The meaning of older or rarer ERP routing codes not in the table above (for example POE
  Savannah/Norfolk) in this frame.

## Open question (not a rule)

- **Production-tracking promise date.** `popcre/designflow-tracking`
  `plan_prod-tracking-on-time-early-warning.md` step 7 anchors the schedule on the sales
  order's start/cancel date and compares against the production order's ship date. Under these
  rules the required factory ship date depends on the sales-order term (roughly: FOB China ≈
  the customer date; POE L.A. ≈ 19 days earlier, POE NJ ≈ 35 days earlier, Warehouse +7 more,
  customs normally concurrent; Kochi origins use the dated India rows). How the plan should convert dates is a design decision for that
  plan, still waiting on the warehouse field name above and must use the dated Current transit figures.
