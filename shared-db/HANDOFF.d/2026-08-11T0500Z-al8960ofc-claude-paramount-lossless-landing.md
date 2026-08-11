# Paramount Creative Library — lossless landing (issue #724, DB claim #744)

**Status: OPEN.** Code complete both sides. **PR #752 open. Migration APPLIED TO PREVIEW and
proven by object and by behaviour.** One thing outstanding: the real 150,430-value capture
load needs `PMT_PORTAL_GLOBAL_ASSET_COUNT`, an operator observation nobody recorded (see
section 6). Merge is queued behind a merge freeze until production batch B2 lands.

**Preview apply evidence:** ledger 425 -> 426, only new version `20260811030000`; 19 source-ID
columns text / 0 bigint; `plm.pmt_asset_metadata_value` exists; 8 `api.pmt_*` views compile;
CHECK 96 / FK 49 / PK 24 all validated; the 14 rebuilt FKs present and validated; RLS enabled
not forced with 2 policies; anon NONE, authenticated SELECT only, service_role has no
TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Behavioural gates all pass -- see PR #752 comment for
the full table. `validate_pmt_capture` returned **18 checks / 13 passing**, which is positive
proof checks 1-13 survived the function replacement.

**How the apply was done (option C, orchestrator-approved):** preview's ledger is out of order,
so `db push` refused and `--include-all` would have applied four other workstreams' migrations.
The four foreign pending files were held aside in this isolated worktree, a normal `db push`
landed exactly one migration with a real ledger row, and the files were restored immediately.
Do NOT use `--include-all` on preview.

- PR: https://github.com/u2giants/shared-db/pull/752
- Branch: `feat/724-paramount-lossless-landing`, rebased onto `c3808fa` and pushed.
- Private builder: `u2giants/licensor-source-data` commit `6925627`.
- Worktree: `C:\repos\shared-db\.claude\worktrees\pmt-lossless`
- Migration version (pre-allocated by the orchestrator, do NOT change):
  `20260811030000_pmt_lossless_source_ids_and_asset_metadata_value.sql`
