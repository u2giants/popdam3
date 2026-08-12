Implement the permanent 2026-08-12 owner ruling in this isolated shared-db sandbox.

Read AGENTS.md, the corrected final turn in the existing automatic-production-gates-plan review transcript/report, .github/workflows/shared-supabase-migrations.yml, scripts/production_apply_review_reference.py and tests, the production promotion contract, and directly relevant workflow tests.

Goal: remove reliance on Albert/u2giants manual production approval by adding enforceable automatic gates. Durable code, docs, tests, comments, evidence schemas, workflow configuration, and secrets MUST be provider- and model-neutral. Do not name, require, pin, or assume GLM, Z.ai, ai-glm, or any specific model/provider. GLM is only the implementation worker in this temporary session.

Implement the corrected plan's repository changes:
- exact-dispatch-SHA required CI verification using GitHub check-run evidence;
- live main branch-protection verification, including enforce_admins and the exact required contexts;
- a provider-neutral committed independent-review and preview-evidence contract under .ai/reviews, requiring explicit APPROVE, non-empty reviewer identity, categorical reviewer type, exact full commit SHA, exact ordered allowlist, preview APPLIED outcome, and preview project ref rjyboqwcdzcocqgmsyel;
- URL-only review references must not satisfy the production gate;
- workflow wiring with only the read permissions needed;
- loud fail-closed behavior and comprehensive offline tests;
- durable owner ruling in AGENTS.md and the canonical production contract.

Strengthen binding beyond the plan where needed: require exact full SHA equality and exact ordered allowlist equality. Do not accept a short SHA or merely one matching migration version for the new evidence schema. Use a simple, dependency-free structured format that Python can parse reliably in CI. Do not create a provider-specific schema field. Do not special-case B3 or any migration/table.

Do not change production SQL, migrations, catalog verifier, migration guard behavior, Supabase data, GitHub environment settings, secrets, or any cloud resource. Do not run network calls. Do not remove environment: production. Do not weaken existing checks. Keep the existing production dry-run path read-only.

Run all directly relevant unit/offline workflow tests and repository SQL checks. Return a patch and report exact files/tests. Before finishing, search every changed durable file for GLM, Z.ai, ai-glm, and specific provider/model pins; the result must be zero except historical text outside your diff, which you must not edit.
