# Source display-date fidelity repair — issue #277

The completed Google refresh used the existing XLSX converter. Nine Google date
cells have five-digit years; openpyxl converted those numeric date cells to
`#VALUE!`, silently losing their display text. Native anonymous Google Copy of
License.Style!AB3267 proves `12/3/20202`; all nine native displays are checked
privately. The years are preserved verbatim, not corrected to inferred years.

The converter now reads original XML numeric values that exceed Excel/Python's
supported datetime range, applies Gregorian date arithmetic only to date-formatted
cells, and refuses fractional/nonfinite unsupported overflow dates. Ordinary
large numbers and genuine error cells retain their existing behavior. Eight focused
tests verify real source display, leap/century dates, both Excel epochs, numeric
cell preservation, and fail-closed unsupported values. Existing refresh tests pass.

`scripts/repair-style-tracker-overflow-dates.py` performs a narrowly bounded,
independently reviewed eight-row application-data repair for these nine cells:
AB3267, R4530, P5403, AC6702, W6766, X6766, W7635, R7734, R12136 in License.Style.
It pins the original workbook SHA-256
`5513f7a43a27235a74168a0cd532994c1c77b93265619e9848e9e2a6dba1b0cd`,
verifies all source fields across 15,986 existing rows against the exact converter-error
preimage, saves complete protected recovery, and binds apply to unchanged source,
head, full database fingerprint, and preimages. Apply requires exact-head assigned
reviewer APPROVE through `ai-task-gates check --before database`; no small-owner
exception is used. The actual socket/user/database proves production
`qsllyeztdwjgirsysgai` immediately before writing. Locks precede the first SELECT.

Only row_data and the two typed status fields containing these dates are written.
Exactly eight affected rows are asserted, and full corrected source equality,
unchanged bridges, resolutions, and saved views are asserted before one commit.
No schema, lookup, OrderList, or infrastructure change occurs. The original source
and error preimages remain protected; no recovery artifact is overwritten. A
fresh connection readback and the live dated cell are required after apply.

Track execution, live proof, and final package state on the same issue #277.
This corrects the source fidelity claim for these nine cells; the original
Master import's counts/retained identities/deletions remain unchanged. Original
recovery-v2/source.tsv is an immutable ERROR preimage, not the corrected expected
source after this repair. Use the new date-repair recovery source.tsv for equality.


## Execution and final hardening

The exact independently approved head 2ee8567ea51203e61e136a027a889bededf36ce3
completed the eight-row/nine-cell transaction October 8, 2026 at 9:11 PM EDT.
Full corrected source equality and unchanged bridges, resolutions, and saved
views passed before committing. Complete recovery and native nine-cell display
proof remain private. Do not rerun this completed repair.

The final converter additionally preserves fractional datetimes on the last
valid day of year 9999 and tests actual ZIP/XML relationship paths and numeric
versus genuine error cell types. This closes the review's two medium findings.
Further acceptance and final package state are recorded on the same issue #277.
