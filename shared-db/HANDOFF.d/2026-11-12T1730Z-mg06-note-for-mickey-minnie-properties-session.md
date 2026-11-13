---
issue: 6150
status: OPEN
owner: edge-dev3-claude/mg06-coordination
---
# Note for the session working on Mickey / Minnie / Mickey & Friends properties (2026-11-12, 12:30 PM EST)

What the MG06 work is doing, so you do not collide with it:

1. **MG06 keeps short names.** The item field MG06 (ColdLion merch group 06) is the licensed
   Property, with short display names (e.g. MICKEY MOUSE). We are not renaming MG06 values to
   match Disney's site wording.
2. **A new backend table stores the licensor-site path** for each MG06 value
   (`plan_mg06_licensor_site_path.md`), e.g. MICKEY MOUSE → Disney OPA "Mickey Mouse Family"
   > character "Mickey Mouse". The AI uses it to pick the right option when filling OPA.
   Session `mg06-site-path` builds it; it is populated only after the corrected MG06 list.
3. **Missing Disney properties are being repaired.** OPA's "Minnie", "Preschool CG Mickey
   (& Friends)" and "Standard Characters" are stuck 'unresolved' in `plm.opa_property` and never
   became `core.property` rows. Session `mg06-ilona-props` is fixing the step that should
   create them (owner rule: every scraped submission property is created). Do not hand-create
   these three rows — wait for that fix, then link to them.
4. **Which Minnie program a Minnie-only design uses** is being settled from past submissions by
   session `mg06-opa-gaps` (findings go to `docs/`).
5. **MG06 add/inactivate decisions** (Albert's 2026-11-12 sheet vs. the earlier handoff) are
   being reconciled by session `mg06-sheet-check`; Ilona confirms the open ones.

If your work changes Mickey/Minnie/Mickey & Friends `core.property` rows or their names,
comment on PR popcre/shared-db#6091 first so the site-path table maps to the right rows.

## Addendum (12:55 PM EST): the characters under Disney's "Mickey Mouse Family"

On Disney's submission site (OPA), "Mickey Mouse Family" is a **grouping**, not one
character. Under it Disney lists: Mickey Mouse, Minnie Mouse, Pluto, Big Bad Pete,
Clarabelle Cow, Horace Horsecollar, Morty, Ferdie, Morty & Ferdy, Chief O'Hara.
Separate OPA properties also exist: "Mickey Mouse" (old art programs only, e.g. Mickey's 60th,
Tuff Mickey — not the classic character), "Minnie" (Minnie & Me, Totally Minnie, Totally Minnie
Friends), and "Standard Characters" (Mickey, Donald, Goofy, etc. together).

What we are doing with it (owner ruling, 2026-11-12 12:54 PM EST: "one lives under the other"):
- **Mickey Mouse Family (MMF) is the parent property; MICKEY MOUSE lives under it**, as do
  Minnie Mouse, Pluto and the other family characters. These are levels, not competing names.
- **Mickey plus anyone else = "Standard Characters", never Mickey Mouse Family** (owner
  ruling 2026-11-12, 2:03 PM EST: "if it's mickey + anyone else (minnie, pluto, goofy) it
  submitted as 'Standard Characters'"). Mickey Mouse Family and its children (MICKEY MOUSE,
  Minnie Mouse, ...) are for **single-character** designs. Of Albert's 217 proposed moves,
  only the single-character ones move: 208 (207 Mickey Mouse, 1 Minnie Mouse); 9 stay on Standard Characters; Mickey-plus-others styles stay on
  Standard Characters.
- Treat MMF as the parent of MICKEY MOUSE (and of Minnie) in any property hierarchy you build.
  Do not merge or rename them into one.
- On Disney's site: MMF → OPA "Mickey Mouse Family"; MICKEY MOUSE → "Mickey Mouse Family" >
  "Mickey Mouse"; a Minnie-only design → OPA "Minnie" > "Minnie & Me".
- "Minnie" and "Standard Characters" become `core.property` rows through the repaired
  automatic step (session `mg06-ilona-props`), not by hand.

If your work needs a property per character (e.g. Pluto), stop and comment on PR
popcre/shared-db#6149 first; that would change this design.
