# OPEN — #727 PopDAM OrderList Step 3: importer built and proven, real import NOT run

- **UTC:** 2026-08-11T13:30Z
- **Machine:** al8960ofc
- **Agent:** Claude (Opus 5), sub-agent of shared-db orchestrator session d152a272 (marker issue #739)
- **Repo / branch:** `u2giants/shared-db`, `feat/727-orderlist-idempotent-import`
- **Worktree:** `C:\repos\shared-db\.claude\worktrees\issue-727-orderlist`
- **Issue:** #727 — stays **OPEN**
- **Status:** Part B (code + tests) COMPLETE and green. Part A (real import) BLOCKED on an owner decision.

---

## 1. What this workstream is, for someone who has never seen it

PopDAM is one of the applications on the shared Supabase backend. Its order data
still lives in a Google Sheet ("the OrderList"), spreadsheet
`1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`, tab `Order`, gid `0`, 48 columns wide.

The migration off that sheet was planned in `plan_popdam_order_list.md` in four steps.
Step 0 (profile the source) and Step 1 (build the database contract) are DONE and on
`main`. **Step 3, this workstream, is: write an idempotent importer and run it once
against the PREVIEW database.** "Idempotent" means running it twice changes nothing the
second time — this matters because the sheet is live and the import will be re-run.

Step 3 was NOT started before this session. There was no importer at all.

## 2. Where the work came from (recovery context — read this)

A previous agent started #727 and was killed mid-run by a session limit. Its transcript
is gone. It had written two files and committed NEITHER. Its last recorded words were
"Option A authorized. Finishing B first as instructed: writing the synthetic test suite
now."

This session took over. **First action was to commit the orphaned files unchanged**
(commit `531493b`) so a second death could not lose them. Only then were they reviewed.
That ordering is deliberate and should be repeated by anyone recovering a dead agent.

## 3. What is DONE

### The importer — `scripts/import-order-list-xlsx.py` (~1,950 lines)

Written by the dead agent, reviewed and accepted by this session. It is genuinely
complete, not a stub. Structure:

- 48-column map by **letter** (`COL_IMPORT_PO = "B"`, etc.), matching the profile doc,
  because index arithmetic silently imports the wrong field.
- `ReconciliationBaseline` dataclass holding the Phase 0 numbers (12,328 populated /
  8,412 direct / 3,899 assortment / 15,816 components / 449 ambiguous / 130 blank-PO /
  3,083 normalized POs / 14 neither-shape / 10 structurally-invalid). The reconciliation
  report **asserts against these**, it does not merely print whatever the run produced.
- Deterministic source refs: `header_source_id()`, `line_source_id()`,
  `component_source_id()`. Blank-PO rows deliberately never share a header ref.
- `build_plan()` → `ImportPlan`, then `apply_plan(plan, gateway)`.
- Two gateways behind one `ImportGateway` interface: `InMemoryGateway` (tests AND
  `--dry-run`, so the dry run exercises the real code path) and `PostgresGateway`
  (needs `psycopg`).
- Drift handling: an existing row whose payload changed is **counted and reported, never
  silently rewritten**. Only `--replace-source` (preview-only) updates it.
- `render_report()` emits the secret-free reconciliation markdown.

Safety the file enforces itself:
- workbook SHA-256 must equal `--expected-sha256` (default = the approved constant);
- writes require BOTH `--preview` AND `supabase/.temp/project-ref` reading exactly
  `rjyboqwcdzcocqgmsyel`; the production ref `qsllyeztdwjgirsysgai` is refused
  unconditionally and **there is no flag that turns production writes on**;
- no raw customer/order/SKU text ever reaches stdout or the report — counts and
  deterministic refs only.

### The tests — `scripts/tests/test_import_order_list.py` (78 tests)

Plain `unittest`, fully offline: no database, no network, no workbook, no openpyxl.

```
cd C:\repos\shared-db\.claude\worktrees\issue-727-orderlist
python -m unittest discover -s scripts/tests -p "test_import_order_list.py"
# Ran 78 tests ... OK
```

Coverage maps 1:1 to what #727 demands: checksum gate, PO grouping, blank-PO isolation,
header-conflict quarantine (with explicit "no first-wins and no majority-wins" tests),
assortment expansion and alignment rejection, matched/ambiguous/unmatched/not-applicable
resolution, deterministic source refs, dry-run writes nothing, batch rollback, production
ref refused, and **second- and third-run no-ops against the fake DB layer**.

The importer is loaded by file path because `import-order-list-xlsx.py` is not a legal
Python module name — #727 specifies that exact hyphenated filename.

### The one change this session made to the rescued code

`042dd8b`. The report printed `- Target project ref: ...`, and `"Target"` is one of the
customer names the leak test screens for, so the report tripped its own guard. **The
label was renamed to `Destination project ref`; the assertion was NOT weakened.** That
was the only failing test (77/78 → 78/78).

## 4. What is NOT done, and exactly why — THE BLOCKER

**The real import has not run. Nothing has been written to preview or production.**

Albert explicitly authorized pulling the workbook through his own logged-in Chrome
("Grab it from my browser"). That worked — no login form, no password field, no MFA, no
bot check was encountered. Two exports were taken:

| Export URL | File | Bytes | SHA-256 |
|---|---|---:|---|
| `.../export?format=xlsx` (whole workbook, 16 sheets) | `OrderList.xlsx` | 10,690,991 | `b9b282dcc21921b5dcc2e2d3cbc0d5e66c9e48b9158470f02a8bb34828ffba30` |
| `.../export?format=xlsx&gid=0` (Order tab only) | `OrderList - Order.xlsx` | 2,762,055 | `904b2cb9ac5f21668dea72941c23d361170a768de7937804eacb27c3a00b2845` |

**Neither equals the approved checksum
`4958B4B7B783A46B968A0D5C9438364216303AD8B856B9B7E9AEBBDFFC6ABBE4`.**

And the content genuinely differs, not just the container:

- **Populated data rows in the `Order` tab today: 12,323.**
- **Phase 0 approved baseline: 12,328.**
- **Difference: 5 rows fewer.**

Both exports agree with each other at 12,323, so this is one consistent current state of
the sheet, not a flaky export. The out-of-range date serials the profile documented (e.g.
`Y10464`, `AD11560`) are still present, which confirms it is the same sheet — it has
simply been **edited by a human since the 2026-08-09 albt16 export**.

The importer refuses to run on it, correctly and by design.

**This is a finding for Albert, not something an agent should reconcile.** Someone
edited a live business spreadsheet mid-migration. Deciding what the canonical source is
now is an owner call.

## 5. What we tried that did NOT work — do not repeat these

- **`python -m pytest` — there is no pytest on this machine.** The suite is `unittest`.
  Use `python -m unittest discover -s scripts/tests -p "test_import_order_list.py"`.
- **Assuming the checksum mismatch was an export-flavor artifact.** It was not. Both the
  whole-workbook export and the `gid=0` single-tab export were taken and hashed; neither
  matches, and both report the same 12,323 rows. Do not burn another session re-trying
  export URL variants — the sheet content itself changed.
- **Weakening the leak test to make it pass.** The `"Target"` collision looked like a
  false positive worth deleting from the sentinel list. It was not — `Target` is a real
  customer name and must stay screened. The report label was renamed instead.
- **`git status` in the worktree looked clean at first glance** because the two rescued
  files were untracked, not modified. `git status --short` showed `??`. Always use
  `--short` when auditing a dead agent's worktree.
- **`supabase/.temp/project-ref` does not exist inside the worktree** — it is gitignored
  and lives only in the main clone at `C:\repos\shared-db\supabase\.temp\project-ref`
  (reads `rjyboqwcdzcocqgmsyel`). A `cat` inside the worktree returns "No such file" and
  looks alarming. It is fine.
- **Chrome had two browsers connected** and no browser may be picked by an agent.
  `switch_browser` was used, which prompts every connected extension and lets Albert
  click Connect. He connected `office-XPS`, which turned out to BE this machine
  (al8960ofc) — the display name does not match the hostname. The download initially
  looked like it had failed because `~/Downloads` showed nothing new; it was actually a
  `.tmp` partial file that Chrome renames on completion. Wait and re-check before
  concluding a browser download went to another machine.

## 6. Licensed data — where the workbook is, so it can be cleaned up

The workbook is licensed business data. It was **never committed, never pasted into an
issue or PR, never printed row-by-row into any log or report, and never sent to an
outside service.** Only counts and hashes appear anywhere.

Two files sit OUTSIDE the repository and should be deleted when no longer needed:

```
C:\Users\ahazan2\Downloads\OrderList.xlsx
C:\Users\ahazan2\Downloads\OrderList - Order.xlsx
```

## 7. Database boundary — what was and was not touched

- Target for this workstream is **PREVIEW ONLY: `rjyboqwcdzcocqgmsyel`**, verified at
  `C:\repos\shared-db\supabase\.temp\project-ref`.
- **Nothing was written to preview. Nothing was written to production.** No SQL of any
  kind was executed by this session.
- No migration was authored. Version `20260811040000` was pre-allocated for this
  workstream and was **not used** — it remains free. The db-claim was issue #745
  (`api.dam_order_list`, `plm.dam_order_line`); no objects were created.
- Production `qsllyeztdwjgirsysgai` remains untouched and is 56 migrations behind; the
  three OrderList contract migrations ride in unapproved atomic batch B9.
- `plm.item` is still empty and `plm.style_tracker_item_bridge.plm_item_id` still
  unpopulated (owned by `fix_schema_for_api.md` Phase 4). The importer honors this: it
  preserves exact matched/ambiguous/unmatched evidence but leaves `item_id` NULL, and it
  does not invent `plm.item` rows or a competing FK.

## 8. Exactly what the next session must do

**Step 1 — get an owner decision from Albert.** He has to choose one:

- **(a) Re-approve the current sheet.** Someone edited it; 12,323 rows is the new truth.
  Then update the approved SHA-256 to `b9b282dc...ffba30` (or the `gid=0` hash if the
  single-tab export is preferred) and the baseline `populated_rows` to 12,323 in BOTH
  `scripts/import-order-list-xlsx.py` (`APPROVED_SOURCE_SHA256`, `ReconciliationBaseline`)
  and `docs/app-migration-notes/popdam-order-list.md`, re-run the Phase 0 profile to get
  the other seven baseline numbers honestly, and only then import.
- **(b) Find out what the 5-row edit was** and whether the sheet should be restored from
  Google's version history to the 2026-08-09 state first.

Do NOT silently pass `--expected-sha256 b9b282dc...` to make the gate shut up. The gate
working is the good outcome here.

**Step 2 — once a source is approved, the real run is the ONLY remaining work.** It is
already wired; nothing more needs building:

```
pip install "psycopg[binary]"            # not installed on al8960ofc
python scripts/import-order-list-xlsx.py --workbook "<path>" --dry-run
python scripts/import-order-list-xlsx.py --workbook "<path>" --preview \
    --database-url "$PREVIEW_DATABASE_URL"
# then run the preview command a SECOND time and show it changed 0 rows
```

`openpyxl` 3.1.5 IS already installed. The preview connection string is not in this
session's context — get it from 1Password vault `vibe_coding` (serialize `op` reads).

**Step 3 — commit the reconciliation report** to
`docs/verification/popdam-order-list-preview-<date>/README.md`, assert against the
baseline, and confirm the `NCV3SP1` / `BFC02GABB` / `3FZ64SPC01` link checks.

**Step 4 — correct the `plan_popdam_order_list.md` STATUS table**, which #727 notes is
stale. This session did not touch it because Step 3 is not finished and writing it up as
finished is exactly the failure mode #727 warns about.

**Step 5 — close #727 only after the report is committed.** Not before.

## 9. Ownership boundaries observed (other live agents)

Untouched by this session, as instructed: `.github/workflows/**` and `supabase/tests/**`
(PR #741); `docs/verification/**` (PR #746); `tools/` and all of `scripts/` except the
two new files (PR #747); `apps/db-data-admin/**`; `plm.pmt_*`; `plm.dcp_*`;
`tools/sync-paramount-creative-library*`. `HANDOFF.md` and `AGENTS.md` are not owned by
this session and were not edited. This file is this session's own new `HANDOFF.d/` file
and no other session's handoff was edited or deleted.

**Delete this file when the real preview import has run and #727 is closed.**
