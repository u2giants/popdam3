# Google Sheets refresh execution package

Owner instruction in the current Codex chat, October 8, 2026:

> pull in all the data from google sheets master data into our popdam master data. if there are any lines in our masterdata that's not in the google sheets version, delete them, they're probably test data. and pull in all the latest data from google orderlist and check if there are any duplicate lines between coldlion data and google sheets data that yuchen put in manually

## Exact Master Data operation requiring review

The application-owned `public.style_tracker_rows` is a spreadsheet replica, not
curated `core.*` Master Data. No schema or curated lookup writes are requested.
Production target is `qsllyeztdwjgirsysgai`, proved from the connected session-mode
pooler socket immediately before the transaction's first write.

`scripts/refresh-style-tracker-rows.py` performs a checksum-bound replacement of
both imported tabs in one transaction. The source is workbook
`1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214`, SHA-256
`5513f7a43a27235a74168a0cd532994c1c77b93265619e9848e9e2a6dba1b0cd`.
The reviewed count is 12,737 Licensed and 3,249 Generic rows (15,986 total).
The current database contains 15,742 rows. One existing nonblank normalized style number
is absent from the authoritative sheet. Existing source row positions have shifted; the reviewed identity matcher
preserves 15,721 existing IDs and replaces 21 missing or unprovable identities.
The first comparison incorrectly counted blank identifiers as absent because a
TSV null marker had not been normalized. The corrected count is one style. The corrected package uses identity-preserving synchronization, described below.

The dry-run saves complete row preimages for the replica, bridge, audit log,
manual resolutions, and saved views in a protected local recovery directory.
The exact database and converted-source fingerprints must still match at apply,
and the protected recovery file must still contain those same preimages.
Repeatable-read transactions and table locks serialize the reviewed inputs.

The corrected operation retains existing row IDs only when a nonblank SKU is
unique within its tab in both old and new data, or source content is uniquely
identical. Ambiguous duplicate identities are replaced rather than guessed.
Missing identities are deleted; surviving identities move temporarily to negative
source positions inside the transaction to avoid uniqueness collisions while the
new positions are assigned. New identities are inserted. The final committed
replica must equal all source fields for every row, with no extras.

Customer links survive only if source customer text is unchanged. Existing
bridge relationships survive only while their corresponding source business
field is unchanged. The existing bridge refresh computes relationships for new
or changed source values. All refreshed identities receive system update timestamps; changed cells and
new rows receive system-authored audit entries. Previous editor provenance is
retained in the recovery preimages. Audit history remains attached to retained identities;
deleted identities detach their audit references. Manual value resolutions and
saved views are retained. No OrderList or canonical Item Master rows, curated
lookup rows, or database structures are written. This differs deliberately from
the historical 2026-08-28 full-replacement procedure, which discarded resolutions
and history; this package preserves them where their identity is provable.

The transaction checks complete field-by-field source equality, bridge row count,
and unchanged saved views before commit. Failure rolls back. A failed commit
acknowledgement must be resolved by readback before rerunning. Retained recovery
preimages are private; no row contents or credentials enter GitHub or reviews.

External gate contract verified locally: `ai-task-gates --help` explicitly lists
`check --before ACTION [--reviewer-approval REPORT]`. The full rule is canonical
`ai-devops/docs/standing-rules-details.md`, Production technical actions: an
assigned rotation reviewer must issue an exact-head APPROVE; pass that report to
`ai-task-gates check --before database`. The installed gate refused this action
without review. A script must never replace that external identity check with a
self-authored approval or silently drop the gate.

Post-commit acceptance requires a new read connection and the signed-in live
Master Data page. Google export and bounded value reads failed; the public read-only browser
copy function returned the selected OrderList range. Its structured HTML
clipboard representation is being validated before any import. There is
no authorization to invent fresh OrderList data or call the old importer with
its historical pinned workbook. The duplicate audit must distinguish genuine
cross-source overlap from ColdLion's multiple stages and preserve all ERP rows.
