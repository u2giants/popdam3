# Triage of PR #426 (intake block) — 2026-08-03

**PR:** https://github.com/u2giants/shared-db/pull/426
**Branch:** `intake/licensor-property-taxonomy-20260803` @ `20bc3d4b`
**Triaged by:** sub-agent `intake-426-triage`, dispatched by the shared-db coordinator.
**Verification window:** 2026-08-03 19:12–19:16 UTC (15:12–15:16 America/New_York).
**`origin/main` at triage time:** `b8503bec8649930c05278a80df0777bfef4452bb` (unchanged from the
`b8503be` recorded in the brief) throughout all verification. Re-checked at write-up
(2026-08-03 19:18 UTC) and it had **moved to `33d5b086…`** — another session landed on `main`
during this triage. Nothing in this document depends on `main`'s tip; the database evidence is
live-read and unaffected.
**Mode:** READ-ONLY. No write of any kind was issued to either database. No migration, no
acknowledgement, no breaker reset, no lane dispatch. Nothing was remediated.

> **Deliberate omission.** `plm.check_taxonomy_sync_health()` was **not** called during this
> triage. It is not a pure read — the hourly lane's calls to it are what insert alert rows and
> append `blocked_attempt` breaker events. Every fact below about health state is derived from
> the stored observation and alert rows instead. A future read-only triage must do the same.

---

## 0. Proof of database target

Both targets were proven before every read, per AGENTS.md §4.2.

**Production.** `mcp__supabase__get_project_url` → `https://qsllyeztdwjgirsysgai.supabase.co`.
The Supabase MCP takes no project parameter and **is bound to PRODUCTION** — the intake block's
warning is correct and is independently confirmed here. Identity read:
`current_database=postgres`, `TimeZone=America/New_York`, `now()` = `2026-08-03 19:12:03 UTC`
= `2026-08-03 15:12:03 -04`.

**Preview.** Node + `pg` over the pooler `aws-0-us-east-1.pooler.supabase.com:6543` as
`postgres.rjyboqwcdzcocqgmsyel`, password from 1Password `vibe_coding` item
`qbvfk7umc3n75ejekd65zwd4ty` field `DB_PASSWORD`, fetched once and injected via `op_run` (never
written down). Identity read on every connection. **Structural proof it is preview and not
production:** `to_regclass('plm.taxonomy_parallel_observation')` and
`to_regclass('core.taxonomy_owner_ruling')` both resolve on this connection and both return
`null` on the production connection.

`aws-1-us-east-1.pooler.supabase.com` (the host AGENTS.md §9 documents for **production**) fails
for preview with `tenant/user postgres.rjyboqwcdzcocqgmsyel not found`. **Preview is on `aws-0`.**
AGENTS.md does not currently say this; a future session will lose time to it.

---

## 1. Claim: Albert's owner ruling is not in force in production — **VERIFIED**

This is the most important claim in the block and it is **true in every respect**, on both sides
of the divergence.

**Production `qsllyeztdwjgirsysgai`, read 2026-08-03 19:12 UTC / 15:12 local:**

| code | name | status | `metadata ? 'owner_ruling'` | metadata | updated_at |
|---|---|---|---|---|---|
| `FR` | FRIENDS TV | **`active`** | **false** | `{"plm_import_source":"designflow_plm"}` | 2026-07-08 03:30:19 -04 |
| `WB` | WARNER BROS | `active` | false | `{"plm_import_source":"designflow_plm"}` | 2026-07-08 03:30:19 -04 |

Codes `FK`, `NA`, `ZG` return **no row** in production `core.licensor`, consistent with the
separate intake block's finding that ColdLion transmits three licensors we do not hold.

**Production corroboration, three independent ways:**

1. `to_regclass('core.taxonomy_owner_ruling')` → **`null`**. The ruling table the migration
   creates does not exist in production, so the ruling has no durable record there at all.
