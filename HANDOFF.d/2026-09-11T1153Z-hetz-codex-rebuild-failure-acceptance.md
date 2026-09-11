---
issue: 123
status: OPEN
owner: codex/route-01a08c32-d945-7ee1-8862-2b10de84e5e2
---

# 0. Decisions only the owner can make

None — nothing in this workstream needs Albert's decision. The remaining step is a timed verification after the ordinary nightly rebuild. Do not ask Albert to approve another test, rerun #124, choose an alert destination, or merge anything.

Already settled — do not re-ask:

- On 2026-09-11, the delegated acceptance explicitly required the existing alert destination, aggregate-only evidence, no database DDL, no fabricated history, and no unsafe production failure injection.
- The verified #124 production success is success-only evidence and must not be presented as failure or email-delivery proof.

# 1. What this application is

PopDAM is POP Creations' internal licensed-art digital asset manager. The React frontend runs at `https://dam.designflow.app`; the Railway worker in `apps/worker/` performs durable background operations against the shared production Supabase project `qsllyeztdwjgirsysgai`.

This handoff concerns `rebuild-style-groups`. PostgreSQL cron job 7 only queues that work, while the Railway worker performs it. Immutable terminal outcomes are stored in `public.bulk_operation_runs`; failure alerts go through the `bulk-operation-alert` Supabase function to `hello@popcre.com` via Brevo.

# 2. What we set out to do this session, and why

The shared-db orchestrator formally delegated the remaining application acceptance for `u2giants/popdam3#123`, inherited from closed issue #117. The required production story is:

1. Deliberately fail a real worker run while cron job 7 remains `succeeded`.
2. Prove the normal alert was delivered.
3. Prove the failure remains after a later successful rebuild.
4. Prove the later success uses a new, non-duplicated run ID.
5. Publish only aggregate operational evidence.

The immutable-history schema from `u2giants/shared-db#2439` and migration `20260910123601` was already deployed before this session. No structural database work belonged here.

# 3. Current state — what is true right now

Completed and production-verified on 2026-09-11:

- The existing bounded negative path was inspected in `supabase/functions/admin-api/index.ts:596` and `apps/worker/src/operation-loop.ts:672` (line numbers may shift on later main). `update-bulk-op` requires admin/service-role authentication and applies cross-lane guards. A `rebuild-style-groups` state without a cursor is rejected by the worker's `legacy_format` guard before dispatching the rebuild handler.
- Production target `qsllyeztdwjgirsysgai` was validated immediately before the application-state write using protected 1Password injection.
- Fresh run `c8925378-46c2-4669-9119-34f0c13150c1` followed the real worker terminal path and produced exactly one immutable row with `status=failed`, `source_status=failed`, and `reason_code=legacy_format`. The mutable `admin_config.BULK_OPERATIONS` state matched the same run ID and failed status.
- The earlier completed row remained present. Cron job 7's latest enqueue remained `succeeded` before and after the worker failure; it ran from `2026-09-11T02:00:01.550456-04:00` through `02:00:01.592741-04:00`.
- Production function logs show the matching email sent to `hello@popcre.com` and accepted by Brevo at `2026-09-11T11:51:15.003Z`, including a provider message ID. Do not publish the message ID unless needed; the issue comment records delivery without it.
- Aggregate evidence is in `u2giants/popdam3#123`, comment `https://github.com/u2giants/popdam3/issues/123#issuecomment-5634026816`.
- #124 was not rerun and was not used as failure/email evidence.

Still open:

- A success must occur after the deliberate failure. Allow the next ordinary cron-triggered rebuild (expected after cron job 7 queues it at about 02:00 America/New_York on 2026-09-12) to finish. Then prove its new completed row has a distinct unique run ID and the failed row above remains.
- Only after that proof may #123 close and its final aggregate evidence be returned to `u2giants/shared-db#2439`.

Repository state at handoff drafting: local `main` was fast-forwarded/rebased to `origin/main` at `62634d93`; the only intended repository change is this handoff file. No app code was changed. The relevant terminal-history worker code was already deployed as part of production lineage containing `4136a208c9ef53aab0ea169ae7df798cd3f4302b`; the alert function lineage contains `50c6818408a99a69f5e85029ba48b7270bba5876`.

# 4. Everything tried that did not work

- Initial `gh` and 1Password calls failed because the first execution sandbox prohibited outbound DNS and GitHub writes. This was an environment restriction, not an authentication defect. After the environment changed to unrestricted networking, canonical CLI access worked; do not rotate credentials.
- A GitHub connector write attempt was rejected because that connector required interactive approval while the task's approval policy was `never`. The authenticated `gh` CLI worked once networking was restored.
- Querying Brevo's `/v3/smtp/statistics/events` for the mailbox returned no recent events, and `/v3/smtp/emails` also returned no matching message. Those endpoints were not used as proof. Supabase production function logs provided authoritative evidence that the alert function received the matching run, Brevo returned a message ID, and the function logged `delivered`.
- The prior #124 success occurred before the deliberate failure, so it cannot satisfy “failure retained after later success.” It remains valid success-path proof only.

# 5. Root causes and key findings

