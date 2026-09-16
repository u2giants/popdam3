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
