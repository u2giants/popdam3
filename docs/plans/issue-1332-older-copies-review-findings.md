---
summary: "One plan that fixes every open review finding on the admin Older copies list: right file, restore for deleted files, honest saved-by names, NAS and Seafile lookups that cannot stall the list."
kind: plan
status: open
read-when: "implementing any fix to Older copies (restore from snapshot, saved-by names, Seafile/SMB/Synology Drive lookups) or closing issues 1332, 1338, 1339, 1344, 1352, 1357"
---

# Older copies: close the open review findings (one plan for six issues)

Covers, in full: [u2giants/popdam3#1332](https://github.com/u2giants/popdam3/issues/1332),
[#1338](https://github.com/u2giants/popdam3/issues/1338),
[#1339](https://github.com/u2giants/popdam3/issues/1339),
[#1344](https://github.com/u2giants/popdam3/issues/1344) (with folded duplicate
[#1349](https://github.com/u2giants/popdam3/issues/1349)),
[#1352](https://github.com/u2giants/popdam3/issues/1352),
[#1357](https://github.com/u2giants/popdam3/issues/1357).

Handoff registering this plan: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-older-copies-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-older-copies-plans.md).

## STATUS

Written 2026-11-25 against `origin/main` at `787c20b8`. Nothing implemented.

| Step | What | Issues | State |
|---|---|---|---|
| 1 | Per-asset job store (state survives remounts, no stale results) | 1332 f2, 1344 f5, 1338 "not introduced" | ⬜ open |
| 2 | Style panel: one active file, section names its target, no blank wrapper | 1332 f1, f4 | ⬜ open |
| 3 | Restore button for deleted files; unique row keys; names for merged rows | 1338 f1, f3 | ⬜ open |
| 4 | Saved-by display precedence and no label flip | 1352 f3, 1357 f6 | ⬜ open |
| 5 | Seafile lookup: longest prefix, blank names, timeouts, ambiguous mixes | 1344 f1–4, 1349, 1357 f8 | ⬜ open |
| 6 | NAS-log lookup: lenient save read, real transfers only, newest first, memo, logging, trimmed config | 1352 f1, f3–5, 1357 f1, f3–5, f7 | ⬜ open |
| 7 | Bridge: no duplicate concurrent listing or restore; deadlines fit the UI wait | 1352 f1–2, 1332 f2 | ⬜ open |
| 8 | Tests (all named below) | 1332 f3, 1338 f2, 1339 all, 1344 f6, 1352 f6, 1357 f2, f6, f8 | ⬜ open |
| 9 | Docs, config docs, 1Password check, plan §2.6 wording | 1338 f1, 1352 f5 | ⬜ open |
| 10 | Ship (web + edge + bridge 1.17.4) and live proof | all | ⬜ open |

A fresh session starts at step 1. Steps 5 and 6 can run in parallel with 1–4
(different files). Step 7 depends on step 6 (same files). Step 8 tests are
written with the step they cover; step 8 is the final sweep.

---

## Part 1 — Why

### 1. The ultimate goal

An admin at POP Creations who opens a file in PopDAM and clicks **Find older
copies** must get, within about a minute, a list of the file's earlier versions
from the office NAS snapshots, each with an honest "who saved it" line when that
is actually known, and must be able to restore any of them **beside** the
current file — including when the file was deleted from the NAS, which is the
case where a restore matters most. The list must always be about the file the
admin is looking at, a restore must never silently happen twice, and a slow or
broken name lookup (Seafile or the NAS log service) must never cost the admin
the list or the restore.

**If a step below conflicts with this goal, the goal wins — stop and flag it
in the issue.** In particular: a wrong name is worse than no name; a missing
list is worse than a list without names; an extra restored copy is tolerable
but a restore of the wrong file is not.

### 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed
consumer-product artwork. Design files (PSD, AI, PDF) live on an office
Synology NAS; a **bridge agent** on the NAS (`apps/bridge-agent/`, Node,
Docker) scans them; a React web app (`src/`, Vite, deployed by Coolify at
`https://dam.designflow.app`) lets the team browse, tag and manage them;
Supabase edge functions (`supabase/functions/`, Deno) are the backend; the
shared Postgres is owned by `popcre/shared-db` (never changed from this repo).
Repo `u2giants/popdam3`, protected branch `main`. Read `AGENTS.md` first.

**Older copies** (issue #963, shipped in PR #971 and refined since) is an
admin-only section in two places:
- the single-file detail panel `src/components/library/AssetDetailPanel.tsx:904`;
- the style-group flyout, Files tab, `src/components/library/StyleGroupDetailPanel.tsx:1198-1206`.

Flow: the browser calls admin-api `request-snapshot-versions` → a pending
request is written to `admin_config` (`supabase/functions/_shared/snapshot-requests.ts`)
→ the bridge picks it up on its next heartbeat (every 30 s; commands are
dispatched by `apps/bridge-agent/src/commands/heartbeat-commands.ts:113-130`)
→ `apps/bridge-agent/src/handlers/snapshot-commands.ts` lists Synology btrfs
snapshots (`#snapshot/GMT…` folders) via `snapshot-tools.ts`, adds NAS-log
names via `saved-by-nas.ts`, and reports back → the browser polls every 2 s
for up to 60 s (`OlderCopiesSection.tsx:41-42,108-116`). Restore is the same
round trip with `request-snapshot-restore`; it copies the snapshot file next to
the current file as `name (restored YYYY-MM-DD[ n]).ext` with exclusive create
(`snapshot-tools.ts:141-186`) — it never overwrites.

**Saved-by names** come from two independent sources:
- **Seafile** (the company's file-sync server). Admin-api `get-saved-by` runs
  `supabase/functions/_shared/saved-by.ts`: it reads each path's Seafile file
  history and matches a snapshot version to a Seafile revision by size and
  time. A revision by the NAS sync account (`nas-sync`) means "saved on the
  NAS itself", name unknown.
- **The NAS's own logs** (SMB, File Station, Synology Drive) through the
  read-only `nas-api` service of the separate `synology-monitor` project
  (`POST /file-activity`). The bridge calls it in `saved-by-nas.ts`; config
  comes from `admin_config.NAS_FILE_ACTIVITY` `{url, token}` sent in the
  heartbeat (`supabase/functions/agent-api/index.ts:229,816`), with env vars
  `NAS_FILE_ACTIVITY_URL` / `NAS_FILE_ACTIVITY_TOKEN` as fallback.

Terms: **snapshot version** = one distinct (path, size, mtime) seen in one or
more consecutive snapshots; **merged version** = the web app's grouping of
versions with identical size+mtime across folder moves (`mergeVersions`,
`OlderCopiesSection.tsx:61-80`); **candidates** = every relative path the asset
is known to have had (DB function `dam_asset_path_candidates`).

### 3. What triggered this work

The advisory AI reviewer runs on every merged PR and files a `review-finding`
issue. Six such issues on the Older copies PRs are open; the automatic fixer
deferred all of them (`fixer-deferred` — "merged-source analysis cannot publish
a correction"), so none is fixed. The labels are not proof of anything. Issue →
PR reviewed:

| Issue | Reviewed PR | Topic |
|---|---|---|
| #1332 | #1331 Style panel: show Older copies for the selected file | wrong target file, lost in-flight state, no tests, blank wrapper |
| #1338 | #1336 one entry per real version, plain date labels | deleted file loses its restore button; tests; key collision |
| #1339 | #1337 test the list wording for a moved, unchanged file | fake timers leak on failure; missing wording/restore cases |
| #1344 | #1343 show who saved each version (Seafile) | NaN window, first-match prefix, blank names, no timeout, stale results, tests; plus folded #1349 (#1348: mixed person/NAS-sync revisions, tests) |
| #1352 | #1351 names for SMB and Synology Drive saves (bridge 1.17.2) | slow NAS API stalls the list; duplicate concurrent runs; weak match shown as fact; silent failures; undocumented config; tests |
| #1357 | #1356 name transfers and late saves (bridge 1.17.3) | strict read drops save names; `prev_taken_at` untested; lone write called a transfer; oldest-first deadline; Drive window without action filter; UI precedence untested; nas-api contract assumptions; Seafile matcher untested |

**The review texts are truncated at the source** ("[findings truncated]" in
the issue body and in the PR comment): #1332 after finding 4's first bullet,
#1339 after the verdict, #1352 inside finding 6, #1357 after finding 8. The
fixer comments on each issue summarise the full findings (read them with
`gh issue view <n> -R u2giants/popdam3 --comments`). Step 8 adds a sweep for
the truncated tails' visible categories (test gaps). Nothing else is known
about the cut text; do not invent findings for it.

How to reproduce (production, as an admin): open `https://dam.designflow.app/library`,
switch to Groups, open a style group that has two or more files, go to the
Files tab — on first open the Older copies section targets the cover file,
not necessarily the highlighted row; press the hero arrow and the section
jumps back to the cover file while the highlight moves.

### 4. Scope

In:
- Every finding listed in the STATUS table, in the files named in §9.
- Tests for each.
- Docs/config documentation for `NAS_FILE_ACTIVITY`.
- Shipping web app, edge functions and a bridge build, and live proof.

**NOT in this plan:**
- Any change to snapshot listing semantics in `listSnapshotVersions`
  (`snapshot-tools.ts:71-114`) other than nothing — only its tests are added.
- The `synology-monitor` `nas-api` service itself (separate repository). If
  its contract differs from what this plan assumes, record it; do not change it.
- Two-phase reporting (list first, names later) — rejected, see §7.
- Realtime delivery of snapshot requests (`realtime-watcher.ts`) — rejected, §7.
- Any database/schema change. None is needed. If one seems needed, stop: it
  belongs in `popcre/shared-db`.
- The folder-shortening plan's other phases (`plan_folder_shortening_snapshot_restore.md`);
  only its §2.6 sentence about the restore button is touched (step 9).
- PopSG mode (Older copies is DAM-only).

---

## Part 2 — What we already know

### 5. Current state of the code (origin/main `787c20b8`, bridge 1.17.3)

All referenced code is merged and deployed; nothing is half-done.

- `src/components/library/OlderCopiesSection.tsx` (247 lines): all state is
  local `useState` (`:104-106`); `poll()` loops 60 s with no cancellation
  (`:108-116`); `find()` fires `get-saved-by` without a request token
  (`:128-135`); `sameAsCurrent` (`:83-85`) hides the restore button (`:211`);
  row key `source_path|first_snapshot` (`:188`); saved-by lookup uses the
  merged row's `source_path` only (`:186`, `savedByKey` `:31`); display
  precedence `:193-202` (NAS "save" > Seafile person > NAS transfer > "Saved
  on the office NAS"); a blank NAS name renders "Saved by  (…)".
- `src/components/library/StyleGroupDetailPanel.tsx`: the section target is
  `selectedAssetId ?? localPrimaryId ?? orderedAssets[0]` (`:1200`); the row
  highlight is `isViewing` = carousel index (`:1071`); hero arrows and the
  thumbnail strip set `selectedAssetId` to `null` (`:487,497,527`); a row
  click sets `selectedAssetId` and moves the carousel only if the file has a
  thumbnail (`:1086-1087`); the file-scoped features use `detailAsset =
  currentThumbAsset ?? groupAssets[0]` (`:212`); the `pt-3` wrapper renders for
  non-admins (`:1202`); `key={sel.id}` remounts the section on every change
  (`:1203`).
- `src/pages/Index.tsx:372`: `AssetDetailPanel` is rendered without `key`, so
  Older copies state carries across asset switches.
- `supabase/functions/_shared/saved-by.ts` (166 lines): eligibility filter
  per account (`:82-89`) — **this already fixes #1344 finding 1 (NaN now fails
  every comparison) and #1349's shadowing scenario as originally described**,
  but neither has a test, and a person's late revision plus a sync revision is
  still resolved to the person (§6). `toSeafile` is first-match (`:66-73`);
  `fileHistory` has no timeout and no try/catch (`:102-125`); `name: ""` is
  kept (`:117`).
- `apps/bridge-agent/src/handlers/saved-by-nas.ts` (183 lines): a shared 45 s
  deadline exists (`:47,164`) — partial fix of #1352 finding 1; per-read timeout
  15 s; versions iterated oldest-first (`:166`); `readEvents` returns `null`
  on any `errors.smb`/`errors.filestation` for both reads (`:150,170`);
  `pickTransfer` accepts zero arrivals (`:108-114`); Drive events have no
  action or size check (`:70-71`); empty username accepted; no logging; config
  not trimmed (`:119-124`).
- `apps/bridge-agent/src/handlers/snapshot-commands.ts`: no in-flight guard;
  the heartbeat re-delivers a pending request every beat (`heartbeat-commands.ts:113-130`,
  `agent-api/index.ts:857`), so a run longer than 30 s starts a duplicate —
  for restore too, which can produce a second `(restored … 2)` file.
- `supabase/functions/_shared/snapshot-requests.ts`: a pending request blocks
  a new one for 120 s (`:48-52`, 409); only the first report with the
  matching `request_id` is stored (`:117-119`).
- Tests: `src/components/library/OlderCopiesSection.test.tsx` (admin gating,
  two `mergeVersions` cases, one wording test with leaky fake timers `:54,71`);
  `supabase/functions/_shared/saved-by.test.ts`; `apps/bridge-agent/src/handlers/saved-by-nas.test.ts`;
  `apps/bridge-agent/src/handlers/snapshot-tools.test.ts`;
  `src/components/library/StyleGroupDetailPanel.mockup.test.tsx` (never opens
  the Files tab).
- `NAS_FILE_ACTIVITY` appears in no doc (`docs/configuration.md`,
  `apps/bridge-agent/.env.example`, `docs/agents-reference.md` env table).

### 6. Key findings and root cause

1. **Two sources of truth for "the selected file" in the style panel** (#1332
   f1). `selectedAssetId` and `carouselIndex` diverge; the section follows one,
   the highlight the other. Root cause: carousel handlers null the selection
   instead of setting it, and rows without thumbnails are not in the carousel.
2. **Component-local job state** (#1332 f2, #1344 f5, Index.tsx no key). A
   remount loses a running restore's confirmation while the bridge still
   completes it; an unmounted or switched component can receive a late
   `get-saved-by` answer for another asset. One fix covers all three: job
   state lives outside the component, keyed by asset id, and every async
   answer is applied only if its request token is still current.
3. **"Same as the current file" compares against the DB row, not the NAS**
   (#1338 f1). A deleted file keeps its size and mtime with `file_missing_at`
   set (`agent-api/index.ts:1633-1672`), so the only copy that matters loses
   its button.
4. **The Seafile matcher's remaining ambiguity** (#1349). With a person's
   same-size revision at T+300 s and a sync-account revision at T+600 s, the
   current code picks the person (closer, alone among people) — but the sync
   revision says the NAS itself had that content, so the person is not proven.
   A late person match must be the **only** eligible revision of any account.
5. **The NAS-log answer is weaker than Seafile's but wins in the UI** (#1352
   f3): no size check for Drive, missing SMB size skips the check, no action
   check for Drive, 300 s window vs Seafile's 120 s.
6. **Bridge timing does not fit the UI wait** (#1352 f1): up to 30 s for
   heartbeat delivery + listing + up to 45 s of NAS-log reads > the browser's
   60 s, so a degraded NAS API makes the whole list time out.
7. **Duplicate concurrent runs** (#1352 f2) come from re-delivery of a pending
   request on every heartbeat with no in-flight guard in the bridge.
8. **Strict log reads for the save read** (#1357 f1) drop names whenever the
   API reports a partial error, though a found save event is still valid.
9. **Lone same-size write treated as a transfer** (#1357 f3): `arrivals.length
   === 0` is allowed.

### 7. Approaches considered and rejected

- **Hoisting state into StyleGroupDetailPanel only** (#1332 reviewer's
  suggestion) — fixes one caller, not `AssetDetailPanel` or the Index.tsx
  no-key case. Rejected for the per-asset store (step 1).
- **Adding `key={asset.id}` to `AssetDetailPanel` in Index.tsx** — fixes stale
  results but loses a running restore's confirmation exactly like #1332 f2, and
  remounts the whole panel (scroll, tabs). Rejected; the store makes it unnecessary.
- **Always showing the restore button** (#1338 alternative) — undoes the
  owner-visible simplification from PR #1336 for the normal case. Rejected in
  favour of "hide only when it matches **and** the file is not marked missing".
- **Two-phase report (list now, names later)** — needs a second admin_config
  result key, a new agent-api report action and UI merging; more moving parts
  for the same outcome as a shorter name deadline. Rejected.
- **Realtime delivery of `SNAPSHOT_VERSIONS_REQUEST`** — would remove the
  30 s wait but touches the realtime watcher's subscription set; out of scope.
  Rejected for now; the UI timeout is raised instead.
- **Concurrency for NAS-log reads** — would multiply load on `nas-api`, which
  #1352 f2 already flags. Rejected; memoize identical reads instead.
- **Showing both Seafile and NAS-log names when they disagree** — confusing to
  the admin; Seafile's commit author is the stronger evidence. Rejected.
- **Fake-timer tests with locale-specific dates fixed by pinning `TZ`** in
  vitest config — affects every test. Rejected; fixtures at 12:00 UTC are
  timezone-safe for date-only assertions.

### 8. Design decisions

Locked (2026-11-25, this plan; do not relitigate):
- **L1** Job state for Older copies lives in a module-level store keyed by
  `assetId` (`useSyncExternalStore`), with a monotonically increasing request
  token per asset; a late answer whose token is stale is dropped.
- **L2** Style panel: one active file `activeAsset = orderedAssets.find(a =>
  a.id === selectedAssetId) ?? currentThumbAsset ?? orderedAssets[0]`. Carousel
  handlers set `selectedAssetId` to the asset they show (never `null`). Row
  highlight is `asset.id === activeAsset?.id`. The section header names the
  file ("Older copies — <filename>").
- **L3** Restore button hidden only when `sameAsCurrent && !fileMissingAt`.
  When the file is marked missing, the matching row says "same as the last
  copy PopDAM saw (no longer on the NAS)" and keeps its button.
- **L4** Row key `${first_taken_at}|${size}|${mtime}`.
- **L5** Saved-by precedence: Seafile person name > NAS-log "save" > NAS-log
  "transfer" > "Saved on the office NAS" > nothing. No saved-by line renders
  until the `get-saved-by` call settles (success, failure, or 15 s), so labels
  never flip. Blank names never render.
- **L6** Seafile: a person's late match (|d| > 120 s) requires that the
  eligible set contains no other revision of **any** account; longest
  `pathPrefix` wins; blank `name`/`email` become `null`; each history fetch
  has a 10 s timeout and failures keep revisions already fetched; the whole
  lookup has a 25 s budget.
- **L7** NAS log: save read lenient (uses `events` even when `errors` is set),
  transfer read strict; a transfer needs exactly one arrival (create / upload /
  copy / move), where arrivals by the same user within 120 s count as one;
  events with an empty username are ignored; SMB/File Station events without a
  size count only when every same-path event in the window has one username;
  versions processed newest-first; identical reads memoized per listing;
  one `logger.warn` per listing summarising failures (never the token);
  `url`/`token` trimmed, blank = disabled.
- **L8** NAS-log total deadline 20 s (was 45 s); browser wait 90 s (was 60 s).
- **L9** Bridge in-flight guard: a `request_id` already running is not started
  again, for both listing and restore.

Open (implementer's judgment, criteria given):
- **O1** Drive action filter: which Drive `action` values mean "saved". Get
  real values from a `nas-api` sample (step 6). Accept only values that mean a
  content write/upload; if Drive reports no usable action, keep Drive events
  but require that no other username has a same-path Drive event in the
  window. Record the observed values in the code comment.
- **O2** Exact wording strings may be polished, but must keep their meaning
  and stay plain English for non-technical admins.

---

## Part 3 — How to build it

Work on a feature branch from current `origin/main`, e.g.
`fix/older-copies-review-findings`. One PR is fine; two PRs (web+edge, then
bridge) are also fine.

### 9. Steps

**Step 1 — Per-asset job store.** `lead-only` (reshapes async state that
decides which file is restored).
- New file `src/components/library/older-copies-store.ts`: a `Map<string,
  Job>` where `Job = { state: State; savedBy: Record<string, SavedByInfo>;
  namesSettled: boolean; token: number }`, `subscribe`/`getSnapshot` for
  `useSyncExternalStore`, `startFind(assetId, call)`, `startRestore(assetId,
  call, version)`. Move `poll`, `find`, `restore` out of `OlderCopiesInner`
  (`OlderCopiesSection.tsx:108-154`) into it. Each start increments `token`;
  every `set` checks the token captured at start and drops the write if it
  changed. A running restore cannot be started twice for the same asset
  (button disabled while `restoring`, store refuses).
- `TIMEOUT_MS` → 90 000 and the message → "The NAS helper did not answer within 90 seconds".
- `OlderCopiesInner` reads its job with `useSyncExternalStore` by `assetId`;
  `confirm` dialog state can stay local.
- Behaviour: switching files and back shows the earlier result or the running
  spinner; a restore started on file A, then a switch to B, then back to A,
  shows "Restored as …" when it lands; a late answer never appears on another file.
- Gate: tests `older copies store keeps a running restore across remount` and
  `drops a late saved-by answer after a new search` (step 8) pass.

**Step 2 — Style panel single active file.** `lead-only` (decides the restore target).
- `StyleGroupDetailPanel.tsx`: add `activeAsset` (L2) near `:210-212`; change
  hero arrows (`:487,497`) and thumbnail strip (`:527`) to
  `setSelectedAssetId(thumbStrip[newIdx].id)`; `isViewing` (`:1071`) →
  `asset.id === activeAsset?.id`; the section block (`:1198-1206`) uses
  `activeAsset`. Leave `detailAsset` (`:212`) for other features unless it
  differs from `activeAsset` only for no-thumbnail rows — if so, point
  `detailAsset` at `activeAsset` too and check checkout bar, AI tag and Open
  folder still show for the clicked file (judgment: the goal is one file per
  panel; if a feature truly needs the carousel asset, keep it and note why).
- Remove `key={sel.id}` (the store makes it unnecessary).
- `OlderCopiesSection` accepts `className` and renders its own wrapper div so
  non-admins get nothing (`:95-99`); the panel passes `className="pt-3 col-span-full"`.
- Header (`OlderCopiesSection.tsx:162-164`): "Older copies — <basename of relativePath>".
- Gate: tests `style panel Files tab: Older copies follows the clicked row`,
  `… follows the hero arrows`, `… targets a no-thumbnail row it highlights`,
  `… renders nothing for a non-admin` pass; screenshot of the Files tab with
  the highlighted row and the header filename matching.

**Step 3 — Restore for deleted files; keys; merged-row names.** `helper-ok`
(edits named exactly). Stop-and-ask: if the asset object (generated type in `src/integrations/supabase/types.ts:749`; read by `AssetDetailPanel.tsx:609`) lacks `file_missing_at` in
the style panel's asset query (its rows may select fewer columns), or it is not selected there.
- Add prop `fileMissingAt?: string | null` to `Props` (`:87-93`); pass
  `asset.file_missing_at` from `AssetDetailPanel.tsx:904` and the style panel.
- `:211` → `{(!current || fileMissingAt) && (…button…)}`; `:191` label per L3.
- `:188` key per L4.
- `MergedVersion` gains `members: SnapshotVersion[]` (set in `mergeVersions`);
  the saved-by lookup for a row takes the first member found in `savedBy`
  (newest member first). `mergeVersions` must not mutate its inputs.
- Gate: tests in step 8 group "restore availability" and "mergeVersions" pass.

**Step 4 — Saved-by precedence, no flip.** `helper-ok`. Stop-and-ask: any
case where L5 order seems wrong for real data.
- Replace `:193-202` with a pure exported function
  `savedByLine(nas, seafile, settled): string | null` implementing L5, and
  render its result. Blank or whitespace names → treated as absent.
- Gate: unit tests `savedByLine` table (step 8).

**Step 5 — Seafile lookup.** `lead-only` (attribution logic decides what
admins are told about who saved a file).
- `supabase/functions/_shared/saved-by.ts`:
  - `matchVersion` (`:79-100`): add `Number.isFinite(t)` early return
    `{via:null,name:null}`; skip revisions with non-finite `ctime`/`size`;
    late person match per L6 (`eligible.length === 1` after dedupe by author,
    including sync accounts).
  - `toSeafile` (`:66-73`): choose the longest matching `pathPrefix`.
  - `fileHistory` (`:102-125`): `AbortSignal.timeout(10_000)`; wrap each page
    in try/catch and return what was fetched; `name`/`email` trimmed, `""` → `null`.
  - `lookupSavedBy`: 25 s overall budget; stop fetching further paths when spent.
  - Keep the candidate-path allow-list (`:141-146,155`) exactly.
- Gate: `npx vitest run supabase/functions/_shared/saved-by.test.ts` green with the new cases.

**Step 6 — NAS-log lookup.** `lead-only` (attribution logic; external contract).
- First, get a real sample to settle O1 and the contract (#1357 f7): with the
  `NAS_FILE_ACTIVITY` url/token from `admin_config` (read it with a read-only
  query through the Supabase MCP — `select value from admin_config where key='NAS_FILE_ACTIVITY'`
  — never print the token), POST `/file-activity` for a 6-hour window and a
  known filename. Record (without names/tokens) the `action` values per
  `source`, the `errors` keys, whether one copy logs several arrival actions,
  and the max window. If `nas-api` is unreachable, implement L7 as written,
  keep Drive's no-other-username rule, and record "contract unverified" in
  the issue.
- `apps/bridge-agent/src/handlers/saved-by-nas.ts`:
  - `readEvents` (`:129-154`) gains `strict: boolean`; near read
    (`:170`) lenient, transfer read (`:174`) strict.
  - `pickSaver` (`:64-80`): skip blank usernames; Drive action filter (O1);
    SMB/FS without size per L7.
  - `pickTransfer` (`:97-115`): require one arrival after collapsing
    same-user arrivals within 120 s.
  - `addNasSavers` (`:156-183`): iterate newest `first_taken_at` first, return
    in the original order; memoize `readEvents` by `since|until|contains|strict`;
    `LISTING_DEADLINE_MS` = 20 000; count failures (non-OK status, timeout,
    parse error, `errors` key, deadline) and `logger.warn("NAS saved-by lookups incomplete", {counts})`
    once per listing.
  - `setNasFileActivity`/`currentEnv` (`:118-124`): trim; blank → disabled.
- Gate: `cd apps/bridge-agent && npm test` green with the new cases (step 8).

**Step 7 — Bridge in-flight guard.** `helper-ok`. Stop-and-ask: if heartbeat
commands carry no `request_id`.
- `snapshot-commands.ts`: module-level `Set<string>` of running request ids;
  `handleSnapshotVersions` and `handleSnapshotRestore` return immediately if
  the id is present, add it on start, remove it in `finally`.
- Bump `apps/bridge-agent/package.json` version 1.17.3 → 1.17.4 (required to
  publish the bridge, `AGENTS.md` → Standing rules).
- Gate: test `a re-delivered request id does not start a second run` (listing and restore).

**Step 8 — Tests.** `helper-ok` for writing the listed cases. Stop-and-ask:
any listed case that fails against the implementation (that is a bug to bring
back, not a test to bend). See §10 for names.

**Step 9 — Docs.** `helper-ok`. Stop-and-ask: 1Password item not found.
- `docs/configuration.md` admin_config table: row `NAS_FILE_ACTIVITY` —
  `{url, token}` for the read-only synology-monitor `nas-api` "saved by"
  lookup; optional; sent to the bridge in the heartbeat. Bridge Agent section
  (`:184`): env fallback `NAS_FILE_ACTIVITY_URL`/`NAS_FILE_ACTIVITY_TOKEN`.
- `apps/bridge-agent/.env.example`: both variables, empty.
- `docs/agents-reference.md` → "Credentials and environment" (`:325`) environment table: same.
- 1Password: confirm the token is stored in vault `vibe_coding` (search item
  titles for "nas-api", "synology-monitor", "file-activity"). If absent, store
  it per the `secrets-to-1password` skill with a durable title and note its
  location (never the value) in `docs/configuration.md`.
- `plan_folder_shortening_snapshot_restore.md:311` (§2.6): note that the
  restore button is hidden for the version equal to the current file unless
  the file is marked missing (L3).
- Run `ai-doc-health --repo . --fix-index` if this changes `docs/INDEX.md`.

**Step 10 — Ship and prove.** `lead-only` (live-proof judgment).
- PR to `main`; required checks green; merge (the AI merges; reviews advisory).
- Verify the frontend deployed SHA, the `deploy-supabase.yml` run, and the
  bridge publish (`publish-bridge-agent.yml`) for 1.17.4; ask the NAS to update
  via the admin update request (`UPDATE_REQUEST`) and confirm the heartbeat
  reports 1.17.4 and the new `build_sha`.
- Live proof on `https://dam.designflow.app` as an admin (screenshots saved
  under `docs/verification/<date>-older-copies/`):
  1. Style group with ≥2 files: section header filename equals the highlighted
     row on first open, after an arrow, and after clicking a no-thumbnail row.
  2. Start a restore, switch files, switch back: "Restored as …" shows; the
     NAS folder has exactly one new `(restored …)` file.
  3. A file shown "No longer on the NAS": its matching version has a Restore button.
  4. A version with a known Seafile saver shows "Saved by <name> (Seafile)"
     with no flicker.
  5. The list appears within 90 s.
  Delete the test restored files afterwards only by moving them to the NAS
  recycle bin (recoverable).

Adversarial cases (trust boundary: data from Seafile, `nas-api`, the browser,
and server-supplied paths):

| External input | Hostile case | Test that proves it |
|---|---|---|
| Seafile `ctime` | missing / non-numeric (NaN) | `saved-by.test.ts` › `ignores revisions with an unreadable commit time` |
| version `mtime` from browser | invalid date string | `saved-by.test.ts` › `an unreadable saved time matches nothing` |
| Seafile `user_info.name`/`email` | `""` or spaces | `saved-by.test.ts` › `blank names fall back to email, then to nothing` |
| Seafile response | hangs | `saved-by.test.ts` › `a hung history request times out and keeps earlier revisions` |
| Seafile response | 500 / non-JSON on one path | `saved-by.test.ts` › `one failing path does not lose the others` |
| Seafile pagination | `next_start_commit` loops forever | `saved-by.test.ts` › `stops after MAX_PAGES` |
| `HELPER_SEAFILE_LIBRARIES` | nested prefixes in either order | `saved-by.test.ts` › `the longest library prefix wins` |
| browser `versions[].source_path` | path the asset never had / `..` | existing `looks up the current and old paths, never a path the asset never had` (keep green) |
| `nas-api` event `username` | `""` | `saved-by-nas.test.ts` › `ignores events with no username` |
| `nas-api` event `size` | missing / 0 on SMB | `saved-by-nas.test.ts` › `an SMB event without size names a saver only when one person touched the file` |
| `nas-api` body | `errors.smb` set with a valid Drive save | `saved-by-nas.test.ts` › `a Drive save survives an SMB read error` |
| `nas-api` body | `errors.smb` during a transfer read | `saved-by-nas.test.ts` › `a transfer is not named when the log was not fully read` |
| `nas-api` | non-OK, timeout, non-JSON | `saved-by-nas.test.ts` › `failed reads are logged once and never fail the listing` |
| `nas-api` | slow for every call | `saved-by-nas.test.ts` › `the shared deadline names the newest versions first` |
| `nas-api` | one copy logged as create + copy | `saved-by-nas.test.ts` › `two arrivals by one person within two minutes are one transfer` |
| `nas-api` | lone same-size write, no arrival | `saved-by-nas.test.ts` › `a single write without an arrival is not a transfer` |
| `NAS_FILE_ACTIVITY` config | whitespace-only token | `saved-by-nas.test.ts` › `a blank token disables the lookup` |
| heartbeat | same request re-delivered while running | `snapshot-commands.test.ts` › `a re-delivered request id does not start a second run` |

### 10. Tests required

Web (`npx vitest run --project src`), `src/components/library/OlderCopiesSection.test.tsx`:
- Fix leak (#1339 f1): `afterEach(() => { vi.useRealTimers(); })`.
- `single snapshot wording: "Kept in the snapshot of <date>"`.
- `restore button shows for a version that differs from the current file`.
- `restore button hidden for the version equal to the current file`.
- `restore button shows for the matching version when the file is no longer on the NAS`.
- `version count line: one version / N versions, newest first`.
- `"was in:" lists only folders other than today's`.
- `rows have unique keys when two merged versions share first_snapshot` (assert no React duplicate-key warning via `console.error` spy).
- `get-saved-by is called with every merged member's path`; `a get-saved-by failure leaves the list intact`.
- `savedByLine` table: Seafile person beats NAS save; NAS save beats transfer; transfer wording; "Saved on the office NAS"; blank names → null; nothing before settled.
- `mergeVersions`: unsorted input; earlier entry ending later keeps its `last_snapshot`/`source_path`; `last_snapshot` and `source_path` move together; inputs not mutated; `members` populated.
- Fixtures use 12:00 UTC so date assertions are timezone-safe.

Web, new `src/components/library/older-copies-store.test.ts`:
- `keeps a running restore across remount`; `drops a late saved-by answer after a new search`; `refuses a second restore for the same asset while one runs`.

Web, new `src/components/library/StyleGroupDetailPanel.olderCopies.test.tsx`
(mock `useIsAdmin`/`useAgentStatus` as `src/test/library-mode-queries.test.tsx:23-24`
does; reuse fixtures from `StyleGroupDetailPanel.mockup.test.tsx`):
- `Older copies follows the clicked row`, `follows the hero arrows`,
  `targets a no-thumbnail row it highlights`, `single-file group shows the section`,
  `renders nothing for a non-admin`.

Edge (`npx vitest run --project edge-functions`), `supabase/functions/_shared/saved-by.test.ts`:
- Every Seafile row of the adversarial table, plus:
- `a person's late revision with a sync revision also eligible is ambiguous` (person T+300, sync T+600 → null) (#1349).
- `a sync revision beyond 12 hours matches nothing` (#1349).
- `a person's same-size commit between 15 minutes and 12 hours is ignored, so a sync revision there means a NAS save` (#1357 f8).
- `pagination follows next_start_commit`; `a non-OK Seafile response returns no revisions for that path`.

Bridge (`cd apps/bridge-agent && npm test`), `saved-by-nas.test.ts`: every NAS row of the table plus
`Drive events only for save actions` (O1) and `results keep the original version order`.
`snapshot-tools.test.ts` (#1357 f2): `prev_taken_at is absent for a version first seen in the oldest snapshot`,
`equals the previous snapshot otherwise`, `is the snapshot before the reappearance after a gap`.
New `snapshot-commands.test.ts` (add it to the `test` script list in
`apps/bridge-agent/package.json:11`): the in-flight guard for listing and restore.

Must stay green: `npm test` (root vitest, both projects), `npm run lint`,
`npx tsc --noEmit`, `cd apps/bridge-agent && npm test && npx tsc --noEmit`.

### 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`. The AI merges after required
  checks pass; AI reviews are advisory and never block.
- No database or schema change; none is needed (shared-db rule in `AGENTS.md`).
- The bridge ships only with a version bump; it updates on request.
- Never log or print the `nas-api` token or Seafile token; never put names
  from real logs into commits or issues.
- Restore must stay "beside, never overwrite" (`COPYFILE_EXCL`); do not touch
  `restoreFromSnapshot` logic.
- The candidate-path allow-list in `lookupSavedBy` and the server-side
  `source_path` validation in `snapshot-requests.ts:72-97` are security
  boundaries — keep them.
- `useIsAdmin` is the gate; non-admins must render nothing.
- UI work needs visual verification (screenshots), not only tests.
- A pending request blocks new ones for 120 s (409); with the 90 s UI wait,
  a timed-out search can still 409 for ~30 s — keep the existing message.
- `src/common/` inside apps is a generated copy; edit `packages/agent-common/src` if ever needed (not expected).
- Doc headers: any new Markdown file needs the four-key header.
- Times in issue comments: EST/EDT (America/New_York).

### 12. Access and environment

- `gh` CLI authenticated as `u2giants` for issues/PRs in `u2giants/popdam3`.
- Supabase MCP (project `qsllyeztdwjgirsysgai`) for read-only queries of
  `admin_config` (`NAS_FILE_ACTIVITY`, `HELPER_SEAFILE_*`).
- 1Password vault `vibe_coding` via the 1Password MCP; admin login for the
  web app: use the existing admin account the owner uses with SSO (do not
  enter passwords; if a sign-in is needed, ask the owner to sign in in the browser pane).
- Local: `npm ci` at the root, `npm test`; bridge: `cd apps/bridge-agent && npm ci && npm test`.
- Production web app: `https://dam.designflow.app/library`.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when:
- [ ] Steps 1–9 merged to `main` via PR; all §10 tests exist and pass in CI.
- [ ] Frontend deployed SHA = merge SHA; edge functions deployed; bridge 1.17.4
      running on the NAS (heartbeat `build_sha` matches `BRIDGE_LATEST_BUILD.sha`).
- [ ] Live proof items 1–5 (step 10) captured under `docs/verification/`.
- [ ] Each of #1332, #1338, #1339, #1344, #1352, #1357 commented with the PR
      and evidence, then closed; this plan's STATUS updated or the plan marked done.

Risks and rollback:
- Store bug shows a wrong file's results → rollback: revert the PR (Coolify
  older `:<sha>` image for the frontend).
- Stricter NAS-log rules name fewer savers → acceptable by the goal (wrong
  name is worse than none).
- Bridge 1.17.4 misbehaves → previous `:stable` tag; Older copies is admin-only
  and isolated from scanning.

Open questions:
- O1 Drive action values — decided from the step 6 sample.
- Whether `nas-api` caps windows at 6 hours — confirm from the sample; if
  different, change `CHUNK_SEC` with a comment citing the observation.

---

## Self-audit (2026-11-25)

1. *Could a brand-new session execute this without asking?* Yes: §2 explains
   the app and the whole request/heartbeat/poll flow; §5 gives exact
   `file:line` state at `787c20b8`; §8 locks every design choice (L1–L9) and
   gives criteria for the two open ones; §9 names files, behaviour and a gate
   per step; §10 names every test; §12 gives access. Gap found and fixed while
   drafting: the merged-row saved-by lookup missing other members' paths (added
   to step 3).
2. *Does it carry the background, including what was ruled out?* Yes: §3
   maps each issue to its PR and notes the truncated review texts; §6 records
   the root causes, including which findings current code already fixed
   (#1344 f1, #1349 shadowing) and what remains; §7 lists eight rejected approaches.
3. *Is the goal clear enough for judgment calls?* Yes: §1 ranks the
   trade-offs (wrong name < no name; no list < list without names; extra
   restored copy tolerable, wrong-file restore not) and says the goal wins.

## Lead launch prompt

```text
You are the lead implementing docs/plans/issue-1332-older-copies-review-findings.md
in u2giants/popdam3. Read AGENTS.md, then the whole plan, STATUS first. Do not
re-plan; locked decisions L1–L9 stand.

You do yourself: steps 1, 2, 5, 6 and 10, and you verify every helper result
by running its gate. Hand to your helper, in this order once their
dependencies are merged into your branch: step 3 and 4 (after step 1),
step 7 (after step 6), step 8 test writing alongside each step, step 9.

Your helper is your own tool's smaller model — Haiku (high effort) for Claude
Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro.
Never a full-strength model. Rules for the helper: return finished work or an
evidenced blocker; make no design decisions; no merges, pushes or GitHub posts;
bring the step's stop-and-ask trigger back to you instead of deciding; if it is
stuck for 30 minutes, take the step back. Delegation sheet:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md

Checks you run yourself: npm test, npm run lint, npx tsc --noEmit,
cd apps/bridge-agent && npm test && npx tsc --noEmit; the step 10 live proof
on https://dam.designflow.app with screenshots. Branch, PR to main, merge when
required checks pass, then comment and close each of the six issues with
evidence, signed with $AI_GH_SIGNATURE. Update this plan's STATUS as you go.
```
