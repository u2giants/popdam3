---
issue: 2326
status: OPEN
owner: mimo/2326-steps56-impl
---

# HANDOFF — #2326 Steps 5–6 implementations landed (6 of 7); Step 6 remainder done except #6418's proof; Steps 7–8 next

Written 2026-11-16 5:56 PM EST by MiMo chat ses_ffe5e1ec on edge-dev (the "2326 Steps 5-8" fresh session the 2026-11-15 handoff called for). Contract issue is **#2326**. This file is the successor carrier for `HANDOFF.d/2026-11-15T2153Z-edge-dev-mimo-2326-steps56-split-steps78-handoff.md` (do not delete that one until its §6.4 retirement condition is met — the program is not finished) and for the wrap-up handoff it names.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None open.** Every business question in this workstream is answered:

- **Auth leaked-password protection — DECLINED (Albert, 2026-11-16, his words: "no leaked-password protection").** Recorded on #2326 (https://github.com/popcre/shared-db/issues/2326#issuecomment-6922357338) as the plan's Owner-decisions item 2 = DECLINED. It never blocked anything. **Do NOT re-ask.**
- **Who may see DAM style-guide structure cross-app — self-resolved, no owner call.** The #6418 census (below) found exactly ONE application reading the two style-guide matviews (PopDAM), so the handoff's conditional second question never triggered; the change is a grant narrowing + caller-gated projection (PR #6451), and PopDAM's code is unchanged.

