---
issue: 3853
status: OPEN
owner: zcode/coldlion-intake-successor (any fresh session)
---

# ColdLion order intake — Phase A landed; continue at Phase B

## 1. What this workstream is

Implementing `plan_coldlion_order_intake.md` (popcre/shared-db): automatic ColdLion
order intake so canonical `plm.production_order(_line)` rows exist within the business
day after JamieLynn keys an order — replacing Adam's manual Google OrderList typing
only. Read the plan's STATUS table FIRST, then the business-rules intake section
(`docs/business-rules/erp-orders-and-source-meaning.md`, §OrderList intake — Settled).

## 2. What is DONE (verified, with artifacts)

- **Phase A complete end-to-end.** Migration `20260928211543_coldlion_order_intake_staging.sql`
  (six `coldlion.intake_*`/`routing_code_map` tables; version superseded from
  20260928155332 after base-main advance): PR **#3693** MERGED (fd622fa142), two
  exact-head governed APPROVEs (DeepSeek slot 1 + Grok slot 2 at 96d99d419), preview
  rehearsal applied (run 36749854223), **production applied** (run 36759340591,
  2026-09-30), machine live-proof PASSED (workflow shared-db-live-proof -f
  work_issue=3679, run 36761375751; probe `.github/live-proofs/3679.sql` returns
  passed=t on production). Issue **#3679 CLOSED live_verified** (outcome lifecycle
  advanced stepwise; evidence digest ac17a236). Claim #3680 released. Plan STATUS row
  A ticked via PR **#3846** (merged, docs-only).
- **Phase A2 done live**: `coldlion.item_detail` 26,227 rows, case-pack columns 100%
  populated (STATUS row ticked in the same PR).
- **Phase B ~70% drafted and tested** (NOT yet committed to the repo): see §5.

## 3. What is HALF-FINISHED (Phase B draft)

Fully working drafts live in **`C:/repos/intake-3679-drafts/`** (outside the repo,
parked there because the reviewer runner demands a clean worktree):

- `tools/coldlion-landing/lib/order-intake-windows.mjs` — trailing/forward window
  math, empty-month stop, 18-month cap (constants with ruling citation). TESTED.
- `tools/coldlion-order-intake-window-arithmetic.test.mjs` — 7/7 passing (node --test).
- `tools/coldlion-landing/lib/order-intake-stage.mjs` — staging upsert SQL builder
  (identity+hash versioning, last_seen_run-only mutation, novelty range-scan on
  plm source refs) + sibling failure recorder (no window_ledger writes). Smoke-tested
  both branches.
- `tools/coldlion-landing/lib/order-intake-run.mjs` — one-window orchestration
  (fetch→project→stage; ORDER_HISTORY scope only).
- `tools/coldlion-landing/lib/order-intake-decode.mjs` — C1 decode + quarantine SQL
  (zero-SO guard, unknown-code quarantine, NO COS/stock detector). Loads clean.
- `tools/coldlion-order-intake-decode.test.mjs` — 6/6 passing.
- `tools/coldlion-landing/order-intake.mjs` — poller entry (--dry-run/--limit/
  --claim-only/--today); syntax-checked, smoke-run to the no-key refusal.
- `.github/workflows/coldlion-order-intake.yml` — Phase D workflow, **schedule
  commented out (cron disabled) per plan B0**, dispatch-only, tests-first, env block
  mirrors coldlion-landing-sync.yml.

## 4. What was NOT built at all

Phase C2 canonical writer (`order-intake-write.mjs`) — the biggest remaining piece.
Per plan §9 C2: winner-selection SQL (rides the winner indexes), idempotency by
`coldlion:so-header:<so>` source ref only, placeholder `COLDLION-SO-<so>` +
`metadata.production_order_number_origin` (never overwrite non-placeholder), UPDATE
guard in SQL, customer resolution `core.company_source_ref` FIRST then
`plm.erp_customer(active)` (miss/disagreement → quarantine), one canonical line per
winning component with `order_qty` (never `line_qty`), source refs is_primary on
exactly one per header/line, case-pack via `item_detail` (PK company/division/item/
item_pkey — ambiguity → quarantine), `1900-01-01`→NULL, empty poNumber skips the
customer-PO tuple. Read `docs/app-migration-notes/popdam-order-list.md` §Google-to-
Coldlion identity proof for the claim-tuple adaptation. Then E's remaining test
(`coldlion-order-intake-claim.test.mjs`) and F (sample-week proof; cron stays OFF
until F1 passes).

## 5. What I own / where things are

