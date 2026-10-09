---
issue: 277
status: BLOCKED
owner: codex/orderlist-refresh-20261008
---

# 0. Business decisions only the owner can make

Albert must identify whether the 60 new Google OrderList lines matching ColdLion
customer PO, style, and quantity are the same real orders or additional orders.
Recommendation: retain the hold until actual order identity is known; different
production/sales order numbers make automatic merging unsafe. The async question
was sent in this chat. No answer received as of October 8, 2026, 8:34 PM EDT.

Albert must supply the intended business values for 12 conflicting Google order
groups (79 source rows) and 58 malformed/incomplete rows. Recommendation: retain
the raw evidence and current records until the source meanings are corrected;
never guess component quantities, mixed assortments, customers, or vendors.
The private comparison workbook identifies every affected row. AI executes all
actual corrections/import steps after those business meanings are resolved.
No technical approval is requested from Albert. No other business decision was
found in the section-by-section sweep.

# 1. Application

PopDAM is POP Creations' licensed artwork and product operations application at
https://dam.designflow.app. `/styles` displays Licensed/Generic Google Master
Data; `/orders` displays Google OrderList and ColdLion lines in one bounded grid.
React frontend runs through Coolify; shared PostgreSQL/Supabase production is
`qsllyeztdwjgirsysgai` (Virginia). Code repository is u2giants/popdam3; shared
structure belongs exclusively to popcre/shared-db. This work changes application
row data only, with no DDL, lookup/core Item Master writes, or infrastructure work.

# 2. Requested outcome

Albert requested an authoritative current Google Master Data refresh, removal of
Master Data records absent from Google, a current Google OrderList refresh, and
checking manually entered Google lines against ColdLion for possible duplicates.
Exact owner request is on https://github.com/u2giants/popdam3/issues/277. This is
the sole issue; retain it for source exceptions and any missing acceptance proof.

# 3. Verified current state

Master Data committed October 8, 2026, about 8:28 PM EDT: 15,986 rows, comprising
12,737 Licensed and 3,249 Generic. The transaction checked every imported source
field before committing, preserved 15,721 provable identities, removed/replaced
21 absent/unprovable identities, inserted 265, preserved saved views and unchanged
curated links. Only ONE nonblank old style is absent; the earlier 178 figure was
wrong because TSV NULL markers had not been normalized, and issue #277 records
the correction. Twenty-one removed identities are not twenty-one absent styles.
Live Licensed rows and full Generic rows were checked with this chat's isolated
signed-in browser. Licensed final paging showed 12,737; Generic showed 3,249.

Master procedure commit `4d84312aa4d8e7369e86124e4d2a337a0446af4d` was independently
approved by GLM; PR https://github.com/u2giants/popdam3/pull/278 merged normally.
Master worktree `/worksp/popdam-sheets-refresh-20261008`, branch
`codex/sheets-refresh-20261008`, contains the exact apply report under `.ai/reviews/`.
No frontend/edge deployment is needed for inert scripts/docs; existing live UI
reads the updated production data. Never describe Railway's automatic deployment
badge as frontend acceptance.

OrderList committed about 8:31 PM EDT: inserted 100 headers and 344 lines;
updated 3,060 headers and 24,002 existing Google lines. All 462 ColdLion lines and
their headers were byte-compared unchanged inside the transaction. Google source
references are distinct and no historical orders/lines were deleted. Sixty new
cross-source candidates remain held. Order procedure initial approved commit is
`dd91217382917e89711f5edd081400d4813c630d`; original GLM report is
`.ai/reviews/glm-final-check-20261009T002101-3640594-5834.md` in the Order worktree.
Review required identity/fidelity checks before apply; they were discharged (see
§5). PR https://github.com/u2giants/popdam3/pull/279 owns this package, including
an additional repeat-import metadata correction and this continuation note.
Verify PR state/current head/review before resuming; don't reuse a stale report.

The full signed-in OrderList page displayed rows from both sources and current
summary totals after the refresh with no failed data response. New-order Find
acceptance and exact final package/merge state are recorded on issue #277 by this
chat before closeout; if that evidence is absent, it remains pending on #277.

