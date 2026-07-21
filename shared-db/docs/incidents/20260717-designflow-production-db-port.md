# DesignFlow production database port incident — 2026-07-17

Status updated 2026-07-20: production is healthy and pinned to Cloud SQL port
`5432`; fail-closed infrastructure and application controls are implemented;
the scoped IAM foundations and two critical alerts are live. Four guarded
DesignFlow PRs are green and awaiting Uma's review. The final IAM Deny +
Privileged Access Manager approval gate remains blocked by the GCP project's
standalone `No organization` hierarchy.

## Executive summary

An AI-authored connection-pooling plan treated a working sandbox database
architecture as if it also described production. A later Codex session changed
the unsuffixed GCP Secret Manager `DB_PORT` value from `5432` to `6543`.
Production DesignFlow uses Cloud SQL, where PostgreSQL listens on `5432`;
`6543` is the hosted-Supabase transaction-pooler port used by develop, staging,
and sandbox. Production consequently attempted the correct Cloud SQL host on an
incompatible port and the live site failed.

The primary planning failure occurred when `fix_connection_pool.md` was written,
not merely when the command was later executed. The plan did not inventory and
compare each environment's provider, host class, network path, SSL mode, full
five-secret tuple, secret IDs, secret versions, and deployment bindings before
recommending a shared architecture. The implementation session then trusted the
plan and treated a production secret mutation as a routine application step.

No single control stopped the chain:

1. the plan generalized from sandbox evidence;
2. unsuffixed secret names did not visibly announce "production";
3. a project Owner could add a version directly;
4. production triggers consumed floating secret versions;
5. provider/port combinations were not validated before build/deploy;
6. application startup did not reject Cloud SQL + `6543`; and
7. no zero-traffic readiness gate caught the mismatch before users did.

## Correct environment contract

Production remains on Cloud SQL. Nothing in the pooling work authorizes a
production provider migration.

| Environment | Provider | Port | Secret set | SSL | Network |
|---|---|---:|---|---|---|
| Develop | Hosted Supabase pooler | `6543` | complete `_DEV` five-tuple | on | public pooler |
| Staging | Hosted Supabase pooler | `6543` | complete `_STAGING` five-tuple | on | public pooler |
| Albert sandboxes | Hosted Supabase pooler | `6543` | complete `_SANDBOX` five-tuple | on | public pooler |
| Production | Cloud SQL PostgreSQL | `5432` | complete unsuffixed five-tuple | off under current contract | private IP through VPC connector |

The five-tuple is host, port, user, password, and database name. Every build and
runtime must receive all five from one environment. A missing member, mixed
suffix, nonproduction fallback to an unsuffixed ID, Cloud SQL + `6543`, Supabase
+ `5432`, or production `latest` version is a hard failure.

## Ownership boundary

- `u2giants/shared-db` owns shared Supabase schema, migrations, RLS, grants,
  functions, views, data contracts, and this provider-light incident record.
- `popcre/infrastructure` owns GCP topology, Cloud Build substitutions and
  triggers, Cloud Run deployment bindings, Secret Manager containers/IAM,
  numeric version pins, alerts, and the detailed safety/runbook documents.
- Backend, Item Master, Tracking, and Data Syncing own runtime parsing,
  provider-aware startup rejection, readiness, tests, and safe diagnostics.
- `u2giants/ai-devops` owns universal AI external-state rules. It should point
  agents to the canonical repo contracts; it does not replace them.

This answers the prior source-of-truth question: `shared-db` is master for
database schema and cross-app data contracts. It is intentionally **not** master
for Cloud Build, Cloud Run, GCP IAM, or Secret Manager deployment wiring;
`popcre/infrastructure` is.

## Remediation completed

### Infrastructure contract and containment

