---
summary: Combined plan for review findings #1215, #1223, #1248, #1256 on the #1198 missing-file work (proven moves, restore, "no longer on the NAS" mark, inode/content identity). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issues 1215, 1223, 1248 or 1256, or changing retire-missing-assets, restore-missing-assets, retire-stale-asset, findSurvivingCopy or the bridge content hash
---

# Plan: close the review findings on the #1198 missing-file work (issues 1215, 1223, 1248, 1256)

Issues covered (all in `u2giants/popdam3`, all labelled `review-finding`):

- <https://github.com/u2giants/popdam3/issues/1215> — findings on PR 1212 (hide only proven moves)
- <https://github.com/u2giants/popdam3/issues/1223> — findings on PR 1222 (restore wrongly hidden records)
- <https://github.com/u2giants/popdam3/issues/1248> — findings on PR 1247 ("no longer on the NAS" mark)
- <https://github.com/u2giants/popdam3/issues/1256> — findings on PR 1255 (inode → content hash → hint identity)

Parent work: <https://github.com/u2giants/popdam3/issues/1198> (closed 2026-11-25 as delivered).
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-1198-review-findings-plan.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-1198-review-findings-plan.md)
Written 2026-11-25, 3:57 PM EST, by Claude (plan only; no code changed). Code facts checked against `origin/main` at `787c20b8`.

## STATUS

| Step | What | State | Evidence |
|---|---|---|---|
| 1 | Extract retire-missing handler into a testable module | ⬜ open | — |
| 2 | Read identity columns in every proof caller | ⬜ open | — |
| 3 | Survivor proof: exclude batch peers, flagged records, conflicting content | ⬜ open | — |
| 4 | Clear-only call skips empty `IN ()` reads | ⬜ open | — |
| 5 | Partial-progress counts on flag/clear failure | ⬜ open | — |
| 6 | Restore: latest history row must be the missing marker | ⬜ open | — |
| 7 | Restore: write receipt, post-write duplicate check, failure reconciliation | ⬜ open | — |
| 8 | `retire-stale-asset` uses the same tiered proof | ⬜ open | — |
| 9 | `stale_candidates` include inode/content matches | ⬜ open | — |
| 10 | Bridge: content-hash failure never drops a file | ⬜ open | — |
| 11 | Bridge: report `flagged` in reconcile result and scan summary | ⬜ open | — |
| 12 | Deploy edge functions + bridge, live proof | ⬜ open | — |
| 13 | Re-run restore over the marker-hidden set with the new proof | ⬜ open | — |
| 14 | Docs, issue comments, close the four issues | ⬜ open | — |

Fresh session starts at **Step 1**. Findings judged already resolved or moot are listed in §6.3 and need only the closing evidence in Step 14.

---

## Part 1 — Why

### 1. The ultimate goal

