---
issue: 5092
status: OPEN
owner: mimo/sku-style-guide-links (session ses_ffe5e75175c08ffeTCI4DzDWj7 on EDGE-DEV)
---

# sku_style_guide_links — item → licensor-scrape style guide links

**Supersedes** `HANDOFF.d/20261030T0640Z-EDGE-DEV-mimo-sku-style-guide-links.md` (same
session, earlier snapshot taken while the merge was still blocked). That file stays as
history; **this one is authoritative**.

**Session:** MiMo chat `ses_ffe5e75175c08ffeTCI4DzDWj7` on EDGE-DEV
**Issue:** https://github.com/popcre/shared-db/issues/5092
**PR (MERGED):** https://github.com/popcre/shared-db/pull/5098
**Migration version (permanent, never reuse):** `20261030043848`
**Branch / worktree:** `mimo/sku-style-guide-links` / `D:\repos\shared-db-worktrees\sku-style-guide-links`
**Application return:** `u2giants/popdam3`
**Closed out at:** 2026-10-30, ~17:30 UTC (1:30 PM EDT)

---

## 1. What this delivers

PopDAM licensing-sheet / tech-pack PDFs carry a `FILES USED` list of the licensor source
art a design was built from, and most also carry `CORE/STYLE GUIDE USED:`. Those names
already land in `public.sku_files_used` and used to resolve **only** against the PopSG
NAS crawl. This change adds the licensor-authoritative resolution: match each extracted
file name against a cross-portal index over the `plm.*` scrape landings, follow the
portal's own asset → style-guide assertion, and store the resulting style guide(s)
against the **item** (SKU / style group) in `public.sku_style_guide_links`.

## 2. State at closeout

| Step | State | Evidence |
|---|---|---|
| Indra scan of every licensing/tech-pack PDF | **DONE in production** | `count_pdf_backfill_remaining()` = 0 after the 593-file tail was drained by the Windows render agent (`ocr_indra.state = ready`) |
| Extraction-gap diagnosis | **DONE** | ~6,400 SKUs have extracted text and no `sku_files_used` row — parser/backfill gap, not the scan |
| Migration authored, reviewed twice, corrected | **DONE** | findings #5091 (glm) and #5101 (deepseek); both fixer patches adopted verbatim |
| Tests | **PASS** | `node --test scripts/sku-style-guide-links.test.mjs` 5/5; 11/11 synthetic assertions on a throwaway PostgreSQL 18 cluster; `supabase/tests/sku_style_guide_links_contracts.sql` green in CI |
| PR merged | **DONE** | PR #5098 merged 2026-10-30T12:14:06Z (8:14 AM EDT) |
| Migration applied to production | **NOT DONE** | `public.sku_style_guide_links` absent from `qsllyeztdwjgirsysgai` at 17:20Z |
| Data fill-in | **NOT DONE** | blocked on the above |
| PopDAM panel wiring | **NOT DONE** | `u2giants/popdam3` |
| Per-row fuzzy guess removal | **PARTIAL** | nightly job removed; insert trigger still fires |
| Claim | **released / not mine** | `ai-shared-db-closeout-check` → `ok: true`, zero owned |

## 3. What the migration contains (`20261030043848`, one file)

https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261030043848_sku_style_guide_links.sql

- **`plm.asset_file_style_guide_index`** — one row per (portal, normalised file name,
  style guide the portal asserts that file belongs to). **Eight** UNION arms, each a
  DIRECT portal assertion: Disney DCP Vault, Lucasfilm DCP Vault, Marvel DCP Vault,
  Marvel ASGARD, NBCU, Warner STARLABS (normalised), Peanuts, Sesame Workshop.
  Deliberately absent: **Paramount** (publishes Collections, not Style Guides — a
  Collection must never be stored as a Style Guide), **Coca-Cola** (no guide
  relationship), **Disney OPA** (no file/guide arm), **Sega DSI** and **Wildbrain**
  (CHECK-pinned pipeline *inferences*: `sega_style_guide_candidate.evidence_type =
  'catalog_name_rule'`, `wildbrain_guide.relationship_truth = 'inferred'`). The view is
  `security_invoker` and **service-role only** — the ASGARD landing tables are
  service-role-only, so an `authenticated` grant on a `security_invoker` view is dead on
  arrival.
