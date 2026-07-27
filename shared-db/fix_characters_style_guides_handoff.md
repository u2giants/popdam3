# HANDOFF — characters and style guides, canonical migration

**Written:** 2026-07-26 · **Updated:** 2026-07-26 · **Repo:** `u2giants/shared-db` ·
**Branch:** `main` · **Next action:** wait for the licensing team's completed corrected 335-row review
sheet, expected in 24–48 hours. Phase 2 needs separate approval because the owner previously
said not to write a migration yet.

**No database has been changed.** Every session to date has been read-only investigation plus
documentation. `core.character` is still **0 rows**.

> This is one of several parallel workstreams in this repo. The repo-wide
> [`HANDOFF.md`](HANDOFF.md) currently prioritises the **ColdLion licensor/property Phase 6**
> workstream, which is a different effort — see §9 here for how the two interact.

---

## How to read this handoff

The execution detail already lives in two merged documents. This file gives a newcomer what those
documents assume you already know — what the system *is*, how to reach it, and what is uncertain —
then hands you off to them. It does not repeat them.

| Standard section | Where it lives |
|---|---|
| 1. What this application is | **here, §1** |
| 2. What we set out to do, and why | **here, §2** |
| 3. Current state | **here, §3** (+ the plan doc's status header) |
| 4. What did NOT work | [`fix_characters_style_guides.md`](fix_characters_style_guides.md) **§10** (8 items) and [`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md) **§6** (3 modelling errors) |
| 5. Root causes and key findings | model doc **§1, §4, §5A.0b**; plan doc **§2** |
| 6. Exact next steps | plan doc **Phases 0–7**, each with exit criteria |
| 7. Constraints and gotchas | plan doc **§0, §8**, Phase 4 warning box; [`AGENTS.md`](AGENTS.md) §4, §4.1, §5, §8.1; **plus §7 here** for traps recorded nowhere else |
| 8. Access and environment | **here, §8** |
| 9. Open questions and risks | **here, §9** (+ model doc §7) |

**Read in this order:** this file → `fix_characters_style_guides.md` →
`docs/style-guides-characters-and-royalties.md` → `AGENTS.md`.

---

## 1. What this application is

**POP Creations** designs and manufactures licensed consumer products — housewares, toys and
similar goods carrying characters and brands licensed from studios (Disney, Warner Bros, Marvel,
WWE, Coca-Cola…). Getting the licensing taxonomy right is not bookkeeping: it determines what
royalty is owed to whom.

There is **one shared Supabase (PostgreSQL) database** that several in-house applications read and
write. This repo, `shared-db`, is the **only** place that database's schema may be changed.

| System | What it does | Schema it owns |
|---|---|---|
| **DesignFlow PLM** ("dflow") | Product lifecycle: items, production orders, RFQs, sample tracking. Runs on Google Cloud (Cloud Run + Cloud SQL in production). Six `popcre/designflow-*` repos, reviewed by an external developer (Uma). | `dflow`, `plm` |
| **PopDAM / PopSG** | Digital asset management — artwork, style-guide files, images. Also crawls the style-guide file server. | `dam`, plus legacy tables in `public` |
| **PopPIM / PM** | Product information management. | `pim` |
| **PopCRM** | Customer relationship management. | `crm` |
| **Coldlion** | The **ERP** — an external third-party system of record for items, customers, vendors and the merch-group classification codes. Read-only HTTP API at `x5.coldlion.com`. Not ours. | — |

Shared canonical master data (customers, factories, licensors, properties, characters) lives in
the **`core`** schema and is read by everyone. **`public` is PopDAM's pre-shared-db legacy schema,
not a naming convention** — this matters, because most of the data this migration moves is sitting
there.

**The owner (Albert) is not a programmer.** He directs the work and judges results in business
terms; the AI owns all branches, commits, PRs and merges end to end. Explain in plain English, and
never leave an open PR for him to deal with.

## 2. What we set out to do, and why

**Business goal:** the characters in our licensed artwork are not in the shared database in any
usable, canonical form. Any app needing to answer *"which characters exist, and which property and
licensor do they belong to?"* is either guessing or reading a private copy. That blocks DAM, PM and
probably PLM.

**Technical objective:** migrate the legacy DesignFlow licensing taxonomy —
`dflow.properties_and_characters`, `dflow.property_character_associations`, and their
`source_licensed_property_id` / `source_character_id` external identities — into the canonical
`core.*` schema, preserving correct licensor → property → character relationships and
external-source identity, preview-first, with reconciliation for row counts, duplicates, missing
parents, orphan relationships and idempotency.

**What actually happened, and why there is no migration yet:** the investigation found the legacy
data does not mean what its column names say. Three modelling errors were made and corrected by the
owner (recorded in model doc §6). The most important correction:

> `type='PROPERTY'` rows in `dflow.properties_and_characters` are **style guides**, not properties.
> `type='CHARACTER'` rows are character **appearances** — one per style guide — not distinct
> characters. Batman is **one** character appearing in **15** style guides.

Acting on the literal column names would have created 313 style guides as properties and
permanently corrupted the property list and every property picker. That is why the work so far
produced documentation and a plan rather than DDL: **the model had to be right first.**

## 3. Current state

**Everything is committed, pushed and merged to `main`. Working tree clean. No open PRs of ours.**

| PR | Merge SHA | What it landed |
|---|---|---|
| [#197](https://github.com/u2giants/shared-db/pull/197) | `db97cd9` | The model: style guides, sub-style guides, talent-likeness royalty rules |
| [#203](https://github.com/u2giants/shared-db/pull/203) | `31e6583` | Correction: two axes (ownership linear, style many-to-many) |
| [#215](https://github.com/u2giants/shared-db/pull/215) | `f9c8758` | Classics → `CP` rule; property-scope decision |
| [#236](https://github.com/u2giants/shared-db/pull/236) | `5bd2f5f` | Shared vs app-owned split (names shared, files app-owned) |
| [#237](https://github.com/u2giants/shared-db/pull/237) | `1a9a4b1` | The phased plan + preserved review sheet and its regenerator |

**Complete:** Phase 0 hybrid source decision and Phase 1 read-only property reconciliation.

**Not started:** Phases 2–7. No migration exists.

**Live database facts, measured 2026-07-26 against production `qsllyeztdwjgirsysgai`:**

- `core.character` — **0 rows** (the canonical target; never populated)
- `core.style_guide`, `core.style_guide_character` — **do not exist yet** (Phase 2 creates them)
- `core.property` — 256 rows · `core.licensor` — 26 rows
- `dflow.properties_and_characters` — 10,122 (500 style guides + 9,622 appearances)
- `dflow.property_character_associations` — 9,622 (this **is** the style-guide↔character bridge)
- `public.characters` — 9,622, **every row already carries `property_id`**
- `public.style_guide_files` — 279,783 · `public.asset_characters` — 117,012
- `dam.style_guide_file`, `dam.asset_character`, `dam.style_group`, `dam.asset` — all **0 rows**

**Deliverable for the licensing team:** a corrected 335-row review sheet at
`docs/verification/style-guide-property-mapping-20260726/style-guide-property-mapping.csv`, sent
2026-07-26, **not yet returned** and expected in 24–48 hours. It contains 29 settled rows and
306 rows marked `NEEDS_REVIEW`. Regenerate with
`node tools/generate-style-guide-property-mapping.mjs` — no database or network needed.

## 7. Constraints and gotchas recorded nowhere else

The plan doc §0/§8 and `AGENTS.md` carry the standing rules. These are the traps a newcomer would
otherwise rediscover the hard way — each cost real time this session:

- **`psql` is NOT installed** on the Windows dev machines. Use the Supabase MCP, or Node + the `pg`
  package against the pooler. Do not design a workflow around `psql`.
- **SSH does not work from the PowerShell tool** — that sandbox cannot capture SSH output (ConPTY
  exit 255). Use the **Bash** tool (Git's ssh): `ssh edge1 '…'` works there.
- **Never route the 1Password `op_run` tool through `bash` on Windows** — a bare `bash` is WSL,
  which does not inherit the injected Windows environment, so secrets arrive empty and it looks
  like a broken tool. Use `shell: powershell` (`$env:VAR`), `cmd` (`%VAR%`), or `node`.
- **The Supabase MCP is pointed at PRODUCTION.** Every query this session ran was read-only by
  choice, not by protection. Anything that writes goes to preview via a migration
  (`AGENTS.md` §4 rule 2).
- **Large query results exceed the tool's token limit.** Splitting by bucket, or writing to a file
  and post-processing in Node, works; one 335-row multi-column select does not.
- **`HANDOFF.md` is a shared multi-workstream file** currently owned in priority by the ColdLion
  Phase 6 effort. Add your own `## Active workstream — …` section; never overwrite it.
- **A concurrent Codex session is active in this repo.** Check `git status` and `gh pr list` before
  committing so you never sweep in its uncommitted work.

## 8. Access and environment

| What | Status | Where |
|---|---|---|
| **Supabase MCP** | authenticated, **pointed at production** `qsllyeztdwjgirsysgai` | preview is `rjyboqwcdzcocqgmsyel` ("shared-db-schema-rehearsal") |
| **`gh` CLI** | authenticated as `u2giants` | used for all PRs above |
| **SSH to the style-guide NAS** | works via the **Bash** tool: `ssh edge1` | tree at `/volume1/styleguides` |
| **Coldlion ERP API** | works | `http://x5.coldlion.com/EhpApi`, header `X-API-Key`; key at `op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential` |
| **Supabase CLI / DB passwords** | per `AGENTS.md` §9 runbook | 1Password vault **`vibe_coding`** |
| **Grok CLI** | installed; used for one independent read-only review | `grok --single … --allow Read --allow Grep --deny Edit --deny Bash` |

**Secrets:** all in the 1Password vault **`vibe_coding`**. Never paste values into files, docs or
commits. Git author for commits: `Albert Hazan <u2giants@users.noreply.github.com>` (other
addresses fail GitHub's email-privacy check).

**Workflow for this repo:** branch + PR, and **the AI merges it itself** once the `AGENTS.md` §5
checklist passes. Not main-only.

## 9. Open questions and risks

**Phase 0 decision (approved 2026-07-26):** use the hybrid source. Accept the 367 DAM
appearances whose 21 parents directly agree with a canonical property, apply the five settled
Classics → `CP` and three settled no-code rules, and use the corrected 335-row sheet as the
single decision list. The remaining 306 rows need licensing-team review.

Phase 1 proved that wholesale DAM promotion is unsafe: 9,255 of 9,622 appearances sit under
licensing/style-guide catalogue parents that do not directly exist in `core.property`.
Evidence is in
[`docs/verification/characters-property-reconcile-20260726/`](docs/verification/characters-property-reconcile-20260726/README.md).

**Decisions already made — do not silently reverse:**

| Date | Decision |
|---|---|
| 2026-07-23 | `core.character.property_id` stays a **single** FK. Ownership is linear; multiplicity goes in the new `core.style_guide_character` bridge. |
| 2026-07-24 | The canonical property list **mirrors Coldlion** (what POP produces / holds a code for), not everything licensed. Disney Classics fold into the existing `CP` = "CLASSIC PROPERTIES". Titles with no code (Luca, Kim Possible, Inside Out) get **no** property; **no placeholder is invented**. |
| 2026-07-26 | Character identities and style-guide **names/associations** are shared (`core.*`). Style-guide **files** are PopDAM/PopSG-only (`dam.style_guide_file`). |

**Risks, highest first:**

1. **Character identity resolution (Phase 3).** The 9,622 rows are *appearances*; collapsing them
   to true identities is the most likely place to get this wrong. Names carry qualifiers
   (`ROBIN AKA DICK GRAYSON`). Distinct normalized names cap at 8,307 — an upper bound, not the
   answer. Needs an explicit written rule and probably a human pass.
2. **Royalty sentinels leaking in.** `NO REPORTABLE ELEMENTS` (154 style guides),
   `NO CHARACTER LIKENESS` (15), `LOGO` (13) are reporting placeholders, not characters. Loading
   them is hard to unpick later.
3. **Breaking DAM by moving tables (Phase 4).** DAM reads `public.*` today. **Copy → repoint →
   retire.** Moving first broke dflow's sample tracking on 2026-07-21 and had to be reverted.
4. **Colliding with the ColdLion cutover.** Its 14-day gate was retired on 2026-07-26, but Phase 7
   remains unauthorized and production untouched. Our Phase 5 must not land in the actual approved
   ColdLion production window. **Re-read their status header before scheduling.**
5. **The licensing team's sheet is pending.** It is expected in 24–48 hours. Phase 3 cannot
   complete without those family/bucket decisions.
6. **The old 174-row sheet was incomplete when combined with the 367 path.** Grok found that
   the two numbers came from different matching tracks. The corrected 335-row sheet removes
   that gap and returns unapproved Classics/no-code guesses to review.

**Unanswered, non-blocking:** does Coldlion expose the talent-likeness flag on any endpoint? The
owner confirms Coldlion captures it and reports royalties against it, but it is absent from
`/merchGroupDetails`. Needs an endpoint sweep before any royalty work (model doc §7 question 1).

---

## Self-audit (2026-07-26)

Graded against the handoff standard's checklist. All 9 sections present — 1, 2, 3, 7, 8, 9 written
here; 4, 5, 6 deliberately delegated to the merged plan and model docs and mapped in the table at
the top rather than duplicated (two copies would drift, and the merged versions are what a future
session will find).

1. *Could a brand-new developer with no project knowledge pick this up without asking a question?*
   **Yes.** §1 defines the business, the apps and the schemas; §8 gives every access path; §3 gives
   exact live row counts and merge SHAs; the plan doc's Phases 0–7 give ordered steps with exit
   gates. Phase 0 is recorded as approved, Phase 1 evidence is linked, and the next input is the
   licensing team's completed sheet.
2. *Could they continue as effectively as this session could right now?* **Yes.** The non-obvious
   knowledge is written down: the naming trap (§2), the two axes and the three corrections (model
   doc §1/§6), the eight approaches that failed (plan §10), the environment traps that each cost
   real time (§7), and the two reuse opportunities that could remove work entirely (plan §2).
3. *Is every relevant detail included — background, goals, state, failures, decisions, constraints,
   risks, next actions, verification?* **Yes.** Decisions are dated in §9 so a later session cannot
   unknowingly reverse them; risks are ranked with mitigations; every phase carries a
   "you'll know it worked when" exit criterion and the reciprocal instruction to re-read downstream
   phases and report drift.

**Two gaps found and fixed during the audit:** (a) the first draft had no consolidated
access/environment section — the SSH and `op_run` traps existed only in session context and would
have been lost; now §7 and §8. (b) The draft was going to be written to `HANDOFF.md`, which is the
ColdLion workstream's live 121 KB file — that would have destroyed an active handoff. Corrected to
this per-topic file plus an additive pointer section.
