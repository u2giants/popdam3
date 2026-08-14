---
issue: 958
status: OPEN
owner: claude/handoff-scrape-normalization
---

# Scrape landing-table normalization, ColdLion source rulings, and the licensing-manager gate

**Written:** 2026-08-14T13:46Z
**Machine:** al8960ofc (Windows 11, user `ahazan2`)
**Agent:** claude (Opus 5)
**Branch worked on:** `claude/supabase-licensors-properties-45590c`, but every change
shipped through its own short-lived branch and PR to `main`. Nothing of value is left on
that branch.
**Repo:** `u2giants/shared-db`

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in **ONE message before starting work**. Do not trickle
them out one at a time.

### Blocking — work cannot correctly proceed without an answer

Nothing is hard-blocked right now. Everything below is either recoverable-if-guessed-wrong
or outside this workstream.

### A wrong guess is recoverable but wastes work

1. **Warner legacy cleanup — who does it, and when?** Warner has TWO generations of
   landing tables. The old flat ones (`plm.wb_property_character`, `plm.wb_character`,
   `plm.wb_franchise_property`) are retired but still exist, still have live functions
   pointing at them (`plm.sync_wb_property_character`, `plm.begin_wb_capture_legacy`,
   `plm.finalize_wb_capture_legacy`), and are all empty. A future session will put data in
   the wrong tables if this is left. **Recommendation:** send the prompt in §6 step 1 to
   the Warner session and let that workstream retire its own legacy path — do not drop
   those tables from outside it. Albert asked for that prompt to be written; it is in §6.

2. **Paramount audit — do we act on what it finds, or just report?** §6 step 4 asks a
   fresh session to audit Paramount's schema. Paramount looks like the best-normalized of
   the four and is the model the others are being moved toward, but it has NOT been
   audited properly (see §9). **Recommendation:** audit and report first, change nothing
   until Albert sees the findings — Paramount is live with 119,304 assets.

3. **COCO re-check after Disney resolution.** Albert ruled on 2026-08-13 that COCO belongs
   under DISNEY. `core.property` already says that, so nothing was changed. Once Disney's
   properties are resolved to `core.*`, the Disney source itself can confirm or contradict
   that ruling. **Recommendation:** re-check then, and tell Albert either way rather than
   silently keeping the ruling.

### Not part of this work, and nobody is on it

4. **`plm.taxonomy_resolution_review` has no "we told someone" state, and nothing is
   driving it.** Issue #941 proposes adding notification/upstream-fix columns. Its only
   motivating item (COCO) was closed without an upstream push. **Recommendation:** leave
   #941 open but de-prioritised; it becomes real the next time a source we do not control
   is proven wrong.

5. **A DesignFlow-sourced edge re-seed would silently undo the COCO ruling.** DesignFlow
   still says COCO's parent is `ZZ` (DTR - NO LICENSE). A ColdLion pull cannot touch it
   (§7 rule), but re-running a DesignFlow edge seed would. Nothing currently records
   "this parent was set by an owner ruling, do not overwrite". **Recommendation:** before
   any edge re-seed, add that marker. This is cheap now and expensive after it silently
   reverts.

6. **Preview is materially behind production.** Issue #901 says preview was 10 migrations
   behind. That makes preview rehearsals weak evidence. I worked around it by applying each
   migration to preview explicitly by version. **Recommendation:** have a session reconcile
   preview before the next large change.

