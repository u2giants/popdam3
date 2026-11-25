---
summary: Plans written 2026-11-25 for the dead-code / duplicated-code review findings and agent-api lookup batching (#769, #851, #857, #998, #1208, #1221); #1213 closed as fixed.
kind: handoff
status: open
read-when: picking up any of issues #769, #851, #857, #998, #1208 or #1221
---

# Handoff — dead-code and duplicated-code review-finding plans (2026-11-25)

Written by a Claude Code session on `al8960ofc`, started by the plan-coordinator session for "every open issue gets a comprehensive plan". **Plans only — nothing was implemented.** Each plan's STATUS table is the source of truth; read it first.

## Open plans (one per issue group)

| Issue(s) | Plan | What remains |
|---|---|---|
| #769 | [issue-769-retired-route-doc-leftovers.md](../docs/plans/issue-769-retired-route-doc-leftovers.md) | Two stale doc statements about the removed Helper `/logs` route and `sync-external` |
| #851, #857 | [issue-851-857-duplicated-code-followups.md](../docs/plans/issue-851-857-duplicated-code-followups.md) | One NAS-config hook, six missing test files, one unused import, one duplicate test import, #708 plan STATUS |
| #1208 | [issue-1208-validator-test-proof.md](../docs/plans/issue-1208-validator-test-proof.md) | Identity assertion and named cases in the validator test |
| #1221 | [issue-1221-check-in-fingerprint-hardening.md](../docs/plans/issue-1221-check-in-fingerprint-hardening.md) | Fingerprint fails closed on a file changing mid-read; Helper shared-import guard |
| #998 | [issue-998-agent-api-lookup-url-budget.md](../docs/plans/issue-998-agent-api-lookup-url-budget.md) | Measure real URL length for check-changed and hygiene lookups, shared tested helper |

## Closed in this session

- #1213 (review of PR #1209, shared operation policy): both visible findings fixed on `main` — `src/test/operation-registry-sync.test.ts` now parses `apps/worker/vendor/operation-policy.js`, and `publish-frontend.yml` paths include `supabase/functions/_shared/operation-policy.{js,d.ts}` (commits `f5829540`, `b7dcbfbf`). The review text was truncated after finding 2; the tail is unrecoverable.

## Facts a successor would otherwise rediscover

- Review-finding issue bodies are truncated by the review tool; the full text is not in the PR comment or the workflow log. Plans cover the visible findings and re-verified each against `origin/main` `787c20b8`.
- #708 is closed but its plan STATUS was never updated; the #851/#857 plan Step 7 fixes that.
- The "duplicate import is a SyntaxError" claim in #857 is false for this toolchain (CI run 45695969527 ran those tests green).
- Since #1117 a failed check-changed stalls and then fails the scan instead of reprocessing everything — the reason #998 still matters.

## Next step

Pick any plan above and run its lead launch prompt. They are independent; #851/#857 and #998 both touch edge functions but different files.
