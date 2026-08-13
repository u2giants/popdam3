# Step 3a — historical noise gate for the broadened collision parser

**Date:** 2026-08-12
**Issue:** #563 (Phase B of `plan_dispatch-collision-hardening.md`, steps 3a + 3b)
**Gate required by:** plan §9 step 3a — "a short written artefact under `docs/verification/`
recording the sets tested, the classification, the pre-registered rule, and the resulting
decision. This artefact is the evidence for D12 and must exist before step 3b merges."

---

## 1. Why this gate exists

Broadening the DDL parser also strengthens `scripts/check-pr-object-collisions.mjs`, which
is a **required** check on `main`. If concurrent pull requests routinely touch the same
table, that check becomes noisy — and alarm fatigue on a required check is precisely the
disease this workstream exists to cure. So the plan made the historical replay a **gate**,
not a risk note, and required the acceptance rule to be fixed **before** looking at results.

## 2. The pre-registered acceptance rule (fixed before the replay was run)

> If more than **20%** of historical concurrent sets produce a new merge-guard failure
> classified as **noise**, the merge guard keeps its current narrow policy and only the
> dispatch policy broadens.

## 3. What was actually built, and why the rule is satisfied twice over

The implementation **does not widen the merge guard at all.**

`PATTERNS` and `extractObjects` in `scripts/check-pr-object-collisions.mjs` — the merge
guard's only inputs — are byte-for-byte unchanged. The broadening is additive:
`DISPATCH_PATTERNS`, `extractOperations`, `dispatchObjectKeys` and
`describeDispatchCoverage` are new exports consumed **only** by
`scripts/check-dispatch-collision.mjs`.

This is the "one parser file, two policies" split the plan settled on after review:

| Policy | Consumer | Reading |
|---|---|---|
| Whole-object replacement (narrow) | `check-pr-object-collisions.mjs` (**required** check) | unchanged |
| Any write to the same target (broad) | `check-dispatch-collision.mjs` (advisory, pre-dispatch) | new |

So **the merge guard cannot produce any new failure, noisy or otherwise** — 0% against a
20% ceiling. That is not an assumption: it is asserted by the test
`the MERGE guard parser is deliberately unchanged by this work` in
`scripts/check-dispatch-collision.test.mjs`, which fails if anyone widens `PATTERNS` later
without re-running this gate.

## 4. The replay was still run, against the DISPATCH policy

The gate's arithmetic is satisfied by construction, but that would leave the **dispatch**
check's own noise unmeasured — and a dispatch check nobody trusts is as useless as a noisy
required one. So the replay was run in full against the broad policy.

**Method** (deliberately overlap-based, not "the last ten PRs in isolation", per the plan):

1. `gh pr list --state merged --limit 400 --json number,title,createdAt,mergedAt,files`
   — 400 merged pull requests, of which **85 carry at least one migration**.
2. Two pull requests count as **concurrent** when their `[createdAt, mergedAt]` intervals
   overlap. That yields **24 concurrent pairs**.
3. For each pull request, its migration files were read from the merged tree and run
   through **both** policies (`extractObjects` and `dispatchObjectKeys`).
4. A pair is "flagged" when the two sides share at least one object key.

**Results:**

| Measure | Count |
|---|---|
| Migration-bearing merged PRs | 85 |
| Concurrent PR pairs | 24 |
| Pairs flagged by the narrow (merge-guard) policy | 6 |
| Pairs flagged by the broad (dispatch) policy | 7 |
| **NEW pairs flagged only by the broad policy** | **1 (4.2%)** |

**Classification of the single new flag:**

| Pair | Shared objects | Class |
|---|---|---|
| #316 × #311 | `function pim.sync_clickup_tasks`, `function public.sync_clickup_tasks` | **USEFUL** |

#316 ("anon key could execute SECURITY DEFINER functions") and #311 ("ClickUp importer
would duplicate 17,859 products") were open at the same time and both wrote
`sync_clickup_tasks`. This is exactly the class of overlap the tool exists to catch, and
the ClickUp work is the same lineage as the migration that was **silently skipped in
preview and production** after the 20260728160000 version collision.

**Noise: 0 of 24 concurrent pairs (0%).** Harmless-but-worth-serializing: 0.

## 5. Decision

**Proceed with step 3b as built.** Both readings of the pre-registered rule pass:

- Merge guard: 0% new failures — it was not changed.
- Dispatch policy: 4.2% new flags, **all classified useful**, 0% noise — far inside the 20%
  ceiling.

## 6. Defects the replay itself found (and that were fixed before this was written)

Running the parser over all 437 migrations — rather than over fixtures — surfaced phantom
objects that fixtures never would have. Each was fixed at the source, not filtered out:

| Phantom | Cause | Fix |
|---|---|---|
| `table if`, `table as`, `table %s`, `table plm` | DDL built inside dynamic SQL string literals, e.g. `execute 'alter table if exists %s …'` | strip function bodies but retain top-level `DO` bodies, then strip string literals |
| `table their`, `table the` | English prose inside `comment on … is '…'` text | as above, plus: an unqualified `grant` target with no explicit object-type keyword is not believed |
| `table tables` (5 migrations) | `alter default privileges … grant all ON TABLES to r` — a form with no object name at all | negative lookahead; its own pattern handles that form |
| `table all` | `grant … on all tables in schema s` | negative lookahead |
| `table coldlion_promote_rows` (many migrations) | `create temporary table` scratch space inside promotion function bodies | temp tables are session-local and cannot collide — excluded from `create table` |
| `alter index` reported as covered with no pattern behind it | the inventory's noun check saw `index` was a known kind | a real `alter index` pattern was added |

## 7. Anti-regression measurement (plan step 3b requirement)

`inventoryDdlVerbs()` scans every file in `supabase/migrations/` for **statement-leading**
DDL verbs and reports whether each is modelled. The test
`no unmodelled DDL verb hides in the real migrations directory` fails when a form is
neither modelled nor listed in `DISPATCH_UNMODELLED_FORMS` with a written reason.

Current inventory: **36 distinct DDL forms**. Unmodelled: **3** — `create extension` (12),
`create event` (2), `drop event` (2) — all database-global objects rather than schema
objects, each carrying a written reason in `DISPATCH_UNMODELLED_FORMS`. That is **16 of
3 104 statements, 0.52%**, against a 5% ceiling asserted by the test. Literal DDL
inside top-level `DO` blocks is included in this count; function-body dynamic SQL is not.

This is the measurement whose absence let a parser blind to `alter table` ship behind a
green build for weeks.

## 8. Reproducing this

```bash
gh pr list --state merged --limit 400 \
  --json number,title,createdAt,mergedAt,files > prs.json
```

Then, from the repository root, for each merged PR read its `supabase/migrations/*.sql`
files out of the tree, build `narrow = extractObjects(sql)` and
`broad = dispatchObjectKeys(sql)`, form every pair of PRs whose
`[createdAt, mergedAt]` intervals overlap, and count pairs whose `broad` sets intersect
while their `narrow` sets do not. Those are the new flags to classify.
