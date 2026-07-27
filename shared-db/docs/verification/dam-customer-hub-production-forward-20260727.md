# DAM customer hub bounded production forward

Date: 2026-07-27
Preview project: `rjyboqwcdzcocqgmsyel`
Production project: `qsllyeztdwjgirsysgai`

## Goal and rollout boundary

Safely verify and clear the two already-live DAM source migrations, then correct
the Rooms-to-Go matching defect without touching ColdLion taxonomy:

- `20260722210100_dam_customer_hub_wiring.sql`
- `20260722222000_dam_path_facets_by_customer_id.sql`

Their original effects reached production through
`20260723183000_step11_bounded_production_forward.sql`. The compatible PopDAM
frontend commit is `23f9335e0f39af2980cc0693456edb8bc8fc55e5`; it is an ancestor
of deployed frontend SHA `b4bf454bd7d660dcc375001549324f418667663d`.

While this correction was in preview, shared-db PR #268 recorded a concurrent,
separately approved production promotion of both old DAM source versions plus
`20260724050000`. Their ledger cleanup is therefore already complete. This
work will not rerun or repair those versions; production scope is now only the
new correction.

## Finding and permanent correction

The preview audit found five `Rooms to Go - CODE1, CODE2, CODE3` Master Data
rows still unlinked. The resolver rejected every string containing a comma,
although those commas separate style codes rather than customer names.

`20260727190000_dam_customer_hub_bounded_forward.sql` removed that over-broad
guard. Prefix matching still requires a literal space or hyphen immediately
after the recognized customer name/alias. Therefore `Burlington, Ross` and
`TJX, HomeGoods` remain unlinked while `Rooms to Go - CODE1, CODE2` resolves.

The first preview apply exposed a safety warning: `SET LOCAL` had no active
transaction and therefore did not activate the intended timeout. That applied
preview migration remains immutable. The production promotion target is the new
`20260727191000_dam_customer_hub_production_forward.sql`, which uses a real
session-level 10-minute timeout, resets it, repeats the fix idempotently, and
fails closed on contract drift.

## Collision and preview-ledger check

- Open shared-db PRs at start: only docs PR #238; no schema PR.
- No migration workflow was running.
- The most recent preview schema workflow before this work was the completed
  designer-roster migration run `30293666573`.
- Preview's 17 Poppim-only ledger versions (`20260727013000`–`20260727024300`)
  were copied exactly into disposable runners. They were never repaired,
  overwritten, or promoted.
- All ColdLion and PopSG taxonomy migrations were retained as existing ledger
  context and left untouched.

## Preview proof

### Bounded apply

The first bounded dry run listed exactly:

```text
20260727190000_dam_customer_hub_bounded_forward.sql
```

It applied successfully and linked the five missing Rooms-to-Go rows. The
production-safe follow-up bounded dry run then listed exactly:

```text
20260727191000_dam_customer_hub_production_forward.sql
```

It applied successfully with no timeout warning.

### Database contracts and data

- Installed signatures:
  - `dam_resolve_customer(text)`
  - `get_dam_customer_facets()`
  - `get_path_facets(uuid)`
- Legacy `get_path_facets(text)` is absent.
- `trg_style_tracker_row_audit` is enabled (`tgenabled = O`).
- All five Rooms-to-Go style-code rows are linked.
- Current linked coverage across `style_groups`, `assets`, and
  `style_tracker_rows`: 55,252 of 57,373 nonblank rows.
- Remaining unmatched: 2,121 rows across 20 names. They are the approved
  internal/sentinel, genuinely multi-customer, inactive-person, or
  licensor/property cases; no Rooms-to-Go style-code row remains.
- CVS: 113 current rows, all linked; Costco: 95/95; Meijer: 38/38.
- `dam_resolve_customer('Burlington, Ross')` and
  `dam_resolve_customer('TJX, HomeGoods')` both return null.
- All 27 normalized PopDAM alias rows remain present through their canonical
  customer records.

### Signed-in and cross-app behavior

A rollback-only authenticated test used an existing preview user with PopDAM
access:

- `api.dam_customer_list`: 157 rows;
- CVS, Costco, Meijer visible: 3/3;
- Library customer facets: 39;
- all-customer programs: 115;
- CVS-scoped programs: exactly `2026` with count 6.

The same access-boundary test used existing CRM and PM app users:

- `api.crm_customer_picker_list`: 157 rows;
- `api.pm_customer_list`: 157 rows.

This proves the DAM change did not alter shared customer visibility contracts.

### App compatibility

Current PopDAM `main`:

- calls `get_path_facets` with `p_customer_id`;
- filters `assets` and `style_groups` by `customer_id`;
- reads customer options from `get_dam_customer_facets`;
- reads assignment options from `api.dam_customer_list`.

Verification:

- `src/test/dam-customer-hub.test.ts`: 2/2 passed;
- production frontend build passed;
- the compatible code is already deployed, so no PopDAM source change or
  additional app deployment is required for this database-only correction.

## Independent review

Claude Code reviewed the exact two source migrations, both new forward
migrations, the rollback test, current PopDAM call sites, preview evidence, and
the rollout plan. Verdict: **PASS** — no Critical, High, or Medium findings.

Claude's non-blocking observations were:

- the audit trigger is briefly disabled during the small null-only backfill;
- the production forward resolves per row rather than once per distinct label;
- production evidence was still pending at review time.

The migration checks the trigger is enabled before succeeding, and production
verification repeats that check immediately after apply.

## Production rollout plan

1. Merge the shared-db PR only after static checks, preview evidence, and Claude
   PASS.
2. Build a disposable runner containing the exact production ledger plus only
   `20260727191000_dam_customer_hub_production_forward.sql`.
3. Require the dry run to list exactly that one file.
4. Apply it.
5. Verify real functions, columns, aliases, customer links, trigger state,
   signed-in DAM facets/programs, and CRM/PM picker contracts.
6. Mark only preview-rehearsal version `20260727190000` applied after the
   production-safe `20260727191000` effects are verified. Do not rerun or repair
   `20260722210100` or `20260722222000`; PR #268 already cleared them.
7. Recompute the exact production backlog. It must remain exactly the six held
   ColdLion versions.

## Production evidence

Pre-apply baseline:

- ledger already contains `20260722210100` and `20260722222000` (PR #268);
- the production resolver does not yet resolve the Rooms-to-Go code-list value;
- exactly five Rooms-to-Go rows remain unlinked;
- `trg_style_tracker_row_audit` is enabled.

Apply and post-apply evidence pending.