- Cron job 7 measures only enqueue success. Its green result can coexist with a failed Railway worker run; the new failure proves this exact monitoring gap in production.
- The safest negative route needs no new code or test-only production switch. The operation loop's missing-cursor compatibility guard fails before `dispatchBatch`, so it exercises normal terminal recording and alerting without clearing assets or deleting/rebuilding style groups.
- `appendTerminalRun` in `apps/worker/src/terminal-outcomes.ts` inserts the immutable history row; `alertTerminalFailure` posts only after a failed terminal outcome. The deployed `bulk-operation-alert` function returns 2xx only after Brevo accepts the message, so its `delivered` log is meaningful delivery evidence.
- The remaining acceptance is chronological, not technical: a later ordinary rebuild must succeed after failure run `c8925378-46c2-4669-9119-34f0c13150c1`.

# 6. Exact next steps

1. After the ordinary 2026-09-12 nightly rebuild has had enough time to finish, read production `public.bulk_operation_runs` for `operation='rebuild-style-groups'`, ordered by `ended_at desc`. Verify a `completed` row ended after `2026-09-11T11:51:15Z`, has a run ID different from `c8925378-46c2-4669-9119-34f0c13150c1`, and appears exactly once. You will know it worked when one post-failure completed row exists with a unique new ID.
2. In the same read, verify failure run `c8925378-46c2-4669-9119-34f0c13150c1` still exists exactly once with `status=failed`. You will know retention worked when both rows coexist.
3. Read `admin_config.BULK_OPERATIONS -> rebuild-style-groups` and reconcile it to the new completed row's run ID/outcome. Read cron job 7's latest `cron.job_run_details` row separately. You will know the full story is consistent when worker history and mutable state match while cron records only its enqueue result.
4. Add one aggregate-only comment to `u2giants/popdam3#123` naming the two run IDs, statuses, terminal timestamps, duplicate counts, and cron status. Include no licensed rows, secrets, raw payloads, or private URLs. You will know the evidence is complete when all five delegated criteria are explicit in that comment.
5. Close PopDAM #123. Add the same concise acceptance summary to `u2giants/shared-db#2439` for its audit trail; do not claim or alter unrelated shared-db #2440 counts-chain work. You will know the application handoff is complete when #123 is closed and #2439 links to the final proof.
6. Delete this handoff file in the same normal PopDAM main-branch commit that records closure housekeeping, stage only this path, push, and verify the commit is on `origin/main`. You will know cleanup worked when this file is absent from main and the worktree is clean.

# 7. Constraints and gotchas in force

- Do not add shared-db DDL, migrations, functions, triggers, policies, or fake `bulk_operation_runs` rows.
- Do not inject another production failure. The required negative test is complete.
- Do not rerun or reinterpret #124. Its success proof is already valid and separate.
- Use production project `qsllyeztdwjgirsysgai`, never retired Ohio `ryltkzzernhwnojzouyb`. Prove the ref immediately before every write.
- Use protected 1Password injection and never expose secret values in shell arguments, output, docs, issues, or commits.
- Evidence must remain aggregate-only: statuses, run identifiers, timestamps, counts, and delivery state.
- Preserve concurrent work: inspect status first, stage only owned paths, fetch/rebase rather than reset or force-push.
- Do not close #123 until the post-failure success and uniqueness/retention checks actually pass.

# 8. Access and environment

- Working repo: `/worksp/popdam`, branch `main`, direct-to-main policy.
- GitHub CLI was authenticated and working at the end of the session for `u2giants/popdam3`.
- 1Password vault: `vibe_coding`.
- Production Supabase runtime item ID: `3hhxwrljnaq2tykxi7hplq5ryi` (contains project ref, URL, and service role key). Use `op run` or another protected injection method; never copy values.
- Supabase Management API token item ID: `3t2xoqk5luyz7ffgdhj24gvtpq`. It was used only for read-only production log evidence.
- Brevo credential item ID: `ksuxfzn73xtpll3uyfb2islzze`; direct event endpoints did not return useful evidence and should not be preferred over function logs.
- Shared-db orchestrator marker was `u2giants/shared-db#2714`, owned by another session. This session was an application delegate, did not mutate shared-db, and must not close that marker.

# 9. Open questions and risks

- Timing risk: the nightly rebuild can take hours. Do not judge absence of a completed row immediately after the 02:00 enqueue as failure; inspect live operation state and allow the established runtime window.
- If the next ordinary run fails, retain both failure rows, verify its alert separately, and diagnose through PopDAM #123. Do not manufacture a success or close acceptance.
- Counts-chain work in shared-db #2440 is separately owned by orchestrator #2714. Do not couple it to this application acceptance.
- No owner question is open. The next session should execute the timed verification without an approval loop.

## Final self-audit

1. **Yes, a new developer can continue without questions.** Sections 1–3 define the system, goal, deployed state, exact production evidence, and the one remaining gate; section 6 gives executable ordered steps.
2. **Yes, the file preserves all session knowledge needed to continue equally effectively.** Sections 4–5 capture failed approaches and the non-obvious safe negative path, cron distinction, alert semantics, and chronology constraint.
3. **Yes, every execution dimension is covered.** Sections 2–9 include intended outcome, current state, failures, findings, constraints, access, exact next actions, proof requirements, and risks.
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of sections 1–9 found no unresolved owner judgement; the settled instructions are consolidated in section 0 so they are not re-asked.
