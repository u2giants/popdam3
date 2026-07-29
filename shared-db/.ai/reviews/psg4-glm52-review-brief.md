You are an independent senior data-governance and database-safety reviewer using GLM 5.2.

Repository: C:\repos\shared-db
Branch: current local branch
Task: Review the PSG-4 owner decision package and decide whether a nontechnical business owner can safely approve it.

Read these files in the repository:

1. AGENTS.md
2. fix_popsg_property_taxonomy_reconciliation.md, especially PSG-0 through PSG-5 and the PSG-2/PSG-3 records
3. docs/merch-group-taxonomy-architecture.md
4. docs/style-guides-characters-and-royalties.md
5. docs/verification/popsg-property-reconciliation-20260727-psg2/README.md
6. docs/verification/popsg-property-reconciliation-20260727-psg2/batch-01-exact-existing.csv
7. docs/verification/popsg-property-reconciliation-20260727-psg3/README.md
8. docs/verification/popsg-property-reconciliation-20260727-psg3/approval.json
9. docs/verification/popsg-property-reconciliation-20260728-psg4/README.md
10. docs/verification/popsg-property-reconciliation-20260728-psg4/decisions.csv
11. docs/verification/popsg-property-reconciliation-20260728-psg4/manifest.json
12. docs/verification/popsg-property-reconciliation-20260728-psg4/approval-language.txt
13. scripts/popsg-property-psg4-decision-package.cjs
14. scripts/popsg-property-psg4-decision-package.test.cjs

Run only safe, read-only checks and the local PSG-4 test if useful. Do not edit, create, delete, commit, push, deploy, query or write either database, activate decisions, rebuild tags, or start PSG-5.

Check:

- The frozen Batch 01 source still has exactly 51 rows, 44,331 files, and SHA-256 f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e.
- The PSG-4 package hash is reproducible and equals e4ad02fd19491cef12a9a78204e7fca457c0ebefcc5197099e30cd39a64e0f68.
- Every row is a defensible exact existing Property match under the same Licensor.
- Parent proof is real and fail-closed, not self-referential or merely copied without an independent basis.
- Every row has the required disposition, reason, parent evidence, reviewer, and timestamp contract.
- Approval words are narrow and cannot reasonably authorize Batch 02, canonical creates, 6,961 at-risk removals, ambiguous/deferred rows, schema, migrations, database writes, activation, rebuilds, deployment, production, or PSG-5.
- The generator and test cannot silently accept missing, altered, cross-parent, fuzzy, or already-effective rows.
- Any material gap that should stop owner approval.

Required report:

1. Verdict: APPROVE, APPROVE WITH CONDITIONS, or DO NOT APPROVE.
2. Plain-English reason for a nontechnical business owner.
3. Findings by severity: Critical, High, Medium, Low.
4. Exact checks performed and evidence.
5. Residual risks.
6. Whether the exact approval sentence is safe to send now.
7. One clear recommended next action.

Do not defer merely because the owner is not a programmer. Make the technical safety judgment yourself and clearly separate technical approval safety from business authority.
