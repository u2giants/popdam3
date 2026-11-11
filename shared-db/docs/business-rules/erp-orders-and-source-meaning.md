---
summary: "ERP, orders and source meaning (Settled): general rule that ERP field names carry no meaning, plus table of the two part files."
kind: living
status: current
read-when: deciding what an ERP, OrderList or ColdLion order field means
---

# ERP, orders, and source meaning

**Status:** Settled

## Where each section lives

The full text was split **verbatim** on 2026-11-11 (size budget; popcre/designflow-backend issue 391). Section numbers and headings are unchanged. Open only the part that holds your section.

| Part | Sections |
|---|---|
| [erp-orders-and-source-meaning-part-1.md](erp-orders-and-source-meaning-part-1.md) | General rule<br>Orders and items<br>Bulk (HFC) orders replaced by distro orders<br>Burlington HFC (bulk) buy sheet: from final sheet to OrderList<br>How a new order enters the system (OrderList intake)<br>What this changes<br>The customer master is not a customer list<br>Historical classification<br>Samples and production indicators<br>What the ColdLion order-history feed actually is<br>Quantity fields in the order-history feed<br>Negative quantities are valid business data<br>Sales-order line number of zero<br>Blank merchandise groups on component rows<br>Other Settled answers from ColdLion |
| [erp-orders-and-source-meaning-part-2.md](erp-orders-and-source-meaning-part-2.md) | How ColdLion works — our working model of the ERP<br>Dim Codes, pack variants, and possible EDI multipliers<br>ColdLion has two sides, and they mirror each other<br>An order line is not the smallest unit; a pack component is<br>The order-history feed is a report, not a table<br>The feed shows only part of production unless you ask for every stage<br>`/proddetails` rows are keyed by `pkey`; `prodLineSeq` is not a line identity<br>What ColdLion computes, and what it refuses to explain<br>Not every endpoint answers in the same shape<br>Manual intervention is normal, and it is visible in the data<br>The divisions: four exist, three are ours<br>The merchandise-group hierarchy, what it names, and what the renumbering left behind<br>Things we worked out ourselves, that ColdLion has not confirmed<br>Product size comes from the hierarchy, not from the ERP's size field<br>What the ERP is not<br>The item master mixes products with charges, and barely says which is which<br>How ColdLion answers questions — and why that matters<br>Implementation and evidence |
