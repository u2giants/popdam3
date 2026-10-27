---
issue: 548    # open docs PR + the jammed ai-doc-safety lane; merging 548 and unjamming the lane completes this
status: OPEN
owner: glm session 2026-10-27 (ZCode on hetz), branch docs/orderlist-526-discriminator-rule
---

# OrderList #526 closeout — unmerged docs PR 548, jammed prose-merge lane, hetz LibreOffice drift

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs Albert. (Verified by sweep: every open item
below is technical — a repo gate, a PR merge, an Ansible capture — and is owned by
the next AI session. The one business observation, the D0623 duplicate order rows,
was already put to Albert in chat on 2026-10-27 and he made no request; do NOT
re-ask.)

Already settled — do NOT re-ask:
- 2026-10-27, Albert, verbatim: "that's an ancient PO, we can just disregard that"
  (PO D0623) — applied and recorded on
  https://github.com/u2giants/popdam3/issues/526#issuecomment-6447303870.
- 2026-10-27, Albert: "clear #526" — done; issue closed with live proof.

## 1. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) is the
internal digital-asset manager; its OrderList page shows production orders whose
line items link to Master Data product records (test report, professional photos,
licensing workflow). The shared Postgres lives in Supabase project
`qsllyeztdwjgirsysgai`; OrderList write surface is three RPCs
(`create_dam_order` / `update_dam_order` / `link_dam_order_line`) defined in
canonical `popcre/shared-db` migrations.

## 2. What this session set out to do, and why

