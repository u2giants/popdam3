# API-created SKUs — merch-group re-map DRAFT (2026-08-28)

**Status: DRAFT FOR ALBERT'S REVIEW. Nothing has been loaded, and nothing may be loaded from it
without his line-by-line decision.** This is our work, not ColdLion's — see
[`coldlion-open-questions.md`](coldlion-open-questions.md) §5. Do not ask ColdLion to fix these rows.

**The row-level file is not in this repository.** `u2giants/shared-db` is public and the rows carry
licensed product descriptions. The draft was delivered to Albert directly as
`coldlion-api-sku-merch-group-DRAFT-20260828.csv`.

## The population is 343, not ~20

The handoff estimated "~20 API-created SKUs". Measured against all 19,362 items, the real figure is
**343** items created by `WebAPI` that are missing at least one of MG01, MG02 or MG03:
CW001 250, SP001 78, EH001 15. Of those, **42 are test or placeholder records**, not products
(descriptions like "test", "awdwad", "Uma created new record on march25", and nine EH001 items with
no description at all). That leaves **301 real products** to decide.

**123 of the 343 already carry a merch-group value that is wrong under the new scheme** — a leftover
pre-change code that would be overwritten, not preserved. Storage boxes carrying MG01 = `B`
(Framed/Wall) are the clearest case. The file flags every one of them.

## What the draft proposes

| Outcome | Items |
|---|---|
| Proposed, high confidence | 206 |
| Proposed, medium confidence | 76 |
| Needs review — the two evidence sources disagree | 7 |
| Abstained — no reliable evidence | 12 |
| Placeholder / test record, recommend deletion not mapping | 42 |

Every proposed row carries its evidence in plain English, the workbook meaning of the proposed
codes, and a blank `reviewer_decision` column.

## How each proposal was reached

Two independent sources, never one:

1. **Re-mapped siblings.** Items sharing the first five (then three) characters of the item number,
   restricted to rows re-mapped after the division's change date (CW001 2025-04-28, SP001 and EH001
   2025-09). A sibling only counts with at least two supporting rows and an 80% dominant share.
2. **The product description**, read semantically against the merch-group definition workbook.

Where both agree the row is high confidence. Where only one fires, the confidence is lowered and
the source is named. Where they disagree, **nothing is chosen** — the row is flagged for Albert
with both candidates. Where neither fires, the row abstains. Licensor, property, artwork, colour
and size were excluded from every decision.

Every proposed code was validated against the definition workbook for that division **and that
category** before it was written. This matters: an MG02/MG03 code is not unique on its own — its
meaning is scoped by the category the MG01 code belongs to, so the same `C1` means "Chest" under
Storage and "Calendar" under Tabletop.

## A finding worth keeping: the item number encodes the new merch groups

Position 1 of the item number is the MG01 code, positions 2 and 3 are the single-character
`itemNoCode` of MG02 and MG03, then size, licensor, property and sequence. Verified on 3,456 of
3,853 re-mapped rows — **89.7%**.

The 10% that fail are exactly the target population: SKUs numbered under the old scheme and
re-mapped without renumbering. So the item number **cannot** be decoded for these 343 items — but it
does mean any proposal here can be checked against the number for the rest of the catalogue, and it
is why sibling matching on the item-number prefix is reliable evidence.

## What Albert has to decide

1. **The 7 disagreements.** Four are "Floating Frame Canvas" items whose siblings say
   Stretched/Box canvas but whose wording says floating frame; two are embossed-paper floating
   frames whose siblings say glass shadowbox; one is a molded shadowbox whose siblings say printed
   glass shadowbox. Each needs one ruling that then settles its whole family.
2. **The 12 abstentions** — mostly multi-photo / infant photo frames and cotton-rope baskets, where
   the description does not separate the sub-type.
3. **The 42 placeholders** — confirm these are junk and should be deleted at ColdLion rather than
   mapped.
4. **The 123 overwrites** — confirm that a wrong pre-change value may be replaced.

Once he rules, the accepted rows can be loaded. **Not before.**
