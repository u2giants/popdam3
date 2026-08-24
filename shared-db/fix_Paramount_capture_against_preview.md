# Fix Paramount capture against preview

## Status

| Part | Status | Evidence |
|---|---|---|
| Retire the two unsafe migrations | Done | Albert's owner ruling is recorded on issue #949; PR #1402 hard-blocks versions `20260814233342` and `20260814233423`. |
| Rehearse the three Paramount schema migrations on preview | Done | GitHub Actions run `32721695779` applied exactly the three authorized versions to preview. |
| First real Paramount capture against preview | Failed safely | The private capture passed completeness validation and reached `pmt_asset_metadata_value`, then failed closed on JSON `null`; issue #1418 records only sanitized evidence. |
| Repair JSON-null handling and rehearse it on preview | Done | PR #1421 merged migration `20260824135515`; preview apply run `32738436612` succeeded. Production was not contacted. |
| Run a brand-new full Paramount capture against repaired preview | Open | Control has returned to the private `licensor-source-data` session. A successful replacement capture has not yet been recorded. |
| Apply or promote to production | Forbidden | Albert explicitly authorized preview only and said, "Do not apply anything to production." |

Start with **Job boundary and ownership** below. Do not rerun the completed schema rehearsal unless the preview database has been rebuilt or the ledger evidence no longer matches.

## Business purpose

The Paramount capture tool on `main` sends the normalized metadata shape, but production still uses the older database loader. The old loader refuses the new `pmt_metadata_element` target, so a new Paramount capture cannot currently complete. It fails closed: it does not corrupt or partially load data, but the capture capability is unavailable.

The three required database migrations and the JSON-null loader repair now exist on preview. The remaining job is to prove the complete capture path against that repaired preview database using authorized Paramount source data, without exposing licensed rows and without touching production.

## Completed preview schema rehearsal

The governed preview workflow succeeded on 2026-08-24:

- Workflow: `Shared Supabase Migrations`
- Run: <https://github.com/u2giants/shared-db/actions/runs/32721695779>
- Applied commit: `2ecdd43741048c4053f6d240d1e0758afcdc984e`
- Proven preview project: `mvpkijzfmfcxhnzqogzs`
- Production project explicitly marked never-write: `qsllyeztdwjgirsysgai`
- Preview ledger before: 489 versions
- Preview ledger after: 492 versions
- Added, in order:
  1. `20260814193351_pmt_duplicate_name_columns_deprecated.sql`
  2. `20260814213043_pmt_metadata_element_normalization.sql`
  3. `20260814223552_pmt_collection_paramount_term_normalization.sql`
- Removed ledger versions: none
- Production dry-run, review, and apply jobs: all skipped
- Immutable preview evidence artifact: `preview-migration-apply-2ecdd43741048c4053f6d240d1e0758afcdc984e`, artifact ID `9518010813`

Do not use a plain `supabase db push`, `--include-all`, or any production workflow to continue this job.

## First real capture result and repair

The first full private capture was attempted after the three schema migrations landed. It did not complete:

- The private capture passed its completeness validator.
- The public Paramount sync tool passed 70 of 70 focused tests.
- The preview target was proven and production was not contacted.
- The run successfully reached the normalized `pmt_metadata_element` target.
- It then failed closed on the first `pmt_asset_metadata_value` chunk because a present JSON `null` value is not PostgreSQL SQL NULL and the existing safety constraint correctly rejected it.
- The failed capture was marked failed and preserved for diagnosis. Never resume or relabel it as complete; run a new capture identity.

Issue #1418 and PR #1421 repaired the loader boundary without weakening the constraint or omitting the normalized target. Migration `20260824135515_pmt_loader_raw_value_json_null_normalization.sql` converts JSON `null` to SQL NULL while continuing to reject unsafe strings, numbers, arrays, booleans, URLs, and headers. The change was independently approved and applied only to preview in run <https://github.com/u2giants/shared-db/actions/runs/32738436612>.

This repair has schema-level preview proof. It still needs the brand-new full capture below to prove the business capability end to end.

## Job boundary and ownership

This is now a **source-data capture and application-owned preview row-write job**, not a schema-authoring job. Under `AGENTS.md` section 0.0-B, it belongs to a fresh source-data session and does not consume a migration-author lane. The shared-db orchestrator owns only the already-completed structural rehearsal and must not handle licensed source rows in its coordinator context.

Use the `paramount-creative-library-scrape` skill. If the job refreshes or re-scrapes the portal rather than replaying an already-complete approved private capture, also use `licensor-incremental-capture`.

Licensed inputs, extracts, allowlists, sample rows, screenshots, and reconciliation results must remain in the approved private `licensor-source-data` repository. Never copy them into this public repository, a GitHub issue, a PR, a commit message, workflow logs, or an outside reviewer prompt.

## Required inputs

Before starting, the source-data session must have:

