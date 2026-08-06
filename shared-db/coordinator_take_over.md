# Coordinator take-over — handover from the characters/ColdLion session

**Written:** 2026-07-31
**From:** a single Claude Code session working in `C:\repos\shared-db` on 2026-07-27 → 2026-07-31
**To:** the coordinating Claude session that owns collision control across shared-db workflows
**Repo:** `u2giants/shared-db` · **branch:** `main` · **head at handover:** `75066fe`
**Last refreshed:** 2026-07-31 (end-of-session docs pass — §3.2 blocker cleared, §4.3 sheet sent)
**Preview DB:** `rjyboqwcdzcocqgmsyel` · **Production DB:** `qsllyeztdwjgirsysgai`

> **Read this first if you know nothing about any of it.** This document assumes zero
> knowledge of the work, the chat it came from, or what was already tried and failed.
> Every claim below is labelled **verified** (I ran it and saw the result) or **documented**
> (a repo file says so and I did not re-prove it).

---

## 0. The one-paragraph summary

Four separate threads of work ran in one session. Two are finished and merged. One is half
finished and waiting on an outside person (licensing). The fourth was blocked by another team's
unmerged pull request — **that blocker cleared on 2026-07-31 when PR #331 merged**, so schema
testing across the repo is unfrozen again.

Nothing in my work has written a single row to any production database, and the only thing
written to preview is one schema-only migration that created two **empty** tables.

**The one live risk to manage:** workflow 1's Phase 3 is the only piece that will write data into
shared tables, and it is not started. Schedule it; do not let it start opportunistically.

---

## 1. The four workflows, at a glance

| # | Workflow | State | Blocked by | Touches shared tables? |
|---|---|---|---|---|
| 1 | Characters & style guides — Phase 3 | Rules built and tested, **backfill not started** | ~~Laura's round-2 answers~~ + a scheduling slot — **UPDATED 2026-08-06: licensing is DONE. Now blocked on ALBERT** (the `EX`/`LB`/`JL` property-code policy decision) and a scheduling slot. | **YES — will write 3 tables** |
| 2 | ColdLion as source of truth | PR #331 **merged 2026-07-31**; PR #335 (docs) still open | Owner approval for the production window | Yes, later |
| 3 | Licensing coordination (Laura) | ~~Round 2 **sent 2026-07-31**~~ **✅ CLOSED 2026-08-06 — round 3 returned 8/8. No round 4.** | ~~Laura's reply~~ **NOTHING. Do not record this as waiting on Laura again.** | No |
| 4 | Shared-db hygiene / silent failures | Two fixes merged, findings open | Nothing | No |

**If your four workflows are split differently, map by topic, not by number.** The important
boundary is workflow 1 — it is the only one of mine that will write data into shared tables.

---

## 2. WORKFLOW 1 — Characters & style guides (Phase 3)

### 2.1 What this work is

Characters and style guides live in three disconnected legacy places and in **no** canonical
table. The plan (`fix_characters_style_guides.md`) lands them properly in `core.character`,
`core.style_guide` and `core.style_guide_character`.

The single trap that has caused three modelling errors already: the licensing table
`dflow.properties_and_characters` is **misleadingly named**. Its `type='PROPERTY'` rows are
**style guides**, not properties. Its `type='CHARACTER'` rows are character **appearances**
(one per style guide), not distinct characters. Ownership is linear
(`licensor → property → character`, one property per character); style is many-to-many.
A style guide is **NOT** a level between property and character.

**Do not touch this workflow without reading `docs/style-guides-characters-and-royalties.md`
end to end.** That is the model. The plan file is only the sequence.

### 2.2 What is DONE

- **Phase 0, 1** — complete before this session.
- **Phase 2 — COMPLETE (this session).** Migration
  `supabase/migrations/20260727230000_core_style_guide_axis.sql` created `core.style_guide`
  and `core.style_guide_character`. Merged in PR #284.
  - **Verified:** applied to **preview only**; both tables exist and hold **0 rows**; RLS on
    with `shared_read`/`admin_write`; `select` to `authenticated` and full to `service_role`;
    all FKs, the `style_guide_not_own_parent` check, six indexes and the `set_updated_at`
    trigger present.
  - **Verified: production is untouched.** Both `to_regclass` lookups return null and version
    `20260727230000` is absent from the production ledger.
  - Deliberate design choices — **do not "fix" these**: no likeness column (likeness belongs on
    the app-owned `dam.style_guide_file`); `property_id` is nullable (titles like Luca, Kim
    Possible and Inside Out have no ColdLion code and no placeholder property may be invented);
    sub-style guides are a self-reference, not a level between property and character.
