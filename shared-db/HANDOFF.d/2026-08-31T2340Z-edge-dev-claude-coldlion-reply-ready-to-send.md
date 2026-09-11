---
issue: 1031
status: OPEN
owner: claude/coldlion-api-validation-proofread-1d2edd
---

# ColdLion API — 2026-08-31 reply drafted and merged; waiting on Albert to send it

## 1. Status
**Nothing is blocked on code.** The outbound reply is written, reviewed, corrected four times to
Albert's instructions, and merged to `main`. It is waiting on exactly one human action: Albert
copying everything below the divider in `docs/coldlion-reply-draft-20260831.md` and emailing it to
JamieLynn at ColdLion. Working tree clean. Last ColdLion merges: `c655299c` (PR #2032),
`62ab1d8a` (PR #2033).

**AI sessions never send ColdLion mail.** Do not draft-and-send, do not use the Outlook tools for
this. Albert sends it himself, always.

## 2. What this is
POP pulls order history, production history and item master from the ColdLion ERP REST API
(`http://x5.coldlion.com/EhpApi`, `companyCode=EDGEHOME`, header `X-API-Key`). We are validating the
feed before building a loader. Open questions to the vendor live in `docs/coldlion-open-questions.md`
— **that register is the front door; read it before touching anything else.**

## 3. What was done this session
- **Documented ColdLion's 2026-08-31 delivery** — they added `LabelDesc`/`WarehouseDesc` to order and
  production history, added `MerchGroup01Desc`–`MerchGroup14Desc` to `/items`, and added paging to
  both history endpoints. All verified live. That closes outbound issue 8 outright and issue 3 bar
  one yes/no.
- **Cut the question list down hard, on owner instruction.** Albert: "i can't keep throwing more and
  more questions at them… make sure what you're asking is not something that has been settled
  before." Audited every pending topic against our own docs and **withdrew four** as already settled
  or not ours to ask (see §4).
- **Rebuilt the outbound numbering.** Confirmed by grep that ColdLion has only ever seen issues 1–8
  (they answered exactly 3 and 8). The 2026-08-28 draft was never sent, so 9+ were free to reassign.
- **Disproved the "April 2025" merch-group renumbering date** that was in our own records (§5).
- **Found a live quantity-multiplication fault** in ColdLion's invoiced order-history rows and
  re-wrote issue 7 from a passive note into an evidenced defect report (§5).

## 4. Open items
1. **Albert sends the reply.** `docs/coldlion-reply-draft-20260831.md`, everything below the `---`.
   Three asks go out: issue 6 (document-type marker — the lead ask), issue 7 (re-opened, quantity
   multiplication), issue 9 (new — which item flag means "stop selling"), plus the issue-3 yes/no.
2. **Then wait for JamieLynn.** Nothing else to ask. Do not add questions.
3. **Merch-group re-map of API-created SKUs is OURS, not ColdLion's.** Never ask them to fix those
   rows, and never load an AI-generated mapping — draft only, for Albert to review.
4. `mGCategory` is empty on 100% of items in all three divisions. Any future rule that expects to
   read a category off an item record cannot work; it must come from the merch-group definitions.

## 5. Key facts / gotchas
- Field names that bite: `createdTime` (not `createTime`), **`mGCategory` with a capital G** (not
  `mgCategory`), `sizeRangeCode` (not `sizeCode`). A wrong name returns **silence, not an error** —
  a grouping query produced an empty result and looked like a real finding.
- History endpoints take `fromDate`/`toDate` (**not** `startDate`/`endDate`) and cap at a **7-day
  inclusive window**. `orderHistory?salesOrderNo=` alone returns 400 — dates are mandatory.
- **Two numbering schemes, and they drift.** Outbound issue numbers (what ColdLion sees, 1–9) are
  NOT the same as internal register entries (`2.x`). The draft carries a mapping block at the top.
  Read it before editing either file.
- **The quantity-multiplication finding:** on all five affected orders the invoiced quantity per
  populated row equals orderQty × (number of populated rows). One order (synthetic illustration of
  the real shape: ordered 200, seven populated rows, 1,400 shown on each, summing to ~49× the true
  figure) demonstrates it. All five are recent invoiced orders, so it is current. The real order
  numbers are in the ColdLion question register, not in this public repository. **`lineInvoiceQty` cannot be trusted from this feed** until ColdLion answers.
- **There is no April 2025 signal anywhere in the API.** Merch-group headers carry 2019 or 2025-09
  timestamps and `merchGroupDetails` returns no modification timestamps at all. The real slot-07
  break is 2025-05-20/21 for CW001, ~05-27 for SP001, October 2025 for EH001. The slots we consume
  (05 = licensor, 06 = property) hold the same kind of value on both sides of that boundary, so the
  renumbering does not affect us and the cut-over question was dropped.
- Owner rulings that settle questions permanently: §6.6 (licensor→property is hand-curated, 2026-08-03),
  §6.10 (property codes not globally unique), 2026-08-17 (`prodReferenceNo` COS suffix),
  2026-08-27 (mgCategory resolves from division-qualified MG01 only).
- **Size a population sample by ROW COUNT, not by days or number of calls.** 291 rows once said seven
  fields were dead; 14,474 rows said 80% populated, and the wrong version reached the vendor.
- **Every problem reported to ColdLion must carry named order examples.** Counts are not a report.

## 6. What was tried and failed
- **Asked questions that were already settled internally** — the licensor→property relationship,
  `royaltyCode`, the item-number rule, and five small confirmations all went into a draft before
  being caught. That cost real vendor goodwill. A ⛔ gate now sits at the top of §2 of the register;
  read it before adding anything to a reply.
- **Referenced "withdrawn" questions ColdLion never received.** You cannot retract something they
  never saw. Check what was actually sent before writing "we're withdrawing X".
- **Cited a date with no source.** The April 2025 figure was in our own records and had no basis in
  the API. Verify a date against live data before repeating it to a vendor.
- `op run` via the MCP tool times out on long sweeps; run those through Bash in background. A
  scan of 2025-01-01→2026-08-31 (87 windows) exceeded 600s — narrow the range and raise page size.
- PowerShell: the `-f` format operator inside a `ForEach-Object` block threw a terminator error.
  Use plain string concatenation.
- The "Cross-PR object collision" merge check **fails closed** on a transient GitHub 504. That is by
  design (B6 in HANDOFF.md). Re-run the failed job — never bypass or disable the guard.

## 7. Files
- `docs/coldlion-reply-draft-20260831.md` — **the deliverable.** Send everything below the divider.
- `docs/coldlion-open-questions.md` — the register, with the ⛔ do-not-ask gate. Start here.
- `docs/coldlion-reply-draft-20260828.md` — the never-sent draft; useful only as a tone template.
- `docs/coldlion-answers-20260826.md` — ColdLion's earlier answers, with correction banners.

## 8. Secrets
API key: 1Password vault `vibe_coding`, item "Coldlion ERP API key x5.coldlion.com", field
`credential`. Inject via `op_run` with `shell: "powershell"` and
`command: 'powershell -ExecutionPolicy Bypass -File "<path>.ps1"'` — the Bypass flag is mandatory on
this machine. Never paste the key into chat, arguments, logs or commits. **Do not rotate it.**

## 9. Data handling
Raw ColdLion payloads are customer order data and **shared-db is a PUBLIC repository.** Scratchpad
only, deleted after use. No licensed descriptions and no customer order data may be committed — the
repo has a PII forward guard that will fail the merge. Named order and invoice numbers in the reply
draft are acceptable; row contents are not.
