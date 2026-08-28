# Draft reply to ColdLion — 2026-08-28

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy the block below
as-is. Register entries covered: 2.16 (their question to us), 2.13 (documentation remainder),
2.14 (the source-document marker), 2.15 (the empty shipping and invoice fields).

---

Hi JamieLynn,

Thank you — the `/divisions` endpoint, the `MgTypeCode` and `Active` documentation, and the size
answer all landed. We tested each of them and they check out: `/divisions` returns the four
divisions cleanly, and the size code is a single value across our whole catalogue, exactly as you
said. Three things back.

**1. Your question about the maintenance tables — please put the descriptions directly in the
response, and only for `LabelCode` and `WarehouseCode`.**

Inline saves us a second call and saves both of us a local copy that can drift out of date. Those
two are populated on effectively every order-history and production-history row and we already use
them. We do not need `ColorCode` or `DimCode` — `DimCode` comes back empty on every historical row
we have pulled, and we do not consume `ColorCode` — so please do not spend time on either.

One small correction that may save you a step: none of those four fields appears on the `/items`
response, so anything built for them belongs on the history endpoints, not the item endpoint. And
the size field on `/items` is named `sizeRangeCode` rather than `sizeCode` — your answer about it is
right, we just want the field name in the documentation to match.

**2. The one field that would make the order-history feed usable: which document did the row come
from?**

Your answer on the split lines explained a great deal. If the feed assembles the Sales Order,
Prepack Detail, Pick Ticket and Invoice, and the line number is re-assigned at pick and at invoice,
then from our side a row does not say which of the four it is. That means we cannot tell a
sales-order row from an invoice row, cannot pick one row per line, and cannot total a value without
risking double-counting — because, as you said, both prices are real.

Could you add a document-type or source-stage marker to every `orderHistory` row? If the pick-ticket
number and invoice number are available alongside it, those would help too. This is the single
change that would move the feed from something we have to interpret to something we can load.

**3. The shipping and invoicing fields are still empty on historical rows.**

`invoiceNoString`, `invoiceDateString`, `lineInvoiceQty`, `shipQty` and `shipAmount` return nothing
on history. Your rule — if a line has an invoice number, open and unshipped drop to zero unless we
shipped short or partial — is exactly what we needed, but we cannot apply it, because the invoice
number it depends on is not in the feed. Either populating those on history or telling us they never
will be would both be useful; we just need to know which, so we stop planning around them.

Still open on your side from before: plain-English descriptions for the response fields, and what
`MerchGroup01` through `MerchGroup06` mean. We can read the codes through `/merchGroupHeaders` and
`/merchGroupDetails`, but only because we worked out that a code's meaning depends on its category —
that is not stated anywhere in the documentation, and it is the kind of thing that will trip up the
next person.

Thanks again,
Albert
