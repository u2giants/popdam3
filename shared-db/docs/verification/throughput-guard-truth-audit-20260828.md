# Throughput guard truth audit — 2026-08-28

The version-1 detector scanned 558 migration files and found 75 historical files with surviving markers. Its baseline is SHA-256-bound to the exact detector source, so uncommitted or later detector changes invalidate the artifact. Twelve of the thirteen deliberately enforced historical versions contain markers; the other 63 historical matches are inventoried but remain outside this prospective-plus-seed rollout until changed. Exact paths, counts, and the enforced set are recorded in `throughput-guard-truth-baseline-20260828.json`.

The guard does not infer execution, object names, durability, calls, or drops. Each surviving marker requires a hash-bound human disposition. Catalog evidence is explanatory only and never enters migration acceptance.

Every discovered message site receives a mechanical disposition from the adjacent JSON artifact. The new catalog, triage, and sidecar diagnostics are `enriched`; all pre-existing sites are explicitly `excluded` because this plan may not change their refusal or exit behavior. The checker fails if a site has no substantive disposition or if discovery moves.

The corpus bite command is `node --test scripts/throughput-guard/false-alarm-corpus.test.mjs`. Its real-detector fixture requires trigger `EXECUTE FUNCTION` to remain static while dynamic `execute format(...)` remains marked; reversing that narrowing makes the fixture fail.

Python workflow-pin proof: the complete `scripts/test_*.py` suite passed identically on the runner-default Python 3.13.15 and pinned Python 3.12.13: 792 tests, 8 skipped, zero failures on each interpreter. This was run after the final sidecar and catalog-contract changes and before enabling the four enforcing workflows.