Repeat-import correction: `scripts/refresh-google-orderlist-rows.py:49` now adds
an original source snapshot only when the source snapshot changes. Otherwise a
second read-only dry run predicted redundant metadata updates on 344 newly
inserted lines. Corrected post-commit dry run predicts ZERO changes to headers
and lines. Eleven focused tests pass. No further production write was necessary.

# 4. Failed approaches

OrderList Google CSV/XLSX/gviz/HTMLview exports, connector range reads, and even
small ranges timed out or returned errors. Metadata worked. Do not repeatedly
retry those endpoints or increase production timeout. Read-only native browser
Copy of exact `A1:AV12925` succeeded. Plain clipboard TSV split 42 multiline
cells into extra records; structured HTML preserved all 12,925 rows x 48 cells.
A streaming standard-library HTML parser extracted validated JSON. BeautifulSoup
on the 101 MB HTML was too expensive; its owned process was stopped.

Initial Master full replacement was rejected because it lost identities and
curated relationships. Revised identity matching retains unique same-tab SKUs
or uniquely identical duplicate/blank content; ambiguous identities are replaced
with protected recovery images. Licensing links were added to preservation after
review. Locks were reordered BEFORE first SELECT/MVCC snapshot to avoid missing
concurrent writes. Do not revert those safeguards.

Browser MCP profile belongs to another session; do not take it over. Isolated
Playwright Chromium works. Login redirects to `/library`, then navigate to the
requested page. Waiting directly for `/styles` after login fails. Clicking the
Licensed button before initial grid setup races rendering; wait for actual initial
`.ag-row` first, and require final paging counts rather than a displayed loaded
count alone. Existing occasional Master lookup errors retried successfully;
never hide failures or remove capability as a workaround.

# 5. Findings and evidence

Fresh source comparison found 308 possible paired lines matching exact trimmed,
casefolded customer PO and style; 150 also have equal numeric quantities. Neither
is proof of duplicate real orders. Salesperson is not evidence of spreadsheet
entry author. The report makes no unsupported attribution to Yuchen.

Required pre-apply Order identity audit: 24,002 existing writable refs compared;
128 previous blank-PO placeholder parents became assigned, five parents changed
from the same PO to its `-cancelled` name, two assortment components changed SKU
within the same source row and parent assortment. No unexplained parent changes
or shifted-row pattern; no typed numeric/date value became NULL. Evidence files
`identity-audit.json` and `preapply-conditions.json` are in protected recovery.
Do this audit again for every new source, not merely aggregate count comparisons.
Physical source row numbers are not stable business identities after inserted or
deleted Google rows; unexplained changes must be held for review.

Case-only header differences can safely normalize; real customer/vendor/company
conflicts remain held. Current 12 conflict groups/79 rows and 58 rejected rows
are source problems, not a reason to coerce invalid lines. Blank component
quantity stays NULL, never inherit total assortment quantity. Multiple tracker
rows mapping to one non-null item are one candidate for this refresh; different
items or unlinked rows stay ambiguous. Existing operational links persist only
while their source identity remains unchanged.

# 6. Next actions and success gates

1. Fetch and inspect current PRs, issue #277, both isolated worktrees, and recovery
   results; do not replay either completed import. Gate: current live/issue facts
   reconcile with committed result evidence and approved heads.
2. Read Albert's answers and corrected source meaning. No answer is not approval.
   Keep the 60 candidate lines held until identity is resolved; keep malformed
   and conflicting groups held until values are known. Gate: each exception has
   explicit source/business evidence, not inferred duplicate status.
3. Retrieve a fresh source through the validated exact-range structured Copy
   route (or a now-working export), validate row width/header/range, and add
   source extraction changes only through a new owned current-upstream worktree.
   Current script pins exactly 12,925 rows; changed range requires an explicitly
   reviewed parser update, never padding/truncating the source to pass.
4. Produce a fresh private dry plan/recovery directory; audit every existing-ref
   SKU/parent change and numeric/date nulling. If shifted rows occur, design an
   identity-preserving reconciliation and obtain independent review first.
   Gate: no unexplained destructive continuity change; full protected preimages.
5. Obtain exact-head independent reviewer APPROVE, prove actual production target,
   run database gate, perform only the reviewed application-data transaction.
   Do not create schema or curated Item Master data from this app. Gate: verified
   source output, preserved unrelated/ColdLion records, single commit/readback.
