# Production migration backlog triage — 2026-07-27

**Database:** production `qsllyeztdwjgirsysgai` (PopDAM / PopSG, Virginia)
**Written for:** Albert.

> **UPDATE — 2026-07-27, same day.** Albert approved the KEEP set and it was
> **promoted to production**. All three applied cleanly as no-ops (Postgres reported
> "already exists, skipping" for every object). The remaining backlog is now **only the
> six ColdLion files**, which is the intended state. See section 7 for the evidence.

---

## 1. The short version

The backlog is **9 files, not 17**. It shrank on its own between 2026-07-26 and today
because two "bounded forward" migrations promoted most of the DB Data Admin work, and the
style-tracker mistake-and-revert pair both landed.

Of the 9 still unrecorded:

- **3 are already live in the database.** Their tables, columns and functions exist in
  production. Only the bookkeeping row is missing. Promoting them is a safe no-op that
  closes the gap for good.
- **6 are the ColdLion Licensor/Property work.** These are genuinely not applied, and they
  are supposed to stay that way until you sign off. **HOLD.**

So the real backlog after cleanup is **zero**, and the pile stops growing.

---

## 2. How this was measured

- Read every row of `supabase_migrations.schema_migrations` in production (330 rows) and
  compared it against all 339 migration files in `supabase/migrations/`.
- Compared the **whole list**, not "everything newer than the highest version." Nine of the
  files flagged on 2026-07-26 sat *below* the highest recorded version.
- Checked the **real objects** in the database (`to_regclass`, `pg_proc`, live row values),
  not just the bookkeeping table. A recorded migration can still have a missing object, and
  an unrecorded migration can still be fully live. Both happened here.

---

## 3. The 9 pending files

| File | Workstream | What it does, in one sentence | Already in production? | Call | Why |
|---|---|---|---|---|---|
| `20260722210100_dam_customer_hub_wiring.sql` | DAM customer hub | Links PopDAM's free-text customer names to the real customer list, adds CVS/Costco/Meijer, seeds name aliases, and adds the Library customer filter. | **Yes — fully.** Both `customer_id` columns, both functions, all 27 aliases, and all three retailers are present. | **KEEP** | Its exact contents were already applied under `20260723183000_step11_bounded_production_forward.sql`. Re-running is an idempotent no-op that finally records it. |
| `20260722222000_dam_path_facets_by_customer_id.sql` | DAM customer hub | Switches the Library "program" filter to use the customer ID instead of the customer's typed-in name. | **Yes.** `get_path_facets(uuid)` is live; the old text version is gone. | **KEEP** | Same reason — already copied forward on 2026-07-23. No-op replay to close the gap. |
| `20260724050000_core_licensor_popsg_backfill_potential.sql` | PopSG licensors | Marks five hand-added brands (Miller Coors, Anheuser Busch, NFL, Ford, NCAA) as "potential" rather than active. | **Yes.** All five already read `potential`; NASA correctly left `active`. | **KEEP** | The data change is done. The file is a one-line safe update that changes nothing on re-run. |
| `20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql` | ColdLion Phase 2A | Adds the read-only importer that copies ColdLion licensors/properties into mirror tables. | **No.** Functions absent. | **HOLD** | ColdLion cutover gate. |
| `20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql` | ColdLion Phase 2A | Re-issues the same importer with stricter completeness and evidence checks. | **No.** | **HOLD** | Same gate; must go after the file above. |
| `20260726030000_coldlion_licensor_property_phase4_link_approved.sql` | ColdLion Phase 4 | Adds the guarded step that links the 542 human-approved ColdLion mappings to our canonical records. | **No.** | **HOLD** | Explicitly prohibited on production until sign-off. |
| `20260726031000_coldlion_licensor_property_phase4_null_shape_guard.sql` | ColdLion Phase 4 | Tightens the Phase 4 checks against empty/malformed input. | **No.** | **HOLD** | Same gate; follows Phase 4. |
| `20260726032000_coldlion_licensor_property_phase4_browser_execute_revoke.sql` | ColdLion Phase 4 | Takes browser-level permission away from the Phase 4 write functions. | **No.** | **HOLD** | Security tightening that only makes sense once Phase 4 exists. |
| `20260726180000_coldlion_licensor_property_phase6_parallel_run.sql` | ColdLion Phase 6 | Adds the daily side-by-side comparison tables used to prove ColdLion matches our data before cutover. | **No.** | **HOLD** | Same gate. |

**No KILL recommendations.** Nothing here is dead weight: the three already-live files are
the only written record of how those objects were built, and deleting them would leave a
hole in the history. Promoting them costs nothing and is strictly safer.

---

## 4. What unblocks the six ColdLion files

