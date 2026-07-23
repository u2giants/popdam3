# Sample Tracking schema audit (Grok, 2026-07-23)

> **Provenance:** Independent read-only audit by **Grok (grok-4.5, Grok CLI)**, run 2026-07-23 with file-read/grep only (no edits, no shell, no DB). Its schema claims were independently re-verified against live production (`qsllyeztdwjgirsysgai`) by the calling engineer; the highest-impact findings (movement CHECK vocab, in-transit line requirement, closeout watermark NOT NULL, owner FK target, and the two completion-logic view defects) were confirmed true. Findings are Grok's wording, filed verbatim for the record.

---

# Sample Tracking schema audit (read-only)

Scope: plan `fix_sample_tracking_schema.md`, `HANDOFF.md` Sample Tracking sections, migrations `20260721201500` + `20260722221000`–`20260722221700`, and tests under `supabase/tests/*sample*`. Production object existence is taken as given. No files were edited; no shell was run.

---

## 1. Definition of Done (plan §16)

| DoD bullet | Verdict | Evidence |
|---|---|---|
| All seven sample tables have a documented canonical `dflow` contract | **Partially met** | Six restored in `20260721201500` (lines 30–35); seventh in `20260722221000` (42–43). Contract is the migrations + plan, not a separate frozen consumer contract doc. `quantity_intended` later added on membership (`221300` 28–33). |
| Membership DB-idempotent under concurrency | **Met** (constraint); **partially** (proof) | `UNIQUE (sample_id_fk, box_id_fk)` at `221100` 58–60. Sequential unique-violation test in `dflow_sample_shipment_item_restore.sql` 97–106. True two-connection race is **not** in repo tests (claimed only in verification MD). |
| Box ownership durable and vendor-safe | **Partially met** | Column + state + index + FK in `221200` 4–27. No immutability trigger, no CHECK tying `owned` ↔ non-null owner, no tenancy RLS/grants. |
| Physical quantity conserved via immutable normalized movements | **Mostly met** | `sample_movement` + guard + immutability + `post_sample_movement` in `221400`. Source-balance check is real; full conservation equation is not a DB constraint; free mint via repeated `terminal/created` (and overage/opening) is allowed. |
| Local closeout ≠ global completion | **Partially met** | Tables/views exist (`221400` 100–114; `221600` 27–42). Closeout is not allocation-gated; global status can flip to `complete` while physical balances remain if closeouts are present (see Critical/High). |
| Imports and receipts use one authority | **Partially met** | Import tables in `221500`; movements via `post_sample_movement`. No DB force that import confirmation must post through that API only (service convention only). |
| Legacy unknown stays explicitly unknown | **Met** | Default `'unknown'` `221200` 8–18; comment forbids qty-1 fabrication `221700` 24; no migration fabricates quantity 1. |
| Views, grants, RLS, indexes, audit fields verified | **Partially met** | Five views + useful indexes + actor/idempotency fields. `REVOKE` from `anon`/`authenticated` only. **No RLS.** No explicit app-role grants. Acceptable for pooler/`postgres` path; does **not** meet plan §7 tenancy-as-DB-contract. |
| Four-piece, India-direct, discrepancy, concurrency, correction, auth tests on preview | **Partially met** | `sample_tracking_quantity_contract.sql`: four-piece, idempotency, overdraw, immutability, outstanding. **Missing in-repo:** India-direct, discrepancy mandatory, correction, closeout, auth, durable concurrent race. |
| shared-db PR merged; migrations applied | **Met** (per plan/HANDOFF + your prod confirmation) | Plan header + HANDOFF 90–107; objects you listed exist in prod. |
| Consumers updated only after schema | **Out of band / partial** | HANDOFF: “Consumer service wiring remains separate.” Schema side is ready; DoD consumer item is not proven by these migrations. |
| Production status + consumer SHAs recorded | **Partial** | Schema/ledger recorded; consumer deploy SHAs not part of these migrations. |

---

## 2. Quantity rules (§6) and movement authority (§5.4)

