# AGENTS.md — §6 (how to tell if a change is already in flight)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 6. How to tell if a change is already in flight

Before starting database work, run these and read the result:

```bash
gh pr list                      # open shared-db PRs
git branch -a && git ls-remote  # in-progress branches
ls supabase/migrations          # files not yet applied to production
git status --short              # uncommitted migration files in the working tree
```

If anything looks like in-progress database work, **stop and serialize** — land
it (or ask the owner) before adding your own schema change.

**Currently in flight: the ERP mirror relocation.** The Coldlion ERP pull tables (`public.erp_*`,
`public.prod_order_*`) are being moved out of `public` into the designed `ingest` / `plm` / `api`
layers. Phase 1 is live in production; phases 2–5 are pending. **Before touching `erp_*`,
`prod_order_*`, `api.plm_item_list`, `plm.item`, `plm.production_order*` or
`plm.refresh_style_tracker_item_bridge()`, read [`fix_schema_for_api.md`](../../fix_schema_for_api.md)
and continue it in order** — do not start a parallel ERP schema change. Full text, including the
still-open source decision that affects Phase 3:
[`docs/agents/section-6-in-flight-long-form.md`](../../docs/agents/section-6-in-flight-long-form.md).

**Which entities are on ColdLion vs. still on DesignFlow?** Do not re-derive this by querying — it
has cost multiple sessions already. The answer, with row counts, blockers, and the
`plm.*_import` vs `plm.erp_*` naming rule, is in
[`docs/master-data-cutover-scoreboard.md`](../../docs/master-data-cutover-scoreboard.md). Short version:
**customer and vendor are cut over to ColdLion; licensor and property are not** (and
`plm.licensor_import` / `plm.property_import` are DesignFlow staging, *not* a ColdLion mirror — a
previous session got this wrong).

**ColdLion — anything at all: start at [`docs/coldlion.md`](../../docs/coldlion.md)**, and read
[`docs/coldlion-open-questions.md`](../../docs/coldlion-open-questions.md) before asking ColdLion or
Albert anything or calling a field broken. Twelve questions are already answered there.

**ColdLion purchase/sales history (`prodHistory` / `orderHistory`) — read
[`docs/coldlion-history-endpoints-shape.md`](../../docs/coldlion-history-endpoints-shape.md) before
writing any loader.** ⚠️ **The default `prodHistory` response is INCOMPLETE**: without `stageCode`
you get only the `ISS` lines, there are exactly three stages (`ISS`, `INTRAN`, `REC`) with **zero
key overlap**, and a stage-blind table triple-counts quantities with no error. The other four traps
— the hard 7-day window cap whose refusal is malformed, the endpoints silently ignoring
`page`/`size`, the `(prodOrderNo, prodLineSeq, prepackItemNo)` row identity, and the fields that
read zero in every sampled row — are stated in full in
[`docs/agents/section-6-in-flight-long-form.md`](../../docs/agents/section-6-in-flight-long-form.md).

**What the ERP data MEANS** (as opposed to its shape) lives in
[`docs/business-rules-erp-data.md`](../../docs/business-rules-erp-data.md). **Never infer a business rule
from field populations and write it down as fact** — label it an inference until the owner
confirms it. Three settled facts a session keeps re-deriving: a `prodReferenceNo` ending **`COS`**
marks **sample production** (real cost, no customer revenue — `salesOrderNo = 0` there is correct);
the feed spans **four divisions** (`CW001`, `EH001`, `EP001`, `SP001`), not just `EH001`; and
`1900-01-01` is the empty-date marker (owner-confirmed 2026-08-14 — settled, do not re-raise).