Albert: "pull the latest repo and clear https://github.com/u2giants/popdam3/issues/526"
— OrderList showed "Unknown AT IMPORT" for test-report/photo columns where a
current Master Data record existed. After the repair, follow-ups: the 10-decision
workbook (superseded by Albert's D0623 disregard ruling), then "wrap up".

## 3. Current state — what is true right now

Done and verified (do NOT redo):
- Repair tranche 2: 612 lines typed (348 licensed / 264 generic via
  `update_dam_order`) and linked (`link_dam_order_line`, status `matched`) in one
  serializable transaction, 2026-10-27 8:08 AM EDT. Postconditions through
  `api.dam_order_list`: 612/612 `product_workflow_source=master_data`, all with
  current test-report AND photo values, 0 type mismatches. Signed-in admin REST
  read returned 612/612 clean. Issue #526 closed with live proof:
  https://github.com/u2giants/popdam3/issues/526#issuecomment-6441581464
- Albert's D0623 ruling applied: the 10 ambiguous lines set `not_applicable`
  through `link_dam_order_line` clear path; 0 ambiguous remain; unlinked total 24
  (23 `not_applicable` no-candidate + 1 `unmatched` on D0562) — none decidable.
- Private before/after evidence: 1Password vault `vibe_coding`, item "PopDAM
  OrderList missing-type link repair - issue 526 recovery evidence (hetz,
  2026-10-27)" (item id `kghjvuuj32lxzk77bduczmuyza`).

Half-done (the open items this handoff exists for):
- **Docs PR #548 OPEN, not merged**: one bullet added to
  `docs/ORDER_LIST.md` Master Data rules recording the missing-discriminator
  unique-relink rule. Branch `docs/orderlist-526-discriminator-rule`, commit
  `4761a8af`, pushed. Worktree: `/tmp/wt526/popdam-docs` on hetz (clean).
  PR: https://github.com/u2giants/popdam3/pull/548
  GitHub Actions checks green (guard, lint-test-build, verify,
  forbid-shared-db-bypass). External "Entire Gates" check FAILS (no diagnostics
  seen; unknown whether it gates merge).
- **Blocked on**: the prose-only merge lane requires
  `/worksp/ai-devops/bin/ai-doc-safety <tree>` to pass on the exact head, and it
  fails PRE-EXISTINGLY on pristine `origin/main` (`e6afec34`, checked 2026-10-27
  ~12:35 PM EDT) with identical failures — so no head can pass until the lane is
  unjammed. Evidence + remediation notes in
  https://github.com/u2giants/popdam3/pull/548#issuecomment-6447857125
- **hetz host drift**: LibreOffice 26.8.1 installed to `/opt/libreoffice26.8` +
  symlink `/usr/local/bin/soffice` (mandated by the xlsx skill QA gate; used to
  verify Albert's workbook). Per repo AGENTS.md host-boundary rule this needs an
  Ansible PR to capture. Keep the install — it is the document-QA capability.

## 4. Everything we tried that did NOT work

- **Single-word allowlist to unjam doc-safety**: created
  `tools/public-boundary-allowlist.txt` with `qsllyeztdwjgirsysgai` — did NOT
  clear the gate; the checker has three failure categories (credential-shaped
  content, private-network topology, project-shaped identifiers) hitting dozens
  of files (`.lovable/**`, `AGENTS.md`, many `HANDOFF.d/` archives,
  `verification/**`). Reverted; never committed. A per-category remediation is
  required, and note: rewording other sessions' `HANDOFF.d/` files is forbidden,
  so for those the reviewed-allowlist route is likely the only legal one.
- **PL/pgSQL `r` collision in the repair DO-block**: loop variable `r record`
  silently captured the CTE alias `r` (style_tracker_rows) in static SQL →
  "record r is not assigned yet". Fix: rename loop var (`v_line`). Cost one
  failed attempt; first attempt rolled back cleanly, state untouched.
- **`gh pr create` from a linked worktree** aborted with "you must first push"
  even though the branch was pushed; `--head <branch>` worked.
- **`ai-shared-db-closeout-check`** rejects a ZCode session identity ("unknown"
  is not a Codex/Claude UUID) and fails closed. This session created no
  shared-db claims at all (application-data RPC writes only), so nothing is held.
- **`ai-doc-safety HEAD`** — the positional arg is a tree path, not a rev.
  `ai-doc-safety <worktree-path>` is the working form.

## 5. Root causes and key findings

- The #526 linkage rule now recorded in the PR: a line whose ERP intake omitted
  Licensed/Generic may be typed + linked iff its normalized Style # resolves to
  exactly one bridged item in exactly one Master Data catalog; anything wider
  stays ambiguous. Authority chain: Settled OrderList rule in
  `popcre/shared-db/docs/business-rules/erp-orders-and-source-meaning.md`
  (Albert 2026-10-09, #281) + `source_style_type` being an ordinary writable
  field in migration `20260831045020` + Albert's "clear #526".
- `ai-doc-safety` (wrapper `ai-devops/bin/ai-doc-safety` → `ai-public-boundary-check`
  + markdown-link check) is red repo-wide on main. Flagged word rule: any
  lowercase run ≥20 chars, per-WORD allowlist via exact-line grep in
  `tools/public-boundary-allowlist.txt` (file does not exist in this repo yet).
- PO D0623 exists as THREE `plm.production_order` rows (two literally "D0623",
  one "d0623"), created 2026-10-14 by the legacy-sheet import, never voided,
  no order_date. Observation only; Albert was told and made no request.
- "Entire Gates" (entire.com) failed on PR 548 with no output; not diagnosed.

## 6. Exact next steps

1. Unjam the prose-merge lane: for each doc-safety failure category on the PR
   head, decide redact/reword vs a reviewed allowlist entry; create
   `tools/public-boundary-allowlist.txt` entries with justifications (never edit
   other sessions' `HANDOFF.d/` files). Gate: `/worksp/ai-devops/bin/ai-doc-safety
   <worktree>` exits 0 on the PR head.
2. If "Entire Gates" is a required check, diagnose it on PR 548 (it may just be
   a queue artifact); if merge is still blocked after doc-safety passes, surface
   exactly what refused. Gate: `gh pr view 548` shows mergeable.
3. Merge PR 548 per the prose-only rule (`gh pr merge 548 --squash --admin` once
   doc-safety passes). Gate: `gh pr view 548 --json state` → MERGED.
4. Then: comment the merge link on closed issue #526; delete branch
   `docs/orderlist-526-discriminator-rule` (after proving MERGED); remove
   worktree `/tmp/wt526/popdam-docs` (tree is clean; use the cleanup-worktree
   procedure); DELETE this handoff file in the same change that finishes step 3
   (successor rule).
5. Ansible PR (`u2giants/ansible`) capturing the hetz LibreOffice install
   (`/opt/libreoffice26.8`, `/usr/local/bin/soffice` symlink) so the next apply
   does not revert it. Gate: ansible CI apply green, `soffice --version` still
   works afterward.

## 7. Constraints and gotchas in force

- Never push to `main` directly; branch + PR. Prose-only merge lane REQUIRES
  ai-doc-safety passing on the exact head — never merge around it.
- Never edit/tidy/delete another session's `HANDOFF.d/` file (this repo has many;
  several are flagged by the boundary check — that is exactly why rewording them
  is not an option).
- DB writes: application RPCs only; no DDL outside `popcre/shared-db`.
- Times to humans always in EST/EDT. Sign GitHub posts "Posted by ZCode chat
  <id> on hetz".
- Railway auto-deploys every push to main; docs-only pushes do not trigger the
  frontend build.

## 8. Access and environment

- `gh` authenticated as `u2giants`. psql to the shared DB via pooler
  `aws-1-us-east-1.pooler.supabase.com:5432`, user `postgres.qsllyeztdwjgirsysgai`,
  password from 1Password vault `vibe_coding`, item "Supabase DB Password -
  shared POP database" (values only through pipes/protected files).
- Signed-in live checks: 1Password item "DAM AI tester login - PopDAM
  (administrator, dam.designflow.app, production)" (ai-admin@designflow.app).
- edge-dev Windows box: `ssh -i ~/.ssh/916-alien ahazan@100.75.135.31`.
- LibreOffice 26.8.1 at `/opt/libreoffice26.8` (soffice on PATH via
  /usr/local/bin) on hetz.

## 9. Open questions and risks

- Is "Entire Gates" (entire.com) a required merge gate here? Undiagnosed; check
  before assuming squash-admin clears it.
- Allowlist-vs-reword for each boundary violation needs case-by-case care
  (HANDOFF.d archives may contain licensed-content references — do not paste
  them anywhere public; the boundary check output itself already quotes some).
- Low risk: ColdLion daytime poller could later re-sync the 612 repaired lines;
  the item links survive (item_id is not settable by update), and the view's
  `item_link_type_mismatch` flag would surface any type disagreement. Verified 0
  mismatches at 8:09 AM EDT 2026-10-27.

## Part (b) — sub-agents dispatched this session

### Agent: spreadsheets:visual-judge (two passes, 2026-10-27)
- **Asked to do:** visual acceptance of the (now withdrawn) decision workbook render.
- **Actually did:** pass 1 found one real defect (orphaned group header at a page
  break); pass 2 confirmed 11/11 pages clean after the page-break fix.
- **Found:** nothing beyond that defect.
- **PR / branch:** none (workbook was later withdrawn after Albert's D0623 ruling).
- **Worktree:** n/a. **Artifacts:** none remain (xlsx deleted from repo and edge-dev).
- **Deliberately did NOT do, and why:** nothing left undone; the deliverable itself
  was superseded by the owner's ruling, not by a gate failure.

## Self-audit (passed 2026-10-27 12:45 PM EDT)

1. Comprehensive for a newcomer: yes — §1–§3 give app, goal, exact state with URLs;
   §4 dead ends; §6 executable steps with gates.
2. Continue as effectively as me: yes — §4/§5 carry the PL/pgSQL, gh, doc-safety
   and closeout-check traps plus the lane-jam root cause.
3. Every needed detail: yes — commit/PR/branch/worktree, vault item ids, SSH key,
   timestamps with zone, verification evidence links.
4. §0 sweep: run — no owner decisions remain; both settled rulings listed with
   dates and "do NOT re-ask"; all other items routed to the next AI session.