| Requirement | Status | Evidence |
|---|---|---|
| Quantity positive integer | **Met** | `CHECK (quantity > 0)` — `221400:7` |
| Source ≠ destination | **Met** | `CHECK (from_location_type <> to_location_type OR from_location_id <> to_location_id)` — `221400:30` |
| Idempotency uniqueness | **Met** | `UNIQUE (sample_id_fk, idempotency_key)` — `221400:29`; replay + conflict in `post_sample_movement` — `221400:86–93` |
| Posted rows not silently UPDATE/DELETE by normal roles | **Met** (trigger) + fail-closed PostgREST | Immutable trigger `221400:67–71`; `REVOKE` `221400:117–118`. Trigger fires for all roles including table owner. |
| Over-allocation / negative balance at DB | **Met** for non-opening sources | Guard `221400:52–58` under advisory lock. Opening sources exempt: `terminal` + `created`/`receipt_overage`/`reconciled_opening` — `221400:52`. |
| Concurrency real (lock, not bare SELECT) | **Met** | `pg_advisory_xact_lock(21450, sample_id)` in guard and poster — `221400:45, 86` |
| Auth + route/box ownership in the transaction service | **Not in DB** | `post_sample_movement` has **no** authz, ownership, or route checks — `221400:73–98` |
| Identical retry returns original; conflicting reuse fails loud | **Met** | `221400:87–93`; tested `sample_tracking_quantity_contract.sql:17–23` |
| Required location IDs exist for type | **Not met** | Free-text `from_location_id` / `to_location_id`; no office/factory/customer dimension FKs |
| Reversal same sample, not self | **Met** | Self-check `221400:31`; same-sample in guard `221400:46–50` |
| in_transit tied to box/line | **Met** | `221400:33`; hardened box identity `221700:4–8` |

---

## 3. Membership uniqueness (5.1 / 3.3)

- **Present and correct for non-null boxes:** `sample_shipment_item_sample_box_uniq UNIQUE (sample_id_fk, box_id_fk)` — `221100:58–60`. Loud pre-check abort on duplicate groups — `221100:31–48`.
- **NULL `box_id_fk`:** intentionally allowed; multiple NULL-box rows for the same sample succeed (`dflow_sample_shipment_item_restore.sql:108–120`). Matches SQL UNIQUE NULL semantics and app “create membership before box” note (`221100:14–18`).
- **Gap:** same sample in **two different boxes** is allowed. Plan §11 (“not silently moved” between active boxes) is **not** a DB rule.
- **After `ON DELETE SET NULL` on box FK** (`221000:65–68`): deleting a box can leave multiple same-sample rows with `box_id_fk NULL`, which the unique constraint does not collapse.

---

## 4. Feature areas 5.2–5.8 + grants/RLS

### 5.2 Box ownership — present, incomplete

- Columns: `owner_factory_id_fk`, `ownership_state` — `221200:4–6`
- FK → `dflow.vendor(vendor_id)` `NOT VALID` — `221200:20–23` (new rows still checked; existing not validated; no later `VALIDATE`)
- Index — `221200:27`
- **Missing:** immutable-to-vendors; CHECK that `owned` ⇒ non-null owner; ambiguous-box protection beyond a free-text state enum

### 5.3 Normalized locations — partial

- Types constrained on movements (`factory|office|customer|in_transit|terminal`) — `221400:8–12`
- **No** configured office records; Ningbo/NYC are bare strings in tests (`ningbo`, `nyc`)
- Labels optional, not required audit snapshots

### 5.5 Shipment intent — present and separated

- `dflow.sample_shipment_line` with positive intended qty, route legs, states, idempotency — `221300:4–23`
- Membership adapter also gets nullable `quantity_intended` — `221300:28–33`
- Intent vs movement correctly not conflated in schema comments (`221700:23`)
- **Missing:** DB enforcement that short/over receive requires discrepancy; no automatic line state machine from movements

### 5.6 Stop closeout — table yes, rules weak

- Fields match plan shape — `221400:100–114`
- **No** insert trigger: stop may close while units remain; no “fully allocated” check (plan 5.6)

### 5.7 Durable imports — present

