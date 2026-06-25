# fix_new_schema.md — popdam3 (DAM / PopDAM) shared-schema migration

**Read this top to bottom before changing anything. It assumes you have zero prior
context.** It explains what changed in the shared Supabase database, what *this*
app must change (very little — mostly docs + a types regen + one verification),
and what NOT to touch. Every path below is in **this** repo (`popdam3`). Do
**not** edit the vendored `shared-db/` folder — it is a read-only auto-synced
copy.

---

## 1. What changed in the shared database (and why)

The shared Supabase Postgres backend was restructured so the canonical customer
table holds **only customers**.

1. **`core.company` was hard-renamed to `core.customer`.** There is **no
   `core.company` anymore** (no compatibility view). "Company" was the wrong
   bucket — factories and licensors are companies too and have their own tables
   (`core.factory`, `core.licensor`), and email noise now lives in
   `crm.ingested_domain`.
2. **The Master Data candidate-search RPC was repointed.**
   `public.search_style_tracker_link_candidates(p_field_key, p_query, p_limit,
   p_match_mode)` — which the StylesPage / Master Data feature calls — used to
   return `target_table = 'company'` for the `customer` field. It now returns
   `target_table = 'customer'` and reads from `core.customer`. Its
   `target_schema` is still `'core'`. (This was done in shared-db migration
   `20260625153030_masterdata_candidate_search_to_customer.sql`.)
3. New column `core.customer.is_potential` exists (active vs. potential customer).
   The Master Data customer branch already filters to PLM (`designflow_plm`)
   source refs, so it inherently returns only PLM-backed customers — no behavior
   change needed there.

