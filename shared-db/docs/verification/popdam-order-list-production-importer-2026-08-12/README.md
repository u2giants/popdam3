# PopDAM OrderList production importer — gate design and row-count finding

Issue: [#852](https://github.com/u2giants/shared-db/issues/852). Claim: [#856].
Requirements source: `docs/verification/popdam-order-list-production-approval-2026-08-12/README.md`, "Required importer change before an approval can be exact".

This document contains counts, hashes, object names and command shapes only. No workbook rows, customer, vendor, SKU or order text, and no credentials.

## What this change did NOT do

- **No production import was run. Nothing was written to `qsllyeztdwjgirsysgai` by this work, in any mode, for any reason.** The `--production` path has never been executed.
- **No preview import was run either.** The existing preview evidence is unchanged.
- No database object was created, altered or dropped. No migration was authored.
- No SQL of any kind was executed.
- The licensed workbook was not present on this machine and was not needed. Every test is offline and synthetic; the checksum was stubbed only in the tests that exercise gates sitting *after* the checksum gate.

## The gates, in the order they fire

Gates 1-11 are checked **before the connection string is read**, so a wrong invocation never touches a credential. Gates 12-14 necessarily require a connection; they run immediately after it opens and before any write, and no row is written until all of them and the pre-write balance checks pass.

| # | Gate | Function | Refusal proof |
|---:|---|---|---|
| 1 | `--preview` and `--production` mutually exclusive | argparse mutually-exclusive group | `test_preview_and_production_are_mutually_exclusive_in_argparse` |
| 2 | `--replace-source` refused with `--production` | `main()` | `test_replace_source_with_production_is_refused_by_the_cli` |
| 3 | Workbook SHA-256 pinned to the approved constant; `--expected-sha256` / `ORDER_LIST_SHA256` cannot relax it | `main()` | `test_expected_sha256_cannot_relax_production` |
| 4 | Full 40-character `--reviewed-commit` required | `assert_reviewed_commit` | `test_reviewed_commit_must_be_a_full_sha`, `test_production_without_reviewed_commit_is_refused` |
| 5 | `--expected-populated-rows` required, un-defaulted | `main()` | `test_expected_populated_rows_is_required_for_production`, `test_it_is_a_checked_input_not_a_hard_coded_number` |
| 6 | Workbook hash actually matches | `assert_source_checksum` | `test_wrong_workbook_hash_aborts_before_any_write` |
| 7 | Project ref proved from `supabase/.temp/project-ref` | `assert_write_target` | `test_wrong_target_aborts_the_whole_run_before_any_write` and three ref-value tests |
| 8 | Confirmation matches, bound to commit + hash + ref | `assert_production_confirmation` | five `ProductionConfirmationTests` cases |
| 9 | Project ref **re-proved** immediately before the transaction opens | `main()` | `test_a_drifted_target_never_reaches_the_first_batch_from_main` |
| 10 | **Server identity** re-proved before every batch | `apply_plan(target_guard=…)` | `test_drift_after_the_first_batch_aborts_and_writes_no_more`, `test_guard_runs_before_every_batch_not_just_the_first`, `test_fingerprint_change_mid_run_aborts` |
| 11 | `allow_replace=False` — the second, independent replacement lock | `apply_plan` | `test_apply_plan_refuses_replace_when_allow_replace_is_false` |
| 12 | **The SERVER must confirm it is the proven project** | `assert_server_is_target` | `test_stale_url_pointing_at_preview_is_refused`, `test_unprovable_server_is_refused` |
| 13 | Zero pre-existing `google_order_list` source refs | `assert_no_existing_source_refs` | `test_preexisting_source_refs_refuse_the_run` |
| 14 | Advisory lock — no two concurrent imports | `acquire_import_lock` | `test_concurrent_run_is_refused_by_the_advisory_lock` |
| 15 | `--reviewed-commit` must equal `HEAD` with no modified TRACKED files | `assert_reviewed_commit_is_checked_out` | seven `ReviewedCommitTests` cases |
| 16 | **All balance checks run BEFORE the first write** | `main` | `test_wrong_expected_row_count_aborts_with_nothing_written` |
| 17 | `--dry-run` cannot be combined with `--preview`/`--production` | `main` | `test_dry_run_with_production_is_refused` |

Every production refusal test also asserts, structurally, that `apply_plan` was never entered — not merely that an exception was raised.

## The target proof is now causal (was the worst defect in the first draft)

`supabase/.temp/project-ref` records the **Supabase CLI link state**. It says nothing about the database `PRODUCTION_DATABASE_URL` actually opens. In the first draft nothing compared the two, so a stale connection string could have landed 24,010 lines in the wrong database while the report named `qsllyeztdwjgirsysgai` as the destination — an affirmatively false evidence artifact. Three layers now close it:

1. **Connection parameters.** The project ref is recovered from `connection.info.host` / `.user` — what libpq actually used, i.e. the socket carrying the writes — and must equal the proven ref. Supabase does not expose the project ref through SQL, so this is the strongest available link; it is stated here plainly rather than overclaimed.
2. **A content precondition.** Production must hold **zero** `google_order_list` source refs. Preview already holds 3,212, so a connection string stale in the most likely direction fails this check on live data even if everything else passed.
3. **A live fingerprint.** `current_database()`, `inet_server_addr()` and `pg_postmaster_start_time()` are captured after connecting and re-asserted **before every batch**. The old per-batch check re-read the ref file, which could not detect anything: the psycopg connection is opened once and a later `supabase link` cannot move an open socket. The new check watches what actually can move — the server on the other end.

This also makes `--project-ref-file` largely moot as a proof; it is additionally forbidden from being overridden in production.

## H2 decision: one transaction, and a report that survives an abort

**Chosen: the entire production import runs in ONE transaction.** The batch structure is kept, but as the cadence of the drift check, not as a commit boundary. `apply_plan(single_transaction=True)` commits once at the very end; any exception rolls the whole import back.

Why: the orders loop completes before the lines loop begins. With per-batch commits, an abort during the lines phase left all 3,212 orders present with only a fraction of their 24,010 lines. Four applications read this data; orders whose line sets are silently short are worse than no import at all, because nothing looks broken. About 27,000 rows is a small transaction for Postgres, so the cost is negligible. Because the run is single-transaction, the transaction-mode pooler (port 6543) is refused — it would silently split the transaction.

**Additionally**, a report is written **before** any exception escapes — for the first pass and for the idempotency pass — recording the abort and its cause. Reports never overwrite an existing one; a second same-day run writes `README-<timestamp>.md` alongside.

**A failed COMMIT is reported as UNKNOWN, never as a rollback.** If the connection drops between the server committing and the acknowledgement arriving, the rows are durable and the client cannot tell. `CommitOutcomeUnknown` is a distinct exception type and gets its own report wording telling the operator to establish the real state before doing anything else. Data integrity is unaffected either way — a rerun meets `assert_no_existing_source_refs` and refuses — but a report asserting "NO rows were written" when that cannot be known is the same defect class as a false record.

**The clean-tree check ignores untracked files** (`--untracked-files=no`). Plain `--porcelain` lists untracked files as `??`, so the gate would refuse every normal checkout — and it would be self-inflicting, because an aborted run writes its abort report to an untracked path and would block the next attempt. A gate whose only workaround is deleting the abort evidence is worse than no gate. Every modification or deletion of tracked, reviewed code is still caught.

**Consequence for the approval package:** its "Rollback and disable boundary" section describes per-500-row batch commits with resumability. That is no longer accurate and should be updated to say the import is atomic and a failed run leaves nothing to resume. I did not edit that document — it is owned elsewhere.

`--replace-source` is impossible in production two independent ways: the CLI refuses the combination, and the production call site passes `allow_replace=False`, which raises inside `apply_plan` before the first batch opens. Deleting either lock still leaves the other.

Mid-run drift aborts everything: the guard runs inside the transaction, so a failure rolls the entire import back and leaves nothing durable. There is no partial state to resume, which is the point.

## The exact production command — recorded, NOT run

Substitute the merge commit of this PR into both placeholders. The command is not executable as written and must not be run without the owner approving this exact wording.

```
python scripts/import-order-list-xlsx.py \
  --workbook /path/to/OrderList.xlsx \
  --production \
  --reviewed-commit <MERGE_COMMIT_SHA> \
  --expected-populated-rows 12354 \
  --batch-size 500 \
  --verify-idempotency \
  --confirm "I approve one production import of OrderList.xlsx SHA-256 68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe into Supabase project qsllyeztdwjgirsysgai using reviewed shared-db commit <MERGE_COMMIT_SHA>"
```

`PRODUCTION_DATABASE_URL` supplies the connection string; it is never passed on the command line, never logged, and never reaches the report. A `--dry-run` rehearsal (which writes nothing and needs no credential) must precede it and must reproduce the approved baseline counts.

## Source row count — SETTLED

**The owner has ruled: the approved populated-row count is 12,354, and the five-row question is closed by decision. No itemisation is required and this is not an outstanding gate.** The history below is retained as provenance only.

| Count | Workbook SHA-256 | Bytes | How the count was produced |
|---:|---|---:|---|
| 12,328 | `4958b4b7…fc6abbe4` | 10,677,903 | 2026-08-09 Phase 0 audit of the then-approved export |
| 12,323 | `b9b282dc…ffba30` (whole workbook) and `904b2cb9…0b2845` (`gid=0` tab) | 10,690,991 / 2,762,055 | 2026-08-11 browser exports of the live sheet, counted by a method that was not preserved |
| 12,354 | `68c9b03a…2409fe` (**the approved workbook**) | 10,679,199 | 2026-08-12 re-profile using this importer's own `is_populated` (any mapped cell non-empty) |

What is established:

1. The 12,328 → 12,323 move is a **real content change**. Two independently taken exports agreed at 12,323, and the same out-of-range date serials were still present, so it was the same sheet, edited by a human between 2026-08-09 and 2026-08-11.
2. The 12,323 → 12,354 move is **not only a re-definition**. The prevailing note in `docs/app-migration-notes/popdam-order-list.md` explains it as a narrower manual count versus the importer's populated definition — and that is part of the answer, since the same approved file yields 12,349 under a PO-Status definition. But the files also differ: 12,323 was measured on `b9b282dc…` / `904b2cb9…`, and the approved workbook is `68c9b03a…` at a different byte size. **The 12,323 figure was never measured on the approved workbook at all.** Any account that treats the gap as purely definitional is incomplete.
3. The 2026-08-09 and 2026-08-12 profiles also disagree on direct-only rows (8,412 vs 8,438), which is a further sign of genuine content movement rather than a pure counting-rule change.

Why no itemisation exists (recorded so nobody re-opens this):

- **Which five rows changed cannot be determined from this repository.** The workbook is licensed business data and was correctly never committed. Neither the `4958b4b7…` export nor either `b9b282dc…` / `904b2cb9…` export was retained, so there is no row-level artifact to diff. Only the Google Sheets revision history could answer it. **The owner has ruled that it does not need answering.**

How the code handles the settled number:

- `--expected-populated-rows` has **no default** and is **required** for production — not because the number is in doubt, but so the approved figure (**12,354**) appears explicitly in the approved command and is asserted against the workbook before any write, rather than living only as a constant in the script.
- The rendered report presents the count history as provenance and states that the question is settled by owner ruling.

## Test evidence

`python -m unittest discover -s scripts/tests -p "test_import_order_list.py"` — **145 tests, OK**, fully offline. One pre-existing test (`test_there_is_no_production_flag`) was replaced, because the behaviour it asserted is exactly what issue #852 directed to change.

56 tests cover the production path. Every negative test asserts both the refusal message **and**, structurally, that `apply_plan` was never entered — an earlier draft of this PR claimed no-write coverage it did not have, which an adversarial review correctly caught.

## Balance checks: 11, and they now gate the write

A production run supplying `--expected-populated-rows` runs the preview 10 plus one more. Critically, they run **before** the first write rather than after the last commit. Every counter they assert on comes from `build_plan` and is fully known before any row is written, so the earlier ordering — insert 3,212 orders and 24,010 lines, then report "did NOT balance" with nothing rolled back — had no justification.