2. `supabase_migrations.schema_migrations` for `version >= '20260802000000'` in production holds
   **only** `20260802194000` and `20260802194100` (the Style Tracker RFQ timeout fixes).
   `20260802170000` and `20260802171000` are **absent**.
3. Production `plm.import_master_data(jsonb,jsonb)` still contains **2** occurrences of
   `status = 'active'` and **0** occurrences of the string `curated` — i.e. it still force-sets
   status on every matched licensor and property. Even a hand-flip of `FR` in production today
   would be reverted by the next PLM master-data pull.

**Preview `rjyboqwcdzcocqgmsyel`, read 2026-08-03 19:13 UTC / 15:13 local:**

| code | name | status | `metadata ? 'owner_ruling'` |
|---|---|---|---|
| `FR` | FRIENDS TV | **`inactive`** | **true** |

Preview also holds both migrations in its ledger (`20260802170000
plm_import_preserve_curated_licensor_property_status`, `20260802171000
owner_ruling_friends_tv_frida_kahlo`) and both `core.taxonomy_owner_ruling` rows — ruling (a) on
licensor `FR` and ruling (b) on property `FK`, both `ruled_by = "Albert Hazan (owner)"`,
`ruled_at = 2026-08-02 08:00:00 -04`, created `2026-08-02 10:12:34 -04` (14:12:34 UTC).

### Direct answer for the owner

**Yes.** Albert's 2026-08-02 FRIENDS TV ruling is **absent from production**. Production still
shows `FR "FRIENDS TV"` as an active licensor with no record that a ruling was ever made.
Preview shows it inactive with the ruling recorded. **Preview and production disagree on master
data**, and they have done so since PR #408 was applied to preview.

Two footnotes the owner should have with that answer:

- Nothing in production is *broken* by this. The divergence is a decision **not yet in effect**,
  not corruption. `FR` has exactly one property (`FK`, zero characters) and the real Friends TV
  series lives correctly as property `FN` under `WB`, untouched.
- Promoting it is a **production change and an owner gate**. It must go with its predecessor
  `20260802170000` in the same promotion and in that order, or the status flip reverts on the
  next PLM sync. (In practice PLM master-data sync has been dead since 2026-07-08, so the revert
  would be latent rather than immediate — but that is a broken pipe, not a safeguard.)

---

## 2. Claim: an unauthorised `apply=true` write to preview — **VERIFIED**