- **`public.sku_style_guide_links`** — item → style guide evidence, quarantine model
  like `sku_files_used`. `match_method` ∈ `filename_exact` / `filename_normalized` /
  `sheet_declared` / `sheet_label_match`. `match_confidence` divides across candidate
  guides; `matched_asset_count` flags ambiguous file names. `core_style_guide_id` is a
  reserved promotion slot to `core.style_guide` (seeded empty) — never invented here.
- **Parsers** live in `public.parse_pdf_files_used_v2` and
  `public.backfill_pdf_files_used_v2`; the legacy `parse_pdf_files_used` /
  `backfill_pdf_files_used` names **delegate** to them. New
  `public.parse_pdf_declared_style_guide` captures `CORE/STYLE GUIDE USED:`.
- **`public.resolve_sku_style_guide_links()`** — SECURITY DEFINER, `service_role` /
  `postgres` only. Nightly `pg_cron` `resolve-sku-style-guide-links-nightly` at
  `30 4 * * *` UTC.

## 4. The next actions, in order

1. **Confirm the migration reached production.** `Automatic production promotion
   trigger` runs hourly (`23 * * * *`) and starts the post-merge preview rehearsal for
   the oldest merged migration PR not yet in production; a `DB preview apply … PR5098
   20261030043848` run was in progress at 2026-10-30T17:09:43Z. Verify with:
   `select count(*) from information_schema.tables where table_schema='public' and
   table_name='sku_style_guide_links';` → must be 1.
2. **Run the fill-in** as `service_role` against `qsllyeztdwjgirsysgai` (prove the
   project ref immediately before the write):
   ```sql
   select public.backfill_pdf_files_used_v2();
   select public.resolve_sku_style_guide_links();
   ```
   `backfill_pdf_files_used_v2()` is the one that closes the ~6,400-SKU gap.
3. **Wire the PopDAM panel** — `u2giants/popdam3`,
   `src/components/library/StyleGroupDetailPanel.tsx`. Today its "Style Guide Sources"
   section reads `sku_files_used` and shows `file_name` plus a **fuzzy-matched** PopSG
   document. Change it to read `public.sku_style_guide_links` for the style guide, and
   keep the file-name list (that part is accurate). Ship through popdam3's normal
   branch → PR → merge → Coolify pipeline.
4. **Remove the per-row fuzzy guess** — follow-up migration dropping or defanging
   `trg_fn_resolve_sku_file_used` on `public.sku_files_used`. The nightly job is already
   off (see §6). Keep existing `style_guide_file_id` values: quarantine model, never
   auto-unlink.

## 5. Do not touch

- **Migration version `20261030043848` is permanent.** Never reuse it, never edit the
  applied file.
- **Do not bulk-delete or unlink `sku_files_used` rows.** `docs/idiosyncrasies.md` and
  `docs/KNOWN_QUIRKS.md` #47: "no match" ≠ "garbage", and PopSG is not comprehensive
  ground truth.
- **Do not add inferred arms to `plm.asset_file_style_guide_index`.** Co-occurrence is
  not a source assertion. Sega/Wildbrain are excluded on purpose.
- **Do not `CREATE OR REPLACE` a baseline routine and expect it to survive CI** — see
  §7.
- **Do not hand-edit a claim's `owner:` to a human-readable string** — see §7.

## 6. Production writes made by this session (disclosure)

- `admin_config.PDF_BACKFILL` reset to `{status:"running", total:593}` to start the
  Indra tail (the previous run had left `status:"completed"` with a stale total — the
  trap in `docs/PASS2_ONPREM_TEXT_EXTRACTION_PLAN.md` §3.2). It ran to completion.
- `select cron.unschedule('resolve-sku-files-used-nightly');` — that nightly job was
  re-attaching `sku_files_used.file_name` to `public.style_guide_files` at 0.6 trigram
  similarity and the panel presented the result as the item's style guide. Albert asked
  me to remove the part I judged a detriment. Existing links untouched. Reversible with
  `cron.schedule('resolve-sku-files-used-nightly', '0 4 * * *', 'select
  public.resolve_sku_files_used_fuzzy()')`.

No preview project write. No migration applied to production by me.

## 7. What was tried and did NOT work — read this before repeating any of it

- **`gh pr merge --squash` / `--auto` refused**: "The merge strategy for main is set by
  the merge queue". `scripts/manage-migration-author-lanes.mjs --acquire-merge` is the
  path.