POP Creations' staff must be able to trust PopDAM's catalog of artwork. The owner
ruled on 2026-11-19 (Albert's exact words): *"artwork deleted from the NAS should
not disappear from PopDAM automatically. But there must be a foolproof way to
differentiate between 'disappear' and moved. we can't have duplicates"*.

So, when this plan is done:

- **No artwork record is ever hidden unless the same artwork is proven to still
  exist at another live path** — including the case where two copies of the
  same artwork are both deleted at once.
- **No action — scan, restore, or stale retirement — ever leaves two live
  records for one file.**
- The "no longer on the NAS" mark is set and cleared reliably and its counts are
  visible in scan logs.
- The foolproof identity (same disk file instance, or byte-identical content)
  is actually used everywhere a move or a duplicate is decided, not only at
  ingest.

**If a step in this plan conflicts with this goal, the goal wins — stop, do the
thing that keeps records and avoids duplicates, and flag the conflict in the
issue.** When unsure, the safe direction is *keep the record visible*.

### 2. What this application is

PopDAM is POP Creations' internal digital asset manager: a web catalog of
licensed consumer-product design files (PSD, AI, PDF, images) stored on the
company's Synology NAS `edgesynology1`. Staff browse, search and check out
files in a browser.

- Repository: <https://github.com/u2giants/popdam3>, release branch `main`
  (protected; feature branch + PR). Router: `AGENTS.md`.
- **Bridge agent** (`apps/bridge-agent/`, Node/TypeScript, runs on the NAS in
  Docker): about every two hours walks the design folders ("a scan"), sends
  new/changed files to the cloud, makes thumbnails, and at the end of a full
  scan runs the *missing-file reconciliation* (records whose file returned
  "not found"). Ships only with a version bump in
  `apps/bridge-agent/package.json` (currently `1.17.3`) and an
  `AGENT_UPDATE_REQUEST`.
- **Edge functions** (`supabase/functions/`, Deno): `agent-api` (called by the
  bridge) and `admin-api` (admin actions). Deployed automatically on merge by
  `.github/workflows/deploy-supabase.yml`.
- **Database**: shared Supabase project `qsllyeztdwjgirsysgai`. `public.assets`
  has one row per file (`relative_path` unique, `is_deleted` = hidden,
  `quick_hash` = cheap sampled fingerprint, `nas_volume` + `nas_ino` = disk
  file instance, `content_sha256` = full-content hash, `file_missing_at` =
  "no longer on the NAS" mark). `public.asset_path_history` records moves and
  retirements (`new_relative_path` holds marker strings for retirements).
  Schema changes are authored only in `popcre/shared-db`; `shared-db/` here is a
  read-only mirror. **This plan needs no schema change.**

### 3. What triggered this work

The advisory AI reviewer filed one `review-finding` issue per merged #1198 PR.
The automatic fixer deferred all four ("source moved"); a `fixer-deferred`
label is not a fix. Each finding was re-checked on `origin/main` `787c20b8`
on 2026-11-25; §6 lists what is still real.

Bugs are not visible in the web app today; they are latent data-safety holes
(a record can be hidden with no surviving copy; a restore can race into a
duplicate; the new identity never engages on the hide path).

### 4. Scope

**In:** every still-valid finding in the four issues, listed in §6.1 and §6.2;
tests proving each; deploy; live proof; one corrective restore pass (Step 13).

**NOT in this plan:**

- Any schema / migration / RPC change (none needed; if one becomes needed, stop
  and route it through `popcre/shared-db` with the `shared-db-change` skill).
- De-duplicating records that are *both* missing from the NAS (two live
  records of the same artwork, both files gone). They stay as they are
  (both visible, both marked) — see decision D4.
- UI changes to the "no longer on the NAS" badge.
- Hi-res backfill, thumbnails, or other bridge work.
- Fixing `trigger-scan` service-key bug (KNOWN_QUIRKS #82) — separate.
- Any hard delete of any row.

---

## Part 2 — What we already know

### 5. Current state of the code (origin/main `787c20b8`)

All #1198 PRs are merged and deployed. Relevant code:

- `supabase/functions/agent-api/index.ts:1568` `handleRetireMissingAssets` — the
  hide path. Reads only `id, relative_path, filename, file_size, quick_hash,
  is_deleted` (`:1590-1593`). Calls `findSurvivingCopy` per eligible row
  (`:1640-1659`), flags kept rows `file_missing_at` (`:1665-1675`), clears
  `clear_missing_flags` (`:1676-1686`), then soft-deletes proven moves via
  `retireMissingInChunks` (`:1688`). Handler accepts a clear-only call
  (`:1572-1576`) but still runs `.in("id", ids)` and `.in("asset_id", ids)`
  with `ids = []` (`:1587-1601`).
- `supabase/functions/_shared/surviving-copy.ts` — `findSurvivingCopy(db, stale)`:
  tier 1 `(nas_volume, nas_ino)`, tier 2 `content_sha256`, tier 3 hint
  `(filename, file_size, quick_hash)` via `provenSurvivingCopy`. Candidate query
  (`candidates`, `:22-38`) excludes only the stale record's own id and path,
  `limit(5)`. `IDENTITY_COLUMNS` (`:20`) is module-private.
- `supabase/functions/_shared/file-identity.ts` — `moveMatchTier` (record follows
  file; content tier needs same basename) and `artworkMatchTier` (survivor
  proof; content tier name-free, hint last).
- `supabase/functions/_shared/stale-asset-retirement.ts` — markers
  `RETIRED_MISSING_MARKER = "retired-missing-from-nas"`,
  `RETIRED_STALE_MARKER = "retired-stale-duplicate:"`;
  `staleRetirementRefusal` (hint-only exact match, `:36-49`);
  `provenSurvivingCopy` (`:59-68`).
- `supabase/functions/_shared/admin-handlers/restore-missing-handlers.ts` —
  `handleRestoreMissingAssets` (admin-api action `restore-missing-assets`,
  routed at `supabase/functions/admin-api/index.ts:2147`). Reads hint columns
  only (`:36-39`); marker check matches *any* marker row (`:56-66`);
  in-request triple de-dupe (`:72-80`); ledger insert
  `restored-no-surviving-copy` then update then compensating delete
  (`:84-108`). No `logIndexedWriteResult` receipt.
- `supabase/functions/agent-api/index.ts:1451` `handleRetireStaleAsset` — reads
  hint columns + AI fields, enforces `staleRetirementRefusal` (hint-only).
- `supabase/functions/agent-api/index.ts:1427-1440` — new-asset
  `stale_candidates` = live rows with same `(quick_hash, filename, file_size)`.
- `supabase/functions/agent-api/index.ts:1158-1222` — ingest move detection
  with the three tiers (correct; not changed by this plan). Revive branch
  `:1320-1331` uses the *latest* history row via `isRevivableRetirement`.
- Bridge: `apps/bridge-agent/src/index.ts:1237-1239` computes
  `computeContentSha256` (`apps/bridge-agent/src/hasher.ts:31`) inside the
  `try` of `processFile` (`:1187`); a throw lands in the outer `catch`
  (`:1369`) → `errors++`, no ingest.
- Bridge: `apps/bridge-agent/src/missing-file-reconciliation.ts:173`
  destructures `{ retired, kept, error }` — `flagged` dropped; `ReconcileResult`
  (`:60-70`) has no `flagged`; `index.ts:1094` stores only `retired`.
- Tests that exist: `supabase/functions/_shared/stale-asset-retirement.test.ts`,
  `file-identity.test.ts`, `retire-missing-chunks.test.ts`,
  `admin-handlers/restore-missing-handlers.test.ts` (has an in-memory `makeDb`
  fake, `:10-90` — reuse it); bridge
  `apps/bridge-agent/src/missing-file-reconciliation.test.ts`. There is **no**
  test of `handleRetireMissingAssets` itself.
- Live proof of the mark: `docs/verification/issue-1198-nas-missing-mark/2026-11-20T1840Z/findings.md`
  (8,816 marked; clear proven via the ingest path only — the clear-only
  reconcile call was unit-tested, never live-proven).

### 6. Key findings and root cause

#### 6.1 Still-real findings (verified on `787c20b8`)

| ID | Issue | Finding | Where |
|---|---|---|---|
| F1 | 1215 | Batch peers prove each other: two live records of the same artwork, both files deleted, sent in the same batch → each lookup sees the other as live survivor → **both hidden** (artwork vanishes). | `surviving-copy.ts:22-38`, `agent-api/index.ts:1640-1659` |
| F2 | 1215 | With peers excluded, the candidate limit could be filled by also-missing peers and miss a real third survivor (safe direction, but incomplete). | `surviving-copy.ts:35` |
| F3 | 1215 | No test of `handleRetireMissingAssets` (keep-without-proof, both-peers-missing). | — |
| F4 | 1256 | Hide path reads only hint columns, so tiers 1–2 never engage there; tier 3 hint (which collides, KNOWN_QUIRKS #51) is the only proof used. | `agent-api/index.ts:1590-1593` |
| F5 | 1256 | Same omission in restore: can miss a survivor proven by inode/content and restore a duplicate. | `restore-missing-handlers.ts:36-39` |
| F6 | 1256 | `retire-stale-asset` proof is hint-only (`staleRetirementRefusal`) — inconsistent with the tiered proof; a renamed content-identical survivor is refused as `filename_mismatch`. | `agent-api/index.ts:1451-1465` |
| F7 | 1256 | `stale_candidates` hint-only; inode/content-proven stale duplicates are never offered to the bridge. | `agent-api/index.ts:1427-1440` |
| F8 | 1256 | `computeContentSha256` failure drops the file as an error (no ingest). | `bridge index.ts:1239`, `hasher.ts:31` |
| F9 | 1248 | Clear-only call runs `.in(…, [])`. PostgREST behaviour with empty `in.()` is version-dependent and the clear-only path was never live-proven. Guard it. | `agent-api/index.ts:1587-1601` |
| F10 | 1248 | Bridge discards server `flagged`; marks are invisible in logs/scan summary. | `missing-file-reconciliation.ts:173`, `index.ts:1094` |
| F11 | 1248 | Flag/clear failure returns `retired:0` without `flagged`/`cleared` done so far. | `agent-api/index.ts:1674,1685` |
| F12 | 1223 | Restore marker check accepts any old marker row, so a record later re-hidden by a purge (`_old`/SAMPLE purge, `purge-excluded-subfolder-assets`) can be restored over that purge. Must require the **latest** history row (by `detected_at`) to be the marker, like ingest's revive. | `restore-missing-handlers.ts:56-66` |
| F13 | 1223 | Restore write has no receipt; if the UPDATE times out client-side but commits server-side, the compensation deletes the ledger rows of records that *were* restored (untracked restore). | `restore-missing-handlers.ts:84-108` |
| F14 | 1223 | Concurrent restore requests (two admin calls at once) can each see "no live survivor" and both restore records of one identity → duplicate. | `restore-missing-handlers.ts:67-81` |
| F15 | 1223 | Records hidden before the retire-side fix whose "survivor" matched only by the colliding hint stay hidden with no restore path, even when content proves they are different artwork. | design; addressed by F4/F5 + Step 13 |

#### 6.2 Findings reinterpreted (real cause differs from the reviewer's wording)

- **1223 #1 "restoring across batches creates live duplicates"**: in *sequential*
  use this does not happen — after record A is restored live, record B's
  `findSurvivingCopy` finds A (live, other path, same identity) and B is
  skipped as `surviving_copy`. The real residual is the concurrency race (F14).
- **1223 #2 "hidden twin invisible to move detection"**: correct that ingest move
  detection only considers live rows (`agent-api/index.ts:1192`). It cannot
  create a duplicate on its own: a twin that returns at its old path revives its
  own record (`relative_path` is unique). The duplicate the reviewer describes
  needs restore to run after the twin is removed — which F14's post-write
  check and the improved proof (F4/F5, Step 3) now cover.
- **1223 #4/#5 (body truncated at source)**: the reviewer text ends mid-sentence
  ("the statement timeout … can hit the UPDATE *after* …"). The full text is
  not recoverable (no run artifact; PR comment is truncated the same way). The
  intent — ledger rows left inconsistent with `is_deleted` after a timeout —
  is covered by F13. Do not try to reconstruct more.

#### 6.3 Findings already resolved or moot (close with evidence in Step 14)

- **1248 #2 / 1256 #4 "columns `file_missing_at`, `nas_volume`, `nas_ino`,
  `content_sha256` have no migration"**: they exist live —
  `src/integrations/supabase/types.ts:737,749,773,774` (generated from the live
  schema) and the 8,816-record live backfill in
  `docs/verification/issue-1198-nas-missing-mark/2026-11-20T1840Z/findings.md`.
  The vendored `shared-db/` mirror simply lags.
- **1248 #3 "new bridge + old edge rejects clear-only call"**: rollout is over;
  both sides are deployed (edge from `main`, bridge `1.17.3`). Moot.

### 7. Approaches considered and REJECTED

- **A shared-db RPC to make restore atomic (ledger + update in one
  transaction) or to take an advisory lock** — correct in principle but needs
  the shared-db ceremony for a rarely-used admin action. Rejected: Step 7's
  post-write check + reconciliation gives the same guarantee without a schema
  change. Revisit only if Step 7's test cannot be made deterministic.
- **Hiding all but one of in-batch peers when all copies are gone** — that
  hides a record with no surviving file, which the ruling forbids. Rejected.
- **Hiding both peers (status quo)** — loses artwork. That is F1.
- **Treating a `file_missing_at`-marked record as a valid survivor** — its file
  is itself gone, so it proves nothing about the artwork existing. Rejected
  (Step 3 excludes it).
- **Capping `content_sha256` by file size or adding a timeout** — a capped file
  would fall back to the colliding hint, the exact weakness #1198 removed.
  Rejected; on failure the value is `null` and ingest proceeds (Step 10).
- **Dropping tier 3 (hint) entirely** — older records (before the identity
  columns) have only the hint; dropping it would stop all proven-move hiding for
  them and leave real duplicates live. Rejected; instead the hint is refused
  when both rows carry *different* `content_sha256` (Step 3).
- **Recovering the truncated 1223 findings from logs** — tried on 2026-11-25:
  `gh run view 44591384203 --log` and run artifacts contain no full text.
- **Deleting leftover `restored-no-surviving-copy` ledger rows** — they are the
  audit trail and make restore reversible. Never delete them except as the
  compensation in Step 7.

### 8. Design decisions

Locked (do not relitigate):

- **D1 (owner, 2026-11-19)** never lose a record; never duplicate on a move;
  deleted artwork stays visible with the "no longer on the NAS" mark.
- **D2** proof that a record may be hidden = a *live*, *unmarked*
  (`file_missing_at is null`), *not-in-this-batch* record at another path
  matching by `artworkMatchTier` (inode → content → hint), where a hint match is
  refused when both rows have non-null, different `content_sha256`.
- **D3** the same proof function is used by retire-missing, restore, and
  retire-stale (one definition; F6). Retire-stale keeps its extra guards
  (confirmed-absent path, open checkout, AI inheritance).
- **D4** two records of the same artwork whose files are both gone both stay
  visible and both get marked. No dedupe of missing-only records.
- **D5** soft delete only; no hard deletes; marker/ledger rows are never removed
  except as a same-request compensation.
- **D6** no schema change.

Open (implementer's judgment, criteria given):

- **O1** whether to move the extracted retire-missing handler to
  `supabase/functions/_shared/agent-handlers/` or keep a sibling module next to
  `agent-api/index.ts`. Criterion: follow whatever pattern `admin-handlers/` uses
  and keep `agent-api/index.ts` routing unchanged.
- **O2** candidate `limit` after excluding peers. Criterion: large enough that
  excluded ids cannot starve a real survivor — exclude in the query
  (`.not("id", "in", …)`) so the limit applies only to eligible rows; 5 is then
  enough.

---

## Part 3 — How to build it

Phase 1 = edge functions (Steps 1–9, one PR). Phase 2 = bridge (Steps 10–11,
second PR with a version bump). Phase 3 = deploy, proof, corrective restore,
close-out (Steps 12–14). **Re-read the next phase's steps before starting it.**
Each phase is a natural fresh-session cut point.

### Phase 1 — edge functions

**Step 1 — Extract the retire-missing handler (lead-only: reshapes the hide path).**
Move `handleRetireMissingAssets` (`agent-api/index.ts:1568-1730`) and its
constants into `supabase/functions/_shared/agent-handlers/retire-missing-handler.ts`
(per O1), exporting `handleRetireMissingAssets(body, deps?)` where `deps`
defaults to `serviceClient()`. `agent-api/index.ts` imports it; the
`case "retire-missing-assets"` at `:5178` is unchanged. Behaviour identical.
Gate: `npx vitest run --project edge-functions` green; `deno check
supabase/functions/agent-api/index.ts` passes (or the repo's existing edge
type-check step in `.github/workflows/ci.yml`).

**Step 2 — Read identity columns everywhere (helper-ok: exact, mechanical).**
Export `IDENTITY_COLUMNS` from `surviving-copy.ts` and add
`file_missing_at` to it. Use it for the row reads in the extracted retire
handler (was `:1590-1593`) and `restore-missing-handlers.ts:36-39`. Extend the
`MissingRow` type and `RetirementIdentity` (`stale-asset-retirement.ts:22-33`)
with `file_missing_at?: string | null`.
Gate: unit test "retire uses inode proof when hint differs" (Step 2 test in §10)
passes. Stop-and-ask: any other caller of `findSurvivingCopy` found by
`grep -rn findSurvivingCopy supabase/functions`.

**Step 3 — Correct the survivor proof (lead-only: decides what gets hidden).**
In `surviving-copy.ts`:
- `findSurvivingCopy(db, stale, opts?: { excludeIds?: string[] })`; `candidates`
  adds `.is("file_missing_at", null)` and, when `excludeIds` is non-empty,
  `.not("id", "in", `(${ids.join(",")})`)` (ids are UUIDs from the DB read, not
  user strings — validate UUID shape before interpolating).
- Tier 3: skip a hint candidate when both `stale.content_sha256` and
  `row.content_sha256` are non-null and differ (D2). Implement in
  `file-identity.ts` `artworkMatchTier` (hint branch) so every caller gets it,
  and make `findSurvivingCopy` tier 3 use `artworkMatchTier(...) === "hint"`
  plus the existing `staleRetirementRefusal` path/live checks.
- Retire handler passes `excludeIds = eligible.map(r => r.id)` (whole batch).
- Restore passes `excludeIds = []` (restore wants to *see* other live rows).
Behaviour: both-peers-missing batch → both kept and flagged; peer + live third
copy → peers hidden, third stays; marked record never proves anything.
Gate: tests 3a–3e (§10) pass.

**Step 4 — Clear-only guard (helper-ok).** In the extracted retire handler, when
`ids.length === 0` skip the asset read and checkout read and go straight to the
clear loop. Gate: test 4 asserts no `.in()` call with `[]` and `cleared` count
returned. Stop-and-ask: if the fake db cannot observe `.in` arguments.

**Step 5 — Partial progress on flag/clear failure (helper-ok).** The two error
returns (were `:1674`, `:1685`) return
`{ ok:true, retired:0, kept, flagged, cleared, skipped, partial:true, error }`
with the counts accumulated so far. Gate: test 5.

**Step 6 — Restore requires the latest history row to be the marker (lead-only:
restore-over-purge risk).** Replace the marker query (`restore-missing-handlers.ts:56-66`)
with: latest `asset_path_history` row for the asset ordered by `detected_at desc`
`limit(1)`; require `new_relative_path === RETIRED_MISSING_MARKER`; otherwise skip
`latest_not_missing_marker`. Gate: test 6.

**Step 7 — Restore write receipt, duplicate check, reconciliation (lead-only:
data-safety).** Per chunk in `restore-missing-handlers.ts:84-108`:
1. Re-run `findSurvivingCopy` for each chunk row immediately before writing;
   drop rows that now have a survivor (`surviving_copy_late`).
2. Insert ledger rows (unchanged), then update with `.select("id")` and call
   `logIndexedWriteResult("public.assets", "restore-missing", chunk.length, n)`
   (today a private function at `agent-api/index.ts:20`; move it unchanged to
   `supabase/functions/_shared/indexed-write-log.ts`, export it, and import it
   in both `agent-api/index.ts` and the restore handler).
3. On update error or count mismatch: **re-read** `id, is_deleted` for the
   chunk; delete ledger rows only for ids still hidden; count the ones that are
   live as restored.
4. After the update, for each restored row run `findSurvivingCopy(db, row)`
   once more; if a survivor now exists (a concurrent request restored a twin),
   re-hide *this* row (`is_deleted:true`, `.eq("is_deleted", false)`), and
   insert a history row `new_relative_path = RETIRED_MISSING_MARKER`,
   `old_relative_path = RESTORED_LEDGER` so the trail reads restore → re-hide.
   Report `rehidden_duplicate`.
Behaviour: restore can never leave two live rows for one identity, and the
ledger always matches `is_deleted`.
Gate: tests 7a–7c.

**Step 8 — Retire-stale uses the shared proof (lead-only).** In
`handleRetireStaleAsset` (`agent-api/index.ts:1451`): read
`IDENTITY_COLUMNS` + `AI_INHERITANCE_COLUMNS`; keep refusals `same_record`,
`not_live`, `path_changed_since_check`, `same_path` from
`staleRetirementRefusal`; replace the hash/filename/size refusals with
`artworkMatchTier(stale, survivor) === null → "identity_mismatch"`, and refuse
`survivor_marked_missing` when `survivor.file_missing_at` is set. Split
`staleRetirementRefusal` into `stalePairGuard` (path/live checks) + the tier
check so retire-missing tier 3 and retire-stale share code. Update
`stale-asset-retirement.test.ts` expectations accordingly.
Gate: tests 8a–8b; existing `stale-asset-retirement.test.ts` updated and green.

**Step 9 — `stale_candidates` include inode/content matches (helper-ok: query
union with exact spec).** At `agent-api/index.ts:1427-1440`, after the hint
query, when the new asset has `nas_volume && nas_ino` add live rows with the
same pair, and when it has `content_sha256` add live rows with the same hash;
de-duplicate by id, exclude the new asset id, cap at 20 total. The bridge
already confirms each path on disk before calling `retire-stale-asset`
(`apps/bridge-agent/src/index.ts:1306-1310`), and Step 8 makes the server
accept those pairs. Gate: test 9. Stop-and-ask: if the ingest test harness
cannot reach this code without a live db — then extract the candidate query
into a function in `surviving-copy.ts` and test that.

### Phase 2 — bridge (cut point: start a fresh session if context is long)

**Step 10 — Content-hash failure never drops a file (helper-ok).** In
`apps/bridge-agent/src/index.ts:1237-1239` wrap `computeContentSha256` in its
own try/catch: on error log `warn` ("content hash failed; ingesting without it")
with path and message, increment a new counter `content_hash_failed` (add to
the counters object near `index.ts:152` and its reset near `:176`), and send
`content_sha256: null`. Do not add a size cap or timeout (§7). Gate: new test
in `apps/bridge-agent/src/` (e.g. `content-hash-fallback.test.ts`, added to the
`test` script list in `apps/bridge-agent/package.json`) proving a throwing
hasher still produces an ingest call with `content_sha256: null`. If
`processFile` is too entangled to test, extract
`safeContentSha256(path, hasher, log)` into `hasher.ts` and test that.
Stop-and-ask: if extraction touches more than `hasher.ts` and `index.ts`.

**Step 11 — Report `flagged` (helper-ok).** Add `flagged: number` to
`ReconcileResult` (`missing-file-reconciliation.ts:60-70`, init at `:89`), add
`result.flagged += flagged ?? 0` at `:173`, add `flagged_missing` to the scan
counters and set it beside `retired_missing` (`index.ts:1094`), and include it
in the scan summary log line wherever `retired_missing` is logged
(`grep -n retired_missing apps/bridge-agent/src`). Bump
`apps/bridge-agent/package.json` version (patch). Gate: extend test "counts
records the cloud keeps…" (`missing-file-reconciliation.test.ts:60`) to assert
`flagged`.

### Phase 3 — deploy and prove (lead-only throughout: live-proof judgment)

**Step 12 — Deploy and live proof.** Merge Phase 1 PR → confirm
`deploy-supabase.yml` run succeeded for the merge SHA. Merge Phase 2 PR → request
the bridge update (`AGENT_UPDATE_REQUEST`; see `docs/deployment.md`) and confirm
the bridge heartbeat reports the new version. Then prove, saving outputs to
`docs/verification/issue-1198-review-findings/<UTC>/`:
- **Duplicate invariant** (read-only SQL via Supabase MCP `execute_sql`):
  count of `(filename, file_size, quick_hash)` groups and of `content_sha256`
  groups with more than one live row whose members are *both* hidden-then-
  restored — must not increase vs a baseline taken before deploy.
- **Peer case**: on the NAS, in a scratch folder under a scanned root, create
  two byte-identical copies of a small test PDF, let a scan ingest them, delete
  both, let the next full scan run; both records must be live with
  `file_missing_at` set (query by path). Then restore one copy → mark clears.
  Clean up the test files afterwards (records stay, per D1 — note their ids in
  the findings file). NAS file operations follow the
  `synology-long-running-operations` skill if they run long.
- **Clear-only call**: the scan log for the restore pass shows a clear count
  from the reconcile path (not only from ingest), and `flagged` appears in the
  scan summary.
You'll know it worked when the findings file shows all three checks passing.

**Step 13 — Corrective restore pass (lead-only).** With the improved proof
live, call admin-api `restore-missing-assets` over every asset whose latest
history row is `retired-missing-from-nas` (select ids read-only first; send in
batches of 200; record `restored`, `skipped` per reason). This restores records
hidden only because a hint-only "survivor" was actually different artwork (F15).
Re-run the duplicate-invariant query afterwards. Save outputs beside Step 12's.
Production data change, reversible via the ledger rows; no approval is needed
(standing rule), but stop if `rehidden_duplicate` is non-zero on the first batch
and investigate before continuing.

**Step 14 — Docs and close-out (lead-only).** Update `docs/KNOWN_QUIRKS.md` #81
"Simply deleted files" paragraph and `docs/WORKER_LOGIC.md` §3.5 to state the
D2 proof; regenerate `docs/INDEX.md` with `ai-doc-health --repo . --fix-index`
if any header changed. Mark STATUS rows with artifacts. Comment on each of the
four issues with the PR links and the verification folder, including the §6.3
evidence for the moot findings, signed `$AI_GH_SIGNATURE`; close them.

### Adversarial cases (bridge-supplied input to the hide/restore paths)

| Input | Hostile/odd case | Test |
|---|---|---|
| `assets[].asset_id` batch | two ids of the same artwork, both files gone | 3a |
| `assets[].asset_id` batch | 2 peers + a live third copy elsewhere | 3b |
| survivor candidate | record itself marked `file_missing_at` | 3c |
| survivor candidate | same hint, different `content_sha256` (template collision #51) | 3d |
| survivor candidate | inode match, hint differs (renamed file) | 2 |
| `clear_missing_flags` only, `assets` absent/empty | empty `IN ()` | 4 |
| flag update fails mid-way | partial counts lost | 5 |
| restore id | latest history row is a purge, older row is the marker | 6 |
| restore chunk | update reports error but committed | 7b |
| concurrent restore | twin restored by another request between check and write | 7c |
| `retire-stale-asset` pair | renamed content-identical survivor | 8a |
| `retire-stale-asset` pair | survivor marked missing | 8b |
| ids for `.not("id","in",…)` | non-UUID string | 3e |
| bridge hasher | stream error (EIO / file vanished mid-read) | 10 |

### 10. Tests required

Edge (vitest project `edge-functions`; new file
`supabase/functions/_shared/agent-handlers/retire-missing-handler.test.ts`,
reusing the `makeDb` fake pattern from `restore-missing-handlers.test.ts:10-90`,
extended for `.is`, `.not`, `.order`):

- 2 "uses the inode tier when the hint differs"
- 3a "keeps and flags both records when two copies of one artwork are both gone in one batch"
- 3b "hides peers when a live third copy exists"
- 3c "a record marked no longer on the NAS never proves a survivor"
- 3d "hint match with different content hashes is not proof"
- 3e "rejects a non-UUID id before building the exclusion filter"
- F3 "keeps a record with no surviving copy" (baseline)
- 4 "clear-only call reads nothing and clears marks"
- 5 "flag failure returns counts done so far"
- in `restore-missing-handlers.test.ts`: 6 "skips a record whose latest history row is a purge";
  7a "writes a receipt and counts restored"; 7b "reconciles ledger when update errors but committed";
  7c "re-hides a record when a twin became live during the request"
- in `stale-asset-retirement.test.ts` / a new `retire-stale` handler test:
  8a "accepts a renamed content-identical survivor"; 8b "refuses a survivor marked missing"
- 9 "stale candidates include inode and content matches, de-duplicated, capped at 20"
- `file-identity.test.ts`: hint refused on conflicting content hashes.

Bridge (`tsx --test`, listed in `apps/bridge-agent/package.json` `test`):
- 10 "a failing content hash still ingests with content_sha256 null"
- 11 extended `missing-file-reconciliation.test.ts:60` asserting `flagged`.

Must stay green: `npm test` (root vitest), `npm test --prefix apps/bridge-agent`,
the edge type-check in CI.

### 11. Constraints, standing rules, gotchas

- Feature branch + PR to protected `main`; the AI merges once required checks
  pass; AI reviews are advisory and never block.
- No schema changes here (shared-db only, via `popcre/shared-db`).
- `assets` UPDATEs fire heavy per-row search-index triggers: keep chunks of 10
  (restore) / existing `RETIRE_MISSING_CHUNK`; never widen them.
- `relative_path` is unique; a returning file revives its own record only when
  the latest history row is a revivable marker (`agent-api/index.ts:1320-1331`).
- `quick_hash` is sampled and collides for template-derived files (KNOWN_QUIRKS
  #51); never treat it as proof alone when content hashes disagree.
- Bridge ships only via version bump + update request; edge deploys on merge.
  Deploy edge (Phase 1) before bridge (Phase 2).
- No hold, retry delay or wait longer than 30 minutes anywhere.
- Every GitHub post is signed with `$AI_GH_SIGNATURE`. Times to humans in EST.
- Commit only your own files; work in a worktree.

### 12. Access and environment

- `gh` authenticated as `u2giants` for `u2giants/popdam3`.
- Supabase MCP (`execute_sql`, read-only queries) on project `qsllyeztdwjgirsysgai`.
- admin-api calls for Step 13 use the service-role key from 1Password vault
  `vibe_coding` (item listed in `docs/1password.md`; never paste the value).
- NAS access for Step 12's test files: see `docs/agents-reference.md` →
  Credentials and environment (SSH item in `vibe_coding`).
- Local: `npm ci`; `npx vitest run --project edge-functions`;
  `npm test --prefix apps/bridge-agent`.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when:
- [ ] Phase 1 PR merged, CI green, `deploy-supabase.yml` succeeded for its SHA.
- [ ] Phase 2 PR merged, bridge heartbeat shows the bumped version.
- [ ] All §10 tests exist and pass.
- [ ] Step 12 and Step 13 findings saved under `docs/verification/issue-1198-review-findings/`.
- [ ] Docs updated (Step 14), STATUS rows cite artifacts.
- [ ] Issues 1215, 1223, 1248, 1256 commented and closed.

Risks and rollback:
- Step 3 makes hiding stricter → fewer proven moves hidden; stale duplicates
  stay visible a little longer. Safe direction. Rollback = revert PR.
- Step 7's re-hide could hide a record a concurrent request restored. It only
  fires when a live twin with the same artwork exists, so no artwork disappears.
- Step 13 changes production rows; reversible through ledger rows.
- Step 9 offers more stale candidates; the bridge still confirms on disk.

Genuinely uncertain:
- Whether PostgREST rejects empty `in.()` today (F9). Irrelevant after Step 4.
- How many records Step 13 restores. Criterion: if more than 1,000 restore on
  the first full pass, sample 20 and confirm by `content_sha256` that each
  differs from its former hint survivor before continuing.

### Self-audit (2026-11-25)

1. *Could a brand-new session execute this without asking anything?* Yes — §2
   explains the app and terms, §5 gives exact code locations on `787c20b8`,
   §9 gives per-step files, behaviour and gates, §12 access. Gap found and fixed
   during drafting: the truncated 1223 findings — now stated explicitly in §6.2
   with what was tried (§7).
2. *Does it carry every piece of background, including what was ruled out?*
   Yes — §6.2 records the reinterpreted findings, §6.3 the moot ones with
   evidence, §7 the rejected approaches (RPC lock, capping the hash, dropping
   the hint tier, dedupe of missing-only peers).
3. *Is the goal clear enough to steer by?* Yes — §1 states the owner's words,
   the three outcomes, and "keep the record visible" as the safe direction;
   §8 D1–D6 lock the decisions that follow from it.

### Lead launch prompt

```
You are the lead implementing docs/plans/issue-1215-1223-1248-1256-missing-file-review-findings.md
in u2giants/popdam3. Read AGENTS.md, then the plan's STATUS and all of Parts 1–2
before touching code. Work in your own worktree on a feature branch.

Do yourself (lead-only): Steps 1, 3, 6, 7, 8, 12, 13, 14, and verify every
helper result. Hand to your helper, in order, after Step 1 lands locally:
Step 2, then 4 and 5, then 9; in Phase 2, Steps 10 and 11.

Your helper is your own tool's smaller model — Haiku (high effort) for Claude
Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro.
Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design
decisions; no merges, pushes or GitHub posts; come back to you when a step's
stop-and-ask trigger fires; you take the step back after 30 minutes stuck.

Checks you run yourself: npx vitest run --project edge-functions; npm test
--prefix apps/bridge-agent; the CI edge type-check; then the Step 12 live
proof. Phase 1 (edge) merges and deploys before Phase 2 (bridge). Update the
STATUS table with artifacts as each step lands. The goal in §1 wins over any
step: when unsure, keep the record visible and never leave two live records
for one file.
```
