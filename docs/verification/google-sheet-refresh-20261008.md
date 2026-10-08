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
The current database contains 15,742 rows. 178 existing normalized style numbers
are absent from the authoritative sheet. Existing source row positions have
shifted, so a positional update could attach old cell history to a different
product. This package uses the existing documented full-replacement semantics.

The dry-run saves complete row preimages for the replica, bridge, audit log,
manual resolutions, and saved views in a protected local recovery directory.
The exact database and converted-source fingerprints must still match at apply.
A transaction-wide import lock and exclusive replica-table lock serialize the
operation. Old replica rows are removed, their bridge rows cascade, audit
records remain with detached row references, and the source rows are inserted.
Existing manual value resolutions and saved user views remain. The existing
bridge refresh recomputes relationships. No OrderList rows, quantities, Item
Master rows, customer/vendor/licensing lookup rows, or schema are changed.

The transaction checks complete field-by-field source equality, bridge row count,
and unchanged saved views before commit. Failure rolls back. A failed commit
acknowledgement must be resolved by readback before rerunning. Retained recovery
preimages are private; no row contents or credentials enter GitHub or reviews.

Post-commit acceptance requires a new read connection and the signed-in live
Master Data page. The current OrderList source retrieval is unresolved: Google
metadata works, but export and bounded value reads have not returned. There is
no authorization to invent fresh OrderList data or call the old importer with
its historical pinned workbook. The duplicate audit must distinguish genuine
cross-source overlap from ColdLion's multiple stages and preserve all ERP rows.