- **Phase 3 identity rules — BUILT AND TESTED, NOT RUN.** PRs #298, #299, #321 merged.
  - `tools/resolve-character-identity.mjs` + `tools/resolve-character-identity.test.mjs`
    (**verified: 32 tests pass**).
  - `tools/analyze-character-identity-resolution.mjs`.
  - Evidence at `docs/verification/character-identity-rules-20260728/`.

### 2.3 The numbers (verified against preview)

- 9,622 character appearances → **6,538 canonical characters**.
- 8,878 auto-resolved · 590 excluded · **154 pending a human decision**.
- Property tie-breaks needing a human: **36 characters** (98 appearances).
- Batman resolves to **1** character, code `BM`, **17** style guides — *not* the 15 the plan
  originally predicted. The owner accepted 17.

### 2.4 Owner decisions already made — treat as settled

- **`MU` → `MV`.** Licensing answered `MU` for the "Marvel Universe" style guide. `MU` is
  **MUPPETS** (Disney); `MV` is Marvel Assorted Styles. Owner confirmed it was a typo on
  2026-07-29. Recorded in
  `docs/verification/character-identity-rules-20260728/authorized-licensing-corrections.csv`.
  The original licensing evidence file was deliberately **not** overwritten.
- **Likeness does not split a character.** Owner, 2026-07-29: *"with likeness we still use code
  BM. We don't separate the movies from comics when it comes to MG06. But we do add the fact
  that it's movie to the description."* So the actor/movie qualifier is stripped for identity
  and preserved as rendition detail on the bridge row's `metadata`.

### 2.5 THE CRITICAL THING BEFORE PHASE 3 RUNS

**Phase 3 writes rows into three shared tables.** It must be scheduled by you, not started
opportunistically. Order is fixed: **style guides → characters → bridge**.

Requirements the plan sets, all of which must be recorded:

- Provenance into `core.taxonomy_source_ref` using **NEW `source_table` values**. The unique key
  is `(source_system, source_table, source_id)`. Values already in use are
  `coldlion`/`merchGroupDetails` and `designflow_plm`/`merchGroup` — **never reuse `merchGroup`**,
  a reused triple collides silently.
- Exclude the royalty sentinels: `NO REPORTABLE ELEMENTS` (154), `NO CHARACTER LIKENESS` (15),
  `LOGO` (13). They are reporting placeholders, not characters.
- Reconciliation checks that must all pass and be recorded: counts in vs out with every
  exclusion explained by number; zero duplicate bridge rows; zero **dangling** `property_id`;
  zero orphan bridge rows; **idempotency — running twice changes nothing the second time**;
  sentinels absent from `core.character`; Batman = 1 character, 17 bridge rows.

> **A plan check was corrected.** The original exit criterion "zero characters with a missing
> `property_id`" was **impossible** — 1,302 characters legitimately have none under the
> `NEVER_DESIGNED` rule. Corrected to "dangling" in PR #299. Do not reinstate the old wording.

### 2.6 What is still blocking Phase 3

1. ~~Laura's round-2 answers (workflow 3).~~ **✅ NO LONGER BLOCKING — CLOSED 2026-08-06.** Round 2
   returned 2026-08-04 (157/166) and round 3 returned 2026-08-06 (8 of 8, zero blanks). **The
   licensing question stream is CLOSED; there is no round 4.** Replaced by: **the `EX`/`LB`/`JL`
   canonical property-code policy decision — an OWNER decision for Albert**, not a licensing one
   (§3.3, and `fix_characters_style_guides.md` §8a).
2. A scheduling slot from you.
3. **Not** ColdLion — an earlier claim that Phase 3 carried a `core.property` identity exposure
   was withdrawn in PR #297 as overstated.

---

## 3. WORKFLOW 2 — ColdLion as the source of truth

### 3.1 The goal

Make the ColdLion ERP APIs the single source of truth for every `core.*` table fed by ColdLion:
Properties, Licensors, Vendors, Customers, and all merch groups.

Full written plan: **PR #335** (`docs/coldlion-source-of-truth-plan.md`) — **open, not merged.**
Merge or reject it; it is documentation only.

### 3.2 ~~THE BIGGEST BLOCKER IN THIS ENTIRE HANDOVER~~ — ✅ RESOLVED 2026-07-31