- Job + row tables, hashes, counts, confirmation key uniqueness, JSON row audit — `221500:4–44`
- Blobs not stored in DB (object keys only)
- **Missing:** DB “no partial silent success” for confirm (service concern); `UNIQUE(confirmation_idempotency_key)` allows many NULL keys

### 5.8 Read models — five views, good shape, two logic hazards

| View | File:lines |
|---|---|
| `sample_balance_by_location` | `221600:4–11` |
| `sample_in_transit` | `221600:13–18` |
| `sample_receipt_discrepancy` | `221600:20–25` |
| `sample_open_stop_work` | `221600:27–34` |
| `sample_global_status` | `221600:36–42` |

**Grants/RLS vs dflow convention**

- `dflow` is **not** in PostgREST `pgrst.db_schemas` (AGENTS.md §8.1). Runtime is the tracking service via pooler as a privileged DB role.
- `REVOKE … FROM anon, authenticated` on quantity tables/views/function is **correct fail-closed** for browser paths and matches that architecture.
- That reasoning **does not** cover plan §7 vendor isolation / “read-only fails closed even if router is wrong” for the **service DB role**: there is no RLS and no least-privilege role for movements. Tenancy is entirely application-layer. Document that as intentional only if product accepts it; the plan text still asks for RLS/grants designed together.

---

## 5. Findings by severity

### Critical

**1. Closeout can hide remaining quantity and mark the batch complete**

- **Claim:** A stop closeout with `state='closed'` and `movement_watermark >= max(movement_id)` removes that location from open work even when balance &gt; 0; with no transit, `sample_global_status` becomes `complete`.
- **Evidence:** `221600:27–41` (open work filters on closeout watermark only; global falls through to `'complete'`). Closeout table has no allocation guard — `221400:100–114`.
- **Why it matters:** Plan §1 / §11: local close must not imply global completion while pieces are unresolved; retention at Ningbo/NYC is a real end state of the four-piece scenario and should not silently look “done” if retained units still count as outstanding (open Q §15.4, but plan wording favors “unresolved until none remain unresolved”).
- **Fix:** (a) Trigger on closeout: either require balance at stop = 0 **or** require explicit retained/disposition disposition codes; (b) redefine `sample_global_status` so any non-terminal physical balance keeps `outstanding` regardless of closeout; (c) treat only `terminal/*` (delivered, disposed, lost, …) as globally resolving.

**2. `known` sample with zero movements is derived `complete`**

- **Claim:** `quantity_migration_state='known'` and no movements ⇒ no open stop, no transit ⇒ `'complete'`.
- **Evidence:** `221600:37–41` (`ELSE 'complete'`).
- **Why it matters:** Dashboard/false green; invents “done” without any custody history.
- **Fix:** Require at least one create/opening movement (or non-zero conserved quantity) before `complete`; else `outstanding` / `uninitialized`.

### High

**3. Discrepant receipts not forced at DB**

- **Claim:** Receive can under/over intended qty with `discrepancy_code` NULL.
- **Evidence:** Discrepancy CHECKs only shape when code/details present (`221400:32`, `221700:10–13`). No check against `sample_shipment_line.quantity_intended`.
- **Why it matters:** Plan 5.5 / §11 require short/over/damaged to carry discrepancy and keep every unit accounted.
- **Fix:** On `receive` insert (trigger or `post_sample_movement`): if linked line and cumulative receive ≠ intended (final) or partial policy, require `discrepancy_code` + details.

**4. Box ownership not vendor-safe in the database**

- **Claim:** Any privileged client can reassign `owner_factory_id_fk` / `ownership_state`.
- **Evidence:** `221200:4–25` adds columns only; no immutability trigger; no CHECK `(ownership_state='owned') = (owner_factory_id_fk IS NOT NULL)`.
- **Why it matters:** Plan 5.2 “immutable to vendors”; tenancy bridge depends on this stamp.
- **Fix:** CHECK for owned/internal/ambiguous consistency; BEFORE UPDATE trigger blocking owner change except privileged reconciliation role; optional history table.

**5. Authorization / tenancy contract (§7) not implemented in SQL**