1. An authorized Paramount licensed-property allowlist in the approved private repository.
2. Either:
   - a complete, current, privately stored Paramount capture that satisfies the skill's completeness gates; or
   - access to Albert's already-authenticated Chrome Paramount session to perform an incremental metadata-only capture.
3. The exact current `main` version of `tools/sync-paramount-creative-library.mjs` and its tests.
4. Preview-only database credentials obtained through the approved protected configuration path. Never print or pass credentials in command arguments or logs.
5. A private output location for all capture records and validation evidence that contains licensed rows.

If login or MFA is required, Albert performs it in Chrome. Never inspect or record passwords, MFA codes, cookies, browser storage, bearer tokens, or raw request headers.

## Execution procedure

### 1. Prove the target and ledger

Immediately before any database write:

- Prove that the linked project is preview project `mvpkijzfmfcxhnzqogzs`.
- Independently prove that the target is not production project `qsllyeztdwjgirsysgai`.
- Confirm the preview ledger contains all three Paramount versions listed above.
- Confirm the two retired versions, `20260814233342` and `20260814233423`, were not applied.
- Save only identifiers, counts, hashes, and pass/fail results in public evidence. Do not save licensed rows.

Stop on any target mismatch, unreadable ledger, missing migration, unexpected extra pending migration, or request to broaden the operation.

### 2. Validate the private capture before loading

In the private source-data repository:

- Confirm every authorized title is resolved or explicitly reported unresolved.
- Confirm every authorized result page is captured.
- Confirm every unique authorized asset has one valid full-metadata record.
- Validate requested-versus-returned asset ID equality for every metadata batch.
- Validate Property-to-Collection and Property-to-Character caret pairs without inventing missing IDs.
- Record counts, hashes, malformed-relationship counts, duplicates, and failures privately.
- Do not download artwork, videos, PDFs, style guides, previews, or original media.

A short, failed, or partial portal index is not a withdrawal signal and must not be loaded as a complete capture.

### 3. Run the preview capture

Use the repository's supported Paramount sync tool and its existing capture protocol. The exact invocation must come from the tool's current `--help`, tests, or checked-in runbook; do not guess flags.

The run must:

- target preview only;
- use a new capture identity rather than editing an earlier completed capture;
- send the normalized `pmt_metadata_element` rows;
- omit writes to the deprecated duplicate property-name columns;
- load the three Paramount schema changes as one compatible contract;
- fail closed on any unknown target or incomplete chunk;
- keep licensed row content out of terminal and workflow output.

Do not run a production capture, production database command, production workflow, or broad migration command.

### 4. Verify the business capability

The job succeeds only if all of the following are proven against preview:

- The capture begins, loads every expected target, and finalizes successfully.
- `plm.load_pmt_capture_chunk` accepts `pmt_metadata_element`.
- The loader no longer requires the deprecated duplicate property-name values.
- `plm.pmt_metadata_element` has one normalized heading record per capture and expected heading identity, with no duplicate heading identities.
- Metadata values retain their expected data type and link to the correct metadata element.
- `plm.pmt_collection.paramount_term` is absent.
- `api.pmt_style_guides` still exposes the business-facing `paramount_term` value as `Collection`.
- The capture is complete rather than merely started or partially written.
- Counts and ID-set hashes reconcile with the authorized private capture.
- No licensed row or name appears in public evidence.

Run the focused Paramount tests after the capture and record their pass/fail totals. A green schema test without a completed capture is not sufficient.

### 5. Publish sanitized evidence

Record a sanitized completion note on issue #949 containing only:

- preview project identifier;
- capture/run identifier if it is safe and contains no licensed information;
- tool commit SHA;
- the three applied migration versions;
- start/finalize status;
- aggregate row counts by target where permitted;
- ID-set or evidence hashes;
- focused test results;
- any failure category without source-row examples;
- an explicit statement that production was untouched.

Keep the detailed reconciliation and source evidence private.

## Stop conditions

Stop without trying to work around the guard if:

- the linked project is not the proven preview project;
- any command would write to production;
- the loader proposes migrations outside the three already rehearsed versions;
- the source capture is incomplete or its authorized scope cannot be proven;
- the portal requires credentials to be extracted from Chrome;
- a result would expose licensed rows publicly;
- the loader partially writes and cannot prove safe resumability;
- the normalized loader rejects a target or field shape.

Preserve the original capability: diagnose and repair a failed preview capture. Do not disable the normalized metadata target, restore the old loader, omit source relationships, or bypass the safety guards merely to make the run green.

## Production boundary and next decision

This job grants no production authority. A successful preview capture produces evidence for a later, separately authorized production decision. Production promotion must name the exact three Paramount versions, use the governed bounded workflow, and occur only after the preview capture and all verification gates above pass.

Until that later authorization exists, the correct end state is:

- preview contains the three Paramount migrations;
- a complete Paramount capture has succeeded and been verified on preview;
- the two unsafe migrations remain retired and blocked;
- production remains unchanged.
