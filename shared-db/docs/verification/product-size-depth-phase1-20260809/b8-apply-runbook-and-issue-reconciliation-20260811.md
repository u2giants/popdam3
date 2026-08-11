# B8 (Product Size / Product Depth) — apply runbook, post-apply checks, and the #614–#617 reconciliation

Written 2026-08-11 by the recovery session for issue #597, after a previous agent was
killed mid-run by a session limit. Everything below was re-measured today; nothing is
carried over on trust.

**Environments.** Production `qsllyeztdwjgirsysgai`. Preview `rjyboqwcdzcocqgmsyel`.
Every production statement in this document is a READ. Nothing here applied anything.

---

## 1. Production state, measured 2026-08-11

```sql
select count(*), max(version) from supabase_migrations.schema_migrations;
```

| Fact | Value |
|---|---|
| Ledger rows applied | **373** |
| Highest applied version | **20260810140000** (applied OUT OF ORDER relative to `main`) |
| Unapplied migrations in `main` | **56** |
| B8's six versions present in the ledger | **0 of 6** |
| `to_regclass('core.product_size')` | **NULL — the table does not exist** |
| `to_regclass('core.product_depth')` | **NULL — the table does not exist** |
| `to_regclass('api.product_size_picker')` | **NULL** |
| `to_regclass('api.db_data_admin_product_depth_upsert')` | **NULL** |
| `20260810050000` (the access-provisioning migration) | **not applied** |

Note the object checks, not just the ledger. The ledger and the catalog are checked
separately on purpose: a ledger row is a claim, an object is a fact.

### B8 CANNOT BE APPLIED BY THIS SESSION

Batch B2 is staged and waiting on the owner's approval gate in GitHub Actions. B3–B7 are
unrun and unapproved. B8's six migrations sit behind all of them. **No B8 apply, no B8
dry-run, no workflow run was performed.** Everything in §3 and §4 is written to be
executed by whoever holds that authority once the gate opens.

---

## 2. The consumer-side failure this unblocks (issue #721 correction)

PopDAM's size picker is **not** falling back to the hard-coded `COMMON_SIZE_OPTIONS`, as
older documents claim. Because `core.product_size` is absent it errors on tier 1 and runs
on **tier 2** — free-text `public.style_groups.size_name`.

Re-measured on production today, and it has **drifted from the figures in
`docs/production-promotion-app-tolerance-contract.md`**:

| Measure | Contract doc | Live 2026-08-11 |
|---|---:|---:|
| `public.style_groups` rows | 8,327 | **10,629** |
| distinct non-null `size_name` | 316 | **318** |

That drift is itself the argument. The tier-2 set is free text that **grows as users type**,
so it can never be checked by eye. The B8 seed is 530 active identities. A post-apply check
that asks "does it look like a short generic list?" cannot distinguish 318 from 530 and
never could. **Use a count-and-content cross-check against the seed** (§4, check 8).

---

## 3. Pre-apply plan for B8 (a button-press when the gate opens)

Ordered, and each step's stop condition is stated.

1. **Confirm the batch order has actually completed.** B2 approved and applied, then
   B3–B7. B8 is last. Stop if the ledger's unapplied count is not what the batch plan
   predicts at that moment — recount, do not assume 56.
2. **Confirm the target.** `cat supabase/.temp/project-ref` immediately before the run,
   and compare it CHARACTER BY CHARACTER, not by shape. `qsllyeztdwjgirsysgai` is
   production; `rjyboqwcdzcocqgmsyel` is preview. They are the same length.
3. **Dry-run through the workflow, never by hand.**
   `.github/workflows/shared-supabase-migrations.yml`, `target: production`,
   `mode: dry-run`, typed confirmation `DRY-RUN <sha>`.
4. **The dry-run must list EXACTLY these six and nothing else:**

   | Version | File |
   |---|---|
   | `20260809170000` | `core_product_size_and_depth_foundation.sql` |
   | `20260809170100` | `core_product_depth_seed_from_designflow.sql` |
   | `20260809170200` | `core_product_size_seed_from_legacy_mg04.sql` |
   | `20260809170300` | `coldlion_product_size_guarded_importer.sql` |
   | `20260809170400` | `api_product_size_and_depth_pickers.sql` |
   | `20260809170500` | `db_data_admin_product_depth_mutations.sql` |

   **Any seventh version means STOP** — another workstream's migration is being carried
   along. `assert-bounded` (`scripts/production_migration_guard.py:834`) is what enforces
   this; do not wave it through.
