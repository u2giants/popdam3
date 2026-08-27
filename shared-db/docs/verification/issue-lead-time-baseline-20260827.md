# Issue lead-time baseline — `u2giants/shared-db`, 2026-08-27

The artifact behind the success target in
[`plan_orchestrator_throughput_guard_truth.md`](../../plan_orchestrator_throughput_guard_truth.md)
section 1. It exists because the plan set a numeric goal with nothing a reader could
re-derive, and an independent review (Grok 4.6, 2026-08-27) correctly called that out
under the plan's own evidence rule.

## Command

```bash
gh issue list --repo u2giants/shared-db --state closed --limit 400 \
  --json number,createdAt,closedAt | python -c "
import sys, json, statistics as st
from datetime import datetime
d = json.load(sys.stdin)
p = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
h = sorted((p(i['closedAt']) - p(i['createdAt'])).total_seconds() / 3600
           for i in d if i['closedAt'])
n = len(h)
print('n=%d median=%.1f mean=%.1f p90=%.1f  >24h=%.0f%%  >72h=%.0f%%' % (
    n, st.median(h), st.mean(h), h[int(n * 0.9) - 1],
    100 * sum(1 for x in h if x > 24) / n,
    100 * sum(1 for x in h if x > 72) / n))
"
```

## Result, 2026-08-27

```
n=400 median=4.0 mean=21.5 p90=60.3  >24h=18%  >72h=10%
```

## Reading it honestly

- **This is time-to-close on the issue, not time spent blocked.** It includes issues that
  sat unrouted for days (see `AGENTS.md` on the missing `db-work` label) and issues nobody
  started for a week. It is the right *outcome* measure and the wrong *diagnostic* measure.
- **It is a moving window.** "The last 400 closed" changes every day; the mean was 21.1 in
  an earlier run the same day. Re-run the command rather than quoting the numbers.
- **It cannot attribute cause.** Nothing here shows that guard false alarms drive the p90.
  That attribution is the job of the blocker ledger (plan step 5), and until that ledger
  has real entries the causal claim stays a hypothesis.

## Target

p90 60.3h → ≤30h, and the >72h share 10% → ≤5%, without weakening any safety guarantee.
Re-measured at plan step 9 with this same command.
