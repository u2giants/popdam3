# Making the from-empty contract lane real — measured, 2026-08-11

**Issue #754. PR #759. Green run: 31500417400.**

## The number

| | before | after |
| --- | ---: | ---: |
| migrations that fail a from-empty replay | 66 of 429 | **10** |
| quarantined contract test files | 26 of 40 | **11** |
| files that now genuinely pass | — | **15** |

Nothing was weakened, skipped or deleted to reach that. Every one of the 15 passes
because the object or the row it needed now exists, not because an assertion moved.

## What was actually wrong

The repository was adopted on top of an already-populated database, so a large set of
objects exists in preview and production that no migration here creates. The fix is two
artifacts in `supabase/ci-bootstrap/`, applied only to the ephemeral database in the
runner, in a two-pass replay: pass 1 replays everything and records failures, the
baseline lands, pass 2 re-runs only the failures, then the synthetic seed, then the tests.

**Neither artifact is a migration, and this was a deliberate call.** A file inserted at
the front of an already-applied sequence cannot re-run against preview or production —
their ledgers are years past this point — and a back-dated version is exactly what the
Guard B backdating check exists to stop. No migration version was allocated or used.

## The order the gaps came out, because the order is the lesson

Each round was measured, not guessed. Tables alone were nowhere near enough.

| round | what was added | replay failures |
| --- | --- | ---: |
| 1 | tables, keys, indexes, FKs | 66 → 41 |
| 2 | **functions** | 41 → 11 |
| 3 | **triggers**, function ordering | 11 → 10 |
| 4 | **grants and row security** | 10, and 3 more tests pass |

* Without `public.has_role()` the first reconcile migration aborts, and the eighteen
  migrations downstream of it never create their own tables either. Functions were by far
  the largest single gap and they are the least obvious one.
* Without triggers, `20260723113000` aborts on
  `trigger set_assets_updated_at for table assets does not exist`.
* Without grants, three tests fail on `permission denied` with every object present.
  Access rules are part of the contract, not decoration.

## Three traps worth remembering

1. **The baseline must be the PRE-adoption shape, not today's shape.** A column a
   migration `ADD`s must not already be present, or that migration aborts on
   `column already exists` and, applied in a single transaction, loses every other
   statement in its file. The same holds for indexes, constraints and policies.
2. **A fixture can break a passing test, which is the worst way for a seed to fail.**
   `core.licensor` is `unique nulls not distinct (code)`, so at most one row may have a
   null code. The seed was silently consuming that slot and
   `clickup_task_import_contracts.sql` died on `licensor_code_key`. Every fixture row now
   carries an explicit synthetic code.
3. **Never disable a guard to make a fixture load.** `public.handle_new_user()` refuses a
   signup with no open invitation. The seed creates the invitation and lets the real
   trigger run. A seed that switches off the thing under test is worse than no seed.

## The 11 that remain are three different things, not one backlog

* **4 pinned to a deployed environment or an owner-approved act.** Decisions. Nothing
  committed to this repository can make them true, and seeding them would delete the only
  thing they prove. Two say so at the top of the test file itself.
* **4 downstream of a migration that correctly refuses** without real licensed data — a
  specific Licensor, an authoritative row count in a legacy mirror. The refusals are
  guards working. A synthetic seed may not carry a real licensor or property name, so
  these cannot be closed that way and should not be.
* **3 are tests whose own fixtures contradict the current schema or grants.** These are
  candidate REAL DEFECTS and the most valuable thing this work turned up.
  `db_data_admin_read_contracts` builds a deliberate orphan property with
  `licensor_id = null` to prove orphans are reported loudly, against a column that is now
  `NOT NULL`. It was invisible while the schema was too thin for the test to reach that
  line. Recorded, not edited into passing.

## Safety

No database was written to at any point. The baseline was captured read-only from
production via the Management API query endpoint with `read_only: true`, behind a
SELECT-only guard in the capture script. CI still reaches nothing but the throwaway stack
in the runner: no secret, no project ref, no `supabase link` was added, and the
workflow's own self-check still passes. The quarantine list's two safety behaviours are
intact — a stale entry still fails the job, and a quarantined-but-passing file still
warns. The 15 removals came from that warning, not from anyone's judgement.

Re-capture procedure: `supabase/ci-bootstrap/README.md`.
