# Shared-db orchestrator handover: B4-B9, Phase 7A, OrderList, and cleanup

**Status:** OPEN handover for the next orchestrator  
**Written:** 2026-08-12 21:40 UTC / 17:40 America/New_York  
**Machine:** `al8960ofc`  
**Outgoing agent:** Codex orchestrator  
**Canonical repository:** `u2giants/shared-db`, local checkout `C:\repos\shared-db`

## 1. What this application is

`shared-db` is the source of truth for the shared Supabase database used by POP
CRM, PopDAM, PopPIM/PM, DB Data Admin, and the DesignFlow PLM applications. It
owns migrations, database access rules, shared API functions, preview proof,
and the guarded production migration workflow. Production Supabase is
`qsllyeztdwjgirsysgai`. The shared preview branch is
`rjyboqwcdzcocqgmsyel`.

The applications relevant to this session were:

- DesignFlow at `https://alsand.designflow.app`;
- DB Data Admin at `https://data.designflow.app`;
- PopCRM, whose Overview and Sidebar are being moved from browser-side table
  downloads to bounded server contracts;
- PopDAM, whose future `/orders` page will show the Google OrderList and later
  ColdLion orders through one canonical order model.

## 2. What this session set out to do, and why

This session inherited the production-promotion rebuild and then coordinated
several connected workstreams:

1. make the production migration lane prove immutable human review evidence;
2. promote batches B4, B6, atomic B7, B8, and atomic B9 safely;
3. restore DesignFlow login, which depended on B9;
4. resume POP CRM audit remediation Phase 7A using GLM 5.2;
5. correct the stale OrderList plan and prepare its production approval package;
6. keep PopDAM `/orders` blocked until `plm.item` and the style-item bridge are
   actually ready;
7. reconcile stale issues, unsafe PR #804, status docs, and stale worktrees.

Albert explicitly asked the orchestrator to proceed without returning for each
routine step. That did not erase exact approval gates for new production writes.

## 3. Current state

### Coordination state checked at handover

- `origin/main` was `ecca67d873972b51e9a290de9c58955b7c3cb324` at
  **2026-08-12 21:40 UTC**.
- The highest migration version on disk was **`20260812211000`**, file
  `20260812211000_crm_overview_exact_parity_corrections.sql`.
- There were **zero open pull requests** immediately before this handover branch.
- B4, B6, B7, B8, and B9 are in production. B9 applied all exact 14 members in
  workflow run `31620553795`. That run went red only after the successful push
  because the old catalog verifier did not understand an already-applied
  companion. PR #843 fixed that verifier.
- DesignFlow password and Microsoft logins work. Albert personally confirmed
  this, and issue #841 was closed.
- DB Data Admin is live at `https://data.designflow.app`, HTTP 200, production
  build SHA `991ecbea7b1ef8a8590e77d1746773ee25690d84`, deployment run
  `31622123286`.
- Phase 7A merged in PR #848. The exact merged commit is
  `ecca67d873972b51e9a290de9c58955b7c3cb324`. All required CI checks passed.
- Preview contains both Phase 7A versions, `20260812130000` and correction
  `20260812211000`. Correction apply run `31641099199` was green. A read-only
  runtime check after that apply returned a 500-message email aggregate, 12
  volume periods, 6 recent unrouted rows, and 0 current pending approvals for a
  CRM-authorized preview caller. Production contains neither Phase 7A version.
- Preview is **not globally clean**. It is a shared, persistent rehearsal target.
  Issue #818 owns the larger preview/production drift audit. Do not repair ledger
  rows merely because main lacks a rehearsed branch migration.
- OrderList Steps 0 through 3 are complete. Production already has its schema
  through B9. Preview import proof is 3,212 orders and 24,010 lines, with a
  second identical run changing zero business rows. The production importer
  does not exist yet; the checked-in script is intentionally preview-only.
- PopDAM `/orders` is not approved to deploy. `plm.item` is still unpopulated,
  the style-item bridge cutover is incomplete, and the app page has not completed
  authenticated preview testing.
- B10a through B10d remain open under issue #809. Issue #819 is the specific
  B10c atomic-guard gap.