5. **Apply.** Same workflow, `mode: apply`, typed confirmation `APPLY <sha>`, and the
   owner approves the `production` environment gate. The workflow re-runs the dry-run
   inside the same run and re-reads the ledger immediately before pushing (the TOCTOU
   guard), so a race between step 3 and step 5 fails closed.
6. **Expect the seed guards to print their own assertions.** On preview they read:

   ```text
   NOTICE: core.product_depth seeded: 121 legacy-backed rows (121 total), 121 source refs.
   NOTICE: core.product_size seeded: 538 identities (530 active, 8 inactive), 652 legacy source refs.
   ```

   Different numbers on production are a STOP, not a curiosity.

**Known gap, carried deliberately:** the guard pins migration version *names*, not file
digests — there is no `sha256`/`hashlib` anywhere in
`scripts/production_migration_guard.py` (verified today). Checkout is by exact SHA and
asserted equal to `origin/main`, so live risk is low, but **an audit after the fact cannot
prove which SQL text ran.** Tracked in the #617 successor recommended in §5.

**Second known gap:** the advisory model review does not run — `ANTHROPIC_API_KEY` is not
configured on the repo. It fails loudly and tells the approver to rely on the
deterministic guard, but there is no model-review layer on production applies today.

---

## 4. Post-apply verification — objects and behaviour, never ledger rows

Run against production after the apply. The contract file
`supabase/tests/product_size_depth_phase1_contracts.sql` already encodes most of this and
returned **38 passed / 0 failed** plus **3 supplementary passed** on preview.

| # | Check | Expected |
|---:|---|---|
| 1 | `to_regclass('core.product_depth')` | non-null |
| 2 | `core.product_depth` legacy-backed rows | **exactly 121** |
| 3 | Legacy Depth IDs and labels vs the DesignFlow source | **0 altered in transit** |
| 4 | `to_regclass('core.product_size')` | non-null |
| 5 | `core.product_size` status counts | **530 active, 8 inactive** |
| 6 | EP001 (Pages) rows in `core.product_size` | **0** — EP001's MG04 means Pages, not Size |
| 7 | All 8 named historical identities present and inactive | CW001 `5B`/`8H`/`TT`, EH001 `5B`/`8T`/`ET`/`M8`/`TT` |
| 8 | **Consumer cross-check** | PopDAM's size picker now serves **530**, not the ~318 free-text tier-2 values of §2 |
| 9 | Source-reference, audit, importer, picker and protected-mutation contracts | all exist (`to_regclass` / `pg_proc`) |
| 10 | Guarded MG04 importer | still **dry-run by default**; each guard fires (count band, division coverage, EP001 payload, retirement cap, dry-run isolation, idempotent replay, apply/mode separation) |
| 11 | Inactive Size values | display on items that already use them, **cannot be newly selected** (`selectable = false`) |
| 12 | Anonymous access | **denied** — no `api.db_data_admin_*` function grants EXECUTE to `anon` |
| 13 | Approved authenticated picker reads | succeed |
| 14 | Unauthorized Depth mutation | fails **and writes no data row and no audit row** |

Checks 12–14 have a precedent already measured against production by another agent, and it
should be cited rather than rebuilt: the **PM production test account** (identify it by its
`app.profile` UUID — this repository is public, so it is deliberately not named here; see
AGENTS.md §6.14) **holds the administrator role** but has `app_access = pm` only, and
receives **HTTP 403 on every DB Data Admin contract** (`channel_list`,
`licensor_property_tree`, `customer_list`). Anonymous receives 401. That is the "a role
alone is not sufficient" proof; it does not need running again.

---

## 5. Reconciliation of #614 – #617 against current `main` (297eb03)

Issue #712 assessed these on 2026-08-10. **Every one of its claims was re-verified against
current `main` today and all of them still hold.** Recommendations follow; per the dispatch
this session does not close issues.

### #614 — already CLOSED. No action.
`prepare` and `assert-bounded` are live at `scripts/production_migration_guard.py:809` and
`:834`. Any issue text still calling #614 a blocker is stale.

