---
issue: 1031
status: OPEN
owner: claude/coldlion-handoff-20260827
---

# ColdLion API — issues 3, 6 and 7 sent; awaiting JamieLynn's reply

## 1. Status
Correction reply **sent Thu 2026-08-27 18:34 EST**. Nothing is blocked on us. We are waiting on
ColdLion. Working tree clean; everything merged to `main` (last: b77724c).

## 2. What this is
POP pulls order and production history from the ColdLion ERP REST API
(`http://x5.coldlion.com/EhpApi`, `companyCode=EDGEHOME`, header `X-API-Key`). We are validating
the feed before building a loader. Open questions to the vendor are tracked in
`docs/coldlion-open-questions.md` — that register is the front door; read it first.

## 3. What was done this session
- Re-measured field population on **14,474 rows across 63 seven-day windows, 2019-01 to 2026-08**.
- **Corrected two false claims** we had already emailed the vendor on 2026-08-26: that no row
  reports shipping/invoicing (false — ~80% populated), and that the 7-day refusal is malformed
  (false — clean 400). The "-564" negative-quantity figure was also wrong (real range -3 to -8).
- **Issue 3** re-checked: ColdLion has **fixed `stageCode`** (real enum ISS/INTRAN/REC). Remaining
  ask narrowed to `mgTypeCode`, `divisionCode`, `active`, and response-field descriptions.
- **Issue 6** raised: no unique key exists; duplicate rows are real, not a request artefact (all
  160 colliding keys had both rows inside the same window). Named orders 7109618, 7121891, 7124128.
- **Issue 7** raised: `salesOrderLineNo` = 0 on 30 rows. Named orders 7114595, 7124128, 7126086.

## 4. Open items
1. **Awaiting ColdLion's reply** on issues 2, 3 (remainder), 5, 6, 7. No action until it arrives.
2. **Merch-group re-map of API-created SKUs is OURS**, not ColdLion's. Offered but never accepted:
   run ~20 affected SKUs through `item-description-taxonomy` as a **draft for Albert to review**.
   Never load an AI-generated mapping.

## 5. Key facts / gotchas
- Data path is `/EhpApi/...`; `/EhpApi/v2/...` is spec-only and 404s for data.
- `orderHistory?salesOrderNo=` alone returns **400** — dates are mandatory.
- Both history endpoints cap at a **7-day inclusive window**.
- **Size a population sample by ROW COUNT, not by number of days or calls.** 291 rows said seven
  fields were dead; 14,474 rows said 80% populated, and the wrong version reached a vendor.
- **Every problem reported to ColdLion must carry named order examples**, and issue numbers are
  permanent and consecutive across emails.

## 6. What was tried and failed
- Per-order detail pulls without dates → HTTP 400. Had to re-sweep by window and analyse offline.
- Two draft figures — "138 byte-identical rows" and "103 zero line numbers, 51 in 2026" — **did not
  reproduce** on the fresh sweep and were removed before sending. Do not quote them.
- `op run` via the MCP tool times out on the ~10-minute sweep; run it through Bash in background.

## 7. Files
- `docs/coldlion-open-questions.md` — the register. Start here.
- `docs/coldlion-19k-row-resample-20260827.md` — the evidence and the sent v3 reply text.
- `docs/coldlion-answers-20260826.md` — ColdLion's answers, with correction banners.

## 8. Secrets
API key: 1Password vault `vibe_coding`, item "Coldlion ERP API key x5.coldlion.com", field
`credential`. Never paste it into chat, args, logs or commits. **Do not rotate it.**

## 9. Data handling
Raw ColdLion payloads are customer order data. Scratchpad only, deleted after use — the repo has a
PII forward guard that will fail the merge.
