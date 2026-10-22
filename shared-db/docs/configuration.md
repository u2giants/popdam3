# Configuration

Names and locations only. **Never commit secret values.** Canonical secrets
live in 1Password vault `vibe_coding` (fetch serially; see
[`docs/agents/runbooks-credentials-cli-and-gotchas.md`](agents/runbooks-credentials-cli-and-gotchas.md)).

## Environment variables

| Variable | Purpose | Required | Where it is set |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI login | when using CLI | 1Password → `op read` into the shell |
| Production DB password | `supabase link --project-ref qsllyeztdwjgirsysgai` | production link / pooler | 1Password `Supabase DB Password - shared POP database` |
| Preview DB password | `supabase link` to the preview project | preview work | 1Password preview item (address by item ID; title has parentheses) |
| `PREVIEW_PROJECT_REF` | Identity of the live preview project | preview/CI | **GitHub repository variable** — never a literal in docs |
| `PRODUCTION_PROJECT_REF` | Production identity (`qsllyeztdwjgirsysgai`) | promotion | workflows / runbook §8 |
| `SANDBOX_PROJECT_REF` | DesignFlow sandbox migration target (`xupnyeifmpsacrqahwwm`) | sandbox workflows | workflow YAML |
| `SHARED_DB_TEST_TOKEN` | Post-batch app verification HTTP | some promotion verification | Actions secret |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API | CI / `gh` | Actions or user auth |
| `SHARED_DB_AUTHOR_ENGINE` | Authoring engine for reviewer exclusion | structural sessions | session environment |
| `SHARED_DB_SESSION_ID` | Claim-first session authority | preview prep / abandonment actions | session environment |
| `ANTHROPIC_API_KEY` | Advisory model review step in production apply | **absent** — step is a documented no-op | would be repo secret; not configured |
| `SUPABASE_ACCESS_TOKEN` (Management API) | Control-plane reads (e.g. PostgREST schema config) | when changing exposure | 1Password / CI |

If an operation fails auth, fix the login path; do not paste tokens into files or
shell history.

## Repository config files

| Path | Purpose |
|---|---|
| `.ai-devops/task-gates.json` | Task classes and required gates (`prose`, `code`, `shared-db`, `reviewer-safety`) |
| `config/atomic-migration-allowlist.json` | Bounded multi-version apply allowlist (class `shared-db`) |
| `config/production-risk-policy-activation.json` | Automatic production policy activation |
| `config/production-owner-identity.json` | Owner identity for production decisions |
| `config/production-verification-sidecar-registry.json` | Verification sidecar registry |
| `config/preview-ledger-orphan-reconciliations.json` | Preview ledger orphan reconciliations |
| `config/*schema*.json`, `config/*contract*.json` | Schemas for contracts / evidence |
| `supabase/config.toml` | Supabase project name only (`project_id = "shared-db"`) |
| `.github/workflows/*.yml` | CI and operational workflow definitions (constants live here) |

## Feature flags / activation

There are no app feature flags in this repository. “Activation” is policy
activation for production risk (`config/production-risk-policy-activation.json`)
and branch-protection required-check changes via
`scripts/update-required-checks.mjs` (AI decision + evidence + review; see
AGENTS.md §5.0-C).

## Local-only / ignored paths

See `AGENTS.md` “What to ignore” and `.gitignore` / `.claudeignore`. In short:
`supabase/.temp/`, `node_modules/`, `__pycache__/`, `.ai/`, `.claude/`, review
packets, and session scratch. A small named allowlist of committed
`.ai/reviews/*` files is intentional (permanent citations) — do not delete those.

## Preview vs production identity

- Production project ref is stable: `qsllyeztdwjgirsysgai`.
- Preview project ref **must** be read from `PREVIEW_PROJECT_REF`. Historical
  literals in old docs are not authority. Do not write a current preview ref
  into documentation.

## Credentials rotation

Rotate in 1Password, then update any consumer that caches the value. Report
leaks immediately. Never put a secret in git, logs, issue bodies, or chat.
