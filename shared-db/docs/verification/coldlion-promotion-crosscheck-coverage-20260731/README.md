# ColdLion Step 7A — closing the Step 5.6 cross-check blind spot (2026-07-31)

**Status: authored and proven OFFLINE. NOT yet applied to preview, NOT rehearsed against a
database.** Read "What is NOT proven" before you trust any of this.

## What was wrong

Step 5.6 of `plm.promote_coldlion_source_owned` is the safety assertion that the changes the
promotion actually applies match the plan the runner computed independently beforehand. Two
independent computations that must agree is the core defence of the whole lane — one
implementation cannot catch its own bug.

That assertion only ever covered **one of the three change classes the function makes**.
`v_server_keys` was built with `where quarantine_reason is null … and normalized-equivalent`,
i.e. the curated-name subset. But Step 5.8 writes `core.taxonomy_source_ref` for a strictly
wider set, leaving two mutation paths with nothing checking them:

| Path | Why it escaped | Consequence |
|---|---|---|
| **`source_code` refresh** | 5.8 also fires on `coalesce(r.source_code,'') <> p.mg_code`. A row whose names all agree but whose stored source_code has drifted is written while both sides compute an empty set. | A provenance write nobody planned, on a cycle that reports itself quiet. |
| **Held-row provenance refresh** | 5.8 excludes only `wrong_type`, so a row quarantined as `source_name_divergence` (or any other reason) still has its provenance refreshed — by design. But 5.6 required `quarantine_reason is null`. | Every held row's write was outside the assertion. |

Found by the GLM-5.2 review of PR #331 (merge `0798c095`), rated Medium. Nothing is known to
have gone wrong because of it: this is the **guard being narrower than the thing it guards**,
which reports "plan verified" over unverified writes.

## What changed

`supabase/migrations/20260731190000_coldlion_promotion_crosscheck_provenance_coverage.sql`
— forward correction of the function only. No table, index, policy, grant, trigger, signature
or return-column change; `create or replace` on the identical signature, so the `public.*`
wrapper and every existing grant stay valid. Reads and writes no data.

1. **A second cross-checked set, `provenance_refreshes`.** Its server-side predicate is the
   5.8 UPDATE predicate **term for term**, so the assertion mirrors the mutation instead of
   re-deriving a subset of it. That covers both missing paths at once, and it fails loudly if
   5.8 is ever edited alone rather than silently drifting narrow again.
2. **Fail-closed on an out-of-date runner.** A plan supplied without a `provenance_refreshes`
   key is refused. A runner that predates this change cannot predict these rows, so accepting
   its plan would apply the writes with no cross-check while the log said "verified". jsonb `?`
   distinguishes an *absent* key (refuse) from an *empty array* (the correct steady-state
   prediction, accepted).
3. **Sets, not bags.** Both sides compare DISTINCT keys — one typed key can arrive on more
   than one mirror row and resolve to the same provenance row. A bag comparison would
   fail-close a healthy cycle, and a guard that cries wolf gets switched off.
4. `ingest.sync_run.metadata` now records `plan_crosscheck` (how many keys each set held, and
   that they agreed), so the evidence is durable rather than inferred from "it returned".

Runner side — the two implementations have to stay comparable:

- `tools/promote-coldlion-source-owned.mjs` — the cycle-state probe now reads `r.id`,
  `r.source_code` (without it the runner could not predict the source_code refresh **at all**)
  and coalesces `present_this_cycle` to false; `splitCycleState` returns a third input,
  `provenanceRows`.
- `tools/coldlion-recurring-promotion.mjs` — new pure `computeProvenanceRefreshes`, emitted as
  `plan.provenance_refreshes`. `isNoOpCycle` now also requires that set to be empty; a cycle
  with a pending source_code refresh still writes, so calling it idempotent was wrong.

**`provenanceRows` is derived from the intact cycle row, not by intersecting `sourceRows` with
`linkedRows`.** Those two lists are filtered on different predicates, so a typed key can appear
in both while the entries come from *different* mirror rows (one present but unlinked, one
linked but absent) — rows the database never writes. Intersecting by key would over-predict and
fail-close a healthy cycle. There is a test for exactly this.

## What IS proven

`node --test` over the seven ColdLion contract test files: **100 tests, 100 pass, 0 fail.**

- `tools/coldlion-recurring-promotion.test.mjs` — 11 new row-by-row cases, every one written
  against a row that produces **no** curated-name promotion, because that is precisely the
  shape the old cross-check could not see.
- `tools/promote-coldlion-source-owned.test.mjs` — new. Proves the seams a pure test cannot:
  the probe SQL selects the columns the set is derived from; `splitCycleState` actually feeds
  the planner; the migration's 5.6 predicate still matches its 5.8 predicate term for term; the
  migration changes no signature/grant/table and does not enable the production lane.
- `bash scripts/check-sql.sh` — passes. Guard B: no migration sorts before `20260730000500`.

### The tests now actually run on a pull request

`tools/coldlion-recurring-promotion.test.mjs` was listed **only** inside
`coldlion-licensor-property-production.yml`, and every job there is gated on
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` — a repository variable that does not exist and
must not be created before Step 8. **So the tests proving the promotion contract never ran
anywhere.** New workflow `.github/workflows/coldlion-promotion-contract-tests.yml` runs them on
every `pull_request`, deliberately with **no `paths:` filter** (AGENTS.md §5.2 — a checker that
reads more than its trigger watches produces stale verdicts). It is offline: no Supabase CLI,
no project ref, no secrets, no network.

## What is NOT proven

**This migration has never touched a database.** No preview apply, no `db push`, no psql, no
rehearsal run — the session that authored it had no database access by instruction. So:

1. **The SQL is unexecuted.** It is a careful edit of an applied, working function, but a
   syntax or planner error would only surface on apply.
2. **No preview rehearsal.** Four new fault cases were added to
   `tools/rehearse-coldlion-recurring-cycles.mjs` (§10a–10d) and **none have been run**:
   an out-of-date plan is refused; a `source_code` drift is caught; a held-row refresh is
   caught; and the real runner's two sets agree so the guard does not cry wolf. That last one
   matters most — the first three prove the guard fires, only 10d proves it does not fire on a
   healthy cycle.

**Next session, in order:** apply `20260731190000` to preview `rjyboqwcdzcocqgmsyel`; run
`node tools/rehearse-coldlion-recurring-cycles.mjs --json` and confirm 10a–10d pass along with
every pre-existing case; record the output here.

## What was deliberately NOT done

- **The production lane is not enabled.** `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` is
  not created, not set, and not read by anything added here. The production project ref appears
  nowhere in the new files. There is a test asserting both.
- **The existing `promotions` comparison is untouched.** It is a real assertion about the
  curated-name rule, and the two sets deliberately overlap. Merging or narrowing them would
  trade one blind spot for another.
