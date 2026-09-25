---
issue: 3535
status: OPEN
owner: mimo/edge-dev-shared-db.orch-3535
---

# shared-db orchestrator handoff — marker #3535 (edge-dev / MiMo)

Successor orchestrator after marker #3496 closeout (PR #3533, handoff
`HANDOFF.d/2026-09-25T1226Z-edge-dev-mimo-orch-successor-3496.md`).
Marker **#3535** is OPEN and resolves:
`route_id: local_5346b6bf-1f19-4052-8db0-dfe2ab4ead48`,
session_name `shared-db.orch edge-dev mimo-successor-3496`,
`handover_issue: 3496`, `authorization: owner-current-chat 2026-09-25T13:38:11Z`.

Fresh-session cutover invoked ~1:50 PM EST 2026-09-25 (`2026-09-25T17:50Z`).
`node scripts/check-orchestrator-marker.mjs --resolve` prints that route_id.

**Facts re-verified at handoff time (2026-09-25T17:50Z / 1:50 PM EST):**
- Open `orchestrator-marker`: #3535 only
- Open `db-claim` issues: 3546, 3502, 3483, 3482, 3378, 3307, 3294, 2834, 2745
- PR #3490 MERGED (`b1e2a53b`) via Guarded Merge `36147525702`
- Migration `20260923173715` APPLIED to production (run `36158803811`, main `3839dd5a`)
- Issue #3282 CLOSED

---

# Section 0 — DECISIONS ONLY THE OWNER CAN MAKE

Put this WHOLE list to Albert in ONE message before starting work.

## Already settled this session — do NOT re-ask

- **2026-09-25: #2541 HOLD ENTIRELY.** Do not load the 33 ColdLion codes. Do not
  proceed on 66 either. No load until Albert gives a later instruction. FORK
  items #2598/#2599/#2600/#2601 parked.
- **2026-09-25: #2290 ALLOW AS WRITTEN.** ColdLion health-lane steps confirmed
  unchanged. Do not propose edits unless a real defect appears.
- **2026-09-25: #3282 ACCEPT EXISTING** independent production approval
  (DeepSeek at main `5696ce12e`). Governed lane promoted `20260923173715`.
  **Done — production ledger shows it applied.**
- **2026-09-25: #3498 production click authority.** Albert said verbatim: *"this
  is too manual for me. you need to do it. i am non-technical and don't know
  what i am doing."* Driving session may complete the GitHub
  `environment:production` approve click ONCE if all gates are green. No gate
  waived. Fallback: one one-line ask for a single email click.
- **Standing rule (Albert 2026-09-25): do not re-ask a question when there is no
  reason to change the answer.** If the checklist or plan is sound, run it.
- **MiMo flash / membership plan (2026-09-25):** Albert is logged in to MiMo
  Desktop; one key covers pro AND flash. There is **no separate API key**. He
  only wants the **Xiaomi MiMo Desktop Membership Plan / token plan**. Never ask
  for an API key. Flash-spawn work was **stopped** by owner instruction.
