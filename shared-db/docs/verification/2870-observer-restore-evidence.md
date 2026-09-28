# Issue #3614: read-only observer restoration evidence

The four restored files are byte-identical to shared-db commit
`6dbdc25e0a4ab4f643928c4b394971b1f9ddb8f6`. Their SHA-256 hashes match
[`scripts/proofs/2870-producer-pins.json` at DesignFlow backend develop commit
`9899a3275ec34ca7138991a12fc51707b6482bc7`](https://github.com/popcre/designflow-backend/blob/9899a3275ec34ca7138991a12fc51707b6482bc7/scripts/proofs/2870-producer-pins.json),
read at 2:34 AM EDT on 2026-09-28. The backend file itself has SHA-256
`9ffb1cc451a4b30b52f57bef10d7f1bfac41c7e6cdcaed65cb39b995eabdf3b0`.

| Restored file | Expected and actual SHA-256 |
| --- | --- |
| `.github/workflows/shared-db-2870-observation.yml` | `0de2c0a42ca22930533fa6807268bc2a40d928d32cab8afaf24022865646a662` |
| `scripts/proofs/shared-db-2870-observation.mjs` | `7e6b2c137805716beb87223e372d97b1e161266399827a251bc3c5f3e4bbcb0d` |
| `scripts/proofs/2870-catalog.sql` | `e14bdd8d081ceb4cc0ab8caa8d620ace0257a5d777c51a8b4a2b8a194d1cadfd` |
| `scripts/proofs/2870-contract.json` | `f125b01a4ae88daf320150700bcdf4e8d330c0a7d344ca21dfba0bd1e8b2904d` |

The throughput disposition was restored with its original `line_sha256`,
`disposition`, and `reason`. Its `semantic_key` suffix changed from `:1` to
`:context-baa835b03f350d9f1bb933bf265b8be8ee33e2c90aa97e6ace4ceb097b84cc0a`
to satisfy the current context-hash checker. The source file itself was not
edited. Generation 1 evidence lives at immutable ref `refs/db-contracts/3614/1`;
generation 2 lives at `refs/db-contracts/3614/2`. They are not duplicated in
this PR.

The workflow's `application_commit_sha` input is caller supplied. The observer
records that exact value in its result; it does not independently decide whether
it is the current approved backend commit. The backend acceptance workflow
validates its own exact commit and producer pins against the resulting artifact.
Dispatch must supply the current approved backend commit and retain its run ID.
No observation is dispatched by this restoration PR.

The thirteen focused observer tests and the full throughput audit are required
checks on the pull request head. The head-specific hosted check result is the
merge proof; this document records the source and pin comparison that the
review sandbox cannot independently fetch.
