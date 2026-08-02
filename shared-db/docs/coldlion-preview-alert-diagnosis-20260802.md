# ColdLion preview alert monitor — read-only diagnosis (2026-08-02)

**Status:** diagnosis only. **Nothing was fixed, silenced, acknowledged, reset or cleared.**
All database access was read-only `SELECT` against **preview `rjyboqwcdzcocqgmsyel`**.
Production `qsllyeztdwjgirsysgai` was never contacted.

- Investigated by: shared-db sub-agent (worktree `agent-ab77e999e36d6516b`).
- Evidence collected: 2026-08-02 **12:50–13:05 UTC** / **08:50–09:05 America/New_York**.
- Repo state at time of investigation: `origin/main` = `4444d72`, max migration version
  `20260731230000`. No migration was added by this work.
- Database timezone is `America/New_York`; every timestamp below is given in both.

---

## 1. VERDICT

**RESIDUE. Proven, not assumed.**

The five undelivered alerts are the client-side ENOBUFS tooling fault described in the
2026-07-31 coordinator handover §5.1 defect 1 / §5.2 (B14). They are **not** a database
invariant failure, **not** attached to any sync run, and **not** production-relevant. The
underlying defect was fixed in **PR #367** (merged **2026-07-31T22:59:04Z**), and **zero
alerts of any kind have fired in the 41 hours since** — despite the preview Phase 6 feed and
the PRODUCTION recurring feed both running repeatedly in that window.

The monitor stays red for a **separate, second reason** that is itself a real defect: there
is **no mechanism anywhere in this repository to acknowledge an alert**. The alerts cannot
be cleared by any supported path, so the monitor re-fires forever. See §5.

---

## 2. The alert rows (preview `plm.taxonomy_sync_alert`)

Five rows, all `severity = critical`, all `is_drill = false`, all `acknowledged_at IS NULL`.

| Alert id | Fired (UTC) | Fired (America/New_York) | `source_name` | `failed_invariant` |
|---|---|---|---|---|
| `4ec22d57-e085-4775-a9ba-8b25f8c64714` | 2026-07-31T19:45:41.821251Z | 15:45:41-04:00 | `coldlion_licensors_properties_promote_source_owned` | `read-cycle-state` |
| `ea8df8b6-d96e-4639-86a1-4ce620db8b20` | 2026-07-31T19:42:32.750224Z | 15:42:32-04:00 | `coldlion_licensors_properties_promote_source_owned` | `read-cycle-state` |
| `54cc295b-fca5-4cb9-94fc-32e2db4f4b3f` | 2026-07-31T19:40:33.866370Z | 15:40:33-04:00 | `coldlion_licensors_properties_promote_source_owned` | `read-cycle-state` |
| `08980eb7-d176-46f0-ab41-9b7a86e18991` | 2026-07-31T19:39:26.347710Z | 15:39:26-04:00 | `coldlion_licensors_properties_promote_source_owned` | `read-cycle-state` |
| `df6a1400-1dc7-49e6-bbc6-48e6dfa37bd1` | 2026-07-31T19:39:26.347710Z | 15:39:26-04:00 | `coldlion_licensor_property_circuit_breaker` | `read-cycle-state` (AUTO-TRIP) |

The fifth row is not an independent failure — it is the breaker's own auto-trip record,
`payload.triggering_alert_id = 08980eb7-…`, i.e. a consequence of the fourth row.

### Why this is a client tooling fault, from the row data itself

- `payload.detail` on all four promoter alerts is literally **`"supabase db query failed"`** —
  the CLI subprocess failed, not a SQL invariant.
- `failed_invariant = "read-cycle-state"` — the cycle-state probe, which is exactly the
  1,305,075-byte payload that overflowed Node's 1 MiB default `maxBuffer`.
- **`related_run_id` is `NULL` and `observation_id` is `NULL` on all five rows.** The promotion
  aborted at the cycle-state read *before* any `ingest.sync_run` was opened. There is no run to
  attribute the failure to because no run ever started. This is the single strongest piece of
  evidence: a genuine data/invariant failure would necessarily carry a run id.
