---
issue: 3552
status: OPEN
owner: mimo/edge-dev-shared-db.orch-3535-successor
---

# shared-db orchestrator handoff — marker #3552 (edge-dev / MiMo)

Successor orchestrator after marker #3535 closeout (handoff
`HANDOFF.d/2026-09-25T1750Z-edge-dev-mimo-orch-3535-fresh-session.md`).
Marker **#3552** opened 2026-09-25T18:41:38Z, route_id
`local_d5924ec8-bedc-4884-aac0-cea0b6efe4bd`, engine `claude` shape
(local_ uuid), handover_issue 3535, authorization owner-current-chat.

Wrap-up invoked by Albert. Scope freeze in force: no new work after this
handoff. Unfinished items are queued below.

**Facts re-verified at wrap-up (2026-09-25 evening EST):**
- `origin/main` tip: `d68be25cb86cb0546dc2b58602953d148c44faef`
- Max migration on main: `20260925193145` (licensing candidate APIs, from #2835)
- Open `orchestrator-marker`: #3552 only
- Open `db-claim` issues: 3546, 3502, 3483, 3482, 3378, 3307, 3294

---

# Section 0 — DECISIONS ONLY THE OWNER CAN MAKE

## Already settled this session — do NOT re-ask

- **2026-09-25: Strawberry Shortcake Submissions scrape CANCELLED.** Albert:
  "we no longer need a Strawberry Shortcake Submissions scrape. i made a manual
  ruling (that was supposed to have been documented) that strawberry shortcake
  has only 1 property." The one-property rule is documented in
  `docs/business-rules/licensing-master-data.md` (PR #3544). #3545 parked.
- **2026-09-25: #2541 HOLD ENTIRELY** ColdLion codes. FORK items parked.
- **2026-09-25: #2290 ALLOW AS WRITTEN.**
- **2026-09-25: #3282 ACCEPT EXISTING** (done).
- **2026-09-25: #3498 production click authority.** Albert verbatim: *"this is
  too manual for me. you need to do it. i am non-technical and don't know what
  i am doing."* Driving session may complete the GitHub `environment:production`
  approve click ONCE if all gates are green.
- **Standing: do not re-ask a question when there is no reason to change the
  answer.**
- **MiMo flash / membership plan:** one key covers pro AND flash; never ask for
  an API key. Flash-spawn work was STOPPED by owner instruction earlier this
  day. This session used general agents only.
- **2026-08-18:** five Paramount/`VM` codes stay live (#539/#1177).
- **2026-09-16:** technical production approval belongs to an independent
  reviewer, not Albert.
- **2026-08-19 / #1286:** `required_status_checks.strict` is FALSE on purpose.
- **2026-08-13:** no HANDOFF.d count cap. Retire stale files only.
- **2026-08-21 / #1366:** repo-maintenance is NOT orchestrator work.

## Wrong guess is recoverable

None pending.

---

# Section 1 — What this application is

`popcre/shared-db` is the single source of truth for the shared Supabase
database schema used by PopCRM, PopDAM, PopPIM, and DesignFlow PLM. Structural
changes are authored here, previewed, then promoted to production
(`qsllyeztdwjgirsysgai`). One orchestrator session dispatches structural work
to sub-agents in isolated worktrees. Owner Albert Hazan (`u2giants`) is not a
programmer and does not review code or merge PRs.

# Section 2 — What we set out to do this session, and why

Resume as successor orchestrator after marker #3535. Open own marker #3552.
Put Section 0 to Albert. Resolve #3539 first (Pixar under Disney; DCP Vault
licensor from source system). Parallelize maximally with concurrent sub-agents.
Then land the structural PR queue and the tooling collision queue.

# Section 3 — Current state — what is true right now

## Landed this session

| Item | Evidence |
|---|---|
| PR #3511 merged | Guarded Merge `36183067951`, SHA `530ffb393c7e129c7b9dbe41e0674835e66d9594` |
| PR #3385 merged | Guarded Merge `36190548506`, SHA `4f395967e1a5bd42db1e28dce85faa10e3c8537b`; claim #2745 released |
| PR #2835 merged | Guarded Merge `36194950457`, SHA `2c4159ff5693b3f81acca03c967cc7f7899dfe9d`; claim #2834 released; issue #2357 closed |
| PR #3520 merged | Guarded Merge `36195925233`, SHA `f65db22c9d6baa3860aa91c8a133782b87f6f023` |
| PR #3558 merged | Cross-PR collision guard fix (Compare API 300-file truncation) |
| Marker #3552 open | route_id `local_d5924ec8-bedc-4884-aac0-cea0b6efe4bd` |
| Strawberry Shortcake ruling recorded | comments on #3539 and #3545; #3545 parked |

## Open structural PRs (orchestrator work)

| PR | Issue | Claim | Head | State | Next |
|---|---|---|---|---|---|
| #3557 | #3539 | #3546 v20260925174850 | `f104888f2` | MERGEABLE; REVISE fixes for twentieth_century_dcpvault + executable proof are COMMITTED (49360aaae + f104888f2) but NOT yet re-reviewed | Fresh two-slot reviews at `f104888f2`, then Guarded Merge |
| #3510 | #3498 | #3502 v20260925044029 | `ef422f650` | MERGEABLE; slot 1 Muse APPROVE exists at this head; slot 2 MISSING | Assign+run slot 2, then Guarded Merge. Production click after merge (owner authority) |
| #3489 | #3457 | #3482 v20260925175038 | `5e8d470d3` | MERGEABLE | Confirm CI; two-slot reviews; Guarded Merge |
| #3487 | #3458 | #3483 v20260925171844 | `f3e3386f3` | MERGEABLE; contract gen 2 published; #3103 already merged docs-only (no serialize conflict) | Two-slot reviews; Guarded Merge |

## Claims still held

| Claim | Issue | Version | Note |
|---|---|---|---|
| #3546 | #3539 | 20260925174850 | function api.db_data_admin_scraped_source_inventory |
| #3502 | #3498 | 20260925044029 | plm.item_user_assignment, plm.item_workflow_action |
| #3483 | #3458 | 20260925171844 | function public.refresh_style_guide_matviews |
| #3482 | #3457 | 20260925175038 | function public.search_dam_documents |
| #3294 | #2662 | 20260923174737 | six api views; PR #3304 slot-1 blocked |
| #3307 | #3175 | 20260923173656 | taxonomy health; PR #3309 slot-1 blocked |
| #3378 | #2110 | 20260923181754 | designflow_frozen drop; parked |

## Tooling queue (non-orchestrator / repo-maintenance — land serially)

Order: **#3521 → #3522 → #3525 → #3526**. All collide on
`scripts/manage-migration-author-lanes.mjs`. After #3521 lands: implement
other-slot-verdict-frees-reviewer on `resolvePeerSlots`.

Also open tooling-ish: #3528, #3524, #3519, #3518, #3516, #3515, #3513, #3447,
#3396, #3391, #3389, #3369, #3341, plus newer #3556/#3564/#3567 from other
sessions.

# Section 4 — Everything we tried that did NOT work (MANDATORY)

1. **PowerShell here-strings for GitHub issue bodies** — triple-backtick fences
   and backticks get eaten (backtick is PS escape). Write a UTF-8 file with the
   Write tool and `gh issue edit --body-file`. This broke marker #3552's first
   routing block and several comments.
2. **`engine: mimo` on the orchestrator marker** — refused; only `codex`,
   `claude`, `zcode` are valid. Use `claude` + `local_<uuid>` route_id.
3. **`ai-task-gates start --class structural`** — unknown class. Valid includes
   `shared-db`. Run via Git bash (`C:\Program Files\Git\bin\bash.exe`), not
   `pwsh -File` on the `.cmd`.
4. **`--help` on manage-migration-author-lanes.mjs** — REFUSED: unknown argument.
5. **Sub-agent APIError / cancellation waves** — several general agents died
   mid-flight (general-1, 8, 10 partly, 12, 14/23/28, 15, 26, 27). Always
   re-verify live GitHub state before assuming an agent finished or failed.
   Partial work often survives in the worktree (example: #3539 REVISE fixes
   were committed even though the agent was cancelled).
6. **Guarded Merge without main freshness** — refused when origin/main moved
   past the dispatched commit. Merge main first, rebind evidence if head moves.
7. **`gh run rerun` after a base-branch tooling fix** — reuses the original
   merge ref and does NOT pick up the fix. Merge origin/main into the PR.
8. **Editing an immutable published contract** — refused. Publish a new
   generation (`refs/db-contracts/<issue>/<N>`).
9. **Parallel governed reviews** — slot 2 loses its lease to the silence
   watcher (`silent_worker_observed`). Sequential only.
10. **Review prompt file inside the worktree** — refused as dirty worktree.
    Keep prompts outside (e.g. `C:\tmp\`).
11. **`--expand-claim-from-issue` when the PR is the issue source** —
    self-collides; use `--expand-active-claim-from-pr`.
12. **Lane tool flags** — `--old-version` not `--current-version`;
    `--claim-number` not `--claim` (that is a boolean).
13. **Gemini wrapper timeouts** on this machine (exit 1); DeepSeek/Grok/Muse
    were healthier. Replacement failure code is `provider_unavailable` or
    `silent_worker_observed` / `wrapper_terminal_failure` — not `provider_timeout`.
14. **Assuming #3103 still conflicts with #3487** — stale; #3103 is merged and
    docs-only. Do not serialize.

# Section 5 — Root causes and key findings

- **Durable verdict refs** `refs/db-review-verdicts/<issue>-<pr>-<head_sha>[-slotN]`
  or `refs/db-review-verdict-replacements/...`. `git ls-remote` is authoritative.
- **`contract_sha256`** is `contractHash()` canonical JSON, not raw file bytes.
- **Evidence pair shape:** implementation head carries NO evidence pair; both
  files follow in exactly one tail commit after `report.head_sha`.
  `files_changed` = implementation only. `completion.outcome` never
  `ready-for-review`.
- **A successful REVISE permanently locks that head.** Remedy: new commit +
  fresh reviews. A REVISE at an old head does not lock a newer head.
- **APPROVE carry-forward** works when prior head is ancestor + PR content
  digest identical excluding `.agent/` + live head has no own reviewer records.
- **GitHub Compare REST silently truncates `files` at 300 / `commits` at 250.**
  Fixed in PR #3558 (commit-graph fallback wins on at-cap subset).
- **Reviewer exclusion:** Claude/MiMo must not review Claude/MiMo-orchestrated
  work. Drawable this session: muse, gemini, deepseek, grok (intermittent).
  Qwen often quarantined (`live-qualification-required`).
- **`AI_<PROVIDER>_CALLER=mimo`** is required on this host.
- **Author-acquisition mutex** can go stale; recover via
  `gh workflow run recover-author-mutex.yml`.
- **`--replace-failed-reviewer`** needs `--failed-sequence`, `--confirm-no-verdict`,
  and a terminal failure code.
- **Bare `bash` is WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`.
- **#3539 claim scope** needs `writes:` covering every object the migration
  touches; widen contract `allowed_paths` via a new generation when tests must
  change.

# Section 6 — Exact next steps

1. **Open YOUR OWN marker** with YOUR OWN route_id (AGENTS.md §11c). Close
   #3552 only after your marker is ready (serialized handshake). Authorization
   owner-current-chat if Albert is present.
2. **#3539 / PR #3557 (priority).** Head `f104888f2` already contains the
   DeepSeek REVISE fixes (twentieth_century_dcpvault grouping + executable
   SQL proof + test heading cleanup + gen-3 evidence). Confirm CI green on that
   head. Run fresh two-slot reviews sequentially (muse/gemini/deepseek). If
   APPROVE both: `gh workflow run guarded-migration-merge.yml -f pull_request=3557
   -f head_sha=f104888f2f6d7e9a66d11dc6dd81956f946f766f`. Then production
   promotion + authenticated page check. Release claim #3546.
3. **#3510 / PR #3510.** Head `ef422f65023deec291cfc276bef5ee682ec98fe8`.
   Slot 1 Muse APPROVE already durable. Assign+run slot 2 only (deepseek or
   gemini). Then Guarded Merge. Then production (owner authority for
   environment click). Release claim #3502.
4. **#3489 / PR #3489.** Head `5e8d470d39ed5eee720f8fbf18f122d0127deed2`.
   Reversion already done (version 20260925175038). Confirm CI; two-slot
   reviews; Guarded Merge. Release claim #3482.
5. **#3487 / PR #3487.** Head `f3e3386f3e39bf2ce2ab8e58a33be47d0437bff1`.
   Contract gen 2 already published. Two-slot reviews; Guarded Merge. Release
   claim #3483.
6. **Tooling queue** #3521 → #3522 → #3525 → #3526 (serial on
   `manage-migration-author-lanes.mjs`). After #3521: implement
   other-slot-verdict-frees-reviewer on `resolvePeerSlots`. Then redraw slot-1
   on #3304/#3309 and Guarded Merge each.
7. **Hand over or close marker** when this workstream ends.

Each step ends when: PR MERGED via Guarded Merge, claim released with
`--confirm-finished`, work issue commented/closed.

# Section 7 — Constraints and gotchas in force

- One orchestrator. Worktree-only. Never edit the shared checkout except
  reading/`git fetch`.
- Never invent migration versions. Never edit applied migrations. Never weaken
  exact-head approval. Never delete durable refs.
- Structural merges go through Guarded Merge, one PR at a time.
- Albert does not merge and does not sign off on technical risk.
- Sign everything: `Posted by MiMo chat unknown on edge-dev`
- Poll every ~5 minutes. Never `gh run watch`.
- Maximize parallelism; no concurrent-agent or review limit (Albert 2026-09-25).
  Reviews themselves must be sequential per PR.
- Do not re-ask settled questions.
- Membership plan only for MiMo — never ask for an API key.
- MiMo flash subagent model remains STOPPED unless Albert re-enables.

# Section 8 — Access and environment

- Machine: `edge-dev` (Windows). Git bash at `C:\Program Files\Git\bin\bash.exe`.
- `gh` authenticated as `u2giants`. Repo `popcre/shared-db`.
- Secrets: 1Password vault `vibe_coding` only. Preview DB password item
  `qbvfk7umc3n75ejekd65zwd4ty`; CLI PAT item `3t2xoqk5luyz7ffgdhj24gvtpq`.
  Never print values. Production project `qsllyeztdwjgirsysgai`.
- Preflight: `C:\Users\ahazan\.local\bin\ai-review-preflight.cmd usable <short>`
  (grok|qwen|gemini|deepseek|muse).
- Marker #3552 route_id `local_d5924ec8-bedc-4884-aac0-cea0b6efe4bd`.
- Worktrees of interest:
  - `C:\repos\shared-db\.claude\worktrees\3539-dcp-licensor` (live, #3557)
  - `C:\repos\shared-db\.claude\worktrees\3498-plm-item-homes` (live, #3510)
  - `C:\repos\shared-db\.claude\worktrees\3457-search-dam` (live, #3489)
  - `C:\repos\shared-db\.claude\worktrees\3458-style-guide-refresh` (live, #3487)

# Section 9 — Open questions and risks

- Slot-independence `excludedProviders` wall may still block #3304/#3309
  slot-1 until #3521 + other-slot-verdict-frees-reviewer lands.
- Evidence-pair commits move heads and invalidate APPROVEs — sequence carefully.
- Sub-agent APIError/cancellation waves this session; re-verify live state.
- Bash was permission-blocked (`action: ask`) for at least one sub-agent near
  wrap-up; a successor session with Bash can finish #3510 slot 2 quickly.
- #3539 worktree has untracked helper scripts under `.agent/` — leave them;
  they are generator helpers and must not enter `files_changed`.

---

# Part (b) — Per sub-agent work blocks

### general-1 → #3539 implementation (FAILED APIError, partial)
Asked: implement Pixar/DCP grouping. Did: wrote migration
`20260925174850_...sql` (uncommitted at death). Later general-9 finished it.

### general-2 → #3489 reversion (COMPLETE)
Verified reversion to `20260925175038`, baseline regenerated, tests 244 pass,
evidence gen 5 rebound. PR mergeable.

### general-3 → #2835 REVISE H/M/L (COMPLETE)
All findings fixed at impl head `b1aa3d4e` / PR `57520a96e`. Later general-11
and general-24 finished CI + merge.

### general-4 → #3385 F1/F2/F4 (COMPLETE)
Verified already fixed at `76b26178f`; no new commit needed.

### general-5 → #3510 B1/B2/B3 (COMPLETE)
Fixed derived-from, actor defaults, FKs. Impl `a890fffb`, PR `560664ab` (later
moved to `ef422f65`).

### general-6 → tooling queue audit (COMPLETE)
Mapped queue; #3512 already merged; identified Guarded Merge as the only merge
path; withheld other-slot fix because #3521 unmerged.

### general-7 → #3487 vs #3103 (COMPLETE)
#3103 already merged docs-only — no conflict. Published contract gen 2 for
#3487 after version supersession. Ready for reviews.

### general-8 → #2835 CI (FAILED APIError)

### general-9 → finish #3539 (COMPLETE)
Migration + docs + contract gen 1/2 + PR #3557 opened.

### general-10 → #3511 refresh + GM (COMPLETE)
Merged `530ffb39`. Muse + DeepSeek APPROVEs.

### general-11 → #2835 CI (PARTIAL)
Reversion `20260925193145`, claim expanded to 14 objects, evidence gen 12.
Collision guard still red (fixed later by general-17).

### general-12 → #3489 reviews (CANCELLED mid-flight)
Had been running long (249 turns). Verify live PR state before redoing.

### general-13 → #3385 reviews + GM (COMPLETE)
Merged `4f395967`. Claim #2745 released.

### general-14/23/28/29 → #3510 reviews (FAILED APIError / cancelled / blocked)
general-29 verified slot 1 Muse APPROVE at `ef422f65`; slot 2 missing; shell
permission-blocked for that agent.

### general-15 → #3487 reviews (CANCELLED mid-flight)

### general-16 → #3557 reviews (PARTIAL)
DeepSeek REVISE at `d6c43455a` (twentieth_century_dcpvault missing; no
executable proof). Head locked correctly.

### general-17 → collision guard (COMPLETE)
Root cause: GitHub Compare API truncates files at 300. Fixed via PR #3558.

### general-18 → #2835 reviews (COMPLETE)
Muse + Gemini APPROVE at `1a7a7ce`; later carried forward on merge.

### general-19 → #3520 reviews (PARTIAL)
Muse REVISE at `a7594894` locked head. Findings posted.

### general-20 → #3539 contract scope (COMPLETE)
Contract gen 2 + test headings. CI green.

### general-21 → #3520 REVISE fixes (COMPLETE)
H1/M1/M3 fixed at `265b14d2e`.

### general-22 → #3557 reviews (PARTIAL)
DeepSeek REVISE (same as general-16 outcome).

### general-24 → #2835 unblock + merge (COMPLETE)
Merged `2c4159ff`. Claim released.

### general-25 → #3520 reviews v2 (COMPLETE)
Grok + Muse APPROVE. Merged `f65db22c`.

### general-26 → #3539 REVISE fixes (CANCELLED but work LANDED)
Commits `49360aaae` + `f104888f2` are on the branch with twentieth_century_dcpvault
coverage and executable grouping proof. Needs re-review only.

### general-27 → tooling #3521+ (CANCELLED mid-flight)

---

# Queue seed (REQUIRED)

| Outstanding | Issue / PR | Notes |
|---|---|---|
| #3539 Pixar/DCP groups | #3539 + claim #3546 + PR #3557 | Fixes landed at f104888f2; re-review + GM + production |
| #3498 item homes | #3498 + claim #3502 + PR #3510 | Slot 2 review + GM + production |
| #3457 semantic floor | #3457 + claim #3482 + PR #3489 | Reviews + GM |
| #3458 matview split | #3458 + claim #3483 + PR #3487 | Reviews + GM |
| Tooling queue | #3521→#3522→#3525→#3526 | Serial; then other-slot fix; then #3304/#3309 |
| #2662 six views | #2662 + claim #3294 + PR #3304 | Slot-1 after tooling |
| #3175 taxonomy | #3175 + claim #3307 + PR #3309 | Slot-1 after tooling |
| #2110 frozen designflow drop | #2110 + claim #3378 + PR #3391 | Parked |
| Strawberry Shortcake | (none) | Cancelled by owner; #3545 parked |

---

# Secrets sweep

Swept. No credential values in chat, commits, or untracked files. 1Password
item IDs only (`qbvfk7umc3n75ejekd65zwd4ty`, `3t2xoqk5luyz7ffgdhj24gvtpq`).
**Nothing new.**

# Docs pass

AGENTS.md unchanged (router). Durable lessons live in this handoff and on the
issues. Nothing outside this handoff is stale that this session made stale.
Business rule for Strawberry Shortcake one-property scope is already in
`docs/business-rules/licensing-master-data.md` (PR #3544).

# Fresh-developer gate

A cold developer can: read marker #3552 → this file → Section 0 → per-PR table
→ Section 6 next steps with SHAs and verification gates. No chat context
required. **PASS.**

---

Posted by MiMo chat unknown on edge-dev