- **Claim:** Vendor isolation, office restriction, read-only fail-closed are not DB-enforced.
- **Evidence:** `post_sample_movement` is pure insert path `221400:73–98`; only REVOKE from `anon`/`authenticated` (`221400:117–118`, `221500:48`, `221600:44`).
- **Why it matters:** Pooler path uses a powerful role; a bug or direct SQL can move any factory’s quantity.
- **Fix:** Dedicated DB role for tracking service + RLS (or SECURITY DEFINER poster that checks actor_factory / office claims from a verified session context). If deliberately app-only, record that as an accepted residual risk against §7.

**6. Required test matrix incomplete in repo**

- **Claim:** India-direct, discrepancy, correction, closeout-vs-global, true concurrency, and auth tests are not in `supabase/tests/`.
- **Evidence:** Only `sample_tracking_quantity_contract.sql` and `dflow_sample_shipment_item_restore.sql`. Verification MD claims two-connection race but is not executable regression in-repo; timestamps in that MD still say `220200`–`220700` (stale vs `221200`–`221700`).
- **Why it matters:** DoD §16 and §11 gates.
- **Fix:** Add rolled-back SQL tests for each scenario; keep concurrent race as a documented multi-session script under `docs/verification/` with exact steps.

### Medium

**7. Unlimited free quantity via opening terminal sources**

- **Claim:** Repeated `terminal/created` (or `receipt_overage` / `reconciled_opening`) with new idempotency keys invents units with no upper bound.
- **Evidence:** Guard skip list `221400:52`.
- **Why it matters:** Conservation of “total created” is soft; corrections/overages need audit discipline the DB does not enforce (e.g. one create per sample, overage only with discrepancy).
- **Fix:** Policy constraints (e.g. at most one non-correction create; overage requires `discrepancy_code='over'` and shipment_line).

**8. Location IDs are unconstrained free text**

- **Claim:** Plan 5.3/5.4 “required location identifiers exist for their type” is not enforced.
- **Evidence:** `text` columns + non-empty checks only — `221400:8–12`.
- **Fix:** Optional `dflow.sample_location` seed for offices; CHECK or FK patterns for factory/customer/box-as-transit.

**9. `sample_in_transit` can drop legitimate balances**

- **Claim:** Rows with `location_type='in_transit'` whose `location_id` is non-numeric are excluded (`~ '^[0-9]+$'`), so dashboards can under-report transit even though balance view still shows them.
- **Evidence:** `221600:13–18`. Hardening requires transit id = `box_id_fk::text` for new rows (`221700:4–8`), which mitigates going forward.
- **Fix:** Prefer join on `box_id_fk` from the latest movement rather than casting balance location_id.

**10. No DB rule against multi-box concurrent membership**

- **Claim:** Same sample can hold memberships in multiple boxes.
- **Evidence:** UNIQUE only on `(sample, box)` — `221100:58–60`.
- **Fix:** Partial unique on `sample_id_fk` WHERE box NOT NULL **if** business is single active box; or status flag on membership.

**11. Import confirmation partial-success not DB-guarded**

- **Claim:** Job can be marked `confirmed` while rows lack movements/samples; no transactional confirm function.
- **Evidence:** State enum only — `221500:13`; no confirm RPC.
- **Fix:** `confirm_sample_import(...)` SECURITY DEFINER that posts movements atomically or fails the job.

**12. Membership lacks its own idempotency key**

- **Claim:** Plan 5.1 lists idempotency/correlation on membership; only unique (sample, box) exists.
- **Evidence:** restore columns from plm (`221000`); no idempotency column added later.
- **Fix:** Optional `idempotency_key` UNIQUE if the service needs cross-request membership retries beyond unique membership.

### Low

**13. Owner FK left `NOT VALID` forever**

- **Evidence:** `221200:20–23`; no `VALIDATE CONSTRAINT` in `221700`.
- **Fix:** `VALIDATE CONSTRAINT sample_box_owner_factory_fkey` after data is clean (safe: empty/tiny inventory).

**14. Shipment lines mutable; no immutability after ship**

