# Making ColdLion the source of truth for the `core.*` master tables

**Written:** 2026-07-31
**Author:** AI research session (read-only). **No database write, no migration, no change to any
other file in this repo.**
**Scope:** Properties (`core.property`), Licensors (`core.licensor`), Vendors (`core.factory`),
Customers (`core.customer`), and **all** ColdLion merch-group types (`core.merch_group` and the
seven types nobody has touched yet).

**How to read the labels.** Every factual claim below is tagged either **[VERIFIED]** — I measured
it myself this session against the preview database `rjyboqwcdzcocqgmsyel`, the live ColdLion API,
or the repository — or **[DOC]** — it comes from a document in this repo and I did not re-measure
it. Production `qsllyeztdwjgirsysgai` was **not contacted at all**, not even for a count.

---

## 1. The short version

**Where we are.** ColdLion is already the boss of two things: customers and vendors. It is *not*
yet the boss of licensors, properties, or any other classification list. Those still come from
DesignFlow.

**The good news.** The work to switch licensors and properties over to ColdLion is essentially
**finished and tested**. It sits in one pull request, number 331, that is open, passing all its
checks, and waiting to be merged. Nobody has merged it because the person who built it stopped
at the agreed stopping point.

**The one thing in the way.** That same pull request has already been *rehearsed* on the practice
database. Because it was never merged, the practice database is now ahead of the main code. Until
PR 331 is merged, **no other database change in the whole company can be rehearsed safely**. It is
a traffic jam with one car in front.

**What is genuinely not built.** Nothing feeds the other ColdLion classification lists at all.
ColdLion publishes ten numbered lists per business unit — sizes, artists, art sources, demographics,
and more. We import exactly two of them (Licensor and Property) and only from the two licensed
divisions. The table meant to hold the rest, `core.merch_group`, exists and is **completely empty**.
Nobody has ever asked for those lists, so this is a gap, not a bug.

**Two things ColdLion simply cannot tell us, ever.** It does not know which property belongs to
which licensor, and it has no "this license expired" flag. Those two facts have to keep coming from
DesignFlow or become ours to maintain by hand. That is a permanent limit of the ERP, not a
temporary one.

**What you need to decide.** Three things, listed in section 6. The most urgent is simply: *may
the AI merge PR 331?* Everything else is stuck behind it.

---

## 2. Where each entity stands today

All counts **[VERIFIED]** on preview `rjyboqwcdzcocqgmsyel` and against the live ColdLion API on
2026-07-31.

| Entity | ColdLion endpoint | Target `core` table | ColdLion rows | `core` rows | Mirror table + rows | Last successful sync | Scheduled? | Source of truth today |
|---|---|---|---|---|---|---|---|---|
| **Customers** | `/customers` | `core.customer` | 836 | **864** | `plm.erp_customer` 836 | 2026-07-17 (3 runs ever, 0 failures) | **No — manual only** | ColdLion (one-off pulls) |
| **Vendors** | `/vendors` | `core.factory` | 97 | **93** | `plm.erp_vendor` 97 | 2026-07-22 (7 runs) | **No — manual only** | ColdLion (one-off pulls) |
| **Licensors** | `/merchGroupDetails` type `05`, div CW001+SP001 | `core.licensor` | 22 per division = 44 rows, **22 distinct codes** | **26** | `plm.erp_licensor` 44 | 2026-07-31 06:43 (preview lane, 13 ok / 1 failed) | Preview only, guarded | **DesignFlow** in production |
| **Properties** | `/merchGroupDetails` type `06`, div CW001+SP001 | `core.property` | 285 per division = 570 rows, **285 distinct codes** | **256** | `plm.erp_property` 570 | 2026-07-31 06:43 (same lane) | Preview only, guarded | **DesignFlow** in production |
| **All other merch groups** (types 01–04, 07–10) | `/merchGroupDetails` | `core.merch_group` | see §5 | **0** | none | **never** | no | **nothing — not synced anywhere** |

