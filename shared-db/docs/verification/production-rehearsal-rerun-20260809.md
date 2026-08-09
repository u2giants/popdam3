# A2b — the production rehearsal re-run at the fixed `main`, and the partial-promotion debate

**Plan item:** `plan_orchestrator-workflow-gaps.md` § A2, second attempt.
**Measured:** 2026-08-09, by a dispatched sub-agent of orchestrator session `5e1ab3af` (marker issue #601).
**Predecessor:** `docs/verification/production-apply-set-and-rehearsal-20260809.md` (PR #608, merged
as `41627fa43861b7ad39981494320d5bd16c5be9b2`). **Verified, not inherited.**
**Nothing was written to any database.** Every production statement below is a `select`. The only
workflow run was `mode: dry-run`, whose first job step refuses `mode: apply`.

---

## 0. Headline

1. **The previous agent's prediction held, exactly.** The re-run cleared "Build bounded checkout"
   — the parsing defect fixed in #608 is genuinely fixed on `main` — and failed at the Supabase
   CLI on the missing `--include-all`. That is **blocker 2 (structural / workflow)**, not a
   migration fault and not a parsing fault. §3.
2. **The preflight passes on the corrected 47, and removing the two §6.5-held versions breaks
   nothing.** Verified live, not reasoned. The one file that could have broken —
   `20260807030000` — guards itself with `to_regclass(...)` and degrades to `raise notice`. §2.
3. **The A2 gate is STILL untested.** The CLI never printed a "Would push these migrations:"
   plan, so `verify_dry_run` never ran. The gate is neither passed nor failed. §3.2.
4. **The ledger-is-authoritative claim, on which every resume procedure depends, is an
   UNPROVEN ASSUMPTION** — including in this repo's own design doc. Codex conceded this under
   challenge. It is the most actionable new finding here. §4.1.
5. **Sub-batching the 47 is probably harmful, not safer.** It converts one short partial-promotion
   window into several sanctioned ones. §4.2.

## 1. Target confirmed before any measurement

```
mcp__supabase__get_project_url  ->  https://qsllyeztdwjgirsysgai.supabase.co
```

**Production ref: `qsllyeztdwjgirsysgai`.** Preview (`rjyboqwcdzcocqgmsyel`) was not read or touched.

## 2. Counts and the preflight, re-derived from scratch

| Measure | at dispatch | this pass | note |
|---|---|---|---|
| `origin/main` | `41627fa…` | **`41627fa43861b7ad39981494320d5bd16c5be9b2`** | confirmed |
| Migration files | 411 | **411** | |
| Production ledger rows | 361 | **361** | |
| Ledger head | `20260802194100` | **`20260802194100`** | production last received a migration 2026-08-02 |
| Missing versions | 50 | **50** | |
| Ledger rows with no file | 0 | **0** | no phantom rows |

```sql
select count(*), min(version), max(version) from supabase_migrations.schema_migrations;
-- 361 | 20260220125350 | 20260802194100
```

The 47 was **re-derived independently** as `missing − {20260729120000, 20260802170000,
20260802171000}` and matched the predecessor's published list entry for entry.

### 2.1 Preflight on the 47 — PASSES

```
PREFLIGHT OK: 47 migrations, no missing non-deferrable dependency. This is a pre-filter,
NOT an approval -- the rehearsal against a production-shaped database remains the
authoritative gate.
```

**Negative control**, to prove the guard is live rather than merely present: the old 49-entry
allowlist (the 47 plus the two held versions) is **refused**, with the §6.5 message naming the
owner ruling. So the rule fires.

### 2.2 Does removing the two HELD versions break a dependency? **No — verified, not reasoned.**

The predecessor reasoned this was safe but could not test it. Three independent checks:

1. **The whole-batch preflight passes on the 47** (§2.1). That is the same code path `prepare`
   uses.
2. **Object-level check.** The held versions create exactly:
   `20260802170000 → plm.import_master_data`; `20260802171000 → core.taxonomy_owner_ruling`.
   Cross-referencing every hard reference of all 47 against that pair: **0 hits.**
   `plm.import_master_data` also already exists on production
   (`to_regproc('plm.import_master_data') → plm.import_master_data`), so it was never at risk.
3. **Raw-text sweep**, because the object scanner has a known dynamic-`execute` blind spot. Three
   textual mentions, each read by hand:
   - `20260803200000` — **comments only** (six mentions of `plm.import_master_data`, all prose).
   - `20260807030000` — the one that matters. It references **both** held objects. But the file
     was **written in anticipation of the hold** and says so at its own lines 198 and 299–301. Its
     insert into `core.taxonomy_owner_ruling` sits inside
     `if to_regclass('core.taxonomy_owner_ruling') is not null then … else raise notice … end if;`
     — a **notice**, not an exception. The parent edge it exists to apply is applied either way.

**Conclusion: the 47 is internally closed. No dependency is broken by the §6.5 removal.**
This confirms the predecessor's reasoning and, separately, is now evidenced.

## 3. The rehearsal

**Run:** https://github.com/u2giants/shared-db/actions/runs/31330329244
`target: production` · `mode: dry-run` · `commit_sha` `41627fa43861b7ad39981494320d5bd16c5be9b2`
· `confirmation: DRY-RUN 41627fa…` · `production_allowlist` = **the 47**.

| Step | Result |
|---|---|
| Refuse production apply | skipped (`mode` was `dry-run`) — correct |
| Check exact confirmation | ✅ |
| Verify exact main commit | ✅ |
| Capture production migration record | ✅ |
| **Build bounded checkout** | **✅ — this is the new result; #608's fix works on `main`** |
| **Run and verify bounded dry-run** | **❌ exit 1, at the Supabase CLI** |
| Save dry-run evidence | not reached |

### 3.1 The prediction — it held

The predecessor recorded, so a later session could falsify it:

> it should get past "Build bounded checkout" and fail instead at the Supabase CLI on blocker 2.

**Both halves happened.** "Build bounded checkout" passed, which retires blocker 1 (the
`strip_sql` dollar-quote defect) as a live problem — it is the only thing that changed between
run `31327934569` and run `31330329244`.

### 3.2 The failure, and its fault class

```
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Found local migration files to be inserted before the last migration on remote database.

Rerun the command with --include-all flag to apply these migrations:
supabase/migrations/20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql
… 30 files …
supabase/migrations/20260802160000_taxonomy_alert_ack_effective_role_is_current_user.sql
```

**Fault class: (c) workflow.** Not a migration fault and not a parsing fault in the verifier. The
distinction is load-bearing, so state the evidence:

- **Not (a) a migration/dependency fault.** No SQL was executed and none was even parsed by
  Postgres. The CLI refused *before* planning, on file ordering alone.
- **Not (b) a verifier parsing fault.** `verify_dry_run` **never ran**. The step is
  `bash -e` with `set -o pipefail`, so the non-zero `supabase db push` killed the step at the
  pipeline. The verifier's output-wording coupling remains **untested**, and it is still a live
  risk for the next attempt — the first time it runs will be the first time the
  `"Would push these migrations:"` marker and `MIGRATION_LINE_RE` are exercised against a real
  CLI plan.
- **It is (c).** `.github/workflows/shared-supabase-migrations.yml` runs
  `supabase db push --dry-run` with no `--include-all`, while 30 of the 47 sort below the ledger
  head. `AGENTS.md` §5.1(4) already sanctions the flag inside a bounded checkout. The workflow
  simply has not been changed yet. This is A3's work.

### 3.3 The gate: untested, but with a real partial signal

The A2 gate — "the dry-run output lists **exactly** the 47 and nothing else" — was **not
reached**, so it is neither passed nor failed. The `--include-all` failure mode the allowlist
exists to prevent was therefore **not** observed, but nor was it excluded.

**The partial signal is worth recording.** The CLI's refusal list is drawn from the files
actually present in the bounded checkout. It contains **30 files, every one of them in the
allowlist, and nothing else.** No retired file, no held file, no unrelated file. That is
consistent with `prepare` having pruned correctly (408 of 411 kept, 3 deleted). It is *evidence
about the checkout*, not the gate — the gate is about the CLI's push plan.

### 3.4 A small correction to the predecessor's arithmetic

The predecessor says "**31** of the 47 sort below the ledger head". The CLI listed **30**, and
the derivation agrees: 50 missing − 17 above the head = 33 below; 33 − 1 retired − 2 held = **30**.
Off by one. Nothing depends on it, but the number should be 30 wherever it is quoted.

## 4. The Codex debate — the partial-promotion problem

Model: Codex via the `codex-cli` MCP, **`model_reasoning_effort` passed explicitly as `medium`**
per the standing rule. ⚠️ **Honest limitation:** the MCP transport returns only the assistant
message, not the CLI run header, so the header line `reasoning effort: …` could **not** be read
back to confirm. The setting was passed explicitly and was never unset and never `high`; that is
what can be asserted, and no more. A CLI invocation should be preferred over the MCP wherever
reading the header is part of the requirement. (`gpt-5.6-codex` was rejected outright by the
account — "not supported when using Codex with a ChatGPT account" — so the account default model
was used.)

Codex was asked to **attack** Grok's mitigation, not ratify it. Two rounds; the second was a
direct challenge to its own first answer. It **moved on all three challenges**, and I moved on
one of its.

### 4.1 Where Codex changed my mind — the ledger-authority assumption

**Grok's point 4 and Codex's own resume step both rest on: "each file is its own transaction,
therefore the ledger is trustworthy after a failure."** I challenged this as unproven. Codex
conceded immediately and completely:

> "Each file is transactional" does not prove that the migration SQL and ledger update share one
> transaction.

**And this repository makes the same unevidenced claim.**
`docs/production-migration-lane-design-20260802.md` §3.3 states Supabase "applies each migration
in its own transaction and records the ledger row on success", and §8 repeats it. **Neither cites
a test, a CLI source reading, or a version.** It has been treated as a property; it is an
assumption, and it is the assumption the entire 2am recovery procedure is built on.

**Concrete failure modes that would break it**, all real Postgres behaviour:
a migration file containing its own `commit`; `create index concurrently`; `alter type … add
value` on older servers; `vacuum`; or a connection loss *between* the file's commit and the
ledger insert. Any one of those leaves the ledger disagreeing with the database.

**Codex's proposed proof, which I endorse and which is cheap:** a destructive canary on a
disposable database with the exact pinned CLI version — a migration that writes a marker row and
then raises, plus one case each for `commit`, `create index concurrently`, and a kill between
execution and ledger insert. Then inspect marker and ledger.

**This is a new, actionable, unscheduled work item.** Until it is done, the 2am procedure cannot
compute the applied set from a ledger diff alone; it needs a per-file **effect manifest**
(expected objects, columns, policies, functions, indexes, data markers) to verify against. And
Codex's own honest corollary: **where a data change has no reliable postcondition, safe automated
resume is not possible at all.**

### 4.2 Where I changed Codex's mind — sub-batching is risk multiplication

Grok's point 2 (split the 47 into resume-safe sub-batches) I put to Codex as **actively harmful**:
one push of 47 has exactly **one** partial-promotion window and it is short; five sub-batches
create **five sanctioned resting points** in a half-promoted state, each potentially hours or days
apart while approvals are gathered, each observed by five live applications. That is risk
multiplication with better paperwork.

Codex agreed and hardened it into a rule:

> Reject sub-batching unless every proposed stopping boundary is proven compatible with all five
> deployed applications **before** production work begins. That proof is a precondition, not a
> follow-up task. … A single continuous push is safer than several pauses if the intermediate
> states have not been tested.

**Converged. Grok's point 2 is downgraded from "mitigation" to "conditional, and the condition is
expensive."** Dependency boundaries and owner-hold boundaries are *not* application-safety
boundaries, and the predecessor documents did not distinguish those.

### 4.3 The throwaway clone — is it necessary? Converged on "no, but the cheap option must be exact"

Codex's answer to question A: a **consistent `pg_dump` of production restored into a disposable
database** is cheaper and produces most of the same evidence — that the 47 run against today's
real data, that the data-dependent assertions and seeded DML pass, and that the ordering works.

What it **cannot** produce, and this is the part that must not be glossed:

- Exact parity of Postgres version, extensions, roles, grants, settings and Supabase-managed
  features, if restored to plain local Postgres. A temporary Supabase project restored from the
  dump is materially better on this axis.
- That external seed sources return the same data at promotion time as at rehearsal time.
- That production data has not drifted between rehearsal and apply — five live applications are
  writing throughout.
- **That each of the 46 intermediate states is safe for the five applications.** No rehearsal of
  the end state tests that at all.

**My addition, which Codex confirmed:** the restore is only faithful if it carries
`supabase_migrations.schema_migrations` with **all 361 rows**. Restore schema-only or data-only,
or drop that table, and the disposable database has an empty ledger, `db push` tries to apply all
411 files, and the rehearsal tests something entirely different — while *appearing* to pass.
Also required: exact object definitions, grants and ownership, extensions **and their versions**,
sequence/identity state, roles or faithful substitutes, `search_path` and database settings,
any `auth`/`storage` objects the files touch, frozen copies of the external seed inputs, and the
**same pinned CLI version and the same pruned checkout** intended for production.

**Where we did not fully converge.** Codex is content to call the dump-restore "cheaper evidence,
not equivalent evidence" and leave the choice open. I hold the stronger line and record it as my
position: given that the whole exercise exists because there is **no undo**, the rehearsal target
should be a **temporary Supabase project** restored from the dump rather than local Postgres,
because roles, grants and extension versions are exactly the class of thing these 47 files
manipulate, and local Postgres is silently wrong about all three. That is a recommendation for
the orchestrator, not a decision made here.

### 4.4 Codex's weakest-link answer — accepted, and it is genuinely new

> There is no declared **safe intermediate-state contract** for the five applications. Splitting
> into sub-batches may make resuming easier while making exposure longer. Every sub-batch boundary
> must be proven compatible with every deployed app version. Without that, "resume-safe" only
> describes the ledger, not production.

Neither the predecessor documents, nor Grok, nor I had named this. Every artifact so far reasons
about **the database's** consistency and none about **the applications'** tolerance of the 46
intermediate states. `AGENTS.md` §0.4-style app contracts exist, but nothing maps them onto a
half-applied batch. **This should become a plan item.**

### 4.5 Points 3 and 5 of Grok's mitigation

- **Point 3 (pre-apply restore point + PITR).** Codex attacked it and I agree: PITR is *disaster
  recovery*, not a rollback button. Using it means a new database, an application cutover, an
  outage, and an explicit decision about every write the five applications made after the restore
  point. It should be described that way in any runbook, or an operator will reach for it at 2am
  expecting an undo. Confirming retention is still worth doing; calling it a rollback is not.
- **Point 5 (never `migration repair --status reverted`).** Not contested by either side, and it
  survives §4.1 — in fact §4.1 strengthens it, because if ledger authority is unproven then
  hand-editing the ledger is even more dangerous than assumed.

### 4.6 The 2am resume procedure, as agreed after both rounds

Recorded because it did not exist anywhere before. **It is contingent on §4.1 being proven
first**; steps 4–6 are unsafe until then.

1. Stop. Do not hand-run files 46 and 47.
2. Record the command, commit SHA, **CLI version**, project ref, timestamp, failing filename, full error.
3. Block other promotions. Apply maintenance/read-only mode only if the approved runbook already
   grants that authority — do not invent it at 2am.
4. Read `supabase_migrations.schema_migrations` on production, read-only. Preserve the full ordered list.
5. Diff it against three frozen lists: the pre-run ledger capture, the signed 47-entry allowlist,
   and the file set in the bounded checkout at the deployed SHA.
6. True applied set = ledger-now **minus** ledger-before. **Never** infer it from terminal output.
7. Every new ledger row must be in the allowlist. Anything else = concurrent promotion or drift → stop.
8. Confirm file 45 has **no** ledger row, then verify its promised effects are absent **directly**
   (§4.1 — the ledger alone is not proof). Non-database side effects do not roll back.
9. Health-check the file-44 state against all five applications (§4.4).
10. Diagnose against a fresh snapshot and frozen external inputs. **Do not weaken or delete the
    assertion to make the file pass.**
11. Get owner approval for the fix and the resume point; rebuild the bounded checkout.
12. `supabase db push --dry-run --include-all` must list **exactly** the approved remaining set.
    Any difference stops the run.
13. Resume; capture the final ledger; run the object and application verification.

**Must NOT:** `migration repair --status reverted`; mark a file applied whose SQL did not succeed;
blindly re-run all 47; run a file by hand outside the runner; edit production directly; restore
production merely to tidy the ledger; assume PITR preserves post-restore-point writes.

## 5. Open items this pass created or sharpened

| # | Item | Owner | Why |
|---|---|---|---|
| 1 | Add bounded `--include-all` to the dry-run and apply steps of the workflow | A3 | The only thing between here and testing the A2 gate (§3.2) |
| 2 | **Prove or disprove ledger/SQL atomicity** with a canary on a disposable DB and the pinned CLI | new, unscheduled | Every resume procedure depends on it (§4.1) |
| 3 | Write the per-file **effect manifest** for the 47 | new | Fallback for #2, and needed for step 8 (§4.6) |
| 4 | Declare the **application intermediate-state contract** | new | Codex's weakest link (§4.4) |
| 5 | Whole-batch rehearsal on a disposable restore that includes all 361 ledger rows | A3/A5 | Still the authoritative gate (§4.3) |
| 6 | Fix "31" → **30** wherever quoted | orchestrator | §3.4 |
| 7 | `verify_dry_run`'s CLI-wording coupling is still unexercised | A3 | §3.2 |

## 6. What was NOT done

- **No apply. No DDL, no DML, no ledger insert, no `--include-all`, no `--create`, no scratch or
  clone database created.** Every production statement was a `select`. The only workflow run was
  `mode: dry-run`.
- **No guard was relaxed, weakened or edited.** `scripts/production_migration_guard.py` is
  untouched. The `--include-all` omission was reported as a finding, not removed as an obstacle.
- `supabase/migrations/` untouched — nothing added, edited, retired or deleted.
- `AGENTS.md`, `HANDOFF.md`, `HANDOFF.d/**` and `plan_orchestrator-workflow-gaps.md` untouched.
- Preview (`rjyboqwcdzcocqgmsyel`) not read and not modified.
- **No PR merged.** A PR was opened and left for the orchestrator.
- The A2 gate is **still unproven** (§3.3), and the whole-batch rehearsal (§7 of the predecessor)
  is **still not done**.
- The Codex **run header** was not read back; only the explicitly-passed `medium` setting can be
  asserted (§4).
