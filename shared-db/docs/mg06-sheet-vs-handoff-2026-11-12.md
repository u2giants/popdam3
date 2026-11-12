---
summary: Compares Albert's 2026-11-12 MG06 style-move sheet with the MG06 fix handoff; records owner rulings.
kind: ops
status: current
read-when: reconciling Albert's MG06 sheet with the MG06 property-cleanup handoff
---

# Albert's MG06 sheet (2026-11-12) vs the MG06 fix handoff

## Plain-English summary

Albert's sheet and the handoff do different jobs. The sheet moves **individual styles** (584 of
them) from one Property value to a better one, with a reason per style. The handoff asks for a
**list of Property values** (which to inactivate, add, or rename) for Jamielynn. So the sheet
**overlaps** the handoff but does **not supersede** it: it has no inactivate rows, no rename
rows, and no "is this value active" column. Live ColdLion (2026-11-12) shows every value the
sheet points to already exists; five are inactive and need turning back on.

Owner rulings (2026-11-12): the 217 moves from MM "Standard Characters" to MMF "Mickey Mouse
Family" are **approved** — Mickey Mouse Family is the parent value and MICKEY MOUSE (Minnie,
Pluto, etc.) live under it ("there's no Mickey Mouse Family vs. MICKEY MOUSE. one lives under
the other."). RUGRATS **stays inactive**; older styles may still carry it, so moving
VSZ48VMNK01 onto it is fine.

What remains of the handoff: the corrected per-value xlsx for Jamielynn (now also covering the
"add" values Albert's sheet needs), then plan step 1 onward (step 6 included). Nothing was sent
to Jamielynn.

## Sources

- Albert's sheet: `~/Dropbox/ai/coldlion-mg06-changes-2026-11-12.xlsx`, one tab
  "ColdLion MG06 changes", columns Style, Licensor, MG05, Current MG06 code, Current property,
  New MG06 code, New property name, Why. 584 style rows.
- Handoff: `HANDOFF.d/2026-11-11T2210Z-edge-dev3-claude-mg06-site-path-and-merchgroup-fix.md`.

## Value-by-value comparison

| Action type (handoff) | In Albert's sheet? | Notes |
|---|---|---|
| Inactivate | No rows | Sheet never inactivates a value. Values it empties (e.g. Disney CP "Classic Characters", WP, FZ for some styles) may become inactivate candidates, but the handoff's recent-activity rule still decides. |
| Add | Implied | New codes the sheet assigns that must exist: MMF Mickey Mouse Family (217 styles), WC Winnie Pooh Classic (19), F2 Frozen II (7), AC Aristocats (36), BMB Bambi (16), 1D, BL, A1, DUM, LTA, RT, LSL, CCC Coca-Cola, JD Jurassic World, MG Marvel Comics (Retro), SX, GM, MSC, DYP, H1–H8 Harry Potter films/Literary Collection, DK1/DK2, star wars episode codes (CB, RJ, VS, PH, B8, R1, BN). Each must be checked against live ColdLion before listing as "add". |
| Rename | Partly | CKC "Coke" → CCC "Coca-Cola" and BU "BUGS LIFE" → BL "A Bug's Life" are naming fixes, but the sheet does them as moves to another code, not renames. |
| Active | Not stated | Sheet has no active flag. |

## Handoff spot-checks

- **BACK TO THE FUTURE** — not in the sheet. No conflict; handoff bug 1 still stands.
- **RUGRATS** — decided: RG stays inactive. Older styles can keep an inactive property;
  new ones can't use it. Style VSZ48VMNK01 (NK → RG) may move.
- **Mickey / Minnie** — Albert's sheet moves 217 styles MM "Standard Characters" → MMF
  "Mickey Mouse Family" (MMF is the parent value; the single character sits under it).
  Owner rule: Mickey with anyone else (Minnie, Pluto, Goofy) stays Standard Characters.
  Rechecked all 217 against their Disney submissions: 202 move as Mickey Mouse, 1 as Minnie
  Mouse (MBZ6XDYMM15), 9 stay on Standard Characters (HSR3MDYMM01, SQX26DYMM05, MQE48DYMM02,
  MTP57DYMM04, SQZ26DYMM01, MBZ80DYMM03, FG04DDYMM02, MTP70DYMM01, GFZ21DYMM02), and 5 name no
  character in the submission and need a look (VSZ14DYMM01, VSZ14DYMM03, RPZ14DYMM01,
  MBC80DYMM01, 3FZ93DYMM02).
  5 CP styles and 1 LS style go *to* MM "Standard Characters", so MM stays in use.
  No Minnie rows.
- **Cars 3** — no Cars 3 rows; 4 styles CR "CREATURE" → CAR "Cars".
- **Disney CP catch-all** — AGREES with handoff bug 5: the sheet splits CP into many specific
  properties instead of renaming it to one.

## Other things noticed in the sheet

- Odd current values that look like earlier data-entry mistakes, which the sheet fixes:
  Disney FR "A New Hope (Episode 4)" → Nightmare Before Christmas; Warner FR "A New Hope"
  → Harry Potter; Star Wars PT labelled "Empire Strikes Back" moved to six different episodes.
- "DTR - NO LICENSE" CC "Coco" → CCC "Coca-Cola" (10 styles).

## Conclusion

Overlap, not supersede. Rebuild the handoff's per-value xlsx using Albert's sheet as an input
(its new codes become "add" or "already exists" rows), settle the RUGRATS and MMF
points per the owner rulings above, then continue with the plan.

Corrected xlsx (not sent to Jamielynn): `~/Dropbox/ai/MG06 changes for Jamielynn - corrected - 2026-11-12.xlsx`.
