# ORCHESTRATOR HANDOVER — session 511f124e — al8960ofc — 2026-08-10T21:10Z

**The headline: production was written to for the first time in this repo's history, twice.
The canary `20260810140000`, then batch B1 (11 migrations). The ledger moved 361 → 362 → 373.
The #611 hard gate is discharged by an executed experiment. 53 migrations remain.**

**The one thing that blocks the next batch: the post-apply catalog verification returns
HTTP 403 from the Management API (#709). B1 is applied but has NO catalog evidence.**

---

## 0. If you read nothing else

1. **B1 IS APPLIED.** Run 31430916078 shows `failure`, and that is misleading — the
   `Fresh dry-run, then apply` step **succeeded**. Only `Post-apply catalog verification`
   failed, on a 403. Verified from the after-ledger artifact: **373 applied rows**, all
   eleven B1 versions present. **Do not re-apply B1.** `validate_candidates` refuses any
   allowlist containing an already-applied version.
2. **Fix #709 before dispatching B2**, or every remaining batch finishes red with no
   evidence.
3. **Do not soften the hard-fail** in `scripts/production_catalog_verification.py`. It
   refused to go green without evidence, which is exactly what #697 asked for.
4. **Every count in any document is suspect.** Four different backlog figures circulated
   today (44/47/61/63) and all were wrong. Re-derive from `git`/`gh`.

---

## 1. Coordination state (half a)

**Re-verified 2026-08-10T21:10Z:**

```
main tip SHA:            55b0d66fefec4b532cfc9c9f32ccf5cd3b55f126
max migration version:   20260810170000
open PRs:                NONE
open db-claim issues:    NONE
orchestrator marker:     #684 (mine — closed at the end of this handover)
production ledger:       373 applied   (was 361 at session start)
production remaining:    53 promotable
preview ledger:          425
```

**Preview state — NOT clean, and this is normal.** Preview is `main` plus
`20260810160000` and `20260810170000`, **minus the canary `20260810140000`**, which is
deliberately never applied there. It holds a full production data clone. Two migrations
were applied to it this session, each by a dedicated agent, each verified by catalog and
by behaviour, each leaving no test rows (all fixtures inside rolled-back transactions).

**File ownership at handover: NOBODY owns anything.** All claims are closed.
`supabase/migrations/`, `AGENTS.md`, `HANDOFF.md`, the workflow and the guard are all free.

**Blocked on Albert:** see §6. The live ones are #709 (the 403), and five of the seven
owner decisions in `docs/production-promotion-app-tolerance-contract.md` §8.

---

## 2. What was accomplished

### Production, for the first time ever
- **Canary `20260810140000`** promoted (#677, closed). Proved the lane end to end, and
  proved `verify_dry_run` works — **its first ever successful execution in this repo**.
  It matches the literal string `Would push these migrations:` and is coupled to Supabase
  CLI **2.105.0**. v2.113.0 exists. **Do not upgrade the CLI casually.**
- **The human gate is real.** It held for 21 minutes both times and was approved by the
  owner, not bypassed. Note `can_admins_bypass` is `true` (his decision, #644) and agent
  tokens authenticate as `u2giants`, an admin — so the audit trail alone cannot
  distinguish his click from an admin's. Agents were instructed not to self-approve and
  did not.
- **Batch B1 applied**: `20260724060000, 20260724061000, 20260726030000, 20260726031000,
  20260726032000, 20260726180000, 20260727221500, 20260727223000, 20260727224500,
  20260727230000, 20260728134500`.

### The #611 gate — discharged by an executed experiment (closed)
Ran on the **hetz VPS** under Docker on pinned CLI 2.105.0. Both binary sha256s recorded.
**Answer: SQL and ledger row ARE one transaction PER FILE — but NOT per batch.** A run
dying on file 40 leaves files 1-39 applied and ledgered. Recorded in `AGENTS.md` §5.1-A
and `docs/verification/issue-611-db-push-atomicity-20260810.md`, with the full 671-line
run log committed.

**Three of four attempts were VOID**, and both causes render every result `f`, which is
indistinguishable from a clean pass:
- The v2.105.0 tarball ships **two binaries** that both report `2.105.0`; `supabase` is a
  shim forwarding to `supabase-go`. Extracting only the shim breaks every push (#688).
- CLI 2.105.0 **forces TLS on `--db-url` and ignores `sslmode=disable`**; plain
  `postgres:15` serves no TLS.
The committed script now has a step-1b preflight that catches both loudly.

**`CREATE INDEX CONCURRENTLY` cannot be pushed at all** under this CLI (SQLSTATE 25001,
whole file rolls back). A scan of all 426 migrations found **zero** occurrences, twice,
independently. The promotion plan is unaffected; it is now an authoring prohibition.

### Work merged (all with independent review; two rounds where High findings were found)
- **#687** hardened the #611 experiment. Review caught a HIGH: it printed `ATOMIC, proven`
  where an absent table was equally consistent with the SQL never running.
- **#693** landed the #611 result and discharged the `AGENTS.md` gate.
- **#694 / issue #690** — `dflow.users.office_location` and `.preferred_language`
  (`20260810160000`). **Values are lowercase `'ningbo'`/`'nyc'`** — an orchestrator
  decision, matching the existing Sample Tracking vocabulary; `'Ningbo'` is REJECTED.
  Verified on preview 20/20, no backfill, 51 rows before and after.
- **#700 / issue #653** — `item_popdam_read` on `plm.item` (`20260810170000`), owner-chosen
  Option A. The defect was **reproduced on preview first**, then fixed.
- **#701 / issue #697** — post-apply catalog verification. Review caught two HIGHs. The
  author then found the thing that matters most: **a NULL `proacl` means EXECUTE to
  PUBLIC, not "no grants"** — rendering it as an empty list would have read as locked-down
  while meaning wide-open.
- **#703 / issue #612** — the app-tolerance contract and 9-batch plan.
- **#704** — read-only Cloud SQL capture script for Uma.
- **#708** — owner ruling: shared-db MAY read production Cloud SQL, may still change nothing.

### hetz
- Supabase CLI updated 2.98.2 → **2.105.0**, backup at
  `/root/supabase-cli-backup/supabase-2.98.2`, rollback is one `mv`.
- `/worksp/shared-db` cleaned **after recovery**: 3 stashes read, 2 genuinely unique,
  all preserved to `recovered/*` branches on the remote before anything was dropped.
- A dead session burning ~19% of a core for five days was stopped. **One "stale" session
  was NOT killed** — the `claude-rc-worksp` systemd template unit for this repo is managed
  infrastructure, one of six identical listeners, and would simply restart.

---

## 3. Sub-agent work (half b)

Grouped where several agents served one workstream. Every claim below was verified against
the artefact (PR, diff, run, ledger), not against the agent's report.

### Session-start mappers (read-only) — all finished, no worktrees
- **doc summarizer** — found the current handover by parsed timestamp; flagged 12
  contradictions, all of which I re-derived from `git`/`gh` and resolved.
- **preview observer** — preview is a clean mirror of main. **Disproved two open issues**
  (#648, #656) claiming Paramount/Warner were never applied to preview; both were.
  Cause: all licensors live in `plm`, there is no `pmt`/`wb`/`nbcu` schema.
- **prod-observer** — the first live production read. Established **63 behind** (not
  44/47/61) and **zero licensor tables**. Found `plm` is NOT in `pgrst.db_schemas`.
- **loader-map** — mapped all four licensor loaders. Corrected prod-observer: only NBCU is
  PostgREST-dependent; Warner and Paramount use direct `pg`, Disney uses a `public` wrapper.
- **nbcu-gate0** — **the NBCU loader does not exist**, in any branch. Its spec mandates
  direct `pg`, so it needs neither exposure nor wrappers. Deliberately did NOT write it.
- **promo-list** — built the ordered promotion plan from the files, not the docs.

### #611 chain
- **gate-611** — proved the Docker dependency is only 5 lines.
- **gate-611-runner** — **STOPPED correctly.** The native-Postgres escape hatch does not
  exist here: `C:\Program Files\PostgreSQL\17\` is client-only, no `share\`, no
  `postgres.bki` anywhere. Refused to reason out a verdict. Left an uncommitted edit that
  was later reverted.
- **gate-611-review** — 3-model panel (Grok `grok-4.5-build`, Kimi `kimi-code/k3`, GLM
  `glm-5.2`). Found the experiment insufficient. **Rejected one finding all three raised**
  (an "ordering blind spot") as an artefact of an incomplete brief.
- **machine-finder** — identified hetz; flagged its CLI was the wrong version.
- **gate-611-harden**, **review-687**, **gate-611-hetz**, **land-611**, **review-693** —
  hardened, reviewed, ran, landed, reviewed. All worktrees finished.

### Feature work
- **popdam-gate** — #617 is substantially **built and merged already** (`ca2eea2`); its
  issue text is stale. #615's 47-migration allowlist is **obsolete**. #616 may be
  over-scoped. Recommends closing #617 and opening a narrow successor for digest pinning.
- **orderlist-613 / impl-653 / review-700 / preview-653** — #613's Step 1 was **already
  complete and merged**; the plan doc was four days stale. #653 diagnosed and fixed.
- **scope-690 / impl-690 / review-694 / preview-690** — identified `dflow.users` as
  authoritative from the backend's own code, ruled out four candidates, implemented,
  reviewed, proved on preview.
- **impl-697 / review-701** — two review rounds, two HIGHs fixed.

### #612 contract
- **app-reads** (spawned its own sub-agents), **migration-shapes**, **contract-612**.
  Between them: only **three** apps are exposed (PopDAM, PopCRM, PopPIM); DesignFlow and
  monitor have **zero**. Nine batch boundaries, not sixty-two. **The contract writer
  corrected three inherited findings** — see §7.

### Cloud SQL
- **cloudsql-move** — three plans exist, all stalled on the same missing measurement.
- **cloudsql-capture** — wrote the read-only script (#704). **Merged its own PR**; docs and
  script only, checks green, no DB objects. Worth noting only because the orchestrator
  normally merges.
- **cloudsql-read** — **STOPPED at Gate Zero.** See §7.
- **agents-cloudsql-rule** — found the prohibition was an **interpretation**, not a written
  rule; withdrew it explicitly rather than deleting a line.

### Promotion
- **b1-dryrun** — passed; verified the #611 gate was genuinely discharged rather than
  assuming it.
- **b1-apply** — dispatched, waited for the human, reported the gate held. Did not
  self-approve despite being able to.

**All worktrees are finished.** None holds unique work. `.claude/worktrees/` on this
checkout holds ~28 entries, several predating this session — see §5.

---

## 4. What I was about to do next

**Dispatch B2**, once #709 is fixed. B2 is `20260728171500, 20260728174500, 20260728181500`
per §5 of the contract.

⚠️ **`20260728171500` is the highest-probability abort in the entire backlog.** It reads
the live body of `api.db_data_admin_licensor_property_tree(text,boolean,text,integer)` out
of the catalog, string-patches two anchors, and re-executes it. One character of drift and
it fails or silently patches nothing. It also references `plm."divisionCode"`, which nothing
in the backlog creates. **Check the anchors in the dry-run output before approving B2.**

---

## 5. What I deliberately did NOT do

- **Did not dispatch B2 through B9.** Blocked on #709.
- **Did not fix #709 myself.** It needs an owner decision on which access path to use, and
  the wrong fix (weakening the hard-fail) would undo #697.
- **Did not retire the ~28 worktrees** under `.claude/worktrees/`. All this session's are
  finished and safe; the older ones were checked during the #686 work and none holds unique
  work. Left as a deliberate decision, not an oversight. Use `cleanup-worktree`.
- **Did not touch the two hetz worktrees with 4 unpushed commits** (#689).
- **Did not run the manual post-batch checks** from contract §7 after B1. **Nobody has.**
  With D1 accepted, that checklist is the entire safety net, and D7 (who runs it) is
  unanswered.
- **Did not write the NBCU loader.** Out of scope and it belongs with its spec.
- **Did not reconcile the `SUPABASE-MIGRATION.md` whole-platform strategy against
  shared-db's table-by-table ruling R5.** Both are written as canonical. Deferred until the
  Cloud SQL capture returns.

---

## 6. Blocked on Albert

1. **#709 — the 403.** Which access path should the catalog verification use? Blocks B2.
2. **Contract §8 D2** — how long may a resting point persist?
3. **D5** — DesignFlow non-production drift: asset or hazard?
4. **D6** — is `20260810170000`'s widening still wanted? It ships ahead of the feature.
5. **D7 — who runs the manual checklist, nine times?** Most urgent of these four.
6. **#705** — the Cloud SQL credential fix (four statements, Uma).
7. **#665, #675, #676, #643, #644, #618, #515, #516, #521, #531, #539, #541, #551, #582** —
   pre-existing `needs-albert` issues, untouched this session.

**Answered today:** D1 (user-reported discovery ACCEPTED, #706), D3 (all four destructive
migrations APPROVED), Sample Tracking absence (deliberate, #707), Cloud SQL read permitted
(#708), Uma owns the Cloud SQL side (#696).

---

## 7. What I tried that did NOT work — MANDATORY

- **The native-PostgreSQL path for the #611 experiment.** `initdb`, `pg_ctl` and `postgres`
  all exist on al8960ofc as files, so a file-existence check reads as a green light. The
  install is **client-only**: no `share\`, no `postgres.bki` anywhere on the machine, no
  cluster can ever start. **`psql` on PATH is not evidence a machine can host a server.**
- **Running the #611 experiment as committed.** Voided three times — the two-binary shim
  trap and forced TLS. Both produce all-`f` results indistinguishable from a clean pass.
- **Reading Cloud SQL tonight.** Gate Zero failed: the account named `albert_read_only`
  carries `CREATEROLE`, `CREATEDB` and `cloudsqlsuperuser`. The agent stopped without
  reading. **The name of a role proves nothing.** (#705)
- **Trusting local checkouts.** `C:\repos\shared-db` was 18 commits stale mid-session; the
  app clones were 2-3 weeks stale and produced **four confident wrong answers** before
  being re-done against fresh clones. Local clones were stale in every single case checked.
- **`gh issue list --label`** lags behind the search index by ~a minute and showed an empty
  board twice when it was not. **Use `gh api repos/.../issues?labels=…`.**
- **Believing green checks after `gh pr update-branch`.** `gh pr checks` reported the
  *previous* head as green while the real head had everything queued. Always confirm the
  SHA (`AGENTS.md` §5.2).
- **Assuming a run marked `failure` means the write failed.** B1's apply succeeded; only
  the verification step failed. Read the steps, not the conclusion.
- **Three findings I relayed to the owner that later proved wrong**, all corrected by the
  contract writer: the Warner window is not "RLS with no policies" (policies exist and are
  **wide open to every authenticated account** — worse); the PopCRM worker does **not** call
  `api.current_user_profile`; and the PopSG batching was **not executable** as first
  written (`20260731150000`/`153000` sort inside B3's span). Only after that correction do
  the batches sum to 61.
- **`api.dam_order_list` has no deployed reader.** The #653 fix protects a view nothing
  currently reads.
- **A bash heredoc with backticks** silently ate a whole `gh` command chain mid-session.
  On this PowerShell-first machine, write bodies with the Write tool and use `--body-file`.

---

## 8. Facts that may already be stale

Everything in §1 was checked at **21:10Z** and `main` moved **eight times** today, twice
between a dry-run and its apply. Re-derive before acting:

- `main` tip, max migration version, open PRs, open claims.
- **Production ledger 373 / 53 remaining** — from the B1 after-ledger artifact at ~21:09Z.
- **Preview ledger 425** — from the preview-653 agent, ~20:00Z.
- The `plm` PostgREST exposure finding — read live at ~16:00Z.
- Anything in `docs/production-promotion-app-tolerance-contract.md` about app internals:
  read from fresh clones today, but app repos move independently of this one.

---

## 9. Sweep results

- **Secrets sweep: DONE — nothing new to store.** Credentials touched this session were
  the preview DB password (`qbvfk7umc3n75ejekd65zwd4ty`), the Supabase CLI PAT
  (`3t2xoqk5luyz7ffgdhj24gvtpq`) and the Cloud SQL read account
  (`tcaf3o3u2cx52g6ivvczxbhola`) — **all already in `vibe_coding`**, all referenced by item
  ID only, no value written anywhere. Two 1Password usage traps recorded in #705: the MCP
  rejects a vault **UUID** and needs the literal name `vibe_coding`, and an item title
  containing parentheses must be addressed by item ID.
- **Docs pass: DONE.** `AGENTS.md` §5.1-A rewritten (#693) and §0.1-A added (#708);
  `docs/verification/issue-611-db-push-atomicity-20260810.md` rewritten in place as the
  RESULT; four Cloud SQL planning docs given dated supersession notes; the contract
  document is new. Nothing outside these is known to be stale.
- **Evidence obligations:** no rehearsal was invalidated this session. B1's catalog
  evidence is **missing, not stale** — #709.
- **No mystery untracked files.** `.ai/deepseek-sessions/` and
  `.ai/reviews/glm-gate-611-atomicity-pg17-20260810T170046Z.md` were present at session
  start and remain; `.ai/reviews/` is tracked by design, `.ai/deepseek-sessions/` is
  neither tracked nor ignored (noted in #686).

---

## 10. The gate

Could a developer who walked in this morning continue with no questions? The three things
they must not miss: **B1 is applied despite the red run**; **#709 blocks B2**; and
**every number in every document here is suspect — re-derive it.** Those are §0.