> **This blocker is CLEARED. Do not act on it.** PR #331 was **merged 2026-07-31 13:59** by
> another session, which also landed a follow-up fix (#344). The repo-wide dry-run freeze
> described below is over. The section is kept because the *pattern* recurs constantly in this
> repo and the response rule below is the thing to remember — not because the PR is still open.

**PR #331** — `feat(coldlion): build and preview-prove the real recurring production
Licensor/Property feed (Step 7A)`.

- **Was verified on 2026-07-31 (historical):** open, `MERGEABLE`, `CLEAN`.
- **Was verified (historical):** preview's migration ledger held **exactly four** versions absent
  from `main`, all four belonging to this PR:
  - `20260729230000_coldlion_licensor_property_recurring_promotion`
  - `20260729234500_coldlion_recurring_promotion_collision_rule_fix`
  - `20260729235500_coldlion_recurring_promotion_ambiguous_column_fix`
  - `20260730000500_coldlion_recurring_promotion_absence_detection_fix`

**The consequence, which is the durable lesson:** while migrations are applied to preview from a
branch that has not landed in `main`, **no session in any workstream can run
`supabase db push --dry-run` against preview.** It aborts with *"Remote migration versions not
found in local migrations directory."* That is a repo-wide freeze on schema testing, not a
problem for the owning workstream alone. **This happened three separate times in four days.**

> **NEVER run the repair command the CLI suggests** (`supabase migration repair --status
> reverted …`). It deletes another team's ledger rows while their objects stay in the database,
> so their next push collides. The correct fix is to land the branch. See AGENTS.md §4 rule 1
> and `docs/ai-session-instructions/shared-supabase-branch-workflow.md`.

**The standing rule for the coordinator:** a branch that has rehearsed migrations on preview must
open its PR and land it **the same session**. Anything left rehearsed-but-unmerged overnight
blocks everyone.

### 3.3 The "542 approved mappings" gate — what it actually means

- A frozen artifact the owner hand-approved on **2026-07-25**:
  `docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json`.
- 542 mappings (38 licensor + 504 property) resolving to **271 distinct canonical UUIDs**.
- Pinned by hash `1230f5a12d0f2a3029f1d3df17fc5b5f`. The runner recomputes the hash and refuses
  to proceed on mismatch; the database pins the same set independently. Two locks.
- Mode `link_approved` **links** ColdLion rows to canonical rows that already exist. A separate
  mode, `promote_source_owned`, can create source-owned rows (**verified**:
  `plm.promote_coldlion_source_owned` and `public.promote_coldlion_source_owned` both exist;
  ten successful runs, last 2026-07-30).

**Why 66 ColdLion property codes have no `core.property` row (verified count):** it is
**policy, not a bug**. ColdLion has **no expiry flag**, so it still returns lapsed licences
(NASA, ZAG, Frida Kahlo among them). Approving the unmatched codes wholesale would resurrect
dead licences into master data. Widening the approved set is a deliberate owner decision.

### 3.4 Where each entity actually stands (verified 2026-07-31)

| Entity | Target | Rows in core | Last successful sync | Runner exists? |
|---|---|---:|---|---|
| Licensors | `core.licensor` | 26 | **2026-07-31 06:43** | yes |
| Properties | `core.property` | 256 (ColdLion has ~322 codes) | **2026-07-31 06:43** | yes |
| Vendors | `core.factory` | 93 | 2026-07-22 | yes (`tools/sync-coldlion-vendors.mjs`) |
| Customers | `core.customer` | 864 | 2026-07-17 | **NO — see below** |
| Merch groups | `core.merch_group` | **0** | never | no |

- **Customers has no runner and never did.** The three historical `coldlion_customers_api` runs
  were produced by hand-feeding a JSON payload to the SQL function
  `plm.import_coldlion_customers(jsonb)` (**verified: the function exists**). Vendors got a
  proper runner; customers never did.
- **`core.merch_group` holds zero rows** and nothing has ever populated it.

### 3.5 Merch group types — what nobody has looked at

ColdLion `/merchGroupHeaders` exposes numbered types whose meaning **varies by division**.
On the licensed divisions CW001/SP001: 01 Type, 02 Sub-Type, 03 Sub-Sub-Type, 04 Size,
**05 Licensor**, **06 Property**, **07 Style Guide**, 08 Art Source, 09 Artist, 10 Demographic.
On EH001, 05 is "Big Theme" and 06 "Little Theme". On EP001, 05 is "Product Line", 06 "Product
Type", 07 "Character".

**Only 05/06 on CW001/SP001 are synced anywhere.** Everything else reaches no table.

> **Type 07 "Style Guide" is a trap.** The label says Style Guide, but **verified** contents on
> CW001 are product types — Calendar, Clock, Mug, Storage Cube, Garden Décor — and **zero are
> active**. SP001 has **no type-07 rows at all**. So the style-guide level was defined in
> ColdLion and never populated. There is **no data conflict** with `core.style_guide` (workflow
> 1), but there is a real **naming and authority** conflict, and neither document warns about
> the other. Decide which system owns "style guide" before either grows.

Codes also exist for types 11–18 and oddities 105/109. All inactive. Nobody knows what they were.

---

## 4. WORKFLOW 3 — Licensing coordination (Laura)

Laura is the licensing coordinator. She is **not** technical and does not read our documents.

### 4.1 Round 1 — sent, answered, partly usable

- Sheet: `docs/verification/character-identity-rules-20260728/licensing-questions-for-laura-20260729.csv`
  (PR #323, merged). Generator: `tools/build-licensing-questions-csv.mjs`.
- 195 questions: 5 bad MG06 codes · 154 rows naming several characters · 36 characters under
  two or more codes.
- She returned **194 of 195 answered** (owner supplied the file as
  `licensing-questions-for-laura-20260729.xlsx`).

### 4.2 What round 1 actually resolved — **verified by validating every answer against the DB**

**Resolved (29 rows, removed from round 2):**
- 25 of 36 character conflicts: clean, single, valid codes.
- Black Adam and Big Hero 6: answered `NONE`, settled as drops.
- Lost Boys (`LB`) and The Exorcist (`EX`): **her answers were correct.** Verified in the
  ColdLion feed — `EX` = THE EXORCIST and `LB` = THE LOST BOYS, both parented to `WB`
  (Warner Bros). **The gap is on our side**: neither code has a `core.property` row, so they
  would create dangling links. **This is our fix, not a licensing question.**

**NOT resolved (166 rows):**
- **All 154 "several characters" rows.** I asked *"is this real characters or a label — DROP,
  or list the names."* She answered with **MG06 property codes** (`TS` 27, `LT` 13, `CR` 7,
  `HSM` 7, `MM` 4) or `NONE` (95). Property codes answer a different question, and `NONE` is
  ambiguous between "drop the row" and "no property code". **This was my sheet's fault** — the
  answer column asked for names in a sheet where every other row wanted a code.
- 8 Deadpool/X-Men characters answered `DP, XM` — two codes where exactly one is allowed.
- `C004` Blade left blank.
- `C006` answered with a sentence naming three characters instead of one code.
- `C033` Maxwell Lord answered `JL` — not among the offered options and **verified absent** from
  `core.property`.
- `A005` Coco confirmed as `CC` again; `CC` sits under a licensor literally named
  "DTR - NO LICENSE" while the guide is Disney.
  > **UPDATED 2026-08-06.** Laura re-confirmed `CC` in round 3, and **Albert has ruled: Coco IS a
  > Disney license.** The licensing side is settled. ⚠️ **This is NOT a "re-parent `CC` to Disney"
  > job** — property codes are **not globally unique** (`core.property` is keyed
  > `(licensor_id, code)`), so the same code can exist under many licensors and a bare `CC` does
  > not identify one row. What remains is an **open question** — which `CC` row the guide should
  > point at — filed in `COORDINATOR_INTAKE.md`. Do not implement it as a re-parenting change.

### 4.3 Round 2 — ~~SENT 2026-07-31, awaiting reply~~ **RETURNED 2026-08-04 → ROUND 3 RETURNED 2026-08-06 → STREAM CLOSED**

> **✅ SUPERSEDED 2026-08-06. Nothing below is "awaiting reply".** Round 2 came back
> **2026-08-04 with 157 of 166 answered and zero format failures** — the locked-dropdown design
> worked. Nine blanks; eight were re-asked as **round 3**, which returned **2026-08-06 with 8 of 8
> answered, zero blanks, and zero uses of the escape option.**
> **THE LICENSING QUESTION STREAM IS CLOSED. THERE IS NO ROUND 4.** No session should record this
> workstream as waiting on Laura again. The eight settled rulings, plus the two owner rulings of
> 2026-08-06, are in `fix_characters_style_guides.md` §§ *"Licensing round 3 — RETURNED"* and
> *"8-OWNER"*. The text below is kept for its design/lineage detail only.

`docs/verification/character-identity-rules-20260728/licensing-questions-for-laura-round2-20260731.xlsx`

- **166 rows** — only what is still open. 29 resolved rows removed.
- Two sheets: *How to fill this in* (plain-English legend, worked example) and *Open questions*.
- **Every answer cell is a locked dropdown** (**verified: 166 data validations**), so a free-text
  answer in the wrong format is not possible:
  - 154 × `NOT CHARACTERS - DROP THE ROW` / `REAL CHARACTERS - I LISTED THEM`
  - the character-conflict rows carry only their own valid codes plus `NONE`
- Columns include *what you answered last time* and *why I am asking again*, so she can see
  exactly what went wrong per row without being blamed for it.

**Sent by the owner on 2026-07-31.** No session ever contacts Laura directly.

**When it comes back, re-validate every answer against `core.property` on preview before
accepting any of it.** Round 1 arrived looking 194/195 complete and was only 29 usable.
Use `tools/validate-licensing-answers.mjs` (7 unit tests) — it reports blanks, multi-code
answers, answers outside the offered options, and codes absent from `core.property`, and exits
non-zero if any are found. The sheet generator is `tools/build-licensing-questions-round2.py`.

---

## 5. WORKFLOW 4 — Shared-db hygiene and silent failures

### 5.1 Fixed and merged

- **PR #334 — the ColdLion vendor sync silently did nothing on Windows.**
  `tools/sync-coldlion-vendors.mjs` hand-built its entry guard as
  `` import.meta.url === `file://${process.argv[1].replace(/\\/g,"/")}` ``. On Windows
  `import.meta.url` is `file:///C:/…` (three slashes) and the hand-built string is `file://C:/…`
  (two), so the guard was **always false**: the runner **exited 0 having done nothing** — no
  output, no error, no `ingest.sync_run` row. It read as success.
  **Verified before the fix:** exit 0, empty stdout. **After:** it runs and fails loudly.
  Swept `tools/` — every other file already used `pathToFileURL`; this was the only offender.

### 5.2 Resolved by another session while I worked

- A **duplicate migration timestamp** `20260728160000` was shared by
  `clickup_incremental_task_import` and `popdam_user_tables_foreign_keys`. **Verified at the
  time:** both preview *and* **production** recorded the version as the PopDAM one and had zero
  ClickUp tables — the ClickUp migration had been **silently skipped on production**. Another
  session fixed it in PR #322 by reissuing under later timestamps. **Verified now: no duplicate
  timestamps remain.**

### 5.3 Open findings, nobody assigned

- **66 ColdLion property codes have no `core.property` row**, 51 of them active. Policy, not a
  bug (§3.3) — but it is why `EX` and `LB` cannot be used.
- **Documentation is stale in both directions.** The accelerated plan's STATUS table and
  `HANDOFF.md` both still say Step 7A is not started; it is nearly done. `core.factory` is 93,
  documented as 529. ColdLion properties are ~285/division, documented as 258.
- Six untracked `.ai/*.txt` review logs sit in the repo root, unversioned.

---

## 6. What was tried that did NOT work — do not repeat these

1. **Merging with a stale view of `main`.** Twice I built on a `main` that was hours old and hit
   conflicts. `main` moves several times a day here. **Always `git fetch origin main` and rebase
   immediately before a dry-run, a PR, or a merge.**
2. **Trusting the CLI's repair suggestion.** When a preview dry-run failed naming three ColdLion
   versions, the CLI suggested `supabase migration repair --status reverted`. Running it would
   have deleted another team's applied ledger rows. I did not run it; the versions landed in
   `main` shortly after and a rebase cleared it.
3. **`--include-all` on preview without checking first.** It was ultimately safe **only because**
   I listed the pending set and confirmed it was exactly three already-merged migrations plus my
   own, with nothing on preview missing from the branch. **This flag stays forbidden for
   production** (AGENTS.md §5.1).
4. **`NODE_PATH` for the sync tools.** `tools/sync-coldlion-vendors.mjs` documents installing
   `pg` into a scratch dir and pointing `NODE_PATH` at it. **That does not work** — `NODE_PATH`
   is CommonJS-only and `await import("pg")` resolves relative to the tool's own location. The
   vendor sync therefore still cannot run from this machine. Unfixed and flagged, not papered over.
5. **Assuming `source_character_id` solves character identity.** It looks like a stable ID but is
   **verified** near-unique per row: 9,386 distinct values for 9,622 appearances, max 2 uses each.
   Batman alone carries dozens. It is not a shortcut.
6. **Asking Laura for names in a code-shaped column.** See §4.2. Cost a full round trip.
7. **Letting a subagent settle a business rule.** A subagent decided unprompted that an actor's
   name does not split a character identity. It happened to match the owner's later ruling, but
   it was not its call. Route royalty-affecting rules to the owner.

---

## 7. Access and environment

- **`psql` is NOT installed** on this Windows machine. Use Node with `pg` from the scratch dir:
  `C:\Users\ahazan2\AppData\Local\Temp\claude\C--repos-shared-db\32ebafbd-d957-4225-8791-aeb0177d4cef\scratchpad`
  Connect with `ssl: { rejectUnauthorized: false }` and a `connectionTimeoutMillis`.
- **Secrets — references only, never values.** Use the `mcp__1password__op_run` tool with
  `argv: ["node","script.js"]` and `env: { … }`:
  - preview DB: `op://vibe_coding/qbvfk7umc3n75ejekd65zwd4ty/POSTGRES_URL`
  - ColdLion API key: `op://vibe_coding/zq6cjbz3ycj6psgkeae2devufm/credential`
  - Supabase PAT: `op://vibe_coding/3t2xoqk5luyz7ffgdhj24gvtpq/SUPABASE_ACCESS_TOKEN`
  - **Item titles with spaces cannot be used in an `op://` reference — use the item ID.**
  - **Serialize all 1Password calls. Never fan them out in parallel.**
  - **Never route `op_run` through bare `bash` on Windows** — that is WSL and it drops the
    injected environment. Use Node, cmd, or PowerShell.
- **The Supabase MCP in this session points at PRODUCTION**, not preview. Verified via
  `get_project_url`. It is read-only in practice but do not assume it is preview.
- Supabase CLI 2.105.0 is installed and matches CI.
- Applying to preview: `.github/workflows/shared-supabase-migrations.yml`
  (`gh workflow run … -f target=preview -f mode=dry-run|apply`). **Its apply step runs a plain
  `supabase db push` with no `--include-all`**, so it cannot apply migrations that sort before
  preview's head.

---

## 8. Exact next steps, in priority order

1. ~~**Merge PR #331.**~~ ✅ **DONE 2026-07-31 13:59** by another session, plus follow-up #344.
   Verified: no preview ledger versions are missing from `main`. **Do not redo.**
2. **Decide PR #335** (ColdLion source-of-truth plan, docs only). **Still OPEN.** Merge or reject.
   **Pass when:** the PR is closed one way or the other.
3. ~~**Owner sends the round-2 sheet to Laura.** ✅ **DONE 2026-07-31** — owner confirmed sent.
   Now simply **waiting on her reply**.~~ **✅ FULLY CLOSED 2026-08-06.** Round 2 returned
   2026-08-04 (**157/166**, zero format failures); round 3 (8 rows) returned **2026-08-06 with 8
   of 8 answered and zero blanks**. **The licensing question stream is CLOSED — there is no round
   4 and nothing is outstanding with Laura.** Settled rulings:
   `fix_characters_style_guides.md` § *"Licensing round 3 — RETURNED"*.
   ⚠️ **One acceptance step is still formally outstanding:** the answers have **not** been
   re-validated against `core.property` with `tools/validate-licensing-answers.mjs` (the recording
   session was forbidden database calls). Filed in `COORDINATOR_INTAKE.md`. Round 1 looked
   194/195 complete and was only 29 usable (§4.2) — do not skip it.
4. **Fix the 66 missing property codes** — specifically `EX`, `LB` and `JL`, which real answers
   now depend on. This is an owner policy decision, not a licensing one (§3.3).
   **Pass when:** the owner has either approved creating them or ruled them out in writing.
5. **Schedule Phase 3** once 3 and 4 land. **This is the write.** Enforce §2.5 in full.
   **Pass when:** every reconciliation check is green on preview and the evidence is written to
   `docs/verification/`, with production untouched.
6. **Do not start** the ColdLion production cutover (Step 8/9). It needs the owner's explicit
   production-window approval naming the project ref, migrations, schedules and rollback.

---

## 9. Self-audit

A developer who has never seen this repo can continue from here: every workflow states what it
is, what is done, what is verified versus documented, what blocks it, what was already tried and
failed, the exact next action, and the condition that proves each step worked. Every path, PR
number, table name, credential *reference*, row count and project ref needed to resume is named.
The one thing a newcomer cannot do is contact Laura or approve production — both belong to the
owner, and both are called out as such.
