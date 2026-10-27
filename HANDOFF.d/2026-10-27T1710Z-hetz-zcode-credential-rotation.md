# Handoff — credential rotation (leaked sb_secret), issue #551

1. **Scope**: rotate the Supabase sb_secret leaked into a transcript on 2026-10-27; repair three stale AI tester logins; plan `plan_credential_rotation_20261027.md` (v5).
2. **State**: plan written after four AI review rounds (glm failed infrastructurally — logged; muse REJECT on unrelated committed screenshots — fixed by PR #550; stepfun and deepseek REJECTs produced the v2–v5 corrections). All findings incorporated; no APPROVE yet.
3. **Stage A (ready to execute on APPROVE)**: reset tester passwords via GoTrue admin; create new sb_secret via Management API; update edge secret; run the five-function probe matrix. No revocation — worker DB path provably untouched.
4. **Stage B (blocked)**: revoke only after Railway env confirmed/updated. Both Railway API tokens in 1Password item "Railway API" are rejected (re-verified 2026-10-27); refreshing them needs Railway browser SSO. Track on issue #551.
5. **Credentials**: 1Password vault `vibe_coding` — "Supabase Runtime Keys - shared POP database (production)" (SUPABASE_SECRET_KEY leaked; legacy JWT alive for PostgREST/edge only); "Supabase CLI Personal Access Token" (field `credential`, works, Management API read-verified).
6. **Artifacts**: review reports under `.ai/reviews/` (muse/stepfun/deepseek plan-reviews 2026-10-27); ai-reviewer-issue record `20261027T162953Z-hetz-glm-171692`.
7. **Next action**: send plan v5 (commit on branch `zcode/credential-rotation-plan-20261027`) to the next rotation reviewer; on APPROVE execute Stage A and update issue #551.
8. **Do not**: revoke the leaked key before Railway's env values are confirmed; retry the glm reviewer this session.
