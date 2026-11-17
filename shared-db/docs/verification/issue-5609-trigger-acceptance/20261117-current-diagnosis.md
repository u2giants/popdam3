---
summary: "Issue 5609 November 17 diagnosis: invalid observation, unmet WAL criterion, deterministic metadata selection repair."
kind: proof
status: open
read-when: "continuing 5609 after the November 17 diagnosis or verifying the metadata sample correction"
---

# November 17 diagnosis and bounded proof correction

Owner: the explicitly requested two-issue coordinator and its #5609 worker;
[existing issue](https://github.com/popcre/shared-db/issues/5609). Acceptance is
not complete. No replacement observation opening or producer repair is claimed.

## Actual source and target

Shared-db source: `68d40689bbea` from freshly fetched main. POP DAM source:
`e716f1d6`, fetched from `u2giants/popdam3` main. The configured production
identity was compared with the live identity before reads; the account was
`supabase_read_only_user`. No hosted DDL, DML, reset, fixture row or grant was
submitted. No application or schema change is part of this correction.

One read-only selector fixture using generated integer rows was initially run
through the production connector and returned true, following the historical
test script's read-only fixture convention. The coordinator then required all
further fixture execution locally. Preserve that disclosure: the query created
no objects and wrote no application rows. The subsequent selector, family,
trigger and metadata fixtures ran in an isolated PostgreSQL 17 container.

## Observed failures and functional evidence

At November 17, 2026, **4:43:55.837711 PM EST**, a diagnostic reusing the committed
probe's CTEs found:

- Statement deallocation **74**, pinned **0**; postmaster and statement reset
  still match the November 6 opening. The old interval is invalid.
- All 50 original family tuple identities/starts/hashes/counters still match.
  Apparent surviving delta: 228,275 calls, mean 31.9417815733699862 ms and
  90,576.014386157047 WAL bytes/call. The unchanged strict ceilings are
  81.80826627638924305 ms and 29,548.5825136248835 bytes/call.
- Ten exact trigger bindings match, thumbnail drift is zero; apparent document
  rate is 1.3100910608903084 versus ceiling 1.7480238054335852 per second.
- The page sample checked only two metadata rows, both matching.

The apparent deltas/rates are **diagnostic only**, not valid period acceptance.
Surviving endpoint tuples cannot exclude a new family entry that was created
and then evicted between captures. Global deallocation protection remains.
Neither elapsed calendar time nor selecting another favorable opening repairs
the missing history. The previous hosted 33.08% versus required 50% WAL result
also remains an unmet requirement.

At **4:45:00.915680 PM EST**, a full read counted **481** live assets seen within
the previous 24 hours. At **4:45:35.770961 PM EST**, changing only the selection
to the first three eligible asset IDs checked **3/3** matching metadata rows;
the ten bindings and zero thumbnail drift were unchanged. Sampling did not
filter on metadata contents or a passing result.

## Correction and preservation

The probe now selects from the complete same live/post-opening/last-24-hour
eligible set, ordered by asset ID, limited to three. A one-percent physical page
sample could underfill even when hundreds of eligible records existed. Every
metadata comparison, required count of three, frozen baseline and performance,
counter, access, binding and elapsed-time guard remains unchanged.

The pre-correction source is preserved byte-for-byte in
`5609-third-failed-window.sql`, SHA256
`abe17944933a4dda492bb59983df584b9b56470a0446d15b8aa546e8ae56a508`.
The test verifies that removing comments leaves only the two intended selector
replacements against that archive. The old opening remains pinned and fails;
this correction cannot create a green full acceptance result.

## Workload diagnosis and missing causal evidence

The unbounded current-prefix family snapshot at **4:47:38.368096 PM EST** had
226 surviving entries, 229,681 cumulative calls and 20,770,242,601 WAL bytes.
Nonexclusive shape counts: AI-tag fields 125,011 calls/10,022,898,524 bytes;
last-seen fields 61,550 calls/8,631,176,406 bytes; property-name fields
57,216 calls/8,078,928,651 bytes. These are surviving cumulative counters,
not a trustworthy whole-period total or causal comparison.

The largest individual shape changes only `property_name` and `last_seen_at`:
49,241 calls, 6,909,624,974 WAL bytes; entry start November 12, 2026,
**3:17:36.162510 PM EST**. This shape alone does not establish redundant writes.
The original PRE was dominated by the two wide ingest statements (28,434 of
30,092 calls); those two original IDs are now absent. Removing unchanged scans
alters the surviving request mix, so per-surviving-call WAL cannot establish the
causal savings of an unchanged-file rescan. The frozen criterion remains.

The current existing-path ingest fetches `*`, including `property_name`, applies
`changedFields` to the full fresh row and skips a wholly unchanged update. The
hash-move candidate also fetches `*`. Direct moves use a fixed larger payload
including path/name and cannot explain the two-field shape. Licensing names
come from the authoritative source reference, with core-code fallback. Current
asset trigger bodies do not rewrite `property_name`; the style-group clock
compares it but leaves the value intact. Opt-in indexed-write receipts contain
attempted/succeeded counts, not the OLD/NEW values needed to prove repeated
property-name overwrites. No missing-projection or unconditional existing-path
write defect was found in the refreshed source.

A second complete capture at **4:50:37.214748 PM EST**, compared with the
**4:47:38.368096 PM EST** capture, found unchanged deallocation74, the same226
family entries, zero family calls/WAL delta and zero asset/document update
delta. The dominant historical shape was therefore not observed executing
during this authentic three-minute diagnostic interval. This interval is not
the required 24-hour observation and generated no traffic.

An actual redundant writer requires source-bound authentic OLD/NEW differences
and caller attribution during genuine traffic, not an inference from cumulative
shape counts. After a justified repair, full-family acceptance still requires a
complete authentic 24-hour interval, 100 calls, unchanged identities and no
deallocation/reset, all original thresholds and current functional checks. No
new window is activated here, and no synthetic production load is authorized.

## Verification

Eight Python probe tests and four lossless baseline tests pass. Local PostgreSQL
17 results: selector true, family 26/26, trigger 19/19, metadata 104/104. The final
selector fixture uses descending physical input, lowest IDs deleted/too-old/
future, six valid rows and expected IDs 4/5/6; a second newer-opening case expects
5/6/7. It exercises ordering and both eligibility lower bounds. Parent separately
verifies the final fixture before delivery. All statements are local read-only
fixtures except the isolated local pgcrypto setup.