- Worktree cleanup removed 22 conclusively stale worktrees. Issue #682 remains
  open for the 14 non-primary worktrees that were deliberately preserved because
  they are active, dirty, unique, or not yet proven safe.

### Merged work from this session

- PR #834: immutable production review evidence, commit
  `e0b18a621ea5a02e0437ed0bcdb0d3c160e21720` on its feature branch.
- PR #840: generic hash-bound behavioral sidecar for the B7 data-only migration.
- PR #842: syntax-only evidence normalization while production remains
  ledger-aware.
- PR #843: post-apply catalog verification receives the pre-apply ledger.
- PR #844: DB Data Admin production nginx environment default.
- PR #846: OrderList production approval package and corrected Steps 1 and 2.
- PR #847: durable B4-B9 and DB Data Admin status updates.
- PR #848: Phase 7A CRM Overview server contracts and exact-parity correction.

### Outstanding work and its queue owner

Every item below must have an open `db-work` issue. The outgoing session creates
or refreshes these after this file is merged:

1. promote exact Phase 7A versions to production only after Albert approves the
   exact main SHA and ordered allowlist, then start Phase 7B in `popcrm-web`;
2. build and review the fail-closed OrderList production importer;
3. finish `plm.item` population and the style-item bridge, build/test `/orders`,
   and only then approve deployment;
4. issue #809: B10a through B10d;
5. issue #682: finish the preserved-worktree audit;
6. repair the Grok runner wrapper, which was missing or cancelled in several
   lanes and prevented the requested Grok 4.5 delegation from running reliably.

No outstanding item is left only in this prose.

## 4. Everything tried that did not work

1. The old production review input accepted a URL-shaped reference but proved no
   verdict. It also accepted invented HTTPS URLs. PR #834 replaced it with a
   successful workflow run ID plus immutable artifact digest and canonical JSON.
2. Draft PR #804 tried to classify data-only PL/pgSQL through a deny-list parser.
   Independent review found bypass classes. It was never merged. PR #840 used a
   strict, migration-hash-bound behavioral sidecar with typed assertions instead.
3. The first Phase 7A GLM attempt had an incomplete prompt and made no changes.
   The resumed GLM run produced a useful patch.
4. Independent review then found three false "exact parity" claims in that patch:
   the browser used only the newest 500 emails, rolling seven-day windows rather
   than ISO weeks, and stage-first pending-approval ordering. The already-applied
   preview migration was not edited. A later version, `20260812211000`, corrected
   the functions.
5. The first corrected preview dispatch listed both Phase 7A versions. The guard
   correctly stopped because `20260812130000` was already in the preview ledger.
   Run `31641099199` listed only `20260812211000` and passed.
6. Local `bash scripts/check-sql.sh` on this Windows PTY sometimes returned no
   captured output. The GitHub SQL guard at the exact PR heads passed and is the
   reliable record.
7. A first preview runtime SQL query used stale column names `profile.user_id`
   and `app_access.app_code`. Live names are `auth_user_id` and `app`. The fixed
   read-only query passed.
8. Grok lanes were unreliable. One wrapper path was absent in Git Bash, two runs
   returned `Cancelled` before edits, and the worktree-cleanup review consumed
   about $1.61 while returning an overly conservative zero-safe result because it
   could not inspect the shell. Do not claim the requested Grok work completed
   where the wrapper never produced work.
9. The Node check-sql runner looked hung under the Windows PTY but later finished
   9/9. Do not kill it merely because it is quiet for roughly a minute.
10. No open orchestrator marker existed when this closeout started. The inherited
    marker #821 had already been closed by its prior Path B handover. Marker #849
    was created to make this closeout auditable and must be the final issue closed.

## 5. Root causes and key findings

- B9 was not a database failure. Its migrations applied successfully, and the
  later red status came from a ledger-blind post-apply verifier. PR #843 fixed
  the proof layer.
- A data-only migration can be silently ignored inside a mixed allowlist while
  sibling migrations provide catalog targets. Behavioral sidecars must be
  required per data-only migration, not merely when the whole batch has no
  catalog targets.
- Immutable production approval must bind the authenticated GitHub actor, exact
  current main SHA, ordered allowlist, APPROVE verdict, workflow identity, run
  identity, and artifact bytes/digest. An editable URL is not approval evidence.
