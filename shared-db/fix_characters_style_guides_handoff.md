# HANDOFF — characters and style guides, canonical migration

**Written:** 2026-07-26 · **Updated:** 2026-07-28 · **Repo:** `u2giants/shared-db` ·
**Canonical branch:** `main` · **Next action:** obtain owner approval before rehearsing the
already-authored Phase 2 migration on preview. Licensing has no remaining review.

**No database change is confirmed from this workstream.** `core.character` is still **0 rows**.
The Phase 2 migration exists only on branch `codex/characters-style-guides-phase2-20260727`,
commit `e0657f7`; it has no PR and no recorded preview apply or verification.

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
| 4. What did NOT work | **here, §4**, plus [`fix_characters_style_guides.md`](fix_characters_style_guides.md) **§10** (12 items) and model doc **§6** |
| 5. Root causes and key findings | **here, §5**, plus model doc **§1, §4, §5A.0b** and plan doc **§2** |
| 6. Exact next steps | **here, §6**, then plan doc **Phases 2–7**, each with exit criteria |
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

**The completed investigation, licensing reconciliation, and rule corrections are merged to
`main`.** The Phase 2 draft is separately committed and pushed, but is not merged or approved.

| PR | Merge SHA | What it landed |
|---|---|---|
| [#197](https://github.com/u2giants/shared-db/pull/197) | `db97cd9` | The model: style guides, sub-style guides, talent-likeness royalty rules |
| [#203](https://github.com/u2giants/shared-db/pull/203) | `31e6583` | Correction: two axes (ownership linear, style many-to-many) |
| [#215](https://github.com/u2giants/shared-db/pull/215) | `f9c8758` | Classics → `CP` rule; property-scope decision |
| [#236](https://github.com/u2giants/shared-db/pull/236) | `5bd2f5f` | Shared vs app-owned split (names shared, files app-owned) |
| [#237](https://github.com/u2giants/shared-db/pull/237) | `1a9a4b1` | The phased plan + preserved review sheet and its regenerator |
| [#263](https://github.com/u2giants/shared-db/pull/263) | `add1f75` | Captured all 153 licensing answers and first `MULTIPLE` reconciliation |
| [#265](https://github.com/u2giants/shared-db/pull/265) | `fa7755a` | Replaced the 305-row follow-up with character/franchise rules |
| [#267](https://github.com/u2giants/shared-db/pull/267) | `89eec90` | Fixed Grok findings and completed the zero-row licensing result |

**Complete:** Phase 0 hybrid source decision and Phase 1 read-only property reconciliation.

**Authored but not approved or rehearsed:** Phase 2 migration
`supabase/migrations/20260727230000_core_style_guide_axis.sql` on
`codex/characters-style-guides-phase2-20260727`, commit `e0657f7`. It creates only
`core.style_guide` and `core.style_guide_character`. There is no PR and no evidence of a preview
dry-run or apply. Do not treat the file's existence as approval.

**Not started:** Phases 3–7.

**Live database facts, measured 2026-07-26 against production `qsllyeztdwjgirsysgai`:**

- `core.character` — **0 rows** (the canonical target; never populated)
- `core.style_guide`, `core.style_guide_character` — **do not exist yet** (Phase 2 creates them)
- `core.property` — 256 rows · `core.licensor` — 26 rows
- `dflow.properties_and_characters` — 10,122 (500 style guides + 9,622 appearances)
- `dflow.property_character_associations` — 9,622 (this **is** the style-guide↔character bridge)
- `public.characters` — 9,622, **every row already carries `property_id`**
- `public.style_guide_files` — 279,783 · `public.asset_characters` — 117,012
- `dam.style_guide_file`, `dam.asset_character`, `dam.style_group`, `dam.asset` — all **0 rows**

**Returned licensing review:** all 153 rows were answered on 2026-07-27. The normalized result,
raw returned file, and read-only `MULTIPLE` character reconciliation are under
`docs/verification/style-guide-licensing-review-20260727/`.

Results: 32 existing MG06 codes, 118 never designed, and three multiple. Of 338 character
appearances under the multiple style guides, 248 use specific existing franchise rules, 13 keep
one unique same-licensor historical match, 66 use `MV` Marvel Assorted Styles, nine
non-character labels are excluded, and two royalty sentinels are excluded. No licensing
follow-up remains.

## 4. Everything tried that did not work

The complete twelve-item record is `fix_characters_style_guides.md` §10, and the three original
model failures are `docs/style-guides-characters-and-royalties.md` §6. The failures that most
directly affect the next session are:

- Reading legacy `type='PROPERTY'` rows literally would create style guides as properties.
- Putting style guides between property and character would duplicate one character per guide.
- Combining the 367 direct appearances with the old 174-row sheet left coverage gaps.
- Sending every suggestion to licensing grew the sheet from 174 to 336 rows and wasted review time.
- Exact name history alone left 305 character rows, so specific franchise rules and safe existing
  catch-all properties replaced that path.
- The first franchise rules misclassified four full-name DC aliases and made six weak Marvel
  guesses; Grok found them, they were corrected, and Grok's focused re-review found no material issue.
- `grok models` was not a reliable authentication test; a short real headless task proved the CLI
  was authenticated.

## 5. Root causes and key findings

- The database holds two different axes: ownership is
  `Licensor → Property → Character`, while style is the many-to-many
  `Style guide ↔ Character` relationship.
- The 9,622 legacy character rows are appearances, not 9,622 distinct characters.
- A style guide is a catalogue/name record; its files and talent-likeness flag belong in DAM.
- `core.style_guide.property_id` must stay nullable for never-designed and mixed-character guides.
- `MULTIPLE` means resolve the property per character, not ask licensing to choose one guide-wide code.
- The final 338 mixed-guide appearances reconcile to 248 specific franchise mappings, 13 unique
  historical mappings, 66 safe `MV` mappings, nine non-character exclusions, and two sentinels.
- The unmerged Phase 2 migration is additive only and creates the two style-axis tables; it does
  not backfill characters, move DAM files, or authorize production.

## 6. Exact next steps

1. **Ask Albert for Phase 2 preview approval.** State that the migration already exists but has
   not been applied. Stop if approval is not explicit. **You will know this gate passed when the
   current chat contains a clear instruction to rehearse Phase 2 on preview.**
2. **Check for another schema change in flight.** Run `gh pr list`, inspect all shared-db
   worktrees/branches, and compare the persistent preview migration ledger with current
   `origin/main`. Never repair another branch's preview ledger rows. **You will know this worked
   when there is one coordinated schema change and the preview CLI can compare ledgers cleanly.**
3. **Fetch and re-confirm the Phase 2 draft against current `origin/main` in an isolated
   worktree.** Start from branch `codex/characters-style-guides-phase2-20260727`, commit
   `e0657f7`, which was one commit ahead and zero behind at closeout. Preserve only
   `supabase/migrations/20260727230000_core_style_guide_axis.sql`. If main moves or a timestamp
   collides, rebase and re-timestamp this unapplied file. **You will know this worked when the
   branch is current, clean, and the duplicate-timestamp check prints nothing.**
4. **Review and test the migration before writing to preview.** Run `scripts/check-sql.sh` and
   `supabase db push --dry-run` against preview `rjyboqwcdzcocqgmsyel`. Confirm the dry-run names
   only the two-table additive migration and no unrelated files. **You will know this worked when
   both checks pass and there are no drops, renames, or surprise migrations.**
5. **Apply Phase 2 to preview only after steps 1–4 pass.** Verify
   `core.style_guide` and `core.style_guide_character` exist, are empty, have the expected keys,
   indexes, grants, and row-access rules, and production `qsllyeztdwjgirsysgai` remains untouched.
   **You will know this worked when object-level queries prove both empty preview tables and no
   production ledger/object change exists.**
6. **Open and merge the shared-db PR only after the repository checklist passes.** Record the
   preview evidence under `docs/verification/`, update this handoff and the plan status, then
   merge the PR yourself. **You will know this worked when the PR is merged, checks are green,
   `origin/main` contains the migration and evidence, and no production apply occurred.**
7. **Start Phase 3 only in a new, focused session.** Re-read the plan, model, and current ColdLion
   status first. **You will know the handoff succeeded when the new session can state the identity
   rules, exclusions, row totals, and preview-only gate before writing a backfill.**

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
| **Grok CLI** | authenticated; final re-review found no material issues | `grok --single … --allow Read --allow Grep --deny Edit --deny Bash` |

**Secrets:** all in the 1Password vault **`vibe_coding`**. Never paste values into files, docs or
commits. Git author for commits: `Albert Hazan <u2giants@users.noreply.github.com>` (other
addresses fail GitHub's email-privacy check).

**Workflow for this repo:** branch + PR, and **the AI merges it itself** once the `AGENTS.md` §5
checklist passes. Not main-only.

## 9. Open questions and risks

**Phase 0 decision (approved 2026-07-26):** use the hybrid source. Accept the 367 DAM
appearances whose 21 parents directly agree with a canonical property, apply the five settled
Classics → `CP`, three settled no-code rules, and 153 clear existing MG06 name matches. The
remaining 153 uncertain rows were returned on 2026-07-27.

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

1. **The Phase 2 branch is unapproved.** At closeout remote commit `e0657f7` is one commit ahead
   and zero behind `origin/main`, but it has no PR or preview evidence. Do not apply it merely
   because it is current.
2. **Character identity resolution (Phase 3).** The 9,622 rows are *appearances*; collapsing them
   to true identities is the most likely place to get this wrong. Names carry qualifiers
   (`ROBIN AKA DICK GRAYSON`). Distinct normalized names cap at 8,307 — an upper bound, not the
   answer. Needs an explicit written rule and probably a human pass.
3. **Royalty sentinels leaking in.** `NO REPORTABLE ELEMENTS` (154 style guides),
   `NO CHARACTER LIKENESS` (15), `LOGO` (13) are reporting placeholders, not characters. Loading
   them is hard to unpick later.
4. **Breaking DAM by moving tables (Phase 4).** DAM reads `public.*` today. **Copy → repoint →
   retire.** Moving first broke dflow's sample tracking on 2026-07-21 and had to be reverted.
5. **Colliding with the ColdLion cutover.** Its 14-day gate was retired on 2026-07-26, but Phase 7
   remains unauthorized and production untouched. Our Phase 5 must not land in the actual approved
   ColdLion production window. **Re-read their status header before scheduling.**
6. **The first character-level pass overused licensing.** Name history alone left 305 rows.
   Specific franchise rules plus existing catch-all properties now leave zero licensing rows.
7. **The old 174-row sheet was incomplete when combined with the 367 path.** Grok found that
   the two numbers came from different matching tracks. The corrected 335-row sheet removes
   that gap and returns unapproved Classics/no-code guesses to review.

**Unanswered, non-blocking:** does Coldlion expose the talent-likeness flag on any endpoint? The
owner confirms Coldlion captures it and reports royalties against it, but it is absent from
`/merchGroupDetails`. Needs an endpoint sweep before any royalty work (model doc §7 question 1).

---

## Self-audit (2026-07-28)

Graded against `templates/system/handoff-standard.md`. All nine required subjects are present:
§1, §2, §3, §6, §7, §8, and §9 are here; failed approaches and root findings are mapped to the
plan/model documents in the table at the top and are not silently omitted.

1. **Could a street-new developer continue without asking a question? Yes.** §1 explains the
   business and every system; §3 records merged PRs, live row counts, the unmerged Phase 2 branch,
   commit, migration path, and missing evidence; §6 starts with the one approval only Albert can
   give and then provides ordered commands and gates.
2. **Could they continue as effectively as this session can now? Yes.** §2 explains the naming
   trap and why the original model was dangerous; §7 records the Windows, Supabase, concurrent
   session, and preview-ledger traps; §8 records authenticated tools and secret locations; §9
   preserves every owner decision and the final licensing counts.
3. **Did this include failed attempts and why? Yes.** The reading table routes to plan §10, now
   twelve failed approaches, and model §6, three modelling failures. §9 also preserves the failed
   174-row and 305-row review paths and why each was replaced.
4. **Is every next step concrete and verifiable? Yes.** §6 has seven numbered steps. Every step
   ends with an explicit “you will know” verification gate, including approval, collision check,
   rebase, preview dry-run, preview object proof, PR merge, and Phase 3 handoff.
5. **Are newcomer terms, identifiers, paths, and URLs explained? Yes.** §1 defines POP systems and
   schemas; §3 defines branch `codex/characters-style-guides-phase2-20260727`, commit `e0657f7`,
   and the migration path; §8 defines preview/production refs, tools, hosts, and 1Password location.

### Required final synthesis

1. **Is this handoff comprehensive enough that a brand-new developer with no knowledge of this
   project and no context about what we did or what remains could pick up where we left off and
   not skip a beat? Yes.** Supporting sections: §1–§3 for context/state, §6 for exact continuation,
   and §7–§9 for constraints, access, decisions, and risks. No gap remains.
2. **Is it detailed enough that they could continue as well as this session could right now, with
   all relevant background? Yes.** Supporting sections: §2 for the corrected model, §3 for exact
   Git/database state, §6 for execution gates, and the linked plan/model evidence. No gap remains.
3. **Is every relevant detail present for the implementing agent to execute flawlessly? Yes.**
   Background and outcome are in §1–§2; state and evidence in §3; failures and root causes in the
   mapped plan/model sections; next actions in §6; constraints/access/risks in §7–§9. No gap remains.

**Gaps found and fixed in this audit:** the previous handoff incorrectly said Phase 2 had not
started, omitted the draft branch/commit/migration path, gave no concrete method to re-confirm
the moving branch against current main, and described Grok authentication ambiguously. §3, §6,
§8, and §9 now close those gaps. The self-audit passes.