Infrastructure PR [#12](https://github.com/popcre/infrastructure/pull/12)
merged as `aec5d16`; evidence/correction PRs
[#13](https://github.com/popcre/infrastructure/pull/13) and
[#14](https://github.com/popcre/infrastructure/pull/14) merged as `ecc7ccd`
and `adfd568`.

- A checked-in machine-readable contract declares the four environment classes.
- All database-backed triggers require explicit IDs for all five secrets.
- Production accepts only Cloud SQL/`5432`/private-VPC/SSL-off and numeric
  secret versions.
- Develop, staging, and sandbox accept only Supabase/`6543`/matching suffix/SSL-on.
- Nine validation fixtures pass, including negative cases for both provider/port
  inversions, mixed suffixes, incomplete tuples, unsuffixed nonproduction use,
  and production `latest`.
- A deliberate Cloud Build using Cloud SQL + `6543`
  (`c266a112-eaea-4dd9-997a-a7f66ac3d310`) failed in step 0 before image build
  or deployment.
- All four automatic production triggers were disabled and remain frozen.
- Production triggers are pinned to numeric DB secret version `1`.
- The five missing sandbox secret containers were created with version `1` and
  recovery notes were stored in the 1Password `vibe_coding` vault without
  printing values.

### Application startup controls

Guarded implementation commits were added to each `sandbox-albert` branch:

| Service | Implementation commit | PR | Current review state |
|---|---|---|---|
| Backend | `1a28265` | [#62](https://github.com/popcre/designflow-backend/pull/62) | green; Uma requested |
| Item Master | `1afb25b` | [#37](https://github.com/popcre/designflow-item-master/pull/37) | green; Uma requested |
| Tracking | `ed2ff6d` | [#25](https://github.com/popcre/designflow-tracking/pull/25) | green; Uma requested |
| Data Syncing | `a48b8a7` | [#16](https://github.com/popcre/designflow-data-syncing/pull/16) | green; Uma requested |

Across the four repositories, 109 suites / 741 tests passed. Each application
now fails before listening when provider, port, SSL, network, or environment
metadata conflict. Sandbox builds proved Supabase/`6543`/SSL-on using the
complete `_SANDBOX` tuple. Ready revisions were `core-00076-xpl`,
`item-00045-v7b`, `tracking-00040-kwn`, and `sync-00037-jwm`.

Uma is `devopswithkube@gmail.com` in Google Cloud and GitHub user
`devopswithkube`. Review was requested on all four open PRs on 2026-07-20. The
AI must not merge DesignFlow application PRs.

### Production recovery and verification

Production was not migrated to the pooler. The exact images already serving
production were redeployed as zero-traffic candidate revisions with the
complete unsuffixed five-tuple pinned to numeric version `1`. Each candidate
proved Cloud SQL private IP `10.75.208.4`, port `5432`, SSL off, and application
readiness before traffic moved:

| Service | Current verified revision | Traffic |
|---|---|---:|
| Backend/Core | `popcre-core-prod-00010-bof` | 100% |
| Item Master | `popcre-item-prod-00010-ben` | 100% |
| Tracking | `popcre-tracking-prod-00010-riv` | 100% |
| Data Syncing | `popcre-sync-prod-00007-suh` | 100% |

`https://designflow.app` returned HTTP 200 after recovery and again after the
IAM-foundation apply on 2026-07-20.

### Secret/IAM controls now live

Infrastructure PRs [#15](https://github.com/popcre/infrastructure/pull/15),
[#16](https://github.com/popcre/infrastructure/pull/16), and
[#17](https://github.com/popcre/infrastructure/pull/17) culminated in merge SHA
`9ad06f1`.

Terraform applied 24 additions, zero changes, zero destroys:

- `nonprod-db-secret-writer@lithe-breaker-323913.iam.gserviceaccount.com`, with
  version-management rights only on the 15 `_DEV`, `_STAGING`, and `_SANDBOX`
  DB secrets; Albert may impersonate it;
- `prod-db-secret-breakglass@lithe-breaker-323913.iam.gserviceaccount.com`, with
  rights only on the five unsuffixed production DB secrets and no impersonator;
- 20 secret-level IAM bindings;
- one limited nonproduction Token Creator binding; and
- critical access-control alert policy `10443910794556794963` routed to
  operations notification channel `7396100883045128365`.

Read-only verification proved:

- the nonproduction writer may version `DB_PORT_DEV`;
- it cannot version production `DB_PORT`;
- Albert cannot impersonate the production break-glass writer;
- the production writer's service-account IAM policy is empty;
- alert `10443910794556794963` is enabled and CRITICAL;
- the earlier secret-version mutation alert `2140283223355557769` remains
  enabled; and
- a final Terraform plan reports no changes.

A 1Password Secure Note titled `DesignFlow production DB secret approval gate`
was created in vault `vibe_coding`, item ID
`iwmlvzmx3acqknbktnwuu5x5bi`. It contains identifiers, ownership, the correct
environment contract, and the recovery route—not database values.

## What failed during remediation

### The first hard-gate design could not be bootstrapped

PR #15 planned 26 additions, zero changes, zero destroys, including the scoped
identities, a deny policy, and a one-hour PAM entitlement. Before applying
Terraform, the session attempted a temporary Deny Admin grant to the current
owner so Terraform could create the deny policy. Google rejected it:
`roles/iam.denyAdmin` is not supported at project level.

This failure was safe:

- the binding was rejected before creation;
- Terraform did not run;
- no deny policy or PAM entitlement was partially created;
- no temporary privilege remained; and
- no secret value or production revision changed.

The project is standalone: `gcloud projects describe` shows no parent and
`gcloud organizations list` returns none for the authenticated account. Google
allows deny policies to attach to projects, but Deny Admin is grantable only at
organization level. PAM project entitlements also rely on an organization-level
PAM service agent. PR #16 removed the undeployable resources before applying
the 24 safe foundations.

### Acceptance test initially mishandled an empty permission set

The first live test correctly received no production permission for the limited
writer, but PowerShell represented the empty `testIamPermissions` result as
`null`; the assertion expected an empty array. PR #17 added explicit null/empty
handling. The test now proves all scoped-identity checks and intentionally ends
with:

```text
BLOCKED: Albert still has direct DB secret version-write permission through the project Owner role.
```

That is an honest acceptance failure, not a deployed-system failure.

## Remaining hard-gate work

Albert's project Owner role still contains direct add/enable/disable/destroy
permissions for secret versions. Alerts, frozen triggers, version pins, scoped
writers, CI validation, and startup guards reduce risk but do not remove that
authorization.

The final control requires:

1. create/select a company-controlled Google Cloud organization;
2. move `lithe-breaker-323913` beneath it without changing project ID, billing,
   APIs, workloads, data, or secret values;
3. configure the organization PAM service agent and Deny Admin authority;
4. restore the Terraform deny policy with only the required writer, Uma
   recovery, and Google service-agent exceptions;
5. restore the one-hour PAM entitlement with Albert as requester and Uma as
   sole approver, with mandatory reasons;
6. run `popcre/gcp/scripts/Test-DbSecretGuardrails.ps1` until every check passes;
7. conduct a no-secret-change approval/expiry exercise and verify both alerts.

Do not replace this with self-approval, a permanent impersonation grant, a
service-account key, a broad exception for Albert, or GitHub inputs containing
database values.

Canonical GCP details and executable steps live in:

- `popcre/infrastructure` →
  `popcre/gcp/live/production-database-safety-plan.md`
- `popcre/infrastructure` →
  `popcre/gcp/live/production-db-secret-break-glass.md`

Official constraints:

- [IAM Deny roles and permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/iam)
- [Creating deny policies](https://docs.cloud.google.com/iam/docs/deny-access)
- [PAM permissions and organization service-agent setup](https://docs.cloud.google.com/iam/docs/pam-permissions-and-setup)

No secret value belongs in this document.
