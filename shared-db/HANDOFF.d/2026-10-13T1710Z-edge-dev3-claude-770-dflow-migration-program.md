---
issue: 4248
status: OPEN
owner: claude/16164463-0b2e-4ea7-a039-2d3d59cd5d21
---

# DesignFlow Cloud SQL → Supabase program: credentials done, plan adopted, phases open

Written 2026-10-13 1:10 PM EDT on edge-dev3 by Claude chat 16164463-0b2e-4ea7-a039-2d3d59cd5d21.
Successor of [HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md) (immutable; not retired here — its #770 obligations continue under the parent below).

## 0. Business decisions only Albert can make

None open. Settled this session (Albert, chat, verbatim):
- 2026-10-12 "yes, drop the old ban and proceed" — the earlier AI-recorded ban on SCRAM-verifier credential issuance is retired.
- 2026-10-12 "permanently remove hard rule that the safety gate for the recovery rehearsal only accepts approvals from reviews that Codex launched".
- 2026-10-13 "use Uma's layout"; then "yes adopt Uma's plan, keep samples together, create the issues".
- 2026-10-13 "customers, artists, characters, factories and users should be core.* tables for all the applications to access" (scheduled as Phase 5, after Step 2).

## 1. Application and purpose

DesignFlow (POP Creations' PLM) production runs four Cloud Run services (backend, item-master, tracking, data-syncing) on Google Cloud SQL schema `designflow`. The program moves them to the shared Supabase production project `qsllyeztdwjgirsysgai` in Uma's two steps: Step 1 host cutover into `dflow_prod` (single schema), Step 2 multi-schema per `config/table-schema-map.js`. Adopted plan: [docs/designflow-cloudsql-to-supabase-plan.md](https://github.com/popcre/shared-db/blob/main/docs/designflow-cloudsql-to-supabase-plan.md).

## 2. Session goal and starting authority

Albert asked to resume #770 from the handoff above, diagnose the preserved undo failure, get fresh approval, finish recovery, then production acceptance. Scope later grew by his explicit instructions (section 0).

## 3. Current verified state (re-checked 2026-10-13 ~1:08 PM EDT)

- `origin/main` 0ce058253; newest migration file `20261013111713_coldlion_order_history_stamps_new_york.sql`. This session added no migration.
- **Recovery rehearsal PASSED (v23)**, 2026-10-12 12:53 PM EDT: DeepSeek APPROVE `97066c3b79d2bf2568f4396eedfb9eb25c19191a`; two forward + two reverse rounds; copy_verified and postwrite_recovery_verified true; original restored (103 tables / 1,007,245 rows / 97 counters). Recorded on #770 comment 6128727049. Fixes: private designflow-backend commits (unpushed by design) on branch `claude/770-ingest-full-consumption` → `claude/770-scram-stage-a` (FIFO drained to EOF + digest check; bounded round deadline; Codex c3894e0 phase deadlines; 9ff46b544 any-implementer review caller).
- **Production runtime credentials ISSUED and kept** 2026-10-12 9:07–9:15 PM EDT: `designflow_prod_{backend,item_master,tracking,data_sync}_runtime` hold SCRAM verifiers (verified by Claude via pg_authid format-only). All passed Supavisor session 5432, wrong-password refusal and transaction 6543. Provider Postgres logs show `PASSWORD '{REDACTED}'` only (4/4). Plaintexts are in 1Password vault `vibe_coding`, staged items' new field `supabase_runtime_password` (item references in [HANDOFF.d/2026-10-08T1749Z-…:88](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-08T1749Z-edge-dev3-codex-770-production-continuation.md#L88)). No existing vault field changed. Live services still run Cloud SQL and do not use these yet. #770 comment 6135961343.
- Credential plan: [plan_770_scram_verifier_credentials.md](https://github.com/popcre/shared-db/blob/main/plan_770_scram_verifier_credentials.md) (PRs #4238, #4244 merged).
- **Program tracking:** parent [#4248](https://github.com/popcre/shared-db/issues/4248) with sub-issues Phase 0 [#4249](https://github.com/popcre/shared-db/issues/4249), Phase 1 [#4250](https://github.com/popcre/shared-db/issues/4250), Phase 2 [#770](https://github.com/popcre/shared-db/issues/770) (retitled), Phase 3 [#4251](https://github.com/popcre/shared-db/issues/4251), Phase 4 [#4252](https://github.com/popcre/shared-db/issues/4252), Phase 5 [#4253](https://github.com/popcre/shared-db/issues/4253). Plan doc PR #4254 merged.
- Preview: not touched. Production writes this session: only the four role passwords (plus two earlier issue-then-undo runs, verified NULL in between).

## 4. Failed attempts and dead ends — do not retry

- v20 EPIPE: pg_restore reading custom archive from a FIFO exits before EOF; never pipe directly again.
- v22: inherited 120 s phase deadline killed the reverse round; deadlines now bounded per phase.
- Plaintext `ALTER ROLE ... PASSWORD` is unsafe here (`log_statement=ddl`, `pg_stat_statements.track_utility=on`); `log_error_verbosity` not settable on Supabase. Use verifiers.
- Direct host `db.qsllyeztdwjgirsysgai.supabase.co` is IPv6-only; edge-dev3 has no IPv6 (errno 101). Pooler is `aws-1-us-east-1.pooler.supabase.com` (not aws-0).
- Supabase log API returns HTTP 429 under bursts; space calls, retry with backoff.
- Expecting the verifier string in server logs fails: the provider rewrites it to `{REDACTED}`.
- Plan-review loop: the plan amendment got 13 DeepSeek REJECTs for ever-finer edge cases; binding gate became the exact-head code review instead. Don't repolish prose indefinitely.
- `refs/db-coordination/author-acquisition` was left stranded three times by PR #4221's reviewer-assignment step; released via `.github/workflows/recover-author-mutex.yml` (proves staleness). Fix in flight: PR #4256 (issue #4255), not this session's.
- The Codex desktop app auto-archives clean worktrees under `~/.codex/worktrees` (branches survive); detached runs need `setsid nohup` to survive a Claude session ending.

## 5. Key findings and capability limits

- Uma's plan Step 1 == #770's `dflow_prod` single-schema copy; no conflict. Older docs (segregation doc moves to core, SUPABASE-MIGRATION.md) are superseded for production by the adopted plan.
- Uma's map keeps 26 table entries in `dflow`; production must map them to `dflow_prod` (Phase 3).
- Production contract today forces Cloud SQL `designflow` in production; Supabase path allows only `SCHEMA=dflow_prod`, port 6543, service role users (`<role>.qsllyeztdwjgirsysgai`).
- Sample cluster: owner chose keep all seven together on `dflow_prod`; Backend and Item Master maps must change (Phase 3).
- Continuous copy for the <60 s write pause does not exist yet (v23 full reload ~150 s).

## 6. Ordered continuation

1. Phase 0 #4249 read-only pre-flight (inventories, relation-safety list, grants, Cloud SQL vs `dflow_prod` diff). Success: written diff posted on #4249.
2. Phase 1 #4250: four-service rehearsal on `production-rehearsal` + build continuous copy + measured write pause.
3. Phase 2 #770: physical PITR/recoverability, all-writer fencing, single scheduled move, four-service live acceptance (remaining checklist on #770).
4. Phase 3–5 per their issues. App-repo changes go through Uma's develop flow (no self-merge in DesignFlow).

## 7. Constraints and ownership

No exact-object structural claim held; no migration authored. No running sub-agent or Codex process (checked 1:08 PM EDT). Codex sessions used (idle, transcripts in `~/.codex/sessions/2026/10/12/` on edge-dev3): 01a1317b, 01a1320e, 01a1323c, 01a13297, 01a132c1. Private worktrees kept on edge-dev3 (locked by Codex, intentionally preserved evidence): `codex/770-scram-stage-b`, `codex/770-pooler-stage-b`, `codex/770-pooler-log-throttle`; branches `claude/770-ingest-full-consumption`, `claude/770-scram-stage-a`. Never push them publicly.

## 8. Access and preservation

Secrets only via 1Password `vibe_coding` (serialized). Encrypted recovery evidence mounts under the 770-rehearsal designflow-backend worktree on edge-dev3 (see predecessor handoff §8). Production read-only checks via the Supabase MCP read-only user.

## 9. Freshness and self-audit

SHAs/counts above checked 2026-10-13 ~1:08 PM EDT. Self-audit: a fresh developer can find the plan, the parent/child issues, what is done (rehearsal, credentials), what failed, and the next action (Phase 0) — YES.

Posted by Claude chat 16164463-0b2e-4ea7-a039-2d3d59cd5d21 on edge-dev3
