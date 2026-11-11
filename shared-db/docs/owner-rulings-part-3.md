---
summary: Owner rulings verbatim, part 3 of 4: §6.15–§6.27 (17 sections); section list is in owner-rulings.md.
kind: living
status: current
read-when: a citation of AGENTS.md §6.15–§6.27 or the owner ruling text in that range
---

# Owner rulings and standing decisions (AGENTS.md section 6) — part 3 of 4

> Moved **verbatim** from [`owner-rulings.md`](owner-rulings.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

### 6.15 HISTORICAL OWNER RULING — two source lists; entity destination superseded by #1684

**His words, in chat, 2026-08-19:**

> "Delete list A completely. There should be 2 types of lists: the lists that are the
> direct results of scrapes from the licensor websites, and the list that comes in from
> the Coldlion api. The scrape lists show what properties we are licensed for, and the
> Coldlion list shows which ones we actually use."

**Historical ruling, superseded in part later on 2026-08-27.** The source distinction remains
settled, but the entity-table destination below no longer does: issue #1684 explicitly keeps
`core.property`, restores separate `core.character`, and retires the mixed table.

> ### AMENDMENT — Albert Hazan, 2026-08-27: there is a THIRD kind, and it is the one the apps use
>
> **His words, in chat, 2026-08-27:**
>
> > "there needs to be a third: the reconciliation of those 2. the tables that all the apps
> > actually use"
>
> The two kinds above are **sources**. Neither is what an application reads. The third kind is
> the **reconciled canonical layer** — the result of matching a scrape list against the ColdLion
> list — and it is the ONLY layer applications are allowed to consume.
>
> **Later same-day amendment — issue #1684:** the reconciled layer uses distinct entity datasets.
> Properties live in `core.property`; Characters live in `core.character`; membership is an
> explicit relationship. `core.properties_and_characters` is EOL, may receive no new dependencies,
> and will be removed. Its rows are disposable and must not be copied into either canonical table;
> future canonical rows come only from normalized source evidence through governed Master Data.
>
> Rules that follow from this:
>
> 1. **Applications read the reconciled layer only.** A screen, report or API that reads a raw
>    `plm.*` scrape table or a raw ColdLion feed table directly is a defect.
> 2. **The reconciled layer is derived, never hand-typed.** Every row traces to a scrape row, a
>    ColdLion row, or both. A row that traces to neither is invented data.
> 3. **A match failure is a finding, not a row to create.** Unmatched on either side gets
>    surfaced for a decision (issue #1661 covers the ColdLion side of that reconciliation).
> 4. **Owner decisions about a row live with the reconciled row**, not with a source row.
>    This is what `plm.source_resolution` (issue #1609) attaches to.

#### The two kinds, and what each one MEANS

| kind | source | business meaning | do not use it for |
|---|---|---|---|
| **Scrape lists** | direct captures from the licensor portals (Disney OPA, Warner STARLABS, NBCU Creative Assets, Paramount Creative Library, Peanuts/Tenovos, Sesame/NetX, WildBrain, Sega) | **what we are LICENSED for** | what we actually make |
| **ColdLion list** | the ColdLion ERP API feed | **which licensed properties we ACTUALLY USE** | what we are allowed to use |

Neither is a subset the other can be derived from. A property can be licensed and unused,
and an appearance in ColdLion that matches no scrape row is a finding, not a row to invent.

#### What "list A" is, and why it dies

"List A" is **Universe A** from issue #865:

- `core.property` — 256 rows, uuid keys, **no source-ID columns at all**
- `core.character` — empty
- `core.property_character` — empty
- linked to `core.licensor` (26 uuid rows) via `property_licensor_id_fkey`

It is hand-made. It carries none of the licensors' own primary keys, so it can never be
matched row-for-row against a portal capture, and 16 of its rows are stored at CHARACTER
grain in a table named `property`. It satisfies neither of the two kinds above.

**SUPERSEDED entity-table destination (historical evidence only).** The former Universe B was
`core.properties_and_characters` (10,122 rows, integer keys,
`source_licensed_property_id` / `source_character_id`), `core.property_character_associations`
(9,622 rows), keyed to `core."licenseList"`. Membership in the portal captures is **proven,
not assumed**: 112/112 sampled Disney OPA `characterID` values present, 6/6 sampled Warner
STARLABS `characters.csv:source_id` values present. `licenseList` 13 (`CC`) is the one known
exception — synthetic hand-made IDs (`COKE-CHAR-00n`), not portal-derived.

#### SUPERSEDED deletion destination — do not execute against `core.property`

The process safeguards below remain useful history, but issue #1684 reversed the destination:
`core.property` remains, separate `core.character` is restored, and the mixed table is retired.

The ruling settles the DESTINATION. It does not waive §4.2, the migration process, or the
blast-radius work. Before `core.property`, `core.character`, `core.property_character` and
(if it proves unused) `core.licensor` are dropped:

1. Prove which applications read them. `core.licensor`'s 26 codes are referenced by more
   than the property tables; do not assume it dies with them.
2. Land the drop as a normal shared-db migration — branch, PR, preview rehearsal, guarded
   merge, production evidence chain.
3. Anything genuinely worth keeping out of the 256 rows must be moved to a surviving list
   FIRST, with its licensor source ID attached, or it is gone.

**Do not drop anything on the strength of this section alone.**

#### SUPERSEDED OWNER RULING — the 260 `core.property` rows were called disposable

**His word, in chat, 2026-08-27, after the full feed-and-consumer investigation was put to him:** "disposable."

This no longer authorizes deleting `core.property`; issue #1684 explicitly keeps it as the Property
dataset. It remains historical evidence that no row should be copied from the mixed table merely
to preserve its current contents.

The investigation behind the ruling (live, production, 2026-08-27, recorded on issue #1238):

- **Writers:** two governed functions only — `plm.promote_coldlion_source_owned` and
  `public.promote_property_alias_batch`. No application, no trigger, no inbound foreign key,
  no PostgREST role grant. The "unfound DesignFlow writer" the dispatch gate waited on **does
  not exist**; the 5 rows added 2026-08-25 were the authorized `#539` / `#1177` batch.
- **Readers:** `api.pm_pipeline_page` joins it through `pim.product.property_id`, and all
  17,909 `pim.product` rows have `property_id` NULL — the join returns nothing. The only other
  reader is the DB Data Admin viewer.
- **Capture wiring:** twelve `plm.*` scrape tables carry a `core_property_id` column and
  **every one is 0% populated** across ~6,400 rows. `core.licensor` is different and is NOT
  disposable: `plm.style_tracker_item_bridge.core_licensor_id` is populated on 8,568 of
  15,619 rows.

Steps 1 and 2 still stand: the seven read-only functions that reference the table must be
re-pointed or dropped in the same change, and the drop lands as a normal branch/PR/preview/
production-evidence migration.

#### What this ruling immediately settles

- **#640** — the licensor reconciliation runs against **Universe B**, never Universe A.
  A run against Universe A reports enormous meaningless gaps and ignores the 10,122 rows
  that already carry the licensors' own keys.
- **#865** — answered and closed. Both of its questions are resolved: the reconciliation
  target is Universe B, and the "how do we group `core.licensor`'s 26 mixed codes into four
  portal licensors" question is moot, because that table is on the deletion path.

### 6.17 OWNER RULING — DesignFlow's numeric division ids are WRONG and do NOT come to this database; the ColdLion division CODE is the only division there is (Albert Hazan, 2026-08-19)

**His words, in chat, 2026-08-19, after the live ColdLion feed was checked against the
DesignFlow item headers:**

> "Designflow's division numbers (1, 2, 7, 9) were wrong and will not be moving to the new
> Supabase db. Coldlion is correct"

#### What the evidence showed, and why the ruling settles it

Issue #1137 had been blocked for two days on "what does DesignFlow division `2` mean", because
`plm."divisionCode"` mapped id `2` to `CW001` while the agreed rule said id `2` was dead.
Both answers were wrong, because the question was wrong. Measured 2026-08-19, read-only,
against `http://x5.coldlion.com/EhpApi`:

- All **19,994** live ColdLion items carry a real division code — `CW001` 13,219, `EH001`
  4,084, `SP001` 2,217, `EP001` 474. **None is blank and there is no numeric division at all**;
  the API has no divisions endpoint.
- Matching all **15,185** `plm."itemHeader"` rows with `div_code_fk = 2` to the live feed by
  `item_num_id` resolved **15,183** of them (the 2 misses have a blank item number): `CW001`
  11,175, `EH001` 2,395, `SP001` 1,140, `EP001` 473.
- So the bridge row saying "id 2 means CW001" is wrong for **4,008 items, 26% of them**. A
  single-value backfill was never going to be right, whichever value was picked.

#### The rule

1. **DesignFlow division ids `1`, `2`, `7` and `9` — and the numeric division id space as a
   whole — are WRONG and are NOT migrating to this database.** Do not model them, do not carry
   them across as a legacy column, do not build a bridge or lookup table to preserve them, and
   do not write a migration that repairs them in place. They stop at the DesignFlow boundary.
2. **The ColdLion division CODE is the division.** `CW001`, `EH001`, `SP001`, `EP001` — a
   four-plus-three character code from the live feed, sourced per item, never a constant and
   never an id.
3. **Backfills read the feed, keyed on `item_num_id`.** Never assign a division from a mapping
   table, a majority vote, or "what the old id used to mean".
4. This is the §6.15/§6.16 canon applied to divisions: **ColdLion is what we actually use, so
   ColdLion wins.** A DesignFlow-vs-ColdLion division disagreement is not a finding to
   investigate; ColdLion is right by definition.

#### What this voids on issue #1137

Withdrawn outright, because they all repair the numeric id space: setting
`divisionCode_id_fk = 1` on five `mg_id` rows; setting `is_divcode_active = false` on
`plm."divisionCode"` ids `2` and `7`; the 217-row Block A fix; deleting the 4 empty rows; and
the `CHECK` constraint on division shape. The `erp_items_current.division_code` backfill goes
ahead as a **feed-sourced** backfill. Normalising `itemHeader.compan_code_fk` is a company
code, not a division, and is unaffected.

#### Addendum (Albert Hazan, 2026-10-21): the live DesignFlow app keeps its numeric division id

**His words, in chat, 2026-10-21**, answering whether §6.17 also meant the merch-group sync
should stop writing `divisionCode_id_fk`:

> "put this mapping back in designflow-data-syncing/helpers/utility.js (remapMGDetail):
> CW001 → 1, SP001 → 8, EH001 → 9 and fill dflow_prod."merchGroup" rows that already have
> divisionCode_fk set and divisionCode_id_fk null, including Casper. Those numbers will not be
> written into the shared database."

So §6.17 governs the shared taxonomy and anything new: the numeric ids are still not modelled,
bridged or migrated there. The DesignFlow app's own tables (`dflow_prod`/`dflow`/`core`
`"merchGroup"`) keep writing `divisionCode_id_fk` from the ColdLion code, because the item screen
still filters merch groups by it. Removing that write (designflow-data-syncing 799486fe,
2026-10-08) dropped every newly synced merch group out of its division.

### 6.16 OWNER RULING — licence CONTRACTS are NOT a source for this database, and licence TERM and TERRITORY do not belong in it at all (Albert Hazan, 2026-08-19)

**His words, in chat, 2026-08-19, in reply to four questions about the NBCU Schedule "B" contract:**

> "you're not supposed to be referring to or using the contracts. the data scrapes + coldlion
> api feed are canonical. this is the 400th time i am saying this. why are we still talking
> about contracts over and over and over again?"

and, on adding term and territory columns:

> "this system has no connection to license term or territory. remove any and every record of
> that from this system for all licensors"

**He is right that it kept recurring, and it kept recurring because no section of this file
ever said it. This is that section. Read it before opening any licensor issue.**

#### The rule

1. **A licence contract, schedule, amendment or term sheet is NEVER a source of record for
   anything in this database.** Not for the property list, not for counts, not for names, not
   for restrictions, not for scope. Do not transcribe one. Do not cite one. Do not commit one
   into a repo so a loader can pin its SHA. Do not ask Albert to produce one.
2. **The only two canonical sources are the ones already named in §6.15**: the licensor portal
   scrapes (what we are licensed for) and the ColdLion API feed (what we actually use).
3. **Licence term and territory are OUT OF SCOPE for this system entirely** — no columns, no
   free-text notes, no `restriction_text`, no expiry date, no "US & Canada only". Not "model it
   properly later"; not at all. Existing records of either are to be **removed, for every
   licensor**.
4. A discrepancy between a contract and a scrape is **not a finding**. The scrape wins by
   definition, because the contract is not in the comparison.

#### Why the question keeps coming back, so it can stop

A contract makes an appealing source: it is signed, dated and authoritative-sounding, so each
new session that meets one reaches for it. The reason it is wrong is not that it is unreliable —
it is that **this database models what we scraped and what we make, and nothing else.** Legal
entitlement is a different system's job. A count "corrected" from a contract is a count that no
longer matches either canonical source.

#### What this ruling immediately kills

- **#732** ("NBCU is 58 Properties, not 57 — plus contract restrictions nobody transcribed") —
  closed in full. Its "58 not 57" count, its three amendment properties, its "Lamp Chop"
  transcription question, its two unsourced restrictions and its request for the Master
  Agreement are all void. The NBCU property count comes from the NBCU portal scrape.
- **`plm.nbcu_right`** — a table whose entire content is contract-derived (`business_title`,
  `rights_scope`, `restriction_text`, `global_rule_applied`, `source_document`). It is to be
  dropped. Nothing has ever been loaded into it, so this costs nothing. Removal tracked on its
  own issue.
- Any future issue proposing term, territory, expiry or restriction modelling. **Close it citing
  this section rather than escalating it to Albert.**

#### The one thing this does NOT change

Confidentiality obligations are unaffected. Licensed rows and licensor titles still never leave
their approved private repo, and §6.14 still governs what may be written into this public one.
Not using a contract as a data source is not permission to be careless with licensed data.

---

### 6.18 OWNER RULING — Albert does not sign off on technical risk; never gate on a judgement he cannot make (Albert Hazan, 2026-08-18)

> Recorded here on 2026-08-29 (issue #1812 / PR #1813). The ruling was made on 2026-08-18 and
> until now lived only in a `HANDOFF.d` closeout file, which §2.1-H deletes when its workstream
> closes. Indexing it here makes it durable, per AGENTS.md §10.

**The ruling, verbatim** (from
`HANDOFF.d/2026-08-27T2035Z-edge-dev-claude-orchestrator-1668-closeout.md`, recorded under
"Already settled — do NOT re-ask"):

> **2026-08-18:** Albert does not sign off on technical risk. He is not a programmer and cannot
> evaluate the SQL a risk flag refers to. Never gate on a human judgement the human cannot make.

**What it means in practice.** A question is not made safe by being asked. Routing a purely
technical decision to Albert produces a rubber stamp, not a decision, and a rubber stamp is
worse than no gate at all because it launders the risk. AGENTS.md §1 says the same thing from
the other side: the owner reviews behaviour, not code.

**Escalate to Albert:** anything with a business, cost, data-loss, or externally visible
consequence — what the data means, what it is for, who may see it, what it costs, what
production changes.

**Do NOT escalate to Albert:** internal implementation constants, call budgets, retry limits,
test structure, refactors, or any number derived mechanically from measurement. Decide those
with evidence and independent review, and record the derivation.

**A plan or doc sentence that says "return this to Albert" for a technical value is superseded
by this ruling.** Withdraw the clause in place, cite this section, and say who decided instead.
The first application was issue #1812: a plan sentence reserving the reviewer wire-request
ceiling for Albert was withdrawn, because keeping the old ceiling did not preserve an owner
decision — it broke one, refusing 100% of the two-independent-reviewer assignments §4 requires.

### 6.19 OWNER RULING — contact information does not belong in this system at all, except PopCRM routing email (Albert Hazan, 2026-09-06)

> "we shouldn't be importing any contact information into any part of this system except
> email addresses in popcrm to determine routing for emails."
> — Albert Hazan, 2026-09-06

**The rule.** No contact information is imported into any part of this system. Not email
addresses, phone numbers, personal addresses, or any other means of reaching a named person
— for artists, factory or vendor staff, customer staff, or anyone else.

**The one exception.** Email addresses in **PopCRM**, held for the single purpose of
determining routing for outbound email. That exception is bounded by its purpose: it does
not license storing other contact fields alongside those addresses, and it does not extend
to any other application or schema.

**This is stronger than §6.14 and does not replace it.** §6.14 says personal identifiers
must not appear in anything we *write* — documents, issues, commits — because this
repository is public. This ruling says such data must not be *imported into the database*
in the first place, public repository or not. Both apply.

**What it obliges you to do.**

1. Do not add a column, table, staging field, or import mapping that carries contact
   information, and do not accept one from a source feed. If a source supplies it, drop it
   at the boundary rather than landing it and cleaning it up later.
2. When contact information is found already resident, it is removed — not masked, not
   left in place with a note. Removal of an existing column is a structural change and takes
   the normal migration-author route.
3. Historical or frozen data is not exempt. First application: issue #2110, the
   `designflow_frozen_20260710` schema, where the resident contact data was 11 rows of
   `artists.email` plus four never-populated `customers` contact columns.

**Why it matters beyond privacy.** Contact data is the one class of content whose value to
us is near zero and whose cost on exposure is unbounded — it is not part of any business
question this database answers. Keeping it creates an obligation with no corresponding
benefit.

---

## 0.1-A OWNER RULING

> Moved from `AGENTS.md` §0.1-A on 2026-08-20 (issue #1331). Text unchanged.

> "remove from shared-db's own rulebook the rule that says this repo must not connect to Cloud SQL at all."
> — Albert Hazan, 2026-08-10

**What changed.** Until today §0.1 was read across this repo as putting the DesignFlow
production Cloud SQL database entirely out of bounds — no connection, no query, at all.
That reading is **withdrawn**. A shared-db session **may connect to production Cloud SQL
and run read-only queries**, under the conditions below.

**Why.** DesignFlow PLM production is the last environment still on Cloud SQL; every other
DesignFlow environment is already on the shared Supabase project, and the owner has decided
to start moving production over. Three separate migration plans over eight days
([`docs/cloudsql-first-migration-candidate-20260803.md`](../docs/cloudsql-first-migration-candidate-20260803.md),
[`docs/age-group-cloudsql-migration-plan-20260804.md`](../docs/age-group-cloudsql-migration-plan-20260804.md),
[`docs/licensor-property-cloudsql-cutover-plan-20260806.md`](../docs/licensor-property-cloudsql-cutover-plan-20260806.md))
all stalled at the same wall: **nobody has ever looked inside that database**, so every
estimate of effort, downtime and risk was a guess. Reading it is how that stops.

**READ is permitted. WRITE is not.** That is the whole boundary. In detail:

*Permitted:*

- Connecting with a **read-only credential fetched from 1Password vault `vibe_coding` only**.
  Fetch 1Password items **serially** — never fan out `op read` / `op run` / 1Password MCP calls.
  Never write the credential into any file, commit, PR, report, issue, or chat message.
- **The credential must be PROVEN read-only BEFORE you use it.** Check `usesuper`,
  `usecreatedb`, role memberships (`pg_roles` / `pg_auth_members`) and schema/table privileges
  (`has_schema_privilege`, `has_table_privilege`, `information_schema.role_table_grants`).
  **If you cannot prove it is read-only, stop and report.** Never test the question by
  attempting a write. One credential is exempt from this proof, and only one — see §0.1-A.1.
- `SELECT` against `information_schema` and `pg_catalog` only. Nothing that takes a lock
  beyond a plain shared read — no `LOCK`, no `SELECT … FOR UPDATE`, no `VACUUM`/`ANALYZE`,
  no long or unbounded scans. **This is a live production database serving real users.**
- Reporting **counts, object names, data types, sizes, constraints and definitions**.

*Still forbidden — this ruling lifts nothing here:*

- **No DDL and no DML against Cloud SQL from this repo, ever.** Applying schema changes there
  is Uma's job via [`popcre/infrastructure`](https://github.com/popcre/infrastructure);
  issue **#696** is the live example and it stays hers.
- **No Secret Manager IAM, secret versions, or secret repointing.** §0.1 above is unchanged:
  **unsuffixed DB secret IDs are production-only** and are the 2026-07-17 outage boundary.
- **No Cloud Build substitutions or triggers, no Cloud Run bindings, no VPC routing changes.**
- **No changes to the connection contract or `cloudbuild.yaml`** in the four `popcre`
  DesignFlow repos — `popcre` org repos, PRs to `develop`, never self-merged.
- The standing global rules stand untouched: AI sessions are **read-only for production and
  shared cloud infrastructure**; no `terraform apply`/`destroy` against a production GCP
  project; no mutating `gcloud`.

**Never report row contents.** Counts, names, types, sizes and definitions only — never the
values in a row. Issue **#645** exists because vendor emails, phones and addresses were once
published into a repo file. A read permission is not a publication permission.

**This ruling permits reading; it does not require it.** Do not connect unless the task
actually needs a fact only that database holds.

### 0.1-A.1 OWNER RULING — the read-only proof is waived for `albert_read_only`, for reads of the DesignFlow schema and nothing else (Albert Hazan, 2026-08-10, issue #705)

> "ignore the 'read only is not read only' issue."
> — Albert Hazan, 2026-08-10

> "yes, use it to read production."
> — Albert Hazan, 2026-08-10, answering whether that also permits USING the account to read

**The proof rule in §0.1-A stands.** Proving a credential read-only before using it is still
the default and still applies to every other credential and every other database. What
follows is one named, bounded exception, not a relaxation.

**The exception.** Reading the `designflow` schema on the DesignFlow production Cloud SQL
instance with the account `albert_read_only` is permitted, even though that account fails the
attribute test in §0.1-A.

**Why the attribute test fails yet the read is safe.** Check the reasoning rather than
re-deriving it:

- The account holds `SELECT` on **296 relations and ZERO write privileges** in the
  `designflow` schema.
- All **386 relations are owned by `postgres`**, so membership of `cloudsqlsuperuser` is not
  a route to that data.
- For this account, what fails the proof is `rolcreatedb` / `rolcreaterole` / role membership,
  plus `CREATE` on database `postgres` and `CREATE` on schema `public` — the power to create
  **new** objects elsewhere, not the power to write DesignFlow. Those grants are a real
  production-infrastructure exposure and #705 records them; they are simply not a write path
  into `designflow`.
- [`scripts/capture-postgres-schema.sql`](../scripts/capture-postgres-schema.sql) sets
  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, which is why that particular run
  could not have written. It is a session-scoped guard that the same session can reset to
  `READ WRITE`, so it is **never** a substitute for the proof rule for any other credential.

**Boundary. This permits a READ.** It does not permit writes, DDL, DML, creating a read
replica, starting an export, restoring a backup, changing authorized networks, or any
mutation in `lithe-breaker-323913`. It does not generalise to any other credential, any other
database, or any other task. Everything under "Still forbidden" in §0.1-A is unchanged.

**Closure rule — read this before assuming anything is allowed because it is not listed
above.** This exception waives the read-only proof and **nothing else**. Every other condition
in §0.1-A still binds — catalog-only `SELECT`s against `information_schema` and `pg_catalog`,
no long or unbounded scans, and **no row contents read or reported** — and `pg_stats` is row
contents, not catalog metadata, because `most_common_vals` and `histogram_bounds` hold sampled
values from real columns. Catalog-only is the
scope Albert was asked about and the scope he approved. So a row count, a sample row, a
`SELECT` queued by a migration plan (for example
[`docs/parent-child-answers-20260803.md`](../docs/parent-child-answers-20260803.md) or the
age_group plan's Step D1), and a client-side `pg_dump` are all **outside** this exception and
each needs **its own ruling from Albert**. Not from the Cloud SQL instance owner — instance
admin is not business authority here. The list above enumerates; this sentence closes.

**Do NOT fix #705.** Albert ruled the account is to be left alone. Stop proposing privilege
changes for it and do not re-raise it as a blocker.

**Operational specifics — do not rediscover these:**

- **On Cloud SQL the schema is `designflow`, NOT `dflow`.** The direction of the trap matters:
  on **Supabase** production, DesignFlow lives in **`dflow`**, and Supabase *also* has a
  separate schema named `designflow` — a 35-relation decoy. So do not "correct" either name to
  the other. Confirm which host you are on before reading (§4.2).
- Run with `exact_count_max_bytes=0` so the capture reads catalog only and touches no table
  data.
- The credential is in vault `vibe_coding`, item **`tcaf3o3u2cx52g6ivvczxbhola`**
  ("DesignFlow PRODUCTION Cloud SQL - read-only …"). Its title contains parentheses, which are
  invalid in an `op://` reference, so address it by **item ID**:
  `op read 'op://vibe_coding/tcaf3o3u2cx52g6ivvczxbhola/DB_PASSWORD'`. The password is in a
  **custom field named `DB_PASSWORD`**, not `credential`. 1Password item IDs can be re-keyed
  mid-session, so if that ID 404s, re-resolve by title with
  `op item list --vault vibe_coding --format json` (same pattern as §9 of this file).
  Never write the
  value anywhere.

**Evidence.** The completed capture is at
[`verification/cloudsql-designflow-capture-2026-08-10/README.md`](verification/cloudsql-designflow-capture-2026-08-10/README.md);
the ruling and the privilege analysis are on issue **#705**. That capture's README describes
the waiver as "for this capture only" and "not a general waiver"; **this section supersedes
that wording** — the exception is standing, on the terms above.

---

## 4.2 OWNER RULING

> Moved from `AGENTS.md` §4.2 on 2026-08-20 (issue #1331, PR #1212). Text unchanged. The
> operative rule is restated in full in `AGENTS.md` §4.2 so no session has to click through to
> be safe.

**4.2 OWNER RULING — prove which database you are connected to before any destructive statement (Albert Hazan, 2026-08-02)**


> "agents should be required to prove which database they're connected to before any delete or update"
> — Albert Hazan, 2026-08-02

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not
treat it as an AI's preference, and do not weaken it.** (It was raised once before and the
owner did not answer; that non-answer was correctly recorded as *not* approval. He has now
ruled.)

**Why it exists.** It was proposed after a 442-row `DELETE FROM ingest.raw_record` ran
against **production** `qsllyeztdwjgirsysgai` on 2026-07-31 while the session believed it
was on preview. The owner has separately ruled that **that delete was intended and correct
and is NOT an incident** (§6.3) — no restore, no PITR, no corrective migration. The rule
exists because, to everyone watching, a correct delete on production was *indistinguishable
from an accidental one*: nothing in the record proved which database the statement hit. The
rule closes that evidence gap, not a mistake.

**The rule.**

1. **Before every `DELETE`, `UPDATE`, `DROP`, `TRUNCATE`, `ALTER`, or any other statement
   that writes, changes, or removes data, schema, or privileges (including `INSERT`, `GRANT`
   and `CREATE`), or any action that sets such a change in motion indirectly — calling a
   mutating function or RPC, a REST request, a script, a CI workflow, or asking another
   person, including the owner, to run it — in ANY environment, preview and production
   alike, the agent must prove which database the statement is about to run against. One
   proof covers everything submitted in the same tool call as the check or in the
   immediately following tool call (a batch, a migration file, a `db push`); it never
   carries further.** Preview being "the safe one" is not an exemption: the proof
   requirement is unconditional. **§0.0-B does not narrow this.** An application session
   that owns its own data writes still owes the proof on every one of them: §0.0-B decides
   *who authorises* a statement, §4.2 decides *that you know where it lands*. Both bind.
2. **"Prove" means an explicit check of the live connection target, executed immediately
   before the statement.** It is not an assumption, not a memory, not a check made earlier in
   the session, not a `.sql` filename, not a branch name, not a doc, not a plan that said
   "preview". Any tool call, environment change, reconnect, or turn boundary between the
   check and the statement invalidates the check — redo it.
3. **The proof must be stated in the agent's report** — the message it gives the owner (or
   the orchestrator) at the end of the turn — quoting the value it actually
   observed (the project ref or URL) and the statement it authorised. A report of a
   destructive statement without a quoted, immediately-preceding target proof is an
   incomplete report.

**The concrete mechanisms this repo has — use these, not a substitute:**

- **Supabase MCP:** call `get_project_url` **FIRST**, in the same turn, immediately before
  the statement. Note the trap: `get_project_url` takes **no project parameter** — it
  reports whatever project the MCP server is bound to, and in this repo that binding **may
  be PRODUCTION**. Passing a project ref to `execute_sql`/`apply_migration` does not make
  those tools target it; the server binding wins. This is exactly why the check must be a
  call, not an inference.
- **CLI / `psql` / Node `pg` work:** read `cat supabase/.temp/project-ref` and verify it
  **before EVERY push or connection**, not once per session. `supabase link` can be re-run
  by any other step, worktree, or concurrent session, so a ref read ten minutes ago proves
  nothing about the connection you are about to use.

**The two refs, in full — compare against these characters, not against "looks like preview":**

```text
Production: qsllyeztdwjgirsysgai
Preview:    mvpkijzfmfcxhnzqogzs   (Supabase branch "shared-db-schema-rehearsal")
```

⚠️ **`rjyboqwcdzcocqgmsyel` IS THE OLD PREVIEW AND IS DELETED.** It was destroyed and
rebuilt as `mvpkijzfmfcxhnzqogzs` on 2026-08-18, and this block still named it as
current until 2026-08-20 — under a heading telling you to compare against these exact
characters. A session following that literally would have **rejected the real preview as
wrong**. If you find that string anywhere presented as current, it is stale: §4.2 above
and §5 already say it was deleted, and this block disagreed with both of them.

**Preview's ref is CONFIGURED, never a literal.** The authority is the repository
variable `PREVIEW_PROJECT_REF` (`gh variable list --repo u2giants/shared-db`), because
preview gets rebuilt and its ref changes when it does — which is exactly how this block
went stale. Five workflows were once pinned to the deleted ref and could only fail; a
guard now asserts that no workflow carries a literal. **Do the same yourself: read the
variable, do not copy the characters above into anything executable.** They are here to
be compared against, not to be pasted.

**Trap that has misled sessions:** preview is a Supabase **branch**, not a standalone
project, so the preview ref **does not appear in `supabase projects list`**. Its
absence from that listing is evidence of nothing — it is not proof that you are on
production, and it is not proof that preview is gone. Use `supabase branches list` /
`list_branches` if you need to see it, and use the checks above to establish where you
actually are.

---

## 4.3 OWNER RULING

> Moved from `AGENTS.md` §4.3 on 2026-08-20 (issue #1331, PR #1212). Text unchanged.

**4.3 OWNER RULING — issues, handovers and plans point at the LIVE reading, never at a number (Albert Hazan, 2026-08-11)**


> "Create a standing rule that issues point at the live reading."
> — Albert Hazan, 2026-08-11

`HANDOFF.md` already says no document wins by name or by date — re-derive from `git`/`gh`.
That was never written down for **issues**, which is where sessions actually pick up work,
and the cost showed up in one day: #773 said production was **53** migrations behind when a
live read the same day said **57** of 433 files; #712 said "63 behind, now 53" and both
numbers were already wrong; #712's out-of-order example named **one** version pair when the
live read found **48**; #736 claimed to index every open owner decision and was stale by
~14 hours, missing at least four newer issues; and #710/#773 carried a **B3/B4 overlap** —
two versions listed in both batches — that only a live read caught.

**The rule: state the COMMAND that yields the figure, not the figure.**

**What counts as a live figure** — anything `git`, `gh` or a database query can answer right
now: migration file counts; applied and unapplied counts; ledger position; row counts; batch
membership; open issue and PR lists; branch, worktree and SHA state; "max applied version".
If a number would change without anyone editing the document, it is a live figure.

**Quote these commands instead** (these are the ones proven correct):

```bash
git ls-tree origin/main --name-only supabase/migrations/   # migration files on main
gh issue list --repo u2giants/shared-db --label db-work    # open db work
gh pr list --state open                                    # open PRs
```

⚠️ **Never `ls supabase/migrations/`.** The shared checkout is usually parked on another
branch, so `ls` silently reports that branch's files as if they were `main`'s. This exact
error was made on 2026-08-11. Always `git ls-tree origin/main`, after a `git fetch`.

⚠️ **The production ledger is applied OUT OF ORDER.** The highest applied version implies
NOTHING about what is applied beneath it — on 2026-08-11, 48 unapplied versions sorted below
the max applied one. **Any document that reasons from a high-water mark is wrong.** Compare
the two full lists, never the two maxima.

**When a number genuinely must appear** — for human readability, or because it is a decision
input — stamp it and mark it as perishable:

```text
57 of 433 unapplied [SNAPSHOT 2026-08-11T14:20Z — `git ls-tree origin/main --name-only
supabase/migrations/` + `supabase migration list` on production. RE-DERIVE BEFORE ACTING.]
```

A snapshot without the timestamp, the source command and the re-derive marker is a defect —
fix it when you see it. And no session may act on a snapshot it did not re-derive itself.

⛔ **Do not propose a CI check that compares documents to GitHub issues.** It has been
proposed twice, built once (B13) and deleted once, and three models re-reviewed it on
2026-08-13 and rejected every variant. The reasoning, the verified false-positive rates and
the one narrower check that could earn its place later are in
[`docs/artifact-consistency-checker-rejected-20260813.md`](../docs/artifact-consistency-checker-rejected-20260813.md).
The mitigation for unsourced figures is this section plus the plan standard's rule that a
status row marked done must cite an artifact, never a bare number.

### 6.20 OWNER RULING — the Peanuts property is the ART PROGRAM, not the retailer initiative; and WildBrain's era and creative group are two axes, not a choice (Albert Hazan, 2026-09-07)

Given on shared-db issue #1275, which asked which vocabulary table is the "property-shaped
entity" for the licensor scrape families. Recorded in full at issue #1275; this section is the
durable copy. No licensor values appear here — this repository is public (§6.14).

#### The correction that came first: we capture METADATA, not art

> "ai or our software doesn't yet download the actual art files in the style guide yet.
> We're only collecting metadata."
> — Albert Hazan, 2026-09-07

Every `plm.<licensor>_asset` row is an **asset metadata record**. No art binary is downloaded
or stored by any capture. Anything in this repository that says we "capture assets" means
metadata, and any design that assumes a stored file, a checksum over art bytes, or a
content-addressed identity is wrong on its face.

**Consequence that must not be lost.** A change signal built on portal-published metadata
cannot detect art replaced in place under an unchanged file name with unchanged metadata.
That failure mode is one of the three motivations #1275 states for its incremental design. The
issue's own "Why" section names all three in one sentence — *"Licensors add guides, replace art in
place under the same file name, and withdraw assets"* — and this ruling means the design does
**not** solve the middle one. The other two, additions and withdrawals, are unaffected. Do not
overstate this in either direction: the design is not useless, and it is not complete.

(The sentence is quoted here so this claim can be checked from the repository alone. A reviewer
working from a checkout cannot read a GitHub issue body, and a durable ruling should not rest on
a source its reader cannot open.)

#### Peanuts: the art program is the property

> "99% of the time we're designing product using 'what the art looks like'. retailer-specific
> style guides are exactly that: tied to only one specific retailer and only for a certain
> time period. we barely use those."
> — Albert Hazan, 2026-09-07

`plm.peanuts_art_program` is the durable, property-shaped entity. `plm.peanuts_initiative` is
retailer- and period-bound and is a **secondary tag** — retained and searchable, never the
parent an asset belongs to.

**Design consequence.** An initiative is *expected* to stop appearing when its retail window
closes. That is normal retirement, not withdrawal. A lifecycle rule that marks a vanished
initiative `withdrawn` under the marked-never-deleted principle (owner ruling 2026-08-19,
recorded on issue #1275, not in this file) will raise a false alarm every season and must not be
written.

#### WildBrain: era and creative group are orthogonal — the earlier question was malformed

> "those are 2 completely different things, not things that are mutually exclusive.
> Your question is like asking 'what do you like better, orange juice or greek mythology'.
> There are 'Classic' Style Guides, '2003' Style Guides, 'Berry in the Big City' Style
> Guides, etc."
> — Albert Hazan, 2026-09-07

`plm.wildbrain_era` (which version of the property) and `plm.wildbrain_creative_group` (what
kind of document) are **two independent axes**. The framing
recorded on #1275 on 2026-08-20 — "`era` vs `creative_group`" — presented them as competing
candidates and is **withdrawn**.

The live catalog already agrees: `plm.wildbrain_asset` carries **both** `era_source_id` and
`creative_group_source_id`.

**But the two axes are not symmetric, and the schema says so.** In
`supabase/migrations/20260819014639_wildbrain_dam_source_landing.sql`, `era_source_id` is
`not null` (line 448) while `creative_group_source_id` is nullable (line 449), and its index is
partial on `is not null` (lines 507-508). Every asset carries exactly one era; an asset may carry
no creative group at all. Do not write "every guide has one of each" — it is false.

**Design consequence.** Both tables are durable entities and both take lifecycle columns.
Era is the property-shaped entity wherever a single parent is required, and it is the mandatory
axis; creative group is an optional document-type dimension — independent of era, not a child of
it, and not of equal standing.

#### The general lesson this ruling encodes

Two vocabulary tables sitting side by side in one licensor family are **not** presumptively
alternatives. Before asking the owner to choose between them, check whether the entity table
carries foreign keys to both — if it does, the answer is "both", and the question is
malformed. Asking it anyway spends owner attention to obtain a wrong answer, and a wrong
answer recorded as a ruling outlives the session that took it.

#### Not decided here

Sesame Workshop's equivalent question is **not** answered. All five `plm.sesame_*` vocabulary
tables are empty — the schema landed under `20260819212002` but no capture was ever loaded.
A property decision taken against zero rows is a guess dressed as a ruling. It follows the
first real Sesame load. Do not put it to the owner before then.

The remaining #1275 decisions — snapshot-row identity, join-row lifecycle meaning, DCP
metadata-run baselines, Warner chunk-addressed baselines, and the bulk-withdrawal coverage
contract — are engineering decisions and are **not** owner decisions (§6.18).

### 6.21 OWNER RULING — no new direct database logins (Albert Hazan, 2026-09-23)

No new database LOGIN roles, except for trusted in-house server services. Everything else reaches
the database through the Data API with row-level security, or through edge functions. The full
rule, Supabase's refusal to change the managed `net` schema, and the reviewed exception for the
four DesignFlow services (issue #2873) are in
[`docs/security/pg-net-direct-login-rule.md`](security/pg-net-direct-login-rule.md).
Per §6.18, the technical risk judgement behind the exception is an engineering review
(Qwen 3.8 Max, APPROVE, 2026-09-23), not an owner sign-off.

### 6.22 OWNER RULING — no independent production reviewer identity (Albert Hazan, 2026-09-28)

Verbatim from Albert's chat (about 11:00 AM EDT, 2026-09-28, recorded on #3656): "i don't need
an independent production reviewer. remove that requirement". The separately registered
independent reviewer identity for manual production recovery (the roster, workflow and v3 record
added by #3641) is removed. This supersedes, for this repository, the 2026-09-16 rule that routed
every technical production approval to a separate independent reviewer. Still required: the
allocator-assigned exact-head AI review APPROVE on the source pull request, exact-main binding,
ordered allowlist, preview proof, target proof, business-risk evidence and the production
environment boundary. See `docs/production-promotion-procedure.md` step 2.

### 6.23 OWNER RULING — Albert is not a technical reviewer; production risk classes are accepted by the AI reviewer (Albert Hazan, 2026-09-30)

Verbatim from Albert's chat (2026-09-30): "i am non-technical and unqualified to answer technical
questions. as a reviewer. now and in the future". Read with the 2026-09-28 ruling "never ask a
human to approve".

Consequence for the automatic production promotion lane: the risk classes the business-risk gate
derives from SQL text (`material_access_change`, `permanent_data_rewrite_or_loss`,
`expected_downtime`) are no longer accepted through a `production-owner-decision` block from
Albert (precedent #3282 is retired for new use). They are accepted only by the allocator-assigned
AI reviewer's durable exact-head APPROVE on the source PR whose findings contain one
`production-risk-assessment` block naming the exact promoted main SHA, the exact ordered versions,
the source PR, and a written assessment of every flagged class
(`scripts/prove-production-risk-acceptance.mjs`). `recovery_unproven` and
`unresolved_material_objection` are never accepted by anyone. Every other gate is unchanged: exact
main, ordered allowlist, preview or ephemeral evidence, hard blocks, production lock, target proof
and post-apply verification. Never ask Albert a technical question, and never author or forge a
comment in his name.

### 6.24 OWNER RULING — documentation-only changes skip checks (Albert Hazan, 2026-10-02)

Verbatim from Albert's chat (2026-10-02), answering "should documentation-only changes in the
database repository be allowed to skip checks?": "yes, let doc-only changes skip checks." His
standing rule: "if every changed file is prose, merge immediately; any code, test, script,
workflow, or config file means normal checks."

How it is honoured here: no `--admin` merge and no weakening of branch protection. A prose-only
pull request goes through the merge queue like any other, and every required context reports
success within seconds because the trusted base-only classifier
(`scripts/lib/documents-only-change.mjs`, `Documents fast CI route`, `Documents-only merge
authorization`) proves the exact base/head inventory is pure prose and the heavy jobs
short-circuit under their unchanged check names. Anything not positively proven prose — code,
tests, scripts, workflows, config, `.json`/`.yml`/`.sql`, and agent rulebooks such as `AGENTS.md`
or skills — takes the full engineering path. `enforce_admins` stays on.

### 6.25 OWNER RULING — AI sessions launch the merged-preview run that starts automatic promotion (Albert Hazan, 2026-10-02)

Verbatim from Albert's chat (2026-10-02): "let AI launch it and remove that rule permanently."

Guarded merge does not start the merged-main preview rehearsal, and the automatic production
promotion only starts from that run. The earlier standing rule barred any "session-made workflow
dispatch", so an approved, merged change could sit unpromoted. That bar is removed permanently
(popcre/ai-devops#1255). Any AI session may, for an approved and merged change, run
`ai-task-gates check --before shared-db-promotion` in this checkout and then dispatch
`shared-supabase-migrations.yml` on `main` with `target=preview`, `mode=apply` and
`merged_preview_source_pr=<merged PR>`. Every gate the run and the production job apply is unchanged:
exact-head durable verdict, guarded-merge status, single admitted work issue, preview evidence,
the business-risk gate with the reviewer `production-risk-assessment` block (§6.23), the production
lock, the fresh dry-run and post-apply verification. A refusal is fixed at its cause, never
bypassed. This ruling authorizes no manual production dispatch or command.

### 6.26 OWNER RULING — one reviewer may be used twice, and merges pause during production runs (Albert Hazan, 2026-10-02)

Verbatim from Albert's chat (2026-10-02):

> "there are more than 2 reviewers working on this machine. find another one. and if you can't
> then you'll have to be ok with using one reviewer twice. we can't just sit here doing nothing.
> you need to be much more aggressive about moving everything forward"

> "assign someone to pause merges during production runs"

**Reviewer reuse.** Only for review slot 2 or higher on a pull request that is already **merged**
at the exact reviewed head (the post-merge production-risk-assessment slot), with that merged
state proven through the verified merged-PR issue binding (`SHARED_DB_MERGED_PR_ISSUE_BINDING`).
The allocator still prefers any independent reviewer; only when none is left may
`--assign-reviewer` or `--replace-failed-reviewer` (both retired by #5409) draw one that already holds another slot on
that head, in the ordinary rotation order. It never draws a reviewer that failed on this head, is
unusable or preflight-excluded, conflicts with the implementing engine, or is retired. Both
approval gates, `assertDurableReviewApproval` and `scripts/check-exact-head-approval.mjs` (the
automatic-promotion re-proof), accept that shared reviewer only when the pull request is merged
(not open) at the exact head. Once every independent reviewer is used, a reviewer may be reused
for more than one later slot; slot 1 is not kept independent of slots 2 and above collectively. Open pull requests keep strict slot independence. Code:
`mergedPrReviewerReuseAllowed` in `scripts/lib/lanes/review-approval.mjs` (re-exported through `scripts/manage-migration-coordination.mjs`).

**Promotion merge freeze.** Cap: 60 minutes. Owner rule, Albert Hazan in his chat 2026-10-21 (verbatim): "no session is allowed to freeze merges for more than 1hr. that's the new rule" `--acquire-promotion-freeze --issue <n> --pr <n> --owner <text>
--ttl-minutes <1-60>` sets the create-only ref `refs/db-coordination/promotion-freeze` before the
risk assessment is drawn. While it is live, `--acquire-merge` (guarded merge and merge-queue gate)
and repository-maintenance authorization refuse, naming the holder and expiry. It never blocks
preview or production. It expires by TTL, so it cannot wedge merges (a corrupt, unreadable freeze record
fails closed until someone releases it with `--release-promotion-freeze --pr <n>`; any positive PR
number releases an unreadable record, by design, so it can never wedge merges); `--release-promotion-freeze
--owner <text>` (or `--pr <n>`) ends it, and the production job's always() cleanup releases the
freeze for its source PR. Release ownership is an accident guard, not a security boundary: the production
job must be able to release a freeze it did not set.

### 6.27 OWNER RULING — one independent review is enough for every change (Albert Hazan, 2026-10-14)

Verbatim from Albert's chat (2026-10-14):

> "change the rules so that we don't need 2 reviews"

**Effect.** scripts/check-exact-head-approval.mjs requires **one** independent exact-head APPROVE for every pull request, including migrations. The former two-slot migration minimum is retired. No gate, test or helper may demand two slots. A drawn slot still owes its own APPROVE; a returned or refused slot is never revived. Branch protection is never disabled.

Posted by MiMo chat ffe5ed27-27a0-dffe-92fd-227bed167df0 on EDGE-DEV
