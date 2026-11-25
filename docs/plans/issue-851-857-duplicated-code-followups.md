---
summary: Issues #851 and #857 plan: finish the #708 duplicated-code cleanup — one NAS-config hook, the missing behaviour-pinning tests, one stray import, one duplicate test import, and the #708 plan's stale STATUS. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #851 or #857, or touching the nas-config queries, pairing codes, admin-api retry helpers, the shared full-text search helpers, the shared agent logger, or the shared Spaces uploader
---

# Plan: Finish the #708 duplicated-code cleanup (u2giants/popdam3#851, u2giants/popdam3#857)

Issues: https://github.com/u2giants/popdam3/issues/851 · https://github.com/u2giants/popdam3/issues/857
Handoff: [HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md](../../HANDOFF.d/2026-11-25T2102Z-al8960ofc-claude-dead-code-dedupe-plans.md)
Parent plan (closed issue #708): [issue-708-remove-duplicated-code.md](issue-708-remove-duplicated-code.md) — its §5–§8 are the design history; this plan supersedes its STATUS.
Written 2026-11-25 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Worktree + branch | ⬜ open | |
| 2 | One `src/hooks/useNasConfig.ts`; three inline queries replaced (#851 F1, F2) | ⬜ open | three copies on `origin/main` `787c20b8` (§5A) |
| 3 | Drop unused `isTransientError` import in `admin-api/index.ts` (#851 F8) | ⬜ open | `admin-api/index.ts:14` |
| 4 | Remove duplicate imports in `agent-api-transport.test.ts` (#857 F1) | ⬜ open | lines 1–2 vs 11–12 |
| 5 | Add the missing behaviour-pinning tests (#851 F5, #857 F2) | ⬜ open | §10 lists six files |
| 6 | Header on both `pdf-text-sampler.ts` files saying what stays per-agent (#851 F4 remainder) | ⬜ open | |
| 7 | Bring `issue-708-remove-duplicated-code.md` STATUS up to date (#851 F7) | ⬜ open | every row still ⬜ |
| 8 | PR, CI, merge, deploy check | ⬜ open | |
| 9 | Live proof, comment and close #851 and #857 | ⬜ open | |

Already resolved on `main` (verified 2026-11-25; do **not** redo): #851 F3 (`tenant-supervisor` kept per-agent with a recorded reason — `SEPARATE-BY-DESIGN` header in both `apps/*/src/tenant-supervisor.ts`), most of F4 (headers on `pdf-backfill.ts`, `api-client.ts`, `uploader.ts` in both agents), F6 (`meta-direct` bridge comment at `apps/bridge-agent/src/pdf-text-sampler.ts:63`); #857 F3 (envelope `error`/`finish_reason`/`summary` rejection, `meta-direct` fail-closed and "ScaleDown never goes to OpenRouter" are tested in `apps/bridge-agent/src/pdf-text-sampler.test.ts:11,34,102` and `apps/windows-agent/src/pdf-text-sampler.test.ts:10,21,44,63`). Shared logger and pairing-code generator already exist (`packages/agent-common/src/logger.ts`, `supabase/functions/_shared/pairing-code.ts`).

**Where a fresh session starts:** Step 1. Steps 2–7 are independent and can be done in any order inside one PR.

## 1. The ultimate goal

The same piece of logic should live in one place, and the places that were merged should be protected by tests so a later edit cannot quietly break one caller. Issue #708 did most of this in PRs #850 and #856. Two AI reviews (#851, #857) found what was left: the "where is the NAS" lookup is still copied three times (and the copies disagree on what to do when the lookup fails), the merged pieces have almost no tests, and there are two leftover lines of junk. When this plan is done, there is one NAS-config lookup, every merged piece has a test that would fail if it broke, and the #708 plan tells the truth about what was done.

Nothing a user sees changes, with one deliberate exception in §8 (the style-group panel stops showing a made-up `\\nas\share` path when the NAS settings cannot be read). **If a step conflicts with this goal, the goal wins — stop and flag it.** Tie-break rule carried from #708: when merging copies forces a choice, keep the behaviour of the most-used screen (the asset detail panel) and write the choice into §8.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed consumer-product art (https://dam.designflow.app); PopSG (https://sg.designflow.app) is a style-guide mode served by the same code. Repo `u2giants/popdam3`, release branch `main`. Stack: Vite + React + TypeScript + React Query (`src/`), Supabase edge functions in Deno (`supabase/functions/`, project `qsllyeztdwjgirsysgai`), Railway worker (`apps/worker/`), Synology NAS bridge agent (`apps/bridge-agent/`, ESM, Docker), Windows render agent (`apps/windows-agent/`, CommonJS). Code shared by both agents lives in `packages/agent-common/src/` and is copied into each agent's gitignored `src/common/` by `packages/agent-common/sync.mjs` at `prebuild`/`pretest`. `admin_config` is a key/value table; `NAS_HOST`, `NAS_IP`, `NAS_SHARE` there tell the web app how to build `\\host\share\…` file paths for users. Read `AGENTS.md` first.

## 3. What triggered this work

Issue #708 (closed) planned the removal of duplicated code ([its plan](issue-708-remove-duplicated-code.md)). PR #850 (merged 2026-11-06, head `6c53622a`) and PR #856 (merged 2026-11-06, head `b96ce0a2`) did the work. The advisory AI reviewer opened:
- **#851** (DeepSeek on #850): F1 `nas-config` still three copies; F2 the two detail panels share a query key but one throws on error and one ignores it, so the result depends on mount order; F3 `tenant-supervisor` not moved; F4 no "intentionally separate" headers; F5 none of the five planned test files exist; F6 `meta-direct` reason not in bridge source; F7 #708 plan STATUS never updated; F8 an unused import in `admin-api/index.ts` (the review text is truncated after the line number; on current `main` the unused symbol is `isTransientError`, line 14).
- **#857** (Muse on #856): F1 `agent-api-transport.test.ts` imports `test` and `assert` twice; F2 no test pins the two Spaces upload re-initialisation policies or the URL/ACL/CacheControl; F3 no test for the shared PDF AI-vision cascade.

The review-fixer bot deferred both ("overlapping owner work in PR #787" / "source PR is closed"). PR #787 is an unrelated open test PR for agent browse containment; it does not touch these files.

## 4. Scope

**In:** the open findings listed in STATUS Steps 2–7, in one behaviour-preserving PR.

**NOT in this plan:**
- Moving `tenant-supervisor`, or merging `pdf-backfill`/`api-client`/per-agent `pdf-text-sampler` bodies. #856 decided and recorded they stay separate; do not relitigate.
- Any change to search ranking, RPC names or fallback columns.
- `UsersTab.tsx` / `UsersAndInvitations.tsx` (owned by `plan_user_permissions_designflow_cutover.md`).
- Any `shared-db` change (none needed).
- Bridge or Windows agent version bumps: Steps 4–6 touch only tests and comments, which do not change the shipped image. If you find yourself changing shipped agent code, stop and re-read §8.

## 5. Current state of the code (verified 2026-11-25 on `origin/main` `787c20b8`)

### A. Three `nas-config` queries
| File:line | Key | On query error | Missing keys | staleTime |
|---|---|---|---|---|
| `src/components/library/AssetGrid.tsx:76-95` (local `function useNasConfig(): NasConfig \| null`, used at `:333`, passed to cards `:363`, read `:145,289,300`) | `["nas-config","strict"]` | throws | returns `null` if **any** key missing → card hides path buttons | 60 s |
| `src/components/library/AssetDetailPanel.tsx:220-240` (read `:353-354,663`) | `["nas-config","defaults"]` | throws | fills `nas` / `0.0.0.0` / `share` per key | 5 min |
| `src/components/library/StyleGroupDetailPanel.tsx:126-142` (read `:254-255,354-355,735`) | `["nas-config","defaults"]` | **ignores** (`const { data } =`) → empty map → defaults | fills defaults | 5 min |

`NasConfig` type: `src/lib/path-utils.ts`. Both panels share one key with different `queryFn`s; React Query uses whichever observer registered first, so a failed read shows an error in one mount order and fake default paths in the other (#851 F2). No `src/hooks/useNasConfig.ts` exists.

### B. Admin retry helpers
`supabase/functions/admin-api/index.ts:14` imports `formatPostgrestError, isTransientError, withRetry` from `../_shared/admin-utils.ts`. `isTransientError` is not used anywhere else in the file (`grep -c "\bisTransientError\b"` = 1). Exports in `_shared/admin-utils.ts:34` (`isTransientError`) and `:39` (`withRetry`). No local copies remain.

### C. Pairing code
`supabase/functions/_shared/pairing-code.ts` exports `generatePairingCode(): string` (16 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, formatted `XXXX-XXXX-XXXX-XXXX`). Callers keep their own TTL (5 call sites). No test.

### D. Shared full-text search helpers
`src/lib/full-text-search.ts:71` `createFullTextSearchHelpers(spec)` returns `buildSearchFilter`, `buildFallbackFilter`, `shouldFallbackFromRpc`, `fetchFullTextIds` with a per-instance `searchIdCache`; used by `src/hooks/useAssets.ts:63` and `src/hooks/useStyleGroups.ts:76`. Existing tests cover only `buildAssetSearchFilter` / `buildStyleGroupSearchFilter` (`src/test/asset-search.test.ts`, `src/test/style-group-search.test.ts`). `fetchFullTextIds` retries once on a fallback-worthy RPC error, then returns `undefined` (caller uses the ILIKE fallback); `shouldFallbackFromRpc` returns false for access errors (`searchAccessStatus`), true for `PGRST202`, `57014`, messages naming the RPC or statement timeouts.

### E. Shared agent logger
`packages/agent-common/src/logger.ts`: `resolveMinLevel()` reads `LOG_LEVEL` once at module load (`MIN_LEVEL`, `:31`); unset → `info` on `win32`, `debug` elsewhere; 200-line ring buffer, `getLogTail(n = 50)`. Per-agent `logger.ts` files are gone. No test.

### F. Shared Spaces uploader
`packages/agent-common/src/spaces-uploader.ts:52` `createSpacesUploader({ defaults, reinitPolicy })`. `uploadToSpaces` sends `PutObjectCommand` with `ContentType: "image/jpeg"`, `CacheControl: "public, max-age=31536000, immutable"`, `ACL: "public-read"`, returns `https://<bucket>.<region>.digitaloceanspaces.com/<key>`. `reinitialize(partial)` merges non-empty fields; `"eager-if-changed"` (bridge, `apps/bridge-agent/src/uploader.ts:30`) returns `false` and keeps the client when nothing changed, else rebuilds the client immediately; `"always-lazy"` (Windows, `apps/windows-agent/src/uploader.ts`) always adopts, drops the client and returns `true`. No test.

### G. Transport test
`packages/agent-common/src/agent-api-transport.test.ts:1-2` and `:11-12` both `import test from "node:test"` / `import assert from "node:assert/strict"`. It is **not** a load failure in practice: CI run 45695969527 (main, 2026-11-25) ran its cases ("single-shot policy (Windows)…" ok 110/111) inside "Test windows-agent", 147 pass / 0 fail. It is dead duplication only.

### H. `pdf-text-sampler.ts` headers
Both agents' `pdf-text-sampler.ts` start with a near-identical description (`:1-10`) but no statement of what is shared (`common/pdf-ai-vision`, `common/pdf-sample-batch`) versus per-agent (cascade wiring, `meta-direct` lease route on Windows only, progress descriptions).

## 6. Key findings

1. The NAS-config duplication is a real latent bug (F2), not cosmetic: the style-group panel can show `\\nas\share\…` placeholder paths when `admin_config` cannot be read, depending on which panel opened first.
2. The #708 LOCKED decision "one hook, defaults shape, `isPlaceholderNasConfig` for the grid" cannot reproduce the grid's current rule exactly: the grid hides paths when **any** key is missing, and a placeholder check cannot tell a missing key from a stored value that happens to equal a default. A single query with two React Query `select` views reproduces both shapes exactly from one cached raw result (§8).
3. The review claim that the duplicate import is a SyntaxError that stops the suite is wrong for this toolchain (§5G evidence); the fix is still worth one line.
4. `logger.ts` resolves the level at import time, so a test cannot change `LOG_LEVEL` after import. Either run each level in a child process or extract a pure `resolveMinLevel(env, platform)` and export it. The pure function is the smaller change and keeps runtime behaviour identical.
5. Agent tests run under `tsx --test` with an explicit file list in each `apps/*/package.json` `test` script; a new shared test must be appended to **both** lists or it never runs (`apps/bridge-agent/package.json:11`, `apps/windows-agent/package.json:10`). Bridge-only tests go only in the bridge list.
6. `@aws-sdk/client-s3` resolves from each agent's `node_modules`, not from `packages/agent-common`. So the uploader tests belong in each agent (`apps/*/src/uploader.test.ts`) importing the real per-agent `./uploader`, and stub `S3Client.prototype.send` with `node:test`'s `mock.method`.

## 7. Approaches considered and rejected

- **Keep the two split cache keys** (what #850 did). Rejected: three copies remain and F2's mount-order bug remains for the two panels.
- **`isPlaceholderNasConfig` check in the grid** (#708 lock). Rejected 2026-11-25 for §6.2: not exact. Replaced by `select` views.
- **Make the style-group panel keep ignoring errors.** Rejected: tie-break rule says the most-used screen (asset detail, throws) wins, and showing a fake path is worse than showing none.
- **Move `tenant-supervisor` into agent-common.** Rejected by #856 with a recorded reason (tenant JSON is each host's install contract).
- **Put uploader tests in `packages/agent-common`.** Rejected: the S3 SDK is not resolvable there (§6.6).
- **Test the logger by spawning child processes per level.** Rejected in favour of the pure-function seam (§6.4); child processes are slower and platform-sensitive.

## 8. Design decisions

- **LOCKED (2026-11-04, #708):** behaviour-preserving; one implementation per behaviour.
- **LOCKED (2026-11-25, supersedes the #708 `isPlaceholderNasConfig` lock):** `src/hooks/useNasConfig.ts` owns one query: key `["nas-config"]`, `queryFn` reads the three keys and **throws** on error, returns the raw `Record<string,string>` (values stringified as `AssetDetailPanel` does today), `staleTime` 5 min. It exports `useNasConfig(): NasConfig | undefined` (defaults shape via `select`, `undefined` while loading or on error) and `useStrictNasConfig(): NasConfig | null` (`null` if any key missing or on error, via `select`). Because both views share one `queryFn`, mount order cannot change results.
- **LOCKED (2026-11-25):** deliberate visible change — on an `admin_config` read error the style-group panel shows no path (like the asset panel) instead of placeholder paths. The grid's cache time moves from 60 s to 5 min (NAS settings change a few times a year).
- **LOCKED:** tests and comments only for the agents in this plan; no shipped agent code changes except the optional logger seam in §6.4, which must not change runtime output.
- **OPEN:** the logger seam may instead be a child-process test if the implementer finds the export awkward; criterion: no behaviour change, test runs in both agents' lists.

## 9. The plan

**Step 1 — Worktree/branch.** `git worktree add <path> -b claude/851-857-dedupe-followups origin/main`; `npm ci`; `npm ci --prefix apps/bridge-agent`; `npm ci --prefix apps/windows-agent`. Gate: `npm run typecheck` green on the untouched tree. `helper-ok` — mechanical. Stop-and-ask: install or typecheck fails before any edit.

**Step 2 — One NAS-config hook.** Create `src/hooks/useNasConfig.ts` per §8. Replace the local hook in `AssetGrid.tsx:76-95` with `useStrictNasConfig()` (the variable keeps the name `nasConfig` and type `NasConfig | null`). Replace the inline queries in `AssetDetailPanel.tsx:220-240` and `StyleGroupDetailPanel.tsx:126-142` with `const nasConfig = useNasConfig();` (the rest of each file already handles a falsy value). Remove the now-unused `useQuery`/`supabase` imports only if nothing else in the file uses them. Gate: `grep -rn '"nas-config"' src` returns exactly one hit (the hook file); `npm run typecheck && npm run lint` green; `src/test/use-nas-config.test.ts` (§10) passes; on https://dam.designflow.app, an asset card's path buttons, the asset detail panel's "Copy path" and a style group's detail path all show the same `\\<host>\<share>\…` as before (before/after screenshots). `lead-only` — shared cache semantics and a visible change.

**Step 3 — Unused import.** In `supabase/functions/admin-api/index.ts:14` drop `isTransientError` from the import list. Gate: `grep -c "\bisTransientError\b" supabase/functions/admin-api/index.ts` = 0; `npx -y deno check supabase/functions/admin-api/index.ts` shows no new diagnostics versus `main` (a known baseline of pre-existing diagnostics exists — compare counts). `helper-ok` — one token. Stop-and-ask: the symbol is used somewhere.

**Step 4 — Duplicate test imports.** Delete lines 11–12 of `packages/agent-common/src/agent-api-transport.test.ts` (keep 1–2 at the top). Gate: `npm test --prefix apps/windows-agent` and `npm test --prefix apps/bridge-agent` still list the "single-shot policy…" and "retry policy (bridge)…" cases as ok. `helper-ok`. Stop-and-ask: either suite fails.

**Step 5 — Tests.** Add the six files in §10 with the named cases. Append `../../packages/agent-common/src/logger.test.ts` to both agents' `test` scripts; append `src/uploader.test.ts` to each agent's own list. For the logger, export `resolveMinLevel(env = process.env, platform = process.platform)` from `logger.ts` and keep `const MIN_LEVEL = resolveMinLevel();` (identical runtime result). Gate: every named case appears as passing in `npm test` (root, Vitest), `npm test --prefix apps/bridge-agent`, `npm test --prefix apps/windows-agent`. `helper-ok` for writing the test files from §10's exact case list; `lead-only` for the logger export. Stop-and-ask: a case fails against current code (that means a real behaviour difference — bring it back, do not change code to fit).

**Step 6 — Headers.** Add to the top comment of both `apps/*/src/pdf-text-sampler.ts`: "Shared with the other agent: AI-vision cascade (`common/pdf-ai-vision`) and batch loop (`common/pdf-sample-batch`). Per-agent by design (#708): cascade wiring, progress descriptions, and (Windows only) the `meta-direct/` content-lease route." Gate: `grep -l "Per-agent by design" apps/*/src/pdf-text-sampler.ts` lists both. `helper-ok`. Stop-and-ask: none.

**Step 7 — #708 plan STATUS.** Rewrite the STATUS table of `docs/plans/issue-708-remove-duplicated-code.md` to say: Steps 2–7 landed in PR #850 (`6c53622a`) and PR #856 (`b96ce0a2`), tenant-supervisor kept separate with recorded reason, remaining work moved to this plan; leave the body as history; set its front-matter `status: complete` only after this plan's Step 9. Gate: STATUS rows cite PR merge SHAs and link this plan. `helper-ok` with the text above. Stop-and-ask: none.

**Step 8 — PR, CI, merge.** Verified identity (`git var GIT_COMMITTER_IDENT`); stage only the files this plan names; `gh pr create --base main` with attribution line; wait with `bin/ai-pr-wait <pr>` (background) or `gh pr checks --watch`; merge when required checks pass. Confirm `publish-frontend.yml` and `deploy-supabase.yml` ran green for the merge SHA and Coolify serves it (footer build SHA on the DAM). `lead-only`.

**Step 9 — Live proof and closure.** Repeat Step 2's three screenshots on the deployed build. Comment on #851 and #857 with the merge SHA, the test names now passing, and the screenshots, signed; close both; update STATUS here and set this plan's and #708 plan's `status: complete`. `lead-only`.

## 10. Tests required

| File (new) | Runner | Cases (names) |
|---|---|---|
| `src/test/use-nas-config.test.ts` | root Vitest (jsdom; mock `@/integrations/supabase/client`; wrap in a `QueryClientProvider`) | "defaults view fills nas / 0.0.0.0 / share for missing keys"; "strict view is null when any key is missing"; "both views return stored values when all keys exist"; "both views read one cached query regardless of mount order" (mount strict first then defaults, and reverse; supabase mock called once each time); "a read error yields undefined (defaults view) and null (strict view), never placeholder paths" |
| `supabase/functions/_shared/pairing-code.test.ts` | root Vitest (`supabase/functions/**` project) | "formats as four groups of four"; "uses only the 32-character alphabet over 500 draws"; "never emits 0, O, 1 or I" |
| `supabase/functions/admin-api/retry-helpers.test.ts` | root Vitest, text contract (read the file, normalise CRLF) | "admin-api defines no local withRetry or isTransientError"; "admin-api imports withRetry from _shared/admin-utils.ts" |
| `src/test/full-text-search-helpers.test.ts` | root Vitest (mock supabase `rpc`, `@/lib/dam-search` `getSearchMode`/`fetchSearchIds` passthrough) | "returns ids when the RPC succeeds"; "retries once then returns undefined on PGRST202"; "does not fall back on an access error"; "caches ids per mode, term and limit"; "two helper instances do not share a cache" |
| `packages/agent-common/src/logger.test.ts` | `tsx --test` in both agents | "LOG_LEVEL=warn filters info"; "unset level defaults to info on win32 and debug elsewhere" (call `resolveMinLevel({}, "win32")` / `"linux"`); "ring buffer keeps the newest 200 lines"; "getLogTail(50) returns the newest 50" |
| `apps/bridge-agent/src/uploader.test.ts` and `apps/windows-agent/src/uploader.test.ts` | `tsx --test` per agent; stub `S3Client.prototype.send` with `mock.method` and record `this` + `command.input` | "uploads with image/jpeg, public-read and one-year immutable cache, and returns the Spaces URL"; bridge: "a no-op config sync returns false and keeps the same client"; bridge: "a changed config sync returns true and uses a new client immediately"; windows: "every config sync returns true and builds a new client on the next upload"; both: "empty fields in a sync keep current values" |

Existing suites that must stay green: root `npm run lint && npm run typecheck && npm test`, `npm test --prefix apps/bridge-agent`, `npm test --prefix apps/windows-agent`, `npm run build`.

Adversarial cases: the only outside input touched is the search term. Existing tests "ignores blank search text after sanitizing reserved OR characters" in `asset-search.test.ts` and `style-group-search.test.ts` cover PostgREST `(),` injection and must keep passing. No other trust boundary changes.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push to `main`; the AI merges; reviews are advisory.
- No `shared-db` change. No app-side DDL.
- Never edit an agent's generated `src/common/` — edit `packages/agent-common/src/`.
- Bridge is ESM (`.js` import suffixes); Windows is CommonJS (no suffix). Per-agent tests import `./uploader` (Windows) / `./uploader.js` (bridge).
- `agent-common` has no `"type": "module"`; shared tests must not use top-level `await` (see the comment in `agent-api-transport.test.ts`).
- New test files must be added to the explicit agent `test` lists or they never run.
- Take before/after screenshots for Step 2; UI work needs visual verification.
- Sign GitHub posts (format "Posted by <tool> chat (<id>) on <host>"); times in EST; secrets only via 1Password `vibe_coding`.

## 12. Access and environment

- `gh` authenticated as `u2giants`. Supabase MCP read-only against `qsllyeztdwjgirsysgai`.
- Admin test login: 1Password vault `vibe_coding`, item named in `docs/1password.md` ("PopDAM admin tester"); never paste values.
- Local: `npm ci && npm run dev` (web), `npm test` (root Vitest), agents `npm ci --prefix apps/<agent> && npm test --prefix apps/<agent>`.
- Deploys: `publish-frontend.yml` → GHCR → Coolify; `deploy-supabase.yml` for edge functions (Step 3 touches `admin-api`).

## 13. Definition of done, risks, open questions

Done when:
- [ ] One `nas-config` query on `main`; `grep -rn '"nas-config"' src` = 1 hit.
- [ ] Unused import and duplicate test imports gone.
- [ ] All §10 tests exist, run in their suites and pass; CI green; PR merged.
- [ ] Frontend and edge deploys for the merge SHA green; DAM serves that SHA.
- [ ] Live screenshots posted; #851 and #857 closed; this STATUS and #708 plan STATUS updated.

Risks and rollback:
- The shared `select` views change when the grid re-reads config (60 s → 5 min). Harmless; rollback by reverting the PR.
- A test written against the wrong expectation could "fix" behaviour. Mitigation: Step 5 stop-and-ask — a failing case against current code goes to the lead.

Open questions: none business-meaning.

## Self-audit

1. **Fresh session could execute without asking?** Yes — §5 gives each remaining duplicate with file:line on `787c20b8`, §8 locks the hook design exactly, §9 gives edits and gates per step, §10 names every test and its runner, §12 access.
2. **All background carried, including what was ruled out?** Yes — STATUS lists which review findings are already fixed with evidence; §6 records the mount-order bug, why the #708 placeholder lock was replaced, why the "SyntaxError" claim is wrong, and where the S3 SDK resolves; §7 lists six rejected approaches.
3. **Goal clear enough to steer by?** Yes — §1: one implementation, protected by tests, no visible change except the one in §8; tie-break rule stated.

## Lead launch prompt

```
Read docs/plans/issue-851-857-duplicated-code-followups.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 2, 8 and 9 yourself, plus the logger export in Step 5, and review every helper diff.
Hand Steps 1, 3, 4, 6, 7 and the test-file writing in Step 5 to your helper, in that order. Your helper is your
own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX,
Mimo Flash for Mimo Pro. Never a full-strength model. Helper rules: return finished work or an evidenced
blocker; make no design decisions; never merge or post; bring back any stop-and-ask trigger named in the step
(especially a test that fails against current code); if stuck 30 minutes, the lead takes the step back.
Rules sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Lead checks: run all four suites in §10 yourself, the one-hit nas-config grep, and the live screenshots.
```
