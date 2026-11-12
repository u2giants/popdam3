---
issue: 6150
status: OPEN
owner: mimo/6084-doc-health
---

# Handoff — MG06 merch-group fix + site-path store (2026-11-11, 5:10 PM EST)

Plan for the site-path store: [plan_mg06_licensor_site_path.md](../plan_mg06_licensor_site_path.md)
(step 0 of that plan = the work below).

## Prompt for the new session (paste as-is)

You are fixing POP Creations' list of ColdLion MG06 Property values so an AI can later
fill licensor submission forms (Disney OPA etc.) from the MG06 field. Deliverable: ONE
xlsx for Jamielynn (who edits ColdLion), one row per action, that a non-technical
person can follow. Write for a business owner: no jargon.

Rules for every row:
- MG06 display name = short name. The exact path on the licensor site is a separate
  column ("stored by us"), e.g. MICKEY MOUSE → `Mickey Mouse Family > Mickey Mouse`.
- Base "in use" on styles submitted since Jan 2025 (`plm.licensor_submission_pdf`,
  `submission_year >= 2025`, columns style_code, properties, characters).
- A value is only "inactivate" when it is ACTIVE in ColdLion today AND has no recent
  styles, or its license ended (docs: Care Bears and ZAG ended —
  `docs/business-rules/production-milestones-and-dates.md:46`). Licensing (Ilona)
  inactivates properties she expects not to use soon; her marks are NOT reliable
  (she marked Minnie inactive though 121 styles use it) — use recent activity instead.
- Never say "add" for something that already exists, and never say "inactivate" and
  "add" for the same property.

Bugs in the previous attempt (`~/Dropbox/ai/MG06 changes for AI submissions - for
Jamielynn - 2026-11-11.xlsx`, do not reuse its logic):
1. It matched the code inside the style number to `mg_code`. The style number holds
   `"ItemNoCode"`, which can differ (BACK TO THE FUTURE: mg_code `BTF`, ItemNoCode `BF`).
   So BTTF was told "inactivate" and "add new". Join on `core."merchGroup"."ItemNoCode"`.
2. It used the October review workbook as the active list instead of live ColdLion.
   Owner says RUGRATS is not active, yet our copy `core."merchGroup"` shows RG active in
   CW001 and SP001 (modTime 2019 / 2026-01-16). Find out whether the copy is stale or
   "active" means something else before trusting it; use the freshest ColdLion data.
3. Style numbers that are digits only (e.g. 567100897) were skipped; find their MG06 via
   the ColdLion item record instead (`plm.coldlion_item_merch_group` / item header).
4. Multi-property submissions ("Cars, Cars 3") were split on commas, which also breaks
   names containing commas ("Dark Knight, The (2008)"). Match against the licensor's
   real option list instead (`plm.opa_property`, `plm.wb_property`, `plm.nbcu_property`,
   …; the October workbook's "Valid Choices" tab has them per licensor).
5. Catch-all codes (Disney CP "CLASSIC PROPERTIES") were renamed to their single most
   used property — wrong; split them.

Sources: October workbook sent to Jamielynn
`~/Dropbox/ai/mg06-to-submissions-mapping-20261015_to_JL.xlsx` (tabs: MG06 Mapping —
Ilona's pick in column V; Unassigned Submissions — "Inactivate?" column; Valid Choices).
Disney OPA findings (Mickey Mouse Family vs Mickey Mouse vs Minnie vs Standard
Characters) are in the plan §3.

Done when: the xlsx has every active ColdLion MG06 value exactly once plus each needed
new value once; spot-checks of BTTF, Rugrats, Mickey, Minnie, Cars 3 are correct; owner
reviews it. Then continue with the plan's step 1.
