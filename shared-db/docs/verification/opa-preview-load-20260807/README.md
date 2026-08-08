# Disney OPA extract — FIRST REAL `--apply` INTO PREVIEW

**Date (UTC):** 2026-08-07
**Issue:** [#581](https://github.com/u2giants/shared-db/issues/581) · **Claim:** #589 · **Orchestrator marker:** #587
**Follow-up opened:** [#593](https://github.com/u2giants/shared-db/issues/593) (wire the link-state check into the remaining 14 call sites)
**Target:** PREVIEW `rjyboqwcdzcocqgmsyel`. **Production `qsllyeztdwjgirsysgai` was never contacted.**
**Machine:** al8960ofc · **Agent:** Claude (Opus 5) sub-agent

> **NO MIGRATION WAS CREATED.** Preview's ledger is 405 rows / max `20260807200000` before
> and after — see `evidence/07`. This was a *data load* plus *tooling*. No table, view,
> function, policy, constraint, index or grant was altered.

**Every figure below is backed by command output in `evidence/`.** Nothing in this
document is typed from memory. Where a number here disagrees with an evidence file,
**the evidence file wins.**

Two kinds of file, labelled honestly because precision about one's own evidence is the
point of the artifact:

- **Verbatim** — the file is the redirected output of the session, prompts and all.
- **Transcribed** — the commands were really run and the outputs are their real outputs,
  but the `$ ` prompt lines are hand-written labels, so the file is not a raw terminal
  capture.

| Evidence file | Kind | What it shows |
|---|---|---|
| `01-source-file.txt` | transcribed | byte count, line count, sha256 of the extract |
| `02-dry-run.txt` | transcribed | dry run against the real extract |
| `03-runner-guards.txt` | transcribed | the two runner-side guards, provoked |
| `04-wrong-target-gate.txt` | **verbatim** | the wrong-target gate, provoked |
| `05-load-before-and-after.txt` | **verbatim** | **mirror cleared → reloaded**: genuine 0 → 10,261 |
| `06-idempotence-and-shrink-band.txt` | **verbatim** | re-entrancy, and the database shrink band rejecting a truncated extract |
| `07-object-and-negative-assertions.txt` | **verbatim** | objects, ledger, and every negative assertion |
| `08-which-file-does-the-cli-follow.txt` | **verbatim** | the three experiments that decided which `.temp` file the CLI obeys |
| `09-checker-behaviour.txt` | transcribed | the committed check run against the real trap bytes |
| `10-tests.txt` | **verbatim** | the test suites |
| `11-what-supabase-link-writes.txt` | **verbatim** | before/after proving `supabase link` never touches `linked-project.json` |

---

## 1. What this proves

The `--apply` path — the one thing issue #581 listed as **NOT proven**, because it had
only ever run against invented fixtures. All four of its previously-unexercised guards
were made to **fire for real**, and the mirror was **cleared and reloaded from empty** so
the before/after is measured rather than remembered.

---

## 2. OWNER RULING, 2026-08-07 — the sentinel row is FILTERED OUT

Albert's ruling: Disney's sentinel row must **not land in the mirror at all**.

**What it is.** The 2026-08-06 extract contains exactly one row whose IDs are negative —
`licensedPropertyID = -9999`, `characterID = -9998`, at **file line 8640**. Every other ID
runs from 38 to 1,159,383,366. It is not a real licensed property.

**The rule implemented — general, not the specific pair.** A row is rejected when
**`licensedPropertyID < 0` OR `characterID < 0`**. The specific values are *not*
hard-coded: a magic-number test would rot the moment Disney picks different sentinels,
and this shop's standing rule is that nothing is hard-coded which should be a rule.
The comparison is strictly `< 0`, so **ID `0` — the smallest legitimate ID — is kept**.

**Filtered at load time, in the loader** (`tools/sync-opa-property-character.mjs`), not by
a one-off `DELETE`. A `DELETE` would fix today's rows and let the next refresh
re-introduce the sentinel; this is now a permanent property of the loader.

**Counted and reported loudly.** Silent filtering is a silent failure. The runner prints
both the JSON counts and a plain-language line, and warns explicitly if more than one
sentinel appears, since the 2026-08-06 extract had exactly one:

```
"rows_read": 10262,
"rows_rejected_sentinel": 1,
"rejected_row_ordinals": [8640],
"rows": 10261,

SENTINEL ROWS DROPPED: 1 of 10262 data row(s) had a NEGATIVE licensedPropertyID or
characterID and were NOT loaded (owner ruling 2026-08-07). Row ordinal(s): 8640.
10261 row(s) will load.
```

Only **row ordinals** are reported, never IDs or names — the same rule as everywhere else
in this loader, because its output reaches public CI logs.

**One deliberate non-change.** The CSV parser still **accepts** negative integers. That is
load-bearing: if parsing rejected a leading minus, the sentinel would abort the entire run
instead of being counted, and a future change in Disney's sentinel scheme would be
invisible. Parse permissively, reject deliberately, count what was rejected.

**A prior design decision was reversed here, deliberately.** The loader previously carried
the comment *"Disney uses NEGATIVE SENTINELS (the 'Special Projects' node). Integers here
must accept them; any unsigned parsing silently drops that row"*, and a test asserted the
sentinel **must survive**. That test has been replaced. The parse-level acceptance was
kept for the reason above; only the *loading* of the row was reversed.

**The row floor now counts rows that LOAD, not rows that were READ.** `OPA_MIN_ROWS` is
compared against survivors. Otherwise the sentinel rule would silently consume one row of
the operator's safety margin. A floor of 10,262 now correctly fails; 10,261 is the true
count.

### Effect on the numbers

| | Before ruling | After ruling |
|---|---:|---:|
| Rows loaded | 10,262 | **10,261** |
| Distinct properties / reconciliation nodes | 1,445 | **1,444** |
| Distinct characters | 9,613 | **9,612** |
| Distinct name pairs | 10,240 | 10,239 |
| Name-pair collisions | 22 | **22** (unchanged) |
| Rows with a negative ID in the mirror | 1 | **0** |

**1,444 nodes — exactly the predicted figure.** `evidence/05` and `evidence/07`.

---

## 3. Exact versions in effect

All five were **already applied** to preview and were **not modified**:

| Version | Role |
|---|---|
| `20260807170000` | landing table `plm.opa_property_character`, view `api.opa_property_character` |
| `20260807170100` | `plm.sync_opa_property_character(jsonb, text, numeric)` |
| `20260807180000` | re-entrancy fix |
| `20260807190000` | RLS to the `erp_` posture; reconciliation view regrouped to node grain; NULL-safe shrink band |
| `20260807200000` | `coalesce(...,'{}')` + stable `ORDER BY` on the view's arrays |

Ledger before and after: **405 rows, max `20260807200000`, all five present**
(`evidence/07b`).

## 4. Exact source file (`evidence/01`)

| Property | Value |
|---|---|
| Repository | `u2giants/licensor-source-data` (**PRIVATE**), `disney-opa/opa-characters.csv` |
| **Bytes** | **1,069,881** — matches the recorded size exactly |
| **SHA-256** | **`333a1c04ea2da5a678da3527ee9a28b503cb6c16af94dbd902e10fbe776a5d69`** — matches `BUILD-NOTE-20260807.md` exactly |
| Lines | 10,263 (1 header + 10,262 data). `wc -l` reports 10,262 because it counts newlines and the final line has none — both describe the same file. |

`Accept: application/vnd.github.raw` is **required**: `gh api` returns an empty body for
`contents/` files over 1 MB. Fetched to scratch, **never written into this PUBLIC repo**.

---

## 5. Row counts — BEFORE and AFTER (`evidence/05`)

The mirror was **cleared and reloaded** so this is a genuine measurement:

```
5a. before clearing (pre-ruling load):  rows 10262, props 1445, chars 9613, negative_id_rows 1
5b. after DELETE:                       rows_now 0
5c. load:  rows_seen 10261, rows_inserted 10261, rows_updated 0, rows_unchanged 0
5d. after: rows 10261, props 1444, chars 9612, negative_id_rows 0, recon_nodes 1444,
           core_pc 0, core_char 0
```

| Table / view | BEFORE | AFTER |
|---|---:|---:|
| `plm.opa_property_character` | **0** | **10,261** |
| `api.opa_property_reconciliation` | 0 | **1,444** |
| `core.property_character` | **0** | **0** |
| `core.character` | **0** | **0** |
| migration ledger | 405 | 405 |

---

## 6. Behavioural, object and NEGATIVE assertions (`evidence/06`, `evidence/07`)

**Objects, not just data** — `to_regclass` → both present; `relrowsecurity` → **true**;
policies → **1**; PK → `PRIMARY KEY (licensed_property_id, character_id)`.
`pg_get_viewdef` was compared against `20260807200000` and matches: **no schema drift.**

**Node grain holds.** 1,444 distinct nodes → view returns **exactly 1,444 rows**, and
`sum(opa_character_count) = 10,261` — every loaded row accounted for exactly once.

**The ID pair is the real key.** 10,261 rows inserted with zero conflicts. The *name* pair
is not unique: 10,239 distinct pairs → **22 collisions**.

**Idempotence.** A second identical apply: `rows_inserted 0, rows_unchanged 10261`,
identical `snapshot_hash 87247b59…`.

**Every negative assertion returned 0** (`evidence/07c`): non-existent node
`-999999` → 0 rows; **sentinel rows surviving → 0**; nodes claiming a core match → 0;
nodes not `unresolved` → 0; nodes with `last_resolved_at` → 0; count mismatches → 0;
resolved rows → 0.

**The array contract of `20260807200000`** (`evidence/07e`): `'{}'` for all 1,444, NULL for
none. This *confirms* the corrected view comment. Its discriminator stays sound — an
unresolved node has an **empty** `matched_core_property_ids`, so it cannot be mistaken for
RLS suppression. Under the pre-`20260807200000` wording ("non-null") all 1,444 unresolved
nodes would have satisfied the RLS-suppression test. **That correction is load-bearing.**

### The four guards, provoked for real

| Guard | Provocation | Result | Evidence |
|---|---|---|---|
| Wrong-target gate | expected ref = **production**, URL = preview | exit 1, `NOTHING HAS BEEN SENT` | `04` |
| `OPA_MIN_ROWS` floor | demand 10,263 | exit 1 | `03a` |
| `OPA_MIN_ROWS` mandatory | omitted with `--apply` | exit 1 | `03b` |
| **Database shrink band** | truncated 1,000-row extract, runner floor lowered so **only the database** could catch it | **HTTP 400, rolled back, mirror intact at 10,261** | `06b`, `06c` |

The wrong-target test was arranged so the only possible failure mode still wrote to
preview. The shrink-band test is the strongest: it is the guard protecting against a
truncated refresh, and it had never run against a real database before today.

---

## 7. The link-state inconsistency — CORRECTED ACCOUNT

> **An earlier version of this document said the old check "passed while the CLI would
> have targeted production." THAT WAS WRONG.** It was an inference, not a measurement.
> It is corrected here by experiment (`evidence/08`). The lesson is recorded rather than
> quietly edited away, because this file is the canonical record of the incident.

### 7.1 What was actually observed

```
supabase/.temp/project-ref          ->  rjyboqwcdzcocqgmsyel   (PREVIEW)
supabase/.temp/linked-project.json  ->  qsllyeztdwjgirsysgai   (PRODUCTION)
```

### 7.2 What was measured (`evidence/08`)

Three experiments, all against preview or a non-existent ref, **never production**:

| # | Setup | Result |
|---|---|---|
| A | real `project-ref` (preview) + **bogus** `pooler-url` | CLI tried `db.rjyboqwcdzcocqgmsyel.supabase.co` — **ignored the pooler URL** |
| B | **bogus** `project-ref` + real preview `pooler-url` | CLI tried `db.zzzz…zzzz.supabase.co` — the valid pooler URL **did not redirect it** |
| C | both consistent (preview) | connected; migration list returned |

**Conclusion, measured:**

- **`project-ref` DECIDES THE PROJECT.**
- `pooler-url` is the connection **route**, used when it agrees. The ref hides in its
  **username** (`postgres.<ref>`), not its host — a reader scanning the host finds nothing.
- `linked-project.json` is **not written by `supabase link` at all**. `supabase link`
  creates `project-ref` and `pooler-url` only. **Isolated by its own before/after
  experiment** (`evidence/11`): a `linked-project.json` planted with an unrelated ref
  survived a `supabase link` **byte-for-byte**, so a stale one outlives any number of
  re-links.

**Therefore the old `cat supabase/.temp/project-ref` check was RIGHT about where the CLI
would go**, and the production-named `linked-project.json` was **orphaned state from a
different tool** — not a CLI wrong-target trap.

### 7.3 The risk is real anyway, and it is CROSS-TOOL

The tool that *does* read `linked-project.json` is the Supabase editor extension / MCP
tooling — and on this machine `get_project_url` returned the **production** project and
accepts no project parameter. So the two halves of one checkout genuinely pointed at two
different databases: **the CLI at preview, the MCP at production.** An agent that checks
one and acts through the other is the hazard, and **no single-file check can see it**.
Because `supabase link` never touches that JSON file, **no amount of re-linking would ever
have corrected it** — any future "just re-link to fix the link state" instruction is wrong.

### 7.4 What was done — and what is NOT yet fixed

**NOT "repaired".** Deleting one untracked `supabase/.temp/` fixed one directory on one
machine at one moment. It is gitignored and will not survive a fresh clone, and nothing
stops the editor extension from writing a stale `linked-project.json` again tomorrow.
**Treat this as OPEN, not handled.**

What actually exists now:

1. **`tools/check-supabase-link-state.mjs`** — a fail-closed gate over **all three** files.
   The expected ref is a **required input with no default**. `linked-project.json` and
   `pooler-url` are **optional but must agree when present** — failing on their absence
   would cry wolf on every correctly linked checkout, and a check that cries wolf gets
   skipped. It **never prints the pooler URL**, which can carry the database password
   (proved in `evidence/09b`).
2. **`--root=<path>`** — this repo runs an agent-per-worktree model, so several checkouts
   exist side by side, each with its own `supabase/.temp/`. Without this, invoking the
   script by absolute path from another worktree silently validates the **wrong** checkout
   and prints a confident green. The checkout actually validated is always printed.
3. **`tools/check-supabase-link-state.test.mjs`** — 39 tests, auto-wired into CI by the
   existing `tools/*.test.mjs` glob in `tools-offline-tests.yml` (no `paths:` filter).
4. **One call site wired**: the production target gate in
   `coldlion-licensor-property-production.yml`, immediately after its `supabase link`.

### 7.5 Wiring it in opened a bypass, which review caught before it shipped

The production workflow has a contract requiring **every** `node tools/*.mjs` call to
carry the four-part write authorization. The link-state checker is a read-only guard, so
it legitimately cannot carry those flags. The first fix exempted it — and the exemption
itself was exploitable:

- the call matcher ran **greedily to end of line** and `matchAll` does not overlap, so
  **two invocations on one line collapsed into a single "call"**;
- the exemption was a **substring test** over that combined text.

Together: `node tools/check-supabase-link-state.mjs … && node tools/sync-coldlion-licensors-properties.mjs --apply`
parsed as **one** call containing the guard's name, so the **write runner inherited the
read-only exemption** and skipped authorization entirely. **A single `&&` would have
defeated the gate.** Verified directly — under the old matcher that input yields
1 parsed call, all of it exempt; under the new one it yields 2, with the write runner
correctly non-exempt.

Fixed by parsing **per invocation** and keying the exemption on the **script name
actually invoked**, never on surrounding text. Pinned by regression tests in both the
contract test and the runtime readiness checker, plus a decoy case where the guard's name
merely appears nearby in an `echo`. The exemption remains paired with a hard refusal of
`--apply`, so it cannot become a hole in the other direction.

Nothing here ever ran against production: the production lane is gated off pending Step 8.

**Still unwired — 14 call sites, tracked in [#593](https://github.com/u2giants/shared-db/issues/593):**
2 workflows, 11 tools, and `AGENTS.md` (2 places) still use the single-file
`cat supabase/.temp/project-ref`. A guard nobody calls protects nothing; the issue exists
so this cannot be forgotten.

**Not established:** whether a **valid** `pooler-url` naming a different project can
actually redirect the CLI. Testing that would have required pointing a connection at
production, so it was **not done**. The checker rejects a mismatched `pooler-url` anyway,
as defence in depth.

---

## 8. Tests (`evidence/10`)

| Suite | Result |
|---|---|
| `tools/sync-opa-property-character.test.mjs` | **51 / 51** (45 before, +6 for the sentinel rule and the row floor) |
| `tools/check-supabase-link-state.test.mjs` | **39 / 39** (new) |
| `tools/coldlion-licensor-property-production-workflow.test.mjs` | **17 / 17** (+2: the exemption-bypass regression and a decoy-text case) |
| `tools/coldlion-production-lane-readiness.test.mjs` | **17 / 17** (+3: the same bypass at runtime, `--apply` abuse, and the real workflow passing) |
| **Whole `tools/*.test.mjs` glob (what CI runs)** | **591 / 591 pass, 0 fail** |

Sentinel coverage is deliberately **both directions**, because the obvious way to get a
threshold rule wrong is at its boundary:

- **positive** — a sentinel row is dropped, counted, and located by ordinal;
- **negative (boundary)** — **ID `0` is NOT dropped**;
- **negative** — a row is dropped if *either* ID is negative, not only when both are;
- **rule not magic number** — a different sentinel pair (`-4242`/`-777`) is also dropped;
- the parser still **accepts** negatives, so a sentinel is filtered rather than fatal;
- the row floor counts **loadable** rows, not rows read.

---

## 9. What was NOT done — deliberately

- **No production contact.** Nothing read from or written to `qsllyeztdwjgirsysgai`. The
  Supabase MCP is bound to production and takes no project parameter, so it was **not
  used**; every database call went through the Management API with the preview ref **named
  in the request path**.
- **No migration**, no promotion, no `main` push, no self-merge.
- **No resolution run.** `core.property_character` and `core.character` are still **0**.
  Mapping OPA nodes onto `core.property` is separate work.
- **No CSV committed.** No row of Disney data appears in this document, in `evidence/`, in
  any loader output, or in any error message. All evidence files were scanned against the
  live credential values and the common secret shapes: **no leaks**.
- **`OPA_SOURCE_URL` snag NOT resolved** (#581 snag 1). The load used the bare page URL, so
  `source_url` records *which page*, not *which slice*. All 10,261 rows carry one identical
  `source_url` and one `line_of_business` (`Home`); **a second LOB extract would be
  indistinguishable by `source_url` alone.** Still needs the owner decision #581 calls for.
- **Bare-quote CSV rule still unexercised** (#581 snag 2). Disney's exporter quotes every
  field and the file has zero embedded quotes. Still luck, still untested. Re-run the dry
  run on every refresh — it contacts no database.

---

## 10. Findings

1. **`supabase link` does not write `linked-project.json`** (§7.2). Root cause of the
   inconsistency, recorded nowhere else, and it invalidates any "re-link to fix it" advice.
2. **The ref in `pooler-url` hides in the username**, not the host (§7.2). A third file
   that names a project and that a host-scanning reader would miss entirely.
3. **The sentinel row is real and was silently inflating counts** — now filtered by owner
   ruling (§2). Anyone who had counted "Disney properties" off the pre-ruling mirror would
   have been off by one.
4. **The `20260807200000` array `coalesce` is load-bearing, not cosmetic** (§6).
5. **A prior deliberate decision was reversed** (§2): the loader used to be documented and
   tested to *keep* the "Special Projects" sentinel.

Nothing measured **contradicts** issue #581's predictions; the row/property/character
totals differ from it only by the one sentinel row the owner ruled must be removed.
