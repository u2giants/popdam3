# Orchestrator handover — Disney OPA lookup BUILT, Paramount source layer designed

- **Session:** `697b5b87-a3a5-4aef-a03b-26fe277d52f5`, orchestrator, machine **al8960ofc**
- **Marker issue:** **#491** (`orchestrator-marker`) — closed at handover
- **Written:** 2026-08-07 ~22:22 UTC
- **Ended cleanly.** Not a crash, not a context-loss handover.

> **The role was renamed COORDINATOR → ORCHESTRATOR during this session**, and
> `COORDINATOR_INTAKE.md` was **retired** on 2026-08-07 (now a 37-line pointer).
> Outstanding work is filed as **GitHub issues** labelled `db-work`, not appended
> to that file — a required check fails PRs that write to it. If you find
> instructions telling you to append there, they are stale.

---

## 0. If you read only one page

| | |
| --- | --- |
| **What was asked** | Secure Disney's leaked extract, then BUILD the OPA lookup table, then design Paramount |
| **What was delivered** | The OPA lookup table **exists and is merged** — 5 migrations on `main`, applied to preview. Disney's CSV and DESIGN.md moved to the private repo. The loader hardened and proven against the real file. Paramount source layer designed, reviewed, revised twice |
| **What was NOT delivered** | **No Disney data is loaded.** All OPA tables are 0 rows. **Nothing promoted to production.** Paramount: nothing built |
| **Most urgent inherited item** | The **git-history scrub** (R-SEC-1 step c). Two confidential blobs remain reachable in history and the repo is **PUBLIC** |
| **Most dangerous inherited item** | **Production has never had a real apply through the workflow** — 281 runs, `production-dry-run` skipped every time. Nobody knows production's true migration position by measurement |
| **Open PRs** | **0** |
| **Open `db-claim` issues** | **0** |
| **Live agents** | **0** |

---

## 1. Live facts, stamped

| Fact | Value | Checked |
| --- | --- | --- |
| `origin/main` tip | `01ca62a733ce706f2bcac8878a90b8113f54d83c` | 2026-08-07 22:22 UTC |
| Max migration version | `20260807200000` | 2026-08-07 22:22 UTC |
| Duplicate migration versions | **none** | 2026-08-07 22:22 UTC |
| Open PRs | **0** | 2026-08-07 22:22 UTC |
| Open `db-claim` issues | **0** | 2026-08-07 22:22 UTC |
| Repo visibility | **PUBLIC** | 2026-08-07 ~19:00 UTC |
| Branch protection | 6 required checks, `strict: true`, `enforce_admins: true` | 2026-08-07 ~19:30 UTC |

**`origin/main` moved ~15 times during this session.** Re-derive everything above
before acting. Do not trust this table.

⚠️ **The required-check list CHANGED mid-session.** `Backlog / queue sync` was
removed and `Intake pointer guard` added. Current six: `Promotion contract tests
(offline)`, `Cross-PR object collision`, `Tools offline tests`, `SQL migration
guards`, `Domain ownership`, `Intake pointer guard`.

⚠️ **The marker label was renamed** `coordinator-marker` → `orchestrator-marker`
mid-session by another session. A query for the old label returns empty and looks
like "no orchestrator is active". **Query by the new name, or enumerate all open
issues and read their labels.**

### File ownership at handover

| File | Owner |
| --- | --- |
| `supabase/migrations/` | **NONE** |
| `HANDOFF.md` | **NONE** |
| `AGENTS.md` | **NONE** |
| everything else | **NONE** |

All agents finished. Nothing is held.

### Preview state — honestly

**Preview `rjyboqwcdzcocqgmsyel` is CLEAN and healthy**, and this was measured, not
assumed. Ledger **405 rows, exactly matching the repo's 405 migration files** —
the full version sets were diffed, not just counted. Zero orphan objects; every
`core` relation traces to a migration.

**All five OPA migrations are applied to preview.** All OPA tables are **0 rows** —
no Disney data was loaded.

⚠️ **`MIGRATIONS_FAILED` on the Supabase branch named `main` is a PERMANENT STALE
ARTIFACT, not a failure.** Its `project_ref` is **production**, and its
`created_at` and `updated_at` are byte-identical at `2026-06-21T03:05:59` — never
touched since branching was enabled. The previous handover flagged it as
uninvestigated and alarming; it is neither. Preview is the
`shared-db-schema-rehearsal` branch, status `FUNCTIONS_DEPLOYED`. **Do not
re-investigate this.**

