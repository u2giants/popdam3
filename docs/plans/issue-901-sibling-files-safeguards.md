---
summary: Issue #901 plan: sibling files stay open to all users but only scanned files of the group folder; throttled scans. Read STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-901, ingest-sibling-images, list-sibling-images, sibling scan, admin-api user actions
---

# Plan: Find sibling files — open to everyone, but only for the group's own folder (u2giants/popdam3#901)

Issue: https://github.com/u2giants/popdam3/issues/901 (review finding on merged PR u2giants/popdam3#900 "Find sibling files: open to every signed-in user")
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-library-screen-plans.md)
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS — 2026-11-25

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Dependency-free access module + real routing test | ⬜ open | — |
| 2 | `list-sibling-images`: folder must be the group's folder; record requester; per-user throttle | ⬜ open | — |
| 3 | `ingest-sibling-images`: accept only paths from a completed scan of the group's folder; use the scan's own file facts | ⬜ open | — |
| 4 | Handler tests incl. adversarial table | ⬜ open | — |
| 5 | Web: show the new refusal messages | ⬜ open | — |
| 6 | PR, CI, merge, edge functions deployed | ⬜ open | — |
| 7 | Live proof (viewer login: normal flow works; crafted calls refused) | ⬜ open | — |

A fresh session starts at step 1.

## Part 1 — Why

### 1. The ultimate goal
Every signed-in PopDAM user can press **Find alternative images** on a style
group, see the JPG/PNG/PDF files sitting next to its art on the NAS, and add
the ones they pick to that group — exactly as Albert ruled on 2026-11-10
("make find sibling files available to all users"). What must **not** be
possible is using that opening to move arbitrary artwork into arbitrary
groups, invent fake file records, or flood the NAS agent with folder scans.
*If a step conflicts with this goal, the goal wins — stop and flag it.*

### 2. What this application is
PopDAM (`u2giants/popdam3`, branch `main`) — POP Creations' internal art
library at https://dam.designflow.app. Server actions run in the Supabase
edge function `supabase/functions/admin-api/index.ts` (one function,
`action` field selects the handler; deployed by `deploy-supabase.yml` on
merge). Handlers for this feature are in
`supabase/functions/_shared/admin-handlers/sibling-scan-handlers.ts` and use
the service-role client (bypasses row security). The **Bridge Agent**
(`apps/bridge-agent/`, runs on the Synology NAS) polls for scan requests
(`agent-api` actions `claim-sibling-scan` / `complete-sibling-scan`,
`supabase/functions/agent-api/index.ts:3036-3175`), lists the folder, and
writes the found images back. Requests and results live as JSON rows in
`admin_config` with key `sibling_scan_request_<uuid>`. UI:
`src/components/library/style-group-detail/FindAlternativeImages.tsx`.

### 3. What triggered this work
Advisory reviewer on PR #900 (confirmed by the fixer, still true on
`origin/main` `787c20b8`):
1. `ingest-sibling-images` (a write) is in `USER_ACCESSIBLE_ACTIONS`
   (`admin-api/index.ts:180-197`). `handleIngestSiblingImages`
   (`sibling-scan-handlers.ts:239-330`) sets `assets.style_group_id` for **any**
   existing `relative_path` the caller sends (`:283-292`) and inserts new
   `assets` rows with caller-supplied filename/size/thumbnail.
2. It never checks that the paths belong to the target group's `folder_path`
   or came from a scan.
3. `list-sibling-images` (`:43-128`) lets any user queue a NAS scan of **any**
   folder; only per-folder dedup, no per-user limit.
4. `src/test/filter-options-user-access.test.ts:32-40` only checks the action
   names appear in the source text; it does not prove routing.

### 4. Scope
In: the four findings; a small web message change. **NOT in this plan:**
reversing the owner ruling (all users keep access — locked); any shared-DB
schema change (none needed: all state stays in `admin_config` JSON);
Bridge Agent changes (it already writes `images[].relative_path` as
`<folder_path>/<rel>`, `apps/bridge-agent/src/handlers/sibling-scan.ts:97`);
roles/permissions redesign.

## Part 2 — What we already know

### 5. Current state
- Dispatch: `admin-api/index.ts:1965` `USER_ACCESSIBLE_ACTIONS.has(action) ?
  authenticateUser : authenticateAdmin`; `:2170` `handleListSiblingImages(body)`
  (no userId); `:2176` `handleIngestSiblingImages(body, userId)`.
