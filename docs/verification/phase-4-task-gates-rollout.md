# Phase 4 task-gate rollout evidence

Issue `popcre/ai-devops#335` adds repository-local routing policy and executable refusal evidence. The policy protects PopDAM browser, worker, agent, edge-function, release, and shared-database paths without changing application, database, runtime, host, or deployment behavior.

## Required evidence

- `bash scripts/test-task-gates.sh`: 16 passed / 0 failed. It verifies representative classifications, normal code shipping, database escalation refusal, failed acknowledgement and owner-request bypasses, and byte-exact rollback restoration.
- `.github/workflows/task-gates.yml` repeats that proof on pull requests and `main` using the public accepted task-gate engine pinned by commit.
- Existing shared-database guards remain independent and unchanged.
- `npm run lint -- --quiet`: passed with zero findings.
- `npm run build`: passed; 2,839 modules transformed.
- The full Windows run passed 313/315 tests. One existing registry assertion compares LF text against the CRLF checkout, and one export test exceeded its five-second parallel-run timeout; that export file passed 5/5 alone in 1.06 seconds with a 15-second ceiling. GitHub CI remains the clean Linux application proof.

The engine chooses the strongest matching class. Browser paths retain authenticated visual proof and full rulebook treatment. This rollout changes no browser, worker, agent, or function source path, so their runtime proofs are not required for this candidate.

## Release boundary

Railway rebuilds the production worker after every push to `main`, regardless of path. This rollout does not authorize production deployment, so its reviewed pull request must remain unmerged until that release is explicitly authorized. No database, runtime, host, infrastructure, or production action is part of this change.