- No `payload.project_ref` and no `payload.environment` on the four promoter alerts (the
  breaker row's `environment` is just `"auto (alert 08980eb7-…)"`), so nothing in the payload
  claims a production origin.

### The `sync_run_id` question, answered directly

The brief asked whether the alerts' `sync_run_id` matches a failed rehearsal run or a real
production-relevant run. **Neither: there is no run id at all.** The column is `related_run_id`
and it is `NULL` on every one of the five rows.

### Corroboration from the circuit breaker's own record

`public.taxonomy_circuit_breaker_state('coldlion_licensor_property')` currently returns
`state = closed`, and its retained `reset_authorization` block states the root cause in the
breaker row itself:

> tripped_at 2026-07-31T15:39:26.34771-04:00 (19:39:26Z) · tripped_by `auto-trip`
> reset_at 2026-07-31T16:29:45.856507-04:00 (20:29:45Z) · reset_by
> `shared-db rehearsal sub-agent (preview only)`
> readiness_evidence: breaker auto-tripped "by a CLIENT-SIDE spawnSync ENOBUFS in
> `tools/coldlion-sync-common.mjs` `runSql` (1.3MB cycle-state payload vs Node 1MiB default
> maxBuffer), **not by any database invariant failure**".

Note for anyone auditing later: `reset_by` names a **sub-agent, not a human** — consistent with
handover §3.4. This is recorded, not hidden.

### No GitHub Actions run corresponds to the alert window

There is **no** Phase 6 preview run and **no** PRODUCTION recurring run between 19:39Z and
19:45Z on 2026-07-31 (checked via `gh run list` across that window; the nearest neighbours are
a Phase 6 run at 20:35:30Z and a PRODUCTION run at 20:08:53Z, both **succeeded**). The alerts
were therefore raised by the locally-driven rehearsal, not by scheduled automation — which is
what "rehearsal residue" means.

### Nothing has re-fired since the fix

Across the **entire** `plm.taxonomy_sync_alert` table (17 rows lifetime, 5 unacknowledged):

- `max(fired_at)` over **all** rows = **2026-07-31T19:45:41.821251Z** (15:45:41-04:00).
- Count of rows fired after PR #367's merge (2026-07-31T22:59:04Z) = **0**.

So the newest alert in the database is the same one from the rehearsal. In the 41 hours since
the B14 fix merged, the preview Phase 6 feed and the PRODUCTION recurring feed have both run
many times (all `succeeded`; e.g. `ingest.sync_run` `997ed43d-…` at 2026-08-02T11:32:51Z), and
have produced no new alert. **The fix holds under live load.**

---

## 3. What the hourly monitor actually queries, and why it stays red

Workflow: `.github/workflows/coldlion-licensor-property-alert-monitor.yml`
(cron `*/10 * * * *`, gated on repo variable `COLDLION_ALERT_MONITOR_ENABLED=true`,
hard-refuses the production ref). It runs
`node tools/dispatch-coldlion-taxonomy-alerts.mjs --apply --linked --out alert-plan.json`.

The probe SQL (`buildAlertQuerySql`, `tools/dispatch-coldlion-taxonomy-alerts.mjs`) selects from
`plm.taxonomy_sync_alert` where:

```
acknowledged_at is null
and severity in ('critical','warning')
and fired_at >= now() - '<COLDLION_ALERT_LOOKBACK_HOURS, default 48> hours'::interval
```

Exit codes: `0` nothing outstanding, `1` alerts found, `2` unparseable (fail closed). On `1`
the workflow (a) opens a GitHub issue and (b) runs a final step whose only job is
`exit 1` with the message quoted in the alarm.

**It stays red because all five rows still satisfy that predicate.** Nothing in the pipeline
ever sets `acknowledged_at`, so the same five rows are re-found every ten minutes forever.
The breaker being `closed` is irrelevant — the breaker state is only *reported* in the issue
title, it is not part of the predicate.

Observed cadence note: the alarm is described as hourly, but the schedule is every 10 minutes.
GitHub throttles scheduled workflows on a busy repo, so it lands roughly hourly in practice.
Nothing is wrong with the cron; do not "fix" it.

---

## 4. Second defect found: duplicate-issue storm

Every failing run opens a **brand new** GitHub issue — the workflow has no de-duplication and
no "is there already an open issue for this?" check. As of 2026-08-02 12:45 UTC there are
**25 open duplicate issues**, all titled
`ColdLion taxonomy alert — 5 undelivered (breaker: closed)`:

**#361** (2026-07-31T20:02:34Z, the first), #364, #368, #372, #374, #375, #376, #377, #378,
#379, #380, #381, #382, #383, #384, #385, #386, #387, #388, #389, #390, #391, #392, #393,
**#394** (2026-08-02T12:45:42Z, the newest at time of writing).

(The `coldlion-taxonomy-alert` label does not exist in this repo, so the workflow's labelled
`gh issue create` fails and its `||` fallback creates the issue unlabelled — which is why all
25 carry no labels. Minor, but it means you cannot filter for them by label.)

This is alert fatigue by construction, and it will keep growing at ~1 issue/hour until the
alert rows are cleared.

---

## 5. Third defect, and the reason this cannot simply be "cleared": there is no acknowledge path

`plm.taxonomy_sync_alert.acknowledged_at` was created by migration
`20260726180000_coldlion_licensor_property_phase6_parallel_run.sql` (line 110), and the
partial index at line 120 is built on `where acknowledged_at is null`. So the column was
designed to be set.

**Nothing ever sets it.** A full repository sweep for `acknowledged_at` finds only *readers*:
`tools/dispatch-coldlion-taxonomy-alerts.mjs` (the probe), its test, and
`tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` (lines 358, 365). The only
alert-related functions in the live database are:

- `record_taxonomy_sync_alert(...)` — writes alerts
- `taxonomy_sync_alert_list(p_limit integer)` — reads alerts

Verified against live `pg_proc` in preview: **there is no acknowledge RPC.** `UPDATE` on the
table is granted only to `postgres` and `service_role`.

**Consequence:** the alert channel is write-only. Once an alert fires, there is no supported,
audited way to close it. That is a design gap in the alerting system, not a preview accident,
and it applies to production the moment production starts firing alerts.

### And it will silently self-clear today — which is worse

Because the probe has a **48-hour lookback**, these five rows fall out of the query window at
**2026-08-02 19:39–19:45 UTC (15:39–15:45 America/New_York)** — a few hours after this document
was written. The monitor will then go **green on its own, with five unacknowledged critical
alerts still sitting in the table, never seen by a human, never acknowledged.**

That is a silent failure of exactly the kind this repo's standing rules forbid. **Do not treat
the monitor turning green as resolution.** If nobody acts, the only durable trace will be 25
stale GitHub issues and five orphaned rows.

Note the knock-on: `evaluate-coldlion-licensor-property-cutover-readiness.mjs` gates on
`acknowledged_at is null and is_drill = false and severity = 'critical'`. Verified live: that
count is **5**, so **readiness currently evaluates to FALSE on preview**. It will flip to true
by itself when the rows age out of the *dispatcher's* window — except it will not, because the
readiness query has **no lookback clause at all**. Readiness will therefore stay blocked
permanently even after the monitor goes green. The two tools disagree, and that discrepancy is
itself worth fixing.

---

## 6. What I verified from PR #373, and what I could not

PR #373 (`intake/coldlion-monitor-20260801`) is an intake-only change: it adds one 67-line
block to `COORDINATOR_INTAKE.md` and touches no code, schema, or migration. Confirmed via
`gh pr diff 373`.

| # | Claim in PR #373 | Result | Evidence |
|---|---|---|---|
| 1 | PR **#354** merged into `main` as `768594e762c09ff2beb19902289608c4842572ff` | **VERIFIED** | `gh pr view 354`: MERGED, merge commit `768594e762c09ff2beb19902289608c4842572ff`, merged 2026-07-31T18:58:28Z |
| 2 | Health run `75c15b95-2fa2-4b83-b160-f7cae7130c66` exists in preview at 2026-07-31T18:56:08Z | **VERIFIED** | `ingest.sync_run`: id matches, `source_name = coldlion_designflow_sync_health`, `status = succeeded`, `started_at` 2026-07-31T18:56:08.438234Z / 14:56:08-04:00 |
| 3 | That readiness evaluation returned `ready:true` with no open critical alert | **VERIFIED AS OF ITS TIMESTAMP, NOW STALE** | It ran at 18:56:08Z; the five critical alerts fired 19:39–19:45Z, i.e. **43 minutes later**. Live check now: `open_crit_unack = 5`, `readiness_would_pass_now = false` |
| 4 | Scheduled run `30639230244` failed at `supabase link`, and the immediate alert fallback also failed because no link existed | **VERIFIED (structure)** | `gh run view 30639230244`: Phase 6 Parallel Run (preview), 2026-07-31T14:35:16Z, `failure`. Failing step is "Link preview project only". The fallback step then logged: `dispatch-coldlion-taxonomy-alerts failed: Error: Refusing --apply: linked Supabase project is unknown, not required preview rjyboqwcdzcocqgmsyel` |
| 5 | That link failure was caused by a **Supabase/Cloudflare 502** | **NOT VERIFIED** | The retained log shows only `Try rerunning the command with --debug to troubleshoot the error.` and exit 1. No `502`, `Bad Gateway` or Cloudflare string survives in the log. The failure is real; the *attributed cause* is unconfirmed and should not be repeated as fact |
| 6 | Preserved 24 scheduled runs 2026-07-30 → 2026-07-31 including one failure | **NOT INDEPENDENTLY VERIFIED** | Out of scope for this read-only pass; would require auditing the evidence README diff in PR #354 |
| 7 | Local `main` in `C:\repos\shared-db` is 13 commits behind `origin/main` | **NOT VERIFIABLE / STALE BY DESIGN** | Statement about another session's working copy at another point in time. `origin/main` is now `4444d72` |
| 8 | The pre-link alert-delivery gap "is still open" | **VERIFIED, AND IT IS A REAL GAP** | Claim 4's evidence proves the failure mode: when `supabase link` fails, the database-backed alert path is unreachable, so a failure can occur with **no alert row written at all**. This is a genuine hole in the alert channel and deserves its own backlog item |

**Bottom line on #373:** its factual claims about the past are sound where checkable, except
the unproven 502 attribution. Its most important claim — "readiness passed" — is true only of
2026-07-31T18:56:08Z and is **false now**. It did not identify the actual reason the monitor is
stuck (no acknowledge path). Ingesting it is reasonable; acting on its readiness claim is not.

---

## 7. RECOMMENDED REMEDIATION — **NOT PERFORMED**

Ordered. Item 1 is time-sensitive: it becomes unobservable after ~19:45 UTC today.

1. **Do not wait for the monitor to go green.** It will do so on its own today for the wrong
   reason (§5). Decide before then.

2. **Add an acknowledgement RPC via a shared-db migration** — the missing half of the design.
   Suggested shape: `plm.acknowledge_taxonomy_sync_alert(p_alert_id uuid, p_acknowledged_by text,
   p_note text)` that sets `acknowledged_at = now()` and appends the actor and reason into
   `payload`, append-only, never deleting the row. This is the **only** mechanism by which
   these five rows should be cleared. It is a schema change and therefore belongs to the
   coordinator's normal branch → PR → preview-first → promote flow.
   **Do not clear them with a direct `UPDATE`** — the house rule forbids direct DDL/DML against
   the shared database, and an unaudited `UPDATE` would destroy the only record of who closed a
   critical alert.

3. **Then acknowledge exactly these five ids on preview only**, with the reason recorded as
   *"client-side ENOBUFS tooling fault in `runSql` cycle-state probe; root cause fixed in PR
   #367; no database invariant failed; no sync run was ever created"*:
   `08980eb7-d176-46f0-ab41-9b7a86e18991`, `54cc295b-fca5-4cb9-94fc-32e2db4f4b3f`,
   `ea8df8b6-d96e-4639-86a1-4ce620db8b20`, `4ec22d57-e085-4775-a9ba-8b25f8c64714`,
   `df6a1400-1dc7-49e6-bbc6-48e6dfa37bd1`. Do not touch the circuit-breaker events.

4. **Close the 25 duplicate issues** (§4) with a comment pointing at this document, and **add
   de-duplication to the workflow**: search for an open issue with the same title and comment
   on it instead of creating a new one. Also create the missing `coldlion-taxonomy-alert`
   label so the fallback branch stops being the only path that works.

5. **Fix the silent-expiry hole.** An unacknowledged `critical` alert must never age out of the
   monitor's window. Either drop the lookback for `critical`, or escalate rather than forget
   when a critical alert exceeds the window. As written, the monitor forgets unresolved
   critical alerts after 48 hours.

6. **Reconcile the two disagreeing predicates.** The dispatcher uses a 48h lookback; the
   readiness evaluator uses none. Pick one definition of "open critical alert" and share it.

7. **Backlog the pre-link alert gap** (#373 claim 8 / §6): when `supabase link` fails, no alert
   can be written at all. The alert channel currently has a blind spot precisely when
   infrastructure is degraded.

8. **Do not touch production.** Nothing in this diagnosis implies any production action. The
   PRODUCTION recurring feed has been succeeding throughout.

---

## 8. What I deliberately did NOT do

- Did not acknowledge, update, delete, or modify any row anywhere.
- Did not reset, trip, or touch the circuit breaker.
- Did not close, comment on, label, or re-title any GitHub issue.
- Did not disable, edit, re-run, or re-schedule the monitor workflow, and did not change
  `COLDLION_ALERT_MONITOR_ENABLED`.
- Did not write a migration, and did not touch `supabase/migrations/`.
- Did not connect to production `qsllyeztdwjgirsysgai` in any way.
- Did not touch `COORDINATOR_INTAKE.md`, `AGENTS.md`, `HANDOFF.md`, or `docs/characters-*`
  (owned by other live agents).
- Did not merge or ingest PR #373, and did not merge anything at all.
- Did not verify #373's claims 6 and 7 (see §6) — out of scope for a read-only pass, and I
  would rather label them unverified than imply I checked.

## 9. Open questions for the coordinator

1. Who authors the acknowledgement RPC migration, and does it need to reach production before
   Step 8 can be considered at all?
2. Should `acknowledged_at` require a named human, given the breaker precedent where `reset_by`
   ended up naming a sub-agent? Albert is the stated response owner on every one of these rows.
3. Should the monitor keep opening issues at all, or fail the run only? 25 issues in 41 hours
   suggests the issue surface is the wrong lever once an alert is known-stuck.
4. Does the pre-link alert gap block Step 8 in its own right? An alert channel that goes silent
   exactly when infrastructure degrades is arguably a harder blocker than B14 was.