- **2026-08-18:** the five Paramount/`VM` codes already live stay live
  (#539/#1177).
- **2026-09-16:** technical production approval belongs to an independent
  reviewer, not Albert.
- **2026-08-19 / #1286:** `required_status_checks.strict` is FALSE on purpose.
  **2026-09-23:** Blacksmith runners produce valid main checks.
- **2026-08-13:** no HANDOFF.d count cap. Retire stale files only.
- **2026-08-21 / #1366:** repo-maintenance is NOT orchestrator work.

## Wrong guess is recoverable

None pending. All three owner questions from the predecessor handoff were
answered 2026-09-25 and recorded on the issues.

## Not this workstream — nobody on it

1. **Strawberry Shortcake Submissions scrape** (from #3539). No Submissions
   scrape exists in any Supabase project or `u2giants/licensor-source-data`.
   WildBrain submissions-hunt handoff of 2026-08-20 is still OPEN. **Ask:** is
   this still wanted, or park it? **Recommendation:** park until after the
   licensor-grouping work lands. **Blocks:** nothing in this workstream.

---

# Section 1 — What this application is

`popcre/shared-db` is the single source of truth for the shared Supabase
database schema used by PopCRM, PopDAM, PopPIM, and DesignFlow PLM. Every
structural change (tables, columns, views, functions, RLS, indexes, migrations)
is authored here first, applied to preview, then promoted to production
(`qsllyeztdwjgirsysgai`). One orchestrator session dispatches structural work
to sub-agents in isolated worktrees. Owner is Albert Hazan (`u2giants`); he is
not a programmer and does not review code or merge PRs.

# Section 2 — What we set out to do this session, and why

Resume as successor orchestrator after marker #3496 closeout. Claim marker
#3535 with our own route_id. Execute the predecessor's ordered next steps:
(1) put Section 0 owner questions; (2) persist durable APPROVEs for PR #3490
and Guarded Merge; (3) unstick #3304/#3309 slot-1; (4) fix #3489 REVISE
findings; (5) serialize #3487 vs #3103. Albert later instructed: parallelize
maximally, no concurrent-agent or review limit, use MiMo v2.6 flash for simple
jobs when instructions are good enough, spin up subagents for blockers in any
repo. Then resolve #3539 (Pixar under Disney; DCP Vault licensor from source
system). Then `/fresh-session` cutover.

# Section 3 — Current state — what is true right now

## Marker and claims

- **Marker #3535 OPEN**, route_id `local_5346b6bf-1f19-4052-8db0-dfe2ab4ead48`.
  Successor must open its OWN marker with its own route_id (AGENTS.md §11c) and
  close #3535.
- Claims (do not free casually; expiry never releases protection):

| Claim | Issue | Version | Objects | Note |
|---|---|---|---|---|
| #3546 | #3539 | 20260925174850 | `function api.db_data_admin_scraped_source_inventory` | **NEW this session**; lease expires 2026-09-26T05:48:20.047Z; owner `mimo:author-3539`; branch `mimo/3539-dcp-licensor-groups`; worktree `C:\repos\shared-db\.claude\worktrees\3539-dcp-licensor` (may not exist yet — create it) |
| #3502 | #3498 | 20260925044029 | `table plm.item_user_assignment`, `table plm.item_workflow_action` | PR #3510 open; Qwen REVISE B1–B3 |
| #3482 | #3457 | 20260924174155 | `function public.search_dam_documents` | PR #3489 CONFLICTING; backdated version needs `--reversion-active-claim` |
| #3483 | #3458 | 20260924174251 | `function public.refresh_style_guide_matviews` | PR #3487 open; serialize with #3103 |
| #3294 | #2662 | 20260923174737 | six api views | PR #3304; slot-1 capacity deadlock |
| #3307 | #3175 | 20260923173656 | taxonomy health objects | PR #3309; slot-1 capacity deadlock |
| #2745 | #2478 | 20260925061508 | `style_group_key_for_sku` + callers | PR #3385; DeepSeek REVISE F1/F2/F4 |
| #2834 | #2357 | 20260923175907 | licensing candidate APIs | PR #2835; DeepSeek REVISE H1–H3/M* |
| #3378 | #2110 | 20260923181754 | designflow_frozen_20260710 drop | renewed; PR #3391 open |
| #3377 | #2995 | 20260920202755 | hts_rag jobs | parked |

Claim **#3486 / issue #3464 / PR #3490 is DONE** (merged, released, closed).

## Landed this session

| Item | Evidence |
|---|---|
| PR #3490 merged | `b1e2a53b0421ac5bc01e17244dbab2193aa17b61`, Guarded Merge `36147525702` |
| Slot 1 APPROVE (gemini seq 3879) | `refs/db-review-verdict-replacements/3464-3490-9032a301…-3848` SHA `133898b0` |
| Slot 2 APPROVE (deepseek seq 3835) | `refs/db-review-verdict-replacements/3464-3490-9032a301…-slot2-3829` SHA `0c98d3ad` |
| Migration `20260923173715` on production | production run `36158803811`, main `3839dd5a`, ledger `20260923173715` applied |
| Issue #3282 closed | owner accept of DeepSeek APPROVE at `5696ce12e` |
| Merge freeze released | comment on #3535 |
| Claim #3546 opened for #3539 | version `20260925174850` |
| Owner decisions recorded | #2541 HOLD, #2290 ALLOW, #3282 ACCEPT — comments on those issues |
| FORK items parked | #2598/#2599/#2600/#2601 |

## Open structural PRs

| PR | Issue | Head | State | Blocker |
|---|---|---|---|---|
| #3510 | #3498 | `87ff50ea` | MERGEABLE | Qwen REVISE B1 derived-from prose, B2 actor defaults, B3 FKs |
| #3489 | #3457 | `6fa413704` | CONFLICTING | backdated version + generated-baseline conflict |
| #3487 | #3458 | `e2c9cc897` | MERGEABLE | serialize with #3103 |
| #2835 | #2357 | `25ed5091` | MERGEABLE | DeepSeek REVISE (head locked; needs new commit) |
| #3304 | #2662 | `f06f1ced` | MERGEABLE | slot-1 capacity deadlock |
| #3309 | #3175 | `cc2b4e47` | MERGEABLE | slot-1 capacity deadlock |
| #3385 | #2478 | `e3a3c79a` / `5bc562ee` | green CI | DeepSeek REVISE F1/F2/F4 (head locked) |

## Tooling PRs (serialization queue for slot-unstick)

Order to land: **#3512 → #3520 → #3521 → #3522 → #3525 → #3526**.
#3526 already has Agent work contract green (commits `1aee5f2da` + `f79dd0056`,
contract `refs/db-contracts/3527/1`).
After #3521 lands: implement other-slot-verdict-frees-reviewer on
`resolvePeerSlots` (do NOT implement while #3521 is unmerged).

# Section 4 — Everything we tried that did NOT work (MANDATORY)

1. **`xiaomi/mimo-v2.6-flash` subagent spawn** — HTTP 401 Invalid API Key on
   `api.xiaomimimo.com`. Albert: one key covers pro AND flash; membership plan
   only; **stop flash work**. Do not pursue API-key repair. Do not ask him to
   re-login.
2. **Persisting Grok 3826 / Muse 3827 APPROVEs for #3490** — those leases were
   released `silent_worker_observed` with `verdict=none artifact=none`. Cannot
   fabricate findings_refs. Correct path was fresh reviews (gemini 3879 +
   deepseek 3835), which worked.
3. **`--reversion-active-claim --claim-number 3482` alone** — refused:
   `version supersession requires exact issue, claim, owner, branch, worktree,
   PR, head, and current version`. Must pass every field from the claim body
   (Windows backslashes).
4. **`--claim` without `--admit-issue`** — refused. Always
   `--admit-issue <n> --claim ...` together. Issue must have a valid
   `db-work-scope` fence with `priority:` non-negative integer and
   `writes:` (not bare `objects:`) for structural work.
5. **Handing DeepSeek owner decisions as reviewer calls** — correctly refused;
   those are owner authority. Albert answered in chat.
6. **Flash as "MiMo v2.6 flash" vs "DeepSeek Flash"** — two different things.
   DeepSeek Flash (reviewer) WORKS (`ai-review-preflight usable deepseek`).
   MiMo flash (subagent model) was the broken one.
7. **Guarded Merge without both durable exact-head APPROVEs** — refused. Both
   slots need create-only verdict refs at the *latest* assignment per slot.
8. **Evidence-pair-only head moves** invalidate prior exact-head APPROVEs for
   the new head unless the implementation diff is byte-identical and `.agent/`
   equivalence applies — and Guarded Merge still wants a durable APPROVE on the
   latest assignment per slot.
9. **PowerShell here-strings for GitHub issue bodies** — triple-backtick fences
   get eaten. Write a UTF-8 file and `gh issue edit --body-file`.
10. **`gh run watch`** — never. Poll every ~5 minutes with `gh run list`/`view`.
11. **`gh pr merge --squash` on structural PRs** — refused: base branch policy.
    Structural merges go through Guarded Merge only. Never `--admin` a
    structural PR.
12. **Inventing a migration version** — never. Supersession uses
    `--reversion-active-claim` (the lane tool assigns the new version).
13. **MiMo flash model for simple jobs** — owner later stopped this line of work
    entirely.

# Section 5 — Root causes and key findings

- **Durable verdict refs** are `refs/db-review-verdicts/<issue>-<pr>-<head_sha>[-slotN]`
  or `refs/db-review-verdict-replacements/<issue>-<pr>-<head_sha>[-slotN]-<seq>`.
  `git ls-remote` is authoritative (`gh api matching-refs` under-reports).
- **`contract_sha256` is the canonical JSON hash** (sorted keys, compact) via
  `contractHash()` from `scripts/agent-work-contract.mjs`, not raw file bytes.
- **Contracts must be published** to `refs/db-contracts/<issue>/<gen>` via
  `node scripts/agent-work-contract.mjs --publish-contract` BEFORE the Agent
  work contract check can pass. Files in the PR alone are not enough.
- **Evidence pair shape:** implementation head carries NO evidence pair; both
  `contract.json` + `completion.json` follow in exactly one tail commit after
  `report.head_sha`. `files_changed` lists implementation files ONLY.
  `completion.outcome` must be one of merged, live_verified,
  owner-ruling-recorded, ready-for-merge, returned, cancelled, superseded,
  failed. **`ready-for-review` is invalid.**
- **`--assign-reviewer` never re-draws a reviewed slot**; it returns the existing
  record. `--replace-failed-reviewer` only accepts TERMINAL_FAILURE_CODES and
  `--confirm-no-verdict`. A successful REVISE permanently locks that head —
  remedy is a **new commit + fresh reviews**.
- **Capacity wall has TWO mechanisms:**
  1. `failedNames` silence-release exclusion — fixed by PR #3526.
  2. `excludedProviders` / holds-another-slot — UNFIXED. A completed other-slot
     verdict does NOT free that reviewer. Must land AFTER #3521.
- **`run-governed-review.mjs`** records replacement verdicts with
  `--replacement-sequence <failed-sequence>` (the ref suffix), not the new
  assignment sequence.
- **Reviewer wrappers need `AI_<PROVIDER>_CALLER`** set explicitly on MiMo.
- **`ai-review-preflight.cmd usable`** takes short names (`grok`, `qwen`,
  `gemini`, `deepseek`, `muse`), not canonical reviewer names.
- **Provider preflight:** all five rotation reviewers usable as of 2026-09-25.
- **Production promote (governed):** historical preview source proof embeds
  `mainSha` — preview and production must share one exact SHA. A docs merge
  mid-promotion voids the apply. Owner-decision comment must be the fence alone.
  Automatic promotion cannot ship migrations with
  `material_access_change` / `permanent_data_rewrite_or_loss` /
  `expected_downtime` — manual path with owner-decision evidence.
- **#3539 db-work-scope** needs `priority:`, `service_class:`,
  `change_type:`, `application_return_to:`, `live_assertion:`,
  `generated_types:`, and `writes:` (legacy `objects:` warns but works).

# Section 6 — Exact next steps

1. **Open your OWN marker** with your own route_id (AGENTS.md §11c), close
   #3535. Authorization owner-current-chat if Albert is present.
2. **Put Section 0 to Albert in ONE message.** Mostly already-settled items —
   only the Strawberry Shortcake Submissions question is live. You'll know it
   worked when he answers or says nothing needed.
3. **#3539 implementation** (claim #3546, version 20260925174850). Create
   worktree `C:\repos\shared-db\.claude\worktrees\3539-dcp-licensor` from
   `mimo/3539-dcp-licensor-groups`. Change
   `api.db_data_admin_scraped_source_inventory` so:
   - Pixar / Pixar-OPA rows group to Disney (`licensor_group_key = 'disney'`).
   - `disney_dcpvault` → Disney, `marvel_dcpvault` → Marvel,
     `lucasfilm_dcpvault` → Lucasfilm/Star Wars — never "Licensor not yet
     determined", regardless of mapping authority. Supersedes #2905.
   - `licensor_key` and `row_key` unchanged (paging cursors stable).
   - Update `docs/db-data-admin-scraped-properties.md`.
   Acceptance: no Pixar section; zero `*_dcpvault` rows in unresolved group in
   all three entity kinds. Then preview, PR, reviews, Guarded Merge, production,
   authenticated page check. Release claim #3546.
4. **#3489** — reversion claim #3482 via `--reversion-active-claim` with ALL
   exact fields (issue 3457, claim 3482, owner/branch/worktree from claim body,
   PR 3489, head `6fa413704…`, current version `20260924174155`). Rename
   migration to the tool-assigned version. Resolve
   `docs/verification/throughput-guard-truth-baseline-20260828.json` conflict
   with main. Fresh reviews + Guarded Merge. Release claim.
5. **#2835** — fix DeepSeek REVISE H1/H2/H3 + M1–M5 (full text
   `.ai/2835-revise-findings.txt`). New commit (head `25ed5091` locked). Then
   fresh reviews + Guarded Merge.
