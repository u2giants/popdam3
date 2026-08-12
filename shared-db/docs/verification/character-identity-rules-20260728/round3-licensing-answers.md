# Round-3 licensing answers — evidence record

**Companion to `round3-licensing-answers.csv`. Issue #526 item (a).**

## What this is

The eight round-3 licensing questions were returned on **2026-08-06**. Until now
the answers existed only in narrative form in `fix_characters_style_guides.md`.
This is the same eight answers as a machine-readable, dated, attributed evidence
file, in the same spirit as `authorized-licensing-corrections.csv`.

It is a **record of what was answered**, not a decision and not an input to any
job. Nothing reads it. It exists so that the answers survive independently of a
prose document that may be rewritten.

## The eight answers

| Ref | Answer | Disposition |
|---|---|---|
| `A005` | `CC` | code confirmation |
| `B039` | IT IS JUST A LOGO OR TITLE | DROP |
| `B040` | IT IS JUST A LOGO OR TITLE | DROP |
| `B041` | IT IS JUST A LOGO OR TITLE | DROP |
| `B042` | IT SHOWS THE CHARACTERS | KEEP as one row |
| `B043` | IT SHOWS THE CHARACTERS | KEEP as one row |
| `B044` | IT SHOWS THE CHARACTERS | KEEP as one row |
| `B045` | IT SHOWS THE CHARACTERS | KEEP as one row |

Roll-up: **3 DROP, 4 KEEP, 1 code confirmation.** 8 of 8 answered, zero blanks,
zero uses of the `NONE OF THESE FIT` escape, zero format failures.

`tools/round3-licensing-answers.test.mjs` asserts the CSV against this roll-up
and against the exclusions below, so the file cannot silently drift from the
narrative or quietly regain the excluded material.

## What was deliberately left out, and why

Issue #526 says **extract `ref → answer` ONLY**. Four things are therefore absent
on purpose. Do not "complete" this file by adding them back.

1. **The workbook itself is not committed.** It carries a third party's name and
   free-text notes. It is held out of band by the coordinator.
2. **The reviewer's free-text notes are not reproduced** — not quoted, not
   paraphrased, not summarised.
3. **The reviewer is not named.** She is recorded as
   `licensing company reviewer`. This matches the repository's own publication
   scrub (`docs/verification/intake-publication-scrub-20260807.md`), which
   redacted her name. **This repository is PUBLIC.**
4. **The concrete POP item number** cited in the `A005` note as evidence is not
   reproduced. It is a real internal item identifier.

## What this file does NOT settle

`A005` names a **property CODE, not a row.** Property codes are not globally
unique, so *which licensor's* `CC` was meant remains an open technical question.
See the 2026-08-06 owner rulings in `fix_characters_style_guides.md` §8-OWNER.

## Item (b) of #526 is NOT done

`tools/validate-licensing-answers.mjs` has **still not been run** against this
answer set. It reads `core.property` on preview, i.e. it makes a database call,
and the session that produced this file was forbidden database calls — the same
constraint that blocked the original recording session.

⚠️ Two things the next session must know before running it:

- The validator has a **recorded defect**: it matches codes **globally**, so it
  would **not** catch a wrong-licensor `CC`. That is exactly the open question
  above, so a green result from this tool would not close `A005`.
- The standing rule is *"never accept a returned sheet on its answered-count
  alone."* 8/8 answered is not validation.

Only `A005` / `CC` is a code, so only that row is in the tool's scope at all.
