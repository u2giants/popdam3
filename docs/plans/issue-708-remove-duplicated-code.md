# Plan: Remove duplicated code (split from #471) (u2giants/popdam3#708)
Issue: https://github.com/u2giants/popdam3/issues/708
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch | ⬜ open | |
| 2 | One `useNasConfig` hook; three `["nas-config"]` queries replaced | ⬜ open | all three still present (§5) |
| 3 | `admin-api/index.ts` imports `isTransientError`/`withRetry` from `_shared/admin-utils.ts` | ⬜ open | copies at `admin-api/index.ts:234-257` |
| 4 | One `generatePairingCode()`; four inline generators replaced | ⬜ open | four copies (§5) |
| 5 | Shared search-resolver factory for `useAssets`/`useStyleGroups` | ⬜ open | five mirrored functions each (§5) |
| 6 | Decide and record `meta-direct` Windows-only answer on #708 | ⬜ open | intended (§6.5) — needs the one-line record on the issue |
| 7 | Agent drift: move `logger` and `tenant-supervisor` into `packages/agent-common`; record the other four as intentionally divergent | ⬜ open | drift counts in §5 |
| 8 | PR, CI, merge, deploy verification | ⬜ open | |
| 9 | Live proof on #708, close | ⬜ open | `- [ ] live proof` stays on #708 |

**Where a fresh session starts:** Step 1, after confirming PR #713 and the #471 dead-code PR (`docs/plans/issue-471-dead-code-removal.md`) are merged — this plan touches `admin-api/index.ts` and the agents, which both of those also touch. Phases: Steps 2–5 are the frontend/edge-function phase (one PR); Steps 6–7 are the agent phase and may be a second PR if context runs short (natural cut point after Step 5).

---

## 1. The ultimate goal

The same logic exists in several places in PopDAM: three copies of the "read NAS host/IP/share from `admin_config`" query, two copies of the transient-error retry helper, four copies of the pairing-code generator, two near-identical search-resolution pipelines, and six agent modules that started as copies and have drifted apart. Every copy is a place a bug gets fixed once and left in the others. When this plan is done, each of those behaviours has exactly one implementation (or, where two copies must stay different, the difference is written down as intended), and nothing a user sees changes.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular: consolidation must not change behaviour. If merging two copies would have to pick one behaviour over another and the two differ in a way users could notice (e.g. the `nas-config` cache time, or the search fallback columns), keep the behaviour of the copy that runs the most-used screen, write the choice into §8, and do not "improve" while consolidating.

## 2. What this application is

PopDAM is POP Creations' digital asset manager (https://dam.designflow.app) with a sibling style-guide app, PopSG (https://sg.designflow.app), in the same repo `u2giants/popdam3` (branch `main`, developed on the production VPS `hetz`). Stack: Vite + React + TypeScript (`src/`), Supabase edge functions (`supabase/functions/`, project `qsllyeztdwjgirsysgai`), Railway worker (`apps/worker/`), Synology bridge agent (`apps/bridge-agent/`, Docker on `edgesynology1`), Windows render agent (`apps/windows-agent/`). `packages/agent-common/` already holds code shared by the two agents; `packages/agent-common/sync.mjs` copies it into each agent's `src/common/` (gitignored) at `prebuild`/`pretest`. Read `AGENTS.md` first.

## 3. What triggered this work