### #617 — RECOMMEND CLOSE as satisfied by `ca2eea2`, plus one narrow successor
`ca2eea2` is confirmed an ancestor of `main`. Verified line by line in
`.github/workflows/shared-supabase-migrations.yml`:

| #617 requirement | Status | Evidence |
|---|---|---|
| `apply` mode on the workflow | DONE | `:23` options `[dry-run, apply]` |
| `production` environment, owner as required reviewer | DONE | `:299` job `production-apply`; live `required_reviewers: [u2giants]` |
| Same allowlist, typed confirmation | DONE | `:250` requires `APPLY <sha>` |
| Fresh dry-run in the same run before apply | DONE | `production-apply-review` job at `:232` |
| Automatic model review | PRESENT but **inert** | `:281`, `continue-on-error: true`, `ANTHROPIC_API_KEY` unset |
| Model review never the only gate | DONE, hard-wired | `:282` |
| TOCTOU — re-read ledger before push | DONE | guard `assert-bounded` |
| **Content drift — pin file digests** | **NOT DONE** | no `sha256`/`hashlib` in the guard (grep returned nothing today) |

Successor issue should cover exactly two things: digest pinning, and recording the digests
in the apply artifact so an audit can prove what SQL ran.

One deliberate deviation worth recording rather than "fixing": the model verdict goes to the
job summary and artifact, not to a PR as #617's wording asks. That is better — the approver
reads it at the moment of approval.

### #615 — RECOMMEND CLOSE (superseded), or rewrite around a live figure
Its "47-migration allowlist" is **obsolete and dangerous**. The live unapplied count is
**56 today** (it was 63, then 53). A 47-item list would either be rejected by
`validate_candidates` or, worse, pass while silently omitting migrations. Its "blocked by
#614" line is stale. The `verify_dry_run` trap it warns about was real and is now resolved
by evidence — it executed successfully during the canary promotion and again for B1. The
batch plan in `docs/production-promotion-app-tolerance-contract.md` supersedes it.

### #616 — RECOMMEND AN EXPLICIT OWNER DECISION, not silent execution or abandonment
Still not started; nothing in `scripts/`, `tools/` or `.github/workflows/` implements a
clone or a ledger-seeding step (verified today). Its premise has shifted: it was designed
when the plan was one big push, and with the canary promoted, B1 applied and a nine-batch
bounded plan in place, a single whole-batch rehearsal buys much less. It also costs a
temporary paid Supabase project plus a production `pg_dump` — a full read of every row
**including the customer and vendor PII flagged in #645**, which is not obviously approved.
Its trap remains correctly stated and is now sharper: any clone must carry
`supabase_migrations.schema_migrations` with the **exact interleaved ledger**, not a row
count, because production applied migrations out of order (`20260729130000` is applied
while `20260729120000` is not).

---

## 6. Carlos / issue #607 — BLOCKED, and precisely why

**Measured on production today:**

| app | revoked | count |
|---|---|---:|
| crm | no | 27 |
| crm | yes | 4 |
| dam | no | 3 |
| pm | no | 2 |
| **admin** | — | **0** |

Every DB Data Admin `api.*` contract calls `app.require_db_data_admin_access()`, which
requires the `administrator` role **AND** a non-revoked `app.app_access` row with
`app = 'admin'`. Product Depth uses the sibling gate
`app.require_db_data_admin_product_depth_access()`, which widens the role arm to
`administrator` **or** `designer` but keeps the identical `admin` app_access arm.

With zero `admin` rows anywhere, **every DB Data Admin screen returns Access denied for
every user in production, the owner included.** This is a provisioning defect, not a policy
choice: the only function that inserts into `app.app_access` is the signup hook
`app.handle_new_auth_user`, which grants `crm`. No provisioning RPC and no admin surface
exists, so the row could never have been created.

**The fix is migration `20260810050000`, and it is UNAPPLIED.** It is data-only, zero DDL.
It provisions the three active `administrator` profiles **by role** (so entitlement and
grant cannot drift apart) plus one active `designer` profile **by profile UUID** — the
maintainer named in owner decision 1 on #597, already granted the designer role by
`20260726210000`. Addressed by UUID and never by email, because this repository is public.

**What becomes true the moment `20260810050000` applies**, and not one moment before:

1. Four `app.app_access` rows with `app = 'admin'` exist, non-revoked.
2. The three administrators can open every DB Data Admin screen: Customers, Vendors,
   Licensors, Properties, Product Depth.
