# Grok 4.5 adversarial review — PR #608 (A2: rebuilt production apply set + guard fix)

**Reviewer:** Grok 4.5 (`grok-4.5-build`), session `a2-apply-set-review`, two rounds.
**Driven by:** review sub-agent of orchestrator session `5e1ab3af` (marker issue #601).
**Reviewed:** `dedb45e` on `a2-rebuild-apply-set-and-rehearsal`, against `origin/main` `77c15ac`.
**Prior reviewer:** Kimi K3 (findings already folded in). Grok was asked "what did Kimi miss?".
**Nothing was applied, pushed, or merged by this review. Read-only throughout.**

Every finding below was **reproduced against the real `production_migration_guard.py`** before
being recorded. Where the sub-agent's measurement contradicted Grok, Grok's round-2 response is
recorded verbatim in substance.

---

## Blocker (1) — the doc's 49-APPLY set is illegal under AGENTS.md §6.5

**VERIFIED.** `docs/verification/production-apply-set-and-rehearsal-20260809.md` lists rows 32
and 33 — `20260802170000` and `20260802171000` — as **APPLY**.

AGENTS.md §6.5 is a standing **owner ruling** (Albert Hazan, 2026-08-03): *"neither
`20260802170000` nor `20260802171000` may reach production by ANY route until the FR removal work
is ready to go with them … not as part of a wider backlog sweep, not via `--include-all`."*
The single permitted event is one bounded apply carrying both **plus** the removal migrations.

Three verifications by the sub-agent:
- `grep -c "6\.5"` on the rehearsal doc = **0**. The doc never mentions the ruling.
- **No FR removal migration exists anywhere** in `supabase/migrations` (all 411 listed).
- Therefore the §6.5-permitted event cannot currently be constructed, and any allowlist containing
  rows 32/33 leaves production resting at `FR = inactive` — the exact state the ruling forbids.

Static preflight cannot see policy holds, so nothing in the guard catches this. If anyone pastes
the doc's allowlist into the lane, it is a **false ACCEPT of a policy-illegal batch**.

### Mechanism — Grok's answer to "how do you gate it" (round 2, unhedged)

**Not** `HARD_BLOCKED`: that means *never, by any route*, and §6.5 defines a legal future path.
Gating it there would force a guard edit to unlock — the inverted human-slip.
**Not** prose-only: that is how `20260729120000` almost shipped.

**Ship a co-presence bundle in `parse_allowlist`**, the same shape as the existing
all-four-or-none rule. Any allowlist containing either held version must also contain the full
registered FR ship set (both held files plus every FR-removal version, once those files exist).
Until removal versions are registered, any allowlist containing either held version errors with an
explicit §6.5 message. Empty intersection is the current legal state and passes.

---

## Lexer defects in `strip_sql` — real, reproduced, all latent (0 live exposure)

The sub-agent scanned all 411 migrations on `main` for each pattern. **None of these fire on any
file in the tree today.** Grok agreed in round 2 that none blocks merging the guard.

### F1 — `$$` inside an unquoted identifier. Class: High. Direction: **false ACCEPT**. VERIFIED.

`DOLLAR_OPEN_RE` matches the `$$` inside `my$$col`, then latches onto the next genuine `$$` and
blanks everything between.

```
baseline (mycol):   created={plm.t, plm.f}   refs=[(plm.missing_dep,'alter table')]
with    (my$$col):  created={plm.t}          refs=[]        <- hard ref silently lost
```

Exposure: `[A-Za-z0-9_]\$\$` matches **0 of 411** files.
Fix: only treat `$tag$` as an opener at a token boundary (not after `[A-Za-z0-9_]`).

### F2 — CREATE text inside a kept string literal. Class: High. Direction: **false ACCEPT**. VERIFIED.

String literals are deliberately kept (so `'plm.t_id_seq'::regclass` still matches), but
`created_objects` then scans them:

```
select 'create table plm.ghost (id uuid)';   ->  created_objects == {plm.ghost}
```

A phantom object enters `available` and satisfies a later file's dependency that production
cannot meet. Exposure: 2 files contain `'create function'` inside a literal, but that is a
`command_tag` string with no `schema.object`, so **0 phantom objects** are produced today
(both files correctly return `{public.lock_down_new_public_function_execute}`).
Fix: blank string *contents* for the CREATE scan and match regclass in a separate pass over the
unblanked literals.

### F5 — `available` never shrinks on DROP/RENAME. Class: Medium. Direction: **false ACCEPT**. VERIFIED.

`drop table plm.old` in file N yields `created_objects == {}`; a later `alter table plm.old` is
still satisfied from the remote ledger. This is an architectural limit of the preflight, not a
lexer bug.

### F3 — typed literals ending in `e` (`date'2026-01-01'`). Class: **Low / theoretical**. Grok CONCEDED.

Grok initially rated this Medium. The sub-agent measured it:

```
strip_sql("select date'2026-01-01'; create table plm.after (id uuid);")  -> unchanged
created_objects -> {plm.after}    # correct
```

The `E'...'` path only diverges when a backslash appears inside the literal, and a `date`/`time`
constant cannot legally contain one under `standard_conforming_strings=on`. Grok round 2: *"I do
not have a reachable legal input … Your measurement stands: Low / theoretical. Drop Medium."*

### F4 — `$1$` dollar tags. Grok CONCEDED its own fix was wrong.

Grok first said Postgres allows digit-leading dollar-quote tags and the pattern should widen.
Challenged, it withdrew: dollar-quote tags follow unquoted-identifier rules, which cannot start
with a digit. The current `\$([A-Za-z_]\w*)?\$` **matches the real Postgres lexer**.
**Do not widen it.** Recorded so this fix is not re-proposed.

### Confirmed correct under adversarial input

Nested `/* /* */ */`, doubled `''`, `E'it\'s'`, quoted identifiers containing `--` or `$$`,
`$1` parameters, a lone `$` in `my$var`, unterminated `$$` at EOF (does not eat the file),
`U&'…'`. Kimi's two cases have regression tests. The single-lexer rewrite is a **strict
improvement** over the three-pass predecessor, which was destroying real DDL in 8 of 411 files
including the already-applied `20260727154500`.

---

## Q2 — `20260729120000` in `HARD_BLOCKED`: Grok says the reasoning holds and the mechanism is right

Grok accepted every leg: the narrower body regresses a live control; it sorts below the already
applied `20260729180000`, which will never re-run to repair it; and the old "it would abort on a
missing `sync_clickup_tasks`" escape is correctly demolished, because in the full backlog
`20260728174500` (row 13) creates those functions before row 15 runs.

`HARD_BLOCKED` is the right *primary* mechanism — soft omission is one doc slip from re-inclusion,
and this is "must never apply", the same class as the Master Data pair.

**Two caveats Grok added, both open:**

1. `HARD_BLOCKED` only guards this script's allowlist path. A full-tree
   `supabase db push --include-all` on an unguarded checkout still has the harmful body on disk.
   Grok sides with Kimi: **also neutralize the file itself** (the file was never applied, so §4's
   "never edit an applied migration" does not bind it).
2. **Re-verify the md5 claim on live production at promote time, not from the doc.** Specifically:
   `get_project_url` first; full `prosrc` equality (not md5 alone) after CRLF normalisation;
   `pg_event_trigger.evtags` contains **both** `CREATE FUNCTION` and `CREATE PROCEDURE`; the
   `public` default-privileges row matches the `20260729130000` claim; and `20260729120000` is
   provably **absent** from `schema_migrations`.

---

## Q3 — the `--include-all` contradiction: AGENTS.md §5.1 wins, plan constraint 4 is shorthand

`plan_orchestrator-workflow-gaps.md` constraint 4 says "Never `--include-all` against production."
Its own body explains why: unbounded, it would sweep 33 unreviewed migrations in. AGENTS.md §5.1
is the **later and more precise** rule: the prohibition is on `--include-all` against the **full
repo set**, "never against a verified bounded set". Grok and the sub-agent agree: §5.1 governs;
constraint 4 is incomplete shorthand and **its text should be corrected**, so an owner gate never
reads "49 without `--include-all`" — which would authorize something impossible (33 of the 50 sort
below the ledger head and the CLI refuses them without the flag).

`prepare()` builds a checkout whose on-disk set is exactly `remote ∪ allowlist` and asserts
`remaining == expected`, so the flag cannot reach a non-allowlisted file. That mechanism is sound.

**What would have to be true for it NOT to be safe** — Grok's attack list, unverified by the
sub-agent but plausible on inspection:

1. **TOCTOU (High).** The ledger is read at `prepare` and never re-read at `db push`. A concurrent
   promotion, or manual SQL against `schema_migrations`, makes the bounded set stale.
2. **Only names are compared, never content.** `expected = set(migrations) & keep` matches
   versions, not bytes; the same version with different content at `commit_sha` would push
   unreviewed SQL.
3. **The retirement of `20260729120000` is enforced only by this pruning.** Anyone running the CLI
   on a hand-copied tree loses it.
4. A remote version absent locally fails closed (CLI aborts) — safe.

**Minimal hardening:** re-parse the ledger and re-stat the migrations directory immediately before
push and fail on any difference; pin file digests for allowlist versions; require `verify-dry-run`
on the `--include-all` dry-run output inside the same job.

---

## Q4 — partial promotion. Named in the PR, not mitigated. Still the largest open risk.

`supabase db push` wraps each **file**, not the batch. A data-dependent assertion failing at file
45 of 50 leaves production partially promoted with no undo, on a database five apps share. The
PR's own doc concedes the dry-run executes no SQL.

**Grok's ranked mitigation:**

| Rank | Mitigation | Necessary? |
|---|---|---|
| 1 | **Whole-batch rehearsal on a production-shaped DB** — prod clone, apply the exact set in order in the same bounded tree | **Necessary. Hard gate before A4.** |
| 2 | **Split into resume-safe sub-batches** on dependency-closure + owner-hold boundaries, decided *after* rehearsal | **Necessary** (blast radius) |
| 3 | **Pre-apply restore point** — UTC noted, PITR retention confirmed to cover the window, restore drill written down | **Necessary** safety net |
| 4 | Read-only data preflight against live prod for every `DO` / `raise exception` / seed assumption | Nice-to-have, not sufficient alone |
| 5 | Reordering for pure DDL deps | Already done; do not reshuffle for theater |
| 6 | One transaction for all 49 | **Do not ship** — the CLI cannot, and the locks would be brutal |

**Where the rehearsal must run (round 2, explicit):** **not** on preview `rjyboqwcdzcocqgmsyel` —
it is a shared mutable resource other sessions use, and a prod restore would overwrite their
objects and mix production data into a shared lab. Use a **throwaway** target: a temporary branch
created from production, a one-off project, or a local Postgres restored from a fresh prod dump,
applied once, then destroyed.

**And a DDL-only rehearsal does not clear the risk it exists to clear.** The files that can fail
mid-batch fail on *row contents* (alias approvals in `20260731220000`, the FR update in
`20260802171000`, the size/depth seeds). A rehearsal proves those only if the schema matches the
prod ledger head **and** the data is a recent prod clone — or if each assertion's predicate is
probed read-only against live production before apply.

**Resume procedure after a mid-batch failure:**
1. Prove the target (`get_project_url` = `qsllyeztdwjgirsysgai`) before anything else.
2. `select version from schema_migrations where version = any($allowlist) order by 1`. The ledger
   **is** trustworthy for completed files, because each file is its own transaction and the failed
   file rolls back.
3. The failed version is the first allowlist version not in the ledger; confirm its objects by hand.
4. New allowlist = the remaining suffix only. Re-run preflight **and** a segment rehearsal from
   that point against a clone of *current* production, not the pre-batch clone.
5. **Do not** run `migration repair --status reverted` to "tidy up".
6. Verify per file that nothing ran non-transactionally (`CONCURRENTLY` etc.) before trusting the
   ledger; none is obvious in this set, but it must be checked, not assumed.

---

## Where the two sides moved

- **Grok moved:** F3 Medium → Low/theoretical, on the sub-agent's measurement. F4's proposed fix
  withdrawn entirely as factually wrong about the Postgres lexer.
- **Grok moved:** from an unqualified "do not merge" to "merge the guard+tests half; F1/F2/F5 are
  follow-ups, not blockers", once shown the 0-of-411 exposure scan.
- **The sub-agent moved:** accepted the §6.5 blocker, which it had not found on its own, and
  accepted F1/F2/F5 after reproducing all three.
- **Unresolved by agreement, not by disagreement:** the partial-promotion mitigation is design work
  neither reviewer can close from inside a review.

## Verdict

**Merge the guard and tests. Do not treat the rehearsal doc's 49-APPLY list as an approved
production allowlist.** Rows 32/33 must be held out (ideally by a coded co-presence rule) and the
doc must name §6.5, before any allowlist derived from it goes near production.
