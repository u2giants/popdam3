# RFQ pricing, margin, and royalty rules

**Status:** Proposed

## Business purpose

RFQ pricing answers three different business questions:

1. Given a buy cost and deductions, what sell price produces the required margin?
2. Given a buy cost and a proposed sell price, what margin does POP earn?
3. Given a sell price and target margin, what is the maximum allowable buy cost?

The first two are current behavior. The third is a defined business scenario but
is not currently built.

## Deductions and cost bases

Pricing must use the correct cost basis for the selected Incoterm and business
line. Royalty, dilution, logistics, duty, agent cost, and margin are distinct
inputs. A missing required licensed-product input must fail visibly; it must not
silently become zero.

The customer-side delivery terms determine POP's cost basis:

| Term | POP's cost basis |
|---|---|
| FOB | Factory cost including sourcing-agent commission. The customer pays freight and duty. |
| mDDP | FOB cost including agent commission, duty percentage, and fixed duty amount. The customer pays freight. |
| POE | mDDP cost plus ocean freight. The customer picks up at the US port. |
| WHSE | POE cost plus warehouse delivery and handling. The customer picks up from POP's warehouse. |

The company uses 60 cubic metres as a full-container equivalent. Carton volume
per piece is carton length times width times height, divided by 1,000,000 to
convert cubic centimetres to cubic metres, then divided by case pack.

```text
cost including agent = factory FOB cost × (1 + agent percentage ÷ 100)
cost including duty = cost including agent × (1 + duty percentage ÷ 100) + fixed duty amount
freight per piece = (container cost ÷ 60) × carton volume per piece
warehouse cost per piece = (warehouse cost ÷ 60) × carton volume per piece
POE cost = cost including duty + freight per piece
WHSE cost = POE cost + warehouse cost per piece
```

Royalty, dilution, logistics load, and margin are simultaneous reductions from
the gross sell price. They are not applied one after another.

## Royalty rules

- Licensed products use the applicable licensed royalty percentage.
- Generic products have no royalty. Generic royalty is numeric zero, not a
  hidden or legacy input field.
- A legacy generic royalty value stored on an old row does not change the
  calculation. Generic pricing must still use zero.
- Royalty is part of the deduction calculation and must not be counted twice.
- Marvel artwork containing talent likeness carries two additional royalty percentage points.
  The likeness decision belongs to the specific Style Guide Asset file, not to the Character.
  See [`licensing-master-data.md`](licensing-master-data.md).

## Buyer Target and Buyer Margin

Buyer Target is a proposed sell price entered by an authorized business user.
Buyer Margin is calculated from that target and the applicable cost and
deduction inputs. Buyer Margin is an output, not a separately editable decision.

## Quote readiness and price history

An RFQ item may become Active only when the business has the information required to
request and compare a real quote: Tech Pack, Case Pack, RFQ Group, Quantity, Customer,
Description, Delivery Location, and License when the product is licensed. A blocked
transition must name every missing requirement.

The price sent to Sales must retain the duty and container-cost assumptions that were
in force when the price was set. Later cost changes must not make an old sales price look
as though it was calculated from the new assumptions.

## Pricing scenarios

### Cost known, required margin known

```text
gross sell price = cost basis ÷
  (1 - royalty percentage ÷ 100 - dilution percentage ÷ 100
     - logistics percentage ÷ 100 - margin percentage ÷ 100)
```

### Sell price known, margin unknown

```text
net sell price = gross sell price ×
  (1 - royalty percentage ÷ 100 - dilution percentage ÷ 100
     - logistics percentage ÷ 100)

margin percentage =
  (net sell price - cost basis) ÷ gross sell price × 100
```

### Sell price and required margin known, maximum buy cost unknown

```text
maximum buy cost = gross sell price ×
  (1 - royalty percentage ÷ 100 - dilution percentage ÷ 100
     - logistics percentage ÷ 100 - margin percentage ÷ 100)
```

This third scenario is a proposed calculation and is not currently built into
the workflow.

## Duplicate factory rule

A factory may submit more than one quote for the same RFQ item when the offers
represent legitimate alternatives such as different price, quantity, or terms.
Staff must not add the same factory twice as though it were two different
factories. The first is a valid business event; the second is an accidental
duplicate relationship.

## Permissions

- A factory owns its quote. A contact is a person acting for that factory, not
  the owner of the quote.
- Vendors may update the quote fields they are authorized to supply.
- Vendors may not change the RFQ item's internal workflow status.

## Detailed calculation reference

The [DesignFlow frontend RFQ reference](https://github.com/popcre/designflow-frontend/blob/develop/docs/rfq-math.md) records field names,
calculation helpers, screen behavior, and historical defects. It is implementation
evidence only. The formulas and business meaning above remain Proposed until business approval is recorded here.