The 2026-10-21 codebase audit (PR #458, `docs/audit-2026-10-21.md`) listed duplicated code under #471. On 2026-11-04 the duplicates were split into #708 so #471 could stay a single dead-code PR. Issue #708's body (2026-11-04) lists: three `nas-config` queries sharing a cache key with different shapes, search helpers in `useAssets`/`useStyleGroups`, retry helpers in `admin-api/index.ts`, pairing-code generators, drifting agent modules (`pdf-text-sampler`, `pdf-backfill`, `uploader`, `tenant-supervisor`, `api-client`, `logger`), and a question: "Confirm whether `meta-direct` being Windows-only is intended." The Users screens duplicate is explicitly left to `plan_user_permissions_designflow_cutover.md`.

## 4. Scope

**In:** the five duplicate families above plus the `meta-direct` answer. One behaviour-preserving PR for frontend + edge functions, optionally a second for the agents.

**NOT in this plan:**
- `UsersAndInvitations.tsx` vs `UsersTab.tsx` (374 + 370 lines). Owned by `plan_user_permissions_designflow_cutover.md` step 7 (its lines 90-91, 115, 181). Do not touch either file here.
- Dead-file removal (#471 → `docs/plans/issue-471-dead-code-removal.md`).
- Making `pdf-text-sampler`/`pdf-backfill`/`uploader`/`api-client` identical between agents. §6 shows they diverged on purpose; this plan records the reason, it does not merge them.
- Any change to the search ranking, fallback columns, or RPC names. The search consolidation is structural only.
- Any `shared-db` change (none is needed).
- Bridge agent release/version bump beyond what Step 7 needs (if Step 7 ships, bump `apps/bridge-agent/package.json` version in the same commit per `AGENTS.md` line 438; the NAS applies it only on request).

## 5. Current state of the code (verified 2026-11-04 on worktree tip `01fcfc34`, containing `origin/main` `4409e2d3`)

### A. Three `["nas-config"]` queries — all present
| File:line | Error handling | Missing-key behaviour | `staleTime` |
|---|---|---|---|
| `src/components/library/AssetDetailPanel.tsx:207-225` | `if (error) throw error` | defaults `nas` / `0.0.0.0` / `share` | 5 min |
| `src/components/library/StyleGroupDetailPanel.tsx:119-134` | ignores error | same defaults | 5 min |
| `src/components/library/AssetGrid.tsx:76-92` (`function useNasConfig`) | throws | returns `null` when any key missing | 60 s |

All three use `queryKey: ["nas-config"]`, so React Query serves whichever shape was cached first to the other two callers — a component expecting defaults can receive `null`, and vice versa. The `NasConfig` interface lives in `src/lib/path-utils.ts:6`. There is no `src/hooks/useNasConfig.ts` today.

### B. Retry helpers copied into `admin-api`
`supabase/functions/admin-api/index.ts:234-257` defines `isTransientError` and `withRetry` (plus a `TRANSIENT_ERROR_PATTERNS` array just above, ending `:232`) byte-for-byte identical to `supabase/functions/_shared/admin-utils.ts:50-73` (exported). `admin-api/index.ts` does not import `admin-utils.ts` at all (imports at `:1-88`). `withRetry` is used at `admin-api/index.ts:330`.

### C. Four pairing-code generators
Identical 16-char `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` + `XXXX-XXXX-XXXX-XXXX` generators at:
- `supabase/functions/_shared/admin-handlers/agent-handlers.ts:631-637`
- `supabase/functions/_shared/admin-handlers/agent-handlers.ts:689-695`
- `supabase/functions/_shared/admin-handlers/agent-handlers.ts:887-893` (slightly reordered statements, same output)
- `supabase/functions/_shared/admin-handlers/install-bundle-handler.ts:37-44`
Each is followed by its own 15-minute `expiresAt` computation and an `agent_pairings` insert. (The `crypto.getRandomValues(bytes)` at `agent-handlers.ts:26` is a 32-byte API-key generator, not a pairing code — leave it.)

### D. Search helpers mirrored between hooks
`src/hooks/useAssets.ts` and `src/hooks/useStyleGroups.ts` each define the same five functions with only the column list, RPC name and cache differing:
| `useAssets.ts` | `useStyleGroups.ts` |
|---|---|
| `buildAssetSearchFilter` `:56-68` | `buildStyleGroupSearchFilter` `:81-93` |
| `buildAssetFallbackFilter` `:71-73` | `buildStyleGroupFallbackFilter` `:96-98` |
| `resolveAssetSearch` `:80-87` | `resolveStyleGroupSearch` `:105-112` |
| `shouldFallbackFromFullTextRpc` `:96-107` (matches `search_assets_full_text`) | `shouldFallbackFromFullTextRpc` `:114-125` (matches `search_style_groups_full_text`) |
| `fetchAssetFullTextIds` `:109-150` (cache `assetSearchIdCache` `:20`, limit `FULL_TEXT_SEARCH_LIMIT` `:11`) | `fetchStyleGroupFullTextIds` `:127-…` |
Both already import the genuinely shared pieces from `src/lib/dam-search.ts` (`searchAccessStatus`, `expandFallbackTerms`, `fetchSearchIds`, `getSearchMode`, `sortByRank`, …). Existing tests: `src/test/asset-search.test.ts` (`buildAssetSearchFilter`, 3 cases) and `src/test/style-group-search.test.ts` (`buildStyleGroupSearchFilter`, 6 cases).

### E. Agent modules that drifted
`diff apps/bridge-agent/src/<m>.ts apps/windows-agent/src/<m>.ts | grep -c '^[<>]'`:
| Module | bridge lines | windows lines | differing lines |
|---|---|---|---|
| `logger.ts` | 28 | 60 | 38 (Windows adds `LOG_LEVEL` filtering and a 200-line ring buffer `getLogTail`, used by `windows-agent/src/index.ts:19`) |
| `tenant-supervisor.ts` | 206 | 199 | 95 |
| `uploader.ts` | 175 | 115 | 119 |
| `pdf-text-sampler.ts` | 526 | 529 | 209 |
| `pdf-backfill.ts` | 277 | 401 | 354 |
| `api-client.ts` | 627 | 526 | 803 |
Both agents still import all six (`bridge-agent/src/index.ts:17-32`, `windows-agent/src/index.ts:19-22,1482`). `packages/agent-common/src/` currently holds `bounded-read.ts`, `indra-ocr.ts`, `ingestion-rules.ts`, `path-containment.ts` (+ tests) — the consolidation mechanism already exists.

### F. `meta-direct` route
`apps/windows-agent/src/pdf-text-sampler.ts:144-148`: `callAiVision` first checks `pdf_extraction` starts with `meta-direct/` and, if so, requires `aiConfig.directPdfVision` (a callback set only by `apps/windows-agent/src/style-guide-pdf-backfill.ts:39` to `api.transcribeStyleGuidePdfPage(job, page)`, an authenticated, content-lease-bound `agent-api` request). `apps/bridge-agent/src/pdf-text-sampler.ts:130-141` has no such branch (ScaleDown, then OpenRouter). Tested at `apps/windows-agent/src/pdf-text-sampler.test.ts:14`.

### Already landed
Nothing on #708 is consolidated on `main` yet. All six families above are still present.

## 6. Key findings

1. **The `nas-config` cache-key collision is a latent bug, not just duplication.** `AssetGrid.useNasConfig` returns `null` for missing keys while the two panels return defaults; the shared key means the panels can receive `null` and render `undefined` paths. The fix is one hook with one shape (§8 LOCKED: the defaults shape, since both detail panels — the screens where a user copies a path — rely on it).
2. `admin-utils.ts` already exports the retry helpers; the copy in `admin-api/index.ts` was never wired to it. The `roleQueryAttempts: 3` comment at `admin-api/index.ts:140` ("replaces the old withRetry() around the role query") is unrelated; leave it.
3. The pairing generators differ only in statement order; one `generatePairingCode(): { code, expiresAt }` in `agent-handlers.ts` (exported, imported by `install-bundle-handler.ts`) reproduces all four. Keep the 15-minute TTL in the helper so it cannot drift either.
4. The search hooks already share the hard parts through `src/lib/dam-search.ts`; what remains is a parameterised resolver (`columns`, `rpcName`, `docType`, `limit`, `cache`). The behaviour-pinning tests already exist for the filter builders; the resolver needs new ones (§10).
5. **`meta-direct` Windows-only is intended.** Direct Meta PDF transcription requires an agent-api content lease (`transcribeStyleGuidePdfPage`) that only the Windows agent's style-guide PDF backfill obtains; `docs/MODEL_RULES.md` (the "PopSG PDF transcription also honors a direct Meta selection" paragraph after line 53) documents exactly this: "The Windows agent uses an authenticated, active-content-lease-bound `agent-api` request". The whole PDF/.ai backfill was moved off the NAS to the Windows VM deliberately (`apps/windows-agent/src/pdf-backfill.ts:1-12`: "relocated to the on-LAN Windows VM so ALL text-extraction CPU … stays off the Synology NAS"). Adding the route to the bridge would re-introduce NAS-side AI work. Answer for the issue: intended; record it (Step 6) and do not port it.
6. The four large agent modules (`pdf-text-sampler`, `pdf-backfill`, `uploader`, `api-client`) diverged because the two agents have different jobs (bridge: scan/thumbnail/ingest on Linux Docker; Windows: render + text extraction over SMB with Inkscape/Tesseract/Indra). `pdf-backfill` differs by 354 of ~400 lines; it is not a drift to repair, it is two programs. Only `logger` and `tenant-supervisor` are small, same-purpose and mergeable through `packages/agent-common`.
7. Agent tests run with `tsx --test` per `apps/*/package.json` (`pretest` syncs `agent-common`), and the bridge `test` list is explicit — a new shared test must be appended to BOTH `test` scripts.

## 7. Approaches considered and rejected

- **Give the three `nas-config` queries different cache keys** (`["nas-config","grid"]` …). Rejected: three copies remain and three fetches happen; the single hook is smaller.
- **Keep `AssetGrid`'s `null` shape as the canonical one.** Rejected: the detail panels copy paths with defaults today; switching them to `null` would change what a user sees when a key is unset. Defaults shape wins (locked).
- **Merge the search hooks into one `useSearchableList` hook.** Rejected: assets and style groups have different filter application (`applyFilters` `useAssets.ts:237` vs `applyStyleGroupFilters` `useStyleGroups.ts:172`), counts and realtime invalidation; only the resolver layer is duplicated.
- **Port `meta-direct` to the bridge for symmetry.** Rejected: see §6.5.
- **Copy `agent-common` as an npm workspace package.** Rejected: `sync.mjs` was chosen (its header comment) precisely to avoid adding a runtime package or changing packaging for the two different module systems (ESM bridge, CommonJS Windows).
- **Unify `api-client.ts`.** Rejected for this plan: 803 differing lines across 627/526; a real merge is a redesign with its own issue.

## 8. Design decisions

- **LOCKED (2026-11-04):** behaviour-preserving only; no user-visible change.
- **LOCKED:** `useNasConfig` returns the defaults shape (`{NAS_HOST:"nas", NAS_IP:"0.0.0.0", NAS_SHARE:"share"}` when unset), throws on query error, `staleTime` 5 min, `queryKey: ["nas-config"]`. `AssetGrid` adapts: where it previously tested `nasConfig === null`, it now tests for the default placeholder values (extract `isPlaceholderNasConfig(cfg)` in the same hook file so the rule has one home).
- **LOCKED:** `generatePairingCode()` lives in `agent-handlers.ts` and returns `{ code, expiresAt }` with the 15-minute TTL inside.
- **LOCKED:** `admin-api/index.ts` imports from `_shared/admin-utils.ts`; local copies and the local `TRANSIENT_ERROR_PATTERNS` are deleted.
- **LOCKED:** `meta-direct` stays Windows-only (reason §6.5).
- **LOCKED:** only `logger` and `tenant-supervisor` move to `packages/agent-common`; the other four stay per-agent with a header comment stating they are intentionally separate and why.
- **OPEN:** file name/location of the shared search resolver — `src/lib/dam-search-resolver.ts` is the suggestion; the criterion is that `dam-search.ts` stays free of React Query concerns.
- **OPEN:** whether the merged `logger` keeps the Windows ring buffer for the bridge too (harmless, 200 strings) or gates it behind an option. Prefer keeping it unconditionally — one code path.

## 9. The plan

### Phase 1 — frontend + edge functions (Steps 1–5, one PR)

**Step 1 — Worktree/branch.** `git worktree add ../popdam-708 -b claude/708-dedupe origin/main` after #713 and the #471 PR are merged. Gate: `git log --oneline -3` shows both merges.

**Step 2 — `useNasConfig`.**
- Create `src/hooks/useNasConfig.ts` exporting `useNasConfig(): NasConfig | undefined` (React Query, shape per §8) and `isPlaceholderNasConfig(cfg)`. Import `NasConfig` from `@/lib/path-utils`.
- `AssetDetailPanel.tsx:207-226`, `StyleGroupDetailPanel.tsx:119-135`: replace the inline `useQuery` with `const { data: nasConfig } = useNasConfig();`… (keep the variable name so the rest of each file is untouched).
- `AssetGrid.tsx:76-93`: delete the local `useNasConfig`; import the hook; replace `null` checks with `isPlaceholderNasConfig`.
- Gate: `grep -rn '"nas-config"' src` returns exactly one hit (the hook); `npm run typecheck` green; the `useNasConfig` tests in §10 pass; on https://dam.designflow.app the asset detail panel's "Copy path" still yields `\\<NAS_HOST>\<share>\…` (screenshot).

**Step 3 — Retry helpers.**
- `admin-api/index.ts`: add `import { isTransientError, withRetry } from "../_shared/admin-utils.ts";` next to line 11; delete lines ~218-257 (the `TRANSIENT_ERROR_PATTERNS` array and the two functions). Keep the call at `:330`.
- Gate: `grep -n "function withRetry\|function isTransientError\|TRANSIENT_ERROR_PATTERNS" supabase/functions/admin-api/index.ts` empty; `npm test` (edge-functions project) green; `deno fmt supabase/functions/admin-api` clean.

**Step 4 — Pairing codes.**
- In `agent-handlers.ts`, above `handleCreatePairingCode` (`:604`), add `export function generatePairingCode(now = new Date()): { code: string; expiresAt: Date }` using the exact alphabet and format from `:631-637`.
- Replace the three inline blocks (`:631-640`, `:689-697`, `:887-895`) with calls; in `install-bundle-handler.ts:37-46` import and call it.
- Gate: `grep -rn "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" supabase/functions` returns one line; tests in §10 pass; pairing a test agent from Settings → Pairing still yields a `XXXX-XXXX-XXXX-XXXX` code (screenshot).

**Step 5 — Search resolver.**
- Create `src/lib/dam-search-resolver.ts` exporting `createSearchResolver({ docType, columns, rpcName, limit })` that returns `{ buildSearchFilter, resolveSearch, shouldFallbackFromFullTextRpc }` with its own id cache (move the `SearchIdCacheEntry` type and TTL constant there).
- `useAssets.ts`: `const assetSearch = createSearchResolver({ docType: "asset", columns: ASSET_SEARCH_COLUMNS, rpcName: "search_assets_full_text", limit: 500 })`; keep `export const buildAssetSearchFilter = assetSearch.buildSearchFilter` so `asset-search.test.ts` and any importer keep working; delete `:56-150`'s duplicates. Same in `useStyleGroups.ts` for `buildStyleGroupSearchFilter`.
- Gate: both existing search test files pass unchanged; `grep -c "shouldFallbackFromFullTextRpc" src/hooks/*.ts` is 0; typing "spider" in the DAM library and in Style Groups returns the same first result as before the change (compare against a pre-change screenshot taken in Step 1).

**Cut point.** Commit Phase 1, open the PR (Step 8 applies), then decide whether Phase 2 fits in the same session; if not, write the handoff and continue in a fresh session, re-reading Phase 2 first.

### Phase 2 — agents (Steps 6–7)

**Step 6 — Record the `meta-direct` answer.** Post on #708 (signed with `$AI_GH_SIGNATURE`): "`meta-direct` on Windows only is intended: it needs the agent-api content lease that only the Windows style-guide PDF backfill holds (`windows-agent/src/style-guide-pdf-backfill.ts:39`), and PDF AI work was moved off the NAS on purpose (`windows-agent/src/pdf-backfill.ts:1-12`, `docs/MODEL_RULES.md` PopSG transcription paragraph)." Add the same sentence as a comment above `apps/bridge-agent/src/pdf-text-sampler.ts:130`. Gate: comment visible on the issue; bridge test suite still green.

**Step 7 — Move `logger` and `tenant-supervisor` to `packages/agent-common/src/`.**
- `logger.ts`: take the Windows version (superset) as the shared file; export `logger` and `getLogTail`. Delete both per-agent copies; change imports (`bridge index.ts:17` → `./common/logger.js`; windows `index.ts:19` → `./common/logger`; every other `from "./logger"` in both `src/` trees — `grep -rln 'from "./logger' apps/*/src`).
- `tenant-supervisor.ts`: diff the two (`95` lines differ); produce one file whose only inputs are the per-agent entry function and env names, passed as parameters to `runSupervisor`. If the diff reveals an agent-specific behaviour that cannot be parameterised in under ~20 lines, stop, leave `tenant-supervisor` per-agent, and record why in §7 — do not force it.
- Add header comments to the four remaining per-agent modules: "Intentionally separate from the <other> agent's copy: <one-line reason from §6.6>".
- Bump `apps/bridge-agent/package.json` version (same commit) because the image's runtime files changed.
- Gate: `npm run build --prefix apps/bridge-agent && npm test --prefix apps/bridge-agent` and the Windows equivalents green; `ls apps/bridge-agent/src/logger.ts apps/windows-agent/src/logger.ts` both missing; `publish-bridge-agent.yml` run succeeds after merge; the NAS container, once updated on request, still emits JSON log lines (`docker logs` sample on `edgesynology1`, following the NAS sudo ritual from memory).

**Step 8 — PR, CI, merge (each phase).** Verified commit identity; stage only own files; `gh pr create --base main`, signed, with the attribution line in force; `bin/ai-pr-wait <pr>` in the background; merge; confirm `publish-frontend.yml` + `deploy-supabase.yml` (Phase 1) / `publish-bridge-agent.yml` + `publish-windows-agent.yml` (Phase 2) runs for the merge SHA.

**Step 9 — Live proof on #708.** Post the Step 2, 4, 5 and 7 screenshots/outputs on #708, tick `- [ ] live proof`, close, signed.

## 10. Tests required

| Test file | Test name (behaviour) |
|---|---|
| `src/test/use-nas-config.test.ts` (new, jsdom, mock `supabase.from`) | "returns placeholder values when admin_config has no NAS keys"; "returns stored values and marks them non-placeholder"; "throws when the query errors" |
| `supabase/functions/_shared/admin-handlers/pairing-code.test.ts` (new) | "formats as four groups of four from the 32-char alphabet"; "expires fifteen minutes after now"; "never emits 0, O, 1 or I" (run 200 draws) |
| `supabase/functions/admin-api/retry-helpers.test.ts` (new, text contract) | "admin-api has no local retry helpers and imports them from admin-utils" |
| `src/test/dam-search-resolver.test.ts` (new) | "resolveSearch returns ids and no fallback when the RPC succeeds"; "returns undefined ids and a synonym-expanded fallback when the RPC fails with PGRST202"; "does not fall back on a 403 access error"; "caches ids per mode+term+limit until TTL"; "asset and style-group resolvers do not share a cache" |
| `src/test/asset-search.test.ts`, `src/test/style-group-search.test.ts` | unchanged, must stay green |
| `packages/agent-common/src/logger.test.ts` (new, `node --test`, appended to both agents' `test` scripts) | "filters below LOG_LEVEL"; "ring buffer keeps the last 200 lines"; "getLogTail(50) returns the newest 50" |
| Existing suites | root `npm run lint && npm run typecheck && npm test`; `apps/worker` build/test; `apps/windows-agent` test; `apps/bridge-agent` build/test; root `npm run build` |

Adversarial cases — the only external input touched is the search term (already sanitised in `buildSearchFilter`); the existing tests "ignores blank search text after sanitizing reserved OR characters" in both search test files cover the PostgREST `(),` injection case and must keep passing against the shared resolver. Pairing codes are generated, not parsed. No other trust boundary changes.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`; the AI merges.
- No `shared-db` change. None needed.
- Behaviour-preserving: take before/after screenshots for Steps 2, 4, 5.
- `src/common/` inside each agent is generated by `packages/agent-common/sync.mjs` and gitignored — never edit it; edit `packages/agent-common/src`.
- Bridge is ESM (`.js` import suffixes), Windows is CommonJS (no suffix); shared files must avoid import-suffix assumptions (see how `path-containment.ts` is imported in each agent).
- Bridge image changes need a `package.json` version bump in the same commit (`AGENTS.md` line 438); NAS applies on request only.
- Worktrees do not inherit commit identity — verify `git var GIT_COMMITTER_IDENT`.
- `deno fmt` check is advisory; keep it clean anyway.
- Secrets via 1Password `vibe_coding` only. Sign GitHub posts with `$AI_GH_SIGNATURE`. Times in EST.
- Do not touch `UsersTab.tsx` / `UsersAndInvitations.tsx`.

## 12. Access and environment

- Machine `hetz`; canonical repo `/worksp/popdam` is landing-only — use your own worktree.
- `gh` authenticated as `u2giants`. Supabase MCP read-only against `qsllyeztdwjgirsysgai`.
- Test logins: `docs/1password.md`; PopDAM admin tester item in vault `vibe_coding` (memory `project_popsg_tester_login`).
- NAS: `edgesynology1`, docker sudo per block (memory `feedback_nas_sudo_block_ritual`).
- Local: `npm ci && npm run dev`; agents: `npm ci --prefix apps/<agent> && npm run build --prefix apps/<agent>`.
- CI: `.github/workflows/ci.yml`. Deploys: `publish-frontend.yml` → GHCR → Coolify `qxj8a0j3tpa9lq4q5rs6pezy`; `deploy-supabase.yml`; `publish-bridge-agent.yml` → `ghcr.io/u2giants/popdam-bridge:stable`; `publish-windows-agent.yml` → release `windows-agent-latest`.

## 13. Definition of done, risks, open questions

Done when:
- [ ] One `useNasConfig`, one `withRetry`/`isTransientError` import, one `generatePairingCode`, one search resolver, shared `logger` (+ `tenant-supervisor` or a recorded reason not to) on `main`.
- [ ] §10 tests added and green; CI green; PR(s) merged; deploy workflows for the merge SHA green; Coolify shows the SHA; bridge image published.
- [ ] `meta-direct` answer recorded on #708 and in the bridge source comment.
- [ ] Before/after screenshots and outputs posted on #708; `- [ ] live proof` ticked; issue closed.
- [ ] This plan's STATUS table updated by the executor; `docs/audit-2026-10-21.md` "Still open" line no longer lists #708.

Risks and rollback:
- `nas-config` shape change makes `AssetGrid` show a placeholder path where it showed nothing. Mitigation: `isPlaceholderNasConfig`; rollback: revert the PR.
- Shared resolver changes a cache boundary and a stale id list leaks between asset and style-group searches. Mitigation: test "do not share a cache".
- Bridge logger merge changes log line format and breaks NAS log parsing. Mitigation: shared file is the Windows superset, which emits the same JSON shape; verify with `docker logs` after the on-request update.

Open questions: none business-meaning. Engineering OPEN items are in §8.

## Self-audit

1. **Could a brand-new session execute this without asking anything?** Yes: §5 gives every duplicate with file:line and the measured drift, §9 gives per-step edits, imports and gates, §10 names every test, §12 lists access, and the STATUS line says what must be merged first.
2. **Does it carry every piece of background and what was ruled out?** Yes: §6 records the cache-key bug, the lease-bound reason `meta-direct` is Windows-only, and why four agent modules are two programs rather than drift; §7 lists six rejected approaches with reasons; §8 marks locked vs open.
3. **Is the goal clear enough to steer by?** Yes: §1 says "one implementation, no behaviour change", and gives the tie-break rule (keep the behaviour of the most-used screen and write it down) for when consolidation forces a choice.