6. **#3385** — fix F1 (byte-identity test for `20260925061508` vs
   `20260917112129` excluding version header, pattern at
   `scripts/test_production_migration_guard.py:345-360`), F2 (live-proof
   consumers via `to_regprocedure` exact signatures), F4 (contract/completion
   base_sha). Do NOT change migration executable SQL. Full text
   `.ai/3385-revise-findings.txt`. New commit + fresh reviews + Guarded Merge.
7. **#3510** — fix B1 (`-- derived-from:` prose → real 14-digit versions
   `20260901221310, 20260904143518, 20260905053422, 20260907121732` or delete
   line 3), B2 (actor_identity_* defaults must match dflow source in
   `20260907121732`), B3 (FKs). Full review at
   `C:\repos\shared-db\.claude\worktrees\3498-plm-item-homes\.ai\reviews\qwen-rev-s1-qw3-ce3c7241899f7052973fd36a.md`.
   Then fresh reviews + Guarded Merge + production (owner authority for
   environment click). Release claim #3502.
8. **Tooling queue** — land #3512 → #3520 → #3521 → #3522 → #3525 → #3526.
   Then implement other-slot-verdict-frees-reviewer on `resolvePeerSlots`.
   Then redraw slot-1 on #3304/#3309 and Guarded Merge each.