- OrderList schema readiness is separate from OrderList data readiness and app
  deployment readiness. B9 solved only the first.
- The OrderList importer intentionally refuses production. Bypassing that check
  would destroy the approval boundary. Add a reviewed production mode instead.
- Phase 7A browser parity is intentionally based on the current newest-500 email
  behavior. A later product decision may choose all-history counts, but that is
  a separate visible behavior change, not part of this remediation.

## 6. Exact next steps

1. Read this file, `AGENTS.md`, and all open `db-work` issues newest-first.
   Verify success by confirming marker #849 is closed and no other open
   `orchestrator-marker` exists before creating the new marker.
2. For Phase 7A production, fetch `origin/main`, record its exact 40-character
   SHA, and form the ordered allowlist
   `20260812130000,20260812211000`. Re-run production preflight and prepare the
   immutable review-evidence package. Do not dispatch apply until Albert approves
   that exact SHA and list in the new session. Success means both versions appear
   in production ledger and all seven functions pass CRM/non-CRM runtime checks.
3. After Phase 7A production is proven, work in `C:\repos\popcrm-web` on Session
   7B from `plan_codebase_audit_remediation.md`: consume the seven RPCs, remove
   browser-side full-table counting, run app tests, and visually verify Overview
   and Sidebar. Success means live UI values match the pre-cutover rules with no
   unbounded browser reads.
4. Implement the OrderList production importer guard described in
   `docs/verification/popdam-order-list-production-approval-2026-08-12/README.md`.
   It must bind the production ref, workbook SHA-256, reviewed git SHA, explicit
   confirmation, no replace mode, target re-checks, and zero-write negative tests.
   Success means a new exact approval package can contain a real command with no
   placeholders. Do not run it yet.
5. Coordinate `fix_schema_for_api.md` Phases 2 through 4 so `plm.item` is
   populated and the style-item bridge is repointed without competing links.
   Then build and authenticated-preview-test PopDAM `/orders`. Success means the
   page uses canonical items and the bridge has no orphan or competing owner.
6. Continue issue #809 for B10a-d. Resolve #819 before treating B10c atomicity as
   enforced. Do not combine B10 with Phase 7A or OrderList approval packages.
7. Resume issue #682 using the cleanup-worktree skill. Preserve every dirty or
   unique worktree. The Phase 7A, promotion-docs, and OrderList branches are now
   merged and are cleanup candidates only after a fresh process/status/ancestry
   check.
8. Repair the Grok wrapper through `ai-devops` setup rather than bypassing the
   `grok-cli` skill. Prove it with a small read-only Grok 4.5 run before assigning
   repository implementation.

## 7. Constraints and gotchas

- One shared-db orchestrator at a time. Create and keep an
  `orchestrator-marker` while the next session is active.
- `COORDINATOR_INTAKE.md` is retired. Never write into it. GitHub `db-work`
  issues are the queue.
- Shared-db changes use branch, PR, preview first, green CI, AI merge, then a
  separately approved exact production package.
- Never edit a migration that has reached preview or production. Use a later
  timestamped correction.
- Never repair a preview ledger row merely because a main checkout lacks the
  migration file. Another workstream may own the applied objects.
- Order matters in production allowlists. Do not sort them in evidence code.
- No production import or `/orders` deployment follows automatically from the
  merged OrderList docs.
- Preserve unique untracked `.ai` reviews. They are evidence from delegated
  models, not disposable build output.

## 8. Access and environment

- Authenticated tools used successfully: `git`, `gh`, `op`, Supabase workflow,
  and PostgreSQL 17 `psql` at `C:\Program Files\PostgreSQL\17\bin\psql.exe`.
- Secrets live only in 1Password vault `vibe_coding`.
- Preview credentials item ID:
  `qbvfk7umc3n75ejekd65zwd4ty`.
- No secret values belong in this file, issues, logs, commits, or prompts.
- Secrets sweep result: **nothing new to store**. The session read existing
  preview credentials serially and did not create, rotate, or discover a new
  credential.
- Documentation pass result: PRs #846, #847, and #848 already corrected the
  durable OrderList, promotion, DB Data Admin, and Phase 7A records. Nothing
  outside this handoff is newly known to be false.

