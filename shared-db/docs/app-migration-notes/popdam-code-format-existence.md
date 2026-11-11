---
summary: "Reader dam_catalog_code_format_exists (#5696): service-role-only positive evidence that a code-looking search token matches a catalog code format."
kind: spec
status: current
read-when: changing DAM product-code search intent handling
---

# PopDAM complete code-format existence (#5696)

The settled [product-code search rule](../business-rules/digital-asset-classification-and-tags.md#product-code-searches)
retains picture guesses for unfamiliar code-looking searches. This reader is
positive intent evidence only. It never establishes identity or suppresses
pictures. Actual catalog codes and prefixes retain their existing identity
lookup and keyword-only behavior.

`public.dam_catalog_code_format_exists(p_format text)` returns a boolean through
the existing service-role client. It is stable/security-invoker, with no new
table grants. PUBLIC, anon and authenticated cannot execute it. Caller-visible
search authentication and authorization must happen before the service read.

Accept one ASCII-alphanumeric query token, 7–64 characters, containing both a
letter and digit. Translate every ASCII letter to `A` and digit to `9`; send
that complete shape as a bound argument. The saved catalog has 93 complete
shapes across 11,247 codes, lengths 7–20, so the gate omits no observed complete
format. Alphabetic/numeric-only inputs, multiword text and unsupported shapes
must not be reclassified by a broad SKU regex. Unknown short partials remain
outside this complete-format classification.

The expression index derives directly from current catalog rows, using the same
ASCII predicate and translation as the reader. It is not a maintained registry
or cache. Misses use equality against the derived key, avoiding generic regex
trigram/heap scans. A prior full-miss regex read timed out at 1,000 ms; it was
withheld rather than given a larger budget.

Invalid shapes raise SQLSTATE 22023. A lookup error or client deadline is an
unavailable search before embedding/downstream calls, never a false empty or
keyword-only answer. Keep a total 1,000 ms client budget and propagate its abort
signal. Function-local `statement_timeout` is a hint, not proof of a hard nested
deadline or backend cancellation; retain the existing outer server statement
budget and test the actual RPC path. No global timeout is changed.

Local validation uses an explicitly opted-in, isolated PostgreSQL 17 container:
`DAM_CODE_FORMAT_DOCKER=1 python3 -m unittest scripts/test_dam_catalog_code_format.py`.
It captures nested auto_explain from the installed parameterized RPC, with natural planner choices and no forced flags. It tests privilege/RLS preservation (including PostgreSQL 17 FORCE RLS with the existing service BYPASSRLS role), input errors, replay refusal
and an actual blocked reader cancelled by the outer server deadline. The preview-only installed contract creates synthetic fixtures and rolls back the entire transaction; it proves actual service-role positive/independently absent negative behavior. Do not invoke fixture-writing contracts in production. The
installed contract is `supabase/tests/dam_catalog_code_format_contracts.sql`.
The separate protected catalog-derived proof exercises all 93 complete shapes
without publishing actual product codes. Preview/live source-bound plans and
ordinary-viewer application proof remain required; local tests are not delivery.

This index does not repair semantic-vector anchor latency. Track that separate
problem and application acceptance on PopDAM #725, #680 and #706. Do not install
an application consumer until the canonical database dependency is live.
