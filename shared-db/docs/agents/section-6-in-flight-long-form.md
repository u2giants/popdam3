# AGENTS.md §6 — what is in flight, full text

Relocated from `AGENTS.md` on 2026-08-20 (issue #1331, PR #1212): the in-flight narrative that
opens §6 — the ERP mirror relocation, the ColdLion cutover scoreboard, the five `prodHistory` /
`orderHistory` traps, and the ERP business-meaning notes. **Text unchanged.** The owner rulings
§6.1–§6.17 are not here; they are in [`../owner-rulings.md`](../owner-rulings.md). `AGENTS.md` §6
carries the headlines and points here.

## §6 — in flight (full text)

**Currently in flight (as of 2026-07-15): the ERP mirror relocation.** The
Coldlion ERP pull tables (`public.erp_*`, `public.prod_order_*`) are being moved
out of `public` into the designed `ingest` / `plm` / `api` layers. The full
5-phase plan, current state, and rationale live in
[`fix_schema_for_api.md`](fix_schema_for_api.md) (repo root). **Phase 1 is done
and live in production** (`api.plm_item_list` serving view + `style_tracker_rows_with_bridge`
repointed; migration `20260715193000_erp_phase1_api_plm_item_list.sql`). Phases
2–5 are pending. Before touching `erp_*`, `prod_order_*`, `api.plm_item_list`,
`plm.item`, `plm.production_order*`, or `plm.refresh_style_tracker_item_bridge()`,
read that plan first and continue it in order — do not start a parallel ERP
schema change. Note the still-open source decision (keep sourcing **through
dflow** for free enrichment vs. pull **Coldlion directly**) documented in
[`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md);
it affects Phase 3.

**Which entities are on ColdLion vs. still on DesignFlow?** Do not re-derive this by
querying — it has cost multiple sessions already. The answer, with row counts, blockers,
and the `plm.*_import` vs `plm.erp_*` naming rule, is in
[`docs/master-data-cutover-scoreboard.md`](docs/master-data-cutover-scoreboard.md).
Short version: **customer and vendor are cut over to ColdLion; licensor and property are
not** (and `plm.licensor_import` / `plm.property_import` are DesignFlow staging, *not* a
ColdLion mirror — a previous session got this wrong).

**ColdLion purchase/sales history (`prodHistory` / `orderHistory`) — read the shape doc before
writing any loader.** These two endpoints (new to us 2026-08-14) carry order history for buying
and selling. Their payload is documented from live probing in
[`docs/coldlion-history-endpoints-shape.md`](docs/coldlion-history-endpoints-shape.md). Five
traps that will silently corrupt a load if you skip it:

- **⚠️ The default `prodHistory` response is INCOMPLETE.** Without `stageCode` you get only the
  `ISS` (issued) lines. **There are exactly three stages — `ISS`, `INTRAN`, `REC`** (authoritative,
  ColdLion 2026-08-19) and all three carry real rows with **zero key overlap** between them.
  Omitting them loses everything about what actually *arrived* — order 90003 ordered 5,000 and
  received 4,748 (synthetic values), and only the `ISS` half is in the default. **Fetch all three and record which
  stage each row came from**, because the payload does not say and the keys do not collide, so a
  stage-blind table triple-counts quantities with no error. The pull is 3 stages × N windows.
- **Hard 7-day window cap (since 2026-08-17).** `fromDate`–`toDate` must be **within 7 days,
  inclusive**, on both endpoints; wider is refused outright. Month-wide calls that worked on
  2026-08-14 now fail. **The refusal is malformed** — HTTP 400 on the wire but `"status": 500` /
  `"Internal Server Error"` in the body — so a loader that trusts the body retries a permanent
  input error forever. Branch on the wire status, never the body's.
- **They are NOT paged.** They return a plain array and **silently ignore `page`/`size`**
  (`size=5` returned 265 rows). A paging loop re-fetches the same rows forever. Chunk by date.
- **`prodHistory` row identity is `(prodOrderNo, prodLineSeq, prepackItemNo)`.** `prodLineSeq` was
  added 2026-08-17 and **resolved the old duplicate-row ambiguity** — distinct `prodLineSeq` means
  distinct real buy lines, never merge them. Any remaining duplicate differs only in `last*`
  lookup fields and is safe to collapse (verified: 98 of 98). **Do not build or resurrect the old
  quantity-comparison heuristic** — §4.3 of the doc explains why it is obsolete.
- **`lineInvoiceQty` / `lineOpenQty` are zero in all 5,874 sampled rows**, as is `depositPerc`
  on `prodHistory`. A report built on them reads zero and looks like a business fact.

**Every open ColdLion question lives in one register:**
[`docs/coldlion-open-questions.md`](docs/coldlion-open-questions.md) — what is blocking, what is
merely open, what is already ANSWERED (do not re-ask), and which owner rulings keep getting
re-litigated. Check it before asking Albert or ColdLion anything, and move answers into its §4
rather than deleting them.

**What the ERP data MEANS** (as opposed to its shape) lives in
[`docs/business-rules-erp-data.md`](docs/business-rules-erp-data.md) — a new file, because this
repo documented shape thoroughly and meaning not at all, and a session already inferred a business
rule wrongly from field populations. **That file holds business meaning ONLY** — no
implementation advice, no build notes; those belong on the workstream's GitHub issue. First entry,
an owner ruling: a `prodReferenceNo` ending
**`COS`** marks **sample production** — extra pieces of a customer's item made for the licensor
(contractual samples) or for POP Creations itself (DAVID samples). They carry real cost with no
customer revenue, so classify them separately; `salesOrderNo = 0` on them is correct, not missing
data. **Never infer a business rule from field populations and write it down as fact** — put it in
the shape doc labelled as an inference until the owner confirms it.

Also: the feed spans **four divisions** (`CW001`, `EH001`, `EP001`, `SP001`), not just `EH001` —
a short window shows only `EH001` and misleads. `1900-01-01` is the empty-date marker
(**owner-confirmed 2026-08-14 — settled, do not re-raise**), and `salesOrderNo = 0` on
`prodHistory` means "no linked sales order", not a broken link.