- Spec: owner-authored, relayed by orchestrator session d152a272 (marker issue #739).
- Related: #724, #623, #676.

---

## 1. What this work is for, for someone who has never seen it

POP licenses artwork from Paramount. Paramount runs a web portal ("Creative Library") that
holds the artwork and, more importantly here, the *metadata about* the artwork: which
Property, Franchise, Character, Collection (POP calls these Style Guides) and Brand each
asset belongs to. An authorized scrape of that metadata was captured into a PRIVATE
repository. This repository (`u2giants/shared-db`, PUBLIC) holds only the SCHEMA that the
capture is loaded into, plus the loader that streams it in.

Migration `20260810020000` built that schema. A read-only review then found two ways it
loses source facts. This workstream fixes both. It changes no application and promotes
nothing into the canonical `core.*` tables.

### Loss 1 — source IDs were stored as numbers

Paramount's Property/Franchise/Character/Collection/Brand IDs *look* numeric. They are not
quantities, they are identities. Storing an identity as a number breaks it in two ways that
**both succeed silently**:

- `Number('007')` is `7`. `'007'` and `'7'` become the same row and one identity is gone.
- `Number('9007199254740993')` is `9007199254740992`. Off by one. No error.

Nothing throws. The wrong row looks exactly like a right one, and afterwards the database
cannot tell it happened. Both halves had to be fixed — the PostgreSQL `bigint` columns AND
the loader's JavaScript `Number()` — because fixing only one achieves nothing.

### Loss 2 — repeated metadata was being discarded

The source returns an **ordered array** of values per metadata element (up to 12 observed on
one asset), each carrying both a machine value and a human display value. The old schema
flattened these into five de-duplicated link tables. Order, the machine/display distinction,
and every element outside those five modelled relationships were thrown away. The new table
`plm.pmt_asset_metadata_value` keeps one row per value with the ordinal preserved.

---

## 2. What is DONE and pushed

Three commits on the branch:

| Commit | What |
|---|---|
| `81ba70e` | The inherited draft, committed untouched as a reviewable baseline |
| `ecd50d0` | **Correction** — restored 12 finalization checks the draft had deleted |
| (2 more) | Loader exact-text source IDs + metadata target; synthetic tests |

Verification that passed locally:

- `node --test tools/sync-paramount-creative-library.test.mjs` — **53 of 53 pass**
- `bash scripts/check-sql.sh` — **static checks passed**

---

## 3. THE MOST IMPORTANT THING IN THIS FILE — the bug in the inherited draft

This workstream was recovered from a session killed mid-run. It left one untracked file: a
complete-looking 1124-line migration. **It contained a silent, severe regression, and the
next person must understand why, because the same trap is still there.**

`create or replace function` **replaces the entire function body**. There is no "add a
check" syntax. Any check you omit from your new migration is **DELETED from the database** —
silently, with no error, and with no diff a reviewer would notice, because the reviewer is
reading a new file, not a diff against the old function.

The draft rewrote `plm.validate_pmt_capture` from scratch. In doing so it:

1. **Deleted 12 of the 13 existing finalization checks** plus the capture-exists guard —
   assets-covered-by-batches, batch completeness, batch ID-set equality, per-property
   capture completeness, rights-list title coverage, captured-title count agreement, the
   search-rows floor, cooccurrence-never-direct, anomalies-preserved, unresolved failures,
   duplicate asset IDs, and expectations-declared. These are the checks that stop a
   half-scraped capture being published as if it were whole.
2. **Renamed six manifest populations** — `property_character_explicit`,
   `property_style_guide_explicit`, `property_franchise_asset_cooccurrence`,
   `authorized_property_context`, `malformed_explicit_pairs`, `captured_properties`. Those
   exact names are emitted by `manifestExpectations()` in
   `tools/sync-paramount-creative-library.mjs`. Renaming them in SQL only would have left
   six declared expectations joining to nothing, reporting actual 0, and **failing every
   finalization forever**.

**How it was fixed:** the function was rebuilt *from* the `20260810020000` text rather than
rewritten to resemble it, then the new pieces appended. Checks 1–13 are now **proven
byte-identical** to the original by a scripted comparison. Only four things are new: the
`asset_metadata_values` population in the actuals CTE, and checks 14 (the metadata
expectation must be declared, so an empty metadata load cannot pass check 1 vacuously), 15
(every metadata row belongs to an asset in the same capture) and 16 (every metadata row
carries a source hash).

A long warning comment now sits above SECTION 9 of the migration saying exactly this. **Do
not remove it, and do not "tidy" that function.**

---

## 4. LIVE PRODUCTION STATE — the spec was wrong, verify this yourself

Read on **2026-08-11** against production `qsllyeztdwjgirsysgai` (the Supabase MCP is
hard-bound to production and takes no project parameter; `get_project_url` was called first
and returned that ref). Read-only catalog queries, counts only, no row contents.

```
m_landing (20260810020000)  = 0      NOT applied
m_guard   (20260810090000)  = 0      NOT applied
m_security(20260810180000)  = 0      NOT applied
pmt_tables_live             = 0      the plm.pmt_* schema does not exist in production
source_id_bigint            = 0
ledger_rows                 = 373
highest_applied             = 20260810140000   (applied OUT OF ORDER — a high max does NOT
                                                mean everything below it is applied)
```

**The spec's section 4 states that `20260810020000` and `20260810090000` are "confirmed
applied". They are not. None of the Paramount landing exists in production at all.**

Three consequences the next session must not miss:

1. **There is no production Paramount data to convert.** Spec section 8.1 worries that
   `bigint -> text` "cannot recover a leading zero previously discarded". In production that
   worry is moot — there are no rows. The fix is entirely prospective there.
2. **Production apply must run four migrations in order**, not one:
   `20260810020000` → `20260810090000` → `20260810180000` → `20260811030000`.
   Applying `20260811030000` alone would fail immediately: it alters tables that do not exist.
3. `20260810180000` (the security migration, spec section 8.8) is unapplied **and is in no
   promotion batch**, so finishing batches B2..B9 will not promote it. Do not unilaterally
   promote it — that is an orchestrator decision. It is reported, not acted on.

---

## 5. What we tried that did NOT work / traps found the hard way

- **Trusting the inherited draft.** It read as authoritative and well-commented, and its
  `validate_pmt_capture` section was still a serious regression. Good prose is not evidence.
  Diff every replaced function against the migration that last defined it.
- **Assuming the spec's stated production state.** It said two migrations were applied. Zero
  were. The spec itself says to re-verify; do it.
- **The spec's preview project ref is wrong.** It says `xjcyeuvzkhtzsheknaiu`. Preview is
  **`rjyboqwcdzcocqgmsyel`**. Verify `supabase/.temp/project-ref` before EVERY push. Note
  that file **does not exist in this worktree**, so nothing here is pre-pointed at anything.
- **`python` heredocs and CRLF.** Reading these files with `newline=''` preserves CRLF and
  every `\n$$;\n` regex silently fails to match. Read with universal newlines, write with
  `newline='\n'` and let Git handle the conversion.
- **Do not add a second migration file.** The version `20260811030000` is pre-allocated.
  Duplicate 14-digit versions **silently skip** a migration; that has already happened twice
  in this repo. If a second file seems necessary, ask the orchestrator.

---

## 6. WHAT IS NOT DONE, and the one thing blocking it

### RESOLVED — the private builder is written and proven (spec section 8.5)

`paramount/scripts/build-normalized.mjs` in the PRIVATE repo now emits
`paramount/asset-metadata-values.jsonl`. Committed and pushed as `6925627` on branch
`codex/paramount-creative-library-20260807` of `u2giants/licensor-source-data` (private).

Measured on the real capture:

```
asset_metadata_values            150,430      max value_ordinal 11 (12 values on one element)
asset_metadata_distinct_elements 7            data_type: 125,314 string / 25,116 number
refused unsafe fields            []           skipped valueless rows 0
sha256  6d91f1b1c7ed0cccfbbbdbd232c600c5f0ad629a0e989418fc09090cb45b00e2
```

Gates that passed:

- **Deterministic** — two consecutive runs byte-identical (`cmp`), and the summary SHA-256
  matches the file on disk. The builder re-reads what it wrote and throws if the line count
  or hash disagrees.
- **No existing output changed** — `git diff` over every pre-existing `paramount/*.csv` is
  EMPTY. All relationship counts identical; the 4 malformed caret pairs remain anomalies.
- **Safe** — 0 banned element keys, 0 URL/token/bearer-shaped values across all 150,430 rows.
- **End-to-end** — all 150,430 rows fed through the real `buildPayloads()` from the shared-db
  branch were accepted, with 0 `undefined` values and correct types.

Only `capture-summary.json` and the builder changed, plus the new output file.

### Remaining, in order

1. ~~Private builder~~ **DONE** — see above.
2. **Preview apply** to `rjyboqwcdzcocqgmsyel` — all four migrations in order.
3. **Preview load + reconciliation** (counts only, never row contents).
4. **PR, CI green, merge.**
5. **Production apply** — **OWNER GATE. Albert's explicit per-run approval only.** Production
   is mid-promotion; batch B2 is staged and waiting on his approval click in GitHub Actions.

### One-line change owned by someone else

`supabase/tests/plm_maintain_revokes_and_default_privileges.sql` is inside PR #741's
territory and was **deliberately not edited**. Good news: its critical *absence* checks
(TRUNCATE / REFERENCES / TRIGGER / MAINTAIN must not be held by `service_role`) discover
tables **dynamically** from `pg_class` with `relname like 'pmt\_%'`, so
`pmt_asset_metadata_value` is already covered there automatically.

Only the hard-coded `v_pmt` array (line ~101) needs `'pmt_asset_metadata_value'` added, so
the *positive* assertion that `service_role` holds INSERT/UPDATE/DELETE also covers it.
Route that through whoever owns #741.

---

## 7. Safety posture of the new table (do not weaken)

The new table is created *after* every earlier security migration, and all of those iterate
**hard-coded** table lists — so none of them covers it. Worse, `alter default privileges in
schema plm ... grant all on tables to service_role` is still live (two independent
`pg_default_acl` reads confirm `{service_role=arwdDxtm/postgres}` for both `plm` and
`ingest`). That means the table is **born holding TRUNCATE for `service_role`**, and the
explicit revoke in SECTION 7 is load-bearing, not belt-and-braces.

The migration therefore restates the whole posture for this one table and then **proves it**
in a `do $$` block that raises if any bit survived. Posture: `anon`/`public` get nothing;
`authenticated` gets SELECT only, gated by an RLS policy on the four approved app roles, with
no DML grant at all; `service_role` gets SELECT/INSERT/UPDATE/DELETE but explicitly **not**
TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.

`enable` row level security, **not `force`** — matching all 23 sibling tables. `FORCE` would
subject the SECURITY DEFINER loader (running as `postgres`, which matches no policy) to these
policies and silently filter every INSERT to zero rows. That failure mode is documented at
length in `20260810020000` section 25 and must not be reintroduced.

---

## 8. Confidentiality

`u2giants/shared-db` is **PUBLIC**. No licensed Paramount row was copied into this repo, any
issue, PR text, test fixture, log, commit message, or any outside AI prompt. Every value in
the tests is synthetic (`FIXTURE_ELEMENT_A`, `9001`, `Fixture Property Alpha`). Structural
counts only were ever reported. The loader's error messages name the *field* and deliberately
never echo the *value*, because those messages land in public CI logs — there is a test
asserting exactly that.