## 9. Open questions and risks

- Albert must approve the exact Phase 7A production main SHA and ordered two-item
  allowlist. Approval for B4-B9 does not cover it.
- A guarded OrderList production importer is not yet built, so no exact import
  command exists and no production data approval should be requested yet.
- `/orders` can expose misleading partial links if deployed before `plm.item`
  population and style-item bridge cutover. Keep it disabled.
- Preview contains other historical rehearsal state. Issue #818 owns proving the
  full difference from production.
- The Grok runner remains unreliable until a real wrapper repair is proven.

## 10. Sub-agent ledger

### Agent: `gate_worktree_audit_833`
- **Asked to do:** audit the abandoned automatic-production-gates worktree.
- **Actually did:** proved the branch had zero unique commits and preserved six
  unique `.ai/reviews` artifacts before cleanup decisions.
- **Found:** implementation had never started; only planning evidence existed.
- **PR / branch:** none; read-only audit.
- **Worktree:** old worktree remains preserved and is owned by issue #682.
- **Deliberately did NOT do:** delete it before artifact recovery and ownership
  checks.

### Agent: `gate_design_833`
- **Asked to do:** reconcile issue #830 design against current main.
- **Actually did:** designed provider-neutral immutable review evidence and exact
  workflow/verifier tests.
- **Found:** the old URL reference proved no verdict and accepted invented URLs.
- **PR / branch:** design fed PR #834.
- **Worktree:** finished.
- **Deliberately did NOT do:** remove the production environment binding or make
  provider/model calls.

### Agent: `gate_implement_833`
- **Asked to do:** implement issue #830.
- **Actually did:** opened PR #834; 420 Python tests, 9 check-sql Node tests, 6
  ColdLion tests, static SQL checks, and YAML parsing passed.
- **Found:** immutable artifact run/digest evidence could replace the pointer.
- **PR / branch:** PR #834, merged.
- **Worktree:** finished and safe to clean after a fresh ancestry check.
- **Deliberately did NOT do:** write any database or change production settings.

### Agent: `b7_resolution` and `b7_sidecar_impl`
- **Asked to do:** resolve the B7 data-only verification gap safely.
- **Actually did:** designed and implemented strict hash-bound behavioral
  sidecars; PR #840 merged after 123 catalog tests and 417 combined tests.
- **Found:** mixed batches could silently ignore a data-only migration even when
  sibling catalog targets made the overall verifier green.
- **PR / branch:** PR #840, merged.
- **Worktree:** finished.
- **Deliberately did NOT do:** merge unsafe PR #804 or accept arbitrary SQL in a
  sidecar.

### Agent: `b9_evidence_fix` and independent PR reviewers
- **Asked to do:** unblock exact B9 evidence and fix ledger-aware post-apply proof.
- **Actually did:** PRs #842 and #843, both merged; full Python suites passed.
- **Found:** review evidence should normalize syntax only, while preflight/apply
  remain ledger-aware; catalog verification needs the pre-apply ledger.
- **PR / branch:** #842 and #843, merged.
- **Worktree:** finished.
- **Deliberately did NOT do:** weaken production dependency or co-presence guards.

### Agent: `batch_readiness` and `promotion_workflow`
- **Asked to do:** establish exact B4-B9 readiness and the guarded promotion
  procedure.
- **Actually did:** enumerated exact ordered batches, dependencies, smoke gates,
  and immutable workflow procedure. That evidence drove successful promotion.
- **Found:** B9 depended on B8 and already-applied `20260810180000`; `/orders`
  still depended on `plm.item` and the bridge.
- **PR / branch:** read-only work.
- **Worktree:** finished.
- **Deliberately did NOT do:** combine batches or treat a green ledger as full
  application proof.

### Agent: GLM 5.2 `crm-audit-phase-7a-resume`
- **Asked to do:** implement POP CRM audit Phase 7A.
- **Actually did:** produced the original seven-function migration, tests, and
  preview evidence patch. The resumed run succeeded after the first run did not.
- **Found:** live canonical company table is `core.customer`, not stale
  `core.company` migration text.