- **Evidence:** No update/delete triggers on `sample_shipment_line` (`221300`).
- **Fix:** Freeze row when `state IN ('shipped','received',…)` except controlled transitions.

**15. Verification doc timestamp drift**

- **Evidence:** `docs/verification/sample-tracking-quantity-schema-20260722.md` lines 5–8 still cite `20260722220200`–`20700`.
- **Fix:** Update to `221200`–`221700` so operators do not dry-run the wrong set.

**16. Closeout / import / shipment_line not granted or revoked from PUBLIC explicitly on tables**

- **Evidence:** REVOKE targets only `anon`/`authenticated`. Usually fine on Supabase; belt-and-suspenders would `REVOKE ALL ON … FROM PUBLIC`.

### Nit

**17. Test comment stale**

- `dflow_sample_shipment_item_restore.sql:3` still says run after `20260722220000` / `220100`.

**18. `lifecycle_action` includes `retain`/`closeout` but retain cannot be same-location movement**

- Same-location forbidden (`221400:30`); retain is correctly “leave balance + closeout,” but the enum invites misuse. Document or drop unused actions.

---

## 6. Plan items not implemented (or only stubbed) by these migrations

| Plan item | Status |
|---|---|
| Configured office records for Ningbo/NYC (5.3) | Not implemented (string IDs only) |
| DB validation that location IDs exist for type (5.4) | Not implemented |
| Route / box ownership / destination validation in movement transaction (6.5) | Not in SQL |
| Stop closeout only when fully allocated (5.6) | Table only; no rule |
| RLS + least-privilege grants for vendor/office/read-only (§7, DoD) | Only PostgREST deny |
| Membership historical legs decision (5.5 / §15 Q1) | Decided operationally: current membership + additive `sample_shipment_line` (good), not fully written back into plan open questions as closed with consumer contract |
| India-direct fixture / discrepancy mandatory / correction / auth tests (§11) | Not in repo tests |
| Observability metrics/alerts (§13) | Out of scope of SQL; not present |
| Consumer model/service update + SHAs (DoD) | Explicitly separate |
| Ownership immutability to vendors (5.2) | Not implemented |
| Single-active-box / no silent multi-box move (§11) | Not implemented |
| Force import/UI/carrier through one transaction service (6) | Convention only; no DB monopoly beyond REVOKE browser roles |

---

## 7. What is solid (skeptical credit)

- **Membership hole fixed:** seventh table restored with FKs/indexes; uniqueness with loud duplicate abort.
- **No quantity-1 fabrication:** legacy default `unknown`; comment and inventory decisions align with plan decision #9.
- **Movement core is real engineering:** positive qty, distinct endpoints, unique idempotency, advisory lock, balance check on insert, immutable UPDATE/DELETE trigger, compensating-correction shape, transit requires box+line, hardening for transit id and discrepancy details.
- **Intent split:** `sample_shipment_line` vs movement is correct architecture.
- **Import audit tables** are additive and non-blob.
- **Browser surface fail-closed** fits dflow-not-in-PostgREST convention.
- **Four-piece happy path** is proven in SQL test for balances and basic invariants.

---

## Overall verdict

**No — not fully faithful and not fully safe against the plan as written**, though the **core quantity ledger is substantially implemented and production-present**.

The migrations deliver the structural contract the tracking service needs (membership uniqueness, ownership columns, movement table + poster + immutability, intent lines, closeouts, imports, five views) and correctly avoid fabricating legacy quantity 1. The concurrency and over-allocation protections on **source balance** are real database mechanisms, not bare unguarded SELECTs.

Top residual risks: (1) **closeout + global status can declare completion while physical units remain** at factory/office/customer; (2) **zero-movement `known` samples report complete**; (3) **tenancy/authorization and discrepancy rules live only in the app**, while the privileged pooler role can post arbitrary movements; (4) **test/DoD matrix is incomplete**, so several plan gates are asserted by docs rather than durable SQL regression. Treat consumer wiring as unfinished per HANDOFF; treat global-completion semantics and closeout rules as the first schema follow-ups before the UI trusts `sample_global_status` as authority.
