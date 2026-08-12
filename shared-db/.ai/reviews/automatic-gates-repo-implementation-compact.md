Implement the already-approved provider-neutral automatic production gates. Do not re-explore or redesign.

Allowed files only:
- scripts/production_apply_review_reference.py
- scripts/test_production_apply_review_reference.py
- scripts/verify_production_apply_prerequisites.py (new)
- scripts/test_verify_production_apply_prerequisites.py (new)
- .github/workflows/shared-supabase-migrations.yml
- AGENTS.md
- docs/production-promotion-app-tolerance-contract.md

Required behavior:
1. A production review evidence file under .ai/reviews must use a simple dependency-free structured format and require exact full commit SHA, exact ordered allowlist, verdict APPROVE, non-empty reviewer identity, reviewer_type in model|human|agent, preview_rehearsed true, preview_outcome APPLIED, and preview_project_ref rjyboqwcdzcocqgmsyel. URL-only references fail. Fail closed on missing/wrong fields. No specific provider/model field or name.
2. New pure Python prerequisite verifier reads branch-protection JSON and check-runs JSON files. Require enforce_admins.enabled=true; require the repo's exact required check names all success on the exact requested SHA; fail on missing, duplicate-conflicting, wrong-SHA, pending, or failed checks. No network inside this script.
3. Workflow production-apply-review fetches those two JSON documents read-only with the minimum GitHub permissions, calls the verifier, validates the evidence file, keeps exact-main/allowlist/ledger/bounded gates, and fails loudly. Keep environment: production. Rename owner-click wording to automatic gates. Do not modify preview or DB behavior.
4. Record the 2026-08-12 owner ruling in AGENTS.md and production contract: remove the owner click only after repo PR/CI/dry-run proof; durable contract is provider/model-neutral.
5. Comprehensive offline tests. Preserve existing negative tests. Search CHANGED durable files for GLM, Z.ai, ai-glm, and model pins; zero new matches.

Do not touch migrations, SQL, catalog verifier, migration guard, Supabase, GitHub environment/API, secrets, or cloud resources. No network. Run directly relevant Python suites and static workflow/SQL checks. Return patch/report.
