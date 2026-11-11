---
summary: "#4428 acceptance: ACCEPTED close-out re-proof 2026-11-05 of migration 20261023122936 wrapping auth.uid() in 17 owner policies on 7 tables, with live re-proof."
kind: proof
status: done
read-when: "confirming the #4428 owner-uid RLS initplan acceptance evidence"
---

# #4428 acceptance

## Verdict: ACCEPTED (close-out re-proof, 2026-11-05)

The structural work was delivered 2026-10-23 and was already live in production
when this close-out started. This record adds the close-out evidence the issue
still lacked: a fresh read-only live re-proof, an installed-catalog policy
spot-check, and one repeated-workload plan measurement. No policy, migration,
grant, or data was changed while producing it.

## Source and production history

Migration `supabase/migrations/20261023122936_owner_uid_initplans.sql` (claim
#4624) wraps only request-constant `auth.uid()` in the 17 ownership policies
across `app_access`, `asset_checkouts`, `helper_devices`, `helper_tokens`,
`order_list_user_views`, `profiles`, `style_tracker_user_views`. `user_id`
comparisons stay row-dependent; `WITH CHECK` inheritance preserved; `has_role`
untouched.

- Authoring commit `7685878ce` ("wrap auth.uid() in 17 ownership policies at
  version 20261023122936").
- Delivered by [PR #4674](https://github.com/popcre/shared-db/pull/4674),
  merged `2026-10-23T13:10:44Z` as `7b333686f7b2b284734870a2ad6bc4db3e0ab127`.
- Applied to production by [run 39960456276](https://github.com/popcre/shared-db/actions/runs/39960456276)
  ("DB production apply 7b333686f7b2b284734870a2ad6bc4db3e0ab127 PR4674
  20261023122936"); original live-proof comment on the issue recorded
  `passed | true` (2026-10-23).
- Migration file SHA256 on `origin/main`:
  `81b55d55673f07aba441c777772717ebaa8a19079fecdf422233cdce5c7742b9`.

## Close-out re-proof (read-only, 2026-11-05, all times EST)

Target: the production project ref recorded in this repo's `AGENTS.md` data
model table (Supabase Management API read-only query + session-pooler psql,
password from 1Password `vibe_coding`; no writes issued; the measurement
transaction ended in ROLLBACK). The re-proof workflow run below binds to
production by construction; the 2026-10-23 apply run names the ref in its title.

### Step 1 — installed live proof and ledger

Committed probe `.github/live-proofs/4428.sql` re-run through
[run 42140556791](https://github.com/popcre/shared-db/actions/runs/42140556791)
at `main` tip `23f16250f09b8cdcd47bd3de0cb7fa02806141b1`, observed
2026-11-06T00:58:02Z (7:58 PM EST, 2026-11-05). Verbatim result line:

```
LIVE PROOF PASSED: #4428 at 23f16250f09b8cdcd47bd3de0cb7fa02806141b1 observed_at 2026-11-06T00:58:02Z
```

Ledger check: `select count(*) from supabase_migrations.schema_migrations where
version = '20261023122936'` → **1 row**.

### Step 2 — installed-catalog policy spot-check

Of 20 policies on the 7 tables, exactly **17 are wrapped**, each in the exact
form `(user_id = ( SELECT auth.uid() AS uid))` — bare `user_id` column left,
scalar InitPlan subquery right, in `qual` and/or `with_check` exactly as the
migration's family list requires:

| Table | Wrapped policies (17) | Unwrapped on same table (3) |
|---|---|---|
| app_access | Users read own app_access | Admins manage app_access (has_role admin family, out of scope) |
| asset_checkouts | users insert own checkouts, users update own checkouts | authenticated users see all checkouts (no owner predicate) |
| helper_devices | users insert own devices, users see own devices, users update own devices | — |
| helper_tokens | users insert own tokens, users see own tokens | — |
| order_list_user_views | owner_delete, owner_insert, owner_select, owner_update | — |
| profiles | Users read own profile, Users update own profile | Admins read all profiles (has_role admin family, out of scope) |
| style_tracker_user_views | Users insert/read/update their own style tracker views | — |

`has_role` appears only inside the two admin policies, unwrapped by this
family, as required. No extra wrapped policies appeared.

Performance advisor (`auth_rls_initplan`, fetched read-only 2026-11-05,
8:05 PM EST): 53 lints project-wide; the only two naming family tables carry
cache keys `…app_access_Admins manage app_access` and
`…profiles_Admins read all profiles` — both **out-of-family admin policies**,
matching the #4427 dispositions for `has_role` statements. **No lint names any
of the 17 ownership policies.**

### Step 3 — repeated-workload plan measurement

One transaction under `set local role authenticated` with
`request.jwt.claims` bound to a real user (id not recorded), ended in
`ROLLBACK`; no statement executed a write. Plain `EXPLAIN (costs off)` (no
ANALYZE), the three tables the close-out plan suggested:

```
explain select * from public.order_list_user_views;
  Seq Scan on order_list_user_views
    Filter: (user_id = (InitPlan 1).col1)
    InitPlan 1
      ->  Result

explain select * from public.style_tracker_user_views;
  Seq Scan on style_tracker_user_views
    Filter: (user_id = (InitPlan 1).col1)
    InitPlan 1
      ->  Result

explain select * from public.profiles;
  Seq Scan on profiles
    Filter: ((user_id = (InitPlan 1).col1) OR (InitPlan 2).col1)
    InitPlan 1
      ->  Result
    InitPlan 2
      ->  Result
```

Reading: `auth.uid()` (and the admin `has_role(auth.uid(), …)` on `profiles`)
is now computed **once per query** as an `InitPlan … -> Result` and compared
against the bare `user_id` column, instead of once per row as the 2026-10-18
baseline advisor warnings described. The expression is the only change, so no
path exists for a >10% median regression attributable to this migration; no
timing benchmark is claimed beyond the plans above (matching the #4427
UNATTRIBUTED-timings boundary: wall-clock deltas without bound physical state
prove nothing either way).

## Consumer write acceptance

**UNKNOWN** — no approved application test route exists for these tables'
write paths; recorded as unknown, not invented, per the 2026-11-04 close-out
plan. RLS semantics are unchanged (predicate equivalence was covered by the
offline suite and SQL contract tests delivered with PR #4674).

## Boundary

This record closes #4428's remaining acceptance items only. It does not
release other families' claims, does not close the wider #4421/#2326
programme, and does not alter the #4427 dispositions.
