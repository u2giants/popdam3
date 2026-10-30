---
issue: 5092
status: BLOCKED
owner: successor-required (operator adoption or mimo session)
---

# sku_style_guide_links — item → licensor-scrape style guide links

**Session:** MiMo chat (unknown session id) on EDGE-DEV
**Started:** 2026-10-30T04:08Z · **Left here:** 2026-10-30T06:40Z
**Branch:** `mimo/sku-style-guide-links` · **Worktree:** `D:\repos\shared-db-worktrees\sku-style-guide-links`
**Migration version (reserved, permanent):** `20261030043848`
**Claim:** #5095 (`db-claim`, `db-author-lease` owner `mimo-ses_ffe5e75175c08ffeTCI4DzDWj7-EDGE-DEV`)
**Work issue:** #5092 · **PR:** https://github.com/popcre/shared-db/pull/5098 · **Head:** `cce78b459`
**Application return:** `u2giants/popdam3`

---

## 0. What this delivers

PopDAM licensing-sheet / tech-pack PDFs carry a `FILES USED` list of the licensor source
art a design was built from, and most also carry `CORE/STYLE GUIDE USED:`. Those names
already land in `public.sku_files_used` and today resolve **only** against the PopSG NAS
crawl. This change adds the licensor-authoritative resolution: match each extracted file
name against a new cross-portal index over the `plm.*` scrape landings, follow the
portal's own asset → style-guide assertion, and store the resulting style guide(s)
against the **item** (SKU / style group) in `public.sku_style_guide_links`.

## 1. State

| Step | State | Evidence |
|---|---|---|
| Indra scan of every licensing/tech-pack PDF | **DONE** (production) | `count_pdf_backfill_remaining()` = 0 after the 593-file tail was run on the Windows render agent (`ocr_indra.state = ready`); 17,349 eligible PDFs now carry extracted text |
| Extraction-gap diagnosis | **DONE** | 6,433 SKUs have extracted text and no `sku_files_used` row — the parser/backfill gap, not the scan |
| Migration authored + twice reviewed | **DONE** | #5091 (glm) and #5101 (deepseek); both fixer patches adopted verbatim onto this branch as `cba2f0673` and `8d5f049b4` |
| Static + synthetic + contract tests | **PASS** | `node --test scripts/sku-style-guide-links.test.mjs` 5/5; 11/11 synthetic assertions on a throwaway PostgreSQL 18 cluster; `supabase/tests/sku_style_guide_links_contracts.sql` clean |
| CI on head `cce78b459` | **GREEN** | `Migration author lease`, `supabase/tests against an ephemeral database`, `Tools offline tests`, `Queue-sensitive checks (aggregate)` all pass |
| Merge | **NOT DONE** | see §3 |
| Production data run | **NOT DONE** | blocked on merge |
| PopDAM UI wiring | **NOT DONE** | `application_return_to: u2giants/popdam3` |

## 2. What the migration contains (version `20261030043848`, one file)

- `plm.asset_file_style_guide_index` — one row per (portal, normalised file name, style
  guide the portal asserts that file belongs to). **Eight** UNION arms, each a DIRECT
  portal assertion: Disney DCP Vault, Lucasfilm DCP Vault, Marvel DCP Vault, Marvel
  ASGARD, NBCU, Warner STARLABS (normalised), Peanuts, Sesame Workshop.
  Deliberately absent: Paramount (publishes Collections, not Style Guides), Coca-Cola
  (no guide relationship), Disney OPA (no file/guide arm), **Sega DSI** and
  **Wildbrain** (CHECK-pinned pipeline *inferences* — `sega_style_guide_candidate
  evidence_type = 'catalog_name_rule'`, `wildbrain_guide relationship_truth =
  'inferred'` — never portal-declared). View is `security_invoker` and **service-role
  only** (the ASGARD landing tables are service-role-only, so an `authenticated` grant
  on it is dead on arrival).
- `public.sku_style_guide_links` — item → style guide evidence, quarantine model like
  `sku_files_used`. `match_method` ∈ `filename_exact` / `filename_normalized` /
  `sheet_declared` / `sheet_label_match`. `match_confidence` divides across candidate
  guides; `matched_asset_count` flags ambiguous file names. `core_style_guide_id` is a
  reserved promotion slot to `core.style_guide` (seeded empty today) — never invented.
- Parsers: implementation lives in **`public.parse_pdf_files_used_v2`** and
  **`public.backfill_pdf_files_used_v2`**; the legacy names delegate. New
  `public.parse_pdf_declared_style_guide` captures `CORE/STYLE GUIDE USED:`.
- `public.resolve_sku_style_guide_links()` — SECURITY DEFINER, `service_role`/`postgres`
  only. Nightly `pg_cron` `resolve-sku-style-guide-links-nightly` at `30 4 * * *` UTC.

