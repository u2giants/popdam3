# Round-2 licensing answers — evidence record

**Companion to `round2-licensing-answers.csv`. Issue #562, second outstanding item.**

> **THE LICENSING QUESTION STREAM IS CLOSED.** Round 3 returned 8 of 8 on
> 2026-08-06 and closed it. **There is no round 4.** Nothing in this file is a
> question, a gap to chase, or a reason to contact the reviewer. It is a record.

## What this is

Round 2 was sent on 2026-07-31 as
`licensing-questions-for-laura-round2-20260731.xlsx` (committed here — that is the
blank questionnaire, not the return) and came back on **2026-08-04**. Its answers
existed only in narrative form in `fix_characters_style_guides.md` and in the
retired `COORDINATOR_INTAKE.md` block migrated to issue #562. Round 3 already has
a machine-readable record (`round3-licensing-answers.csv`, issue #526); round 2
did not. This closes that asymmetry.

This is a **record of what was answered**, not a decision and not an input to any
job. Nothing reads it. It exists so the answers survive independently of prose
documents that may be rewritten.

## The shape of round 2

166 open rows were asked, in three blocks built by
`tools/build-licensing-questions-round2.py`:

| Block | Rows | Question |
|---|---:|---|
| `A005` | 1 | Which MG06 code does the Coco style guide use? |
| `B001`–`B154` | 154 | Is this combination row real characters, or just a label? |
| `C004`, `C006`, `C016`–`C023`, `C033` | 11 | Which single MG06 code does this character belong to? |

**157 of 166 answered. 9 blank. Zero format failures** — no wrong-question
answers, no invented codes, no double answers. The locked-dropdown design worked
and was kept for round 3.

| Answer | Rows |
|---|---:|
| `REAL CHARACTERS - I LISTED THEM` (block B) | 126 |
| `NOT CHARACTERS - DROP THE ROW` (block B) | 20 |
| `NONE` (all 11 block-C rows) | 11 |
| blank | 9 |

126 + 20 answered + 8 blank = the 154 block-B rows (`B007` is one of the 126: it
picked `REAL CHARACTERS` and left only the now-dead names cell empty); 11 block-C + `A005` blank completes 166.

## Row-level answers that are recoverable, and the one that is not

`round2-licensing-answers.csv` carries **every row whose `ref` and answer are both
provable from a committed source**: the 11 block-C rows (all `NONE`) and the 9
blanks with their dispositions, plus `B007` — 21 rows in all.

**The per-ref answers for the other 145 answered block-B rows are NOT in this
repository and cannot be reconstructed here.** The returned workbook contains a
third party's name and free-text notes and was deliberately never committed
(`fix_characters_style_guides.md`, round-3 section). Only the 126/20 roll-up
survives in a committed source. **Do not "complete" the CSV by inventing or
inferring those 145 values.** If the row-level detail is ever needed, it must come
from the out-of-band workbook, under the same handling rules — not from a new
question to the reviewer.

## The 11 block-C `NONE` answers are evidence, not a data error

All 11 dual-code rows came back `NONE`, with a consistent stated reason: the
character genuinely belongs to more than one property. Marvel's Boom Boom,
Cannonball, Domino, Headpool, Lady Deadpool, Negasonic Teenage Warhead,
Shatterstar and Warpath — *"it can be a part of two properties cause the
character appears on both universes"*. Blade, Warner's "Other Related Characters"
and Maxwell Lord — *"depends on the asset used."*

That is support **for** the many-to-many style axis in
[`../../style-guides-characters-and-royalties.md`](../../style-guides-characters-and-royalties.md)
§5A, not a reviewer mistake. The round-2 question itself ("pick exactly ONE code")
assumed one property per character; 11 of 11 answers said that assumption is wrong.

## The 9 blanks were our defect, not hers

Seven of the nine blanks correlate exactly with malformed questions produced by
the question generator, which split style-guide qualifiers into fragments and
then asked for them to be adjudicated as character names — *"Unknown names: gen"*,
*"Unknown names: back to school"*, *"wasp logo ms ant man wasp quantumania"*.

**That defect is fixed** (issue #562, third item): `splitCombination` in
`tools/resolve-character-identity.mjs` now strips the trailing style-guide scope
suffix, drops the franchise prefix only when the text after the dash is actually a
list, and removes royalty/logo/general qualifier components; and
`buildCombinationQuestion` in `tools/build-licensing-questions-csv.mjs` now
**refuses** to emit a question with no answerable name in it. The refusal is
covered by negative-path tests in
`tools/build-licensing-questions-refusal.test.mjs`, which fail when the fix is
reverted.

The remaining two blanks were not generator defects: `B038` carried an
unambiguous note (*"This is a collab they did. Not an actual character"*) and
`A005` carried the code in its note (*"CC ... (MBZ80DYCC01)"*).

## Names cannot be parsed mechanically — and no longer need to be

Across the 125 filled name entries the separator was a comma in 77, a slash in 24,
a semicolon in 7 and a colon in 2, frequently mixed inside a single cell, and 21
entries pair an actor with a character (*"Joe Jonas - Shane Gray; Nick Jonas -
Nate Gray"*).

**This is no longer blocking.** The owner ruled on 2026-08-04 that
multi-character style-guide rows are **not** split — they stay as one row — so the
free-text names column is dead and the resolver never consumed it. The one
question that survives the ruling is an owner decision, not an engineering one:
**are actor names stored at all, and if so where?** It is recorded here and owed
to the owner; it is not a question for the reviewer.

## What was deliberately left out

- The returned workbook itself, and any free-text notes beyond the short quotations
  above that are already published in committed documents.
- Per-ref answers for the other 145 answered block-B rows — see above.
- Any new question. The stream is closed.