Supporting counts **[VERIFIED]**:

- `core.taxonomy_source_ref`: `designflow_plm` = 37 licensor + 468 property refs;
  `coldlion` = 38 licensor + 504 property refs, resolving to 19 and 252 distinct canonical rows.
  Both sets coexist on preview. That is the parallel-run design working.
- `plm.merch_group_header` holds all 37 header rows for all four divisions (CW001, SP001, EH001,
  EP001), so the "what does type 05 mean here" dictionary **is** already imported correctly.
- **ColdLion property codes with no matching `core.property.code`: 33.** Licensor codes with no
  match: 3.

> **The brief I was given said ~322 distinct property codes and ~66 missing. [VERIFIED] those
> numbers are now stale.** ColdLion currently returns 285 distinct property codes, and 33 of them
> have no `core.property` row keyed by that code. ColdLion grew from 258 to 285 properties since
> the 2026-07-19 measurement in `docs/merch-group-taxonomy-architecture.md`, and its artist list
> shrank from 68 to 53. Treat any count in a document older than a week as indicative only.
>
> A caveat that matters: matching by `code` alone is exactly the mistake the architecture doc warns
> against, because codes are only unique within `(division, type)`. The real figure needs the full
> four-part key. 33 is the right order of magnitude, not a certified number.

### Where the recurring feeds actually run