Run [30837667151](https://github.com/u2giants/shared-db/actions/runs/30837667151), workflow
"ColdLion Licensor/Property Phase 6 Parallel Run (preview)", `workflow_dispatch` on `main` at
commit `35019735…` (PR #408's squash), concluded **success** in 34s.

From the run log, verbatim:

- `Resolved job=coldlion apply=true schedule=` (17:43:41.48 UTC / 13:43 local)
- `Target preview project: rjyboqwcdzcocqgmsyel`; the guard step confirms
  `PREVIEW_PROJECT_REF != PRODUCTION_PROJECT_REF` and hard-matches the preview ref.
- Command run: `node tools/sync-coldlion-licensors-properties.mjs --apply --linked`
- Result at 17:44:05 UTC / 13:44 local:
  `"mode": "mirror_only", "rows_seen": 614, "rows_inserted": 0, "rows_updated": 0,
  "rows_unchanged": 614, "sync_run_id": "f73b91fc-0507-4c9a-8153-1c69b8673ef9"`

**Confirmed in the database, not just the log.** `ingest.sync_run` on preview holds
`f73b91fc-0507-4c9a-8153-1c69b8673ef9`, `source_name = coldlion_licensors_properties_api`,
`status = succeeded`, started and finished `2026-08-03 17:44:03.481973 UTC`
(`13:44:03 local`). No production run was dispatched; production's ColdLion sync has never run
there by construction.

**What it actually did:** it is an audit-trail row and nothing more. Zero canonical rows changed.
Its only material effect is the one the block names — it is now the newest successful ColdLion
sync, so it, not the scheduled run, satisfies the `PHASE6_MAX_SUCCESS_AGE` (36 hours) freshness
window that the health check reads.

**Correction to the block, minor.** The block says the preview mirror "was already current from
the scheduled 04:00 UTC run." The scheduled ColdLion runs land at **07:25 UTC / 03:25 local**
(previous rows: 07:25:05 on 08-03, 06:32:20 on 08-02, 06:28:51 on 08-01, 06:43:37 on 07-31). The
cron is `0 4 * * *` but the recorded run times are not 04:00. Do not use "04:00" as an
identifying fact when excluding runs.

**What a future rehearsal must exclude:** `ingest.sync_run` id
`f73b91fc-0507-4c9a-8153-1c69b8673ef9` and GitHub run `30837667151`. Any count of ColdLion runs,
any "last successful sync" freshness argument, and any provenance reasoning over 2026-08-03 must
treat `99c03acc-51f1-4c0a-997f-04ac0539066c` (07:25:05 UTC, the scheduled run) as the last
legitimate ColdLion sync of that day.

---

## 3. Claim: the red health lane is one field, `licensor_status_hash` — **VERIFIED, and now proven further than the block could prove it**

Observation `5452800d-9fe6-4f6a-a7ef-f390f33f3272`, `observation_date = 2026-08-03`, observed
`2026-08-03 08:21:48.901166 UTC` / `04:21:48 local`, `is_drill = false`, `pass = false`,
`unexplained_diff_count = 2`, `baseline_ok = false`, `immutability_ok = false`,
`coldlion_ok = designflow_ok = links_ok = true`.

Its `details.diffs[0]` (`kind = phase4_baseline_drift`) carries full `expected` and `actual`
blocks of **twelve** fields. Field-by-field they are identical except one:

| field | expected | actual |
|---|---|---|
| `licensor_status_hash` | `d9b07759bf80ff227e2fa9bd635d2138` | **`00bf7069fff79b9deab1d14dbd9112b2`** |
| licensor_count | 26 | 26 |
| property_count | 256 | 256 |
| parent_edge_hash | `7459f6826cc…` | same |
| licensor_uuid_hash | `590ea83ea6d…` | same |
| property_uuid_hash | `e0e6c36eb02…` | same |
| property_status_hash | `f436d4acd79…` | same |
| linked_licensor_count | 38 | 38 |
| linked_property_count | 504 | 504 |
| coldlion_source_ref_count | 542 | 542 |
| taxonomy_source_ref_count | 1047 | 1047 |
| designflow_source_ref_count | 505 | 505 |

**Exactly one field differs.** The block's hand-transcribed hashes are correct to the character.
The live pinned constants inside `plm.check_taxonomy_sync_health()` on preview are
`590ea83e… / e0e6c36e… / d9b07759… / f436d4ac… / 7459f682…` — the old `d9b07759…` is still
pinned, so the lane will stay red until the pin is advanced.

**The second diff is now closed, which the block explicitly listed as unproven (§9).** The block
could not verify whether `prior_nondrill_drift` shared the same root cause. It does:

- observation `5452800d` records `prior_source_ref_hash = 5585216ad77d3aec0f1dbbba802f1e36` and
  its own `source_ref_hash = 5585216ad77d3aec0f1dbbba802f1e36` — **identical**. Kimi's
  "same-count-different-content source-ref change" hypothesis is **refuted**.
- it records `prior_licensor_status_hash = d9b07759…` against its own `00bf7069…` — the only
  changed hash versus the prior observation.
- the prior observation `c2ad042c-d912-41b7-9778-1d6207bce3c6` (2026-08-02 07:28:00 UTC /
  03:28 local) has `pass = true`, `unexplained_diff_count = 0`, and `licensor_status_hash =
  d9b07759…`, as does `260b6210…` on 2026-08-01.

**Both diffs have one root cause: `core.licensor FR` going `active` → `inactive` on preview under
migration `20260802171000`.** That is a state change the owner ordered, correctly applied, against
a baseline constant that was never advanced with it. Not drift, not corruption. **VERIFIED.**

The change window is bounded by the data: the 08-02 07:28 UTC observation still saw the old hash
and passed; the 08-03 08:21 UTC observation saw the new one. PR #408 merged 2026-08-02 15:29 UTC
and the ruling rows were created 14:12:34 UTC — consistent.

`property_status_hash` is unchanged, which is the right result: the ruling flipped a **licensor**
and deliberately left property `FK` alone.

---

## 4. Claim: 14 stacked alerts and a tripped breaker, untouched — **VERIFIED, and it reconciles cleanly with the 5 acknowledgements**

`plm.taxonomy_sync_alert` on preview at 2026-08-03 19:14 UTC / 15:14 local:

- **32 alerts total; 17 acknowledged; 15 unacknowledged, all `critical`, all within 48h.**

The 15 unacknowledged, by reason:

| reason | n | first fired (UTC) | last fired (UTC) |
|---|---|---|---|
| sync health check failed with 1 issue(s) | 10 | 2026-08-02 15:16:31 | 2026-08-03 07:42:26 |
| sync health check failed with 2 issue(s) | 3 | 2026-08-03 11:41:33 | 2026-08-03 17:18:43 |
| daily comparison failed with 2 unexplained diff(s) | 1 | 2026-08-03 08:21:48 | — |
| AUTO-TRIP on critical alert from coldlion_designflow_sync_health | 1 | 2026-08-02 15:16:31 | — |

### The 14-vs-5 reconciliation — the two reports do **not** contradict each other

They are about **different alerts**, and the arithmetic closes exactly.

- The **5 acknowledgements** made on 2026-08-02 came from the acknowledgement-RPC workstream. All
  five carry `acknowledged_by = "automation:shared-db sub-agent alert-ack-rpc (dispatched by the
  shared-db coordinator session) (on behalf of human:Albert Hazan)"` and
  `acknowledged_at = 2026-08-02 13:15:16.708355 UTC` (09:15:16 local). Exactly five rows carry
  that stamp. Their reasons are all **`ColdLion recurring promotion refused: read-cycle-state`**
  (4 of them) plus its **AUTO-TRIP** companion — alerts that fired on **2026-07-31**, an entirely
  different incident from the Phase 4 baseline drift.
- The **health-check alerts** at issue in PR #426 began firing at **2026-08-02 15:16:31 UTC**
  (11:16:31 local) — **two hours after** the acknowledgement sweep ran. The RPC workstream could
  not have acknowledged them; they did not exist yet.
- **The count of 14 is exactly right for the moment the block cites.** The block read it from the
  alert payload of run 30836142200 at 17:18 UTC. At that instant the unacknowledged population
  was 10 (1-issue) + 2 (the 11:41 and 15:12 2-issue alerts) + 1 (comparison) + 1 (auto-trip)
  = **14**. The 17:18 alert then inserted itself, making 15, which is what is stored now.

**No contradiction. Both reports are accurate; the block's "re-count before acting" warning in
its §9 was well-placed, and the answer today is 15, not 14.**

### Circuit breaker — **untouched, VERIFIED**

`plm.taxonomy_circuit_breaker`, single row:

- lane `coldlion_licensor_property`, state **`tripped`**
- tripped `2026-08-02 15:16:31.012896 UTC` / `11:16:31 local`
- `tripped_by = auto-trip`, `failed_invariant = coldlion_designflow_sync_health`
- reason: `AUTO-TRIP on critical alert from coldlion_designflow_sync_health: sync health check
  failed with 1 issue(s)`
- **`reset_at` and `reset_by` are both `null`** — never reset.

`plm.taxonomy_circuit_breaker_event` shows a continuing run of `blocked_attempt` rows, hourly,
most recent `2026-08-03 17:18:43.689608 UTC` / `13:18:43 local`, all `is_drill = false`,
`actor = postgres`. The breaker is doing its job: it is refusing further ColdLion canonical
promotion while the invariant is failing.

**Nobody has acknowledged, reset, silenced or deleted anything since the block was written.**

---

## 5. Claim: another session is operating in the same working copy — **VERIFIED**

The strongest evidence is in the PR itself, and it is unambiguous.

- Remote branch **`intake/coldlion-baseline-drift-20260803`** exists at
  `b8503bec8649930c05278a80df0777bfef4452bb` — i.e. it points at `main` and carries **zero
  commits**. That is the branch the PR #426 author says they created and committed on.
- Their commit **`4c091eaefe930053884aa8d4e1f0965c93678e41`** ("docs(intake): hand over ColdLion
  Phase 6 baseline drift diagnosis", authored 19:03:32 UTC / 15:03:32 local) is instead the
  **first** commit on branch **`intake/licensor-property-taxonomy-20260803`**.
- The **second** commit on that branch, `20bc3d4b…` ("docs(intake): hand over the
  licensor/property taxonomy workstream", 19:06:28 UTC / 15:06:28 local), is a **different
  session's** intake block — the Claude Code session `c3a45a75` licensor/property audit.
- PR #426 was created at 19:04:38 UTC, i.e. **between** those two commits, and its head has since
  moved to include the second one.

So two independent sessions committed to one branch, three minutes apart, from one checkout, and
one PR now carries both their intake blocks. **PR #426 is not one handover, it is two.**
`origin/main` remains `b8503be`.

There is no evidence either session wrote to the other's files — the diff is additive in
`COORDINATOR_INTAKE.md` and touches nothing else (+506 lines, −0). But the collision is real and
it is exactly the failure mode the single-coordinator protocol exists to prevent.

---

## 6. Corrections and cautions for whoever picks this up

Things in the block that are stale, imprecise, or that cost time to establish:

1. **The alert count is now 15, not 14.** See §4.
2. **Scheduled ColdLion runs land ~07:25 UTC, not 04:00 UTC.** See §2.
3. **The acknowledgement RPC signature is `plm.acknowledge_taxonomy_sync_alert(uuid, jsonb)`.**
   Not `(uuid, text, text)`. Check `pg_proc` before writing a call.
4. **Preview's pooler is `aws-0-us-east-1`, production's is `aws-1-us-east-1`.** AGENTS.md §9
   documents only the production host; using it against preview fails with
   `tenant/user postgres.rjyboqwcdzcocqgmsyel not found`, which reads like a dead branch and is
   not one.
5. **Do not call `plm.check_taxonomy_sync_health()` to "look at" the state.** It writes.
6. **The block's §9 open item is now closed** — `prior_source_ref_hash` equals `source_ref_hash`,
   so the second diff is the same root cause. Nobody needs to re-run that query.
7. **The Supabase MCP is production.** Confirmed again today. The block's dead-ends section is
   correct and should survive into the permanent docs.

---

## 7. What remains to be done — recommendations only, the coordinator decides and the owner rules

### A. Escalate to the owner today — **the only genuinely time-sensitive item**

Albert made a decision on 2026-08-02 that is **not in effect in the system of record**. He should
be told today, in one plain sentence, and asked the single question that unblocks everything else:
*do you want the FRIENDS TV ruling promoted to production?* Everything in §7B depends on the
answer and nothing should be built before it.

Production promotion is an **owner gate**. No sub-agent should promote `20260802170000` /
`20260802171000` without Albert naming them.

### B. Still needed (in this order, none of it started)

1. **Owner decision on production promotion** of the ruling pair. If yes: promote both, in
   version order, `170000` before `171000`, and verify live afterwards
   (`core.licensor FR status`, `to_regclass('core.taxonomy_owner_ruling')`, and that
   `plm.import_master_data` no longer force-sets status).
2. **A re-pin migration** advancing `licensor_status_hash` from `d9b07759bf80ff227e2fa9bd635d2138`
   to `00bf7069fff79b9deab1d14dbd9112b2` in **both** `plm.check_taxonomy_sync_health()` and
   `plm.record_taxonomy_parallel_observation()`, citing `20260802171000` as authority. The block's
   corrected plan (its §6) is sound and should be adopted rather than re-derived — in particular
   its four additions: a live-hash guard that raises if the live hash matches neither value;
   re-assertion of the revoke/grant block after `create or replace` (the public-schema anon
   lockdown re-strips EXECUTE); per-field old/new values in the `prior_nondrill_drift` diff
   object, which today records only a prior observation id and is why this cost a session to
   diagnose; and the fact that health will not self-clear.
   **Recompute the live hash at authoring time** — the pin must be against a measured value, not
   against this document.
3. **A fresh passing comparison observation** after the re-pin. Health will not clear on its own:
   `check_taxonomy_sync_health()` also fails on `recent_nondrill_observation_failed` until a newer
   passing observation exists.
4. **Scoped acknowledgement** of the 15 identified alerts by id — never a blanket
   `acknowledged_at is null` sweep — and an **authorised** breaker reset, recorded with
   `reset_by` / `reset_authorization`.
5. **Re-pin promoted to production last**, and only after step 1 is verified live. If the ruling
   is promoted to production but the re-pin is not, the mismatch is latent there rather than
   alarming, because `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` is unset and the production
   health/comparison crons are deliberate no-ops. **Latent is not safe** — do not let the green
   production runs be read as evidence the feed works.
6. **A durable rule**: any migration that changes a pinned field must advance the pin in the same
   transaction. This whole incident is one migration that did not.

### C. Already superseded — drop it

- **The block's request to "return the shared checkout to `main`"** — the coordinator has already
  done this. `origin/main` is `b8503be` and unchanged.
- **The block's §9 uncertainty about the second diff** — closed in §3 above.
- **The block's uncertainty about the alert count** — answered in §4 above (15).

### D. Should be dropped

- **Kimi's baseline-revision-table proposal.** The block already records that Kimi conceded it
  would not solve preview/production skew, because the rows would arrive via the same migrations
  at the same staggered times. Do not resurrect it as part of this fix. If a baseline-revision
  table is ever wanted it is a separate design with a separate justification.
- **Kimi's claim that the readiness evaluator also hard-codes these hashes.** The block checked
  and it does not; `APPROVED_HASH` in
  `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` is the frozen 542-row mapping
  hash and is unaffected. Do not re-pin it.

### E. Recommended disposition of PR #426

**Merge it as an intake filing, after the coordinator has read both blocks — do not close it, do
not action it as a work item.**

Reasoning: the diff is +506/−0 and touches only `COORDINATOR_INTAKE.md`. It contains **two**
independent intake blocks from two sessions (§5), both of which record findings that are
verified-true and that are not written down anywhere else. Every substantive claim in the block
checked out; the corrections in §6 are small and are captured here. Leaving it open leaves the
only record of an unauthorised preview write, and of a production divergence on owner-ruled master
data, on an unmerged branch.

Before merging, the coordinator may want to append a one-line pointer from each block to this
triage document, and should note that the block's own §6 plan — not a fresh re-derivation — is
the plan of record for the re-pin.

Two follow-ups the coordinator owns separately, neither of which should block the merge:

- Deleting the empty stray branch `intake/coldlion-baseline-drift-20260803` (points at `main`,
  zero commits).
- The concurrent-checkout collision in §5 — worth a line in AGENTS.md, since the protocol
  currently assumes a non-coordinator session works alone in the shared checkout, and today two
  did not.