⚠️ **Preview and production are legitimately divergent.** Preview carries
`core.licensor` `FR` as `status = 'inactive'`, which `AGENTS.md` says must not
exist on production standalone. **Do not "reconcile" it.**

### ⚠️ Two environment traps that will bite you

**1. The shared checkout's Supabase link state is INTERNALLY INCONSISTENT.**

```
supabase/.temp/project-ref  -> rjyboqwcdzcocqgmsyel   (PREVIEW)
pooler-url                  -> ...rjyboqwcdzcocqgmsyel...  (PREVIEW)
linked-project.json         -> {"ref":"qsllyeztdwjgirsysgai"}  (PRODUCTION)
```

**The `cat supabase/.temp/project-ref` check prescribed in every brief and skill in
this repo PASSES while the same directory also names production.** Never rely on
CLI link state. Name the target ref explicitly in the URL — the Management API
query endpoint takes it in the path and cannot drift. Every agent this session used
that approach.

**2. `gh api` contents endpoint silently returns an EMPTY body for files over
1 MB.** The Disney CSV is 1,069,881 bytes and hits this. Pass
`Accept: application/vnd.github.raw` or you will analyse zero rows and not notice.

---

## 2. THE SECURITY EVENT — inherited, partly closed, NOT finished

`u2giants/shared-db` was created PUBLIC on 2026-06-20 and held
`docs/verification/opa-characters-20260806/opa-characters.csv` — 10,262 rows of
Disney's property/character list with Disney's own internal IDs — until
2026-08-07 ~15:10 UTC. The previous session made it private.

**What this session did:**

- **Verified both scraping sessions complied.** Evidence-backed, not assumed: every
  commit to `shared-db` after 15:10 UTC is docs-only; no CSV/JSON/data file landed.
  Disney DCP Vault and Warner data went to `licensor-source-data` PRs. **This is a
  positive finding, not an absence of evidence.**