3. The designer maintainer can open **Product Depth only**. The other four screens keep
   returning Access denied for them, because their gate requires the `administrator` role.
   That is correct and deliberate.
4. Nothing else changes. No role, function, policy, grant or enum is touched, and
   `public.app_access` — a different table with a different enum — remains untouched.

**No workaround was improvised and no `app_access` row was hand-inserted.** Both were
explicitly out of scope, and either would have masked the defect rather than fixing it.

**Note the ordering dependency:** `20260810050000` provisions access to screens that B8
creates. Applying it before B8 grants access to a Product Depth screen whose tables do not
yet exist. Apply B8 first.

---

## 7. DB Data Admin — Product Depth screen, verified against preview

The screen is built and the full write cycle is proven. Verified 2026-08-11 by driving the
real app in a browser against preview `rjyboqwcdzcocqgmsyel`, signed in as the non-SSO
tester, with screenshots at every step.

```text
BASELINE FOOTER:      124 of 124 depth values · 124 active
ACCESS_DENIED_PANEL:  0
REASON_GUARD:         Give a reason for this change; it is recorded in the audit trail.
DUPLICATE_GUARD:      Another Product Depth already uses that code.
AFTER ADD:            Product Depth "B8 verification value" added.        124 -> 125
AFTER RENAME:         Product Depth "... (renamed)" saved.
AFTER DEACTIVATE:     ... deactivated. Existing items keep it.
AFTER ACTIVATE:       ... activated.
FINAL:                ... deactivated. Existing items keep it.
```

No errors on any step. Offline: `tsc --noEmit` clean, `vitest src/ProductDepthTable.test.tsx`
**6 passed / 0 failed**.

**Preview left clean.** All four synthetic `ZZ-B8-*` verification rows were deactivated
through the app's own audited RPC path — never direct SQL, so the audit trail stays true.
Final state: **125 total, 121 active** — exactly the 121 legacy-backed values are active,
and no synthetic value can ever be offered in a picker. Values are never deleted by design;
deactivating is the correct terminal state.

### Two defects found and fixed, both only visible by LOOKING

1. **The detail form was unreadable.** The stacked label-above-input layout existed only as
   `.editor > label` — the modal dialog. Product Depth's form lives in `.detail-panel`,
   matched no rule, and rendered every caption INLINE beside its input at browser-default
   widths. "Label" and "Reason (recorded in the audit trail)" sat to the right of the boxes
   they described. This is the exact failure mode that "the live site looks exactly the
   same" describes, and no unit test could have caught it.
2. **The verification harness could not complete**: a fixed test code that worked exactly
   once (this screen deactivates and never deletes, so re-runs hit the duplicate guard and
   stalled), a column-filter textbox that only exists once its funnel is opened, and a row
   locator resolving to RevoGrid's invisible row-header pin element.

### Boundary respected
`DataAdmin.tsx:313`, the hard-coded workspace-bar label `Preview database`, is **untouched**.
Issue #729's launch agent owns making it environment-driven via `/config.js`. The diff was
byte-compared to confirm it appears as context only.

### Why this cannot leak to production
`app.db_data_admin_feature_gate` has **both** `merge_execute` and `single_record_write` set
to false in production, and production's UI has no Depth tab. There is also no Depth data to
serve, since `core.product_depth` does not exist there.

---

## 8. Remaining blockers to the DesignFlow and PopDAM consumer cutovers

1. **B8 is unapplied** (blocked on the B2 approval gate, then B3–B7). Until then
   `core.product_size` and `core.product_depth` do not exist in production, and PopDAM's
   size picker keeps serving ~318 free-text tier-2 values instead of the 530-identity seed.
2. **`20260810050000` is unapplied**, so DB Data Admin is closed to every user in
   production including the owner. Must be applied AFTER B8 (§6).
3. **No digest pinning** on the production apply path (§5, #617 successor).
4. **No model-review layer** on production applies — `ANTHROPIC_API_KEY` unset.
5. **`plm.item.product_size_id` / `product_depth_id` are deliberately un-backfilled.** Both
   stay NULL and the legacy compatibility text remains the reader of record until parity and
   rollback checks pass, exactly as #597 requires. The consumer cutover cannot begin before
   that backfill is designed, and it is not designed yet.
