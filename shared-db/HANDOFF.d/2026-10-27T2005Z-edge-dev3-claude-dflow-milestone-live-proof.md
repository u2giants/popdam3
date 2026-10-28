---
issue: 4646
status: OPEN
owner: Claude chat 8a0950f2-6a70-4e2f-a9d6-e267bc8273ed on edge-dev3
---

# DesignFlow milestone persistence live proof (waiting on real use)

## Background and goal
The DesignFlow release (#4655) is delivered to production; see
`HANDOFF.d/2026-10-27T1826Z-edge-dev3-codex-dflow-release-closeout.md` and
`docs/designflow-db-release.md` (release table). The only remaining acceptance is
live proof for production milestone persistence: shared-db #4646 and its
application parent popcre/designflow-backend#232. Done means the real production
tracking runtime has read, inserted and updated milestone rows without error.

## Current state (verified 2:55 PM EDT, October 27, 2026, read-only)
- Production project qsllyeztdwjgirsysgai: `dflow_prod.prod_order_milestone_schedule`
  exists with all delivered columns (incl. `stage_id`); 0 rows; lifetime
  insert/update/delete 0/0/0 in `pg_stat_user_tables` (stats never reset).
  `dflow_prod."ProdOrderHeader"` has 3622 rows.
- Tracking main writes the schedule on every production-tracking grid load
  (`helpers/milestoneSchedule.js`, called from `helpers/utility.js`); the overdue
  scan (`POST /prod-tracking/overdue-scan`) reads and updates it.
- Cloud Run `popcre-tracking-prod` (project lithe-breaker-323913) logged
  "table does not exist" on Oct 24 and Oct 25 12:46 UTC (before delivery). No
  production-tracking requests and no ERROR logs since Oct 25 13:00 UTC.
- Findings posted: shared-db #4655 comment 6450814527, #4646 comment 6450814902,
  backend#232 comment 6450815212.

## Constraints
No synthetic production write to manufacture proof. No structural change needed;
any future one is claim-first with a fresh claim. Preserve completed repairs,
parked source, reviewer-repair freeze and all production checks. Owner ruling:
this release needs no reviewer approval.

## Next actions and verification
1. Check whether real use happened:
   `gcloud logging read 'resource.labels.service_name="popcre-tracking-prod" AND httpRequest.requestUrl:"prod-tracking"' --project lithe-breaker-323913 --freshness=7d`.
2. If yes, run read-only SQL: row count and `n_tup_ins/n_tup_upd` for the table;
   confirm no `[milestoneSchedule]` log errors after delivery.
3. Pass → tick `- [ ] live proof` on #4646 and backend#232 with evidence, close
   #4655 if nothing else is open, delete this file.
4. Fail → open the defect on #4646 (same issue) and fix through tracking/shared-db.

## Completeness audit
New developer can continue? Yes — background, exact identifiers and commands above.
As well as me? Yes — the only session knowledge was the read-only findings, all listed.
Every detail? Yes — state, constraints, failure path and verification gate included; no gaps found on reread.