| Feed | Runs where | Cadence |
|---|---|---|
| DesignFlow PLM master data (licensor + property, today's production source) | `systemd` timer `plm-sync.timer` on host `hetz` | daily 03:30 **[VERIFIED]** in `systemd/plm-sync.timer` |
| ColdLion licensor/property **preview** lanes | GitHub Actions `coldlion-licensor-property-phase6-parallel.yml` | daily snapshot/compare + **hourly** health, gated on repo variable `PHASE6_SCHEDULE_ENABLED` **[VERIFIED]** |
| ColdLion licensor/property **production** lane | GitHub Actions `coldlion-licensor-property-production.yml` — **exists only on the unmerged PR 331 branch** | daily 06:00 snapshot / 06:30 promote / 07:00 compare / hourly :45 health, gated on `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` which **does not exist yet, by design [VERIFIED]** |
| ColdLion customers | **nowhere** | — |
| ColdLion vendors | **nowhere** | — |
| Any other merch-group type | **nowhere** | — |

**[VERIFIED] The accelerated plan's Step 7A claim that "a real recurring production feed does not
exist yet" is TRUE of what is merged on `main`, and OUT OF DATE as a description of the work.**
The workflow was written, tested and rehearsed; it is simply not merged. See §7, contradiction C1.

---

## 3. The 542-mapping gate, explained

> **Approved widening, 2026-08-25 (#1177).** The original 542-row decision remains the
> historical base described below. Albert later approved five exact ColdLion Property codes
> under Paramount on #539. The current fingerprinted gate is therefore **552 typed mappings**
> pointing to **276 distinct canonical UUIDs**: the original 542/271 plus ten CW001/SP001 rows
> for five new Properties. Current artifact:
> `docs/verification/coldlion-licensor-property-paramount-five-20260825/approved-mapping.json`,
> md5 `09e18e47d67181b06483d6cf4454e053`. No other exclusion was admitted.

### In plain English

Somebody had to decide, one row at a time, "this ColdLion licensor really is the same company as
this licensor already in our database." That decision cannot be automated safely, because ColdLion
reuses the same short code to mean different things — `FR` is a *property* in ColdLion meaning
"1ST ORDER TROOPER" and a *licensor* in our database meaning "FRIENDS TV". Get that wrong and the
taxonomy is silently corrupted for every app at once.

So Albert reviewed and approved a list of exactly **542 safe matches** on 2026-07-25: 38 licensor
matches and 504 property matches, pointing at 271 of our existing records. That approved list was
then frozen — written to a file with a fingerprint so it cannot drift — and every ColdLion run
since is only allowed to touch rows on that list.

**So the 33 unmatched property codes are policy, not a bug.** They are codes Albert did not
approve, because approving them would mean either (a) creating brand-new records in a table that
eleven other things point at, or (b) guessing at an identity match. The plan explicitly names
NASA, ZAG and FRIDA KAHLO as records deliberately left outside the approved set — those are lapsed
licenses ColdLion still returns because it has no expiry flag. Adding them automatically would
resurrect dead licenses across every app.

### The specifics **[DOC]**

The bullets below record the original Phase 4 package. The current widened fingerprint is in the
supersession note above; do not run readiness against the historical 542-row artifact.

- **The artifact:** `docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json`,
  md5 `1230f5a12d0f2a3029f1d3df17fc5b5f`.
- **Approved by:** Albert Hazan, 2026-07-25. The approval record is
  `fix_coldlion_licensor_property_phase4_handoff.md` §3.
- **Do not confuse it with** the Phase 3 placeholder at
  `.../phase3-20260725/phase4-approved-mapping.json`, whose hash `d41d8cd9…` is the md5 of the
  **empty set** with `approved_by: null`. That file froze the pre-approval state.
- **How it is enforced:** `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs`
  re-resolves all 542 rows by full typed identity `(company, division, mgTypeCode, mgCode)` to the
  exact expected UUIDs. Any missing, ambiguous, cross-typed or differing row blocks readiness.
  Row counts alone can never pass.
- **[VERIFIED] the arithmetic holds on preview today:** 38 coldlion licensor refs → 19 distinct
  canonical licensors; 504 coldlion property refs → 252 distinct canonical properties. 38+504 = 542;
  19+252 = 271. Exactly the documented figures.
- **[DOC]** the readiness evaluator reported `ready=true` on preview on 2026-07-27, with all eight
  difference buckets at zero.

### What it would take to widen the gate

Widening is a **business decision, not an engineering one**. For each of the 33 unmatched property
codes and 3 unmatched licensor codes someone must answer: is this a live license we are missing, a
dead license ColdLion never retired, or a duplicate under a different code? Only after that answer
does the engineering follow — either a new approved-mapping artifact with a new hash and a new
Albert approval, or a documented decision to leave them out permanently.

---

## 4. Merch group types: what is covered and what is not

ColdLion stores every classification list as a "merch group" — a flat code→name dictionary,
numbered `01`–`14`, **defined separately per business unit**. The number has no fixed meaning.
Type `05` is Licensor in the two licensed divisions and "Big Theme" / "Product Line" elsewhere. The
meaning must always be resolved through `(divisionCode, mgTypeCode) → mgTypeDesc`.

**[VERIFIED] live counts, 2026-07-31, licensed divisions only:**

| Type | Meaning in CW001 / SP001 | Rows per division | Where it lands today | Status |
|---|---|---|---|---|
| 01 | Type | not measured | nowhere | **not synced** |
| 02 | Sub-Type | not measured | nowhere | **not synced** |
| 03 | Sub-Sub-Type | not measured | nowhere | **not synced** |
| 04 | Size | not measured | nowhere | **not synced** |
| **05** | **Licensor** | **22** | `plm.erp_licensor` → `core.licensor` | **synced to preview**, guarded, production pending |
| **06** | **Property** | **285** | `plm.erp_property` → `core.property` | **synced to preview**, guarded, production pending |
| **07** | **Style Guide** | **0** | nowhere | **empty at source** — see below |
| 08 | Art Source | 3 | nowhere | **not synced** |
| 09 | Artist | 53 | nowhere | **not synced** |
| 10 | Demographic | 3 | nowhere | **not synced** |

Non-licensed divisions (EH001 Big Theme / Little Theme / Art Type, EP001 Product Line / Product
Type / Character) are **not synced at all** and are deliberately excluded — the runner fetches
their headers for the dictionary and the semantic-stability guard, but never treats their 05/06
slots as licensor/property **[VERIFIED** in `tools/sync-coldlion-licensors-properties.mjs` CONFIG**]**.

**[VERIFIED] `core.merch_group` exists, has columns `id, parent_id, code, name, level, metadata,
created_at, updated_at`, and holds ZERO rows.** It is referenced by
`core.item.merch_group_id`. It is a designed-but-unused home for exactly this data.

### What it would take to bring the rest in

The mechanical work is small and the pattern is already proven — `plm.erp_licensor` /
`plm.erp_property` are the template. The hard parts are decisions:

1. **Decide what each list is FOR.** Nothing in any app reads Art Source, Artist or Demographic
   from `core.*` today. Syncing a list nobody queries adds maintenance cost and zero value. Do not
   build these until an app asks.
2. **Decide the division question first.** `core.licensor` has `unique nulls not distinct (code)`,
   which deliberately collapses the division dimension. That is safe while only CW001/SP001 flow in.
   **It stops being safe the moment EH001 is imported**, because `05` there means Big Theme, and a
   Big Theme would collide with a licensor sharing a code **[DOC**, architecture doc §7**]**. Any
   plan for the other types must resolve this before writing a line of SQL.
3. **Decide `core.merch_group` vs. dedicated tables.** `core.merch_group` has `parent_id` and
   `level`, so it can hold the product-type chain (01→02→03) natively. Sizes, artists and
   demographics are flat and might belong in their own small tables. This is unresolved anywhere
   in the repo.
4. **Same two permanent gaps apply.** No parent links, no active flag. A flat list arriving from
   ColdLion carries no lifecycle information at all.

### The type-07 "Style Guide" conflict

**There is no data conflict today, but there is a naming and authority conflict that will bite.**

- **[VERIFIED]** ColdLion type `07` "Style Guide" returns **0 rows** in both CW001 and SP001 —
  confirmed live 2026-07-31, matching the 2026-07-19 measurement. ColdLion holds no style guides.
- **[VERIFIED]** `core.style_guide` and `core.style_guide_character` exist (migration
  `20260727230000_core_style_guide_axis.sql`) and hold **0 rows**.
- **[DOC]** the separate workstream in `fix_characters_style_guides.md` will populate
  `core.style_guide` from **`dflow.properties_and_characters`** — a legacy DesignFlow table whose
  `type='PROPERTY'` rows are actually style guides, plus a 9,622-row style-guide↔character bridge.
  Phases 0–2 are complete; Phase 3 populates the rows.

**The risk:** two different systems both use the words "style guide" for two different things. The
ColdLion merch-group type 07 is a *classification code slot on an item*. The `core.style_guide`
rows are *real style-guide documents with characters and royalty implications*. If a future session
sees ColdLion type 07 and decides "that is the style guide feed", it will either (a) write ERP
classification codes into `core.style_guide` and corrupt the character/royalty axis, or (b) treat
the empty ColdLion slot as evidence that the DesignFlow-sourced style guides are wrong.

**Recommended guard, not yet written anywhere:** state explicitly, in
`docs/merch-group-taxonomy-architecture.md` and in `fix_characters_style_guides.md`, that ColdLion
merch-group type 07 is **never** a source for `core.style_guide`, and that if ColdLion ever starts
returning type-07 rows they land in `core.merch_group` as classification codes only. Note also
`fix_characters_style_guides.md` already records a real dependency in the other direction: Phase 3
binds characters to properties, and ColdLion is re-sourcing those properties right now, so
character work must not race the ColdLion cutover.

---

## 5. The plan, in ordered steps

Steps 1–3 are the licensor/property cutover, and they are the only steps with an existing,
tested implementation. Steps 4 onward are new work that nothing in this repo has planned in detail.

| # | Step | What it proves | Who approves |
|---|---|---|---|
| **1** | **Merge PR 331.** CI is green and it is mergeable **[VERIFIED]**. It contains the production workflow, the guarded recurring promotion, the schedule map, the two-cycle rehearsal harness, four migrations and their tests. | That the recurring feed exists in `main` and the preview database stops being ahead of the code. **This unblocks every other schema change in the company.** | AI merges it per `AGENTS.md` §2 — but see §6 blocker B1, because the owner has not been asked. |
| **2** | **Step 8 — production approval request.** One request naming the exact project ref, the exact migration versions, the exact modes, the four cron strings, the `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` variable, and creation of the `SUPABASE_DB_PASSWORD_PRODUCTION` secret. | That the owner has authorized a *recurring* feed, not a one-time link. A general "go ahead" does not count **[DOC]**. | **Albert Hazan, explicitly, in chat.** |
| **3** | **Step 9 + 10 — execute and watch.** Bounded migration apply, read-only 552-row identity proof *before* any write, one mirror-only snapshot, approved promotion, then hourly health plus deliberate +1h / +4h / +24h checks. | That production licensor/property is fed by ColdLion and nothing broke. | Albert (step 2 covers it); AI executes in a fresh session. |
| **4** | **Give customers and vendors a real schedule.** Both are cut over in principle but run only when a human runs them (§2). Vendors already has a hardened runner (`tools/sync-coldlion-vendors.mjs`) with a short-pull guard, exclusion and quarantine tables. Customers has **no runner at all** (§7, C3). Add both to a recurring lane once step 1 has freed the schema slot. | That "cut over to ColdLion" means the data actually stays current, not that it was correct once in July. | Albert, for the production schedule + secrets. |
| **5** | **Decide whether any other merch-group type is wanted.** §4. Do not build first. | That we are not maintaining seven dictionaries nobody reads. | Albert — a business question. |
| **6** | **Resolve the 33 + 3 unmatched codes.** §3. | That the gap between ColdLion and `core` is a decision, not drift. | Albert, per code or per rule. |
| **7** | **Phase 8 (later, separate).** Retire DesignFlow as the corroborating source for parents and status, and decide who owns those two facts permanently. | Explicitly out of scope of the current plan **[DOC]**. | Albert, separately. |

**Preconditions that gate every step above** (recorded here only because they bind this work, not
because they are new): one schema change in flight at a time, and preview before production. Right
now PR 331 *is* the one schema change in flight, which is precisely why step 1 comes first.

---

## 6. Blockers and open decisions

| # | Blocker | Owner | What must be true to clear it |
|---|---|---|---|
| **B1** | **PR 331 is open, mergeable, CI-green, and already rehearsed on preview.** Until it merges, preview holds four migration versions that do not exist on `main`, so any `main`-based dry run against preview aborts. This is the single biggest blocker for the whole database, not just for ColdLion. | Albert to say "merge it"; AI does the merge. | An independent review with no Critical/High finding, per the plan's own Step 7A gate **[DOC]**. Whether that review happened is not recorded on the PR. |
| **B2** | **Production approval (Step 8) has not been requested or given.** Production remains read-only. | **Albert Hazan** | Step 1 done; then one exact approval request per §5 step 2. |
| **B3** | **`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` and `SUPABASE_DB_PASSWORD_PRODUCTION` do not exist.** Deliberate. Creating them is itself a named production action **[VERIFIED** in the workflow header**]**. | Albert | B2 cleared. |
| **B4** | **No recurring schedule for customers or vendors.** Data is as fresh as the last hand-run: 2026-07-17 and 2026-07-22. | Albert (schedule + secrets); AI builds. | B1 cleared so the schema slot is free. |
| **B5** | **No customer sync runner exists in this repo** (§7, C3). Re-pulling customers today means someone hand-feeding a JSON payload into a SQL function. | AI to build; Albert to approve running it. | A decision that customers should stay on ColdLion — which the scoreboard already says. |
| **B6** | **The division-collapse decision** blocks importing any type from EH001/EP001 (§4). | Albert, informed by engineering | Only relevant if step 5 says yes. |
| **B7** | **ColdLion cannot supply parents or lifecycle status — permanently.** Not a blocker to the cutover, but it means "ColdLion is the source of truth" will always be partial for licensor/property. | Albert | A decision on who owns those two facts after Phase 8. |

---

## 7. Contradictions and gaps found

**C1 — The plan and handoff both say Step 7A is "⬜ Open, blocked". It is built.**
`plan_coldlion_licensor_property_accelerated_cutover.md` STATUS row 7A and `HANDOFF.md` both say
Step 7A has not started and is blocked by PR #311. **[VERIFIED]** PR #311 merged on 2026-07-29
(commit `833f134`), and PR **#331** — "build and preview-prove the real recurring production
Licensor/Property feed (Step 7A)" — was opened 2026-07-30 with the production workflow, the
schedule map, the recurring promotion contract, four migrations, and six new test files, all CI
green. The status table is one step behind reality. A fresh session reading only the plan would
rebuild work that already exists.

**C2 — Preview is ahead of `main` by four unmerged migrations.**
**[VERIFIED]** preview's ledger contains `20260729230000`, `20260729234500`, `20260729235500` and
`20260730000500`, none of which exist in `supabase/migrations/`. All four belong to PR 331.
Preview also carries the functions `promote_coldlion_source_owned` and
`verify_coldlion_approved_mapping_identity`, and `ingest.sync_run` has ten successful runs of
`coldlion_licensors_properties_promote_source_owned` — a source name that **appears nowhere in the
merged repository [VERIFIED]**. This is exactly the failure mode `AGENTS.md` §4 rule 1 warns about.

**C3 — There is no ColdLion customer sync code, and there never was.**
The brief asked me to find it. **[VERIFIED] it does not exist and was not deleted.** I searched the
full git history across all branches for any `*coldlion-customer*` or `tools/*customer*` file: the
only matches are documentation. The `coldlion_customers_api` rows in `ingest.sync_run` are written
by the SQL function itself — `plm.import_coldlion_customers(jsonb)`, defined in
`supabase/migrations/20260715234500_erp_coldlion_customer_vendor_import.sql` line 137. Customers
were imported by a human pulling `/customers` and passing the JSON array straight into that
function. Three runs, all succeeded, last on 2026-07-17. **Vendors got a proper runner
(`tools/sync-coldlion-vendors.mjs`); customers never did.**

**C4 — "Cut over to ColdLion" is doing a lot of work in the scoreboard.**
`docs/master-data-cutover-scoreboard.md` marks Customer and Vendor as ✅ cut over. **[VERIFIED]**
neither has any recurring feed. The honest statement is "the canonical source is ColdLion, and the
data was last refreshed by hand in July." Anyone reading ✅ as "kept current automatically" will be
wrong.

**C5 — Row counts across the docs are stale, in both directions.**
**[VERIFIED]** `core.factory` is 93 on preview; the scoreboard says 529. `core.customer` is 864;
the scoreboard says 929. `core.licensor` is 26; the architecture doc says 20. ColdLion properties
are 285 per division; every doc says 258. ColdLion artists are 53; the architecture doc says 68.
The `plm.erp_property` mirror is 570 rows; the 2026-07-26 scoreboard note says 516. Some of these
are genuine upstream growth and some are documentation drift, and the docs do not distinguish.
**Re-measure before quoting any count.**

**C6 — The vendor Windows bug is fixed but its scheduling status is documented nowhere.**
**[VERIFIED]** PR #334 merged 2026-07-31 as commit `400b590`, "stop the ColdLion vendor sync
silently doing nothing on Windows". **[VERIFIED]** `tools/sync-coldlion-vendors.mjs` is referenced
by **no** workflow and **no** systemd unit — it is hand-run only. `AGENTS.md` §6.2 does say
"recurring scheduling (Phase B) is NOT built yet", which is accurate; the scoreboard's ✅ does not.

**C7 — `core.merch_group` is designed, wired into `core.item`, and empty.**
**[VERIFIED]** zero rows. No document in this repo states a plan to fill it. The architecture doc
covers the ColdLion→DesignFlow→Supabase path for licensor/property in detail and is silent on where
the other eight types should land. This is the largest genuine gap in the answer to the question
"make ColdLion the source of truth for every `core.*` table it feeds".

**C8 — Style Guide has two meanings and neither doc warns about the other.** See §4.

---

## 8. What I verified versus what I took from the documents

### Verified this session (read-only)

Against preview `rjyboqwcdzcocqgmsyel` via Node + `pg`:

- Row counts: `core.licensor` 26, `core.property` 256, `core.customer` 864, `core.factory` 93,
  **`core.merch_group` 0**, `core.style_guide` 0.
- Mirrors: `plm.erp_licensor` 44, `plm.erp_property` 570, `plm.erp_customer` 836,
  `plm.erp_vendor` 97.
- `plm.erp_licensor` is CW001+SP001 type `05` only; `plm.erp_property` is CW001+SP001 type `06`
  only.
- `plm.merch_group_header` holds all 37 header rows across all four divisions, with the per-division
  meanings exactly as the architecture doc describes (05 = Licensor in CW001/SP001, Big Theme in
  EH001, Product Line in EP001).
- `core.taxonomy_source_ref` split: coldlion 38/504 refs → 19/252 entities; designflow_plm 37/468.
- `ingest.sync_run` history per source name and status, including last-success timestamps.
- 33 ColdLion property codes and 3 licensor codes with no `core` row matching on `code`.
- Four migration versions applied to preview that are absent from `supabase/migrations/`.
- The presence of `promote_coldlion_source_owned` and `verify_coldlion_approved_mapping_identity`
  in preview's `pg_proc`.

Against the live ColdLion API (`http://x5.coldlion.com/EhpApi`, `X-API-Key` header, read-only GETs):

- `/merchGroupDetails` counts for CW001 and SP001, types 05–10: 22 / 285 / **0** / 3 / 53 / 3 in
  both divisions.

Against the repository and GitHub:

- The full contents of `AGENTS.md`, `plan_coldlion_licensor_property_accelerated_cutover.md`,
  `docs/merch-group-taxonomy-architecture.md`, `docs/master-data-cutover-scoreboard.md`, the
  headers of all three ColdLion sync runners and `coldlion-sync-common.mjs`, all five workflows,
  and `systemd/plm-sync.timer`.
- `gh pr list`: PRs #331 and #238 open; #331 mergeable with green checks and a 23-file diff.
- Git history proving no ColdLion customer runner was ever committed or deleted.
- Commit identity `Albert Hazan <u2giants@users.noreply.github.com>` via `git var
  GIT_COMMITTER_IDENT`.

**Production `qsllyeztdwjgirsysgai` was never contacted.** No write of any kind was performed
anywhere.

### Taken from the documents, not re-measured

- The 542 approved mappings breaking down as 38 licensor + 504 property → 271 canonical UUIDs, and
  the artifact hash `1230f5a12d0f2a3029f1d3df17fc5b5f`, approved by Albert on 2026-07-25.
  (I verified the *current preview state matches* those numbers; I did not open the artifact or
  re-verify the hash.)
- `ready=true` from the readiness evaluator on preview, 2026-07-27.
- All Phase 1–7 evidence: forced-failure drills, rollback rehearsals, protected-hash stability, the
  circuit-breaker auto-trip behaviour.
- The DesignFlow-side findings in `docs/merch-group-taxonomy-architecture.md` §4 and §9 — the
  single `merchGroup` table, the `parent_id` hierarchy, the `is_active` asymmetry, and the 15
  numbered defects. I did not read the DesignFlow repos.
- That `core.style_guide` will be sourced from `dflow.properties_and_characters`
  (`fix_characters_style_guides.md`).
- That ColdLion's own `active` flag on `/customers` is unreliable, which is why
  `core.customer.status` is app-owned.
- Production's current state for anything. Every production claim in this document comes from a
  repo document and is unverified by me.
