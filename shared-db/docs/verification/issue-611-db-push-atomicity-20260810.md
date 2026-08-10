# Issue #611 — is `supabase db push` atomic? **RUN. SETTLED for CLI 2.105.0.**

**Date of run:** 2026-08-10 · **Machine:** the **hetz** VPS (Linux, Docker) ·
**Session:** sub-agent of orchestrator `511f124e`, marker #684, claim #691 ·
**Repo state:** `main` tip **`bc29d36`** (the merge of PR #687, issue #685 hardening)

> This file replaces the earlier "NOT SETTLED" version of itself. There is deliberately **one**
> result document, not a new one alongside the old: `AGENTS.md`, the run brief and the script all
> link to this path, and leaving a stale "we do not know" page live in the repo is exactly the
> confusion this experiment existed to end. The old text is in git history.

---

## The answer, in one line

**For Supabase CLI 2.105.0, a migration's SQL and its `supabase_migrations.schema_migrations`
row are written in ONE transaction — PER FILE. The BATCH is NOT one transaction.**

> A 63-migration production run that dies on file 40 leaves files 1–39 **applied and ledgered**,
> and nothing from file 40 onward. **A mid-batch failure does NOT leave production unchanged.**

**The feared state did not appear.** No fixture produced SQL-applied-without-a-ledger-row.

## Scope — stated honestly, because this gate exists because someone once overstated it

- This answers the question for **Supabase CLI 2.105.0 only**. The behaviour belongs to the CLI,
  not to the PostgreSQL major version. A future CLI bump **reopens** the question and the script
  must be re-run.
- It is **conditional on file contents**, not a universal law. It holds for files the runner can
  wrap in a transaction. **Q4 is the counterexample** and is stated separately below.
- It was **measured, not reasoned**. During earlier review a reviewer asserted this answer as
  settled fact, was challenged, retracted, and dropped its own confidence from 85% to 30%.

---

## Exactly what was run

| Fact | Value |
| --- | --- |
| Machine | hetz VPS, Docker |
| Database under test | throwaway `postgres:15` container `issue611-canary`, port 55432, destroyed at the end |
| Supabase CLI version | **2.105.0** (the pinned version the gate names) |
| CLI source | `supabase_linux_amd64.tar.gz` from the **v2.105.0** GitHub release, extracted **WHOLE** into the scratch dir and invoked from there |
| `supabase` (the SHIM) sha256 | `039206687deb55706063371d7452c0d2b18de1e530dbc783f10b39f5589c3414` |
| `supabase-go` (the REAL CLI) sha256 | `445d502015f1c15627ef0597db7b188b6ad990bdd1c9e1a5df10c605310af3a3` |
| Repo commit run | `bc29d36` |
| Script | `scripts/experiment_611_db_push_atomicity.sh` |
| Ledger tripwire | **`ledger rows seeded: 424`** — the run had a realistic ledger, so only fixture files were pending |
| Transport tripwire | **`container TLS: on`** (log line 2) |
| Raw log | [`issue-611-run-output-20260810.txt`](issue-611-run-output-20260810.txt) — 671 lines, complete and unedited |
| Databases touched | **none besides the throwaway container.** No `supabase link`, no production `qsllyeztdwjgirsysgai`, no preview `rjyboqwcdzcocqgmsyel` |

The version string alone does **not** establish the pin — see issue #688 and "the two-binary
trap" below. That is why both binary checksums are recorded.

---

## Results, verbatim

### Q3 — a migration that fails HALFWAY THROUGH ITS OWN SQL

```text
Applying migration 29990101000001_q3_half_failing_file.sql...
ERROR: division by zero (SQLSTATE 22012)
At statement: 1
select 1 / 0
--- Q3 RESULT ---
statement-1 table present (t = NOT rolled back, the dangerous answer):
f
ledger row for 29990101000001 present (t = ledger lies about a failed file):
f
```

**Read:** the file rolled back whole. Statement 1 did **not** survive statement 2's failure, and
no ledger row was left behind. A half-applied file with no ledger row — the worst case — did not
occur.

### Q1/Q2 — file A succeeds, then file B fails

```text
Applying migration 29990101000002_q2_file_a_succeeds.sql...
Applying migration 29990101000003_q2_file_b_fails.sql...
ERROR: division by zero (SQLSTATE 22012)
At statement: 1
select 1 / 0
--- Q1/Q2 RESULT ---
file A table present (t = earlier files STAY applied; f = whole batch is one txn):
t
file A ledger row present:
t
file B table present (t = SQL committed without its ledger row -- the worst case):
f
file B ledger row present:
f
```

**Read — this is the operationally important half.** File A **stayed applied with its ledger
row** after file B failed. The batch is **not** one transaction. This is the "per-file atomicity"
branch of the script's own `HOW TO READ THIS` block: *the one-directional co-presence recovery
rules are correct exactly as written.*

Note also that A and B are **consistent with each other**: A has both its SQL and its row, B has
neither. Nothing was left half-way.

### Q4 — NON-TRANSACTIONAL DDL (`create index concurrently`) — **a NEW operational constraint**

```text
Applying migration 29990101000004_q4_non_transactional_ddl.sql...
ERROR: CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)
At statement: 1
create index concurrently q4_idx on public.q4_before_concurrent (id)
--- Q4 RESULT ---
pre-concurrent table present (t = NOT rolled back -- autocommit, the dangerous mode):
f
concurrent index present (t = the CLI really did run it outside a txn):
f
ledger row for 29990101000004 present (t = ledger lies about a failed file):
f
```

**Read:** the CLI does **not** drop into statement-by-statement autocommit — the failure mode the
model panel feared most. It uses a **pipeline**, PostgreSQL refuses `CREATE INDEX CONCURRENTLY`
inside one, and the whole file rolls back cleanly. Safe — but it means:

> **Any migration containing `CREATE INDEX CONCURRENTLY` CANNOT BE PUSHED AT ALL under CLI
> 2.105.0. It fails outright.** The same applies to any other statement PostgreSQL refuses inside
> a pipeline/transaction block: `REINDEX … CONCURRENTLY`, `VACUUM`,
> `REFRESH MATERIALIZED VIEW … CONCURRENTLY`, `CREATE DATABASE`, `ALTER SYSTEM`.

This is a **migration-authoring constraint**, now recorded in `AGENTS.md`. The 424-migration
backlog scan for this pattern is below.

### Q5 — the INVERSE failure: valid SQL, blocked ledger insert. **THE PROOF.**

```text
Applying migration 29990101000005_q5_ledger_insert_fails.sql...
ERROR: issue611 fixture: ledger insert deliberately blocked (SQLSTATE P0001)
At statement: 2
INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)
--- Q5 RESULT ---
trigger exception seen in the push log (MUST be t, or Q5 proves NOTHING):
t
q5 table present  (t = SQL SURVIVED a failed ledger insert => NOT one transaction):
f
ledger row for 29990101000005 present (expected f -- the trigger blocked it):
f
```

**Read:** all three required conditions met — **exception `t`, table `f`, ledger `f`**. This is
the proof row, not the inconclusive one. The file's SQL was perfectly valid; a `BEFORE INSERT`
trigger made only the **ledger insert** raise, and the SQL went down with it. SQL and ledger row
genuinely share one transaction; this is **not** wire-protocol masking, which Q5 is the only
fixture that can rule out.

Note `At statement: 2` — the CLI appends the ledger write to the **same statement stream** as the
file's SQL. That is the mechanism, visible in the log.

### Q6 — INTERSPERSED placement + multi-statement success

```text
Do you want to push these migrations to the remote database?
 • 20260601005500_q6_interspersed_multi_statement.sql
Applying migration 20260601005500_q6_interspersed_multi_statement.sql...
Finished supabase db push.
--- Q6 RESULT ---
q6 table present (expect t -- an interspersed file applies at all):
t
q6 row count (expect 2 -- ALL statements of a multi-statement file committed):
2
q6 ledger row present (expect t):
t
```

**Read:** two things at once.

1. **`--include-all` is properly ledger-filtered.** Only `20260601005500` was listed for push; the
   424 seeded versions were **not** re-listed. So the interspersed (out-of-order, mid-ledger) path
   works, not only the plain append path — and the earlier worry that `--include-all` would replay
   everything is closed.
2. **Multi-statement success is real.** All statements committed (2 rows), so "success" is not an
   artefact of a single trivially-atomic statement.

---

## The three ways this run could have produced a confident but WRONG answer, and why it did not

The run brief names three. Each is addressed by evidence, not by assurance.

1. **Stop-on-first-error mistaken for batch atomicity.** Not applicable in the direction that
   matters: Q1/Q2 gave `file A table = t`, the *opposite* branch. We are **not** claiming a failed
   batch leaves production unchanged — we are claiming the reverse, and stating it as the headline.
2. **Wire-protocol masking.** Ruled out by Q5, the only fixture that can. The ledger insert was
   reached (its exception is in the log) and took valid SQL down with it.
3. **A conditional result reported as universal.** Handled: the scope section above, and Q4 is
   stated as its own separate finding rather than folded into the headline.

---

## THREE ATTEMPTS WERE VOID — the committed script was BROKEN on the pinned CLI

Recorded in full because **either failure silently looks like a clean pass**, which is the worst
shape a failure can take. Both are now fixed in the script and in the run brief.

1. **Void #1 — the two-binary trap ([#688](https://github.com/u2giants/shared-db/issues/688)).**
   The v2.105.0 linux tarball ships **two** binaries: `supabase` is a **shim** that forwards to a
   co-located `supabase-go`. Extracting only `supabase` made every push die with
   *"Could not find the `supabase-go` binary"*, and **every result line then read `f`** — which
   reads exactly like a clean rollback. **An absent table with no push is not a rollback.**
   Fix: extract the **whole** tarball; the script now runs a real CLI command as a preflight and
   **aborts loudly** rather than measuring nothing.
2. **Voids #2 and #3 — TLS.** CLI 2.105.0 **forces TLS** on `--db-url` and **ignores
   `sslmode=disable`**. Plain `postgres:15` serves no TLS, so every push died with
   `tls error (server refused TLS connection)`. Fix: the script gives the throwaway container a
   self-signed cert and `ssl = on`, and prints **`container TLS: on`** as a visible tripwire.
3. **Valid run #4** was the run above. **No fixture, SQL file, or assertion was changed** — only
   the throwaway container's transport. That constraint is written into the script header and must
   be kept.

---

## SCAN — `CREATE INDEX CONCURRENTLY` across every migration in the repo

Because of Q4, a migration containing that statement would **fail outright** and abort its batch.

**Scanned:** all **424** files in `supabase/migrations/` at `bc29d36`, case-insensitive, with a
multi-line-tolerant pattern (`create [unique] index … concurrently` with any whitespace or newline
between the words), plus `reindex … concurrently`, `refresh materialized view … concurrently` and
statement-leading `vacuum`.

### Result: **ZERO hits. This risk is clear.**

- **No migration anywhere in the repo contains `CREATE INDEX CONCURRENTLY`** or any other
  non-transactional statement of that family.
- **No migration in the 63-migration production backlog** (`20260724060000` through
  `20260810140000`, the versions on `main` and not on production) contains one. **The promotion
  plan does not need to change on this account.**
- The only two textual matches for the word "concurrently" in the whole tree are **prose inside
  error messages**, not DDL:
  - `supabase/migrations/20260802140000_acknowledge_taxonomy_sync_alert_rpc.sql:288` —
    `'taxonomy sync alert % was acknowledged concurrently; nothing was written', p_alert_id`
  - `supabase/migrations/20260802150000_taxonomy_alert_actor_heuristic_word_anchors.sql:230` —
    the same message text.

This clears a risk rather than raising one. It is, however, a **point-in-time** result: it is a
constraint on **future** migration authors, and it is recorded as such in `AGENTS.md` §5.1-A.

---

## What this changes, operationally

- **`scripts/production_migration_guard.py` is CORRECT AS WRITTEN.** Both the one-directional
  co-presence rules and the `validate_candidates` refusal of an already-applied version rest on
  the assumption that a failed run leaves earlier files applied **with** their ledger rows. The
  experiment confirms that assumption. **Do not soften either. Do not "tidy" the co-presence rules
  into symmetry** — the asymmetry is what makes "the fix alone" a legal recovery allowlist.
- **Promote in small, bounded batches.** The larger the batch, the more of it is committed and
  unrecoverable-as-listed after a mid-run failure.
- **Expect the recovery path to be "the fix alone."** After a mid-batch failure, the applied files
  are applied; the next allowlist contains only what still needs to run.
- **A CLI version bump reopens #611.** The pin is load-bearing. If the workflow moves off 2.105.0,
  re-run this script and re-record the result here.

## Reproducing this

Read [`issue-611-run-brief.md`](issue-611-run-brief.md) first — it is written for a fresh agent
with zero knowledge of this repo and now carries both defects above as prerequisites.

```bash
bash scripts/experiment_611_db_push_atomicity.sh 2>&1 | tee issue-611-run-output.txt
```
