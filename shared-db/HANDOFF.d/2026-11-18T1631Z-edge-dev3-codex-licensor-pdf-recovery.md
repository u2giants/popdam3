---
issue: 5952
status: OPEN
owner: codex/5952-wrap-up
summary: "Continue the verified licensor-submission PDF recovery and resolve the remaining source exceptions."
kind: handoff
read-when: "Resuming the application-data work tracked by shared-db issue 5952."
---

## 0. Business decisions only the owner can make

None is currently needed. Albert directed that Luna Medium handle routine evidence work and ScaleDown verify each recovered submission before loading. Missing evidence is a technical blocker. A successor should only seek a business ruling if new evidence exposes a genuine ambiguity in what counts as a submission.

## 1. Application and sources

SharedLic is the NAS source of licensor PDF receipts. The per-PDF evidence lives in `plm.licensor_submission_pdf`. Each load is an immutable capture, and reads from these receipts are evidence rather than curated property or character master data. The existing issue is [#5952](https://github.com/popcre/shared-db/issues/5952). The private source repository owns the [verified loader](https://github.com/u2giants/licensor-source-data/blob/8a9ef108ee28acea88e2c8f193862a12ae51d203/submission-pdfs/scripts/load-verified.sql).

## 2. Scope and ownership

The work identified missing submissions across the share, added separate submission and Brand Assurance number fields, and performed append-only intake of verified PDFs. The schema is delivered. Remaining work is private source-data verification under the existing issue. The successor uses its own session identity and scope. Claim-first applies only if its independently scoped work needs another structural change.

## 3. Verified state

- [Schema PR #6681](https://github.com/popcre/shared-db/pull/6681) merged at [994e924](https://github.com/popcre/shared-db/commit/994e924805584eeb57ecb7f3eef409fea1c6bd3c). [Exact preview](https://github.com/popcre/shared-db/actions/runs/44308135153), [historical preview proof](https://github.com/popcre/shared-db/actions/runs/44311350830), and [production apply](https://github.com/popcre/shared-db/actions/runs/44312219369) succeeded for migration 20261218084504. Preview schema evidence was applied. No licensed rows were loaded into preview.
- [Private loader PR #188](https://github.com/u2giants/licensor-source-data/pull/188) merged at [8a9ef10](https://github.com/u2giants/licensor-source-data/commit/8a9ef108ee28acea88e2c8f193862a12ae51d203). The exact-head local policy test passed 14/14. A disposable PostgreSQL rehearsal accepted verified input and rejected missing verification.
- Production captured 2,115, 1,357, and 143 PDFs in three completed loads. All 3,615 stored records matched their verified inputs in all 13 fields. See [first live proof](https://github.com/popcre/shared-db/issues/5952#issuecomment-6979865233) and [continuation proof](https://github.com/popcre/shared-db/issues/5952#issuecomment-6982606298).
- The last 1,766 staged PDFs account for 1,500 newly loaded, 22 excluded manuals, feedback or portal-detail documents, and 244 unresolved receipts. The 244 include 238 combined-field boundaries or disagreements and six classic receipt disagreements. Seventeen additional files remain unreadable. Earlier low-confidence full-share paths are separate from this staged cohort.

## 4. Failed approaches and recovery

- [#6376](https://github.com/popcre/shared-db/pull/6376) attempted to rewrite an applied sandbox migration. It was closed with its source preserved, and the distinct [sandbox finding #6375](https://github.com/popcre/shared-db/issues/6375) stayed open. Hosted private advisory CI did not materialize its tracked test script in the sparse checkout. The policy test worked locally.
- A second preview apply was correctly refused because the version was already applied. The historical route reused the original proof without applying it twice.
- A broad ScaleDown prompt often dropped literal identifier suffixes or guide variants. Field-isolated reads recovered positive exact matches. A copy candidate with a different receipt ID is not proof for the broken original.
- Both NASes and their exact snapshots held identical damaged bytes. Twelve related readable records were already live and did not establish exact identity. Local repair yielded no genuine pages from two truncated files. An accidental directory-targeted snapshot download was stopped and its partial private archive removed.

## 5. Evidence rules

The compound `Style Guide:Character` label sometimes contains one explicit pair and sometimes comma-delimited repeated pairs. Establish the entire value and boundaries using both native layout and Indra OCR. Preserve actual values and typed number labels. Adjacent YES/NO rows can be actor likeness, documentation, or factory metadata. Do not read these as characters. Generic tracking and parent IDs are separate from the requested submission number. Established receipt templates can omit a property field.

## 6. Exact continuation

1. Open [#5952](https://github.com/popcre/shared-db/issues/5952) and confirm the current production counts and metadata before acting. The three verified loads must not be repeated.
2. Reopen the private evidence archive on edge-dev3 using archive ID `issue-5952-01a1ec88` and verify its manifest. It is in the protected local licensing evidence store under the closeouts collection. If unavailable on the current machine, route to edge-dev3 or rebuild the inventory from the source share, using the [published input and capture rules](https://github.com/u2giants/licensor-source-data/blob/main/submission-pdfs/README.md).
3. Work only unresolved paths. For the 238 compound cases, require clear original field boundaries or an exact unique reconstruction from independently confirmed pairs. For the six classic receipts, resolve character or guide contradictions from source pages. For the 17 unreadable originals, require an intact exact-identity copy before further extraction.
4. Use Luna Medium for routine evidence work and ScaleDown for independent verification of every positive candidate. Use the private loader once a verified pack exists, with immediate target proof, path uniqueness, and production readback of each field. Update the existing issue, leaving incomplete live proof open.

## 7. Constraints

Do not change curated Master Data or existing captures. No schema work is pending. No licensed values, filenames, payloads, project references, or credentials belong in the shared repository or public issue. The scope freeze deferred the residual evidence work and the private runner checkout fault. No successor accepted an active reservation.

## 8. Access and evidence

Use the established protected credential injection for the private writer and the existing ScaleDown credential. There was no new secret to store. The archive holds the per-PDF dispositions, verified inputs, live readbacks, private verification records, failed-file inventory, and reproducibility code. The source originals remain on the NAS. Retain the archive even if the temporary scratch area expires.

## 9. Risks and rechecks

The closeout counts apply to the published captures and staged cohort at verification time. Recheck the NAS inventory, live rows, issue owner and code heads before later intake. A field absent from this form or a corrupted copy is not evidence of a false value. The remaining evidence exceptions stay open on the same issue.

## Closeout recheck and self-audit

At 11:32 AM EST, the three completed production captures still totaled 3,615 rows. Protected main before this handoff was [69733d0](https://github.com/popcre/shared-db/commit/69733d0c6c1377ba12c384d987a773e0c4846288), with latest source migration version 20261218084604. No other preview contents were certified. The native release freed the original author claim. The private archive contains the fresh closeout receipt.

Audit passed. §§1–3 establish the application, completed work, releases, and proof. §§4–5 preserve failed approaches and evidence rules. §§6–9 give the next actions, verification conditions, environment, and risks. All repository-file and commit references use GitHub URLs. The private evidence is locatable by its archive ID without exposing licensed material. Review of §§1–9 found no owner decision or technical approval missing from §0. A fresh developer can resume the unresolved work from this file and the issue with the same evidence and constraints.

Documentation pass: no standing rule or other document needed replacement. Secrets sweep: no new credential material found. Both completed implementation branches and their clean checkouts were preserved while the associated source work remains open.
