---
issue: 281
status: BLOCKED
owner: codex/sheets-full-integration
---

# Native Sheets integration — current session record

Snapshot: October9,2026,4:02 AM EDT. This is unfinished delivery, not a
completion report. Start with the reciprocal
[implementation plan](../plan_orderlist_sheets_full_integration.md), its STATUS,
and fresh GitHub/current main/promotion state. Never inherit stale gates.

## 0. Business decisions only the owner can make

The three ColdLion lines on popdam3#275 need POP or Spruce Licensed: style
DSMT0MVAV01 appears twice, NTSTVSSSS01 once. Those styles exist in canonical
Item Master under both divisions. An async question was already sent and is
unanswered; keep held linkage, do not ask again or guess. This does not block
honest Unknown behavior for the integration. No technical approval belongs
to Albert. Already settled by his chat: "product details should now be supplied
by item master" and "reproduce the Sheets’ full integration". Item Master owns
product descriptions, Master Data current product workflow, purchase tracking
its manual order fields; reverse vendor statistics are readonly.

## 1. What this application is

PopDAM is POP's React/Vite artwork/product workspace, https://dam.designflow.app,
GitHub u2giants/popdam3. PopSG uses the same image at https://sg.designflow.app;
keep Orders excluded there. Shared Supabase is production
qsllyeztdwjgirsysgai, canonical structural repo popcre/shared-db. See plan2/12
for worktrees, runtime, access and secret locations.

## 2. What we set out to do and why

Reproduce native Google MasterData/OrderList connections: current licensing,
vendors/test/photo/reorder, PO Tracking inherited by components, sample depth
and suffix lookups, physical assortment case totals and reverse vendor activity.
Prior exact linkage is live459/462 ColdLion lines; canonical description change
was separately merged b1f4d7e. Do not redo or weaken it. Existing application
acceptance is https://github.com/u2giants/popdam3/issues/281; shared structural
acceptance https://github.com/popcre/shared-db/issues/4111. Missing canonical
Google POs remain separate #277, not a new leftover-proof issue.

## 3. Current state

Backend /worksp/shared-db-orderlist-integration branch
codex/orderlist-sheets-integration is clean/pushed HEAD
b968c32d410ee60739f328b056e93165eee0b570, PR4118, claim4112 owner
codex/orderlist-sheets-integration expiry11:53 AM EDT. Current migration
supabase/migrations/20261009073649_popdam_orderlist_sheets_integration.sql
sha256bbe83b7db3ac4eb67a1468da83f32d1d9a5a75695decdf09a2957bcf6b31e590.
Full CI37900560564SUCCESS. Current exact head is NOT independently approved;
historical a891 approvals must not be reused. No preview/production apply.

Checker prerequisite /worksp/shared-db-orderlist-verifier branch
codex/orderlist-verification-prerequisite HEAD
c54b1651fa66816c165a6c8261997639eacfb107, issue4130/PR4131.
Source/test/catalogbaseline plus generation2 evidence pair, no schema/rows.
Muse exact-head APPROVE lifecycle report
.ai/reviews/muse-orderlist-verifier-prerequisite-4130-20261009T072933Z-784628-24555.md.
Durable ref refs/db-review-verdict-replacements/4130-4131-c54b1651fa66816c165a6c8261997639eacfb107-5996,
SHA2dde4402576368c7304d9cc51b49a33c5bc60ba5. Full CI37899000642SUCCESS;
239 catalog unit tests and72 throughput tests pass. Ship/wait gates passed.
Guarded merge37900141743 refused foreign promotion freeze, not source failure.

Foreign freeze refs/db-coordination/promotion-freeze:
owner claude:promotion-20261008212538, PR4110/issue4106, acquired3:37:57 AM EDT,
expires4:07:57 AM EDT. Owner activity beyond renewal unverified. Do NOT release
another owner's record. Expired hold is allowed by native guard; refresh state
before dispatch. No queued4131 merge at this snapshot. Event-aware waiter
exec80033 watches PR4131 until about4:12 AM EDT; use it while alive. It does not
dispatch a new workflow itself. Shared merge concurrency has only one pending
slot: do not cancel another owner's queued work.

