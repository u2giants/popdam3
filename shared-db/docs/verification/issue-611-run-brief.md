# Issue #611 run brief — how to actually run the `db push` atomicity experiment

**Written:** 2026-08-10 · **For:** a fresh agent, on a machine with Docker, with **zero prior
knowledge** of this repository, this issue, or the sessions that produced it.

Read this whole page before running anything. It is about twenty minutes of work and it
unblocks a production gate, so it is worth getting right rather than fast.

---

## 0. STATUS — this run has ALREADY BEEN DONE ONCE. Read §3½ before you repeat it.

The run happened on the **hetz** VPS on 2026-08-10 against `main` tip `bc29d36`, on CLI
**2.105.0**. The gate is discharged. The result lives in
[`issue-611-db-push-atomicity-20260810.md`](issue-611-db-push-atomicity-20260810.md) with the
complete raw log in [`issue-611-run-output-20260810.txt`](issue-611-run-output-20260810.txt).

**You only need to run this again if the pinned Supabase CLI version changes.** The behaviour
belongs to the CLI, so a version bump reopens issue #611.

**And if you do run it again, read [§3½](#3-two-defects-that-voided-three-of-the-four-attempts-read-this-or-lose-an-hour)
first.** Three of the four attempts on 2026-08-10 were **void**, and each one printed a full page
of `f` results that looked exactly like clean rollbacks. Both causes are now fixed in the script,
but you must know them to recognise them.

---

## 1. What you are being asked to do, in one line

Run one bash script against a throwaway PostgreSQL container, and record its output in this
repository. That is the entire job. You are **not** being asked to fix anything, change any
schema, or touch any real database.

---

## 2. What question the script answers, and why it blocks production

`shared-db` (`u2giants/shared-db`) is the single source of truth for a shared Supabase
database used by several applications. Schema changes are `.sql` files in
`supabase/migrations/`, applied with the Supabase CLI command `supabase db push`. The CLI
records what it has applied in a ledger table, `supabase_migrations.schema_migrations`
(columns: `version`, `statements`, `name`).

**Issue #611 asks:** when `db push` applies a migration, does it write the migration's **SQL**
and its **ledger row** inside ONE transaction?

Nobody knows. It was once asserted as settled, challenged, and retracted — which dropped a
plan's stated confidence from 85% to 30%. It has never actually been measured.

**Why it gates production.** The answer decides what a production apply that **dies halfway
through a batch** leaves behind. That is the entire basis of the recovery rules in
`scripts/production_migration_guard.py`. Get it wrong and the documented recovery procedure is
wrong at the exact moment somebody is following it under pressure.

Three outcomes, three different worlds:

| If the run shows | Then |
| --- | --- |
| Per-file atomicity — earlier files stay applied | The recovery rules are correct exactly as written. This is what everything currently assumes. |
| The whole batch is one transaction | A failed run leaves production unchanged; the recovery case cannot arise. Keep the rules, soften their urgency wording. |
| **SQL commits without its ledger row** | **The dangerous case.** A re-push replays an already-applied file and dies on "already exists", possibly leaving a `CREATE` standing on production without the security migration that was meant to follow it. Requires a redesigned recovery procedure and a loud warning in `AGENTS.md`. |

**The formal gate.** `AGENTS.md` §5.1-A states it as a HARD GATE, not advice:

> **NO licensor batch (Disney, Paramount, NBCU, Warner) may go to production** until
> `scripts/experiment_611_db_push_atomicity.sh` has actually been RUN on the pinned Supabase
> CLI version **2.105.0**.

Your run is what discharges that gate. Until it happens, four licensor data batches are frozen.

---

## 3. Prerequisites — check all three before you start

**a) Docker must be installed and running.** The script starts a throwaway `postgres:15`
container, beats it up, and deletes it. Confirm:

```bash
docker run --rm hello-world
```

Anything other than a success message means stop and fix Docker first. (The previous machine,
`al8960ofc`, had no Docker at all — that is the only reason this brief exists.)