6. Verify signed-in customer-visible pages plus an independent connection readback
   and a zero-write repeat dry run. Update the same issue, ship required scripts/
   docs normally, retire this OWN handoff only when all exceptions and live proof
   are complete, and close #277 then. Gate: each original deliverable has evidence.

# 7. Constraints

Canonical `/worksp/popdam` is landing-only. Order owned worktree is
`/worksp/popdam-orderlist-refresh-20261008`, branch `codex/orderlist-refresh-20261008`.
Its task classification was strengthened to reviewer-safety when this handoff
was added; review and repository gates remain required. Stage owned paths only;
ignore untracked generated `scripts/__pycache__/` rather than broad staging.
Never directly push protected main, force push, edit generated types, perform DDL,
use the historical import CLI's forbidden replacement mode, or merge/delete
ColdLion based solely on tuple matches. No production infrastructure action was
requested or performed. All human clock times must be America/New_York EDT/EST.

# 8. Access and private recovery

1Password vault `vibe_coding`, item `Supabase DB Password - shared POP database`,
field password. Session pooler `aws-1-us-east-1.pooler.supabase.com:5432`, user
`postgres.qsllyeztdwjgirsysgai`, database postgres. Move password only through
protected files/pipes; never arguments, reports, logs, GitHub, or reviewer context.
Browser test account is existing viewer item ID `mbspkosvp2rf25qxhqufipxqca`.
Retrieve through secret-safe wrapper; never publish authenticated browser state.

All licensed/raw data stays PRIVATE, outside Git and reviewer snapshots.
Base protected recovery: `/home/ai/.local/share/popdam-recovery/` (mode 0700).
`20261008-google-refresh-v2`: full Master source.xlsx, source.tsv, preimages,
plan, committed result, live screenshots. Original XLSX SHA-256
`5513f7a43a27235a74168a0cd532994c1c77b93265619e9848e9e2a6dba1b0cd`.
`20261008-orderlist-final`: exact source.json, preimages, plan, committed result,
withheld-source, identity audit/conditions, live screenshots. JSON SHA-256
`589a8bac85fdab123860feeb8f63afdc770372c12518e21e23a0b67dce3d776c`.
`20261008-orderlist-dry-v3/source-clipboard.html`: unaltered structured source.
`20261008-orderlist-idempotent`: corrected zero-write post-commit dry plan.
`20261008-google-refresh/OrderList-comparison.xlsx`: private business report;
308/150 overlaps, conflicting groups, rejected rows, 60 held source references.
Historical dry directories remain recovery evidence, not replay authority.
Scratch was `/tmp/tmp.ERFDy1ixZv`; do not depend on it after session end.

Sources: Master workbook `1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214`, tabs
License.Style / Generic.Style; Order workbook
`1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`, tab Order gid0.
Master converter `scripts/import-style-tracker-xlsx.py`; refresh procedure
`docs/verification/google-sheet-refresh-20261008.md`. Order current procedure
`docs/verification/orderlist-refresh-20261008.md`; historical pure parser is
read-only mirror `shared-db/scripts/import-order-list-xlsx.py`, identical to
canonical at execution. Local Python environment needs openpyxl and psycopg[binary].
Own Playwright uses `/opt/ai-tools/playwright/node_modules/playwright` and Chromium
`/opt/ai-tools/ms-playwright/chromium-1228/chrome-linux64/chrome`.

# 9. Open questions, risks, and self-audit

As of October 8, 2026, 8:34 PM EDT, only business/source exceptions are expected
to remain after final package review/merge and live acceptance. Source sheets
remain mutable: never apply an old plan after any concurrent database/source
change, and never infer identity from row number alone. Master import locks
block edits during its transaction and emit a large realtime burst at commit;
readers can continue. Protected recovery directories contain licensed data.
Keep their access private; raw data must not enter public issues or reviews.

Self-audit: (1) newcomer continuity passes via §§1–3,6,8; (2) session findings and
dead ends are preserved in §§4–5; (3) execution constraints, exact recovery,
verification gates, and risks are explicit in §§6–9; (4) the sentence-by-sentence
business-decision sweep found only duplicate identity and intended source values,
both promoted to §0. No technical approval or outside-workstream decision remains
hidden. Final PR/acceptance state is deliberately verified through #277 rather
than presumed from this write-once note.