9. **#3487 vs #3103** — serialize on `function public.refresh_style_guide_matviews`.
   Land one, re-derive the other's body from the merged definition. Never
   mechanical CREATE OR REPLACE conflict resolution.
10. **Hand over or close marker #3535** when this workstream ends.

Each step ends when: the PR is MERGED via Guarded Merge, the claim is released
with `--confirm-finished`, and the work issue is commented/closed.

# Section 7 — Constraints and gotchas in force

- One orchestrator. Worktree-only (`AGENTS.md` §2.1-W). Never edit the shared
  checkout except for reading/`git fetch`.
- Never invent migration versions. Never edit applied migrations. Never weaken
  exact-head approval. Never delete durable refs.
- Structural merges go through Guarded Merge, one PR at a time. Preview and
  production are one-at-a-time lanes.
- Reviewer engine exclusion: Claude/MiMo must not review Claude/MiMo-
  orchestrated work. Drawable: grok, muse, gemini, deepseek, qwen.
- Albert does not merge and does not sign off on technical risk.
- Sign everything: `Posted by MiMo chat unknown on edge-dev`.
- Keep polling. Poll every 5 minutes. Never use `gh run watch`.
- Maximize parallelism; no concurrent-agent or review limit (Albert 2026-09-25).
- Do not re-ask settled questions (Albert 2026-09-25).
- Membership plan / token plan only for MiMo — never ask for an API key.