7. **Warner has landed zero rows and its loader was never written** (issue #900). This is
   the single biggest gap in the master-data programme — see §5. **Recommendation:** make
   it the next substantial piece of work after this handoff.

### Already settled — do NOT re-ask

| Settled | Date | Ruling |
|---|---|---|
| COCO's licensor | 2026-08-13 | DISNEY. `ZZ` is an upstream mistake. `core.property` is already correct. |
| Whether to push the COCO correction upstream | 2026-08-13 | No. The wrong value is not in ColdLion, so correcting it on our side is enough. |
| Scrapes vs internal systems | 2026-08-13 | Scrapes win — they come straight from the source. Limits in §7. |
| Licensing-manager access | 2026-08-13 | Do NOT grant `administrator`. Wire the existing `licensing` role. DONE and live. |
| Junction table for licensor→property | 2026-08-13 | No. It is a true one-to-many; `core.property.licensor_id` stays a single foreign key. |
| Whether the ColdLion pull may write `licensor_id` or `status` | 2026-08-13 | Never. It writes name/code only, and never deletes. |

---

## 1. What this application is

`u2giants/shared-db` is the canonical repository for the **shared Supabase database**
(project ref `qsllyeztdwjgirsysgai`) used by several POP Creations applications: PM/PIM
(`poppim-web`), CRM (`popcrm-web`), DAM (`popdam3`), and the six `popcre/designflow-*` PLM
repos. Its whole contents are mirrored read-only into a `shared-db/` folder inside every
consumer repo on each push to `main`.

Two things in it matter for this handoff:

- **DB Data Admin** — a React app in `apps/db-data-admin/`, served at
  `https://data.designflow.app`. It has tabs for Customers, Vendors, Licensors, Properties
  and Product Depth. The Licensors and Properties tabs both read one database function,
  `api.db_data_admin_licensor_property_tree`.
- **The `plm` schema** — landing tables for data scraped from licensor portals (Disney,
  NBCUniversal, Paramount, Warner) and mirrored from the ColdLion ERP.

Business context: POP Creations sells licensed merchandise. A **licensor** is the rights
holder (Disney, Warner). A **property** is a title or brand under that licensor (FROZEN,
BATMAN). A **character** belongs to properties. **ColdLion** is the ERP that runs the
actual business; **DesignFlow** is the PLM system. Both are internal bookkeeping. The
licensor portals are the authority on what a property actually is.

---

## 2. What we set out to do this session, and why

It started as a question: *do we have tables showing licensors, properties and their
relationships in Supabase, as they exist in DesignFlow?* It expanded, through Albert's
follow-ups, into six pieces of work:

1. Establish what switching `core.licensor` / `core.property` from a stale one-time
   DesignFlow pull to the live ColdLion API would actually break.
2. Establish whether the licensor→property relationship is stored correctly.
3. Write the target state down so future sessions stop re-deriving it.
4. Give a named user access to the mapping screen without making them an administrator.
5. Normalize Disney's OPA capture, which had landed richly but in an unusable shape.
6. Check the other scrapes for the same problem.

---

## 3. Current state — what is true right now

### Shipped, applied to PRODUCTION, and verified live

| Migration | What it does | Verified |
|---|---|---|
| `20260814000000_licensing_manager_gate.sql` | Adds `app.require_licensing_manager_access()`; re-gates `api.db_data_admin_licensor_property_tree` onto it | Gate function exists; tree function calls it; version in ledger |
| `20260814030000_source_capture_inventory.sql` | Adds `api.source_capture_inventory` view + warning comments on 3 tables | Returned real counts across all sources |
| `20260814040000_opa_property_character_normalize.sql` | Creates `plm.opa_property` / `plm.opa_character`, backfills, makes the flat table a link table | 1,445 / 9,613 / 10,262 rows; 609 multi-parent characters preserved |
| `20260814050000_nbcu_link_labels_deprecated.sql` | Drops `NOT NULL` on the duplicated labels in `plm.nbcu_property_character` | Both columns now nullable |
| `20260814060000_opa_link_ensure_entities.sql` | Trigger that auto-creates entity rows for any link insert | Trigger present on the table |

All merged to `main` and applied through the bounded promotion workflow (preview apply →
production dry-run → review evidence → production apply). Nothing is left uncommitted or
unpushed.

### Access granted on production

`app.profile` **`8f383a14-f303-4890-90a2-80306a2d4665`** (Laura) now has the `Licensing`
role and `plm` application access. Verified reading `Designer,Licensing` / `plm,crm`. She
was **not** given `administrator` or `admin`.

### Documentation

`docs/core-master-data-consolidation-aim.md` is the canonical destination document. It went
through PRs #932, #934, #937, #940, #942, #948. It contains the target model, the six
settled ColdLion conclusions, the scrapes-win ruling, the coverage figures, the upstream
correction rules, and the current gap analysis. `AGENTS.md` links it and carries a new
standing rule about empty tables (§5).

### Skills updated

- `disney-source-data-scrape` — updated in `u2giants/ai-devops` commit **`e773fcd`**.
  Landing section names the three OPA tables; the facts section carries three corrections.
- `nbcu-creative-assets-scrape` — **NOT updated. This is an open task (§6 step 3).**
- `wb-starlabs-scrape` — checked, needs nothing: it names no landing tables.

### Issues

| Issue | State | Meaning |
|---|---|---|
| #933 | OPEN | Reconcile `core.property` licensor edge against live DesignFlow. Fully specified, ready to execute. |
| #935 | CLOSED | Licensing role — shipped this session. |
| #941 | OPEN, de-prioritised | Upstream-correction tracking columns. |
| #953 | OPEN | Disney loader must write the new tables. **Does not tell them to close it — see §6 step 2.** |
| #900 | OPEN | Warner loaders never written. The biggest remaining gap. |
| #901 | OPEN | Preview behind production. |

### Not started

- Paramount schema audit.
- Warner legacy cleanup.
- The mapping function itself (the actual end deliverable) — still only a specification in
  `docs/core-master-data-consolidation-aim.md` §4.
- Consolidation of any scrape into `core.*`. `core.style_guide` and `dam.asset` are empty.

---

## 4. Everything we tried that did NOT work

**Read this section. Three of these cost real time and one of them broke production
briefly.**

### 4.1 I reported "Warner and Disney landed zero rows". It was wrong for Disney.

I counted `plm.dcp_property` and `plm.wb_property`, found both empty, and told Albert
Disney had landed nothing. Disney had in fact landed **156,644 assets** in `plm.dcp_asset`,
2,967 style guides in `plm.dcp_style_guide` and 10,262 rows in
`plm.opa_property_character`. I also understated Paramount and NBCU by roughly 230,000 rows
by counting entity tables and ignoring asset tables.

**Why it happened:** table names do not reliably indicate where a loader writes.
`plm.dcp_property` is a resolution table that fills later; the Disney loader writes
elsewhere entirely.

**The fix, already shipped:** `api.source_capture_inventory`. Never guess a landing table
again:

```sql
select * from api.source_capture_inventory order by source_system, row_count desc;
```

### 4.2 I broke the OPA loader on production with my own foreign keys

Migration `20260814040000` added FKs from `plm.opa_property_character` to the new entity
tables. `plm.sync_opa_property_character()` inserts link rows directly and knows nothing
about those tables, so **any new property or character would have failed on the next
capture**. The backfill covered every existing row, which is precisely why it looked fine.

**Why I missed it:** I searched for functions referencing `wb_property_character` and
`nbcu_property_character` and never searched for an OPA loader function.

**Caught by:** `supabase/tests/opa_property_character_importer_contracts.sql` and
`opa_property_character_landing_contracts.sql` in CI — **not** by me, and note that this
test is NOT in the required-checks list, so PR #954 merged while it was red.

**Fixed by:** `20260814060000`, a BEFORE INSERT/UPDATE trigger that upserts both entity
rows. A trigger rather than a loader edit, so every writer is repaired at once and
"entity before link" stops being a rule anyone has to remember.

### 4.3 Three failed attempts at a self-test inside that fix

The trigger migration ended with a self-test that inserted a link row. It failed three
times in CI, each failure revealing the next constraint:

1. `null value in column "brand_property_id"` — it is `NOT NULL`.
2. `null value in column "entitlement_scope"` — also `NOT NULL`.
3. `violates check constraint "opa_property_character_lob_chk"` — line-of-business CHECK.

**Lesson:** an insert self-test inside a migration has to satisfy every business
constraint on the table, which makes it a brittle duplicate of the contract tests.
Replaced with a structural assertion that the trigger exists; the functional proof lives in
`supabase/tests`, where it belongs.

### 4.4 A migration that used `min()` on a uuid

`20260814040000` first failed on preview with `function min(uuid) does not exist`. Fixed
with a `::text` round trip.

**Important precedent:** I edited the merged migration file in place rather than writing a
fix-forward. That is normally forbidden. It was correct here **because I first proved the
migration had applied nothing** — `plm.opa_property` and `plm.opa_character` were absent
and the version was not in `supabase_migrations.schema_migrations`, so the transaction had
rolled back cleanly and there was no applied copy to diverge from. **Always prove that
before editing a merged migration.**

### 4.5 Two workflow traps that cost round trips

- **`review_artifact_digest` must be `sha256:<64 hex>`.** The log prints the bare hex.
  Passing it bare fails with "artifact digest must be canonical sha256:...".
- **`reviewed_main_sha` must be the LIVE `main` SHA**, not your local `origin/main`. My
  local copy was stale and the evidence run failed. Use
  `gh api repos/u2giants/shared-db/commits/main --jq .sha`.

### 4.6 I claimed Warner had the same flat-table problem. It did not.

I based that on `plm.wb_property_character`. Warner had **already been normalized** on
2026-08-13 by `20260813230000` / `20260813231000` (issues #925/#929). What I was looking at
is the retired generation. Checking before acting is what caught it — see §6 step 1.

### 4.7 Pushing to `ai-devops` while another session held the tree

`ai-devops` had uncommitted work from another session (`AGENTS.md`, several `bin/` files).
A plain pull/rebase would have disturbed it. I created a temporary detached worktree from
`origin/main`, cherry-picked my commit there, pushed, and removed the worktree. **Use that
pattern** — never stash or rebase over another session's files.

---

## 5. Root causes and key findings

### 5.1 The Licensors and Properties tabs serve a stale snapshot

Both tabs call `api.db_data_admin_licensor_property_tree`, which reads only `core.licensor`
(26 rows) and `core.property` (256 rows). Those were loaded once from DesignFlow's
`merchGroup` table in June 2026. **`ingest.sync_run` has never recorded a `designflow_plm`
run**, and `plm.licensor_import` / `plm.property_import` are empty. The function itself
reports `feeder_available: false` on every load.

### 5.2 What the live ColdLion API actually provides

Measured 2026-08-13 against `http://x5.coldlion.com/EhpApi`, divisions `CW001` and `SP001`
(licensed divisions; `EH001`/`EP001` are fetched for the header dictionary only):

- 28 licensors, 300 properties, identical in both divisions. Newest change 2026-08-11.
- **No parent-licensor field. No active/inactive flag** (`mgCategory` empty on every row).
- Endpoint list has **no relationship, parent or hierarchy endpoint at all**.
- `mgCode2` and `itemNoCode` are legacy two-character codes and are **worse** keys than
  `mgCode` — 300 property rows carry only 264 distinct `mgCode2` values.
- The match key is `companyCode/divisionCode/mgTypeCode/mgCode`. Because type is in the
  key, `FR` as a licensor and `FR` as a property cannot collide.

### 5.3 The licensor→property edge is a true one-to-many

Live DesignFlow production (Cloud SQL, see §8), read 2026-08-13: **513 parent edges over
266 distinct properties, and ZERO properties with two different licensors.** So
`core.property.licensor_id` as a single foreign key is correct and a junction table would
be wrong. The parent link is a **DesignFlow** field, not a ColdLion one —
`designflow-data-syncing` declares `parent_id` on its `merchGroup` model but never writes
it from any sync path.

Canonical is missing **10** of those 266 edges (issue #933): `CHR`, `EX`, `LB`, `SGT`, `MY`,
plus `DCR`/`DHM`/`DMT`/`DPB` which need a new licensor `DMC` created first, plus `GW` which
is **not** a new property — it is OVER THE GARDEN WALL, already canonical as `OGW`, so it
is a duplicate-code merge.

### 5.4 The Supabase `dflow.*` mirror is seven weeks stale

Its newest row changed **2026-06-26**. Seeding the edge from it would rebuild the exact
staleness the programme exists to fix. **Read live DesignFlow Cloud SQL instead** (§8).

### 5.5 Scrape coverage — the real numbers

| Source | Assets | Properties | Characters | Style guides |
|---|---|---|---|---|
| Disney | 156,644 | 1,445 | 9,613 | 2,967 |
| Paramount | 119,304 | 254 | 228 | 1,928 |
| NBCU | 113,331 | 249 | 190 | 461 |
| **Warner** | **0** | **0** | **0** | **0** |

Three distinct gaps, previously conflated:

1. **Warner has landed nothing** — the only true "loader never written" case (#900).
2. **Disney landed richly but was not normalized** — now fixed by this session.
3. **Nothing has reached `core.*`** — `core.style_guide` and `dam.asset` are both empty.

### 5.6 What the OPA data actually looks like

Measured before designing the normalization:

- 10,262 rows and 10,262 distinct `(licensed_property_id, character_id)` pairs — the
  natural key was already clean.
- 1,445 property IDs / 1,444 names, and 9,613 character IDs / 9,591 names. **Two properties
  and 22 characters legitimately share a display name.** Every ID maps to exactly one name.
  So IDs are safe keys and names are never identity.
- **609 character IDs appear under more than one property.** Property-to-character is
  genuinely many-to-many. This is why `plm.opa_property_character` **must never be
  deleted** — those extra parents exist nowhere else.
- 24 properties carry more than one `brand_property_id`, so it is a property of the pair
  and stays on the link row.

The Disney skill previously said character identity is "scoped by Property", which invites
a per-property character row. That was wrong and is now corrected in the skill.

### 5.7 State of each scrape's schema shape

| Source | Entity tables | Link table | Verdict |
|---|---|---|---|
| Paramount | `pmt_property`, `pmt_character` | `pmt_property_character` — IDs only | Best of the four; **not yet audited** |
| NBCU | `nbcu_property`, `nbcu_character` | `nbcu_property_character` — carries duplicate labels | Labels now nullable; columns still to drop |
| Disney | `opa_property`, `opa_character` (new) | `opa_property_character` — deprecated name columns remain | Normalized this session |
| Warner | `wb_property`, `wb_character_normalized`, … | `wb_property_character_normalized` | Already normalized 2026-08-13; **legacy generation still present** |

---

## 6. Exact next steps

### Step 1 — Send this prompt to the Warner (STARLABS) scrape session

Albert asked for this prompt specifically. Send it as-is. Do **not** drop Warner's legacy
tables from outside that workstream — live functions still reference them.

```text
Warner's landing schema has two generations live at once, and that will cause someone to
load data into the wrong tables. Please retire the old one.

Current generation, from migrations 20260813230000_wb_normalized_source_schema.sql and
20260813231000_wb_normalized_loaders_and_capture.sql (issues #925/#929):
  plm.wb_franchise, plm.wb_property, plm.wb_character_normalized,
  plm.wb_style_guide_normalized, plm.wb_property_character_normalized,
  plm.wb_asset_normalized, plm.wb_asset_character_normalized,
  plm.wb_asset_style_guide_normalized, plm.wb_asset_franchise_property

Retired generation, still present and all EMPTY:
  plm.wb_property_character, plm.wb_character, plm.wb_franchise_property,
  plm.wb_asset_character, plm.wb_asset_property, plm.wb_asset_style_guide, plm.wb_asset

Still-live legacy code paths pointing at them:
  plm.sync_wb_property_character, plm.begin_wb_capture_legacy,
  plm.finalize_wb_capture_legacy

What we are asking for, in this order:
1. Confirm in writing that every column of value in the retired tables exists in the
   current generation, naming any that do not. All the retired tables are empty today
   (verify with: select * from api.source_capture_inventory where source_system='warner'),
   so this is about SHAPE, not data - but confirm rather than assume.
2. Drop the legacy functions, or rename them with a _retired_ prefix if something still
   calls them. Say which and why.
3. Drop the retired tables in the same migration, so the two cannot drift apart.
4. If any retired table must survive, add a COMMENT ON TABLE saying exactly what it is,
   why it survived, and which table to use instead. An empty table with no comment is
   what causes a future session to load into it.

Two pieces of context that justify the urgency:
- On 2026-08-13 a session (me) counted plm.dcp_property, found it empty, and told the
  owner "Disney landed zero rows" while 156,644 Disney assets sat in plm.dcp_asset.
  Empty look-alike tables actively mislead. Warner now has seven of them.
- Use api.source_capture_inventory (added 2026-08-14) rather than guessing table names.
  It gives exact live counts per source, straight from the catalog.

Warner is the one source that has genuinely landed nothing (issue #900, loaders never
written). Retiring the old shape before data arrives is free now and expensive later.
```

**You will know it worked when:** the Warner session replies confirming the shape check,
and a migration lands that removes or clearly comments every retired table, and
`api.source_capture_inventory` shows only the current-generation `wb_*` tables.

### Step 2 — Tell the Disney session to close #953

**Gap found while writing this handoff: issue #953 does NOT tell them to close it.** It
explains what to change but never states the closing condition. Post this comment on
[#953](https://github.com/u2giants/shared-db/issues/953):

```text
Closing condition for this issue, which the original body did not state:

Close #953 when BOTH are true:
1. The OPA loader writes display names to plm.opa_property and plm.opa_character, and
   writes only the ID pair plus brand_property_id to plm.opa_property_character.
2. It has stopped writing property_name, character_name and property_id on the link
   table.

Comment here when that ships and we will drop those three deprecated columns. Until you
comment, they stay, because dropping them while you still write them would break your
next capture.

You do not need to order your inserts. A BEFORE INSERT trigger
(plm.opa_link_ensure_entities, migration 20260814060000) creates any missing entity row
from the names you send. If you send no name and the entity does not exist you get an
explicit error naming the missing ID.
```

**You will know it worked when:** the comment is on #953 and the Disney session
acknowledges it.

### Step 3 — Update the NBCU skill

**Not done this session.** The skill is `nbcu-creative-assets-scrape`, at
`C:\Users\ahazan2\.claude\skills\nbcu-creative-assets-scrape\SKILL.md` on this machine, and
canonically at `skills/shared/nbcu-creative-assets-scrape/SKILL.md` in `u2giants/ai-devops`.

Add to its landing section:

- `plm.nbcu_property_character` is a LINK table. Write `property_key`, `character_key`,
  `evidence_type`, `evidence_value` and the capture/source columns.
- **Stop writing `property_label` and `character_label`.** They duplicate
  `plm.nbcu_property.property_label` and `plm.nbcu_character.character_label`. They were
  `NOT NULL` until 2026-08-14 so the loader had no choice; migration `20260814050000`
  made them nullable precisely so it can stop. They will be dropped once it has.
- Read labels by joining the entity tables, never from the link row.

Then edit BOTH copies (the machine copy and the `ai-devops` copy) and push `ai-devops`.
**If `ai-devops` has uncommitted work from another session, use the detached-worktree
push pattern in §4.7 — do not stash or rebase over it.**

**You will know it worked when:** both copies contain the new wording and
`git log origin/main -1` in `ai-devops` shows your commit.

### Step 4 — Audit Paramount's schema

Albert asked for this explicitly: *"take another look at paramount to make sure its schema
is perfect and perfectly normalized."* It has NOT been audited — I only observed in passing
that `plm.pmt_property_character` carries IDs and no labels, which is why I called it the
model. That is not an audit.

Paramount is live with 119,304 assets, so **audit and report before changing anything.**

Tables to examine (get the current list from
`select * from api.source_capture_inventory where source_system='paramount'`):
`pmt_property`, `pmt_character`, `pmt_property_character`, `pmt_collection`,
`pmt_property_collection`, `pmt_asset`, `pmt_asset_property`, `pmt_asset_character`,
`pmt_asset_brand`, `pmt_asset_collection`, `pmt_asset_franchise`,
`pmt_asset_metadata_value`, `pmt_authorized_property_asset`,
`pmt_authorized_title_property`, `pmt_property_franchise_evidence`,
`pmt_property_capture_log`, `pmt_capture_batch`.

Check, for each:

1. **Duplicated attributes** — does any link or asset table store a label/name that
   already lives on an entity table? That is the NBCU flaw.
2. **Foreign keys actually present**, not just implied by naming. NBCU had them; check
   Paramount does too.
3. **Orphans** — every link row resolves on both sides.
4. **Identity** — is the primary key a stable source ID, or a display name? Names are
   never identity (see §5.6).
5. **Many-to-many correctly modelled** — is any relationship that is genuinely
   many-to-many flattened into a single parent column? Check specifically whether a
   Paramount character can belong to more than one property, the way 609 Disney ones do.
6. **Resolution columns** on the entity tables, not the link tables.
7. **Table comments** — does an empty table explain itself? See §4.1.

**You will know it worked when:** a written report exists naming, per table, either "clean"
or the specific defect, and Albert has seen it before any migration is written.

### Step 5 — Then continue the master-data programme

In priority order, from `docs/core-master-data-consolidation-aim.md` §7:

1. **Write the Warner loaders** (#900). Largest gap; blocks the scrapes-win rule for all
   Warner titles.
2. **Resolve Disney's OPA properties/characters to `core.*`** — now possible because the
   entity tables exist. Resolution columns are on `plm.opa_property.core_property_id` and
   `plm.opa_character.core_character_id`.
3. **Reconcile the licensor edge** (#933) — fully specified, small, ready.
4. Then consolidation into `core.*` and the mapping screen itself.

---

## 7. Constraints and gotchas in force

- **Structure changes go through `u2giants/shared-db`** with branch + PR; Claude merges its
  own PRs (Albert cannot). Every other repo is main-only. Data changes belong to the
  application session, EXCEPT curated Master Data (`core.licensor`, `core.property`,
  `core.character`, `core.customer`, `core.factory`) which is orchestrator work under
  `AGENTS.md` §6.4.
- **This session was NOT the orchestrator.** Albert explicitly authorised the licensing
  gate and the normalization work directly. Do not treat that as blanket permission —
  ask before starting new structural work.
- **The Supabase MCP is READ-ONLY and may be bound to production.** It cannot run DDL or
  DML. Writes go through the GitHub promotion workflow or the Management API query
  endpoint (`https://api.supabase.com/v1/projects/<ref>/database/query`).
- **Prove the target before every write** (`AGENTS.md` §4.2) and quote the proof.
- **Never reuse a migration version.** Supabase keys on the version alone, so a duplicate
  makes one migration silently skip.
- **A ColdLion pull is additive and column-scoped.** It may write name/code; it must never
  write `licensor_id` or `status`, and must never delete rows it does not carry.
- **Match on the full composite key**, never `mgCode` alone.
- **`supabase/tests against an ephemeral database` is NOT a required check.** It caught my
  production regression, and PR #954 merged while it was red. **Always read it before
  merging**, even when GitHub allows the merge.
- **Never edit a migration that may already be applied.** If you must, first prove it
  applied nothing (see §4.4).
- **Licensed source data never leaves its approved private repo** — not in issues, PRs,
  commit messages, or logs.
- **This repo is PUBLIC and has a PII forward guard.** Never put a personal email in it;
  refer to people by `app.profile` UUID. This failed PR #932 once.
- **Do not edit another session's `HANDOFF.d/` file.**

---

## 8. Access and environment

| Thing | Where | Notes |
|---|---|---|
| Shared Supabase PRODUCTION | `qsllyeztdwjgirsysgai` | Read via Supabase MCP; write via workflow/Management API |
| Shared Supabase PREVIEW | `rjyboqwcdzcocqgmsyel` | A Supabase *branch*, so absent from `supabase projects list` |
| ColdLion ERP API | `http://x5.coldlion.com/EhpApi` | Key: 1Password `vibe_coding` → "Coldlion ERP API key x5.coldlion.com", field `credential`. Header `X-API-Key`. |
| DesignFlow PRODUCTION (live) | Cloud SQL `creatiflow-database`, GCP project `lithe-breaker-323913`, host `104.198.220.200:5432`, db `postgres`, **schema `designflow`** | 1Password → "DesignFlow PRODUCTION Cloud SQL - read-only (albert_read_only, creatiflow-database)". Read-only. IP-allowlisted. **Not `dflow`** — that is the Supabase-side name. |
| Supabase Management API token | 1Password → "Supabase CLI Personal Access Token", field `credential` | Used for writes the MCP cannot do |
| `ai-devops` hub | `C:\repos\ai-devops` | Skills live in `skills/shared/` |

**Secrets:** always via `op_run` with `op://` references. Never paste values. Serialize
1Password reads — never fan them out in parallel.

**Working pattern that worked well:** write a small `.mjs` script in the scratchpad, run it
through `op_run` with the secret injected as an env var. `pg` was installed locally in the
scratchpad for the Cloud SQL reads. Note `op_run`'s `cwd` does not accept `/tmp`-style Git
Bash paths — use the Windows scratchpad path.

**Applying a migration end to end:**

```bash
gh workflow run "Shared Supabase Migrations" --repo u2giants/shared-db --ref main \
  -f target=preview -f mode=apply -f preview_allowlist=<version>
```

then production dry-run, then `Production Apply Review Evidence` (needs the LIVE main SHA),
then production apply with `review_artifact_digest=sha256:<hex>`. Both traps are in §4.5.

---

## 9. Open questions and risks

1. **Paramount is assumed good but unaudited.** I called it "the model" on the strength of
   one observation. If it has the NBCU flaw, then the shape the others are being moved
   toward is itself wrong. Step 4 exists to settle this. *(Dated 2026-08-14.)*

2. **The Disney and NBCU loaders still write deprecated columns.** Both sets are retained
   deliberately so nothing breaks. The risk is they are never removed and become permanent
   duplicate state. #953 tracks Disney; NBCU has **no issue at all** — consider opening
   one as part of step 3.

3. **`plm.dcp_property` and `plm.dcp_character` are still empty**, and now sit beside the
   populated `plm.opa_property` / `plm.opa_character`. That is a fresh look-alike trap of
   exactly the kind described in §4.1. They carry warning comments, but a session that does
   not read comments could still misread them. Consider whether DCP needs its own property
   entities at all, or whether OPA is the single Disney source.

4. **The trigger `plm.opa_link_ensure_entities` upserts names on every link write.** With
   10,262 rows this is trivial. If OPA ever grows by orders of magnitude, revisit — it is
   one upsert per link row.

5. **No test asserts the trigger's post-deprecation behaviour** (name null + entity
   missing → clear error). The path is written and commented but not covered. Worth adding
   when the Disney loader changes.

6. **Preview and production have drifted** (#901). Preview rehearsals are weaker evidence
   than they appear. I applied by explicit version each time to work around it.

7. **`HANDOFF.d/` now holds 4 files including this one.** Under the 5-file warning
   threshold, but close. The others:
   `2026-08-07T0212Z-t16-claude-dispatch-collision-phase-a-done.md`,
   `2026-08-13T1535Z-al8960ofc-claude-orchestrator-disney-live-and-guard-lessons.md`,
   `2026-08-14T0400Z-al8960ofc-codex-orchestrator-closeout.md`. I did not read or retire
   them — not mine to touch.

---

## Self-audit (required by the handoff standard)

**1. Could a brand-new developer pick up without skipping a beat?** Yes. §1 explains the
application and the domain vocabulary in plain English. §3 states exactly what is shipped
and verified. §6 gives four numbered next steps, two of which are ready-to-send prompts
requiring no judgement. §8 names every credential location and the exact workflow
invocation sequence.

**2. Could they continue as effectively as I can right now?** Yes. Every non-obvious thing
I learned is in §5 with its measured numbers — the 609 multi-parent characters, the
name-collision counts, the 24 multi-brand properties, the fact that the parent edge is a
DesignFlow field and not a ColdLion one, and the exact scrape coverage figures. §4 carries
the four traps that cost me time, including the two workflow-argument traps in §4.5 that
would otherwise cost two failed runs.

**3. Is every detail for flawless execution present?** Yes. Background §1–§2, current state
§3 with a migration-by-migration verification table, failures §4, findings §5 with
`file`/table references, exact next steps §6 each with a "you will know it worked when"
gate, constraints §7, access §8, risks §9. Deliberate omissions are named as omissions:
the Paramount audit was not done, the NBCU skill was not updated, and issue #953 lacks a
closing condition — all three are written up as tasks rather than quietly dropped.

**4. If Albert read ONLY §0, would he see every decision he owns?** Yes — I walked §1–§9
line by line. Promoted to §0: the Warner legacy ownership question (from §6 step 1 and
§5.7), the Paramount audit scope (§6 step 4, §9.1), the COCO re-check (§5.3, §9), the
de-prioritised #941 (§3), the edge-reseed hazard (§7 and the COCO ruling), the preview
drift (§9.6, outside this workstream), and the Warner loader gap (§5.5, #900, outside this
workstream). The last three are exactly the "not my scope" category the standard warns gets
lost. The settled-decisions table prevents re-asking the six rulings Albert already made.
