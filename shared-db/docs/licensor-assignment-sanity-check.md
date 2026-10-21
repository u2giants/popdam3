# Licensor assignment sanity check — required for every scrape and every generated list

**Who must read this:** any AI agent that captures a licensor scrape, lands or reconciles one,
or generates a review list, mapping workbook, dropdown, or export that groups Properties
(or Characters, Style Guides, Assets) by Licensor.

## The failure this prevents (2026-10-15 workbook, found 2026-10-21)

The MG06 → Submissions property-mapping workbook (`mg06-to-submissions-mapping-20261015.xlsx`)
listed these under **Disney (`DY`)**:

- Marvel Cross-Franchise Art Packs
- Marvels Agents of S.H.I.E.L.D. - Do Not Use
- Marvels The Offenders Animated TV Shows
- Luke Cage TV - Do Not Use

All four come from Disney OPA, which files Marvel under its `disney` branch
(see [`business-rules/licensing-master-data.md`](business-rules/licensing-master-data.md),
"OPA cannot separate Marvel from Disney"). The upstream OPA studio resolution sorted 199 OPA
properties to Marvel but left these four under Disney, and the workbook builder copied that
grouping without question. Its only check was "does this title match a same-licensor MG06
row?" Nothing checked **whether the licensor itself was plausible**, so the rows went quietly
into "Unassigned Submissions" under Disney. A human reviewer caught one by eye.

## The rule

Before you publish a scrape result or a generated list, run a **licensor-plausibility check**
and put its results in front of the reviewer. Do not just record them in a log.

1. **Name-versus-licensor conflict.** Flag every row whose name contains another Licensor's
   name or brand marker while it sits under a different Licensor. Keep the marker table near
   the code and extend it whenever you learn a new case. At minimum:

   | Marker in the name (case-insensitive) | Expected Licensor |
   | --- | --- |
   | `Marvel`, `Marvels`, `S.H.I.E.L.D`, `Luke Cage`, `Defenders`, `Avengers`, `Spider-Man`, `X-Men` | Marvel (`MV`) |
   | `Star Wars`, `Lucasfilm`, `Mandalorian`, `Jedi` | Lucasfilm / Star Wars (`SW`) |
   | `Pixar` | Disney (`DY`) unless contract says otherwise |
   | `DC `, `Batman`, `Superman`, `Justice League` | DC (`DC`) |
   | `Harry Potter`, `Hogwarts`, `Wizarding World` | Harry Potter (`HP`) |

   Match whole words, so that "DC" does not match inside another word.
2. **Crossovers are expected, not errors, but they still get flagged.** Titles such as
   "Disney 100th Celebration (Single Franchise: Marvel)" or "Phineas and Ferb - Mission Marvel"
   legitimately name two Licensors. Flag them as `crossover - verify`, never silently re-file
   them. Royalties and Minimum Guarantees are tracked per Licensor, so a wrong Licensor is a
   money error, not a cosmetic one.
3. **Never re-assign automatically.** The check only raises a flag. For Disney versus Marvel,
   the signed contract schedule decides (licensing-master-data.md). For everything else, a
   human or a recorded owner ruling decides.
4. **Make the flag visible where the reviewer works.** In a workbook, add a `Licensor check`
   column on every tab that lists rows by Licensor, plus a count on the Summary tab. In a
   scrape or landing report, put the flagged count and rows in the run's summary. A count of
   zero must also be shown, so reviewers know the check ran.
5. **Also check the reverse direction.** List the rows the Licensor's own name marker would
   claim that are filed elsewhere. For example, count rows filed under Marvel that do not
   look like Marvel. A sudden drop in a Licensor's row count against the previous run is the
   same signal.

## Verified baseline (2026-10-15 workbook)

On the "Unassigned Submissions" tab, the word `Marvel` alone flags **9** `DY` rows: 3 of the 4
above plus 6 crossovers (four "Disney 100th Celebration … Marvel" variants and two "Phineas and
Ferb - Mission Marvel" variants). **Luke Cage is not caught by the word `Marvel`.** That is why
the marker table must include franchise and character names, and why name markers are only a
net, not proof. For Disney OPA, also flag every `DY` row that contains no Disney marker and does
match a known Marvel property or character name in `core.property` / `core.character` under
`MV`. A rebuilt workbook should flag all 10 rows, unless they have been re-filed or inactivated
in the meantime.
