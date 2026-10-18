---
issue: 4421
status: BLOCKED
owner: codex/rls-baseline-01a14fa2
---

# RLS continuation: publication, live baseline, protected custody

## 0. Business decisions only the owner can make

None. Albert's October 18, 2026 instruction authorizes resolving publication #4425,
then #4426–#4430 respecting their dependencies, preserving existing permissions and
requiring live verification before closing each repair. No technical approval or
manual command is owed by Albert. This session does not authorize unrelated #2421
or #2419 remediation or release another session's protected claim.

## 1. What this application is

POP applications share Supabase PostgreSQL; canonical structure belongs to
[shared-db](https://github.com/popcre/shared-db). There is no application runtime
here. Verified production API is https://qsllyeztdwjgirsysgai.supabase.co . Preview
is resolved from current repository variable PREVIEW_PROJECT_REF, never a stored
literal. CRM, DAM, PM/PIM, PopSG and DesignFlow consume this structure.

## 2. Goal and trigger

Resume the original [PR #4423](https://github.com/popcre/shared-db/pull/4423) and
[implementation plan](https://github.com/popcre/shared-db/blob/61517ebd5d682bdc5844bfd90d33e23ba2f9876d/plan_rls_request_constant_checks.md).
Reduce unnecessary repeated permission work for all 69 baseline policies on 49
tables while preserving the exact allow/deny/error behavior. Original controlled
helper timing improvements are not application or role-enforced performance proof.
The original [handoff](https://github.com/popcre/shared-db/blob/61517ebd5d682bdc5844bfd90d33e23ba2f9876d/HANDOFF.d/2026-10-18T1421Z-edge-dev3-codex-rls-performance-plan.md)
retains the earlier planning/dead-end context. Do not silently replay its idle state.

## 3. Current state and evidence

Snapshot: October 18, 2026, 11:47 AM EDT. Publication and baseline PRs may advance
after this snapshot; the final signed successor comment on
[parent #4421](https://github.com/popcre/shared-db/issues/4421) records their actual
merge commits. Re-read it and the live PRs before editing or closing anything.

[PR #4433](https://github.com/popcre/shared-db/pull/4433) is the supported fresh
publication operation for #4425. It adopts the five original candidate files
unchanged after publishing a prospective contract for adoption/validation/landing.
Original authorship predates the contract and is explicitly NOT covered.
Contract refs/db-contracts/4425/1 is pinned to
720dccd7ecafacd1ff3986d40bb7af5135ff9c8c, digest
ba5532f84cc68a78969af82d8cf1dbf825a81c22338c496b2bce9a268d1d9f74.
Implementation adefd8f96, evidence head dc3ea974242aa3a23147d517c864ddf06e069be4.
Canonical completion validation passed; allocator sequence 6713 assigned glm-5.3.
The governed review produced genuine exact-head APPROVE and durable verdict
refs/db-review-verdicts/4425-4433-dc3ea974242aa3a23147d517c864ddf06e069be4,
commit dc388f69fea3565424b3ec4f91158e76fe7c9faa.

That first review lacked tests recorded in its lifecycle, so the installed ship
gate refused it despite separately passed local checks. A supported ai-review glm
final-check with the same exact source plus --tests was submitted; consult the
parent's final comment for its terminal report/result. Do not retrofit test proof
onto the old review. Preserve both genuine records.

[PR #4434](https://github.com/popcre/shared-db/pull/4434) carries #4426 read-only
preparation. [Manifest](https://github.com/popcre/shared-db/blob/codex/rls-baseline-01a14fa2/docs/verification/rls-initplan/2026-10-18-refresh/manifest.md)
links all raw evidence, four exhaustive family manifests and test specifications.
All 69 identities and expression fingerprints match the original baseline;
49 tables, 93 overlapping policies, 46/17/4/2 families; no newly admitted scope.
Eighty-eight actual authenticated read-only plans succeeded with zero errors.
No production rows, credential values or subject identities are published.

No database repair, migration/version reservation, exact-object claim, preview
fixture/apply or production write was started. No subagent was spawned. All four
repair outcomes and parent #4421 remain open until their own live acceptance.
Broader #2326 is unchanged. Source publication is never database application.

## 4. Failed or rejected approaches

- Do not fabricate a contract for the original already-written plan. The fresh
  task is explicit prospective adoption/validation/publication; it is not
  retroactive authorship. No guard, registry or route exemption was changed.
- Reviewer assignment initially refused without exact issue/head, then without
  deterministic ready repository-maintenance scope. Correct issue #4425 scope and
  canonical evidence resolved those admission failures without database claims.
- The first genuine GLM review had no tests recorded in its lifecycle. Local ship
  refused it. A shell sequence inadvertently submitted guarded run 39141832917
  after the refusal; it was immediately cancelled. Its sole merge job finished
  CANCELLED. No merge or database mutation occurred through that attempt.
  Use fail-fast command sequences; never run an action after a failed gate.
- Directly injecting old local test results into a completed review would falsely
  claim before-dispatch evidence. A fresh test-bearing supported review is required.
- MCP SET LOCAL ROLE authenticated refused with SQLSTATE 42501. Preserve that
  read-only role restriction. The documented direct pooler route supplied the
  actual role-enforced read-only tests, not a weakened MCP role.
- Default system CAs did not trust the provider database certificate. Added only
  the official provider CA to this process, preserving rejectUnauthorized=true and
  hostname checks. Never disable certificate verification.
- Both #4434 documentation authorization attempts refused under another session's
  promotion freeze. Failed runs 39141815507 and 39141820305 preserve the exact
  refusal. The existing bounded PR waiter was not run: task gates refuse pr-wait
  for prose (no wait gate). Do not bypass that refusal by polling.
- Do not delete/expire/steal claim #4158 or pretend dflow.user_roles is the same
  object as public.user_roles. Expiry does not release custody.

## 5. Root causes and key findings

Publication conflict is satisfiable through a genuine new publication task with
canonical prospective evidence and independent exact-head review; no toolkit or
gate change was necessary. The first local-tests gate needs tests recorded by the
review harness before dispatch, not just a separately passing author test log.

The [live baseline](https://github.com/popcre/shared-db/blob/codex/rls-baseline-01a14fa2/docs/verification/rls-initplan/2026-10-18-refresh/actual-query-plans.md)
uses one warmup plus ten measured samples per four actual SELECT count shapes and
two internally selected existing user contexts. Each proved authenticated,
rolsuper=false, rolbypassrls=false, transaction_read_only=on; tables owned by
postgres. Every transaction rolled back. Contexts use only subject and
role=authenticated claims, without email/app-role JWT claims; this is not a full
application token/permission equivalence test. Real DML fixtures and all hostile
claim/role combinations remain implementing-child work.

[Collision proof](https://github.com/popcre/shared-db/blob/codex/rls-baseline-01a14fa2/docs/verification/rls-initplan/2026-10-18-refresh/collision.md):
ALTER POLICY emits BOTH policy and table identities. Protected
[claim #4158](https://github.com/popcre/shared-db/issues/4158) holds public.assets,
public.style_groups and public.style_group_tags in #4427's exact 46-policy family.
Owner codex/01a12d90-cce8-7131-b1eb-eff6becc806e-2421; capacity relinquished,
blocked_on issue:#2421, recorded worktree clean. Claim last changed October 12,
2026, 7:58 AM EDT. Owning #2421 remains open, last updated October 18, 2026,
9:59 AM EDT; worker activity unverified. Neither age nor clean state releases it.
#4107 concerns dflow.user_roles and is not a public.user_roles collision.

Publication is also held by a separate promotion freeze owned by Codex chat
01a14f42-9919-77a1-b9c9-3b1d6883d66f on edge-dev3 for PR #4418, issue #2336.
Snapshot expiry October 18, 2026, 12:12:46 PM EDT, not release authority.
That owner was freshly active at 11:46 AM EDT and had submitted governed
historical preview recovery 39141975986. Only that owner/current supported cleanup
owns release. Do not modify its work, retry its production or contact it without
explicit messaging authorization.

## 6. Exact next steps and verification gates

1. Read final successor comment on #4421 and live PR #4433/#4434/#4423. Verify
   exact merged heads/commits, review lifecycle/tests and guarded status; do not
   infer merge from checks. Gate: #4425 publication and #4426 preparation each
   have immutable verified results, or their precise existing blockers remain.
2. If publication is still waiting, verify current #2336 freeze and owning run.
   Do not clear a foreign lock. After legitimate release, rerun the supported
   failed authorization or guarded path with the same source if still current;
   refresh/rebind only with existing supported tools when main moved. Gate: all
   publication safeguards pass, no admin bypass, exact intended files on main.
3. For #4427, verify #4158 custody and #2421 current state before claiming any
   overlapping object. Continue only after the existing owner releases/completes
   custody or the supported evidence-backed ownership recovery authorizes it.
   Gate: the entire intended table/policy write set is available and fresh exact
   claims plus reserved forward versions cover it. Do not silently split away
   the original assets outcome or skip this family to start its dependants.
4. Re-read full implementation plan Steps 1–7 for #4427 and use its manifest.
   Fresh structural admission, prospective contract, local/preview synthetic
   before-tests, minimal expression-only ALTER POLICY, independent exact-head
   review, guarded merge, existing merged-main preview/automatic production lane,
   actual catalog/ledger/performance and safe consumer reads/writes. Gate: live
   allow/deny/error equivalence and measured no-regression acceptance on #4427.
5. Only then do #4428, #4429, #4430 in recorded dependency order, each owning its
   complete lifecycle/live proof. Freshly verified dependency edges are
   #4427←4425,4426; #4428←4425,4426,4427; #4429←4425,4426,4428;
   #4430←4425,4426,4429. Gate: each child closes only on its own full live proof.
6. Reconcile all 69 dispositions and parent #4421; update original plan STATUS
   through its required publication safeguards when an actual status change can
   be landed. Do not close broader #2326. Gate: every required outcome is proven,
   no hidden proof debt, handoff retired only with obligations completed/carried.

## 7. Constraints and gotchas

Preserve exact permissions, helper bodies/overloads, grants, RLS flags, names,
commands, OR/restrictive union, implicit WITH CHECK and errors. No role-system
unification, policy consolidation, blanket regex rewrites or warning suppression.
Production stays on governed automatic promotion; no manual production SQL,
fixtures or write benchmarks. Preview/production differ both ways.

One assigned independent exact-head approval; current task classes; claim-first
structural route; fresh exact objects and new reserved versions; exclusive preview,
merge, production lanes; target proof before every write. Database writes themselves
need no second AI, but structural review/merge/promotion gates still apply.
Use dedicated current-upstream worktrees and preserve unrelated sessions. Sign all
GitHub updates with actual chat/machine and label human-facing times EDT/EST.

## 8. Access and environment

Verified gh read/write, production Supabase MCP metadata/advisor reads, protected
1Password injection, documented direct production pooler with actual authenticated
read-only transactions and provider CA verification. Credentials unchanged and
never printed. Original [credential runbook](https://github.com/popcre/shared-db/blob/main/docs/agents/runbooks-credentials-cli-and-gotchas.md)
§9 supplies vault references and supported pooler parameters. Load secrets skill
before use. The production password reference is the existing named item; retrieve
serially. The CA URL is in the official Supabase dashboard
[custom content source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).

Preview credentials/lease/apply, production promotion and safe live application
write-test accounts are NOT verified by these reads. Query settings and raw plans
are tracked, so a successor does not need session scratch to reproduce the baseline.
No durable new tool/script was added. Local reviewer scratch/sandboxes were retained
by their own wrapper; do not clean or rewrite another review's records.

## 9. Risks, unresolved facts and completeness audit

The immediate boundaries are publication freeze and exact-object custody, not a
business decision. The parent final comment is authoritative for later publication
advances. Shared preview cleanliness is UNKNOWN. All production repair and consumer
write acceptance remain unstarted, not implicitly approved by read-only plans.

Retain the original handoff because its #4421 repair obligations remain open; this
file carries successor discoveries/dead ends. Do not rewrite root HANDOFF.md or
silently retire the original. No cleanup of unrelated worktrees/branches is authorized.

Audit: all sections 0–9 present; original plan, baselines, exact PRs/heads/contracts,
failed attempts, authentic review, test-lifecycle gap, freeze owner/time, collision
owner/time, access method, privacy, dependencies, downstream gates, recovery and
all unstarted outcomes are recorded. No technical approval or manual step is owed
by Albert. Final publication/closeout receipts belong on existing parent #4421;
never invent a new proof ticket.

Posted by Codex chat 01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e on edge-dev3


## Successor verification supplement

#4426 preparation landed through PR #4434 at immutable merge commit
https://github.com/popcre/shared-db/commit/255c29c859773a10b7bf9188d63c3fad73de22db .
The native preparation issue closed with that verified merge. The later full-family
collision expansion was committed after the automatic merge had already captured
its earlier head; this follow-up publishes that exact owned evidence, not a second
repair or proof ticket. All 46 policy identities were extracted and the only
protected overlaps are public.assets, public.style_groups and public.style_group_tags
under claim #4158.

The test-bearing GLM review completed APPROVE, run
20261018T154458-1115203-12230, source digest
feeea728d67df29c2bffa2daff8e05975049e27368e17941db3b03fd220acb5d, report SHA-256
be23ab5ee25727262d44025802d38ccde6ba40d95625a6789c8aa8e2aade64a5.
Installed ai-task-gates accepted ship at exact head
dc3ea974242aa3a23147d517c864ddf06e069be4 with implementer=codex and provider=glm.
Its review-session caller label was zcode by the pool default, while the verified
implementing engine remained codex; those are different fields. Future explicit
pool invocation should also pass --caller codex for session isolation.
The genuine governed allocation/verdict 6713 remains the independent repository
approval; no assignment, verdict or lifecycle was forged or altered.

The foreign production run succeeded and its promotion freeze was legitimately
released; a fresh API read returned 404 for the freeze ref. Guarded publication
run 39142597277 then correctly refused when protected main moved as PR #4434
landed: `Protected-main checkout is stale under the merge lock`. No publication
merge occurred in that failed attempt. The same supported guarded workflow was
re-run only after the local ship gate passed again. The parent final comment
records its terminal merge/result.

The claim-owning chat 01a12d90-cce8-7131-b1eb-eff6becc806e was freshly inspected
through the app: notLoaded, latest turn completed, last message explicitly says
“This session remains stopped.” That message concerns a different licensing
handoff-ready receipt and is not authority to adopt or release #4158.
No other chat was messaged.

Installed closeout receipt for actual successor session UUID
01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e returned ok=true,
blocking_claims=[], blocking_stages=[]. No subsequent ownership operation occurred.
This proves no retained database custody, not completed repairs.

Posted by Codex chat 01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e on edge-dev3


## Verified publication completion

#4425 is resolved and closed. PR #4433 merged exact head
dc3ea974242aa3a23147d517c864ddf06e069be4 at
https://github.com/popcre/shared-db/commit/1b90384cf8f9b405a3b6d545502d65bc1c78379f ,
verified from the live PR after guarded run 39142597277 returned SUCCESS. All five
original candidate files were compared against merged source and are byte-identical.
The original PR #4423 was closed as superseded after a signed provenance comment;
its candidate branch/history are retained. The publication blocker is not still
open merely because older snapshots in these handoffs say BLOCKED.

#4426 is completed/closed at PR #4434 merge 255c29c859773a10b7bf9188d63c3fad73de22db.
No structural step is marked done: Steps 1–2 in the original plan also require
implementing-child contracts/custody/preview fixtures, which remain unstarted.
The remaining immediate gate is the authentic claim #4158 collision on the full
#4427 family; no dependent family is ready under the verified issue dependencies.
No claim was inherited, taken, expired away or released by this successor.

This follow-up contains only the full-family collision expansion and this
successor handoff supplement. It carries no database mutation or new work issue.
The parent final comment records the exact follow-up PR/merge result so a
successor need not infer it from an earlier source snapshot. The stopped owner’s
locks, foreign worktrees and original handoff are retained; original #4421 repair
obligations are still open and fully carried.

Posted by Codex chat 01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e on edge-dev3
