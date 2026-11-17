---
issue: 1037
status: OPEN
owner: claude/semantic-search-investigation-8d17ef
---

# Handoff — typed search by meaning: plan written, nothing built

Written November 17, 2026, about 1:45 PM EST by Claude (hetz). This session only
investigated and planned. No code, database object or setting was changed.

The plan is the brief — read its STATUS first, then start at Step 0:
[docs/plans/issue-1037-typed-search-meaning-matching.md](../docs/plans/issue-1037-typed-search-meaning-matching.md)
Tracking issue: https://github.com/u2giants/popdam3/issues/1037

## 0. Business decisions only the owner can make

One was asked on November 17, 2026 and not answered: would a monthly fee for a rented graphics-card server be acceptable if the 0.6B text model falls short? Ask again only with a measured shortfall (plan §8 D10). None block the work. Two are parked in the plan (§13, "Open questions") to ask
only after the live result can be shown: whether naming a property gets the same
hard rule as naming a character, and whether a product that merely contains both
words (wrong product type) should be hidden or just ranked lower.

## 1. What was asked

Owner, November 17, 2026: natural-language search in PopDAM "is not working";
a search for a character plus "frame" misses framed products of that character
and shows other characters and a non-framed product.

## 2. What was found

Plan §6. In one line each: exact word forms hide 1,297 "framed" products from
"frame"; a product that truly contains both words matches honestly; other
characters arrive from the picture model's guess; PopDAM has no meaning matching
on description text at all.

## 3. Decisions already made (owner, November 17, 2026)

- "naming a character should show only products that contain that character."
- Embed "the item descriptions and directory tree" with the Qwen text model and
  NVIDIA card on `edge-dev`.
- Close wording is solved by a rule, never a per-term list.

## 4. State of the work

Plan and this handoff only. Step 0 is partly done (model found on `edge-dev`, card memory read); every other step is open. Plan on GitHub: https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1037-typed-search-meaning-matching.md

## 5. What was not verified

The Qwen model's revision, output size and fit beside the picture worker: plan
Step 0 (model `Qwen/Qwen3-Embedding-0.6B` confirmed present on `edge-dev`). Picture scores for the reported search were inferred by elimination
(the function has two result sources and the word source returns five known
products), not measured with a live query vector.

## 6. Next action

Plan Step 0 (confirm the model), with Steps 1 and 2 in parallel.

## 7. Traps

Public repository: no product codes or file ids in commits or issues. Database
structure goes through `popcre/shared-db`. Restarting the `edge-dev` worker
pauses picture-upload search.

## 8. Access

Plan §12.

## 9. Links

- Parent plan: [plan_vector_consolidation.md](../plan_vector_consolidation.md)
- Scorecard: [docs/SEARCH_EVAL.md](../docs/SEARCH_EVAL.md)