- Drafts: `C:/repos/intake-3679-drafts/` (code above + this handoff's earlier draft +
  helper drivers promote3.py/finish.py/apply2.py — historical, safe to delete).
- Worktrees `.ai/worktrees/coldlion-order-intake` (on main, clean) and
  `.ai/worktrees/coldlion-intake-review` (detached, clean) — both retired at wrap-up.

## 6. Exact next actions (Phase B PR)

1. Fresh worktree from origin/main; copy the seven draft files from
   `C:/repos/intake-3679-drafts/` into their repo paths (workflow yml schedule stays
   disabled). Run `node --test tools/coldlion-order-intake-*.test.mjs` (13 expected).
2. `bash scripts/check-sql.sh`; open a code PR (guarded lane; work-contract evidence
   pair generation 1 — publish BEFORE the implementation commit:
   `node scripts/agent-work-contract.mjs --publish-contract`; see §7 traps).
3. Phase C2 writer per §4 above + claim test; same or next PR.
4. B1 staged-dispatch ladder: dry-run --limit 5 from a laptop (preview DB), then
   workflow-dispatch preview, then ONE bounded production dispatch --limit, then F1
   sample-week proof (`docs/verification/coldlion-order-intake-<date>/`, counts and
   deterministic refs only). Only after F1 passes: enable the cron (one commit).
5. Update the plan STATUS rows as each step lands (same-day duty, cite artifacts).

## 7. What I tried that did NOT work (do not re-walk)

- **Evidence-pair gates** (cost 5 CI rounds): publish contract ref before the impl
  commit; completion `files_changed` = `git diff <merge-base>...<implementation head>`
  EXCLUDING the pair files; pair's own paths in the contract's allowed_paths; branch =
  ONE impl commit then ONE pair commit (git rename detection shows both generations
  otherwise); probe must alias `) as passed;` LOWERCASE; `do $tag$` closes with the
  SAME tag; contract-test fixtures: a duplicate-window test with a 7-day span fires
  the window CHECK before the unique violation.
- **Classifier**: any GRANT/REVOKE/INSERT/FK-bearing CREATE TABLE makes the automatic
  v2 production lane refuse (enforce precedes owner decisions — Albert is NEVER asked
  per 2026-08-18/09-28 rulings). The sanctioned route for such migrations:
  `production-apply-review-evidence.yml` (workflow_dispatch, reviewed_main_sha=current
  tip, ordered_allowlist, verdict=APPROVE, reviewer_label naming the governed
  exact-head approvals) → `dispatch-production-apply.mjs --preview-run-id <rehearsal>
  --review-run-id <that run>` (NO --ephemeral-check-run-id when seeded).
- **Rehearsals run ONCE per version on preview** — "already applied" refusal is
  correct; keep the first successful run as evidence.
- **Owner-decision comments**: fence-only body; ordered_allowlist JSON ARRAY in the
  comment but COMMA form for the workflow input; source_pr JSON NUMBER.
- **Outcome lifecycle**: advance stepwise with evidence URLs; the db-outcome-evidence
  fence needs verbatim live_assertion, production+live artifact ids/digests, and
  verified_at EXACTLY == the live-proof artifact's observed_at. Windows tar bug: put
  /c/Windows/System32 first in PATH for artifact extraction.
- **Coordination mutex refusals** ("author-acquisition occupied"): wait for the holder
  (it's live work), never recover it while recent.
- **Subprocess drivers on Windows**: always pass cwd — a missing cwd silently read the
  WRONG repository's main and looked like "main always moving".

## 8. Blocked on

Nothing. Phase B is purely authoring + the standard lanes. Preview note: the shared
preview database carries everyone's rehearsals; if a "Remote migration versions not
found" refusal appears, another workstream's rehearsed-but-unmerged migration is
sitting there — wait for its PR to merge (never `supabase migration repair`).

## 9. Facts that may already be stale

- main tip was e5d3b11a (2026-09-30 ~19:00Z); max migration version on main at least
  20260929093750+. Re-derive both from git before relying on them.
- PRs #3693/#3846 merged, #3679/#3680 closed — verified at 2026-09-30 ~19:05Z.
- Reviewer rotation draws drift; assign fresh at whatever head you build.

Standing instructions in force: claim-first structural work (2026-09-30 owner);
Albert approves business outcomes only, never technical risk (2026-08-18/09-28);
sign GitHub posts `Posted by ZCode chat <sess> on <machine>`; EST for human times.

Posted by ZCode chat sess_87780978-0c65-423d-8a73-1f4d41d91ad3 on edge-dev
