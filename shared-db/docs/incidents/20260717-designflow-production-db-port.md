# DesignFlow production database port incident — 2026-07-17

## Summary

An AI-authored connection-pooling plan treated the DesignFlow sandbox database
architecture as if it also described production. A later Codex session changed
the unsuffixed GCP Secret Manager `DB_PORT` value from `5432` to `6543`.
Production DesignFlow uses Cloud SQL, where `5432` is the PostgreSQL port.
`6543` is the hosted-Supabase transaction-pooler port used by the sandbox.
The production services therefore attempted the right Cloud SQL host on the
wrong port and the live site failed.

## Why the plan was unsafe

The failure began when `fix_connection_pool.md` was written, not only when the
secret was changed. The plan did not first inventory the database provider,
host class, port, secret resource IDs, and deployment bindings for every
environment. It generalized from a successful sandbox test and described the
result as the architecture for all four services.

The later implementation session then:

1. read the shared unsuffixed `DB_PORT` secret;
2. observed `5432`;
3. created a new secret version containing `6543`; and
4. relied on production bindings that resolved the floating `latest` version.

No deterministic control rejected the provider/port mismatch, no production
approval gate stopped the secret mutation, and no staged no-traffic revision
proved the connection before users were affected.

## Environment boundary

Production DesignFlow remains on Cloud SQL. The hosted-Supabase transaction
pooler used by a sandbox is not a production migration target.

| Environment | DB secret set |
|---|---|
| Develop | complete `*_DEV` five-tuple |
| Staging | complete `*_STAGING` five-tuple |
| Production | unsuffixed five-tuple; production-only |

The five values are host, port, user, password, and database name. A deployment
must consume one complete matching set. Mixing suffixes or defaulting a missing
substitution to the unsuffixed production resource must fail CI.

## Required remediation before the held PRs can merge

1. Record a provider-by-environment connection contract in the infrastructure
   source of truth.
2. Parameterize all five secret resource IDs in the four affected service
   builds, with no default fallback.
3. Add negative CI fixtures that reproduce this incident: Cloud SQL plus port
   `6543` must fail before deployment and before the process listens.
4. Pin production deployments to explicit numeric secret versions rather than
   floating `latest`.
5. Protect production mutations with a required human approval gate.
6. Deploy production revisions with no traffic, run provider-aware readiness
   checks, then shift traffic gradually with rollback ready.
7. Replace global AI guidance that encourages immediate secret creation or
   mutation with environment-aware, approval-gated rules.

The four connection-pool PRs remain on hold until these controls and the
environment inventory are in place and the changes are revalidated.

## Ownership

- `u2giants/shared-db`: shared Supabase schema, migrations, RLS, grants, data
  contracts, and this provider-light incident record.
- `popcre/infrastructure`: detailed GCP topology, Secret Manager resource IDs,
  IAM, deploy triggers, version pins, alerts, and the detailed postmortem.
- Four DesignFlow service repos: runtime contract validation, build consumption,
  tests, and application behavior.
- `u2giants/ai-devops`: universal AI rules for external state.

No secret value belongs in this document.
