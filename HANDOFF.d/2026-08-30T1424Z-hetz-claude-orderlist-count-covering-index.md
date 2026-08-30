---
issue: 100
status: BLOCKED
owner: claude/orderlist-count-covering-index-100
---

# OrderList exact count — first two indexes landed and are verified; one covering index remains

> Supersedes the state described in
> `HANDOFF.d/2026-08-27T2258Z-hetz-codex-orderlist-count-indexes.md`, which is
> now **stale**: it reports shared-db #1657 as BLOCKED/queued, but #1657 was
> merged and I verified it live in production on 2026-08-27. That file belongs to
> `codex/orderlist-count-indexes-100` and I have deliberately not edited it — its
> owner should delete it. Everything below is written to stand alone; you do not
> need to read that file.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**One, and it is a routing decision, not a technical one.** shared-db #1722 is
open and correctly labelled `db-work`, but no Claude session can dispatch it. The
shared-db orchestrator runs inside a **Codex CLI process on this machine**, and
the `codex-reply` bridge available to a Claude session only reaches Codex threads
that same bridge started. Every attempt returns `Session not found` — for marker
#1649 and again for the current marker #1697. This is a tooling boundary, not a
stale marker, and re-resolving will not fix it. **Albert must tell
`shared-db.orch` to pick up #1722.** Do not appoint yourself orchestrator, and do
not apply the index from this repo.

Optional, low priority: `plm.style_tracker_item_bridge` carries ~108 MB of
unreclaimable empty space (see §5). Whether that earns its own repack lane is
Albert's call. It is flagged inside #1722 but deliberately **not** requested there.

Already settled — do not re-ask:

- 2026-08-26: rows and exact count stay as two separate requests. Re-merging them
  recreates the original outage. Locked by `src/test/order-list-block-count.test.ts`.
- 2026-08-27: the three options in issue #100 (security-definer count RPC,
  estimated total, summary table) are all **wrong for the measured cause** and are
  withdrawn. See §4.
- 2026-08-30: no app code change is needed for this repair, and none was made.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager. Its `/orders` page
replaced a legacy Google Sheet ("OrderList") and shows production-order lines to
internal staff. App repo is `u2giants/popdam3`; this worktree is
`/worksp/popdam/.claude/worktrees/issue-100-4a0376` on branch
`claude/issue-100-4a0376`, off `/worksp/popdam`. Production is
`https://dam.designflow.app/orders`.

The browser reads one view, `api.dam_order_list`, as the Postgres `authenticated`
role, which carries an **8 second `statement_timeout`**. The grid deliberately
fetches a block of rows and the exact total as **two separate requests**, so a
slow or failed count degrades to "of more" instead of killing the screen.

The shared Supabase database is project `qsllyeztdwjgirsysgai`. **All structural
changes belong in `u2giants/shared-db`** (locally `/worksp/shared-db`) via branch
+ PR. Never author DDL from this repo — CI (`.github/workflows/shared-db-guard.yml`)
blocks it.

## 2. What we set out to do this session, and why

Pick up `u2giants/popdam3#100`: `/orders` intermittently died on a cold load with
`canceling statement due to statement timeout`, observed once in seven loads
during the 2026-08-26 human pass. The issue reported the unfiltered exact count at
**3.4 s against the 8 s ceiling**, growing with the table, and proposed three
fixes.

The goal was to make the exact total stop approaching the ceiling — without
re-merging rows and count, which is the outage quirk #75 documents.

## 3. Current state — what is true right now

- **PopDAM #100 is OPEN**, intentionally. I did not close it on a partial win.
- **shared-db #1657 is MERGED and verified live in production.** Both indexes
  exist and the planner uses them:
  - `plm.style_tracker_item_bridge_plm_item_idx` on `(plm_item_id)`
  - `plm.production_order_line_count_cover_idx` on `(production_order_id, item_id, id)`
- **shared-db #1722 is OPEN**, labelled `db-work`, un-dispatched. It requests the
  covering index in §6.
- Measured on production as `set role authenticated`, 2026-08-27:

  | | before #1657 | after #1657 |
  |---|---|---|
  | warm `count(*)` | 161 ms | **77–86 ms** |
  | cold shared-buffer reads | 24,835 (~194 MB) | **4,707 (~37 MB)** |
  | `plm.production_order_line` | Seq Scan, 7,290 buffers | Index Only Scan, 195 buffers, `Heap Fetches: 6` |
  | `plm.style_tracker_item_bridge` | Seq Scan, 16,943 buffers | Memoize + Index Scan, 3,910 reads |

- **The wall clock did not fall as far as the buffers did.** A cold
  `explain (analyze, buffers)` run still measured **1,481 ms** — slower than one
  earlier pre-fix cold sample of 922 ms, despite reading 5x fewer buffers. §5
  explains why. The 8 s ceiling is no longer close, but this is not finished.