- **PR / branch:** work was integrated and merged through PR #848.
- **Worktree:** GLM sandbox deleted by its wrapper; finished.
- **Deliberately did NOT do:** production apply or app-side Phase 7B.

### Agent: `phase7a_review`
- **Asked to do:** independently review GLM's Phase 7A patch.
- **Actually did:** found three material parity defects, then added correction
  migration `20260812211000`, updated tests, and marked stale proof honestly.
- **Found:** current browser semantics were newest 500 emails, rolling seven-day
  windows, and stage-first approval ordering.
- **PR / branch:** integrated into PR #848, merged.
- **Worktree:** `C:\repos\shared-db-worktrees\phase-7a-crm-overview`; finished,
  safe to clean only after the normal fresh checks.
- **Deliberately did NOT do:** rewrite the already-preview-applied first migration
  or invent corrected preview results.

### Agent: `grok_orderlist_package`
- **Asked to do:** correct stale OrderList status and prepare the exact production
  approval package.
- **Actually did:** committed the docs package, later merged as PR #846.
- **Found:** schema is in production, but importer remains preview-only and
  `/orders` remains bridge-blocked.
- **PR / branch:** PR #846, merged.
- **Worktree:** `C:\repos\shared-db-worktrees\grok-orderlist-production-package`;
  finished and a cleanup candidate.
- **Deliberately did NOT do:** build a production importer, import production
  data, or deploy `/orders`.

### Agent: `issue_cleanup`
- **Asked to do:** reconcile stale issues and unsafe PR #804.
- **Actually did:** closed #804 without merge; closed #773, #813, and #831;
  updated #809 and left it open for B10.
- **Found:** Grok wrapper was unavailable, so requested Grok work could not be
  honestly claimed.
- **PR / branch:** none; GitHub issue/PR cleanup only.
- **Worktree:** finished.
- **Deliberately did NOT do:** close real B10 work.

### Agent: `promotion_docs`
- **Asked to do:** correct stale B4-B9 and DB Data Admin deployment docs.
- **Actually did:** PR #847, merged.
- **Found:** live DB Data Admin health and build SHA matched the deployment record.
- **PR / branch:** PR #847, merged.
- **Worktree:** `C:\repos\shared-db-worktrees\promotion-docs-current-status`;
  finished and a cleanup candidate.
- **Deliberately did NOT do:** touch OrderList, Phase 7A, databases, or deployment.

### Agent: `worktree_cleanup`
- **Asked to do:** safely advance issue #682.
- **Actually did:** removed 22 clean incorporated worktrees without force or
  branch deletion and posted evidence on #682.
- **Found:** 14 non-primary worktrees still needed preservation or fresh proof.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do:** remove dirty, unique, active, or unclear worktrees.

### Agent: Grok status/docs attempts
- **Asked to do:** run the independent concurrent Grok 4.5 lanes.
- **Actually did:** two status/docs runs cancelled before edits; cleanup review ran
  but could not inspect the shell and was not actionable.
- **Found:** the Grok runner/wrapper needs repair and a real proof run.
- **PR / branch:** no Grok-authored code PR.
- **Worktree:** none from the cancelled runs.
- **Deliberately did NOT do:** pretend cancelled or shell-blind results were
  completed implementation.

## 11. Mystery files and preserved ownership

The primary checkout has untracked `.ai` GLM/Grok/DeepSeek reports, patches, and
briefs plus `HANDOFF.d/start-phase-7a-prompt.md`. They predated this handoff and
were deliberately preserved. The Phase 7A patches are useful provenance even
though PR #848 is merged. Issue #682 should classify their final durable home
before any deletion. This session did not edit `COORDINATOR_INTAKE.md`.

## 12. Fresh-developer self-audit

- Could a developer new to POP continue with no questions? **Yes.** Repos,
  environments, URLs, exact versions, SHAs, issues, and ordered next steps are
  named.
- Could they continue as effectively as this session? **Yes.** Successful and
  failed paths, approval boundaries, and preview state are explicit.
- Did this include what failed and why? **Yes, in section 4 and each agent block.**
- Is every next step concrete and verifiable? **Yes, section 6 supplies success
  gates.**
- Are terms, paths, and risks explained? **Yes.**

**Self-audit passed at 2026-08-12 21:40 UTC.**
