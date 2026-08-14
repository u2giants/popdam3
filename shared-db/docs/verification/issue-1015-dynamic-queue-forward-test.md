# Issue #1015 forward-test evidence

Date: 2026-08-14

The deterministic queue builder was exercised with fresh synthetic issue sets,
not production database state:

- Two issues writing the same exact table remain in one serial queue.
- Three unrelated object groups produce three immediate refill candidates.
- An open dependency prevents dispatch.
- `blocked`, `owner-decision`, `data-only`, and `non-structural` issues consume no lane.
- An unclassified open issue prevents the orchestrator from claiming that an
  empty lane is justified.
- Existing cross-process tests still admit exactly three unrelated authors and
  exactly one of two authors claiming the same object.
- The external-review cursor advances Grok → GLM → Kimi → Qwen → Grok, returns
  the same assignment on retry, and refuses a concurrent orchestrator that does
  not own the shared lock.
- The retired caller-written risk booleans cannot authorize anything.
- A forged activation containing only booleans or prose fails closed.
- Activation refuses a mismatch between installed and canonical skill hashes.
- The inactive transition record preserves the old exact owner-approval rule.
- Conservative SQL inspection sends destructive, locking, access-changing, or
  otherwise ambiguous work to Albert instead of treating it as routine.

Proof command:

```powershell
node --test scripts/manage-migration-author-lanes.test.mjs scripts/check-dispatch-collision.test.mjs
python -m unittest scripts/test_production_business_risk_gate.py
```

Result: 104 Node tests and 496 Python tests passed, including six adversarial
production-policy tests. No database, preview, merge, or production call was
made by these forward tests.
