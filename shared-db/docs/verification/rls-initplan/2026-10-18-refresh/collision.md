# Read-only collision proof

This parser input is synthetic and was never executed against a database. It demonstrates the table and policy identities required for ALTER POLICY, and compares them with the fresh open claims. No objects are claimed or changed.

```json
{
  "objects": [
    "policy \"Admins can insert assets\" on public.assets",
    "table public.assets"
  ],
  "result": {
    "objectConflicts": [
      {
        "label": "claim #4158",
        "url": "https://github.com/popcre/shared-db/issues/4158",
        "objects": [
          "table public.assets"
        ]
      }
    ],
    "versionConflicts": [],
    "overlapFound": true
  }
}
```
