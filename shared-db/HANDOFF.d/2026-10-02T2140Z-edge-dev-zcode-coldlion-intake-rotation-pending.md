---
issue: 3853
status: OPEN
owner: zcode/coldlion-intake-successor (any fresh session; Albert holds the workstream card #3853)
---

# ColdLion order intake — first production orders exist; rotation pending; F1/cron remain

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**None — including the security incident.** A production database password fragment was
printed into a local session transcript today; the standing ruling (Albert, 2026-09-28:
"never ask a human to approve") puts rotation under the assigned AI reviewer's APPROVE,
never under Albert. Do not re-ask any of these settled rulings:

- JamieLynn's manual ERP entry is NOT automated (2026-09-17).
- C0 cardinality 1:N with `COLDLION-SO-<so>` placeholders (2026-09-17).
- Cron stays OFF until F1 passes (B0); enabling after F1 needs no new approval.
- Albert approves business outcomes only, never technical risk (2026-08-18 / 09-28).
- GLM-never-reviews-GLM is enforced mechanically (see §5 — glm-5.3 was drawn and
  auto-excluded during PR #3909's review today).

## 1. What this application is

Automatic ColdLion order intake in `popcre/shared-db` (Supabase Postgres, production ref
`qsllyeztdwjgirsysgai`): an intra-day poll of the ColdLion ERP `/orderHistory` API stages
orders into `coldlion.intake_*` tables, then a canonical writer creates placeholder
`plm.production_order(_line)` rows — replacing Adam's manual Google OrderList typing only.
Full authority: `plan_coldlion_order_intake.md` (STATUS table = source of truth) and
`docs/business-rules/erp-orders-and-source-meaning.md` §OrderList intake.

## 2. What this session set out to do, and why

Albert's dispatch (coordinator prompt, matching the predecessor handoff's §6): continue
from Phase B — land C2 (canonical writer), run the staged dispatch ladder, F1 sample-week
proof, enable the cron, close #3853, one subagent per step, verify each step's evidence.
The session got through C2 + ladder + the writer-step phase of D, minting the FIRST
production placeholder orders. A password-exposure incident surfaced mid-flight; its
rotation was reviewed through 9 rounds but NOT executed when Albert called wrap-up twice.

## 3. Current state — what is true right now (re-verified 2026-10-02T2139Z)

**Landed today (all verified via `gh api`, merge SHAs):**
- PR #3868 C2 canonical writer + Phase E claim test — merged 10:21 AM EDT (95ae336fd),
  verdicts `refs/db-review-verdicts/3853-3868-fc985e4f*` (muse + gemini), 62→ tests.
- PR #3877 STATUS row E count fix (4feec0e2). PR #3867 was yesterday's B/B0/B1 tick.
- PR #3878 stage-SQL terminator fix — merged 1:35 PM EDT (d6b087b2); the ladder's rung-2
  crash surfaced it (see §4).
- PR #3905 entry-point empty-row destructuring fix — merged 2:04 PM EDT (751979de).
- PR #3906 STATUS C1/C tick — merged 2:27 PM EDT.
- PR #3909 workflow writer step — merged 3:24 PM EDT (e8ce9415); slots grok + muse.
- **Tests on main: 67/67 intake suites** (workflow-shape suite added by #3909).

**Live runs (the ladder, B1 gate):**
- Rung 1 preview dry-run: clean, nothing written (window 2026-09-08..14, 121 fetched).
- Rung 2 preview full pipeline: 5 placeholders on preview, sync_run 59a4b4b0 + 6bc92349.
- Rung 3 production run 37046307914 (2:16 PM EDT, success — stage+decode only).
- Writer production run 37054829042 (~3:40 PM EDT, success): **5 production placeholders**
  `COLDLION-SO-7127517/7127522/7127677/7127678/7127917`, one is_primary ref each, 1 line
  each, 0 quarantined; writer sync_run 58198708. Cross-check order 7127517 via
  `orderHistory?salesOrderNo=` matched staging exactly.
- Alert-path test (D1 gate): bad key on preview → failed sync_run 7f77118d, zero
  window_ledger writes. D's "two consecutive scheduled runs green" still waits for cron.

**STATUS table:** rows 0/A0/A/A2/C0/B/B0/B1/C/C1/C2/E all ✅ with artifacts; **D and F open**.
Main tip at write time `303dfbfdb` (checked 21:39Z; main moves hourly — re-derive).

**Issue #3853 OPEN (non-orchestrator; continuation card; evidence comments posted each step).**

**THE SECURITY INCIDENT — rotation reviewed but NOT executed (the successor's FIRST action):**
During the writer-step session a `psql` attempt URL-embedded the production DB password and
the error printed it into that subagent's local transcript. Exposure is local-machine-only
(swept: zero file hits; not on GitHub; not in chat). Standing rule: exposed = compromised;
AI rotates under assigned-AI-reviewer APPROVE. Nine review rounds completed (1 codex
security-review REJECT + 8 codex plan-review REJECTs — reports under
`.ai/worktrees/coldlion-intake-d/.ai/reviews/codex-*-20261002T19*..21*.md`); each round's
findings were fixed and the plan is at **v9** with executable scripts, but no APPROVE yet
and zero execution: no password changed, no vault edit, no secret set, no workflow touched.
Everything lives in `.ai/worktrees/coldlion-intake-d/.tmp-rotation/` (untracked):
`plan.md` (v9), `rotate.mjs` (secret transport), `drive.sh` (orchestration). No secret file
was ever generated there (verified: only the three script/plan files exist).

**Worktrees:** `coldlion-intake-b` (clean; now carries this handoff's docs branch),
`coldlion-intake-c2` (untracked `.agent/work/3853/{9,10,11}` copies of published refs —
stray but harmless), `coldlion-intake-ladder` (clean), all three safe to reap once their
PRs' states are re-confirmed; **`coldlion-intake-d` is LIVE** — it holds `.tmp-rotation/`
and the review reports; do not reap it until the rotation lands. Canonical checkout
`C:/repos/shared-db` stays dirty with other sessions' files — never clean.

**Session-local:** the 15-minute status automation Albert requested was deleted at close.

## 4. Everything we tried that did NOT work

- **The original leak**: passing a connection URL as a psql command argument. The whole
  rotation review chain exists because of it; NEVER put a credential in argv again.
- **Rotation review loop (9 rounds, all REJECT)** — findings fixed in order, each a lesson:
  (1) Supabase reset is **PATCH** not PUT; (2) `ai-review codex security-review` refuses on
  a prose-classified worktree — **plan-review is the correct mode** for plan documents;
  (3) append-only plan amendments leave contradictions — rewrite the plan whole (v3+);
  (4) `supabase link` must get its password via **SUPABASE_DB_PASSWORD env**, not stdin
  prompts; (5) rollback must rotate to a FRESH value — never reactivate the compromised
  one; (6) vault write must avoid MCP item_edit (parameters land in transcripts) — use
  `op item edit --template <0600 file>`; (7) generation via the 1Password MCP also leaks
  into transcripts — generate locally with crypto; (8) provider-PATCH-first ordering (not
  vault-first) avoids vault/provider divergence; (9) `pg` is NOT importable on this machine
  — fallback chain to `C:/repos/dflow_plm/designflow-backend/node_modules/pg` (present);
  (10) `gh workflow list --workflow <file>` is unsupported — one `--all` call + filter;
  (11) run selection by "latest" grabs the wrong run — match event + dispatch timestamp
  (+ inputs per round 9); (12) TLS `rejectUnauthorized:false` is rejected — RDS CA bundle
  with full verification; (13) old-rejection proof passes ONLY on Postgres 28P01.
- **Round 9's still-open findings (v10 punch list)**: P1 inventory must scan CURRENT main
  via gh api (not the worktree checkout); P5 hardening check too loose (PGPASSWORD-anywhere
  + one spelling — assert the actual spawn env shape); dispatch-proofs failure must
  restore disabled workflows (trap/finally); run lookup should also match the dispatch
  inputs; verify/justify the pg fallback checkout or install pg locally; CLI login
  validation per `runbooks-credentials-cli-and-gotchas.md:37-39`; Windows 0600 caveat;
  scratch cleanup on failure; run the rotation-script self-tests.
- **Two live bugs offline tests could not catch** (the ladder caught both): the stage SQL's
  unterminated final SELECT before `commit;` (PR #3878) and the entry point destructuring
  the healthy empty assertion row (PR #3905). Lesson: the preview pipeline run is the real
  integration test.
- **Foreground subagents still die** on multi-hour lanes (carried from predecessor;
  all three of today's lanes ran as background agents successfully).
- `gh pr checks` right after opening a PR exits "no checks reported" — the `until` loop in
  the fast-close route handles it.

## 5. Root causes and key findings

- The production workflow ran claim-only by DESIGN until #3909 added the writer step — the
  ladder's first production run therefore minted nothing; the successor lane re-dispatched
  once with the writer (37054829042). One-dispatch-per-phase discipline held throughout.
- The GLM-independence exclusion works mechanically: on #3909, glm-5.3 was drawn for slot 2
  and returned via `refs/db-review-exclusions/3853-3909-glm-5.3`; muse took the slot.
- Reviewer queue quirks: codex preflight failed once then recovered (`ai-review doctor`
  PASS); a grok cancellation and a gemini quarantine were replaced per rotation rules.
- The plan's own §734 STATUS duty was met same-day by each step's docs PR.
- The evidence-pair generation counter reached 15 (refs/db-contracts/3853/15 for #3909);
  the rotation prerequisite PR will be generation 16.

## 6. Exact next steps (in order)

1. **Execute the password rotation — first, before F1.** In
   `C:/repos/shared-db/.ai/worktrees/coldlion-intake-d/.tmp-rotation/`: fix the round-9
   punch list (§4) into plan v10 + scripts, then iterate `cat plan.md rotate.mjs drive.sh |
   ai-review codex plan-review --implementer zcode` until **APPROVE** (each round ~6-8 min;
   keep fixing findings, never bypass). Then land the PREREQUISITE hardening PR (gen 16,
   guarded lane, both #3853 non-orchestrator): `tools/coldlion-landing/lib/db.mjs` runSql →
   PG* env transport (no URL in argv; keep the `-f` temp-file pattern and its EPIPE
   rationale), and drop the never-read COLDLION_API_KEY from the writer step
   (+ its pin in `tools/coldlion-order-intake-workflow.test.mjs`). Then run the plan's
   steps 1-12 in order (gate → preflight → disable-nine → gen → PATCH → proofs →
   old-reject → vault → secrets → enable-proofs → dispatch-proofs → enable-rest → record
   on #3853 + vault notes → shred). **Gate:** fingerprints MATCH; pooler count ≥5; 28P01
   rejection of the old value; both proof runs `completed success` with recorded run ids;
   final enabled-set == pre-rotation set.
2. **F1 sample-week live proof** (plan §694-706): most recent full business week; week
   membership per side (sheet Start Ship Date vs ERP startDate); divergences reported as
   their own classes (sheet-not-yet-in-ERP; POE-labelled DDP = system more correct).
   Artifacts `docs/verification/coldlion-order-intake-<date>/README.md` — counts and
   deterministic refs ONLY, never customer/SKU text. **Gate:** counts match the sheet for
   the sample week; every quarantine carries a reason; STATUS row F ticked citing it.
3. **Enable the cron in ONE commit** (uncomment the schedule in
   `.github/workflows/coldlion-order-intake.yml`) — only after F1 passes. Docs-only? NO —
   it is a workflow file: guarded lane. **Gate:** D's two consecutive scheduled runs green
   (watch the next two hourly ticks; quota 403 → `gh run rerun --failed`).
4. **Tick STATUS row D** (cite the two run ids + the bad-key alert test), **close #3853**
   (all rows ✅ + rotation recorded), and retire this handoff file in that same PR (the
   predecessor phase-b file was already retired by PR #3868 — verified absent on main).

## 7. Constraints and gotchas in force

- Everything from the predecessor handoff §7 stands: evidence-pair gates (contract BEFORE
  impl commit; ONE impl + ONE pair commit; verify bytes with `MSYS_NO_PATHCONV=1 git show`);
  head frozen during reviews; two exact-head APPROVEs; quota 403 → rerun; guarded lane for
  code, direct squash for docs-only (`gh pr merge --squash`, never `--admin`; the `until`
  loop before `--watch`); fresh worktree per step; committer Albert Hazan
  <u2giants@users.noreply.github.com>; sign GitHub posts `Posted by ZCode chat <id> on
  edge-dev`; EST/EDT named times; `ai-task-gates start --class code` from the worktree.
- Rotation-specific: secrets move ONLY via 0600 files, `op://` refs, or process env —
  NEVER argv, never MCP tool parameters, never command text; fingerprint (sha256-16)
  comparisons instead of printing; the compromised value is NEVER reactivated (rollback =
  a fresh value B).
- One production dispatch per phase; never auto-retry a production dispatch.
- Never touch `google_order_list` refs; never write sealed-window tables from the intake.
- No package.json — `node --test` only.

## 8. Access and environment

- `gh` authenticated as u2giants. 1Password vault `vibe_coding` (resolve vault id live;
  was `pimcaogmxxzoafh7lsluj6uxkq` today): item "Supabase DB Password - shared POP
  database" (id 246sf23gymd64yudpmhswcnyle) — the exposed credential; item "Supabase CLI
  Personal Access Token" (PAT for the PATCH); ColdLion API key item (x5.coldlion.com).
- GitHub secrets in popcre/shared-db: `SUPABASE_DB_URL_PRODUCTION` (pooler URL form),
  `SUPABASE_DB_PASSWORD_PRODUCTION` (password form) — BOTH derive from the rotated value
  and must be re-set in the same operation (the vault item's notes document this contract).
- Preview project ref: repo variable `PREVIEW_PROJECT_REF` (never write it down); preview
  creds by 1Password item ID (title has parentheses). `psql` NOT installed — Node+pg via
  the fallback chain in rotate.mjs. Machine: edge-dev.

## 9. Open questions and risks

- The exposed password remains live until the successor rotates it; the only copies are
  1Password (authoritative) and the local transcript on edge-dev. Rotation urgency: FIRST
  action; until then nothing else changes that password.
- Round-9 review findings are fixed-in-plan-v10 work, not unknowns — the punch list is §4.
- Carried gen-15 findings on #3853 (minor, non-blocking): terminator pins in
  writer/decode tests, L-2 EXPLAIN duty, L-3 pre-flight asymmetry, stale
  `order-intake.mjs` header, unpinned main-only `if:` guard.
- D's hourly cron is an assumption (§8 open) — cadence must stay ≥3× measured scan time.
- F1 has expected divergence classes (§6.2) — they are recorded, not blockers.

## (b) Sub-agent record

### Agent: C2 writer builder (background)
- **Asked to do:** build + land `order-intake-write.mjs` and the claim test via the guarded
  lane; preview gate per §650-653.
- **Actually did:** PR #3868 merged (gens 9-12; impl 775c49a51, pair fc985e4f); fixed H-2
  item-fork collision with two-tier winner selection; preview gate passed on synthetic
  orders incl. idempotent second run; ticked STATUS C2/E.
- **Found:** the Phase B stage SQL's unterminated SELECT (reported, outside its
  allowed_paths); the writer's own identical error (fixed in-PR).
- **PR/branch:** #3868 MERGED; `coldlion-intake-c2`.
- **Worktree:** `.ai/worktrees/coldlion-intake-c2` — safe to reap (stray untracked
  `.agent/work/3853/{9,10,11}` copies noted in §3).
- **Deliberately did NOT do:** the ladder, the workflow writer step, cron, F1 — later steps.

### Agent: Ladder runner (background)
- **Asked to do:** land the terminator fix (PR), then rungs 1-3 (preview dry-run, preview
  pipeline, ONE production dispatch) + cross-check + STATUS C1/C tick.
- **Actually did:** PR #3878 merged after 4 review rounds; rung 2 crashed on a SECOND bug
  (destructuring) → PR #3905 merged (gen 14); rungs completed; production run 37046307914
  (stage+decode); cross-check order 7127517 clean; PR #3906 STATUS tick.
- **Found:** the empty-row destructuring bug; that the workflow is production-only (rung 2
  legitimately ran locally per plan §12); one local repair (a `tools` junction in
  `C:/repos/ai-devops-reviewer-install`).
- **PR/branch:** #3878, #3905, #3906 all MERGED; `coldlion-intake-ladder`.
- **Worktree:** clean; safe to reap.
- **Deliberately did NOT do:** the writer step (out of scope by instruction); production
  placeholders (the workflow lacked the writer); F1; cron.

### Agent: Phase-D writer-step (background)
- **Asked to do:** add the writer step (guarded PR), bad-key alert test on preview, ONE
  bounded production dispatch WITH the writer, verify placeholders.
- **Actually did:** PR #3909 merged (gen 15; grok + muse APPROVEs; glm excluded by design);
  alert test passed (failed sync_run 7f77118d, zero ledger writes); production run
  37054829042 success; 5 placeholders verified read-only (one is_primary each, 0
  quarantined); evidence on #3853.
- **Found:** THE LEAK — one psql attempt URL-embedded the production password and the
  error printed it (full value in its transcript; fragment quoted in its report); plus two
  hardening findings (db.mjs argv pattern; unused API key) recorded as the rotation
  prerequisites.
- **PR/branch:** #3909 MERGED; `coldlion-intake-d`.
- **Worktree:** LIVE — `.tmp-rotation/` (rotation plan+scripts) and `.ai/reviews/` chain;
  do not reap until the rotation lands.
- **Deliberately did NOT do:** the rotation itself (coordinator decision required reviewer
  APPROVE first); F1; cron.

### Session (coordinator, this file's author)
Dispatched and verified all three lanes (every merge, run, count, and verdict re-checked
via gh api); verified the 67/67 tests and the C2/ladder/STATUS evidence personally; ran
the 9-round rotation review loop to plan v9; deleted the 15-minute status automation.
Deliberately did NOT execute the rotation (no APPROVE yet when Albert called wrap-up twice)
and did NOT start F1 (scope freeze).

Posted by ZCode chat sess_1ceab8e2-56b6-46c6-a6ba-f0d3d0a2a9ae on edge-dev
