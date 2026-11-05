# Private historical customs benchmark

Owner: DesignFlow HTS evaluation; shared-db issue #5447, application issue
[designflow-backend#279](https://github.com/popcre/designflow-backend/issues/279).
Albert requested lossless preservation in development and production and an
authoritative software-comparison benchmark. He then directed that seldom-used
PDFs belong in DigitalOcean object storage rather than database files.

`plm.customs_benchmark_dataset` holds the complete original intelligence object,
source manifest, content-addressed identity, authority context and counts.
`plm.customs_benchmark_observation` makes every source section queryable while
preserving every unknown source field in `original_record`.
`plm.customs_benchmark_artifact` holds private object-storage locations, original
filenames, types, byte counts and SHA-256 checksums. Original JSON/JSONL extraction
records are also retained as queryable `structured_content`.

All original file bytes live in a dedicated **private DigitalOcean Spaces
bucket**, including the customs PDFs, complete master workbook, earlier extracts
and catalogs, reports, scripts and previews. There is no file-byte column in the
database. Object keys use content hashes, not commercial filenames. Each object
must have a private ACL, pass an authenticated full-byte hash check and deny an
anonymous request. No permanent public or expiring signed URL is stored.

This private archive stays outside the sanitized shared `hts_rag` learning
contract. Do not copy commercial source documents or identifiers into that path.

## Authority and evaluation

The preserved archive is authoritative for historical customs evidence. Compare
software outputs to the linked styles and physical product facts, preserving
packet, entry, page, source hash and original status with every comparison.
Direct historical candidates still require source association verification
before becoming frozen answers. Historical filings are not binding CBP rulings
or automatically valid current-law labels. Retain original codes and separately
supported current successors; never silently rewrite the item-master HTS field.

Packet inference, family research leads, clock-component exclusions, unmatched
styles, coverage and anomalies remain available but cannot become confirmed
answers by inheritance. Report their coverage separately. Keep evaluated answers
out of prompts and training/retrieval memory for the evaluated items and families.
Previously examined development material is not an untouched evaluation set.

## Import and verification

The generic [loader](../tools/load-customs-benchmark.py) contains no private
source data and issues no DDL. Source inputs are the private customs directory
and original master workbook. Storage uses `S3_ENDPOINT_URL`, `S3_BUCKET`,
`AWS_DEFAULT_REGION` and credentials supplied only through a protected process
environment. Use the application's canonical existing storage credential source;
never commit values. `--archive-only` preserves and verifies objects without
accessing a database. No source file is deleted or replaced.

The default database mode only verifies; `--apply` inserts immutable rows with
conflict preservation. The exact target ref and local `project-ref` file are
required. The Management API token comes from 1Password. The optional verified
pooler connection uses `CUSTOMS_DB_DIRECT=1`, `psycopg`, the canonical password
and pooler host supplied through the environment; it proves the same cluster as
the Management API before every statement. Default verification transactions are
read-only. File bytes never travel through a PostgreSQL statement.

For each actual development and production target, verify every private object,
every object pointer and parsed extraction record, all observation fields, the
entire original intelligence object, expected counts and a fresh source inventory.
A partial import is not complete or usable until this full reconciliation passes.
Re-running finishes missing rows; conflicts stop verification without replacing
evidence. The tables grant only SELECT/INSERT to `service_role`, with RLS enabled
and no browser policies. Evaluation access requires a trusted server-side identity.
No new public endpoint or classifier behavior is introduced.

## Extraction route

The saved extraction covers all source packets. Preserve it rather than replacing
it with a new unverified OCR result. PopDAM documents Indra in its PDF-processing
agent: `packages/agent-common/src/indra-ocr.ts`,
`apps/bridge-agent/Dockerfile`, and `docs/WORKER_LOGIC.md` section 10 in the PopDAM
repository. Its configured Python runtime processes rendered page images with
bundled ONNX models, after native PDF text extraction. This is an agent integration,
not evidence of a standalone Hetz HTTP service. Reuse that supported integration
for scanned or unreadable pages if needed; retain any new output separately with
source/page/tool provenance. No re-extraction is required to preserve this dataset.

Schema uses canonical automatic production promotion and the existing sandbox
migration workflow. Private source content never enters GitHub or Actions logs.
The same issue retains storage proof, both-target receipts and live proof.

## Bounded HTS system evaluation access (#5447 / backend #278)

Migration `20261105121341` defines a separate server-side evaluation login,
`designflow_hts_evaluation_reader`, with explicit `SET ROLE
designflow_hts_evaluation_read`. It does not extend an application runtime or
browser identity. The grant role has only the named evidence/status/source-link
columns required by the filed-evidence query, verified-archive hash/flag columns,
the item/style join, and the ColdLion style/prepack/company/division fields.
Private object pointers and artifact contents are excluded. Archive SELECT
policies name only this role; no BYPASSRLS or SECURITY DEFINER is introduced.

The fixed-version atomic executor issues the initial credential, approved DDL
and ledger row together. It refuses unsafe statement/parameter logging,
unexpected existing identity authority, a missing protected secret or a changed
existing password. It never rotates a credential on retry. Preview and
production passwords are separate: preview uses the existing repository-secret
trust boundary; production uses only the existing production environment.
The normal migration executor and automatic promotion gates are unchanged.

Credentials are staged in 1Password vault `vibe_coding` under `DesignFlow HTS
evaluation reader - shared POP database (preview)` and the corresponding
`(production)` title. Staged secrets and a merged migration are not delivery:
the same issue must show automatic apply, actual login, allowed bounded reads,
denied source-pointer/write access, and the sanitized prepack qualification.
All raw query results and customs source values remain private. This is system
readiness work, not a manual classification of the catalog or permission to
tune on held-out items.