# Section 8 — Access and environment

- Machine: `edge-dev` (Windows). Git bash at `C:\Program Files\Git\bin\bash.exe`.
  Bare `bash` is WSL and often unusable.
- `gh` authenticated as `u2giants`. Repo `popcre/shared-db`.
- Secrets: 1Password vault `vibe_coding` only. Preview DB password item
  `qbvfk7umc3n75ejekd65zwd4ty`; CLI PAT item `3t2xoqk5luyz7ffgdhj24gvtpq`.
  Never print values. Production project `qsllyeztdwjgirsysgai`.
  Preview ref is a repo variable `PREVIEW_PROJECT_REF` — read it, do not invent.
- Preflight: `C:\Users\ahazan\.local\bin\ai-review-preflight.cmd usable <short>`.
- MiMo session id this handoff: `ses_ffe5f273721c3ffemqUNkfRUIO`.
- Worktrees that exist from this session:
  - `C:\repos\shared-db\.claude\worktrees\3457-search-dam`
  - `C:\repos\shared-db\.claude\worktrees\3458-style-guide-refresh`
  - `C:\repos\shared-db\.claude\worktrees\3464-lease-widen` (3490 done)
  - `C:\repos\shared-db\.claude\worktrees\3498-plm-item-homes`
  - `C:\repos\shared-db\.claude\worktrees\3539-dcp-licensor` (create if absent)