**b) Supabase CLI pinned at exactly 2.105.0.** This is not a nicety. The behaviour under test
belongs to the **CLI**, not to PostgreSQL. A run on 2.106 or 2.99 does **not** discharge the
gate and must not be reported as if it did. Confirm:

```bash
supabase --version
```

It must print `2.105.0`. If it prints anything else, install that exact version before running
and re-check.

> ⚠️ **The version string alone is NOT enough, and installing "just the binary" WILL void your
> run.** On Linux, install by downloading `supabase_linux_amd64.tar.gz` from the **v2.105.0**
> GitHub release and **extracting the WHOLE tarball into one directory**, then invoking the
> `supabase` inside that directory. The tarball ships **two** files — `supabase` is only a **shim**
> that forwards to a co-located `supabase-go`. See §3½ below. The checksums of the two binaries
> that produced the recorded result are in the result document.

Corollary you may be tempted by and should not be: the **PostgreSQL major version does not
matter**. A three-model review confirmed PG15 vs PG17 does not change the answer. Do not
"improve" the script by swapping `postgres:15` for something else — run it exactly as written,
because that is the form that was authored and reviewed.

**c) bash.** The script is bash (`set -euo pipefail`). On Windows use Git Bash or WSL; on
macOS/Linux the system shell is fine.

---

## 4. Get the code

```bash
git clone https://github.com/u2giants/shared-db.git
cd shared-db
```

Run from `main`. (The hardening PR — branch `gate-611-run`, issue **#685** — merged as `bc29d36`,
and the two script fixes in §3½ merged after it. Both are on `main`.)

Record the exact commit SHA you ran — `git rev-parse HEAD` — in your results file. The
fixtures matter, so which commit you ran is part of the answer.

**Do not `supabase link`. Do not set any project ref. Do not touch production
(`qsllyeztdwjgirsysgai`) or preview (`rjyboqwcdzcocqgmsyel`).** The script is destructive by
design — it deliberately makes migrations fail halfway — and it points itself at its own local
container via `--db-url`. If you ever see it about to talk to a hosted project, stop.

---

## 3½. Two defects that voided THREE of the four attempts. Read this or lose an hour.

Both are now fixed in `scripts/experiment_611_db_push_atomicity.sh`. Both used to produce a full
page of `f` result lines, which is **indistinguishable from a clean rollback** — the worst shape a
failure can take. **An absent table with no push is not a rollback.**

