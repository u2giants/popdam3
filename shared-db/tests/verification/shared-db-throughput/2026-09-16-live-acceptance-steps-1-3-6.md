# Live acceptance evidence — #3027 Steps 1, 3, 6 (popcre/ai-devops#401)

Harvested 2026-09-16 from real runs and outcome records produced by other
sessions. No migration, structure change, database write, or workflow dispatch
was made to collect this. Every quoted line was read from the named log or
comment; timestamps are UTC.

## Step 1 — automatic promotion (#2716)

### Refusal path: PROVEN

Run 35067878423 was dispatched by `github-actions[bot]` (the automatic
qualification lane, not a person) at main `9fe6f0bb`, and the production gate
refused before any apply job ran:
https://github.com/u2giants/shared-db/actions/runs/35067878423

> `2026-09-16T07:20:13.0836789Z ##[error]Production business-risk gate rejected evidence: ENGINEER ACTION REQUIRED: automatic production promotion is not fully machine-qualified: access or permissions materially change; existing production data may be lost or permanently altered; users may be interrupted`

Job results: `Production apply review: failure`, `Production apply (automatic evidence gates): skipped`.
The same refusal shape recurs in bot-dispatched runs 35056268596, 34989644100,
34987389408; bot runs 35061726161 and 35052182196 refused on producer/evidence
mismatch instead.

### Fully-qualified automatic promotion: NOT PROVEN

