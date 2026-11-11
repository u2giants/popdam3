---
summary: Issue #705 plan: feat(settings): show ingestion rules and add reversible extra rules. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-705
---

# Plan: Review finding: u2giants/popdam3#703 feat(settings): show ingestion rules and add reversible extra rules (u2giants/popdam3#705)
Issue: https://github.com/u2giants/popdam3/issues/705
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS (read first)

| # | Step | State | Evidence / date |
|---|------|-------|-----------------|
| 1 | Verify all four findings are still present on `main` | ⬜ open | Verified present at plan time on `01fcfc34` (see §5); re-verify before starting |
| 2 | Fix folder-exclusion impact count (first path segment) | ⬜ open | |
| 3 | Fix "___old" copy mismatch (tester + display) | ⬜ open | |
| 4 | Harden `agentAppliesRules` version parsing | ⬜ open | |
| 5 | Server-set `created_at` / `created_by` on saved rules | ⬜ open | |
| 6 | Tests (handler test file, rules test additions, tab helper test) | ⬜ open | |
| 7 | PR, CI green, merge, edge deploy verified | ⬜ open | |
| 8 | Live proof on dam.designflow.app, close #705 with evidence | ⬜ open | |

**Where a fresh session starts:** Step 1. Nothing has been implemented; no branch exists for this issue.

---

## 1. The ultimate goal