> ### 📕 The rulings themselves moved to [`docs/owner-rulings.md`](../../docs/owner-rulings.md) on 2026-08-20.
> Nothing was deleted and **the numbers are unchanged** — `§6.4` still means `§6.4`. This index is
> the router entry; the ruling text, its evidence and its reasoning are one click away. `AGENTS.md`
> was 229 KB against its own 80 KB ceiling and this section was 43% of it (issue #1331).

| § | Ruling | |
|---|---|---|
| **6.1** | Merch groups / licensors / properties — read this before touching them | [read](../../docs/owner-rulings.md#61-merch-groups-licensors-properties-read-this-before-touching-them) |
| **6.1b** | Division codes — TWO encodings, and the one that will bite you (2026-08-17) | [read](../../docs/owner-rulings.md#61b-division-codes-two-encodings-and-the-one-that-will-bite-you-2026-08-17) |
| **6.2** | Coldlion `/vendors` — wrong table, now FIXED upstream (2026-07-22) | [read](../../docs/owner-rulings.md#62-coldlion-vendors-wrong-table-now-fixed-upstream-2026-07-22) |
| **6.3** | OWNER RULING — Coldlion ERP data is canonical (Albert Hazan, 2026-07-31) | [read](../../docs/owner-rulings.md#63-owner-ruling-coldlion-erp-data-is-canonical-albert-hazan-2026-07-31) |
| **6.4** | OWNER RULING — the Master Data import is TRANSITIONAL, and curated data outranks it (Albert Hazan, 2026-08-03) | [read](../../docs/owner-rulings.md#64-owner-ruling-the-master-data-import-is-transitional-and-curated-data-outranks-it-albert-hazan-2026-08-03) |
| **6.5** | OWNER RULING — PR #408 is HELD and ships as one production change with the FR removal work (Albert Hazan, 2026-08-03) | [read](../../docs/owner-rulings.md#65-owner-ruling-pr-408-is-held-and-ships-as-one-production-change-with-the-fr-removal-work-albert-hazan-2026-08-03) |
| **6.6** | OWNER RULING — DB Data Admin is the home for licensor→property parentage (Albert Hazan, 2026-08-03) — this REVERSES the previous stance | [read](../../docs/owner-rulings.md#66-owner-ruling-db-data-admin-is-the-home-for-licensorproperty-parentage-albert-hazan-2026-08-03-this-reverses-the-previous-stance) |
| **6.7** | OWNER RULING — branch protection on `main` is ON, and CI guards are no longer advisory (Albert Hazan, 2026-08-04) | [read](../../docs/owner-rulings.md#67-owner-ruling-branch-protection-on-main-is-on-and-ci-guards-are-no-longer-advisory-albert-hazan-2026-08-04) |
| **6.8** | OWNER RULING — the six HARD_BLOCKED ColdLion migrations are NOT unblocked individually (Albert Hazan, 2026-08-04) | [read](../../docs/owner-rulings.md#68-owner-ruling-the-six-hardblocked-coldlion-migrations-are-not-unblocked-individually-albert-hazan-2026-08-04) |
| **6.9** | OWNER RULING — the 33 unmatched ColdLion property codes are NOT admitted before the resolver is fixed (Albert Hazan, 2026-08-04) | [read](../../docs/owner-rulings.md#69-owner-ruling-the-33-unmatched-coldlion-property-codes-are-not-admitted-before-the-resolver-is-fixed-albert-hazan-2026-08-04) |
| **6.10** | OWNER RULINGS — the licensor/property model, and "the feed should not drop anything" (Albert Hazan, 2026-08-06) | [read](../../docs/owner-rulings.md#610-owner-rulings-the-licensorproperty-model-and-the-feed-should-not-drop-anything-albert-hazan-2026-08-06) |
| **6.11** | `DY` and `DS` are ONE company — the Disney licensor has two spellings (added 2026-08-07) | [read](../../docs/owner-rulings.md#611-dy-and-ds-are-one-company-the-disney-licensor-has-two-spellings-added-2026-08-07) |
| **6.12** | CORRECTION to §6.6 rule 5 — there is NO parentage-durability migration (added 2026-08-07) | [read](../../docs/owner-rulings.md#612-correction-to-66-rule-5-there-is-no-parentage-durability-migration-added-2026-08-07) |
| **6.13** | OWNER RULINGS — Paramount landing tables and sub-licensors (Albert Hazan, 2026-08-07) | [read](../../docs/owner-rulings.md#613-owner-rulings-paramount-landing-tables-and-sub-licensors-albert-hazan-2026-08-07) |
| **6.13-A** | OWNER RULING — the Paramount five-table cap is lifted and the build hold is released (Albert Hazan, 2026-08-09) | [read](../../docs/owner-rulings.md#613-a-owner-ruling-the-paramount-five-table-cap-is-lifted-and-the-build-hold-is-released-albert-hazan-2026-08-09) |
| **6.14** | OWNER RULING — this repository is PUBLIC; no personal identifiers in anything you write from now on (Albert Hazan, 2026-08-09) | [read](../../docs/owner-rulings.md#614-owner-ruling-this-repository-is-public-no-personal-identifiers-in-anything-you-write-from-now-on-albert-hazan-2026-08-09) |
| **6.15** | HISTORICAL OWNER RULING — two source lists; issue #1684 keeps `core.property`, restores `core.character`, and retires the mixed table | [read](../../docs/owner-rulings.md#615-historical-owner-ruling-two-source-lists--entity-destination-superseded-by-1684) |
| **6.17** | OWNER RULING — DesignFlow's numeric division ids are WRONG and do NOT come to this database; the ColdLion division CODE is the only division there is (Albert Hazan, 2026-08-19) | [read](../../docs/owner-rulings.md#617-owner-ruling-designflows-numeric-division-ids-are-wrong-and-do-not-come-to-this-database-the-coldlion-division-code-is-the-only-division-there-is-albert-hazan-2026-08-19) |
| **6.16** | OWNER RULING — licence CONTRACTS are NOT a source for this database, and licence TERM and TERRITORY do not belong in it at all (Albert Hazan, 2026-08-19) | [read](../../docs/owner-rulings.md#616-owner-ruling-licence-contracts-are-not-a-source-for-this-database-and-licence-term-and-territory-do-not-belong-in-it-at-all-albert-hazan-2026-08-19) |