- **`--acquire-merge` refused: "structural objects must exactly match admitted issue
  writes".** Cause found by running `inspectPrStructuralChange` on the **real PR file
  patches** (not the whole file): the extractor picks up **`table cron.job`** because
  the migration calls `cron.schedule()`. Comparing against `dispatchObjectKeys` on the
  whole file showed 19/19 identical and hid the gap. **Always diff against the
  patch-derived set.**
- **`--claim` refused: "duplicate object claims"** — `policy "service role all" on …`
  normalises to `policy  on …` unless the policy name is **quoted**. Object names with
  spaces must be `"quoted names"` in both the claim and the issue `writes:`.
- **Runtime contract test failed in CI but passed locally.** The exception message
  carrying the installed `prosrc` proved CI was running the **baseline**
  `parse_pdf_files_used` (comma-only `string_to_array`, no punctuation stripping), not
  the migrated one. `database-contract-tests.yml` applies the pre-adoption baseline
  *after* the migrations replay and restores every routine the baseline also defines.
  New tables and views survive; `CREATE OR REPLACE FUNCTION` of a pre-existing name
  does not. **Hence the `_v2` names.** This trap is worth an entry in
  `docs/KNOWN_QUIRKS.md`.
- **Claim `owner:` could not be a human-readable label.**
  `scripts/lib/session-authority.mjs` matches only `Codex|Claude|ZCode chat <uuid> on
  <machine>`, `codex/<uuid>-<n>` or `claude-chat-<uuid>@<machine>`; otherwise the owner
  must equal `SHARED_DB_SESSION_ID` verbatim and `SESSION_ID_PATTERN` forbids spaces.
  The claim owner was corrected in-place to
  `mimo-ses_ffe5e75175c08ffeTCI4DzDWj7-EDGE-DEV`.
- **Author check-in raced its own push** — the lease job ran before the check-in ref
  existed and 404'd. Re-running the failed job passed. Check in **after** pushing.
- **Review-fixer treadmill.** Every head push drew an advisory review whose fixer
  opened a PR at `review-fix/<n>` based on my branch; that PR then collided with every
  object on the next lane call. Both fixer patches were correct and were adopted
  verbatim (`cba2f0673`, `8d5f049b4`). Close the fixer PR as superseded with the adopt
  SHA rather than fighting it.
- **`--release-claim` needs `--confirm-finished`**, which asserts the work is finished.
  Do not use it to abandon mid-flight.

## 8. Facts that may already be stale

Checked at closeout, 2026-10-30T17:20Z (1:20 PM EDT):
- PR #5098 `MERGED`, `mergedAt` 2026-10-30T12:14:06Z.
- `ai-shared-db-closeout-check --session-id ses_ffe5e75175c08ffeTCI4DzDWj7` →
  `{"blocking_claims":[],"blocking_stages":[],"ok":true}` (11 open claims, 3 stages).
- Migration **not** in production: `sku_style_guide_links` = 0 tables,
  `resolve_sku_style_guide_links` = 0 routines.

Not re-checked and likely stale:
- Counts from earlier today: 24,536 eligible licensing/tech-pack PDFs; 18,605 with
  usable text; 5,916 scanned but yielding none; 15 with no scan record; 9,450 licensed
  style groups of 11,214; 1,811 groups showing `sku_files_used` rows; 7,639 showing
  none; 2,544 rows across 1,841 SKUs; ~6,400 SKUs with text and no rows. New files land
  on the NAS continuously.
- Claim #5095's lease (`ZCode chat 29269c6d-e002-4b01-a957-03f26119a0bf on hetz`,
  worktree `/worksp/shared-db/.wt-5098`, expiry `2026-10-30T13:05:43Z`) — read at
  closeout; may have expired since.
- `main` tip after the squash merge: `a576e1e211193ec0251caf850a0984e91f8036d8`, from
  the PR record, not re-read from the branch.

## 9. Live proof checklist (also on issue #5092)

- [ ] migration `20261030043848` confirmed applied to `qsllyeztdwjgirsysgai`
- [ ] `public.backfill_pdf_files_used_v2()` run; the "SKUs with text and no
      `sku_files_used` row" count falls from ~6,400 toward zero
- [ ] `public.resolve_sku_style_guide_links()` run; `public.sku_style_guide_links`
      non-empty and every non-`sheet_declared` row resolves inside
      `plm.asset_file_style_guide_index`
- [ ] PopDAM style-group panel shows file names and the licensor-scrape style guides
      for a licensed item

---
Posted by MiMo chat ses_ffe5e75175c08ffeTCI4DzDWj7 on EDGE-DEV