Admins of PopDAM (the company's design-file library) can add extra ingestion rules on the Settings page (PR #703 built that). Four review findings say that page can mislead or be spoofed: it may tell an admin "0 files match" when thousands do, it describes a folder rule that is not what the scanner enforces, it may wrongly show or hide the "your NAS agent is outdated" banner, and the "who added this rule, when" stamp on each rule is whatever the browser sent rather than what the server knows.

When this is done, every number and sentence on the Ingestion Rules tab is true, and the attribution stored on each rule is set by the server. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product art. A bridge agent (Docker on Synology NAS `edgesynology1`) scans design files and reports to Supabase edge functions; a React web app (dam.designflow.app, Coolify) shows the library and admin settings.

- Repo: https://github.com/u2giants/popdam3, default branch `main`. Work on a feature branch and open a PR; the AI merges (Albert does not).
- Stack: React + Vite + Tailwind (`src/`), Deno edge functions (`supabase/functions/`), Node agents (`apps/bridge-agent/`, `apps/windows-agent/`), shared agent source in `packages/agent-common/` (synced into `apps/*/src/common` at build).
- Supabase project `qsllyeztdwjgirsysgai` (Virginia). Edge functions deploy via `.github/workflows/deploy-supabase.yml` on changes under `supabase/functions/**`. Frontend deploys via `.github/workflows/publish-frontend.yml` → GHCR → Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`.
- Machine for this work: `hetz` (the production VPS). Today is 2026-11-04.

## 3. What triggered this work

PR #703 (merged as `522e5722`, "feat(settings): show ingestion rules and add reversible extra rules") added:
- `packages/agent-common/src/ingestion-rules.ts` (canonical) mirrored byte-for-byte to `supabase/functions/_shared/ingestion-rules.ts` and re-exported by `src/lib/ingestion-rules.ts`;
- `supabase/functions/_shared/admin-handlers/ingestion-rules-handlers.ts` with `getIngestionRules`, `saveIngestionRules`, `countAssetsMatchingExclusion`;
- admin-api routes `get-ingestion-rules`, `save-ingestion-rules`, `preview-ingestion-exclusion` (`supabase/functions/admin-api/index.ts:2067-2084`) and a `set-config` guard (`:371-372`);
- `src/components/settings/IngestionRulesTab.tsx`.

The advisory AI review (reviewer "muse", ai-review run 41852244086) opened #705 with four findings. The automatic fixer deferred (comment: "source PR is closed"), so the findings are unresolved and must be handled by hand. PR #704 (`22280a22`) only re-synced the mirror copy; it fixed none of the four.

## 4. Scope

In scope: the four findings exactly as listed in #705, their tests, docs touch if a contract changes, deploy and live proof.

**NOT in this plan:**
- Redesign of the widen-only/exclude-only rule model, revision/optimistic-concurrency, or the admin-only routing (reviewer called them sound).
- Making the NAS agent honour new rules faster, or any bridge-agent code change. The bridge reads rules at scan start (`apps/bridge-agent/src/index.ts:637` → `scanner.ts:32-34`); unchanged.
- Changing `packages/path-filters` blocklist or the agent-api `___old` rejection (`supabase/functions/agent-api/index.ts:1013-1017`). We align copy to enforcement, not enforcement to copy.
- Deleting the unused `supabase/functions/_shared/path-filters.ts` edge copy (it defines `__OLD`/`___OLD` exclusions no route calls; see §6). Note it, do not touch it.
- Any database schema change. None is needed; `admin_config` is a JSON value store.
- Issues #678 and #681 (separate plans in this folder).

## 5. Current state of the code (verified on `main` = `01fcfc34`, 2026-11-04 4:45 PM EST)

All four findings are **still present**:

1. **Impact count misses first-segment folders.** `supabase/functions/_shared/admin-handlers/ingestion-rules-handlers.ts:95-100`:
   ```ts
   const { count, error } = kind === "folder_exclude" ? await query.ilike("relative_path", `%/${text}/%`) : await query.ilike("filename", `%${text}%`);
   ```
   Canonical `relative_path` has no leading slash (`docs/PATH_UTILS.md:17` "No leading slash"), so `Temp/art.psd` is not matched by `%/temp/%`. The UI shows the count at `src/components/settings/IngestionRulesTab.tsx:221-226` ("About N files already in the library match…").
2. **"___old" copy.** `src/components/settings/IngestionRulesTab.tsx:159`: `Names starting with {EXCLUDED_FOLDER_PREFIXES.join(" ")} and also ___old, plus:`. Enforcement on the scanner side is `packages/path-filters/index.ts:20-49` (`_old` exact, prefixes `. $ @ #`); `___old` is **not** in that blocklist. However the server does reject `___old` at ingest time: `supabase/functions/agent-api/index.ts:1013-1017` returns `noop` with reason `excluded ___old folder`. So the sentence is half-true (server side), but the tester `explainIngestion` (`packages/agent-common/src/ingestion-rules.ts:146-171`) knows nothing about `___old` and would say such a file "passes every name rule". The displayed list `EXCLUDED_FOLDERS` (`ingestion-rules.ts:31-56`) is test-locked to the path-filters blocklist by `src/lib/ingestion-rules.test.ts:15-19`.
3. **Version parsing.** `src/components/settings/IngestionRulesTab.tsx:30-39`:
   ```ts
   const RULES_AGENT_VERSION = [1, 16, 21];
   function agentAppliesRules(version: unknown): boolean {
     const parts = String(version ?? "").split(".").map(Number);
     ...  (parts[i] || 0)
   ```
   `"v1.16.21"` → `["v1",…]` → `NaN||0` → 0 → reported outdated; `"1.16.21-stable"` → third part NaN → 0 → outdated; `"unknown"` (what the bridge reports when `package.json` cannot be read, `apps/bridge-agent/src/index.ts:111-118`) → outdated, which is arguably right but for the wrong reason. The value comes from `list-agents` → `version_info.version` (`supabase/functions/_shared/admin-handlers/agent-handlers.ts:105`), which the bridge fills from its `package.json` version (`apps/bridge-agent/src/index.ts:268`). Live today: `synology-bridge-1` reports `1.16.21` (DB read 4:46 PM EST), so the banner is currently hidden correctly; the bug bites on any suffixed or prefixed version string.
4. **Client-supplied attribution.** `packages/agent-common/src/ingestion-rules.ts:107-108` copies `created_at`/`created_by` from input verbatim; `saveIngestionRules` (`ingestion-rules-handlers.ts:46-91`) stores the normalized list without overwriting them, while history `by` is server-set (`:77`). The UI sends `created_at: new Date().toISOString()` and no `created_by` (`IngestionRulesTab.tsx:105-116`), so today nothing fills `created_by` at all.

Existing tests: `src/lib/ingestion-rules.test.ts` (root vitest, pure functions and mirror checks). There is **no** test for `ingestion-rules-handlers.ts` and none for `IngestionRulesTab.tsx`. Edge-function tests run under the root vitest "edge-functions" project (`vitest.config.*` include `supabase/functions/**/*.test.ts`), environment node; pattern to copy: `supabase/functions/_shared/admin-handlers/sg-nas-handlers.test.ts` (fake `db` object with `from().select()…`).

Live `admin_config.INGESTION_RULES` at 4:46 PM EST: `rules: []`, `revision: 6` (another session added and removed temporary proof rules today). Nothing in this plan depends on that content.

## 6. Key findings and root cause

- The impact query was written for mid-path folders only; top-level and first-segment folders fall through. Root cause: one `ilike` pattern cannot express "segment equals X" for both positions. Fix needs an OR (`text/%` for first segment, `%/text/%` for deeper) — PostgREST `.or()` with `ilike` is available on the supabase-js client used here.
- Three different "excluded folder" rule sets exist: (a) `packages/path-filters` (scanner, authoritative on disk), (b) agent-api ingest `___old` guard (server defence in depth), (c) `supabase/functions/_shared/path-filters.ts` `isExcludedDirectory` (`__OLD`, `___OLD`, `TEMP`, …) which **no edge route imports** (grep across `supabase/functions` finds only its own test). The settings copy mixed (a) and (b). The tester must mirror (a)+(b) because that is what actually happens to a file.
- `agentAppliesRules` is the only version comparison in the web app for this purpose; there is no shared semver helper in `src/lib/` (checked: none named `semver`/`compareVersion`). A tiny parser that extracts the first `\d+\.\d+\.\d+` is enough.
- `normalizeIngestionRules` is shared with the bridge and must stay pure and import-free (file header, `ingestion-rules.ts:5-8`); the right place to stamp attribution is the server handler, keeping the normalizer's "preserve if string" behaviour so stored rules round-trip.

## 7. Approaches considered and REJECTED

- **Stripping the leading-slash problem by storing paths with a slash** — rejected: `relative_path` is canonical without a slash across the whole system (`docs/PATH_UTILS.md`), and this is a query bug, not a data bug.
- **Using a regex filter (`~*` with `(^|/)temp(/|$)`)** like `purge-handlers.ts:189-190` — viable, but an `ilike` OR keeps the escape logic already in place (`replace(/[\\%_]/g, "\\$&")`, line 95) and the `planned` count estimate. Either is acceptable; OPEN decision below, default is the `ilike` OR.
- **Dropping the `___old` sentence from the UI** — rejected: the server really does reject `___old` (`agent-api/index.ts:1014`), so an admin testing a `___old` path must be told it is skipped. The fix is to make tester and copy agree with enforcement.
- **Adding `___old` to the path-filters blocklist** — rejected (out of scope, changes scanner behaviour on the NAS and the test-locked list; the server guard already covers it).
- **Bringing in a semver dependency** — rejected: one three-number comparison does not justify a package.
- **Letting the client keep sending `created_at`** and merely validating it — rejected by the finding itself: attribution must be server-authoritative. The server overwrites both fields for rules that are new in this save (ids not present in the current stored list) and preserves the stored values for existing ids.

## 8. Design decisions

LOCKED (2026-11-04):
- D1. Impact count for `folder_exclude` matches a path segment anywhere, including the first segment. Count semantics stay "live assets whose path contains a folder with exactly that name" (case-insensitive).
- D2. `explainIngestion` reports a `___old` segment as always skipped, with the reason text `Folder "___old" is always skipped.` (same wording family as line 158). Implemented via a new exported constant `INGEST_REJECTED_FOLDERS = ["___old"] as const` in the canonical `ingestion-rules.ts` with a comment pointing at `agent-api/index.ts` ingest guard; the UI sentence is built from that constant, so copy and tester cannot drift.
- D3. `agentAppliesRules` parses with `/(\d+)\.(\d+)\.(\d+)/`; no match → treated as outdated (returns `false`) so the banner shows; prefix `v` and suffixes like `-stable` are tolerated.
- D4. Server attribution: in `saveIngestionRules`, for each incoming rule whose `id` is not in `current.rules`, set `created_at = now` and `created_by = userId`; for ids already stored, copy `created_at`/`created_by` from the stored rule (ignore client values). The normalizer keeps accepting the fields (needed for reading stored data) — unchanged.
- D5. No new admin-api route; no DB change; no bridge **behaviour** change. But Step 3 edits `packages/agent-common/src/ingestion-rules.ts`, which is compiled into the bridge image and triggers `.github/workflows/publish-bridge-agent.yml` (its `paths` include `packages/agent-common/**`, lines 6-10). The documented rule (`docs/deployment.md:268`, `AGENTS.md:438`) is "bump `apps/bridge-agent/package.json` version in the same commit as any bridge agent change", so bump `1.16.21` → `1.16.22` in the same commit, and set `RULES_AGENT_VERSION` stays `[1,16,21]` (rules support began there). Do NOT request a NAS agent update for this; the running 1.16.21 agent behaves identically. CI does not enforce the bump (the workflow only reads the version, lines 61-67); the rule is a convention we follow.

OPEN (implementer's call, criteria given):
- O1. `ilike` OR vs regex `~*` for the count (§7). Choose `ilike` OR unless PostgREST `.or()` escaping of a `%`-containing value proves awkward in the test; if regex, escape with `replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` and keep `{ count: "planned", head: true }`.
- O2. Whether to show `created_by` in the UI. Not required by the finding; skip unless trivial (the `Stored` interface at `IngestionRulesTab.tsx:17-21` would need the field).

## 9. The plan

Branch: `fix/705-ingestion-rules-review` from current `main`. Single phase; one PR.

**Step 1 — Re-verify the findings (10 min).**
Run `git fetch origin && git log --oneline -3 origin/main`, then re-read the four locations in §5. If any has changed, update §5 before continuing.
Gate: you can point at each of the four code lines as they exist on today's `main`.

**Step 2 — Impact count (finding 1).**
File: `supabase/functions/_shared/admin-handlers/ingestion-rules-handlers.ts`, `countAssetsMatchingExclusion` (lines 93-100). Replace the single `ilike` for `folder_exclude` with:
```ts
? await query.or(`relative_path.ilike.${text}/%,relative_path.ilike.%/${text}/%`)
```
Mind PostgREST `.or()` syntax: values with commas or parentheses must be quoted; `text` is already backslash-escaped for `%`/`_`. Wrap the value in double quotes (`relative_path.ilike."${text}/%"`) so a folder name containing `,` or `(` stays one token; test it (see adversarial table).
Intent: `Temp/art.psd`, `Decor/Temp/x.psd` and `a/b/temp/c.psd` all count; `Temporary/x.psd` and `a/mytemp/x.psd` do not.
Gate: new test `counts first-segment and nested folders for folder_exclude` passes (Step 6).

**Step 3 — `___old` copy and tester (finding 2).**
Files: `packages/agent-common/src/ingestion-rules.ts` (canonical) and the mirror `supabase/functions/_shared/ingestion-rules.ts` (copy the file after editing; the mirror test fails otherwise), `src/components/settings/IngestionRulesTab.tsx:159`.
- Add after `EXCLUDED_FOLDERS`: `/** Folders agent-api refuses at ingest (supabase/functions/agent-api/index.ts, "excluded ___old folder"). Not in the scanner blocklist. */ export const INGEST_REJECTED_FOLDERS = ["___old"] as const;`
- In `explainIngestion` loop (line 155-161), extend the "always skipped" condition with `|| (INGEST_REJECTED_FOLDERS as readonly string[]).includes(lower)`.
- UI line 159 becomes: `Names starting with {EXCLUDED_FOLDER_PREFIXES.join(" ")}, the folder {INGEST_REJECTED_FOLDERS.join(", ")} (refused by the server), plus:` and import the constant from `@/lib/ingestion-rules`.
- Sync: `cp packages/agent-common/src/ingestion-rules.ts supabase/functions/_shared/ingestion-rules.ts`.
Gate: `explainIngestion("Decor/___old/art.psd", []).ingested === false` with reason containing `___old`; `explainIngestion("Decor/_old/art.psd", [])` still false (blocklist); `explainIngestion("Decor/__old/art.psd", [])` is **true** (neither list contains `__old` — document this in the test name so nobody "fixes" it).

**Step 4 — Version parsing (finding 3).**
File: `src/components/settings/IngestionRulesTab.tsx:30-39`. Move `agentAppliesRules` and `RULES_AGENT_VERSION` to a new tiny module `src/lib/agent-version.ts` (exported, pure) so it is testable without React:
```ts
export const RULES_AGENT_VERSION = [1, 16, 21] as const;
export function parseVersion(v: unknown): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function agentAppliesRules(version: unknown): boolean {
  const p = parseVersion(version);
  if (!p) return false;
  for (let i = 0; i < 3; i++) if (p[i] !== RULES_AGENT_VERSION[i]) return p[i] > RULES_AGENT_VERSION[i];
  return true;
}
```
Import it in the tab; delete the inline copy.
Gate: tests in Step 6 for `1.16.21`, `v1.16.21`, `1.16.21-stable`, `1.16.20`, `1.17.0`, `2.0.0`, `unknown`, `undefined`, `1.16`.

**Step 5 — Server-set attribution (finding 4).**
File: `supabase/functions/_shared/admin-handlers/ingestion-rules-handlers.ts`, `saveIngestionRules`. After `const current = parseStored(row?.value);` and the revision check, stamp:
```ts
const stored = new Map(current.rules.map((r) => [r.id, r]));
const stamped = rules.map((r) => {
  const prev = stored.get(r.id);
  const { created_at: _a, created_by: _b, ...rest } = r;
  return prev
    ? { ...rest, ...(prev.created_at ? { created_at: prev.created_at } : {}), ...(prev.created_by ? { created_by: prev.created_by } : {}) }
    : { ...rest, created_at: now, created_by: userId };
});
```
(Move `const now = …` above this.) Use `stamped` in `next.rules`. Note the rule `id` is client-generated (`crypto.randomUUID()` in the tab) — that is fine; a client can only forge attribution on a rule id that does not exist yet, and the server then overwrites it.
Also remove `created_at: new Date().toISOString()` from the tab's `add()` (`IngestionRulesTab.tsx:112`) so the client stops pretending.
Deno lint: unused destructured names must be `_`-prefixed (`deno lint` runs in CI's edge checks via `npm run lint`? — confirm with `npm run lint`; if it complains, build `rest` with explicit field picks instead).
Gate: handler test `stamps created_at/created_by from the server for new rules and keeps stored values for existing ones` passes; a save with `created_by: "someone-else"` on a new id is stored with `created_by === userId`.

**Step 6 — Tests.** See §10 for names. New file `supabase/functions/_shared/admin-handlers/ingestion-rules-handlers.test.ts` (fake `db` modelled on `sg-nas-handlers.test.ts`; the fake must record the `.or()` / `.ilike()` argument so the first-segment pattern can be asserted literally, and model `select/eq/maybeSingle/update/insert` chains for `saveIngestionRules`). New file `src/lib/agent-version.test.ts`. Extend `src/lib/ingestion-rules.test.ts`.
Gate: `npm run test` (root vitest, both "unit" and "edge-functions" projects) green locally; `npm run lint && npm run typecheck` green.

**Step 7 — PR and deploy.**
Commit as Albert's verified identity (check `git var GIT_COMMITTER_IDENT`); stage only the files above. Open PR to `main` titled `fix(settings): true impact counts, server-set rule attribution, ___old tester (#705)`, body `Closes #705` plus the four findings mapped to files. Run `bin/ai-pr-wait <pr>` in the background (never a sleep loop); do other work until it wakes you. Merge when the required checks pass (reviews are advisory and never block). After merge: `deploy-supabase.yml` must run (edge files changed) and `publish-frontend.yml` must run (src changed); confirm both runs succeed and Coolify shows the new image SHA.
Gate: `gh run list --workflow deploy-supabase.yml -L1` and `--workflow publish-frontend.yml -L1` show success for the merge SHA; `curl -sI https://dam.designflow.app` returns 200.

**Step 8 — Live proof and close.**
On dam.designflow.app (admin login: 1Password `vibe_coding`, the PopDAM admin tester item named in `docs/1password.md`/memory `project_popsg_tester_login.md`; never type a credential for Albert), Settings → Ingestion Rules:
1. Choose "Never ingest anything inside a folder named", type `generic decor` (a real first-segment-under-Decor folder; `Decor/Generic Decor/...` is a live path family), press Check impact. Expect a non-zero count. Before the fix this exact check returned the right answer because the folder is second-segment; so ALSO test with a value equal to the very first segment `decor` → must be non-zero now, was 0 before.
2. Tester: `Decor/___old/Tech Pack.pdf` → "always skipped".
3. Add a rule `pdf_include` `zz-proof-705`, read it back via `get-ingestion-rules` (DB read-only query on `admin_config` key `INGESTION_RULES`): `created_by` equals the admin user id and `created_at` is server time. Remove the rule afterwards (Trash icon), leaving the history entry.
4. Confirm the outdated-agent banner is hidden while `synology-bridge-1` reports `1.16.21`.
Do not add a rule that would change scanning; remove the proof rule before leaving.
Post on #705 (signed with `$AI_GH_SIGNATURE`): the merge SHA, the four file:line fixes, the live-proof results with the EST time, and close. Leave no `- [ ] live proof` box unchecked.
Gate: #705 closed with the evidence comment; `INGESTION_RULES.rules` is back to what it was before the proof.

### Adversarial cases (trust boundary: admin-supplied rule text reaches a DB query and stored JSON)

| Input | Hostile case | Test |
|---|---|---|
| `value` for folder_exclude | contains `%` or `_` (`a_b`, `100%`) — must be literal | `escapes like wildcards in the impact query` |
| `value` | contains `,` or `(` — breaks PostgREST `.or()` tokenising | `quotes the or-filter value so commas and parens stay literal` |
| `value` | contains `/` | already refused by `validateIngestionRuleValue` (`ingestion-rules.ts:79`); keep test `refuses slashes` (exists at `ingestion-rules.test.ts:52`) |
| `value` | empty / whitespace | returns 0 without a query — `returns 0 for empty text without querying` |
| rule `created_by` | spoofed to another user id on a new id | `stamps created_by from the server for new rules` |
| rule `created_at` | spoofed future date on an existing id | `keeps stored attribution for existing rule ids` |
| rule list | duplicate id with different values | `normalizeIngestionRules` dedups by kind:value; add `refuses two rules with the same id` only if cheap — otherwise document as accepted (OPEN) |
| agent `version_info.version` | `"v1.16.21"`, `"1.16.21-stable"`, `"unknown"`, `undefined`, `"1.16"` | `agentAppliesRules` table test |
| tester path | `Decor/___OLD/x.psd` (upper case) | `treats ___old case-insensitively` |

## 10. Tests required

New `supabase/functions/_shared/admin-handlers/ingestion-rules-handlers.test.ts`:
- `counts first-segment and nested folders for folder_exclude` — asserts the fake db received an `or` containing both `temp/%` and `%/temp/%` (or the regex alternative).
- `escapes like wildcards in the impact query`.
- `quotes the or-filter value so commas and parens stay literal`.
- `returns 0 for empty text without querying`.
- `returns null when the count errors`.
- `stamps created_at/created_by from the server for new rules and keeps stored values for existing ones`.
- `refuses a stale expected_revision with 409` (locks existing behaviour).

New `src/lib/agent-version.test.ts`:
- `agentAppliesRules accepts 1.16.21, v1.16.21, 1.16.21-stable, 1.17.0, 2.0.0`.
- `agentAppliesRules rejects 1.16.20, 1.15.99, unknown, undefined, 1.16`.

Extend `src/lib/ingestion-rules.test.ts`:
- `treats ___old as always skipped but not __old` (case-insensitive).
- Existing `keeps the edge copy identical to the agent copy` and `keeps the displayed folder list identical to the path filter` must stay green (they lock the mirror and the blocklist).

Suites that must stay green: `npm run lint && npm run typecheck && npm run test` (root), `npm run build`. The bridge and windows agent suites are untouched but CI runs them; expect green.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges. Reviews are advisory and never block; required checks are lean.
- No DB schema changes in this repo; none are needed here. If you think one is, stop — it goes through `popcre/shared-db` (`/worksp/shared-db`), claim-first, with the `shared-db-change` skill.
- `packages/agent-common/src/ingestion-rules.ts` and `supabase/functions/_shared/ingestion-rules.ts` must stay byte-identical (test-enforced). Edit the canonical one, copy to the mirror. CRLF differences are normalised by the test but keep LF.
- `EXCLUDED_FOLDERS` is test-locked to `packages/path-filters` blocklist order; do not add `___old` there.
- `ingestion-rules.ts` must have no imports (runs in Node, Deno, browser).
- Bump `apps/bridge-agent/package.json` to `1.16.22` in the same commit (D5) because `packages/agent-common` is bridge source; do not trigger `AGENT_UPDATE_REQUEST` for it (no behaviour change on the NAS). The published `:stable` image will carry `1.16.22`; the Settings → Agents page will show an update available, which is accurate and harmless.
- `set-config` refuses `INGESTION_RULES` (`admin-api/index.ts:371`); keep that guard.
- Wait on CI with `bin/ai-pr-wait <pr>` in the background; never a sleep loop. Rerun on exit 2.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote times in EST.
- Albert is not technical and must never be asked to click, type or create a credential; the live proof is done by the AI with the tester login.
- No band-aids: do not suppress the lint rule if `deno lint`/eslint complains about unused destructured fields; restructure.
- Live proof is required before closing; the checklist stays on #705, never a new issue.

## 12. Access and environment

- `gh` authenticated as the AI identity on hetz; commit identity must be Albert's verified one (`git var GIT_COMMITTER_IDENT`; memory `project_git_commit_identity.md` notes worktrees do not inherit it).
- Supabase MCP (`mcp__supabase__execute_sql`) works read-only against `https://qsllyeztdwjgirsysgai.supabase.co` (confirmed 4:46 PM EST). Production DB is read-only by default; the only writes in this plan happen through the live app's own admin route during proof.
- DB password if psql is needed: 1Password vault `vibe_coding`, item "Supabase DB Password - shared POP database" (reference only).
- Test logins: `docs/1password.md`; PopDAM admin tester item in vault `vibe_coding` (see memory `project_popsg_tester_login.md`). Never paste values.
- Local run: `npm ci && npm run dev` for the web app (Vite); edge functions are tested with vitest in node, no Supabase CLI needed for this change.
- Use a dedicated worktree for the branch (canonical checkout is landing-only).

## 13. Definition of done, risks, open questions

Done when:
- [ ] All four fixes landed on `main` in one merged PR with `Closes #705`.
- [ ] New tests in §10 exist by those names and CI "CI" workflow is green on the merge commit.
- [ ] `deploy-supabase.yml` and `publish-frontend.yml` succeeded for the merge SHA; Coolify serves it.
- [ ] Live proof steps 8.1-8.4 performed and posted on #705 with EST times; proof rule removed.
- [ ] `docs/configuration.md` touched only if it documents `INGESTION_RULES` shape and attribution (grep first; if absent, no doc change).
- [ ] Handoff `HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md` STATUS updated and this plan's STATUS table marked done with artifacts (test file paths, PR number, run ids).

Risks and rollback:
- The `.or()` filter string could be mis-tokenised by PostgREST for odd folder names → the test with `,` and `(` catches it; rollback is reverting the single PR (no data migration).
- Stamping attribution changes stored JSON shape only additively; old history entries keep old rules unchanged.
- A stricter version check could hide the "outdated agent" banner wrongly only if the bridge reported a higher version than it runs; the bridge reports `package.json`, so no.

Open questions: O1 and O2 in §8 only. No business-meaning question for Albert.

## Self-audit

1. **Could a brand-new session execute this without asking?** Yes. §5 gives exact file:line for every finding as it stands on `main`, §9 gives the code to write per step with gates, §10 names every test, §12 names every access path by location. No question is left that the planner could answer.
2. **Does it carry all background and rejected paths?** Yes. §6 records the three competing folder-rule sets and that the edge `path-filters.ts` copy is dead code; §7 records the six rejected approaches and why; §8 locks D1-D5 and leaves O1-O2 with criteria.
3. **Is the goal clear enough for judgment calls?** Yes. §1 states the business outcome ("every number and sentence on the tab is true; attribution is server-set") and the goal-wins rule, so an implementer who finds, say, that `.or()` cannot be made safe can switch to the regex option without breaking intent.