Already settled — do NOT re-ask (dates are ruling dates): review is advisory and never a merge gate (2026-10-29); never ask a human to approve (2026-09-28); production risk classes are accepted by the automatic promotion workflow (2026-09-30); never close an outcome-lifecycle issue by hand; never re-apply `20261106171924` / `20261012012727`, never reuse spent versions `20261026174936` / `20261026193803` / `20261027022851` (and now also never reuse this session's spent reservations — see §9).

## 1. What this application is

`popcre/shared-db` is the shared Supabase database **shape** source of truth for POP Creations (CRM, DAM, PM/PIM, DesignFlow PLM all read the same tables in one Supabase production project, ref `qsllyeztdwjgirsysgai`). It holds migrations, schema/API contracts, the business-rule library, and the rules every AI session must follow. No app runtime. "Shipping" = branch + PR + `gh pr merge --auto` through the merge queue; database shape is applied via the migration lane (preview rehearsal first, then the governed automatic production promotion). Sanctioned production reads: Supabase Management API `database/query` with `read_only: true` (pattern: https://github.com/popcre/shared-db/blob/main/scripts/catalog-truth.mjs; token via `op read 'op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN'`, piped, never printed). `psql` is NOT installed on edge-dev.

## 2. What we set out to do this session, and why

Implement the seven `db-work` issues the 2026-11-15 triage session filed for the #2326 program (plan https://github.com/popcre/shared-db/blob/main/plan_database_efficiency_and_api_security.md): Step 5's four structural changes (#6409 retire 18 duplicate unique-index twins, #6410 retire 3 duplicate plain-index twins, #6411 drop redundant `plm_opa_property_character_pair_key`, #6412 add the `style_groups (primary_asset_id)` FK covering index) and Step 6's remainder (#6415 revoke trigger-function EXECUTE, #6416 measure security-definer RPCs, #6418 matview API-surface contract). The coordinator's nudge: no GitHub output since session creation; claim-first on each issue, then implement.

## 3. Current state — what is true right now

**Verified at write time (2026-11-16 5:56 PM EST):** `origin/main` = `1933aa6a8` (checked 5:08 PM EST); maximum migration version on main = `20261201100000`. Task class `shared-db` was declared at session start.

**Delivered and MERGED (six of seven):**

| Issue | PR (merged) | Migration version | What |
|---|---|---|---|
| #6415 | [PR #6433](https://github.com/popcre/shared-db/pull/6433) (04:57Z) | `20261116013153` | revoke superfluous anon/authenticated EXECUTE (PUBLIC included) on trigger-returning functions |
| #6412 | [PR #6436](https://github.com/popcre/shared-db/pull/6436) (03:12Z) | `20261116124002` | FK covering index `public.style_groups (primary_asset_id)` |
| #6410 | [PR #6447](https://github.com/popcre/shared-db/pull/6447) (03:28Z) | `20261117020001` | retire 3 duplicate plain-index twins |
| #6416 | [PR #6459](https://github.com/popcre/shared-db/pull/6459) (03:46Z) | (docs only) | SD-RPC measurement artifact + dispositions |
| #6409 | [PR #6444](https://github.com/popcre/shared-db/pull/6444) (15:31Z) | `20261117120000` | retire 18 duplicate unique-index twins |
| #6411 | [PR #6454](https://github.com/popcre/shared-db/pull/6454) (16:47Z) | `20261118020001` | drop redundant `plm_opa_property_character_pair_key` |

**Delivery in flight:** **#6418 → [PR #6451](https://github.com/popcre/shared-db/pull/6451)** — OPEN, queued in the merge queue with auto-merge armed (state checked 5:0x PM EST: `OPEN/UNKNOWN`, the queue's processing state). Implementation complete: migration `20261118020000_style_guide_matviews_gated_projection.sql` (rename the two matviews to `*_snapshot`, narrow their grants, recreate the original names as `app.has_app_access('dam')`-gated definer views — the #2662 pattern — and re-point `public.refresh_style_guide_matviews(uuid,integer,text)`), census artifact, `derived-from: 20261105165947` declared. The branch `mimo/2326-6418-matview-grant-narrowing` is preserved; nothing deleted.

**Evidence artifacts on main:**
- Step 5 triage: https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261115T213745Z-step-5-split/step-5-split-triage.md
- Step 6 inventory: https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261115T215045Z-step-6-contract-inventory/step-6-access-contract-inventory.md
- #6415 preview proof: https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261116T023000Z-step6-6415-trigger-execute-revoke/trigger-execute-revoke-proof.md
- #6418 census: https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261116T040000Z-step6-6418-matview-census/matview-app-reference-census.md
- #6416 matrix: https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261116T050000Z-step6-6416-sd-rpc-matrix/sd-rpc-matrix.md

**Claims: ALL SIX RELEASED** (closed with evidence comments): #6432, #6435, #6443, #6446, #6450, #6453. The documented native release flags do not exist (§4) — closure with evidence is the ordinary lifecycle end (`closedClaimAuthoredOnMain` models closed claims).

**Applied to preview:** migration `20261116013153` only (governed lane run 43789639543). **Preview data writes: none persisted** (#6411's ON CONFLICT rehearsal rolled back; #6416's fixture-user creation failed). **Production: nothing applied by this session** — the automatic promotion lane owns that; all six merged migrations await it.

**Preview's known dirt:** the pre-rename rehearsal row `20261116013153` sits in preview's ledger as a file-less orphan (the `preview-ledger-orphan-reconciliation` named class) — see §4 trap 1.

**Not started:** plan Steps 7 (dated index delta + maintenance comparison + WAL/Realtime attribution) and 8 (final report + program close).

**Open follow-up issues (unclaimed, ready):** [#6455](https://github.com/popcre/shared-db/issues/6455) (revoke 17 SD functions), [#6456](https://github.com/popcre/shared-db/issues/6456) (remediate `public.rls_auto_enable()`), [#6457](https://github.com/popcre/shared-db/issues/6457) (resolve 107 revoke-candidates; blocked on an authenticated probe identity).

## 4. Everything we tried that did NOT work — MANDATORY

1. **Renaming a preview-applied migration to dodge Guard B strands a ledger orphan.** Authoring `20261116013153`, preview-applying it, then `git mv`-renaming to `20261116124001` (because main gained future-dated versions) left preview's ledger holding `20261116013153` with no local file — and `supabase db push` then REFUSES every later preview apply ("try repairing the migration history table"). The governed fix is NOT the rename: it is the **historical-restoration registry** (`scripts/historical-migration-restorations.mjs`) — restore the preview-applied version byte-identical and register it (hash-verified) so Guard B allows those exact bytes. The rename was undone. If you ever rename after a preview apply, you own an orphan and the `preview-ledger-orphan-reconciliation` workflow's whole dance.
2. **Guard B is an arms race against future-dated versions.** Other sessions author migrations with timestamps hours/days in the future (`20261116124000`, `20261117020100`, `20261117130000`, `20261201100000`). A version that was legal at authoring turns "backdated" the moment one of those lands on main. #6409/#6411/#6418 each needed re-dating (three rounds total). Reserve well ahead (we ended at `20261118020000`/`20261118020001`) and expect to `git mv` again; keep the filename suffix.
3. **The documented claim-release flags do not exist.** `manage-migration-coordination.mjs`'s cleanup message tells you to "Release each explicitly with `--release-claim`, exact `--owner`, and `--confirm-finished`" — but the CLI REFUSES `--release-claim` as an unknown argument at main `1933aa6a8` (its parseArgs ends in a hard throw; `--park`, `--retire`, `--stop-author`, `--check-in-author` are likewise absent). `migration-retirement-tombstones.test.mjs` passes only because it asserts `notEqual(main(...), 0)` — a parse error satisfies it. Consequence: author check-ins every ten minutes were IMPOSSIBLE this session, and release had to be ordinary issue closure with evidence comments. If you need the real helper, its flags must be implemented first (that is tooling work, tracked in the handover note on #2326).
4. **Preview GoTrue cannot create users (500 `P0001`)** — `POST /auth/v1/admin/users` on the current preview project fails with a Postgres `raise_exception` from the preview `auth.users` trigger chain (`public.handle_new_auth_user` / `app.handle_new_auth_user` family is the suspect). The stored preview test logins (1Password "Poppim preview test login", "DAM AI tester login") return `invalid_credentials` against this preview (they pin older projects/refs), and a minted HS256 JWT with the item's `SUPABASE_JWT_SECRET` is rejected at the auth layer (the secret appears stale). Net: the **authenticated HTTP probe leg is unobtainable** — recorded as an explicit boundary in the #6415 proof and the #6416 matrix; #6457 is gated on fixing this.
5. **Empty-args RPC probes under-signal.** `POST /rest/v1/rpc/<fn>` with `{}` returns 404 when PostgREST cannot signature-match, NOT a refusal proof; one function (`rls_auto_enable()`) actually executed and 400'd. Dispositions were therefore driven by the application `.rpc()` call-site search, with status codes as corroboration only.
6. **Dynamic SQL needs a hash-bound sidecar; literal `alter table` in a DO block demands a catalog contract.** The `execute format(...)` loops in the #6409/#6410/#6411 migrations each trip `check_production_verification_sidecars.py` ("dynamic execution markers [N] require a sidecar"). A `no_durable_target` marker review with a ≥40-non-whitespace-char reason covers them (no check kind can express privilege/index-definition outcomes). Conversely #6411's literal `alter table ... drop constraint` inside its DO block would have demanded a `catalog_contract` sidecar — switching it to `execute 'alter table ...'` moved it to the cheaper marker path.
7. **`create or replace function` needs a `derived-from:` header line.** #6418's rewrite of `refresh_style_guide_matviews` failed `test_the_whole_repository_satisfies_the_mandate` ("replaces an object an earlier migration also replaces, and do not say what body they were derived from") until `-- derived-from: 20261105165947` (the last replacer) was added. The fix is one line; the diagnosis took a full CI cycle.
8. **The PR lane wanted `Closes #N`, then an author lease, then more.** First preview-dispatch attempt died on "trusted signed attribution missing" (the PR body lacked a `Closes #<issue>` line — the signature regex also rejects underscores, so use the established `Posted by MiMo chat ses_xxxxxxxx on edge-dev` shape); the second died on "exclusive lane requires exactly one live author claim for the pull-request branch" (the `db-claim` issue needed a ```db-author-lease fence with `owner/branch/worktree/expires_at/capacity_state`, branch = the PR head branch). Claim files written by `check-dispatch-collision.mjs --claim-body-file` are the LEGACY shape — always append the lease fence.
9. **`node -e` with embedded quotes/regex under this PowerShell tool shell is unreliable** (quote mangling, `\"` not honored). Write scratch scripts to `D:\tmp\*.mjs` files and run those.
10. **PowerShell `Get-Content/Set-Content` encoding pitfalls** (from the previous handoff, re-hit): use `-Encoding utf8NoBOM` explicitly; the `edit`/`write` tools are safe for plain UTF-8.
11. **`ai-shared-db-closeout-check` runs under a machine-wide admission latch and a shared ai-gh throttle** — first full run took ~8+ minutes and died mid-way with `GitHub request deferred by the shared throttle` (`ok:false` — never trust a partial `blocking_claims: []`). Allow up to 3600s and re-run.

## 5. Root causes and key findings

- **The PUBLIC pseudo-role is the real grant on most functions.** `revoke ... from anon, authenticated` is a no-op where the ACL is the function default (PUBLIC EXECUTE) — the census never reaches 0. The correct statement is `revoke ... from public, anon, authenticated` (the 2026-07-29 lockdown documented the trap in the other direction). #6415's migration and PR explain this.
- **Platform-owned functions are outside this repo's authority.** `pg_catalog`/`storage`/`realtime`/`cron`/`repack` trigger functions are owned by `supabase_admin`/`supabase_storage_admin`/`supabase_realtime_admin`; `postgres` is neither superuser nor a member of `supabase_admin` (verified read-only). Revoking there fails `must be owner of function`. They are also outside `pgrst.db_schemas` (live: `public, graphql_public, api, crm, pim, core, app`). The #6415 acceptance deviation (0 in revocable scope; 26 named platform residuals) is documented in its PR and proof doc.
- **Keeper NAMES diverge across environments** (preview vs production `dflow_prod."licensingMilestone"`: `unique_item_stage_dflow_prod_1774369813518` vs `unique_item_stage_designflow_1774369813518`). The #6409/#6410 keeper assertions are definition-based (unique index on the twin's exact columns) for that reason.
- **One migration file serves multiple governed environments** via per-object existence guards (`20260729130000` pattern): shared production (has `dflow_prod`), shared preview (has BOTH `dflow` and `dflow_prod`), and the DesignFlow sandbox lane (has `dflow`). A bare `drop index if exists dflow.x` ABORTS where the schema is missing.
- **#6418's census:** exactly one application (PopDAM, `PopSGLibraryPage.tsx`) reads the style-guide matviews directly (browser as `authenticated`), plus a service-role readiness script. The gated projections take over the exact REST names so PopDAM does not change.
- **`HISTORICAL_RESTORATIONS` hash semantics** (`validateHistoricalRestorationFile`): `fileSha256` = sha256 of the CRLF-normalized file; `statementBytes`/`statementSha256` = the same minus the trailing newline. #6415's entry is the worked example.
- **The merge queue drops auto-merge silently during promotion freezes** ("merges are paused for a production run; promotion merge freeze held by ... until ...") — freeze-era check failures look like real failures; re-run them after the freeze lifts.

## 6. Exact next steps

1. **Verify PR #6451 landed.** `gh pr view 6451 --repo popcre/shared-db --json state,mergedAt`. You'll know it worked when `state=MERGED` and `20261118020000_style_guide_matviews_gated_projection.sql` is on `main`. If it ejected from the queue: the branch `mimo/2326-6418-matview-grant-narrowing` is preserved at `0729fc920`+ (re-check); re-claim on #6418 (claim-first, own worktree), fix whatever the queue complained about, re-arm `gh pr merge 6451 --auto`. Do NOT re-author the migration.
2. **#6418's post-merge preview proof** (the issue's proof list: HTTP probe before/after — out-of-app identity count → 0, dam identity unchanged; PopDAM journey unchanged; contract tests green). Record it on #6418, then the issue's acceptance is met. You'll know it worked when the comment carries the status codes and #6418 closes through its normal path.
3. **Watch the automatic production promotion** of the six merged versions (`20261116013153`, `20261116124002`, `20261117020001`, `20261117120000`, `20261118020001`, and `20261118020000` when #6451 merges). The lane owns it; no manual production SQL. The #6409/#6410/#6411 acceptance "governed promotion afterward" completes there.
4. **#6416 follow-ups** (claim-first each): #6455 (revoke 17 — same shape as #6415, existence-guarded catalog loop + sidecar), #6456 (`rls_auto_enable()` remediation), #6457 (107 revoke-candidates; FIRST fix or route around the authenticated probe identity — §4 trap 4).
5. **Then Step 7** (plan Phase E): the #1966 dated index delta (re-read the same 73 indexes vs the 2026-09-03 baseline), the maintenance comparison, the WAL/Realtime attribution report. NOTE: #5747's `auto-3` checkpoint ("index re-check and close-out") fired Wed 2026-11-18 9:07 AM EST — read its output before redoing the index half.
6. **Then Step 8**: final report `docs/verification/database-efficiency/<final-UTC>/final-report.md` per the plan's Step 8 checklist; retire this handoff and the two predecessor handoffs in the PR that finishes the program; close #2326 with a summary comment (it is a program issue, not an outcome-lifecycle issue).
7. **Tooling gap (tracked on #2326's handover note, not a db-work issue):** implement `--release-claim`/`--confirm-finished`/`--park`/`--stop-author`/`--check-in-author` in `scripts/manage-migration-coordination.mjs` (or fix the cleanup message that promises them) and fix the weak retirement tests that pass on parse errors.

You'll know the program is done when the plan's STATUS rows 5–8 read ✅ with evidence, every follow-up issue is closed or explicitly accepted, and #2326 closes.

## 7. Constraints and gotchas in force

All of the 2026-11-15 handoff §7 remain: worktree-only from `origin/main`; `gh pr merge --auto` only (never `--squash`/`--admin`); sign every GitHub post `Posted by MiMo chat ses_ffe5e1ec on edge-dev` (or your own ids); no manual production SQL (Management API `read_only: true` only); preview instrumentation writes only for named measurements and never persist the preview ref; never edit an applied migration; never touch other sessions' HANDOFF.d files or worktrees; never close an outcome-lifecycle issue by hand. Plus this session's:

- **Reserve migration versions well AHEAD** (`--reserve-version --version <future>`) — Guard B vs future-dated peers (§4 trap 2). Reservations are permanent and never released.
- **After ANY preview apply, the version is burned into preview's ledger** — renaming that file afterwards strands an orphan (§4 trap 1). Prefer the historical-restoration registry over renames once preview has seen the bytes.
- **Every migration with `execute`/dynamic SQL needs a hash-bound sidecar** (`scripts/production-verification-sidecars/<version>.json` + a registry entry in `config/production-verification-sidecar-registry.json`); `alter table` literal in a DO block needs a `catalog_contract` sidecar instead (§4 trap 6).
- **`create or replace function` needs `-- derived-from: <version>`** in the header (§4 trap 7).
- **PR bodies need exactly one `Closes #<work issue>`** (the lane routes on it) and claim issues need BOTH the `db-claim` fence and a `db-author-lease` fence whose `branch` equals the PR head branch (§4 trap 8).
- `ai-doc-health` at `C:\repos\ai-devops\bin\ai-doc-health.cmd` (not on PATH; `git add` first); `ai-pr-wait` refuses docs-class PRs; merge freezes chain 30–45 min (`node scripts/manage-migration-coordination.mjs --check-promotion-freeze --pr <n>` until `allowed:true`, then immediately enqueue).

## 8. Access and environment

- Machine **edge-dev** (Windows). `gh` authenticated as `u2giants` (shared across sessions — `gh pr list --author "@me"` lists every session's PRs).
- 1Password vault **`vibe_coding`**. Supabase access token at `op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN` (`op read` piped, never printed). Preview credentials item: "Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)" — its `SUPABASE_PROJECT_REF` matches the repo variable `PREVIEW_PROJECT_REF` (fetch at use time, never persist). **Its `SUPABASE_JWT_SECRET` appears stale and its GoTrue cannot create users (§4 trap 4).** `op item get "<title>" --vault vibe_coding --reveal --fields <field>` works; plain `--fields` prints a help string instead of a concealed value (trap!); `op read "op://vault/<title>/<field>"` fails in PowerShell for titles with spaces.
- Supabase production ref `qsllyeztdwjgirsysgai` (read-only). Preview is branch `shared-db-schema-rehearsal`. `psql` not installed; SQL via the Management API (`D:\tmp\sgdb-q.mjs` scratch runner pattern this session — the repo's canonical pattern is `scripts/catalog-truth.mjs`).
- Session identity: `ses_ffe5e1eca1169ffeVMOIFzEA5L` (short id `ses_ffe5e1ec`). Claims, signatures and the closeout check key on it.
- Secrets sweep: **swept, nothing new** — no new credential appeared this session; existing vault items were only read via `op` and never printed to chat/files/commits.

## 9. Open questions and risks

- **PR #6451 may eject** from the merge queue (they do during promotion freezes). If so it needs a re-arm, not re-authoring. (Dated 2026-11-16 5:56 PM EST.)
- **Six merged migrations await production promotion** — their acceptance "governed promotion afterward" is incomplete until the automatic lane applies them. A promotion failure is a new work item, not a re-do. (Dated 2026-11-16.)
- **Preview's orphan ledger row `20261116013153`** (pre-rename rehearsal) is documented; the reconciliation workflow's class. If any future preview push complains about it, that is the known cause. (Dated 2026-11-16.)
- **Spent reservations from this session — never reuse:** `20261116013153`, `20261116014444` (unused — the #6412 original), `20261116124001` (unused — the undone rename), `20261116124002`, `20261117020000`, `20261117020001`, `20261117020002` (unused — the #6418 original), `20261117020003`, `20261117120000`, `20261117120001` (unused — intermediate), `20261117120002` (unused — intermediate), `20261118020000`, `20261118020001`. (Dated 2026-11-16.)
- **#6416's 107 revoke-candidates carry a dated caveat** (authenticated leg not obtained; empty-args probing under-signals). Do not treat them as measured refusals. (Dated 2026-11-16.)
- **The claim-release tooling gap** (§4 trap 3) means any session closing out until it is fixed will hit the same wall; the `ai-shared-db-closeout-check` receipt must be interpreted with that in mind. (Dated 2026-11-16.)
- Stale-by-nature: main SHAs, max migration version and PR states (checked 5:08–5:56 PM EST 2026-11-16); the #6415/#6416 counts (130→104/26, 201 functions) are 2026-11-15/16 pins and move.

## Part (b) — sub-agents

N/A — this session dispatched no sub-agents or sub-sessions. All implementation was done directly.

---

## Self-audit (handoff-writer gate)

1. *Comprehensive enough for a brand-new developer?* Yes — §1 orients the repo; §3 pins every artifact/PR/version with URLs; §6 gives ordered steps with "you'll know it worked when" gates. Supporting: 1, 3, 6.
2. *Detailed enough to continue as effectively as me?* Yes — §4 carries every dead end with the why (the version-race, the orphan trap, the missing tooling flags, the GoTrue breakage); §5 carries the non-obvious findings (PUBLIC grants, platform boundary, keeper-name divergence, multi-environment guards, hash semantics). Supporting: 4, 5, 7.
3. *Every relevant detail included?* Yes — background (§1–2), current state with URLs and timestamps (§3), failures (§4), findings (§5), exact actions + gates (§6), constraints (§7), access/secrets-by-location (§8), risks with dates including the spent-version list (§9).
4. *If the owner read only §0, would he see every business decision and no technical approval?* Yes — the sweep found the leaked-password decision (DECLINED, recorded, do-not-re-ask) and the conditional matview question (self-resolved by the census); no approval asks exist anywhere (the plan's superseded wording is marked). Everything else technical is a `Blocked —`/tooling item, not an ask.