- Folder normalisation (`:46`): trim, `\`→`/`, strip leading/trailing `/`;
  `hasParentSegment` rejects `..`.
- Scan result cache: completed/failed rows reused for 10 min
  (`SIBLING_SCAN_CACHE_TTL_MS`); stale claims fail after 10 min;
  `complete-sibling-scan` sweeps finished rows older than
  `SIBLING_SCAN_RETENTION_MS` (`_shared/scan-history.ts:62-71`).
- UI always sends `folder_path: group.folder_path, style_group_id: group.id`
  to list, and to ingest sends `style_group_id` + the selected scan images
  (`FindAlternativeImages.tsx:111-162`).
- Handler tests pattern: `supabase/functions/_shared/admin-handlers/*.test.ts`
  (vitest with `vi.mock` of `../admin-utils.ts` etc., e.g.
  `filter-options-handler.test.ts`).
- Nothing started; no branch.

### 6. Key findings
- The scan result row is server-written (by the agent via service auth), so
  it is a trustworthy allow-list of real NAS paths for a folder. Requiring
  ingested paths to be in it closes findings 1 and 2 without restricting who
  may use the feature.
- Folder in a list request can be forced to equal the group's own
  `style_groups.folder_path`, which removes folder enumeration (finding 3)
  without any rate table.

### 7. Rejected approaches
- **Restore designers/admins only** — contradicts the 2026-11-10 owner ruling. Rejected.
- **Trust client paths but check prefix `startsWith(group.folder_path)`** —
  still lets a user attach any file under that tree that the agent never
  listed, and invent filenames/sizes. Rejected; use the scan allow-list.
- **New rate-limit table** — needs a shared-DB migration for a small
  problem; per-user count over existing `admin_config` rows suffices. Rejected.
- **Hold/queue excess requests** — waits; refuse immediately instead (no
  holds over 30 min, owner rule).

### 8. Design decisions
- **Locked:** move `USER_ACCESSIBLE_ACTIONS` and a pure
  `requiredAuth(action): "user" | "admin"` into a new dependency-free
  `supabase/functions/_shared/admin-action-access.ts` (no imports), used by
  `admin-api/index.ts:1965`.
- **Locked:** `list-sibling-images` requires `style_group_id`, loads the
  group, normalises both folders the same way, and refuses (400 "This folder
  is not this style group's folder") unless they are equal. It stores
  `requested_by: userId` in the request value.
- **Locked:** per-user throttle: if the caller already has ≥ 3 rows with
  `status in (pending, claimed)` and `requested_by = userId` among the most
  recent 50 request rows, return 429 "You already have scans waiting; try
  again in a few minutes". Cached completed/pending results for the same
  folder are still returned without counting.
- **Locked:** `ingest-sibling-images` loads the group, finds the newest
  `completed` scan row whose `folder_path` equals the normalised group folder,
  builds a map `relative_path → image` from its `images`, and for each
  submitted entry: unknown path → per-file error "Not found in this group's
  folder scan; scan again"; known path → use the **scan's** `filename`,
  `file_size`, `thumbnail_url` (ignore client values). No completed scan →
  400 "Scan this folder first".
- **Locked:** relinking an existing asset found at a scanned path stays
  allowed (that is the feature's purpose: pull sibling files into the
  group).
- **Open:** throttle number (3) may be raised if live proof shows normal use
  hitting it; record the value in the test.

## Part 3 — How to build it

### 9. Steps
**Step 1 — Access module + routing test.** `helper-ok`. Stop-and-ask: if any
other file imports `USER_ACCESSIBLE_ACTIONS`. Create the module per §8; in
`admin-api/index.ts` replace the inline set and the `:1965` ternary with
`requiredAuth(action) === "user" ? …`. Replace the string test at
`src/test/filter-options-user-access.test.ts:32-40` with direct asserts:
`requiredAuth("ingest-sibling-images") === "user"` (and the other three),
`requiredAuth("purge-assets") === "admin"` (pick any real admin action from
the switch), unknown action → "admin". Gate: `npx vitest run
src/test/filter-options-user-access.test.ts` green; `deno check
supabase/functions/admin-api/index.ts` (or the repo's edge typecheck step in
CI) passes.

**Step 2 — List guard + throttle.** `lead-only` (trust boundary). Change
signature to `handleListSiblingImages(body, userId)` and the call at
`admin-api/index.ts:2170`. Implement §8 rules. Gate: step 4 rows L1–L5.

**Step 3 — Ingest allow-list.** `lead-only` (trust boundary; decides
production writes). Implement §8 in `handleIngestSiblingImages`. Keep the
50-image cap, parent-segment check, thumbnail host check (now applied to the
scan value). Keep the style-group counts refresh. Gate: step 4 rows I1–I7.

**Step 4 — Handler tests.** `helper-ok` (table below is exhaustive).
Stop-and-ask: if the mock chain can't express `.like().order().limit()`.
New `supabase/functions/_shared/admin-handlers/sibling-scan-handlers.test.ts`
mocking `../service-client.ts` (copy approach from
`filter-options-handler.test.ts`).

Adversarial cases (every row must name a passing test):

| # | Input | Hostile case | Expected | Test name |
|---|---|---|---|---|
| L1 | `folder_path` | folder of another group / arbitrary NAS folder | 400, no row written | `list refuses a folder that is not the group's` |
| L2 | `style_group_id` | missing or unknown id | 400 / 404, no row | `list requires a real style group` |
| L3 | `folder_path` | `..` segments, backslashes, trailing slash | `..` → 400; slashes normalised then compared | `list normalises and rejects parent segments` |
| L4 | repeated calls | 4th distinct pending request by same user | 429, no row | `list throttles a user with three waiting scans` |
| L5 | repeated calls | same folder already pending | returns existing request id, no new row, not counted | `list reuses a pending scan for the same folder` |
| I1 | `images[].relative_path` | path not in the scan result | per-file error, no insert/update | `ingest refuses paths the scan did not find` |
| I2 | `images[].relative_path` | path of an existing asset in another group, not in scan | not relinked | `ingest never relinks an unscanned asset` |
| I3 | `images[].filename/file_size/thumbnail_url` | forged values for a scanned path | stored values come from the scan | `ingest uses the scan's file facts` |
| I4 | `style_group_id` | group whose folder has no completed scan | 400 "Scan this folder first" | `ingest requires a completed scan` |
| I5 | `images` | 51 entries / empty / not array | 400 | `ingest enforces image count` |
| I6 | scan row | completed scan for a different folder only | treated as no scan | `ingest ignores scans of other folders` |
| I7 | normal | scanned path, existing asset elsewhere | relinked, reported "linked" | `ingest links a scanned existing asset` |

Gate: `npx vitest run supabase/functions/_shared/admin-handlers/sibling-scan-handlers.test.ts` all green.

**Step 5 — Web messages.** `helper-ok`. Stop-and-ask: if `call()` in
`FindAlternativeImages.tsx` swallows 429 bodies. Make sure 400/429 error text
from list reaches the existing `setError`/toast, and per-file ingest errors
count in the summary toast (already summarised). Gate: local run shows the
message (step 7).

**Step 6 — Land.** `lead-only`. Branch `claude/issue-901-sibling-guards`, PR,
CI green, AI merges; `deploy-supabase.yml` run green.

**Step 7 — Live proof.** `lead-only` (live, visual). With a **viewer** test
login on https://dam.designflow.app: Find alternative images on a group with
siblings → list appears → add one → toast "1 added/linked"; screenshot.
Then with the same login's token (browser devtools, the app's own session),
call `admin-api` `list-sibling-images` with another group's folder → 400;
`ingest-sibling-images` with a made-up path → per-file error. Record the
responses (no tokens) in `docs/verification/issue-901/` and cite in STATUS.

### 10. Tests
New: step 1 routing asserts; the 12 adversarial tests. Must stay green:
`src/test/sibling-scan-claim.test.ts`, `apps/bridge-agent/src/sibling-scan.vitest.ts`,
`npm test`, `npm run typecheck`, `npm run lint`.

### 11. Constraints and gotchas
- Owner ruling 2026-11-10 (all users) is locked — quote it, don't narrow it.
- No DDL; shared DB untouched. If you find you need a column, stop: that
  goes through `popcre/shared-db`.
- `admin_config` scan rows are swept after retention — "Scan this folder
  first" is the correct answer then, not a bug.
- Don't log tokens or full user ids in new log lines.
- Branch + PR; AI merges.

### 12. Access and environment
`gh` as `u2giants`. Supabase MCP for read-only checks of `admin_config`
rows (`select key, value->>'status', value->>'folder_path' from
admin_config where key like 'sibling_scan_request_%' order by updated_at
desc limit 10`). Viewer test login: 1Password `vibe_coding`, search
"PopDAM viewer"; if none exists, use an existing non-admin test user — do
not create accounts without asking.

### 13. Done, risks, open questions
Done: steps 1–7 ✅ with artifacts; PR merged; edge function deployed; issue
#901 commented and closed.
Risk: a user whose scan was swept gets "Scan this folder first" — they press
Find again. Rollback: revert the PR (deploy-supabase redeploys).
Open: none for the owner.

## Self-audit
1. Executable without questions? Yes — §5/§8 exact rules, §9 gates, full adversarial table.
2. Background and rejected paths carried? Yes — §3 four findings, §7 four rejections incl. the owner ruling.
3. Goal clear? Yes — §1: open to all, but only real files of the group's own folder.

## Lead launch prompt
```
You are the lead for u2giants/popdam3 issue #901. Read AGENTS.md, then
docs/plans/issue-901-sibling-files-safeguards.md (STATUS first). Hand steps
1, 4 and 5 to your helper; do steps 2, 3, 6 and 7 yourself (trust-boundary
and live work). Your helper is your own tool's smaller model — Haiku (high
effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo
Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design
decisions, never merges or posts, asks you when a stop-and-ask trigger
fires, and is taken back after 30 minutes stuck. You check every
adversarial row has a passing test, merge, confirm the edge deploy, and do
live proof.
```
