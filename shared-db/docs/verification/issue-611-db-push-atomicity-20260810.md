# Issue #611 — is `supabase db push` atomic? **NOT SETTLED.**

**Date:** 2026-08-10 · **Session:** sub-agent of orchestrator `52cd0e78`, marker #660

---

## The answer, in one line

**We do not know, and this document does not pretend to.** The experiment is written, reviewed
and committed at [`scripts/experiment_611_db_push_atomicity.sh`](../../scripts/experiment_611_db_push_atomicity.sh).
It has **not been run**.

## Why not

The machine this work was done on (`al8960ofc`, Windows 11) has **no Docker, no WSL, and no
startable PostgreSQL server**.

> **Correction (2026-08-10).** An earlier version of this section claimed `psql`, `pg_ctl` and
> `initdb` were "(not found)". That was wrong in both directions, and the correct facts matter
> to anyone deciding where to run this:
>
> ```text
> docker => not installed        psql   => PRESENT  (C:\Program Files\PostgreSQL\17\bin)
> wsl    => not installed        pg_ctl => PRESENT
>                                initdb => PRESENT
> ```
>
> The binaries **exist**, and yet **no server can be started**, because the install is
> **client-only**: there is no `share\` directory, so `initdb` fails on a missing
> `postgres.bki`, and a whole-machine search for that file returns **zero hits**. Having
> `psql` on PATH is therefore not evidence that a machine can host this experiment. The
> question to ask a candidate machine is "can it run `docker run --rm hello-world`", nothing
> else.

The only databases reachable from this session were **production** `qsllyeztdwjgirsysgai` and
**preview** `rjyboqwcdzcocqgmsyel`. Neither is usable:

- Production is out of scope for this work, and the experiment is **destructive by design** —
  it deliberately makes migrations fail halfway.
- Preview is a **shared, mutable resource holding a production data clone**. Other sessions
  rehearse against it. Deliberately failing migrations there would corrupt their work.

Provisioning a throwaway cloud project was not attempted: it spends money and creates a real
resource, which is the owner's call, not a sub-agent's.

## Why an answer was NOT invented

One recent plan's reviewer asserted this as settled fact, was challenged, and retracted —
dropping that plan's stated confidence from 85% to 30%. The correct output here is a runnable
experiment plus an honest "unknown", not a confident guess.

## What the answer changes

It decides what a run that **dies partway** leaves behind, which is the entire basis of the
one-directional co-presence recovery rules in
[`scripts/production_migration_guard.py`](../../scripts/production_migration_guard.py).

| If the experiment shows | Then |
| --- | --- |
| Per-file atomicity (earlier files stay applied) | The recovery rules are correct exactly as written. This is the assumed case. |
| The whole batch is one transaction | A failed run leaves production unchanged; the recovery case cannot arise. Keep the rules (they cost nothing) but soften their urgency wording. |
| SQL commits without its ledger row | **The dangerous case.** A re-push re-runs an already-applied file and fails on "already exists". Say so loudly in AGENTS.md and redesign the recovery procedure. |

## Hardened 2026-08-10 (issue #685) — the original three questions were NOT enough

A three-model panel (Grok `grok-4.5-build`, Kimi `kimi-code/k3`, GLM `glm-5.2`) reviewed the
methodology and converged independently on one conclusion: the experiment as first written only
tested migrations made of **plain transactional DDL**, so it could report "atomic" while the
dangerous case stayed untested. Three fixtures were added — **Q4** non-transactional DDL,
**Q5** the inverse (ledger-insert) failure, **Q6** interspersed placement with a multi-statement
success. Full findings: the panel comment on issue #611.

**Read [`issue-611-run-brief.md`](issue-611-run-brief.md) before running.** It is the
self-contained instruction set for the machine that will do the run, and it names the three
specific ways this experiment yields a confident but wrong answer.

## The three questions the script answers

1. Do a migration's SQL and its `schema_migrations` row commit together?
2. When file 2 of 3 fails, is file 1 rolled back or does it stay applied?
3. **The one people forget:** when a *single* migration fails **halfway through its own SQL** —
   statement 1 succeeds, statement 2 raises — is statement 1 rolled back, and is a ledger row
   left behind?

## The trap the script already avoids

The disposable database **must carry a realistic `supabase_migrations.schema_migrations`**.
With an empty ledger, `db push` treats all ~423 repo migrations as pending, fails early on
unrelated dependencies, and you end up reading the failure mode of a completely different
scenario while the script appears to work. Step 3 of the script seeds one row per repo version
(the rows are fake; their *presence* is what makes only the fixture files pending) precisely so
the run has the shape of a real bounded apply.

## How to finish this

On any machine with Docker **and Supabase CLI pinned at 2.105.0** — follow
[`issue-611-run-brief.md`](issue-611-run-brief.md), which is written for a fresh agent with no
knowledge of this repo:

```bash
bash scripts/experiment_611_db_push_atomicity.sh 2>&1 | tee issue-611-run-output.txt
```

Paste all five result blocks (`Q3`, `Q1/Q2`, `Q4`, `Q5`, `Q6`) plus `supabase --version` and the
commit SHA into this file, replace the title, and update the §5.1-A HARD GATE in `AGENTS.md`.
It should take under twenty minutes.