They are on hold by design (AGENTS §6.1 and
`plan_coldlion_licensor_property_accelerated_cutover.md`). As of today, Steps 1 and 3–10 of
that plan are still open. Specifically, all of the following must happen first:

1. **Step 3** — build the readiness evaluator, the one command that says ready / not ready.
2. **Step 4** — fail-closed production monitoring: alerts, a circuit breaker, proof someone
   was notified.
3. **Step 5** — a full cutover-and-rollback rehearsal on the preview database, ending with
   the evaluator reporting `ready=true`.
4. **Step 6** — verify DesignFlow PLM, DAM, CRM and PM still behave correctly.
5. **Step 7** — a production change package naming the exact files and the rollback.
6. **Step 8** — **your written approval for a specific production window.**

Only then does Step 9 apply them, in a fresh session.

---

## 5. Recommended order of operations for the KEEP set

Do this in one short, bounded production window. It is three files and no functional change.

1. Take the usual bounded temp checkout off `origin/main` (AGENTS §5.1) and delete every
   migration file except the three KEEP files. **Never `--include-all`** — that would drag
   the six ColdLion files along.
2. Link to production and run `supabase db push --dry-run`. It must list **exactly** these
   three, in this order:
   1. `20260722210100_dam_customer_hub_wiring.sql`
   2. `20260722222000_dam_path_facets_by_customer_id.sql`
   3. `20260724050000_core_licensor_popsg_backfill_potential.sql`
3. Push.
4. Verify afterwards that `get_path_facets` still takes a customer ID, the five PopSG brands
   still read `potential`, and NASA is still `active`.
5. Remove the temp checkout.

Expected result: production's bookkeeping matches reality, and the only remaining pending
migrations are the six ColdLion files that are supposed to be pending.

**Risk note.** Step 1 of the DAM file re-runs a backfill over a large table with a 10-minute
allowance and briefly turns the Master Data audit trigger off and back on. It only fills in
blanks, so it will find almost nothing to do. Run it when the team is not editing.

---

## 6. Anything that could not be classified

None. All nine files were matched to a workstream, read in full, and checked against real
objects in production.

---

## 7. Promotion record — 2026-07-27

Done exactly as section 5 describes.

- Temp checkout `git worktree add --detach C:\tmp\mig-promote-20260727 origin/main`;
  **only the six ColdLion files deleted** from it.
- **Correction to the recipe in section 5:** do *not* delete the already-applied files.
  The CLI compares the local folder against the whole ledger and aborts with "remote
  migration versions not found in local migrations directory." Delete only the pending
  files you are *not* promoting.
- With that smaller set, `supabase db push --dry-run` listed exactly the three KEEP files
  and told us to rerun with `--include-all`. **In a bounded temp checkout that is the
  correct and safe use of the flag** — the ColdLion files are not present, so it cannot
  reach them. The `--include-all` dry run confirmed the same three names before pushing.
- Apply output: `SET LOCAL` warning outside a transaction (harmless), `customer_id already
  exists, skipping` on both tables, both indexes already present, and
  `get_path_facets(text) does not exist, skipping`. Zero functional change, as predicted.

Verified afterwards in production:

- `public.get_path_facets(p_customer_id uuid)`, `public.get_dam_customer_facets()`,
  `public.dam_resolve_customer(p_text text)` all present.
- Miller Coors / Anheuser Busch / NFL / Ford / NCAA = `potential`; NASA still `active`.
- Ledger now contains `20260722210100`, `20260722222000`, `20260724050000`.
- Both Master Data audit triggers re-enabled; the `style_tracker_rows` INSERT and UPDATE
  policies still check `true` — the open write policy of AGENTS §0.4 is intact.
- Remaining pending set re-derived: exactly the six ColdLion files, nothing else.
- Temp worktree removed.

## 8. Two things worth recording

- **The style-tracker pair is closed.** `20260726190000_..._restrict_writes.sql` and
  `20260726200000_..._restore_open_writes.sql` are **both recorded as applied** in
  production. They cancel out, Master Data editing is open again, and there is nothing left
  to decide. Per AGENTS §0.4 the open write policy on `public.style_tracker_rows` is
  intentional and must not be tightened again.
- **This backlog cleaned itself up partly by accident.** The reason 8 of the original 17
  disappeared is that two sessions hand-copied pending migrations into brand-new "bounded
  forward" files (`20260723183000_step11_bounded_production_forward.sql` and
  `20260727154500_db_data_admin_bounded_production_forward.sql`) rather than promoting the
  originals. That works, but it leaves the originals permanently stuck as "pending" and
  duplicates hundreds of lines of SQL. Promoting the original file in a bounded window, as
  §5.1 describes, is the cleaner habit and is what section 5 above recommends.