App /worksp/popdam-sheets-integration branch codex/sheets-full-integration HEAD
91282b607ada (resolve full SHA), npm ci installed, declared reviewer-safety.
Dependent app code entirely untouched: required backend merge has not happened.
Own dirty prose only: AGENTS.md plan registration, docs/ORDER_LIST.md,
docs/MASTER_DATA.md, plan_orderlist_sheets_full_integration.md and this handoff.
Plan13sections includes concrete remaining UI/API/validation/test/live gates.
Canonical rules /worksp/shared-db-orderlist-rules branch
codex/orderlist-integration-business-rules has two own uncommitted prose files
listed in plan5; defer shipment until structural main stabilizes.

Private source recovery:
/home/ai/.local/share/popdam-recovery/orderlist-integration-20261009/
prepared-integration-source.json sha256
13bc64585bb5ec26e977fa948e6c59dfcf1b489e463fbe5e6151016ebd36fb4d.
Contains8257 sample bindings (1195positive/7062NULL),38suffixes,
3147 exact-matched PO auxiliary rows, total11442. No row load occurred.
71missing canonical PO references held (59historical,12still referenced #277),
3duplicate tracking source rows held first-match. Canonical capture3453PO
headers. Initial load must not write canonical header dates; first-match source
held differences sent1/CRD4/ETD1/ETA0. Old3553capture count was a typo.

## 4. Failed attempts

Plan7 preserves formula-cache mistake, unsafe current/history fallback,
physical case overcount, opaque helper count cost, NaN loophole, whole-serving
Master view rewrite and exact-head stale review reuse. Guarded original
merge37897638269 could not interpret new named catalog contract; checker4131
is necessary, not bypass. Checker DeepSeek5993 REVISE correctly required routine
attributes/relkind/real sidecar-loader tests; all fixed. Qwen5996 quota exhausted
without a verdict; supported replacement5997Muse APPROVE is real, never retry
quota/change key. Earlier checker238-test proof is historical; current239.
Local python alias absent caused throughput harness failures; isolated scratch
venv corrected runtime, no OS binary changed. GitHub one-pending concurrency
cancelled checker37899948830. Foreign freeze refused37900141743; do not loop
dispatches while held. Normal merges preserve original source/review history;
no force push/rebase rescue. Backup branch codex/orderlist-integration-rebase-
recovery-20261009 retains bad rebased history, do not blindly remove.

## 5. Key findings

Native workbooks: OrderList1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk;
Master1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214;
TaskList1oex7EsHfo2Tq6wq6b060clzzxDNlgXt9K1cN-JVbsIY.
Native formula inventory prepared in canonical migration-note prose (plan9).
Source operational directions: Master workflow to Orders, order vendorstats
back to Master readonly. Master helper tabs otherwise internal. Currentnamed
semantic NULL outranks legacy letters; unknown/conflicts never import approval.
20 linked ColdLion lines (fiveitems) lack Mastertracker workflow; do not create
curated rows. Current source label master_data/at_import/unavailable/ambiguous.

POTracking manual fields are exactly24 closed keys in plan3, private tracking
view has no derived order_status column; show open/closed/forecasts/status
facts already returned. CBM0allowed, finite>=0; depthpositivefiniteorNULL;
suffixnonblank1..50 cannotclear. Explicit CRD/ETA clears suppress historical
fallback, absent keys keep prior state. Importhistory separate. Assortment
physical parent counted once; component unknown stays unknown. Licensing RPC
returns TABLE(iduuid,license_statustext), bounded1000 IDs. Tracking reader caps
200headers, materialized before component lookup. Vendor activity14months.
Backend exact catalog checker proves268column/type tuples,12routineattributes,
security/grants/signatures, not just routine existence. Scale actual60k lines,
4k headers/30kitems:200PO~415ms, filtered200PO~311ms, vendorstats~5ms,
licensing sort500~2168ms using real existing indexes, no synthetic production
index. Owned Docker codex-orderlist-integration-01a11d67 fixture integration_v15.

## 6. Exact next steps and gates

1. Refresh current foreign freeze and shared merge queue. Once absent/expired,
   check ship gate with actual Muse lifecycle report in checker worktree and
   dispatch guarded-migration-merge.yml via gh workflow run --repo
   popcre/shared-db -f pull_request=4131 -f head_sha=c54b1651fa66816c165a6c8261997639eacfb107.
   Gate: actual PR merged, not merely successful checks.
2. Fetch/normal merge origin/main into backend own branch. Preserve checker
   strengthened routineattrs/relkind/tests and rederive only owned catalog
   baseline from actual migration inventory. If chronology requires another
   migration version use official --reversion-active-claim, never manual rename.
   Gate: clean/published current source, fresh full CI, current reservation.
3. Build fresh clean-head evidence bundle/sidecar registry/preflight (templates
   scratch finite-bundle-input.json,finite-preflight-input.json are historical
   a891/version54834 and must be updated). Add catalog test file, currentbase/
   head/version/ledgerhash. Obtain two fresh independently governed exact-head
   reviews. Gate: actual lifecycle APPROVE refs/source binding, no fake checks.
4. Governed structural merge, then merged-main preview rehearsal followed by
   qualified automatic production workflow. Current workflow is authoritative:
   merge first, merged_preview_source_pr4118, commit_sha currentmain, exact
   allowlist; no old claim_pr/head. Use official selector/prepare manifest and
   fresh task gates. Gate: actual preview/prod ledger/catalog/roles/results.
5. Execute plan2 independently reviewed guarded11442auxiliaryload, then
   plan3–9 app screens/review/shipment/authenticated live proof/docs. Gate:
   every deliverable actually exists live, same issue281 acceptance recorded.

Official reversion requires SHARED_DB_AUTHOR_ENGINE=codex and
SHARED_DB_SESSION_ID=01a11d67-cd73-7ce0-9cb6-6fde00882486; command
node scripts/manage-migration-author-lanes.mjs --reversion-active-claim
--issue4111 --claim-number4112 --pr4118 --owner codex/orderlist-sheets-integration
--branch codex/orderlist-sheets-integration --worktree actualownpath
--old-version actualold --head-sha actualcleanpublishedhead.
Old claimowner is legacyalias, not UUID; ordinary prepare-preview default works,
explicit --claim-number ownerSessionUUID assertion would fail. Do not rewrite
claim fences to make a gate pass. Current supersession54834→73649 durable
SHAa187dd963a6080cf379acb37c1f2f1f08203b423; old35313→54834historical preserved.

## 7. Constraints and gotchas

Plan11 covers branch/schema/production gates. No dependent app source before
backend merge. No manual productionDDL, promotionholdrelease, anon/RLS
broaden, canonical row creation or live server edit. Technical reviews belong
to assigned AI reviewers, never ownerapproval. Normal app PR merge authorized;
all created PRs attach to this task. Never touch concurrent #277source-refresh
script/rootHANDOFF/foreignhandsoff. One appneedissue281, same-issue proofbox.
Human times EDT. GitHub signature Posted by Codex chat
01a11d67-cd73-7ce0-9cb6-6fde00882486 on hetz. Reversible local choices proceed.

## 8. Access and environment

Plan12 supplies authenticated gh, credentials by1Passwordlocation, browser
runtime, production/previewtargets and protectedsource. Scratch
/tmp/tmp.ptGk0ACD5D has reports/source-capture helpers/private browserstates;
permissions700directory/600sensitivefiles. Serialized op_run, never secret
arguments/logs. Productionpooler transactionport5432; readonly6543.
Preview lastverified mvpkijzfmfcxhnzqogzs mustrefreshbeforeanywrite. RetiredOhio
ryltkzzernhwnojzouyb default MCP is wrong. Native event-aware ai-pr-wait
/usr/local/bin uses reviewer-approval actualreport. Repositorylocal gates are
required and protect strongeractions; do not weaken them.

## 9. Risks/open questions/self-audit

Delivery frozen externally until Claude's hold clears/expires; owneractivity
beyond3:37AMEDTunverified. Source/backendship/review/liveproof allstillopen.
No background execution is promised. Nativecalendardateforecasts may differ
from historicwhole-columnANDbug; rowwise honeststatus is locked. Current
manualworkflow edits retain sourceauthority.Threehelddivisionlines(#275) and
12referencedmissingPOs(#277) are not solved by fabricateddata. Risk of main
moving requiresfresh exactheadreview/bundle/reservation. Full deliverablelist
is planSTATUS, allopenuntilactualgateproof. Selfaudit: all10sections present;
reciprocalplan; freshsession has goal/state/deadends/nextgates/access/owner
questions; secretvalues absent; rootpointer untouched. PASSED4:02AMEDT.
