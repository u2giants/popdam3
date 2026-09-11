# Phase 3 task-gate pilot — `u2giants/shared-db`

## Scope and routing measurement

Measured from `origin/main` at `71fe95d64a7e` on 2026-09-09. No existing router
text was trimmed; the one router change is a short route to the installed gate.
Before guarded review the branch was reconciled to current `origin/main` at
`e149bd0bac3a`; that intervening merge changed only the `.agent` evidence pair
and two lane scripts, so these router measurements remain the exact baseline.

| Surface | Before | After | Headings | SHA-256 |
|---|---:|---:|---:|---|
| `AGENTS.md` | 123,361 bytes / 1,618 lines | 123,903 bytes / 1,628 lines | 62 | before `ab8ceed1b6bb32ddbcc6e5ead542c8ef2cb0b8c114357a2dcefa194dc974413d`; after `6cfd6d1653a3c4549eb6038783460e7d9323d297225a2e44c6970a9f8e1a0942` |
| `CLAUDE.md` | absent | absent | 0 | n/a |
| `HANDOFF.md` | 3,256 bytes / 70 lines | 3,256 bytes / 70 lines | 7 | `d2cf8d4a2813d904af59300ef518e8b19627fb3bfd12b68cbf8f466ec161f348` |
| `README.md` | 8,539 bytes / 135 lines | 8,539 bytes / 135 lines | 9 | `0440b702bc3cf8de3ed1cd8aa998a714db6b6fe17df94c421a4be5643fc89d90` |

## No-loss ledger

Every heading in the three existing router surfaces is assigned exactly once.
The original headings are `keep`; one `Task declaration` heading is added.

| Surface | Ledger items | Disposition | Reason |
|---|---:|---|---|
| `AGENTS.md` original headings | all 61 headings | keep | Complete shared-db operating, safety, ownership, and delivery contract |
| `AGENTS.md` Task declaration | 1 heading | add | Routes future sessions through the installed gate before protected actions |
| `HANDOFF.md` | all 7 headings | keep | Active-work routing and concurrency-safe continuation contract |
| `README.md` | all 9 headings | keep | Public purpose, workflow, setup, and usage routes |
| `CLAUDE.md` | no file | not applicable | No surface exists to migrate or remove |

Unassigned headings: **0**. Removed or unreachable instructions: **0**.

## Policy, trigger, and enforcement evidence

- Ordinary Markdown resolves to `prose`; ordinary source resolves to `code`.
- Agent rulebooks resolve to protected `reviewer-safety`, preserving the
  repository's existing full-treatment carve-out for instruction files.
- The local declaration strengthens every `supabase/**` path plus the two
  migration-risk policy files to protected `shared-db` work.
- A migration fixture refuses deployment with exit 3. Neither `--acknowledge`
  nor `--owner-request` can bypass it. A valid code flow proceeds to shipping.
- The merged gate retains the governed issue claim, branch-and-PR requirement,
  target proof, preview proof, and production-promotion authorization.
- The dedicated pull-request workflow installs the two task-gate commands from
  the accepted central-engine commit, proves the system-path command, and runs
  the focused fixture so the assertion can block CI.
- This pilot is repository maintenance only. It performs no database, schema,
  application-row, preview, cloud, infrastructure, or production mutation.

## Rollback rehearsal

The focused test removes the declaration from a disposable Git fixture and
positively observes `supabase/config.toml` fall from `shared-db` to `code`. It
then restores the declaration, observes `shared-db` again, compares the policy
byte-for-byte, and proves the source-file hash did not change. Operational
rollback is the same bounded action: revert the pilot commit. No database or
production rollback is involved.