## 3. THE BLOCKER — read this first

`--acquire-merge` refuses with *"pull request #5098 structural objects must exactly match
admitted issue #5092 writes"*, and the lane is repeatedly fenced by **auto-generated
review-fixer PRs** that open against this branch after every head push (#5093, #5102,
#5112) and then collide with every object on the next `--check-in-author` /
`--expand-active-claim-from-issue`.

Two things to settle, in order:

1. **Object-set reconciliation.** `structuralWritesMatch` compares the issue scope's
   `writes:` against `inspectPrStructuralChange(files)`, which extracts objects from the
   PR file **patches**, not the whole migration text. Locally the full-file sets match
   exactly (19/19, verified with `dispatchObjectKeys` + `validateClaimObjects`); the
   patch-derived set has not been diffed against it. Fix by running
   `inspectPrStructuralChange` on the real `gh api …/pulls/5098/files` patches and
   rewriting `#5092`'s `writes:` to that exact sorted list. `scripts/db-flow/admission.mjs`
   → `structuralWritesMatch`.
2. **Review-fixer fencing.** Every new head draws an advisory review whose fixer opens a
   PR at `review-fix/<finding>` **based on `mimo/sku-style-guide-links`**, which then
   blocks `assertLaneAvailable`. The fixer patches so far have been correct and were
   adopted (see §1). Either merge the fixer's commit into this branch and close its PR
   before the next lane call, or hold the head still and stop pushing.

## 4. After the merge

Run as `service_role` against `qsllyeztdwjgirsysgai` (prove the project ref first):

```sql
select public.backfill_pdf_files_used_v2();        -- re-parse every pdf_text_samples row
select public.resolve_sku_style_guide_links();     -- populate sku_style_guide_links
```

Then the nightly cron keeps it fresh. `backfill_pdf_files_used_v2()` is the one that
closes the 6,433-SKU gap; the previous parser split inline `FILES USED` values with
`string_to_array(v_inline, '[,;|]')`, which takes a **literal separator, not a regex**,
so `A, B, C` landed as one name.

Then wire PopDAM's style-group panel (`src/components/library/StyleGroupDetailPanel.tsx`)
to read `public.sku_style_guide_links` — that is the `u2giants/popdam3` half.

## 5. Harness trap that cost real time (do not re-learn it)

`database-contract-tests.yml` runs *Replay every migration (pass 1)* → *Apply the
captured pre-adoption baseline* → *Re-run the migrations that failed (pass 2)*. The
baseline re-application restores **every routine the baseline also defines** back to its
baseline body after the migrations have run. So a `CREATE OR REPLACE FUNCTION` of a
pre-existing routine is invisible to the runtime contract tests, even though the
migration's new tables/views survive. Diagnosed by an exception message that printed the
installed `prosrc`: it was the old parser. Hence the `_v2` names.

## 6. Production facts recorded this session (read-only + one authorised write)

- Eligible licensing/tech-pack PDFs: 23,027. With extracted text: 17,349.
- SKUs with text and no `sku_files_used` row: 6,433 (was 6,179 before the tail scan —
  the gap grows as scanning proceeds; only the re-parse closes it).
- `sku_files_used`: 2,544 rows / 1,841 SKUs (2,340 resolved to PopSG, 204 unresolved).
- `core.style_guide`, `dam.asset_style_guide`, `dam.sku_style_guide_source`,
  `core.property_style_guide` are all **empty**; `plm.*` scrape landings are the only
  populated style-guide source today (~640k asset rows across 11 portals).
- One production write made under this session's authority: `admin_config.PDF_BACKFILL`
  reset to `{status:"running", total:593}` to start the Indra tail (the previous run had
  left `status:"completed"` with a stale total while 593 files remained — the trap in
  `docs/PASS2_ONPREM_TEXT_EXTRACTION_PLAN.md` §3.2). It ran to completion.

## 7. Identity note

The claim's `db-author-lease.owner` is `mimo-ses_ffe5e75175c08ffeTCI4DzDWj7-EDGE-DEV`
(the `SHARED_DB_SESSION_ID` this session declares). It was created as
`MiMo chat unknown on EDGE-DEV` and corrected in-place: `scripts/lib/session-authority.mjs`
matches only `Codex|Claude|ZCode chat <uuid> on <machine>`, `codex/<uuid>-<n>` or
`claude-chat-<uuid>@<machine>`, otherwise the owner string must equal the session id
verbatim, and `SESSION_ID_PATTERN` forbids spaces. Signature for GitHub posts:
`Posted by MiMo chat unknown on EDGE-DEV`.

---
Posted by MiMo chat unknown on EDGE-DEV