**What did NOT change** (do not "fix" these):
- The FK **column** `company_id` keeps its name on DAM tables
  (`dam.style_group.company_id`, `dam.asset.company_id`,
  `dam.style_guide_file.company_id`, and the style-tracker row's `company_id`).
  Only the **table** was renamed.
- `core.company_source_ref` keeps its name.
- The DAM app's own `customer` *string* columns on `assets` / `style_groups`
  (free-text customer name, not a FK) are unrelated and unchanged.

Full rationale: `shared-db/docs/shared-database-vision.md`, and the guidance note
`shared-db/docs/fix_masterdata.md` written specifically for this feature.

---

## 2. Good news: almost no app code changes

This app does **not** query `core.company` by name and does **not** hardcode the
literal `'company'`. The Master Data page treats the RPC's `target_table` value
**dynamically**, so the value flipping from `'company'` to `'customer'` flows
through without code edits. Confirmed call sites in
`src/pages/StylesPage.tsx`:

- Lines ~292–298 and ~301–306 — `.rpc('search_style_tracker_link_candidates', …)`
  (fuzzy, then "all" fallback). The result's `target_table` is used dynamically.
- Line ~77–83 — `type LinkCandidate = { target_schema; target_table; … }` — a
  generic shape; no literal `'company'`.
- Line ~392 — `p_target_table: candidate.target_table` — passes the value through
  to the resolution RPC (see §3 — verify this).
- Line ~601 — `target_table` used only inside a React `key`. Harmless.
- Line ~229 — `if (field === "customer") return Boolean(row.company_id);` — uses
  the **`company_id` column** (name unchanged) and the DAM **field key**
  `"customer"` (never `"company"`). No change.

So: **no required edits in `StylesPage.tsx`.** Do the verification in §3, the
types regen in §4, and the docs in §5.

---

## 3. The one thing you MUST verify (resolution write-back + stale data)

The StylesPage passes `candidate.target_table` (now `'customer'`) into a
resolution RPC (around `StylesPage.tsx:392`, `p_target_table: …`). You must
confirm two things — they may be DB-side and require coordinating with the
shared-db owner:

1. **Does the resolution path accept `'customer'`?** Find whatever consumes the
   stored resolution — an RPC like `upsert_style_tracker_value_resolution` or a
   resolver that builds `core.<target_table>` to look up the linked row by id. If
   any such function/validation expects the literal `'company'` or builds
   `core.company`, it must be updated to `'customer'` / `core.customer`. (On the
   preview branch no such function was found by that name, so it may live only on
   production or under a different name — check both.)
2. **Stale persisted rows.** Any previously-saved style-tracker resolutions that
   recorded `target_table = 'company'` now point at a table that no longer exists.
   They will need a one-time data fix: `update <resolutions table> set
   target_table = 'customer' where target_schema = 'core' and target_table =
   'company'`. Identify the table that stores resolutions and coordinate this
   update with the shared-db owner (it is a shared-DB change, so it belongs in a
   committed shared-db migration, not here).

If neither a write-back function nor stored `'company'` rows exist, there is
nothing to do here — but **verify**, don't assume.

---

## 4. Regenerate the Supabase types

`src/integrations/supabase/types.ts` is the generated types file. It currently
does not reference a `company` table directly (this app doesn't query it), but
regenerate it so it reflects the renamed table and any new columns:

```bash
supabase login          # or export SUPABASE_ACCESS_TOKEN=<token from owner/1Password>
supabase gen types typescript --project-id qsllyeztdwjgirsysgai --schema public,core,dam > src/integrations/supabase/types.ts
```
> Target the **preview** branch (`--project-id xjcyeuvzkhtzsheknaiu`) if you need
> to regenerate before production has been renamed. Then `npm run build`.

---

## 5. Docs in this repo to update (`core.company` → `core.customer`)

These files contain now-stale references and must be corrected so the next
developer/AI isn't misled (the table no longer exists):

- `docs/MASTER_DATA.md` (~line 80) — "Do not treat `core.company` as canonical…"
  → `core.customer`; note that the customer branch already filters to PLM source
  refs, and that `is_potential = false` marks confirmed customers.
- `HANDOFF.md` (~lines 216, 225, 253, 263) — replace `core.company` with
  `core.customer`; update the "Rossy"/noise example to note that email noise now
  lives in `crm.ingested_domain` and confirmed customers are `is_potential =
  false`.
- `AGENTS.md` (~lines 393–396) — replace `core.company` with `core.customer`;
  keep the note that canonical customer data comes from PLM.
- `use_plm_tables.md` (~lines 27–28, 41, 53–54, 94) — `core.company` →
  `core.customer`; keep the guidance that `company_id` FK columns retain their
  names and that you join `core.customer` to `core.company_source_ref`.
- `use_master_data_plm_tables.md` — re-read; if it already documents the rename,
  leave it; otherwise align it.

---

## 6. Production cutover note

This app reads via the RPC (name unchanged, dynamic `target_table`) and via
`company_id` columns (names unchanged), so it does **not** break at runtime when
production is renamed — unlike PM (`poppim-web`), which queries `core.company`
directly and must deploy in lockstep with the prod promotion. Your changes here
(types regen + docs + the §3 verification) can ship on your normal schedule. Just
make sure the §3 resolution path is sorted **before** production is renamed, so
newly-saved `'customer'` resolutions resolve correctly and old `'company'` ones
are migrated.

---

## 7. How to verify

```bash
npm install
npm run dev   # point env at preview xjcyeuvzkhtzsheknaiu to exercise the new schema
```
- Open the Master Data / Styles page, trigger a customer-field match → candidates
  still appear (now `target_table = 'customer'`), and selecting one saves and
  resolves to the right customer.
- `npm run build` passes.

---

## 8. Commit rules

App repos **commit straight to `main`** (no branches), build must pass, push, CI
deploys. Don't touch `shared-db/` (auto-synced from `u2giants/shared-db`).

## 9. Checklist

- [ ] §3 — verify the resolution write-back accepts `'customer'`; migrate any
      stored `target_table = 'company'` rows (coordinate with shared-db owner)
- [ ] Regenerate `src/integrations/supabase/types.ts`; `npm run build` passes
- [ ] Update docs: `MASTER_DATA.md`, `HANDOFF.md`, `AGENTS.md`, `use_plm_tables.md`
- [ ] Smoke-test the Master Data customer matching on preview
- [ ] No edits needed in `StylesPage.tsx` (verify the grep below is clean)

```bash
grep -rn "'company'\|\"company\"\|core\.company" src/   # expect: nothing meaningful (only dynamic target_table usage)
```
