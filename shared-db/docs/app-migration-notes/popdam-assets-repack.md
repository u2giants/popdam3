# PopDAM: online repack of public.assets (claim #5742, work #5745, popdam3#804)

**What.** Migration `20261105201736` installs `pg_repack` 1.5.2 (schema `repack`,
revoked from `public`/`anon`/`authenticated`). The exact-index maintenance route
gains a fixed `table-repack/v1` kind (`scripts/table_repack_maintenance.py`):
allowlisted table `public.assets` only, sha256-pinned PGDG 1.5.2 client, fixed
flags `--no-superuser-check --no-kill-backend --no-order --wait-timeout`.

**Why.** On Nov 5, 2026 `public.assets` held 152,192 rows (~1.7 KB each, ~260 MB)
in a 2,024 MB heap, live rows spread over 81,814 of 259,072 pages. DAM search's
per-candidate visibility probe became a disk read: 26.5 s of a 41 s broad query.

**Safety.** pg_repack holds ACCESS EXCLUSIVE only briefly at start and at the
final swap; `--no-kill-backend` makes it give up rather than cancel application
queries. Indexes, triggers, constraints and grants must be identical and the exact row
count must stay within the concurrent-write band (max(50, 0.1%)), or the
executor refuses completion; leftover repack objects also refuse. Before the
client starts, provider-reported free disk must cover the table's total size
(heap + TOAST + indexes) plus 1 GiB (finding #5746, request in #5744).
The `repack` schema holds only transient `log_*`/`table_*` objects owned by
postgres; it is not in the PostgREST exposed schemas and USAGE is revoked from
anon/authenticated, so no default-privilege change is needed.
Preview runs first; production requires the verified preview completion receipt.

**Activation.** This change adds the capability only; the committed policy stays
unchanged. A separate PR adds the `repack-assets-804` policy entry after the
extension is live in production.

**Apps affected.** None at the API level. PopDAM search latency is expected to
drop; measured by the PopDAM Search test set before and after.
