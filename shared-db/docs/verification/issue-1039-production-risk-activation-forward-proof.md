# Issue #1039 production-risk activation forward proof

Date: 2026-08-14

This evidence activates no production change. It proves only that the reviewed
policy code, canonical instructions, installed instructions, and synthetic
decision behavior agree before the separate activation pull request is merged.

## Reviewed merge pins

- shared-db PR #1021 merge: `6e4ea801798dae3ae30648a5e4682bbb3aa06e66`
- ai-devops PR #24 merge: `7c3e25454561748cd29e24bcfe1f3b4c0d3bdeb6`

## Canonical and installed skill hashes

Each value was freshly measured from canonical ai-devops, the Codex install,
and the Claude install. All three copies matched byte for byte.

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `dd5193ea661703563df58c49026bb540ce81e531f3e3b06acaa73a459a1401fc` |
| `references/operating-manual.md` | `dc55f17ea0887231f07725634e4209ef9533656fd45a945f220866361b394445` |
| `agents/openai.yaml` | `af75ff26faea15194941da38f1efd212f0ada1a17bf375452645230f870d863b` |

## Fresh forward tests

Commands:

```powershell
node --test scripts/manage-migration-author-lanes.test.mjs scripts/check-dispatch-collision.test.mjs
python -m unittest scripts/test_production_business_risk_gate.py
```

Results:

- Node: 104 passed, 0 failed.
- The six pre-activation Python adversarial tests remain green.
- Python now totals 7 passed, 0 failed after adding the issue #1039 synthetic
  decision test.
- No database, preview, merge, or production action occurred.

## Synthetic decision proof

The new test calls the internal decision function only after the same fact shape
used by governed artifact verification:

- complete low-risk facts permit the automatic path;
- destructive or permanent data change stops;
- expected downtime stops;
- material access change stops;
- unproven recovery stops;
- unresolved reviewer disagreement stops.

The old exact owner-approval rule remains the rule for this activation pull
request. This proof and its activation record cannot authorize their own merge.