- **Moved the CSV out** (PR #495). Blob `fa128591` verified byte-identical in
  `licensor-source-data` **before** deletion. Pointer left behind.
- **Moved `DESIGN.md` out** (PR #500) — 937 lines quoting real Disney names and IDs,
  missed by the previous session. Blob `9b20f902` verified identical before deletion.

**⚠️ THE REPO IS PUBLIC AGAIN.** Another session made it public at ~17:11 UTC
(PR #494), stating Albert had ruled the extract "not sensitive". **Albert, asked
directly in this session, said the opposite** — he chose "remove the file, stay
public" and separately ruled the Disney file should be scrubbed from history for
legal risk. **Two sessions acted on opposite readings of the same instruction on
the same afternoon.** The removals are done; the repo is public; the history is not
clean.

**⚠️ STILL OUTSTANDING — R-SEC-1 step (c), the history scrub.** Both blobs remain
reachable. Measured: the CSV is in **67 commits** and reachable from **13 refs** —
every remote branch in the repo. **A scrub rewrites every branch and breaks every
clone and worktree.** Needs a quiet window. **Albert's scope ruling: the Disney
material ONLY.** POP's own large CSVs — including a 29 MB, 111,012-row
`popsg-property-reconciliation-20260726/property-relationships-accepted.csv`, 27×
larger than Disney's and public just as long — are **explicitly out of scope**.

**Not provable, do not claim otherwise:** whether anyone fetched the data while
public. Forks 0, stars 0 at the flip, but an anonymous clone or a crawler leaves no
trace. **Never report "no one took it."**

**A legal question nobody has answered:** whether Disney or Warner require breach
notification for the seven-week window. That is Albert's call, not engineering's.

---

## 3. Half (a) — coordination state

### What is DONE and merged

- **The Disney OPA lookup table exists.** Five migrations on `main`, all applied to
  preview: `20260807170000` (landing), `20260807170100` (importer), `20260807180000`
  (reentrancy fix), `20260807190000` (security + view corrections), `20260807200000`
  (comment corrections). **Name every one of these in any promotion list.**
- **The loader is hardened**: `tools/sync-opa-property-character.mjs`, 45 tests, 28
  mutants killed, proven against the real Disney CSV in dry run.
- **Owner rulings recorded**: `docs/verification/owner-rulings-20260807/README.md`
  and `AGENTS.md` §6.13.

### What is DESIGNED but NOT built

**Paramount source layer, release 1 = FIVE tables** (Albert's ruling):
`plm.pmt_capture`, `pmt_property`, `pmt_character`, `pmt_property_character`,
`pmt_asset`, plus importer, RLS/grants, one `api` view, contract tests.

**Deferred to release 2+:** `pmt_brand`, `pmt_franchise`, `pmt_franchise_property`,
`pmt_collection`, `pmt_property_collection`, `pmt_asset_collection`,
`pmt_asset_property`, `pmt_asset_character`, `pmt_authorized_title`,
`pmt_authorized_title_match`, four views.

**Build is HELD until the full Paramount capture returns.** Albert ruled this.

### Blocked on Albert

1. **A quiet window for the history scrub.** Nothing else can run during it.
2. **Production promotion** — see §5.
3. **Warner** — two competing unmerged PRs in `licensor-source-data` (#2 and #3,
   same folder, same session, different row counts). Albert said "leave Warner for
   now". Nothing is built for Warner on the database side either.

### Owner rulings made THIS session — do not re-litigate

Full detail in `docs/verification/owner-rulings-20260807/README.md`.

1. **Per-licensor landing tables**, never one shared table.
2. **Paramount release 1 is five tables**, not fifteen.
3. **The Paramount authorized-title list is 26, and 26 is final.** The removed
   `902010` entry was a duplicate. ⚠️ A different doc has a section headed
   "Viacom Multi (Paramount) — 27 codes" — that is unmatched ColdLion property
   codes, a **different population**. Do not reconcile the two.
4. **Build waits for the Paramount capture.**
5. **Sub-licensors stay FLAT.** See §6 — this one has an invisible consequence.
6. **The junction table `core.property_character` is built** — Laura, the licensing
   manager, confirmed a character can appear under several properties. Independently
   corroborated by Paramount data.
7. **Deletions are NEVER performed** — mark inactive instead.
8. **Names and metadata only** — no asset file downloads from any portal.

---

## 4. Half (b) — every sub-agent, separately

Nineteen agents. All finished. All worktrees retired except one that was never mine.

### Agent: `intake-summariser` (read-only, no worktree)
- **Asked to do:** compress ~11,750 lines of `COORDINATOR_INTAKE.md` + `HANDOFF.md` into an anchored inventory.
- **Actually did:** returned a 63-item queue inventory, the B1–B14 backlog, the four ⛔ ALBERT decisions verbatim, and **10 flagged contradictions**.
- **Found:** the queue had no IDs and no status field; `## IN PROGRESS` held an orphan dispatched by the previous (departed) orchestrator; two exact-duplicate queue entries.
- **Worktree:** none. **Deliberately did NOT:** resolve any contradiction — correct; the orchestrator re-derived them.

### Agent: `security-audit` (read-only, no worktree)
- **Asked to do:** inventory confidential data in the repo and history; verify the two scraping sessions complied.
- **Actually did:** full git-history sweep; inspected `licensor-source-data` via `gh api` without cloning.
- **Found:** the CSV in **67 commits / 13 refs**; **both scraping sessions complied**, evidence-backed; **no live credential committed**; production project ref in 40+ files (not secret, but public for 7 weeks). Flagged the 29 MB POP CSV as a scope question, not a decision.
- **Deliberately did NOT:** move or delete anything; decide the scrub scope. **Explicitly stated three things it could not prove** — including that "nobody took it" is unprovable.

### Agent: `preview-observer` (read-only, no worktree)
- **Asked to do:** resolve preview state; investigate `MIGRATIONS_FAILED`.
- **Found:** ledger 400/400 exact; **`MIGRATIONS_FAILED` is a stale artifact whose project_ref is production**, untouched since 2026-06-21 — a false alarm the previous session had flagged as urgent. `core.character` = 0 rows. OPA namespace empty. **Production has never had a real apply** — across 255 runs `production-dry-run` was always skipped.
- **Also found:** the memory note claiming the preview ledger is unreliable is now **false** — markers gone, 400/400 exact.
- **Deliberately did NOT:** connect to production (inferred instead, and labelled it an inference).

### Agent: `r-sec-1-csv-move` (WRITE — `agent/r-sec-1-move-opa-csv-20260807`)
- **Asked to do:** R-SEC-1 steps (a)+(b) — move the CSV to the private repo, leave a pointer.
- **Actually did:** `e977dd7` → **PR #495 MERGED**; `licensor-source-data` PR #4 merged.
- **Found:** **the README's stated natural key was WRONG** — it claimed the name pair; measured, only `(licensedPropertyID, characterID)` is unique. **Also found `DESIGN.md` in the same folder was equally exposed** and flagged rather than touching it (out of its write list).
- **Evidence:** blob `fa128591` identical both sides before deletion. Caught the Windows CRLF trap — transferred via `git cat-file blob`, not the working-tree file.
- **Worktree:** finished, retired. **Deliberately did NOT:** rewrite history; touch the 29 MB POP CSV.

### Agent: `opa-build-scoper` (read-only, no worktree)
- **Asked to do:** extract the exact object list from the design doc for the collision gate.
- **Found:** §7.1 carried a complete declaration; flagged **three naming defects** where the doc contradicted its own DDL; **identified the data-loading trap** — §7.7 instructed a seed migration whose justification ("the CSV is already in this private repo") had expired.
- **Deliberately did NOT:** invent any undetermined name.

### Agent: `opa-build` (WRITE — `agent/opa-build-20260807`) — the main build
- **Asked to do:** build the OPA lookup table, schema only, no data.
- **Actually did:** **PR #497 MERGED**, 10 commits, five migrations, contract tests, `tools/sync-opa-property-character.mjs`, build note. Applied all five to preview.
- **Found and self-reported:** a **reentrancy defect in its own migration** (`create temporary table … on commit drop` made the importer non-reentrant, `42P07` on a second in-transaction call) and **refused to fix it in place** — correctly demanded a forward version. Also found two vacuous tests in its own work: an `array_agg` comparison that was `name[]` vs `text[]` and **had never executed**, and a `P0001` trap that made ten negative tests pass regardless.
- **Its most valuable finding:** `coalesce()` wrapped **around** `greatest(0, least(1, x))` returns `1`, not NULL — so the "obvious" fix for the NULL shrink-fraction hole leaves the guard just as dead while looking corrected. Only caught by measuring. Recorded in the build note as a warning.
- **Corrected the orchestrator** on framing: the cross-side name figures came from the private CSV, not from preview, and are not re-verifiable from the database alone. Right, and recorded.
- **Worktree:** finished, retired. **Deliberately did NOT:** seed any Disney data; resolve anything; merge its own PR.

### Agent: `opa-review` (read-only, no worktree) — three rounds
- **Asked to do:** independent model review of PR #497, then verify every finding against the code.
- **Actually did:** Codex `gpt-5.6-sol` at **medium** effort (header verified). Round 1 **REQUEST CHANGES, 2 High**. Round 2 **APPROVE** but found 3 new mediums. Round 3 on the hardening PR: built **7 of its own mutants** and killed all 7 rather than trusting the author's 20; settled the parser-strictness question by measuring **16 realistic CSV shapes**.
- **The two Highs it caught:** (1) the OPA mirror shipped `using (true)` under a comment falsely claiming it matched the `erp_` precedent — **every authenticated user of four apps could read the entire confidential Disney extract**; (2) a NULL `p_max_shrink_fraction` silently disabled the truncated-extract guard, reachable from a mistyped env var.
- **It found the file nobody could review:** `tools/sync-opa-property-character.mjs` was committed with **3 literal NUL bytes**, so git classified it as binary — `git diff` showed "Binary files differ", GitHub reported `additions: 0`. **Two Codex rounds, two reviewer passes and the orchestrator all reviewed that PR while 347 lines were invisible.**
- **It was WRONG twice, and both were caught:** it claimed `core.property` had no RLS policy (it does — created dynamically in a `foreach … execute format` loop at `20260621151155:290-305`, which a literal grep cannot match), and it miscounted the NUL bytes as 350 (the orchestrator repeated that error to Albert twice before correcting it).
- **Deliberately did NOT:** merge anything; treat any model finding as true without checking it.

### Agent: `laura-decision-csv` (read-only, no worktree)
- **Asked to do:** build Laura a decision sheet for Disney-vs-our character names.
- **Found — and this overturned the premise:** the design doc's §8 figures were **materially wrong**. It measured a derived 28-July CSV, not the database, and that file had already flipped names into `Firstname Lastname` order. Measured against preview: **208 apparent mismatches → 26**; **147 "surname ordering" cases → ZERO**; **61 "real differences" → 0 word-level**; **58 rows that destructive following would delete → 8, seven of them our own "Do Not Use" markers.** The backtick defect exists on both sides identically, so there are **zero cross-side disagreements**.
- **Delivered:** `laura-character-name-decisions-20260807.csv`, 26 rows, on the Desktop. Never committed.
- **Deliberately did NOT:** pre-fill a single answer; put the backtick issue in front of Laura (measured as a shared defect, not her call).

### Agent: `design-md-move` (WRITE — `agent/design-md-move-20260807`)
- **Asked to do:** move `DESIGN.md` to the private repo per Albert's ruling.
- **Actually did:** `7971cd2` → **PR #500 MERGED**; `licensor-source-data` PR #5 merged.
- **Evidence:** blob `9b20f902` identical both sides; **byte-compared the pre-existing CSV pointer region before and after** and reported that it did — `cmp` on the first 20,740 bytes, identical.
- **Found:** the folder README still names **one** Disney property inside a quoted ruling (line 372), no IDs. Reported, not touched.
- **Worktree:** finished, retired. **Deliberately did NOT:** redact instead of moving (owner ruled move); rewrite history.

### Agent: `runner-hardening` (WRITE — `agent/runner-hardening-20260807`)
- **Asked to do:** harden the loader before it is ever run with `--apply`.
- **Actually did:** **PR #535 MERGED**, 3 commits. **45 tests, 28 mutants killed.**
- **Closed:** the wrong-target gate (printing the ref is not a gate — one wrong env var loads 10,262 Disney rows into **production**); URL validation; first-load floor; a comment that falsely claimed the DB "coalesces" the NULL parameter and would have led a maintainer to restore the exact anti-pattern; strict CSV parsing; the NUL bytes; two value-echoing error messages.
- **It exceeded its brief on the credential guard and SAID SO**, offering to narrow it: rather than substring-scanning URLs for secret-shaped words, it now **refuses query strings and fragments outright**. The orchestrator accepted — the value is operator-supplied once, the error is actionable, and a blocklist guarding a value persisted 10,262 times is the wrong shape.
- **Wrote two bugs itself and its own tests caught both**, and reported that rather than quietly fixing it.
- **Worktree:** finished, retired. **Deliberately did NOT:** run the loader against any database; merge its own PR.

### Agent: `opa-dry-run` (WRITE — docs only)
- **Asked to do:** settle by measurement whether the hardened parser accepts Disney's REAL file.
- **Actually did:** **PR #569 MERGED** (build note §10). **The real file PASSES, unmodified.**
- **Evidence:** fetched 1,069,881 bytes / 10,262 data rows, matching exactly. Every predicted figure reproduced: 1,445 property IDs, 9,613 character IDs, 10,240 name pairs, 22 collisions. **Cross-checked with a separately written RFC4180 tokenizer** — two independent parsers agreeing means these are properties of the file, not of one parser.
- **Two findings:** the bare-quote rule **never fired, and that is luck** — Disney's exporter quotes every field and the file has zero embedded quotes; a future extract that quotes selectively is untested. And **`OPA_SOURCE_URL` rejects the natural provenance URL**, because the real OPA page URL carries a query string — and those parameters (`lob`, `regionName`, `templateId`, `workflowId`) are what **select** the extract, not decoration. **Stripping them makes provenance say which page, not which slice.** Flagged as an owner decision rather than loosening the guard.
- **Worktree:** finished, retired. **Deliberately did NOT:** pass `--apply`; contact any database; modify any guard to make the file pass.

### Agent: `paramount-design` (read-only, no worktree) — first pass
- **Asked to do:** design Paramount's landing structure and draft a capture prompt.
- **Found:** the three licensors' shapes do **not** match — Disney is a submission picker giving property→character pairs; Warner is a DAM giving assets with **no** property→character link at all; Disney IDs are numeric, Warner's are UUID strings. **Recommended deferring the build until a sample returned.**
- **Also found:** only `disney-opa/` is on the private repo's `main`; Warner and DCP Vault exist **only on open unmerged PRs**; `docs/licensor-portal-scrape-source-schema-20260807.md`, which the WB skill calls the "database contract", **does not exist**.
- **Deliberately did NOT:** invent any Paramount column name — it had not seen the portal and said so.

### Agent: `core-state-check` (read-only, no worktree)
- **Asked to do:** measure what actually exists in `core.*`.
- **Found (preview, measured):** `core.property` 256, `core.licensor` 26, `core.taxonomy_owner_ruling` 3, and **`core.character`, `core.style_guide`, `core.style_guide_character`, `core.property_character`, `plm.opa_property_character` ALL 0 rows**. Confirmed the corrected RLS predicate live from `pg_policies`. Zero Paramount objects anywhere.
- **Established by INFERENCE, labelled as such:** across **281 workflow runs** `production-dry-run` was skipped 142 times, failed once, succeeded **zero** times. **No migration has ever reached production through this workflow.** Today's tables certainly do not exist on production.
- **Deliberately did NOT:** connect to production.

### Agent: `laura-sheet-rebuild` (read-only + xlsx)
- **Asked to do:** rebuild the 47-row sheet per Albert's four requirements.
- **Actually did:** delivered `licensor-questions-for-laura-20260807.xlsx` to the Desktop — 46 questions, 45 dropdowns, 3 tabs, read-back verified.
- **Found:** the gap was **47 this morning and 66 by evening** — **19 brand-new ColdLion records appeared during the session**, all ending `- DESPERATE`. Removed 9 questions Laura had **already answered**, including two she got right in round 1 that our side never acted on. Also found `CW001` and `SP001` are **no longer byte-identical**, contradicting the doc.
- **Deliberately did NOT:** add a "why we are asking again" column — nothing in the sheet had been asked before, and a column reading "no" 46 times is noise.

### Agent: `paramount-design-2` / `paramount-design-3` (read-only, no worktree) — three revisions
- **Asked to do:** design Paramount's source layer; then revise twice.
- **Actually did:** rev 1 (15 tables), rev 2 (five tables + three High fixes), rev 3 (after recon 2).
- **Disagreed with Albert's brief on four points and was judged right on all four:** rejected his suggested table names as conflicting with the established `plm.<source>_<entity>` pattern; rejected a licensor discriminator column (constant in a per-licensor table, adds no uniqueness, creates the illusion of a guard); added a sixth link table his list omitted; declined to reuse the PopSG normalizer (a frozen contract whose future change would silently rebaseline stored keys).
- **Its best decision:** moving the four confidential Paramount domain strings **out of migrations entirely** into runner env gates — so they never enter the public repo, and the unknown one no longer blocks the build.
- **Deliberately did NOT:** implement anything; invent a 27th title; pin any value observed once.

### Agent: `paramount-design-review` (read-only, no worktree)
- **Asked to do:** independently review the Paramount design.
- **Actually did:** Codex `gpt-5.6-terra` at **medium** (header quoted). **SPLIT + REQUEST CHANGES, 3 High.**
- **Found:** mixed key strategy (a link table literally could not declare its FK); collection enrichment could still duplicate via a **double update**, which Codex diagnosed wrongly and the reviewer corrected; and **the grain of "every row FKs a capture" was undefined** — the single ambiguity deciding whether a second capture updates or duplicates every table. **Recommended cutting 15 tables to 5**, independently of Codex reaching the same conclusion.
- **Also established:** Codex was **working again** on this machine — the `base_instructions` cache error prints but does not kill the run. An earlier agent had reported it dead after three failures.

### Agent: `laura-round4-read` (read-only, no worktree)
- **Asked to do:** read the returned "round 4" sheet.
- **Found — and this contradicted Albert's stated belief:** the sheet was **not answered by Laura**. File metadata shows `lastModifiedBy: Albert Hazan`, created and modified 32 minutes apart. **40 of 46 answer cells blank**; the 6 filled hold the same pasted paragraph typed over a dropdown; **no offered dropdown value was selected anywhere.**
- **But the substance was real and changed the model:** Desperate is a **sub-licensor**, not the brand owner. So `ANHEUSER BUSCH - DESPERATE` and the existing `potential` `Anheuser Busch` are **NOT duplicates** — they are the brand owner and the sub-licensed route. **The orchestrator had told Albert the opposite earlier and corrected it.**
- **Also found our sheet was broken:** "Desperate" was not among the 31 dropdown options, so the correct answer **could not be expressed**. Our fault, not his.
- **Deliberately did NOT:** interpret the paragraph into 17 licensor assignments, though a tidy reading existed.

### Agent: `owner-rulings-record` (WRITE — `agent/owner-rulings-20260807`)
- **Asked to do:** record the five owner rulings durably.
- **Actually did:** `a7b4871` → **PR #576 MERGED**. New `docs/verification/owner-rulings-20260807/README.md` plus `AGENTS.md` §6.13.
- **Evidence:** byte-compared `AGENTS.md` — 40 insertions, 0 deletions, `cmp` confirming prefix and suffix identical.
- **Found a near-collision and recorded it as a trap:** a different doc has a section headed "Viacom Multi (Paramount) — 27 codes"; anyone told "26, final" who greps for Paramount will find a 27 and think a row was dropped.
- **Worktree:** finished, retired. **Deliberately did NOT:** soften ruling 5; fix the pre-existing `verify` check failure (`npm audit` / `nanoid`), which fails on unrelated PRs including on `main`.

---

## 5. Production — the biggest inherited unknown

**All five OPA migrations are on `main` and applied to PREVIEW. NONE is promoted to
production.** Neither is `20260807030000` (the Coco ruling) from the previous session.

**Production has never had a real apply through the workflow.** Measured across 281
runs: `production-dry-run` skipped 142 times, failed once, **succeeded zero times**.
The workflow's first step is literally "Refuse production apply". Promotion is a
separate, owner-approved, out-of-band operation.

**Consequence:** `core.property_character` and `plm.opa_property_character`
**certainly do not exist on production.** Any design assuming they do is wrong.
**Nobody knows production's true migration position by measurement** — establishing
it needs an approved window and is itself a task.

**Promotion list, in dependency order, all five versions in full:**

```
20260807170000_opa_property_character_landing.sql
20260807170100_opa_property_character_importer.sql
20260807180000_opa_sync_reentrancy_fix.sql
20260807190000_opa_security_and_view_corrections.sql
20260807200000_opa_comment_corrections.sql
```

⚠️ **Anything without `20260807190000` ships a read policy that lets EVERY
authenticated account — including `vendor` and `viewer` — read the entire
confidential Disney extract. It is a security fix, not optional.**
`20260807180000` must be promoted before `20260807190000`.

---

## 6. What we tried that did NOT work — MANDATORY

| Attempt | What happened | The lesson |
| --- | --- | --- |
| `gh api "…?labels=coordinator-marker&state=open"` right after creating the marker | Returned **empty** for an issue that provably carried the label | **The label filter is eventually consistent, not broken.** It returned 1 five seconds later. The previous handover called this command a liar; it is a race. Brute-force enumerating all open issues and reading their labels is the reliable method |
| Trusting the label name at all | The label was **renamed** `coordinator-marker` → `orchestrator-marker` mid-session | A query for the old name returns empty and reads as "no orchestrator active" |
| `grep -c $'\x00' <file>` to count NUL bytes | Bash **cannot hold a NUL in a string**, so the pattern was empty and matched every line — it reported the file's **line count**. The orchestrator repeated "350 NUL bytes" to Albert twice | The real count was **3**. Use `tr -dc '\000' \| wc -c`. The build agent corrected the orchestrator and was right |
| `git ls-tree … \| grep '202608071'` to list today's migrations | Silently **excluded `20260807200000`** — it starts `202608072` | Nearly reported a migration missing from `main`. Match the full prefix or list and eyeblame |
| Merging PR #497 on the first APPROVE | Review said APPROVE, 0 High — but three CONFIRMED mediums included a **vacuous test** and a **file nobody could diff** | **"Zero Critical/High" is not "ready to merge."** Read the mediums |
| Reviewing `sync-opa-property-character.mjs` at all, for four rounds | 3 NUL bytes made git call it binary; GitHub reported `additions: 0` | **A diff that shows nothing is not a diff that is clean.** `git diff --numstat` printing `-  -` is the tell |
| The "obvious" fix for the NULL shrink-fraction hole | `coalesce()` **around** `greatest(0, least(1, x))` returns `1`, not NULL — guard stays disabled while looking corrected | **Validate the parameter, not the expression.** Found only by measuring |
| Concluding Paramount characters had no IDs | The first recon read the default view. **The IDs existed all along**, one layer down in full asset metadata. Then the same thing happened again for Collections and Franchises | **The default view of a portal is a display, not the data.** This became the core of the Disney enhancement prompt |
| Believing a property filter proves a relationship | A character appeared under **three** property filters while its explicit link named **one**. Inferring would have produced ~⅔ wrong edges | **Record the explicit relationship; never infer it from a filtered result** |
| Assuming the returned "round 4" sheet was Laura's answers | File metadata showed Albert authored it; 40 of 46 cells blank | Check `lastModifiedBy` and timestamps before acting on a returned spreadsheet |
| Offering Laura a dropdown that could express the right answer | "Desperate" was **not among the 31 options**. The correct answer was unselectable | Our sheet's fault. A dropdown missing the true answer forces a wrong one or none |
| `gh api …/contents/<file>` on the 1 MB Disney CSV | Returns `encoding: "none"` and an **empty body** | Pass `Accept: application/vnd.github.raw` or analyse zero rows and not notice |
| Copying the CSV from the Windows working tree | CRLF expansion — 1,080,143 bytes vs the blob's 1,069,881 | Transfer via `git cat-file blob`, and **verify the hash before deleting the source** |
| `check-dispatch-collision.mjs` on the Paramount design | Exit 0, but the checker is **blind to `create table`, `create index`, `grant`, `comment on`** — which is essentially the entire design | **A clean gate result on a table-only change is close to meaningless.** Judge by hand |
| Believing Codex was permanently broken | Died 3× with `failed to load models cache: missing field 'base_instructions'` at 49KB/30KB/11KB | It **worked later at medium effort**. The cache error prints but does not kill the run. Retry before declaring it down |

---

## 7. Facts that may already be stale

- Every SHA, PR state and count in §1. `main` moved ~15 times this session.
- **Preview state** last measured 2026-08-07 ~22:00 UTC.
- **The ColdLion gap moved from 47 to 66 rows DURING this session** — 19 new
  `- DESPERATE` records appeared. Re-measure before acting on any mapping count.
- `AGENTS.md` §6.9's "33 codes" figure is stale at **47**.
- Whether the two Warner PRs in `licensor-source-data` are still open.
- The Paramount design rests on **3 property filters, 5 assets, 4 characters,
  2 collections, 1 franchise — from ONE franchise family.** Small.

---

## 8. Deliberately left behind — decisions, not oversights

- **`C:/repos/shared-db/.claude/worktrees/csv-findings`** — another session's,
  branch `docs/licensor-property-data-quality-findings-20260806`, no upstream.
  **Not mine. Not touched. Do not clean it up** without establishing whose it is.
- **The 29 MB POP reconciliation CSV and ~50 sibling data files** — public, and
  **out of scope by Albert's explicit ruling** (Disney material only).
- **One Disney property name** in the OPA folder README (line 372), no IDs. Raised
  with Albert; he did not rule; left.
- **The `verify` check failure** (`npm audit`, `nanoid` GHSA-2v37-7h3g-55p8) — it is
  **not a required check** and fails on `main` and on unrelated PRs. Not fixed
  because a lockfile bump is not documentation. Issue filed.
- **Deferred loader items:** G6 can echo a single field value on numeric overflow;
  two client-side runner messages still echo field values. Both judged low, both
  recorded.
- **Four spreadsheets on Albert's Desktop, deliberately NOT committed** (they carry
  licensor data and the repo is public): `laura-character-name-decisions-20260807.csv`,
  `licensor-questions-for-laura-20260807.xlsx`, and the Paramount/Disney prompts.

---

## 9. Immediate next actions, in order

1. **Read the Paramount full-capture result** when it lands, then **build the five
   tables**. Design is final and reviewed; §3 has the object list.
2. **Answer the capture's scale question first** — are the cascading relationship
   fields in the search response, or only in per-asset metadata? It decides whether
   the capture is cheap or very expensive.
3. **The history scrub**, in a quiet window. Disney material only. 67 commits,
   13 refs, breaks every clone.
4. **Load Disney's data to preview.** The loader is proven in dry run; the `--apply`
   path is proven only against fixtures. Requires `OPA_EXPECTED_PROJECT_REF` and
   `OPA_MIN_ROWS` — both mandatory, no defaults.
5. **Decide where the OPA extract selectors live** (`lob`, `regionName`,
   `templateId`, `workflowId`) now that `source_url` refuses query strings.
6. **Production promotion** — owner-gated, and establish production's real position
   by measurement first.

**Do NOT repair the DesignFlow master-data pull** until the parentage-durability gap
is fixed. No migration protects `core.property.licensor_id`; repairing the pull
silently reverts every curated licensor parent, including the Coco fix.