**Defect 1 — the two-binary trap ([issue #688](https://github.com/u2giants/shared-db/issues/688)).**
The v2.105.0 linux tarball contains **two** binaries. `supabase` is a **shim**; the real CLI is a
co-located `supabase-go`. Extract only `supabase` and every push dies with:

```text
Could not find the `supabase-go` binary
```

**Fix:** extract the WHOLE tarball into one directory and run the `supabase` from inside it.
Do not copy the single file onto your PATH.

**Defect 2 — TLS.** CLI 2.105.0 **forces TLS** on `--db-url` and **IGNORES `sslmode=disable`**.
A plain `postgres:15` container serves no TLS, so every push dies with:

```text
tls error (server refused TLS connection)
```

**Fix (already in the script):** the throwaway container is given a self-signed cert and
`ssl = on`. This is a **transport-only** change — no fixture, SQL file, or assertion is touched by
it, and it must stay that way, or the experiment stops measuring what it claims to measure.

**Two tripwires in the output. Check both before you believe anything downstream:**

| Line | Must read | If it doesn't |
| --- | --- | --- |
| `container TLS:` (near the top) | `on` | every push will die on TLS; the run is void |
| `CLI preflight:` | `OK` | the script now **aborts** here rather than measuring nothing |
| `ledger rows seeded:` | `424` (or the current migration count) | the ledger seeding did not take; interpret nothing downstream |

The script's step 1b runs one real, harmless CLI command against the throwaway container before
any measurement. It exercises the same binary path and the same TLS connection as every push
below, so a green preflight rules out **both** defects at once. If it fails, the script stops and
tells you which one.

---

## 5. The command

```bash
bash scripts/experiment_611_db_push_atomicity.sh 2>&1 | tee issue-611-run-output.txt
```

That is the whole run. It needs no arguments. It cleans up its own container and temp
directory at the end.

If port `55432` is taken, `PGPORT=55433 bash scripts/…` works. Nothing else should need
changing.

---

## 6. What each fixture is testing

The script seeds the throwaway database's ledger with one row per real repo migration
(currently 424) **before** doing anything else. That is not decoration — it is the single most
important defence in the script. With an empty ledger, `db push` would treat all 424 real
migrations as pending, fail early on unrelated dependencies, and you would spend the run
reading the failure mode of a completely different scenario while everything appeared to work.

Then six fixtures, run as separate pushes:

| Fixture | Shape | What it measures |
| --- | --- | --- |
| **Q3** | one file, two statements, second one raises | Does a file that dies *halfway through itself* roll back statement 1, and does it leave a ledger row? A half-applied file with **no** ledger row is the worst case: the re-push replays it and dies on "already exists". |
| **Q1/Q2** | file A succeeds, file B fails | Does the earlier file stay applied, or is the batch one transaction? And does either file's SQL land without its ledger row? |
| **Q4** | `create table` → `create index concurrently` → failure | **The top finding of the review, raised independently by all three models.** `CREATE INDEX CONCURRENTLY` (like `REINDEX`, `VACUUM`, `REFRESH MATERIALIZED VIEW … CONCURRENTLY`) *cannot* run inside a transaction block. A runner that detects one must either refuse the file or drop into statement-by-statement **autocommit** — and in autocommit a mid-file failure leaves SQL applied with **no ledger row**, exactly the state #611 fears. CLI 2.105.0's detection rule is unknown. **Measure it; do not assert it.** Real licensor/ColdLion batches plausibly contain a concurrent index, so this is not academic. |
| **Q5** | perfectly valid SQL, but a trigger makes the **ledger insert** raise | **The only fixture that proves atomicity instead of inferring it.** Every other fixture fails on the SQL side, so it can never rule out "SQL in one transaction, ledger insert in another". Here the SQL is fine and the ledger insert is blocked. If the SQL **survives**, they do not share a transaction. If the SQL is **gone** *and the log shows the trigger actually raised*, they genuinely do — the log check is not optional, see §7. |
| **Q6** | version `20260601005500`, sorting into the **middle** of the ledger; four statements, all valid | Two things at once. First, **interspersed placement**: Q1–Q4 are versioned `2999-01-01`, later than every real migration, so they only ever test the plain *append* path — while the situation production actually faces is an out-of-order migration, which is the entire reason `--include-all` exists. Second, **multi-statement success**: a one-statement file is trivially atomic and proves nothing. |

---

## 7. How to read the output

The script prints its own `== HOW TO READ THIS ==` block. Read it. In summary:

**Q3 / Q1 / Q2**
- `file A table = t` **and** `file A ledger = t` → per-file atomicity; a failed run leaves
  earlier files applied. The existing recovery rules are correct as written.
- `file A table = f` → the two files behaved as one transaction *in this arrangement*. See the
  warning below before generalising.
- **Any** `table = t` with `ledger = f` → SQL and ledger are **not** atomic. This is the
  dangerous answer.

**Q4** — record all three lines, and record the exact error text if the CLI refuses the file
outright. A refusal is a perfectly good, informative result. What you must not do is skip it.

**Q5 — three lines, and you must read all three together.** This is the fixture whose whole
purpose is *proof* rather than inference, so it is the one place a shortcut cannot stand.

| exception in log | table present | verdict |
| --- | --- | --- |
| `t` | `f` (ledger row also `f`) | **ATOMIC — proven.** The ledger insert was reached, it raised, and the file's SQL went down with it. |
| `t` | `t` | **NOT atomic.** SQL survived a failed ledger insert. This also retroactively demotes every tidy result elsewhere in the run to an artefact (see §8). |
| `f` | anything | **INCONCLUSIVE — not atomic, not anything.** |

The trap in the last row is the important one. It is tempting to read "the table is absent" as
proof of rollback. It is not. An absent table is **equally consistent with the file's SQL never
having executed at all** — the CLI may write the ledger row *before* running the file, or the
push may have died on validation or on the connection before ever reaching it. In that world
nothing whatsoever about a shared transaction was demonstrated.

So the script greps its own captured push output for the trigger's exception text,
`issue611 fixture: ledger insert deliberately blocked`, and prints it as the **first** Q5
result line. If that line reads `f`, the run told you nothing about atomicity: read the push log,
find out why the insert was never reached, fix it, and run again. **Do not report atomicity
from a Q5 that never raised.**

**Q6** — expect the table present, **2 rows**, and a ledger row. Also read the push log itself:
it must list **only** `20260601005500` as applied. If it re-listed all 424 seeded versions,
then `--include-all` is not ledger-filtered and every other conclusion in the run is suspect.

---

## 8. The three specific ways this run produces a confident but WRONG answer

These are not hypotheticals. Each was raised by a different reviewer on the model panel.

**1. Stop-on-first-error mistaken for batch atomicity.** If you see the earlier file rolled
back, the tempting sentence is "a failed 60-file run leaves production unchanged." **That does
not follow.** If `db push` merely *stops at the first error*, files 1..N-1 of a 60-file batch
are already committed and stay committed. A two-file fixture cannot tell "the whole batch was
one transaction" apart from "it stopped early and there was nothing much before it." Read the
push log for files applied and then reverted, not just the final table state.

**2. Wire-protocol masking.** If the CLI ships a whole file as one multi-statement string over
PostgreSQL's *simple query protocol*, PostgreSQL wraps it in one **implicit transaction** all by
itself. The file then looks flawlessly atomic as an artefact of the wire protocol — while
saying nothing whatsoever about where the **ledger insert** sits. Q5 is the only fixture that
separates the two. If Q5 shows SQL surviving a failed ledger insert, the neat Q1/Q2/Q3 results
were masking and the ledger is **not** in the same transaction.

**3. Reporting a conditional result as universal.** Whatever Q1–Q3 and Q6 show is true only for
files the runner **can** wrap in a transaction. Q4 is the counterexample. Write your conclusion
as *"for Supabase CLI 2.105.0, for files containing only transactional DDL, …"* and state the
Q4 answer **separately**. Never write it as a universal law about `db push`.

And the scope line that belongs in every version of the conclusion: **this answers the question
for the CLI version you ran.** Put `supabase --version` output in the file.

---

## 9. What to produce

1. **Edit `docs/verification/issue-611-db-push-atomicity-20260810.md`** — replace the "NOT
   SETTLED" framing with the measured result. Include verbatim:
   - `supabase --version` output (must be `2.105.0`)
   - `docker --version` and the image used
   - `git rev-parse HEAD` for the commit you ran
   - the full `--- Q3 RESULT ---`, `--- Q1/Q2 RESULT ---`, `--- Q4 RESULT ---`,
     `--- Q5 RESULT ---` and `--- Q6 RESULT ---` blocks, unedited
   - the complete raw run log as an attached/committed artifact
     (`issue-611-run-output.txt`) — the push log lines are evidence, not noise
2. **Update `AGENTS.md` §5.1-A**, the HARD GATE, to say the experiment has been RUN, on which
   CLI version, with what answer, and whether the licensor batches are released.
3. **Comment the result on issue #611** and close it, or say explicitly what is still open.
4. Open a PR. This is a docs-only change: no migration, no schema change, no database object.

**Do not paraphrase the numbers.** Paste them. Someone will re-derive the recovery procedure
from this file a year from now.

---

## 10. If something goes wrong

- **The CLI is not 2.105.0 and you cannot install it** — stop and report. A run on another
  version is worse than no run, because it will be remembered as having settled the gate.
- **The push fails with unrelated dependency errors on real repo migrations** — the ledger
  seeding did not take. Check the `ledger rows seeded:` line early in the output; it should
  read 424 (or whatever the current migration count is). If it reads 0, do not interpret
  anything downstream.
- **Docker cannot bind port 55432** — set `PGPORT` to a free port and rerun.
- **Anything at all touches a hosted Supabase project** — stop immediately and report. That
  should be impossible; if it happened, the finding is more important than the experiment.
