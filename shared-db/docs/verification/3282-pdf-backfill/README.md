# PDF backfill repair evidence (3282)

`catalog-before.json` is a catalog-only production read captured 2026-09-20 through the proved `supabase_read_only_user` identity at the recorded project URL. It contains no application rows or secrets; all three routine bodies were inspected before publication.

The live helper requires `p_file_type = 'pdf'`, then a non-null licensing-sheet/tech-pack filename. The captured claim/count bodies both invoke that helper with `file_type::text`. Therefore neither currently includes AI files: the old May extension was superseded by the June licensing-PDF scope migration (`20260610070731`), which is retained as a ledger marker. The later search-path pin (`20260813020000`) is also preserved. Both are declared as derivation bases.

The new equality on the enum plus constant-`pdf` helper is the same predicate for every enum value. Production `file_type` and `filename` are NOT NULL; tests additionally compare SQL truth values over null/non-null types and filenames without inserting invalid rows. `is_deleted = false` remains unchanged, including its treatment of NULL.

The capture records existing signatures, defaults, result shapes, volatility, security-definer status, search path and ACLs. CREATE OR REPLACE retains those ACLs; no GRANT/REVOKE appears. Sample lookup already has UNIQUE(asset_id).

`local-proof.txt` records a disposable PostgreSQL18 behavioral execution and a synthetic100000-row plan with100 licensing candidates,98 completed. It proves local behavior and candidate-index use, not production or cold-cache timing. Production-sized preview rehearsal must measure both migration lock/build time and claim/count latency under the existing8s ceiling. Cold disk-cache behavior cannot be inferred from a fresh connection alone.

The completion record intentionally binds the implementation commit. The later evidence-only commit changes exactly `.agent/contract.json` and `.agent/completion.json`. This is required by `scripts/agent-work-contract-git-evidence.mjs` (`verifyGitEvidence`), so replacing its `head_sha` with the tip would violate the evidence contract. The original published contract remains immutable; generation3 expands only this evidence's allowed paths.
