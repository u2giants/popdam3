# Business rules for reading ERP data

**What this is:** the *business meaning* behind ColdLion ERP fields and codes — the things no
amount of querying can tell you, because they live in how POP Creations actually operates.

**Why it exists:** as of 2026-08-17 this repo had extensive documentation of ERP data *shape*
(field names, types, populations) and none of its *meaning*. That gap caused a real mistake: a
session inferred from field populations that a class of production orders was "stock production
not raised against a customer order", which was **wrong**. Shape tells you what a field contains;
only the business can tell you what it means.

**How to use it:** every rule here is stated by the owner or a named source, dated, with what it
implies for reporting. Do not add an inferred rule to this file. Inferences belong in the shape
docs, clearly labelled as inferences, until someone with authority confirms them.

Related: [`coldlion-history-endpoints-shape.md`](coldlion-history-endpoints-shape.md) (data shape),
[`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) (the API itself),
[`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) (taxonomy).

---

## 1. Production PO numbers ending `COS` — sample production

> **Owner ruling (Albert Hazan, 2026-08-17), relaying POP Creations' own practice:**
>
> "If a Production PO # (`prodReferenceNo`) has a COS at the end it means we are making extra
> pieces of those items (that are going to the customer) not for the customer but for the licensor
> (called **contractual samples**) and/or our internal purposes (called **'DAVID' samples**)."

**What it means.** A `COS` production order is an *add-on run of an item that is already being made
for a customer*, produced for someone other than that customer:

- **Contractual samples** — pieces owed to the **licensor** (Disney, Marvel, Warner and so on) under
  the licensing agreement, typically for approval or record.
- **DAVID samples** — pieces retained for **POP Creations' own internal purposes**.

**What it implies for reporting — this matters:**

1. **`COS` lines are a real cost with no corresponding customer revenue.** They are goods we pay a
   factory to make and then give away or keep. Counting them as ordinary purchases understates
   margin on the customer order; ignoring them entirely understates the true cost of servicing that
   licensed product. They should be **classifiable separately**, not silently merged into either.
2. **They are legitimately unlinked to a sales order.** `salesOrderNo = 0` on a `COS` line is
   correct and expected, not missing data — see §2 of the shape doc's §5.5 discussion.
3. **The customer named on a `COS` line is the customer of the *original* order**, not the recipient
   of the samples. The recipient is the licensor or ourselves. Do not report `COS` quantities as
   shipped to that customer.
4. The distinction between contractual and DAVID samples is **not visible in the ERP payload** —
   both share the `COS` suffix. If we ever need to split them, that is a new question for ColdLion.

**Evidence in the data (verified 2026-08-17, 1,047 rows across five weeks spanning 2019–2026):**

- `prodReferenceNo` ending `COS` appeared on **95 rows / 95 distinct order-lines**, and on
  **zero** rows that had a sales order. The rule is clean in both directions.
- **Quantities are tiny and unmistakable:** `COS` lines run **min 3, median 4, max 15**, against a
  median of **2,000** on ordinary customer-linked lines. Sample runs look like sample runs.
- They concentrate in `FOBCHINA` (83 of 95) and warehouse `FOB` — consistent with pieces peeled off
  a factory-direct shipment.

**A second, older sample marker exists — do not assume `COS` is the only one.** Two rows carried the
marker in the **item code** instead: `VSZ851MABPCONTR` and `VSZ851WAJGCONTR` (`CONTR` suffix,
"DC COMICS CANVAS SAMPLES"), both quantity 15, both unlinked, and **neither had a `COS` reference**.
A third case put it in the item itself: `SAMPLECHRG` / "SAMPLE CHARGE". So sample-related production
is identifiable by **at least three** different conventions. Any "is this a sample?" rule must
account for that, and a `COS`-only rule will miss cases.

## 2. What `COS` does NOT explain

Of **550 unlinked rows** in the same sample, `COS` accounts for **95**. The remaining **455 rows
(248 distinct order-lines)** have no sales order and no `COS` marker, and they do **not** look like
samples:

- **Quantities are ordinary production volumes** — min 1, **median 430**, max 15,600.
- They are dominated by `POECA` and `POE` production types (380 of 455) and by division `CW001`.
- A customer is still named on nearly all of them.

Example: order 20016, line 1, reference `d0561`, 1,600 units of a Marvel long canvas for customer
MOD010, with no sales order attached.

**This is still an open question with ColdLion** and is the sharpened version of the original
`salesOrderNo = 0` query. Until it is answered, do not classify these rows as samples, as stock
production, or as customer orders. See
[`_drafts/coldlion-history-endpoints-questions.md`](_drafts/coldlion-history-endpoints-questions.md).
