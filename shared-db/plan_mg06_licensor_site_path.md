---
summary: Plan to store each MG06 Property's exact licensor-site path in core.property_site_path for AI-filled licensor submissions.
kind: plan
status: open
read-when: executing the MG06 licensor-site path store (issues 2541/6150)
---

# Plan: store each MG06 Property's licensor-site path (for AI-filled licensor submissions)

Handoff: [HANDOFF.d/2026-11-11T2210Z-edge-dev3-claude-mg06-site-path-and-merchgroup-fix.md](HANDOFF.d/2026-11-11T2210Z-edge-dev3-claude-mg06-site-path-and-merchgroup-fix.md)

Supporting docs: [Albert's MG06 sheet vs the handoff](docs/mg06-sheet-vs-handoff-2026-11-12.md) | [Ilona confirmation email draft](docs/mg06-ilona-confirmation-email-draft-2026-11-12.md) | [OPA product lines and Minnie findings](docs/opa-product-lines-minnie-styleguide.md)

## STATUS (read first — do not re-plan)

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Prerequisite: corrected MG06 action list (separate session, see handoff) | ⬜ open | — |
| 1 | Claim objects on a GitHub issue | ⬜ open | — |
| 2 | Migration: new table `core.property_site_path` | ⬜ open | — |
| 3 | Migration: read function `api.mg06_site_path(...)` | ⬜ open | — |
| 4 | SQL contract tests | ⬜ open | — |
| 5 | Land through shared-db pipeline (preview → production) | ⬜ open | — |
| 6 | Populate with the values found 2026-11-11 | ⬜ open | — |
| 7 | Capture Range/Packaging/Line Sheet property lists | ✅ done 2026-11-12 | docs/opa-product-lines-minnie-styleguide.md |
| 8 | Add brand (Disney/Lucas) to site path; Style Guide stays optional, chosen from design file | ⬜ open | same doc §c |

**Fresh session starts at step 0 (check it is done), then step 1.**

---

## Part 1 — Why

### 1. Ultimate goal
POP Creations wants AI + DesignFlow to fill out licensor submission forms (first: Disney's
OPA site, `https://opa.disney.com`) automatically, so licensing staff stop copy-pasting.
On those forms a person picks a **property**, then ticks **characters** inside it. Our item
field for property is ColdLion **MG06** ("merch group 06" = Property, in the licensed
divisions). MG06 names must stay short for people (owner ruling 2026-11-11: display
"Mickey Mouse", not "Mickey Mouse Family > Mickey Mouse"). So the system needs a hidden
record, per MG06 value, of **exactly where the AI clicks on each licensor site**.

Done means: for any active MG06 value, a program can ask "for licensor X, which site
property and which character boxes?" and get the exact on-site names.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

### 2. What this application is
`popcre/shared-db` = the schema, migrations and contracts of the shared Supabase database
used by DesignFlow, POP DAM and other POP apps. No app runs from it. Migrations live in
`supabase/migrations/`, contract tests in `supabase/tests/`. Read `AGENTS.md` first.
Load the `shared-db-change` skill before any structural work.

### 3. Trigger
2026-11-11: licensing (Ilona) asked for MG06 values "Mickey Mouse standalone, Minnie Mouse
standalone, Mickey with other characters". Investigation showed Disney OPA's real structure:
- OPA property **"Mickey Mouse Family"** contains characters Mickey Mouse, Minnie Mouse,
  Pluto, Big Bad Pete, Clarabelle Cow, Horace Horsecollar, Morty, Ferdie, Morty & Ferdy,
  Chief O`Hara.
- OPA property **"Mickey Mouse"** is NOT the classic character; it holds old art programs
  (Mickey's 60th, Tuff Mickey, Mickey & Donald Show…).
- OPA **"Minnie"** holds Minnie & Me, Totally Minnie, Totally Minnie With Friends.
- OPA **"Standard Characters"** = Mickey with Donald, Goofy etc. (Donald Duck Family is
  not on our Home contract list.)
So MG06 "MICKEY MOUSE" (Mickey alone) must map to path `Mickey Mouse Family > Mickey Mouse`.
- Owner ruling 2026-11-12: Mickey plus anyone else (Minnie, Pluto, Goofy, …) is
  submitted as **"Standard Characters"**, never under any character inside
  "Mickey Mouse Family" — even though Minnie and Pluto are listed there.

### 4. Scope
In: one table + one read function + tests + loading the path rows.
NOT in this plan: the AI form-filling bot itself; changing ColdLion; deciding which MG06
values exist (that is the separate merch-group fix, step 0); non-Disney character
picking rules beyond storing them; style-guide field on OPA; other OPA product lines
than what the data covers.

## Part 2 — What we know

### 5. Current state
- ColdLion MG06 copy: `core."merchGroup"` (`"mgTypeCode"='06'`, columns `mg_code`,
  `"ItemNoCode"`, `mg_desc`, `is_active`, `"divisionCode_fk"`). Note `mg_code` and
  `"ItemNoCode"` differ for some rows (BACK TO THE FUTURE: mg_code `BTF`, ItemNoCode `BF`).
- Canonical properties: `core.property` (e.g. code `MM`, name `MICKEY MOUSE`).
- Scraped OPA vocab: `plm.opa_property` (licensed_property_id, property_name) and
  `plm.opa_property_character` (property → character, with OPA ids).
- Other licensors' scraped vocab: `plm.wb_property`, `plm.nbcu_property`,
  `plm.sega_submission_property`, `plm.pmt_trackerplus_submission_property`, etc.
- Past submissions (property + characters per style): `plm.licensor_submission_pdf`.
- Nothing for this plan is built. No branch, no commit.

### 6. Key findings
- MG06 alone cannot pick checkboxes; the path must include the character level where the
  MG06 value means a character (Mickey, Minnie).
- Store OPA **ids** as well as names: names can repeat across levels ("Mickey Mouse" is
  both a property and a character).

### 7. Rejected approaches
- Long MG06 names like "Mickey Mouse Family > Mickey Mouse" — rejected by owner (too wordy).
- Relying only on DesignFlow's per-style character field — rejected for Mickey/Minnie:
  Ilona wants standalone values, and the MG06 must be enough to submit.
- Putting the path in `core.property.metadata` JSON — rejected: untyped, no per-licensor
  or multi-row support, untestable.

### 8. Decisions
Locked (2026-11-11, owner): short display name; full site path stored in the backend.
Open (implementer judgment): exact column names; whether the key is `core.property.id`
or the merch-group row (prefer `core.property.id` if every active MG06 maps to one;
otherwise key by licensor code + MG06 code and document why).

## Part 3 — Build

### 9. Steps
**Step 0 — prerequisite.** The corrected MG06 list must exist (other session, see
handoff). Do not load paths for values that list says to inactivate.

**Step 1 — claim.** Open/claim a GitHub issue in `popcre/shared-db` naming the new
objects; follow `shared-db-change` claim-first rules.

**Step 2 — table** `supabase/migrations/<UTC14>_property_site_path.sql`:
`core.property_site_path(id uuid pk, property_id uuid not null references core.property,
licensor_site text not null check in ('disney_opa', …), site_property_name text not null,
site_property_id text null, site_character_name text null, site_character_id text null,
ordinal int not null default 1, source_evidence text not null, is_current boolean not
null default true, created_at, updated_at)`; unique on (property_id, licensor_site,
site_property_name, coalesce(site_character_name,'')). RLS on; read for authenticated,
write only for service role. Behaviour: one MG06 value can have several rows (e.g.
Standard Characters).
Done when: migration applies on a clean preview and `\d` shows the table + RLS.

**Step 3 — function** `api.mg06_site_path(p_property_id uuid, p_licensor_site text)`
returns rows (site_property_name, site_property_id, site_character_name,
site_character_id) where is_current. Done when: it returns the Mickey row after step 6.

**Step 4 — tests** `supabase/tests/property_site_path.sql`: (a) insert + read back;
(b) duplicate path rejected; (c) anon cannot read; (d) authenticated cannot write;
(e) unknown licensor_site rejected; (f) function returns only current rows.

Adversarial cases:
| Input | Hostile case | Test |
|---|---|---|
| licensor_site | unknown value | (e) |
| site names | duplicate path | (b) |
| caller role | anon read / authenticated write | (c), (d) |
| property_id | non-existent id | FK violation, add (g) |

**Step 5 — land** via the repo's normal PR → preview rehearsal → automatic production
promotion (never a manual production command).

**Step 6 — populate (last step)** with a migration or curated-data load per
`shared-db-change`. Values found 2026-11-11 (Disney OPA, Home line):
| MG06 display | Site property | Site character |
|---|---|---|
| MICKEY MOUSE | Mickey Mouse Family | Mickey Mouse |
| Minnie Mouse (new) | Minnie | Minnie & Me |
| Standard Characters (new) | Standard Characters | Standard Characters |
Plus, for every other MG06 value the corrected list (step 0) keeps, one row with the
exact site property name and no character (characters come from the style). Look up each
OPA id in `plm.opa_property` / `plm.opa_property_character`. Done when every active
MG06 value has ≥1 current row and a count query proves it.

### 10. Tests
Step 4 file plus the repo's existing suite (see `docs/development.md`) green.

### 11. Constraints
Structure only through `supabase/migrations/`; never hand-edit
`types/database.types.ts`; never push to `main`; sign GitHub posts; times in EST;
production only via automatic promotion.

### 12. Access
Supabase MCP (read), GitHub `gh` as the repo's normal identity. Disney OPA login is the
owner's Chrome session on edge-dev3; never enter credentials.

## Part 4 — Landing
### 13. Done + risks
Done: steps 1–6 merged, CI green, production promoted, count query shows full coverage,
STATUS updated with evidence, handoff updated.
Risks: OPA renames a property → path stale (mitigate: nightly compare with
`plm.opa_property`, follow-up). Minnie path "Minnie & Me" confirmed 2026-11-12: 406/406 past
OPA Minnie picks (docs/opa-product-lines-minnie-styleguide.md).

### Self-audit (2026-11-11)
1. Fresh session could execute without asking? Yes — goal §1, objects §5, steps §9.
2. Carries reasoning and rejected options? Yes — §6–§8.
3. Goal clear enough for judgment calls? Yes — §1 with conflict rule.