All six `github-actions[bot]` dispatches of `shared-supabase-migrations.yml`
in the last 100 dispatch runs concluded `failure`. The production applies that
did succeed (35068100581, 35056756909) were dispatched by `u2giants` (a
session's manual lane), e.g. 35068100581:
`2026-09-16T07:24:09.1631053Z Applying migration 20260916033914_dam_order_list_role_free_party_names.sql...`

Live action required: a governed migration PR whose business-risk
classification carries no access/data-loss/interruption flag, merged, so the
post-merge preview's automatic qualification job dispatches production itself
and the apply succeeds. This needs a new structural migration (DB/structure
change) — out of scope for this harvest.

## Step 3 — owner dispatches application proof within 30 minutes: PROVEN (one outcome)

Outcome #2905 (PR #2910, migration `20260914172031`):

- Production apply run 34892518005:
  `2026-09-14T20:25:39.5410694Z Applying migration 20260914172031_db_data_admin_inventory_canonical_licensor_group.sql...`
  (run finished 20:26:02Z).
- Application live-proof run 34895253761 (`Shared DB Live Proof`,
  `workflow_dispatch`, success) created `2026-09-14T20:49:49Z` — 24 min 10 s
  after the apply line.
  https://github.com/u2giants/shared-db/actions/runs/34895253761
- Ledger events on #2905, both `"actor": "manage-migration-author-lanes"`
  (the outcome's own lane, not Albert or another session):
  `"event_type": "production_applied"` at `2026-09-14T20:53:49.677Z`
  (https://github.com/u2giants/shared-db/issues/2905#issuecomment-5670664443) and
  `"event_type": "live_verified"` at `2026-09-14T20:55:30.157Z`
  (https://github.com/u2giants/shared-db/issues/2905#issuecomment-5670685476),
  followed by the `db-work-completion` record citing
  `"live_evidence": "https://github.com/u2giants/shared-db/actions/runs/34895253761"`.

Caveat: every GitHub run shows actor `u2giants` because all sessions share that
token, so "not Albert" rests on the ledger `actor` field. The proof was
dispatched before the `production_applied` event was written, so the 30-minute
window is measured from the actual apply log line.

Counter-example (not within window): #2860 applied at
`2026-09-15T12:40:57Z` (run 34969990246); popdam3 proof run 34977491562 created
`2026-09-15T13:49:16Z` (68 min).

## Step 6 — live migration train: NOT PROVEN

- `git ls-remote origin 'refs/db-migration-trains/*'` returns 0 refs: no train
  has ever been proposed, authorized, or dispatched.
- No harvested run executed the `Refuse a migration-train dispatch that is not
  the exact recorded train` step, and no run had a multi-version
  `PRODUCTION_ALLOWLIST`.
- The only train behavior in live runs is the unit suite inside `SQL migration
  guards`, e.g. run 35067685382:
  `ok 1 - ten compatible migrations form one immutable validated train`,
  `ok 3 - superseded migration refuses by name`. That is fixture evidence, not a
  live train.

Live action required: at least two compatible merged-but-unapplied migrations
plus one incompatible one, then `--propose-train` / `--authorize-train` /
`--dispatch-train` and a production workflow dispatch with
`migration_train_ref`. This needs new structural migrations and a production
dispatch — out of scope for this harvest.

## Step 1 — live automatic production promotion: PROVEN (2026-09-16)

Harmless canary: `20260916120643_production_lane_canary_step1_acceptance_column.sql`
adds one nullable, default-less `text` column to the revoked, unread
`plm.production_lane_canary` table (work issue #3043, claim #3044, PR #3046).

1. Two durable exact-head APPROVE verdicts (muse slot 1, grok slot 2).
2. Guarded merge run 35102238635 merged PR #3046 as `8c4ce615bd6bfc7910e9351163a14336b709c4cd`.
3. Merged-main preview rehearsal run 35102847581 (`merged_preview_source_pr=3046`)
   passed; its `Automatic production qualification and dispatch` job logged
   `Fully qualified production apply dispatched.`
4. Production run https://github.com/u2giants/shared-db/actions/runs/35103122149,
   actor and triggering actor `github-actions[bot]`, conclusion success. Log:
   `Applying migration 20260916120643_production_lane_canary_step1_acceptance_column.sql...`
   and the after-record row `20260916120643 | 20260916120643 | 2026-09-16 12:06:43`.
5. Read-only production check (project URL verified as the protected production
   ref first): column `step1_acceptance_note` is `text nullable=YES`; table
   still holds 1 row.

No session dispatched production; the session dispatched only the guarded merge
and the preview rehearsal.

## Step 6 — live migration train: PROVEN (2026-09-16)

This supersedes the earlier "Step 6 — live migration train" harvest above.

Canary train on the revoked, unread `plm.production_lane_canary` table, one
nullable default-less `text` column per entry:

- `20260916160617_production_lane_canary_step6_train_note_a.sql`: work issue #3071, PR #3073, merge `7a5d1ac74c69e3d2c293a92a812d064ae62692b4`.
- `20260916184821_production_lane_canary_step6_train_note_b.sql`: work issue #3074, PR #3090, merge `135a71a1c4de218035dabd34c2afe3eae326ad7f`.
- The per-entry gate binding landed first in PR #3075 (`c94ef25f1075e2dc7ee4031f5507fed19422e3ab`).

1. Merged-main preview rehearsal run 35138814669 (`merged_preview_source_pr_map=20260916160617:3073,20260916184821:3090`)
   logged `added: 20260916160617, 20260916184821`. A read-only query on preview
   `mvpkijzfmfcxhnzqogzs` showed both columns as `text`, nullable, no default.
2. Production dry-run run 35139306332 (target production, same commit and allowlist)
   logged `Would push these migrations:` with exactly both files.
3. Refusal by name: a variant train that prepended the Step 1 version was refused with
   `REFUSED: migration 20260916120643 is already applied on the exact target`.
4. The real train (id `af036faf40ba25c0897395c518485399c55d7e8d74bb64901578343e0157069d`, base main `135a71a1`)
   validated, then got these immutable refs: `000002-authorized` and `000003-dispatched`.
   `--verify-train-dispatch` passed for target production and the exact allowlist.
5. Grok 4.6 read-only review `s6-train-prod-dispatch` covered the workflow, target,
   SHA, allowlist, train ref, both SQL files and the dry-run output. It returned
   `VERDICT: APPROVE`. Review evidence run 35140286053 recorded that verdict
   (artifact `sha256:b0e595eb7e761ebb93d4920307dd333f85bd3c21657e659cb76e5c05a5c22856`).
6. One production dispatch, https://github.com/u2giants/shared-db/actions/runs/35140328371,
   with `migration_train_ref=refs/db-migration-trains/af036faf…/000003-dispatched`.
   Every job it ran succeeded. The log shows:
   `Applying migration 20260916160617_production_lane_canary_step6_train_note_a.sql...`,
   `Applying migration 20260916184821_production_lane_canary_step6_train_note_b.sql...`,
   and the after-record rows `20260916160617 | 20260916160617` and `20260916184821 | 20260916184821`.
7. A read-only production query on `qsllyeztdwjgirsysgai` returned:
   - columns `step6_train_note_a:text:YES:none,step6_train_note_b:text:YES:none`
   - ledger `20260916160617,20260916184821`
   - still 1 row in the table
8. The train closed with passing production assertions as `000004-closed`.
