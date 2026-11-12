# OPA product lines, Minnie program, Style Guide field — findings 2026-11-12

Supports `plan_mg06_licensor_site_path.md`.

## (a) Property list per "Create New Product" line — LIVE CHECK 2026-11-12 1:05 PM EST
Read in Albert's Chrome on edge-dev3 (signed in). Forms were opened only; nothing
saved or submitted. Menu: North America > {Disney, Lucas} > Home > 4 lines.
| Brand | Line | Template | Workflow | Properties | How property is picked | Characters | Style Guide |
|---|---|---|---|---|---|---|---|
| Disney | Standard | 21 | 49 | 1454 | tree (property > character boxes) | yes | yes |
| Disney | Range | 207 | 49 | 1454 (same as Standard) | tree | yes | yes |
| Disney | Packaging | 23 | 4 | 1454 (same names) | flat checkbox list | no | no field |
| Disney | Line Sheet | 434 | 45 | 1454 (same names) | flat checkbox list | no | yes |
| Lucas | Standard | 462 | 50 | 74 (Star Wars, Indiana Jones, Lucas Home…) | tree | yes | yes |
| Lucas | Range | 484 | 50 | 74 (same as Lucas Standard) | tree | yes | yes |
| Lucas | Packaging | 464 | 24 | 74 (same names) | flat checkbox list | no | no field |
| Lucas | Line Sheet | 519 | 46 | 74 (same names) | flat checkbox list | no | yes |
Conclusions for the AI:
- Within one brand, all four lines offer the same property names; only Standard and
  Range let you tick characters. One stored site path per MG06 value works for every
  line; the character part is used only on Standard/Range.
- The brand menu decides the list: Star Wars/Indiana Jones properties exist only under
  Lucas; Disney (incl. Marvel, Fox, Mickey) only under Disney. Store the brand with the
  site path (`disney_opa` vs a Lucas value, or a brand column).
- Packaging and Line Sheet use checkboxes, so several properties may be ticked.

## (b) Minnie program for a Minnie-only design — DECIDED from history
`plm.licensor_submission_pdf`, OPA property "Minnie": 406 of 406 character picks are
"Minnie & Me" (2022–2026). No split; no owner question needed.
Rule: MG06 Minnie Mouse → OPA property "Minnie" → "Minnie & Me".
Preschool designs use a different property, "Preschool CG Minnie (& Friends)" (26 subs) —
not this MG06 value.

## (c) Style Guide field — LIVE CHECK 2026-11-12
- Label "Style Guide", optional (no required star), multi-select.
- Present on Standard, Range and Line Sheet; absent on Packaging.
- One shared list of 220 guides, identical for Disney and Lucas; it does not narrow
  when a property is chosen. Each entry reads "<id>-<guide name> - <season>/<year>",
  e.g. "3222042-minnie-mouse--foundation---style-guide - spring-or-summer/2027".
- Past PDFs: only ~38 Disney-family submissions named a guide (mostly Marvel); classic
  Mickey/Minnie left it blank.
Rule for the AI:
1. Packaging: skip (no field).
2. If the design file or DesignFlow style names a style guide / art program, pick the
   entry whose name contains it, preferring the newest season; may pick more than one.
3. Otherwise leave blank (allowed, and matches history).
4. Never pick by property name alone when several guides match — flag for a person.
