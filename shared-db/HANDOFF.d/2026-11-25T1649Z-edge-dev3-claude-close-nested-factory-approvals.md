---
issue: 7070
status: OPEN
owner: claude/close-nested-factory-approvals
---

# Close-nested handoff: factory approvals (Disney FAMA, NBCU LMS, Dollar General, Walmart)

Written 2026-11-25 11:49 AM EST by the coordinator session "Factory approval attributes"
(edge-dev3, Claude). The tree of sessions is closed; this file holds every remaining task.

## 0. Business decisions only the owner can make

Put all three to Albert in ONE message before starting work.

Blocking:
1. **Who is on the production team?** The new "production" role gives permission to manage
   factory approvals. Licensing staff already have access; production staff need it by
   name. Recommendation: Albert lists names, and the AI grants the role. Blocks only
   production-staff use of the screen.
2. **Ilona reports "all admin access" in DesignFlow. Which screen shows it?** A screenshot
   would settle it. Her live roles have not changed since 2026-10-22 (production,
   coordinator, QC), and the audit log shows no role change. Recommendation: Albert sends
   a screenshot; the AI traces the cause read-only. Blocks task 3 below.

A wrong guess is recoverable:
3. Factory mapping (task 1): when a DesignFlow factory name matches no shared factory
   with confidence, should the AI create a new shared factory or ask? Recommendation: ask
   only for ambiguous name collisions; create the obvious new ones.

Already settled; do NOT re-ask:
- 2026-11-24: Disney and NBCU are licensors, not customers.
- 2026-11-24: The four programs and their fields. Reminders go out 6 weeks before a
  FAMA/LMS form expires. Full form history is kept. Manual entry without a PDF is allowed.
- 2026-10-29: Reviews are advice only. Production changes go only through automatic
  promotion.

## 1. What this application is