- App code: **unchanged**. `src/hooks/useOrderList.ts` and its test are untouched.
- Docs committed and pushed to `main`: `e45da72` (corrected the wrong RLS
  diagnosis in `docs/KNOWN_QUIRKS.md` #75 and `docs/ORDER_LIST.md`) and `d8a63be`
  (recorded the verified post-index numbers). Working tree is clean; nothing
  unpushed.
- Two comments posted to #100 carrying the full evidence
  (`issuecomment-5439786231`, `issuecomment-5447172427`).

## 4. Everything we tried that did NOT work

- **All three options proposed in issue #100 are wrong**, and the reason is the
  same for each: they were designed against a diagnosis that measurement
  disproved.
  - *Security-definer count RPC* — would remove an RLS check that **costs
    nothing**. Every read policy on the joined tables is `using (true)`
    (`20260810010000_popdam_order_list_contract.sql`), so it folds away at plan
    time and never appears in the plan. The same ~194 MB would still be read.
  - *Estimated total (`count=estimated`)* — hides the symptom, does not repair it,
    and leaves the same scan slowing the **row** queries on every scroll.
  - *Summary table* — a scheduled refresh, plus staleness, to work around a
    missing index.
- **Dispatching to the shared-db orchestrator via `codex-reply` failed twice**,
  against two different markers (#1649 route `01a042f6-…`, #1697 route
  `01a0451c-…`). Both return `Session not found`. Re-resolving the marker, which
  the `shared-db-change` skill prescribes, does **not** help — see §0. Do not
  spend time retrying this.
- `ListAgents` does not show the orchestrator either; it lists Claude sessions,
  and the orchestrator is a Codex process.
- The supabase MCP was `Unauthorized` for SQL in this session. That is **not** a
  dead end — see §8.

## 5. Root causes and key findings

**The original diagnosis in issue #100 and in quirk #75 was wrong.** Both blamed
the security-invoker view re-checking each row against RLS. It does not: policies
are `using (true)`, they fold away, and a *warm* count is 161 ms. The cost was
always **cold-cache sequential IO**.

The dominant term was a full scan of `plm.style_tracker_item_bridge` — 16,943
buffers, 132 MB. It happened because that table had **no index on `plm_item_id`**,
the column `api.dam_order_list` joins it on
(`20260810010000_popdam_order_list_contract.sql:516`), and the planner cannot
prune the join because the bridge is **not unique on `plm_item_id`** — it
genuinely fans out, 24,010 order lines producing 24,486 view rows. (Every other
left join — `core.customer`, `core.factory`, `plm.item`,
`public.style_tracker_rows` — *is* pruned automatically and was never a cost.)

**The finding that matters for whoever picks this up:** after #1657, the bridge
lookup is an index scan, but a *plain* index scan — it finds the row, then must
visit the heap for the three columns the view projects. That heap is **132 MB
holding ~24 MB of live data** across 15,619 rows, roughly 5x bloat, with
`n_dead_tup = 0`, meaning autovacuum **cannot** reclaim it (it needs a repack).
So 3,910 of the 4,707 remaining cold reads — **83%** — are *random* reads into a
bloated heap, which lose the readahead a sequential scan gets. That is the whole
reason the buffer count fell 5x while the cold wall clock did not.

**General lesson, now written into quirk #75: fewer buffers is not automatically
faster.** Read the plan, not just the totals.

The fix for that last term is to make the bridge lookup **index-only**. The table
is 100% all-visible (`relallvisible = relpages = 16943`), so an index-only scan
will do essentially zero heap fetches.

## 6. Exact next steps

1. **Get shared-db #1722 dispatched.** Ask Albert to tell `shared-db.orch` to
   pick it up. You cannot do this yourself (§0). The requested migration is:

   ```sql
   create index concurrently if not exists style_tracker_item_bridge_plm_item_cover_idx
     on plm.style_tracker_item_bridge (plm_item_id)
     include (id, style_tracker_row_id, tracker_type);

   drop index concurrently if exists plm.style_tracker_item_bridge_plm_item_idx;
   ```

   The `include` columns are exactly the three the view projects from the bridge
   (`…_contract.sql:534-537`). Create first, drop second — the covering index
   fully supersedes the narrow one, so the index count does not grow.
   `create index concurrently` cannot run inside a transaction; the migration
   needs shared-db's non-transactional handling.

2. **After it merges, re-verify** using the psql path in §8:

   ```sql
   set role authenticated;
   explain (analyze, buffers) select count(*) from api.dam_order_list;
   ```

   Expect an **Index Only Scan** on `plm.style_tracker_item_bridge` with
   near-zero `Heap Fetches`, and total cold `read=` under ~1,000 buffers.
   Predicted by `hypopg` on production: plan cost **7,129 → 3,128**, cold reads
   **4,707 → ~800 (~6 MB)**.

3. **Update the docs with the final numbers** — `docs/KNOWN_QUIRKS.md` #75 and
   `docs/ORDER_LIST.md` both currently end on "shared-db #1722 asks for…". Replace
   with the measured result.

4. **Close popdam3 #100** with the final measurement, and **delete this handoff
   file** (git history keeps it).

5. Optional, separate: raise the bridge repack (§0) if Albert wants it.

## 7. Constraints and gotchas in force

- **Never author DDL from this repo.** `shared-db-guard.yml` fails any PR/push
  adding DDL or migrations outside the vendored read-only `shared-db/` mirror.
- **Never re-merge the rows and count requests.** Quirk #75; locked by
  `src/test/order-list-block-count.test.ts`.
- **Measure as `authenticated`, never as `postgres`** — `postgres` has no
  statement timeout, so it cannot reproduce the failure.
- **`hypopg` is installed on production (1.4.1)** and is the correct way to test
  an index without creating one. `hypopg_create_index(...)` then `explain`
  (no `analyze` — hypothetical indexes give estimates only). It is session-local
  and creates nothing; `hypopg_reset()` clears it. **This session made zero
  writes to preview or production.**
- `index_advisor` 0.2.0 is also available; `pgstattuple` and `pg_repack` are
  **not** installed.
- This is a **git worktree**. `main` is checked out elsewhere, so commit on the
  branch and push with `git push origin HEAD:main`. Rebase with
  `git rebase --autostash origin/main`; never force-push. `origin` and `github`
  are the same repository here, so the second push reports "Everything
  up-to-date" — that is expected.
- Cold-cache timings on this database vary a lot between samples. Trust
  `buffers` and the plan shape over any single wall-clock number, and say so when
  reporting.

## 8. Access and environment

- **The supabase MCP returned `Unauthorized` for SQL this session** ("provide a
  valid access token"). Not a blocker. The working path, re-verified 2026-08-27:

  ```bash
  printf 'PGPASSWORD=op://vibe_coding/246sf23gymd64yudpmhswcnyle/password\n' > .pgenv
  op run --env-file=.pgenv -- psql "postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -f query.sql
  ```

  Note the pooler user form `postgres.<project-ref>` and host region
  `aws-1-us-east-1`, not the project's own hostname. Item
  `246sf23gymd64yudpmhswcnyle` is *Supabase DB Password - shared POP database* in
  vault `vibe_coding`. **Never `op read` a secret to stdout** — the classifier
  blocks printing credentials; use `op run --env-file` so it lands only in the
  subprocess environment. That is what this session did throughout.
- `mcp__supabase__get_project_url` **did** work and confirmed
  `https://qsllyeztdwjgirsysgai.supabase.co` — worth calling before any MCP DB
  work, because the MCP takes no project parameter and can be pointed at the
  wrong project.
- Failed to connect this session (unrelated to this work): `devops-mcp`,
  `railway`, `recall-ai`, `synology-monitor`, `tokensave`, `vercel`, `trigger`.
- Orchestrator marker resolution: `cd /worksp/shared-db && node
  scripts/check-orchestrator-marker.mjs --resolve`. It resolves, but the address
  is unreachable from Claude — §0.

## 9. Open questions and risks

- **Will the covering index actually deliver?** The `hypopg` plan says yes and the
  visibility-map evidence is solid, but it is an estimate. Verify with a real cold
  `explain (analyze, buffers)` before closing #100.
- **The bloat is untreated.** Even index-only, `plm.style_tracker_item_bridge`
  stays 132 MB for 24 MB of data, and every other query against it, plus backups,
  pays for that. If the bridge grows, this can resurface in a different query.
- **The count grows with the table.** These indexes change the slope, not the
  fact. If order volume rises sharply, re-measure rather than assuming.
- **Risk of the drop step in #1722:** if the author creates the covering index but
  the drop of the narrow one fails, production carries a redundant index. Harmless
  but worth noticing.
- **Nobody is watching the shared-db queue.** #1722 sits until Albert acts. If it
  is still open in a week, that is the thing to escalate, not the index itself.

## Self-audit

- A stranger can execute §6 without reading any other file or asking a question:
  the exact SQL, the exact verification query, the expected numbers, and the
  access path are all present. **Yes.**
- What was tried and failed is recorded with the reason, including the two failed
  orchestrator dispatches and the three withdrawn options, so nobody repeats
  them. **Yes.**
- The one decision only Albert can make is isolated in §0 and is a routing
  action, not a technical choice. **Yes.**
- Every claim is backed by a measurement taken this session or a named commit,
  issue, or file path. **Yes.**
- The known-stale predecessor file is named, with its owner, and left unedited.
  **Yes.**
