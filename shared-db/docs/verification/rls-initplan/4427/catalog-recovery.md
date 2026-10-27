# Applied admin-policy catalog verification recovery

Issue #4867 owns this verifier defect; structural outcome and consumer acceptance stay on #4427.

PR #4565 merged migration `20261021190604`. Production run [39711410818](https://github.com/popcre/shared-db/actions/runs/39711410818) applied it, then failed its enforcing catalog verification because the lexer derived no catalog object from ALTER POLICY. The original failed result remains failed. Do not reapply or edit the migration.

Bootstrap PR #4871 registered the fixed verifier-owned `rls_public_admin_install_v1` contract. That first delivery added no active sidecar or registry entry. Its temporary synthetic-sidecar tests exercised the existing loader without activating recovery. The separate activation delivery described below adds the migration-hash-bound sidecar only after that definition actually merged into protected main. It preserves the complete historical #4427 catalog snapshot: 44 rewritten policies within 72 overlapping identities, OIDs/commands/roles/permissiveness/expressions, 39 table/column ACL/owner/RLS snapshots, both helpers and archive zero-callers. Exact-expression checks fail closed on any other drift.

Merged PR #4674 subsequently wrapped auth.uid() in three overlapping ownership USING expressions. Only when version `20261023122936` is present does the contract expect precisely those three expressions. It does not accept arbitrary successors or both forms simultaneously. The original #4427 probe and all historical evidence remain unchanged. This composition is explicitly final catalog state, not a claim that the original apply produced later changes.

After BOTH bootstrap and the separately reviewed activation delivery merge, the parent may use the existing **Production Catalog Verification Recovery**, mode `legacy-catalog-failure`, with fresh current `main_sha`, `apply_main_sha=3c3b0a6d8a172846bcf0d25a0f907da8328d664c`, `ordered_allowlist=20261021190604`, `apply_run_id=39711410818`, and `apply_artifact_digest=sha256:63e36cf323badaf76ad61304d2d77ca707b01e11f937b01ba345a3e28a2949e0`. The original apply artifact is `12396579130`. Re-prove these mutable artifact/main facts before dispatch. The recovery verifies ledger transition, current ledger and catalog without applying SQL.

Passing proves catalog state only. Current advisors, representative authenticated before/after plans, safe owning-app live writes/readback/cleanup, and the same issue’s acceptance checklist remain required. No production recovery was dispatched by this source change.

Local source validation: six focused contract/synthetic-sidecar tests, 262 existing catalog-verifier tests, 11 recovery-evidence tests and 16 sidecar-guard tests passed. The existing SQL guards and sidecar inventory validator passed. PostgreSQL 16 executed the complete fixed contract on a clean disposable catalog and returned false, proving absent installation is rejected; this local check is not production evidence. The detector inventory baseline changed only its required source digest, without changing historical inventory or enforced versions.

## Two protected deliveries

The initial combined PR was correctly refused by protected merge [40439423469](https://github.com/popcre/shared-db/actions/runs/40439423469): the trusted main verifier did not yet recognize `rls_public_admin_install_v1`. That refusal and the prior source remain preserved. The protected workflow intentionally reads verifier code from main and candidate sidecar data from the PR.

1. PR #4871 bootstraps only the fixed definition, inert synthetic tests, required detector digest and this document. No live sidecar, registry declaration or recovery dispatch is included.
2. Only after the bootstrap actually merges, publish a prospective successor contract from fresh main on the same maintenance issue #4867, then author a separate PR activating the exact migration-hash-bound sidecar plus registry entry and activation tests. Its independent review, required CI and protected merge remain mandatory.

Recovery and wider #4427 live acceptance remain pending; neither source phase closes them.

## Activation delivery

Bootstrap PR #4871 actually merged as `d3c3cd0f5f18ff954a3e7b3fa531392529f8b8db`. A prospective generation5 contract on the same maintenance issue #4867 now scopes the separate activation delivery from that protected main. This delivery adds the exact immutable-migration-hash-bound sidecar and one registry declaration, and replaces the bootstrap-only absence assertion with strict actual sidecar/registry activation assertions. The fixed verifier definition, snapshots, historical proofs, migration and detector baseline are unchanged.

No recovery has been dispatched and no new successful production result is claimed. After protected activation merge, the parent must re-prove the documented immutable apply artifact and fresh main before invoking existing verify-only recovery. Issue #4867 stays open until that recovery is proven; #4427 remains open for its separate live application acceptance.