POP Creations sources goods from factories. Licensors (Disney, NBCUniversal) and retailers
(Dollar General, Walmart) must each approve a factory. Records live in the shared Supabase
database (repo https://github.com/popcre/shared-db):
- `core.factory_approval`: one row per factory and program.
- `core.factory_approval_form`: the uploaded PDF history.
- `core.factory_approval_reminder`.

The approvals are used in three places:
- **DesignFlow** (PLM web app; repos popcre/designflow-backend and
  popcre/designflow-frontend). Its Factory screen shows and edits approvals.
- **PopDAM's Indra worker** (repo popcre/popdam3). It reads uploaded FAMA/LMS PDFs and
  fills the name, number and expiry.
- **A daily database job** (`factory-approval-renewal-reminders`). It posts reminders to
  `app.notification` for app `plm`.

DesignFlow factories are separate rows in `dflow_prod."Factory"` (integer id). They link
to shared factories through `core.factory_source_ref`, where source_system is
'designflow', source_table is 'Factory', and source_id is the Factory.id as text.

## 2. Goal of this session tree

Build the four approvals end to end: database, form reader, DesignFlow screen and live
release. Everything is built and live. What remains is the follow-up work below.

## 3. Current state (verified 2026-11-25)

Landed and verified:
- **shared-db:** PRs #7071, #7092, #7094, #7100, #7113, #7116 and #7119 are merged.
  - Production ledger has 20261225130300, 130400, 130500, 131000 and 131100.
  - **20261225131200 was not yet in the production ledger at 11:48 AM EST**; it is
    queued for automatic promotion (task 2).
  - The sandbox catch-up (130600) is applied to the DesignFlow sandbox.
  - Review findings #7074, #7093, #7114 and #7117 are closed with evidence.
- **DesignFlow:** everything is merged and live.
  - Backend #566, #567 and #568; frontend #644, #645, #646 and #647.
  - Cloud Build succeeded.
  - Live API proof at 9:15 AM EST: linked factories return 200, and a sales PUT returns
    403.
- **Indra:** popdam3 #1340, #1345 and #1358 (docs) are merged. The worker is live and
  read both sample PDFs correctly.
- **Child handoff:**
  https://github.com/popcre/designflow-backend/blob/sandbox-albert/HANDOFF.d/2026-11-25T1514Z-edge-dev3-claude-factory-approvals-followups.md

Not done: the tasks in §6.

## 4. What did not work (don't repeat)

- **A derived-from base not in the target ledger** (20261116120100 is sandbox-only).
  Preview refused it, and the PR ran out of automatic attempts. The fix was to retire the
  versions in `scripts/production_migration_guard.py` and re-issue them under new versions
  (#7094).
- **Running the shared migrations on the DesignFlow sandbox.** It has no pg_cron. A
  sandbox-only catch-up migration was needed (#7100, registered as foreign-target).
- **Broad `FOR ALL` policies for the backend runtime.** Review flagged them (#7114).
  Policies must be command-specific, uploads are insert-only, and the OCR columns stay
  worker-only.
- **An upload policy that required `uploaded_by`.** It breaks users who have no
  `app.profile` (#7117).

## 5. Key findings

- `designflow_prod_backend_runtime` is not BYPASSRLS. Every core/app table it touches
  needs both a grant to `designflow_prod_backend_grants` and a row policy for that role.
- The backend's write paths were audited in
  https://github.com/popcre/designflow-backend/blob/develop/services/factoryApprovals.service.js:
  - an upsert into factory_approval (lines 151-159);
  - an insert of 5 columns into factory_approval_form (line 172);
  - an update of notification read_at (line 202).

  Any new backend write needs a matching shared-db grant first.
- 99 of 186 DesignFlow factories (67 Active) have no core mapping. For those, the screen
  returns 409 "not linked to the shared factory list yet".

## 6. Open tasks (one nested session each)

### Task 1: Map the unmapped DesignFlow factories to core factories (shared-db)
- **Goal:** every Active DesignFlow factory is linked, so its approvals can be used.
- **State:** on production, 99 of 186 `dflow_prod."Factory"` rows have no
  `core.factory_source_ref` row; 67 of them are Active. The 524 approval rows exist only
  for mapped core factories.
- **Next:**
  1. Load the `shared-db-change` skill and claim on #7070.
  2. Read-only, match each unmapped factory to `core.factory` by name, nickname and
     country, and check the coldlion refs.
  3. Use the curated Master Data load path to insert the source refs, creating new core
     factories where there is no match. Approval rows seed automatically by trigger.
  4. Ask Albert only about ambiguous collisions (§0 item 3).
- **Done when:** this query returns 0 on production:
  `select count(*) from dflow_prod."Factory" f where factory_status='Active' and not exists (select 1 from core.factory_source_ref s where s.source_system='designflow' and s.source_table='Factory' and s.source_id=f.id::text)`.
  Also, the live DesignFlow API returns linked=true for one previously unmapped factory.
- **Issue:** https://github.com/popcre/shared-db/issues/7070. **Branch:** fresh from main.

### Task 2: Confirm 20261225131200 reached production (shared-db)
- **Next:** check `supabase_migrations.schema_migrations` for 20261225131200.
  - If it is missing, read the latest "Automatic production promotion trigger" run log
    for a hold reason. Fix any `review-finding` issue on #7119 and let promotion retry.
  - Never apply it by hand.
- **Done when:** the version is in the production ledger, and the backend runtime can
  insert a form row with a null `uploaded_by` (check `pg_policies`: the insert policy has
  no `uploaded_by` term).
- **Issue:** #7070. **Branch:** fresh from main.

### Task 3: Explain Ilona's "all admin access" report (DesignFlow). After §0 item 2.
- **Next:** with Albert's screenshot, trace read-only: token, impersonation, menu
  config.
- **Done when:** the cause is named with evidence and either fixed or shown to be
  unchanged behavior.
- **Branch:** fresh from main of designflow repos.

### Task 4: Verify the live Factory Approvals menu (DesignFlow)
- **Next:**
  1. Sign in as the sales tester through the API.
  2. Take Playwright screenshots of the live menu.
- **Done when:** the menu shows Factory Approvals, and /apps/factory redirects correctly
  for staff.
- **PR:** https://github.com/popcre/designflow-frontend/pull/647.

### Task 5: Prove a live FAMA upload end to end. After a real staff upload.
- **Next:** after a licensing or production user uploads a FAMA PDF on the live site:
  1. Check that the form row exists.
  2. Check that Indra filled name, number and expiry.
  3. Check that the signed link returns the PDF.
- **Done when:** all three are confirmed.
- **Blocked:** no AI login on the live site can edit. Wait for a real upload, and don't
  ask Albert to click.

## 7. Constraints

- Shared-db rules: claim-first on #7070, merge through the merge queue (`gh pr merge`),
  wait with `ai-pr-wait`, and reach production only through automatic promotion.
- DesignFlow ships from sandbox-albert to develop to main by PR.
- Never hand-edit `types/database.types.ts`.

## 8. Access

- Supabase MCP is authenticated to production (read-only checks).
- `gh` is authenticated as u2giants for the popcre repos.
- Secrets are in the 1Password vault `vibe_coding`.

## 9. Risks

- A new backend write without a matching grant fails live with 42501.
- An unmapped factory silently has no approvals until task 1 lands.

## Self-audit

1. Newcomer could continue: yes (§1, §3, §6).
2. As well as me: yes (§4, §5).
3. Every detail: yes (§3 to §9).
4. §0 complete: yes. I swept §3 to §6 for "Albert", "ask" and "blocked"; the production
   team, Ilona and mapping ambiguity are all in §0. The live-upload blocker is technical
   and is listed as Blocked in task 5.