# Section 9 — Open questions and risks

- Slot-independence `excludedProviders` wall is structural until after #3521 +
  the follow-up fix. #3304/#3309 cannot get slot-1 at current heads until then.
- Evidence-pair commits move heads and invalidate APPROVEs — sequence reviews
  carefully after each fix.
- Main moves constantly; pin-based approval goes stale within hours. The
  APPROVE carry-forward rule (ancestor + unchanged PR diff, ignoring `.agent/`)
  is the practical path.
- Several background sub-agents may still be in flight at cutover (general-12
  #2835, general-14 tooling queue, general-15 #3385, general-17 #3489 reversion,
  general-18 #3510 B1–B3). If this session ends, their results are lost —
  re-dispatch anything still needed after checking live GitHub state.
- #3489 is CONFLICTING on a generated file; do not hand-edit machine output
  blindly — regenerate if a tool exists.

---

# Part (b) — Per sub-agent work blocks

### general-1 → PR #3490 (MERGED `b1e2a53b`)
Asked: persist durable APPROVEs + Guarded Merge. Did: confirmed slot-2 deepseek
durable; completed slot-1 gemini seq 3879; Guarded Merge `36147525702` SUCCESS.
Parent also dispatched GM. Findings: `--replacement-sequence` required for
replacement verdicts; `AI_<PROVIDER>_CALLER` needed on MiMo.

### general-2 → #3304/#3309 slot unstick (PARTIAL)
Asked: unstick slot-1. Did: published contract for PR #3526 (commits
`1aee5f2da`+`f79dd0056`); confirmed capacity deadlock with verbatim evidence;
mapped collision queue #3512→#3520→#3521→#3522→#3525→#3526. Blocked on queue
serialization. Did NOT implement other-slot-verdict-frees-reviewer (collides
with #3521 mid-refactor).

### general-3 → PR #3489 REVISE (PARTIAL/BLOCKED)
Asked: fix H1/H2/M1-T6/M4. Did: pushed `6fa413704`; 243 pytest pass; sidecar
`20260924174155.json` added. Blocked on backdated version + CONFLICTING
generated baseline. Did not rename version (forbidden without lane tool).

### general-4 → #3487 vs #3103 serialize (IN FLIGHT at cutover)
Asked: serialize matview function change. Status unknown at cutover — check
live PR state.

### general-5/6 → flash subagents (FAILED then cancelled)
Asked: #3510/#2835 via `xiaomi/mimo-v2.6-flash`. Failed APIError/401. Rerouted
to general-9/10. Owner later stopped flash work entirely.

### general-7 → PR #3385 evidence pair (PARTIAL)
Asked: regenerate evidence pair. Did: gen 12 contract, version `20260925061508`,
CI green, head `e3a3c79a`/`5bc562ee`. Slot1 gemini APPROVE, slot2 deepseek REVISE.
Did not change executable SQL (contract forbids).

### general-8 → blocker sweep (COMPLETE)
Cleared: reviewer preflight (all 5 usable), claim leases healthy, gh access.
Reported: flash 401 (credential), #3512/#3520 serialization, capacity-wall two
mechanisms. Did not implement repo-maintenance.

### general-9/10 → #3510 / #2835 reviews (BLOCKED)
#3510: qwen REVISE B1–B3. #2835: head `25ed5091` locked by deepseek REVISE
(not APPROVE as tasked — premise corrected).

### general-11 → flash key repair (BLOCKED then STOPPED)
Said auth.json missing / re-login. Owner corrected: logged in, one key,
membership plan. Work stopped.

### general-12 → #2835 REVISE fixes (IN FLIGHT at cutover)
Asked: fix H1–H3/M findings, new commit, fresh reviews. Status unknown at
cutover.

### general-13 → production promote (COMPLETE)
Migration `20260923173715` applied, run `36158803811`, ledger proof, freeze
released, #3282 closed.

### general-14 → tooling PR queue (IN FLIGHT at cutover)
Asked: land #3512→#3520→#3521→#3522→#3525→#3526. Status unknown at cutover.

### general-15 → #3385 F1/F2/F4 (IN FLIGHT at cutover)
Asked: answer REVISE without touching migration SQL. Status unknown at cutover.

### general-16 → flash re-diagnose (CANCELLED by owner)

### general-17 → #3489 reversion + refresh (IN FLIGHT at cutover)
Asked: `--reversion-active-claim` with all fields, resolve baseline conflict,
fresh reviews. Status unknown at cutover.

### general-18 → #3510 B1–B3 (IN FLIGHT at cutover)
Asked: fix derived-from, actor defaults, FKs; fresh reviews; then production.
Status unknown at cutover.

---

# Queue seed (REQUIRED)

| Outstanding | Issue | Notes |
|---|---|---|
| #3539 Pixar/DCP licensor groups | #3539 + claim #3546 | version 20260925174850; implement + ship |
| #3457 semantic floor PR #3489 | #3457 + claim #3482 | reversion + conflict + reviews |
| #2357 licensing APIs PR #2835 | #2357 + claim #2834 | REVISE H1–H3/M; new commit |
| #2478 SKU key PR #3385 | #2478 + claim #2745 | REVISE F1/F2/F4; no SQL body change |
| #3498 item homes PR #3510 | #3498 + claim #3502 | REVISE B1–B3 then production |
| #3458 matview split PR #3487 | #3458 + claim #3483 | serialize with #3103 |
| #2662 six views PR #3304 | #2662 + claim #3294 | slot-1 after tooling queue |
| #3175 taxonomy PR #3309 | #3175 + claim #3307 | slot-1 after tooling queue |
| Tooling queue | #3512…#3526 | land in order; then other-slot fix |
| #2110 frozen designflow drop | #2110 + claim #3378 | parked |
| Strawberry Shortcake Submissions | (none) | owner question in §0 |

---

# Secrets sweep

Swept. No credential values in chat, commits, or untracked files. 1Password
item IDs only. **Nothing new.**

# Docs pass

AGENTS.md unchanged (router). Durable knowledge is in this handoff. Claims,
versions, and marker state are on GitHub. **Nothing outside this handoff is
stale that this session made stale.**

# Fresh-developer gate

A cold developer can: read marker #3535 → this file → Section 0 → per-PR table →
next steps with verification gates. No chat context required. **PASS.**

---

Posted by MiMo chat unknown on edge-dev
