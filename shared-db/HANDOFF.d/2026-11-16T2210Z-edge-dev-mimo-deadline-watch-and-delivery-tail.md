---
issue: 5937
status: OPEN
owner: mimo/watch-handoff-5937
---

# Handoff — deadline-header watch, delivery tail, and the lessons of the 2026-11-13..16 coordinator day

Written 2026-11-16 5:10 PM EST by the MiMo coordinator session on `edge-dev`, closing its chat. This file carries the two WATCH items that outlive the session plus everything the session learned the hard way. The file is finished when both watch items in §3 are ticked/verified; the session that proves them deletes this file (successor rule, §2.1-H).

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream needs the owner.** Every remaining item is technical watching or system cadence. Per the owner's standing rule (2026-11-13): technical questions go to Muse (`ai-muse`, skill `ask-muse`), never to Albert.

**Already settled — do NOT re-ask:**
- 2026-11-13 — technical/implementation decisions are routed to Muse, not Albert; any question that DOES reach him must carry plain-language context and background.
- 2026-11-13 — Muse session `stranded-recovery-ruling-20261113` (recorded verbatim in a comment on [#5932](https://github.com/popcre/shared-db/issues/5932)) authorized the stranded-version recovery route: reissue with equivalence proof + hard-blocked originals, recorded derivation-override or re-derivation for retired bases, co-promotion of missing bases in one ordered window. Its one factual error (it named `20260825124200` as the superseding base of `replace_asset_ai_tag_result`; evidence in [#6261](https://github.com/popcre/shared-db/issues/6261) proved the real replacer is `20260825165139`) was corrected in a signed comment on #5932; the rest of the ruling stands.
- 2026-10-29/30 — reviews are advisory and never a merge gate; only production-data-damage or secret-leak checks block a merge. Never ask a human to approve anything.

## 1. What this application is

`popcre/shared-db` is the shape-of-database source of truth for POP Creations' shared Supabase Postgres (project ref `qsllyeztdwjgirsysgai`), used simultaneously by CRM, DAM, PIM and DesignFlow PLM. Migrations under `supabase/migrations/` reach production ONLY through the bounded automatic promotion workflow ([`shared-supabase-migrations.yml`](https://github.com/popcre/shared-db/blob/main/.github/workflows/shared-supabase-migrations.yml)): preview rehearsal → production apply → post-apply verification. There is no manual production path. The repo's own automation keeps a live drift alarm at [#5932](https://github.com/popcre/shared-db/issues/5932) ("MIGRATION LEDGER DRIFT") listing merged-but-unapplied versions hourly.

## 2. What we set out to do this session, and why

Albert directed a coordinator session (sub-agents do all work): pull the repo, triage every open issue, clear the three highest-priority unblocked ones, then later "handle all the blocked items", then a stranded-migration recovery under a Muse ruling. The session ran 2026-11-13 through 2026-11-16 and dispatched eleven sub-agent runs (part (b) below). Business purpose: get merged-but-stuck database deliveries actually live, stop false alarms, and remove silent-skip hazards — so the shared database matches what the apps expect.

## 3. Current state — what is true right now

**Delivered and live in production (verified ledger rows):**
- `20261113160920` (curated licensor scrape characters restore; reissue of stranded `20261101125528`) — ledger row 2026-11-13 16:09:20, apply run [43473630989](https://github.com/popcre/shared-db/actions/runs/43473630989).
- `20261115022307` (ai_tag_save_set_based; corrected re-derivation replacing `20261101192220`) — apply run [43671409692](https://github.com/popcre/shared-db/actions/runs/43671409692). Declared `-- derived-from: 20260825165139` (the corrected base).

**Merged, delivery rides the automatic lane (the TAIL):**
- PR [#6335](https://github.com/popcre/shared-db/pull/6335) (tolerant fix-forward of the unapplyable reissue `20261113223432`) merged 2026-11-16 12:35 PM EST. Its version joins the genuinely-pending list and the hourly selector delivers it. The pending list stood at 11 at 1:35 PM EST 2026-11-16 and moves with merge traffic — watch the auto-comments on [#5932](https://github.com/popcre/shared-db/issues/5932), do not chase numbers.

**WATCH 1 — the deadline-header watch on [#5937](https://github.com/popcre/shared-db/issues/5937).** The closing note there holds two checkboxes: (a) first real `-- promote-by:` migration observed in the promotion path; (b) next main-moved refusal observed NOT consuming the refund budget. (a) has no subject: `git grep -l "promote-by" origin/main -- supabase/migrations` is EMPTY as of 2026-11-16 — no migration in history declares the header. (b) was observed and ticked 2026-11-13 (production refusal runs 43088247701 and 43327480559 classified stale-only with 0 attempts/0 refunds consumed) — leave that tick in place.

**WATCH 2 — the delivery tail.** See the merged row above. Proof of finish: a fresh read-only ledger check showing the tail versions applied, or the #5932 genuinely-pending list drained to its steady-state noise.

**Also closed this session (nothing to do):** #6077 (folder-rename history — had shipped; ticket mistyped), #6119 (false stuck-migration alarm — fixed and closed), #5937's implementation (all three behaviors landed; only the two watch checkboxes above remain), #6237 (selector classification gaps — fixed and closed 2026-11-13), the catalog-verification gap (PR [#6363](https://github.com/popcre/shared-db/pull/6363) merged 2026-11-15: `-- catalog-verification: no-op <reason>` honored and undeclared pure-data migrations noted instead of refused), and the duplicate-stamp hazard (PR [#6360](https://github.com/popcre/shared-db/pull/6360) re-versioned and merged 2026-11-15 7:57 PM EST).

## 4. Everything we tried that did NOT work (do not repeat)

1. **`gh pr merge` can exit silently with no effect** when the merge queue owns the strategy and the invocation shape confuses it (empty output, exit 0). It also answers `! Pull request … is already queued to merge` when queued, or `! The merge strategy for main is set by the merge queue` when a strategy flag is passed at the wrong moment. Workaround that worked: retry plain `gh pr merge`, then verify with `gh pr view --json state,mergedAt` and the `--event merge_group` run list. The GraphQL `addPullRequestToMergeQueue` mutation does NOT exist on this GitHub surface (undefinedField).
2. **Main-moved races are relentless under constant merges.** Preview rehearsals dispatched with a pinned SHA get REFUSED 3–5 times in a row ("origin/main … has moved past the dispatched commit … Re-dispatch against the current tip"). Fetch→dispatch→run must be sub-minute, back-to-back. Waiting for main to "stabilize" does not work — this repo never stops.
3. **Background sub-agent turns freeze inside long watch calls** (gh run watch / pr checks --watch) for 20–30+ minutes; queued coordinator messages sit unseen behind the frozen turn. Recovery that worked: `actor cancel` (graceful) then a fresh `send` with the exact remaining step — or take the last mechanical step yourself.
4. **GitHub primary API rate limit** (HTTP 403, "API rate limit exceeded for user ID 55610577") after heavy run-log inspection; resets at the top of the hour. Stand down and wait; retrying burns the window.
5. **Muse's ruling cited the wrong base version** for `replace_asset_ai_tag_result` (it said `20260825124200`; the guard's own data shows the real last replacer is `20260825165139`). Review-finding [#6261](https://github.com/popcre/shared-db/issues/6261) caught it. Rule: verify a ruling's factual claims against the guard/ledger before building on them.
6. **The `--derivation-override` shortcut was correctly refused** (ruling condition 2.2): intervening changes (`20260825010603`, `20260825031841`) between the retired base and the superseding base break body-equality, so the pair was re-derived fresh instead. The override path is only safe when the intervening-change check passes.
7. **A reissue of a preview-applied original can NEVER apply on preview** (SQLSTATE 23505 duplicate key `property_character_source_edge_current_claim_key` — the original's rows are already there from a partially-failed run). Four attempts failed identically. The cure is an idempotent fix-forward (tolerant insert), NOT re-dispatch. This is what PR #6335 became.
8. **Backdated-stamp guard:** a reissue version must sort AFTER `origin/main`'s newest migration or be registered in `historical-migration-restorations.mjs`; the simpler cure is a pure rename to a fresh stamp (reserve first via `node scripts/check-dispatch-collision.mjs --reserve-version --json`, then rewrite every contract reference — there were NINE for one file).
9. **Duplicate 14-digit stamps silently skip** (standing fact 4). PR #6362 merged carrying `20261115133704` while PR #6360 carried the same prefix — caught and re-versioned before the second merged (both the submission file and its table-ACL companion needed re-stamps).
10. **Documents-only merge authorization red is NOT always a defect** — a production freeze or a moved head refuses it ("merges are paused for a production run; promotion merge freeze held by … until …"). Wait it out; the required three checks are what matter. A stale author-acquisition mutex is recovered via the `recover-author-mutex.yml` workflow dispatch.

## 5. Root causes and key findings

- **The drift report's "genuinely-pending" class ignores supersession.** 5 of 7 "stranded" originals had already been silently reissued by earlier sessions (`20261031031837`, `20261101000005`, `20261101182210`, `20261102181554`); the recovery retired them as paperwork with named replacements instead of rewriting anything. ALWAYS run the supersession check (diff the carried object bodies against `origin/main` tip) before any reissue — it is ruling condition 1.5 and it saved the most work.
- **Post-apply catalog verification can go red on a SUCCESSFUL apply.** A catalog-lexer gap flagged `20261113160920` (pure-data) as "proved nothing". Fixed 2026-11-15 (PR #6363): the `-- catalog-verification: no-op <reason>` header is honored and undeclared pure-data migrations get a note instead of a failure. Before that fix, a red catalog step did NOT mean un-applied — always confirm with a read-only ledger row before re-dispatching.
- **The selector's stale-main / refund classification had two real gaps** (now fixed and closed as [#6237](https://github.com/popcre/shared-db/issues/6237)): the workflow step name `Verify exact main commit` was missing from `COORDINATION_STEPS`, and a FAILED `refund-eligible-fault` marker (annotation-lag fail-closed) polluted the failed-step set — both charged free staleness refusals as attempts.
- **Historical-recovery lane inputs** (`historical_preview_source_pr` + `historical_preview_original_run_map=<version>:<successful preview run id>`) are the ONLY sanctioned retry after a failed production apply once preview holds the version — exactly as `scripts/automatic_promotion_candidates.py dispatch()` builds them. A second fresh apply will collide.
- **Truth-audit / throughput-guard pins:** any edit to `scripts/production_catalog_verification.py` must re-stamp `detector_source_sha256` in `docs/verification/throughput-guard-truth-baseline-20260828.json`; lines matching the truth-audit pattern are identity-pinned in `docs/verification/throughput-dispositions/<source~path>.json` and changed-line identities must be retired via `throughput-retired-identity-sites-<issue>.json`.
- **`ModuleNotFoundError` noise in throughput-guard CI logs is expected stderr of a passing negative subtest** — not a failure.
- **Windows-only quirk:** the "protected sidecar executable" test fails on a Windows checkout of pristine `origin/main` (checkout-root/immutable-head mismatch) but passes on Linux CI. Pre-existing; not fixable in scope.

## 6. Exact next steps

1. **Daily watch (automated — see the MiMo Desktop scheduled task "shared-db deadline watch and delivery tail").** Each pass: (a) `git grep -l "promote-by" origin/main -- supabase/migrations` and scan recent promotion runs for a migration declaring `-- promote-by:`; when one appears in a real promotion run, tick checkbox (a) in the [#5937](https://github.com/popcre/shared-db/issues/5937) closing note with the run link + exact log line (preserve all existing note text; sign `Posted by MiMo chat <id> on edge-dev`). You'll know it worked when the checkbox shows `[x]` with a named run. (b) Confirm the tail: read the newest auto-comment on [#5932](https://github.com/popcre/shared-db/issues/5932); when the genuinely-pending list no longer contains the PR #6335 line and has reached steady state (or zero), note it. You'll know it worked when the #5932 comment reflects it.
2. **If the watch automation ever lapses**, any successor session can run the same two checks in minutes; this file is the full procedure.
3. **When both watch items are proven**, delete THIS file in the same commit/PR that records the proof (successor rule) and leave [#5937](https://github.com/popcre/shared-db/issues/5937) closed. Do NOT open a new ticket for the same gap (owner rule: name it in the closing note instead).
4. **Not yours to chase:** the genuinely-pending backlog itself drains on the automatic selector's own cadence; review-finding [#6364](https://github.com/popcre/shared-db/issues/6364) (opened by the auto-fixer on the catalog fix) belongs to the fixer lane.

## 7. Constraints and gotchas in force

- Worktree-only: every session works in its own `git worktree` cut from `origin/main`; never edit or branch in the shared checkout ([§2.1-W](https://github.com/popcre/shared-db/blob/main/docs/agents/worktrees-and-handoffs.md)).
- Claim-first for structural work: claim exact objects on the issue, declare `SHARED_DB_AUTHOR_ENGINE` + `SHARED_DB_SESSION_ID`; reserve every fresh 14-digit version atomically BEFORE creating the file; never edit an applied migration; never duplicate a version prefix (silent skip).
- Merges: through the GitHub merge queue with plain `gh pr merge`; `--squash`/`--admin`/strategy flags misbehave (see §4.1). Required checks are lean: `SQL migration guards`, `supabase/tests against an ephemeral database`, `Destructive SQL outside migrations`. Review reds (e.g. `fix / review-fixer`) and the Documents-only pair are advisory.
- Production is read-only except through the bounded promotion workflow; acquire/release promotion freezes around production windows (standing fact 14), tight TTLs with gaps so docs/other lanes can authorize.
- Never ask a human to approve anything; technical decisions go to Muse. Sign every GitHub post `Posted by MiMo chat <id> on edge-dev` (`unknown` if the id is empty).
- `ai-task-gates start --class shared-db` at worktree start; `ai-task-gates check --before <action>` before review/pr-wait/ship/database/production actions.

## 8. Access and environment

- `gh` authenticated as `u2giants` on `popcre/shared-db` (all posts appear under that account). Windows machine hostname `edge-dev`; repo checkout at `D:\repos\shared-db` on this machine (see §7 — read/fetch only).
- `ai-muse` (Muse) available for technical rulings; `ai-task-gates` installed at `C:\Users\ahazan\.local\bin\`.
- Supabase Management API reads use the Personal Access Token from 1Password vault `vibe_coding` (item "Supabase CLI Personal Access Token") via `op read` — never print or commit secrets.
- MiMo Desktop scheduled tasks (automation) carry the daily watch; session memory lives under the MiMo memory store.

## 9. Open questions and risks

- **Tail timing (2026-11-16):** the PR #6335 version's delivery is expected on the selector's next passes; if it is still pending after 48 hours, re-examine its classification in the newest #5932 auto-comment (it may have inherited a refusal class) before dispatching anything manually.
- **Pending-list churn:** merges arrive faster than applies on busy days (8 → 11 within an hour on 2026-11-16). Do not read a rising count as a regression.
- **Stale header reconciliation:** the reissue chain left a merged file whose `-- Version:` header stamp disagrees with its ledger stamp (`20261113223432` file carries `20261113191352` in its header). Harmless to the ledger; reconcile it in any FUTURE contract edit touching that chain — never edit the applied/merged file just for cosmetics.
- **Advisory finding #6364** may resurface as a fixer PR; its lane owns it.

---

## Part (b) — coordinator sub-agent dispatches (2026-11-13..16)

Eleven runs, grouped by mission. Each block: asked / did / found / evidence line / what it did NOT do.

### Mission 1 — the first three issues (runs general-1..3)
- **general-1 (issue #5937, promotion deadline/freeze/budget):** asked to implement the three proposed behaviors. Did: found behaviors 1 and 3 already landed via PR #5954 (131 selector tests); closed the remaining gaps in PR [#6156](https://github.com/popcre/shared-db/pull/6156) (promote-by SQL guard in `check-sql.sh`, required-path merge freeze on `SQL migration guards`, standing-fact-14 docs) — merged `243d2d2112b3b5fb14b85e1e8845f3b21a1e9b75`. Found: "Merge queue gate" is advisory, so enforcement must ride a required context. Did NOT: touch the refund classifier's unreadable-logs fail-safe (recorded instead).
- **general-2 (issue #6077, folder-rename history):** asked to build the claimed objects. Did: discovered they had ALREADY shipped (PRs #6078/#6097/#6102) and the ticket sat open only because a PR body wrote `Closes 6077.` without `#`; took over the stale claim, posted evidence, closed. Found: auto-close keywords need `#`. Did NOT: author any new migration (none needed).
- **general-3 (issue #6119, false stuck-migration alarm):** asked to prove `20261111183827` live and stop the alarm. Did: read-only ledger proof (row 948 of 958), `--complete-work` recovery record, fix-forward PR [#6148](https://github.com/popcre/shared-db/pull/6148) merged `01597045dad3c7a8af17316e6a46d94579c2b470` (apply-step success now counts as in-production), issue closed. Found: closing the issue alone re-opens a NEW alarm — the selector had to learn. Did NOT: chase the migration (owner said not to).

### Mission 2 — the four blocked items (runs general-4..7)
- **general-4 (orphaned-ticket sweep):** exhaustive scan of 2910 merged PR bodies + 13,299 commit messages; ZERO remaining mistyped closers (the only one ever was #6077). Nothing to close. Did NOT: touch genuine open work.
- **general-5 (7-day search proof):** confirmed the paired PopDAM run (119/119, p50 1.0 s vs 3 s target — MET), filed `after-7d.md`, merged PR [#6236](https://github.com/popcre/shared-db/pull/6236) (`84c42ee258c9072e75ba715e15da1406acf685a6`), posted the verdict on [#5747](https://github.com/popcre/shared-db/issues/5747). Found: the scheduled paired run never existed (schedule removed before a backlogged GitHub cron flush); the manual stand-in run 43355019011 is authoritative. Did NOT: close #5747 (Step 3 index re-check is gated to 2026-11-18; an existing automation covers it).
- **general-6 (delivery queue drain):** applied `20261101133201` live (run 43439486965); classified the rest (7 stranded, 1 review-held, 1 decision brief, 2 base-absent, 1 transient). Did NOT: reissue or override anything (awaiting the ruling).
- **general-7 (#5937 live watch items):** ticked watch (b) with real refusal runs 43088247701/43327480559 (0 attempts/0 refunds); proved watch (a) has no subject (`git log --all -S "promote-by"` empty); filed the two selector gaps as [#6237](https://github.com/popcre/shared-db/issues/6237). Did NOT: manufacture production events.

### Mission 3 — the stranded recovery (runs general-8, general-9)
- **general-8:** per the Muse ruling — retired 8 superseded originals with named replacements (guard contract + tests, PR [#6249](https://github.com/popcre/shared-db/pull/6249)), reissued `20261101125528`→`20261113160920` (PR [#6256](https://github.com/popcre/shared-db/pull/6256), applied live), refused the class-B override on the intervening-changes rule and re-derived as `20261113162637` (PR [#6257](https://github.com/popcre/shared-db/pull/6257)), reissued `20261102012258` as a fresh stamp (PR [#6260](https://github.com/popcre/shared-db/pull/6260)). Found: the drift class ignores supersession; the ruling's base claim was wrong. Did NOT: force any apply past the no-grind bound.
- **general-9:** cleared review-finding [#6261](https://github.com/popcre/shared-db/issues/6261) (correct base `20260825165139`, retired duplicate owner `20261101212654`, allowlist cleanup) in PR [#6284](https://github.com/popcre/shared-db/pull/6284); delivered `20261115022307` live via historical-recovery after a GitHub-outage refusal. Found: backdated-stamp cure is a pure rename (reserve first); the tolerant re-cut is the only cure for the 23505 preview collision. Did NOT: mutate preview state to clear the collision (chose the reversible fix-forward — PR #6335, which landed 2026-11-16).

### Mission 4 — the last two fixes (runs general-10, general-11)
- **general-10 (catalog-verification gap):** PR [#6363](https://github.com/popcre/shared-db/pull/6363) merged `6f5bfcedd7eb14640a55dbeb1ec0eecfb09f393c` — `-- catalog-verification: no-op` honored + undeclared pure-data migrations noted instead of refused; 704 python tests incl. 15 new pinned. Found: truth-audit/throughput-guard hash pins must be re-stamped on edits to that file; `ModuleNotFoundError` log lines are expected negative-subtest stderr. Did NOT: change fail-closed edges.
- **general-11 (duplicate-stamp takeover of dormant PR #6360, owner instruction "if not actively worked, take it up"):** re-versioned `20261115133704` → `20261116001951` (plus its table-ACL companion → `20261116123000`), merged PR [#6360](https://github.com/popcre/shared-db/pull/6360) 2026-11-15 7:57 PM EST. Found: a second companion file shared the stamp. Did NOT: touch PR #6362's merged copy.
