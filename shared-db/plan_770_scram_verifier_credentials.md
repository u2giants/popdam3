# Plan: #770 production service credentials via pre-computed SCRAM verifiers

Issue: [popcre/shared-db#770](https://github.com/popcre/shared-db/issues/770). Owner instruction
(Albert, chat, 2026-10-12, verbatim: "yes, go ahead with the reviewer check").
Registered from the #770 successor handoff
[`HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md`](HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md) §6 step 3.

## STATUS

**Amendment B live result — October 12, 2026, 9:15:50 PM EDT.** The single fresh
run started at 9:07:53 PM EDT and completed at 9:15:19 PM EDT. Production credentials
were written and kept: backend, item_master, tracking, and data_sync each passed
session-mode 5432 authentication, wrong-password rejection, and transaction-mode 6543
authentication. All four same-pid server controls were exact provider `{REDACTED}`
statements; all four separate statement-sink controls matched the exact current journal
verifiers. Complete three-source and statement-sink scans passed with zero plaintext
hits. Logging settings were unchanged. All four dedicated `supabase_runtime_password`
fields are present, `pending_password` absent, and original fields unchanged.
Independent postcheck confirmed all four stored verifier digests, journal DONE success,
restart refusal, no passfile/raw-log files, and preservation of all consumed markers.

Execution stayed on private backend head `7907d10aee3e5bce9fac40d196088f256dd9c5d4`;
DeepSeek final-check `20261013T010124-3432093-28696` APPROVE with implementer codex,
report SHA-256 `37fc550a1ab29415243485328f6c10ea1b5a0a81b7e12ee3c7f06a590a34a0b6`;
native production gate passed. The executed package bound this amended plan at
`2e5c2bcbcdcb8bb2fce4a1e92207b23a3fab46e5`; this later result-only documentation update
is not a replacement approval or permission to replay. All 45 real-runtime tests passed
without skips; reviewer snapshot ran 45 with one disclosed environment skip. Receipt
SHA-256 `defbd3a4e077ce567996bd09ebb1ee096bc151b958fc8d89d3c93f1e0b457e0e`.
No private code was pushed, no application was deployed or cut over, and no overall
#770 acceptance is claimed. Claude owns landing this plan branch; do not merge here.

**Amendment B — provider redaction (October 12, 2026).** Albert's current chat
brief authorizes the amended positive control and ONE fresh one-shot; owner authority,
verbatim: "yes, drop the old ban and proceed". The earlier run (Codex session 01a13297,
[#770 comment 6135641172](https://github.com/popcre/shared-db/issues/770#issuecomment-6135641172))
issued all four credentials and passed all four session/wrong-password/transaction proof
sets, then expired at RETRY_WINDOW_EXPIRED and verified journal-owned undo. Claude
independently re-verified all four passwords NULL at approximately 8:55 PM EDT.

Provider finding, established by Claude's supported read-only Supabase logs query and
supplied in Albert's chat brief: the provider log pipeline rewrites PASSWORD string
literals before storage. The exact stored backend statement at **8:22:50.073 PM EDT** on
October 12, 2026 is `statement: ALTER ROLE designflow_prod_backend_runtime PASSWORD '{REDACTED}'`.
The ten-character operand is literally `{REDACTED}`. The four issuance lines are
75/79/76/77 characters for backend/item_master/tracking/data_sync, respectively, too
short to contain either the reported 43-character plaintext or the 133-character verifier.
The current issuer produces 44 characters including base64 padding; this does not change
the redaction finding or any control.
Undo statements use `PASSWORD NULL`. This finding supersedes the earlier unknown
classification of that ten-character operand; it establishes no plaintext leak.

**Amended step 7 (blocking):** for each role require exactly one server-log statement
from issuing session S's pid in the complete issuance window. The statement portion must
be byte-exact `statement: ALTER ROLE <role> PASSWORD '{REDACTED}'`; standard provider
prefixes may precede `statement:`. Also accept the verifier-form statement only if its
operand equals that role's exact journal verifier. Any other operand/form, missing line,
duplicate matching-role line, or wrong pid fails. Independently require the exact
`ALTER ROLE <role> PASSWORD '<journal verifier>'` text in `pg_stat_statements` for
**each** role; a normalized `$1`, another verifier, or another role cannot substitute.
Retain complete count/read/count windows for all three sources and recursive plaintext
scans over the entire window and statement sink: zero hits. No raw response persistence,
log-setting change, logging suppression, permission change, credential exposure, or
weakened undo/journal/privacy control is authorized. Tests exercise exact `{REDACTED}`,
exact/mismatched verifier, all other forms, missing/duplicate/wrong-pid controls,
per-role statement-sink equality, and whole-window plaintext rejection.

The new private package requires fresh exact-head DeepSeek final-check APPROVE with
`--implementer codex`, then the native production gate, before its sole fresh invocation.
Every earlier marker stays consumed and immutable. Only dedicated `supabase_runtime_password`
fields may be promoted; existing fields remain protected. This plan branch is updated
without merge; Claude owns landing. Broader #770 cutover obligations remain separate.

**Amendment A (2026-10-12, after the first stage-B launch).** The one-shot stage-B launch at
4:18 PM EDT stopped at the admin connection with no write (#770 comment 6132379006, recorded
classification verbatim: "admin-connection: STAGE_B_PREFLIGHT_ABORTED /
CONNECTION_OR_PROTOCOL_FAILURE"; follow-up read-only diagnosis in the same comment: "the planned
aws-0 pooler hostname does not match the project's current hostname" and "Direct connection
still fails with network-unreachable errno 101"): the
code used an `aws-0` pooler hostname, but the project's pooler is
`aws-1-us-east-1.pooler.supabase.com` (Supabase pooler config; also
`docs/agents/references-and-runbooks.md`), and the direct host
`db.qsllyeztdwjgirsysgai.supabase.co` returned only an IPv6 address (`getent ahosts`,
2026-10-12) while the execution host edge-dev3
has no IPv6 route (errno 101). Amendment: every production connection in steps 4–8 uses the
Supavisor pooler at `aws-1-us-east-1.pooler.supabase.com`, verify-full with the pinned root —
**session mode, port 5432** replaces the "direct-port" connection for the issuer (user
`postgres.qsllyeztdwjgirsysgai`), the step-8 undo connection (also as
`postgres.qsllyeztdwjgirsysgai` — a runtime role cannot `ALTER ROLE`), and proofs 6(a)/(b) (user
`designflow_prod_<service>_runtime.qsllyeztdwjgirsysgai`); **transaction mode, port 6543**
remains blocking proof 6(c), which proves Supavisor transaction-mode SCRAM authentication for
each runtime role. It is **not** a claim about the services' deployed binding: today's production
contract forces Cloud SQL (`docs/production-promotion-app-tolerance-contract.md:82-86`) and the
Supabase branch at :96-99 is the non-production one; the services' production Supabase port and
user form are decided and proven in #770's separate four-service acceptance/cutover step (user
`designflow_prod_<service>_runtime.qsllyeztdwjgirsysgai`; the `<role>.<project ref>` form is
the one `docs/agents/references-and-runbooks.md:46` shows for the admin). The admin uses session mode
5432 (not the runbook's 6543) because the pid recorded in preflight (3) must be the same
backend that later runs the write; session mode keeps one backend for the whole client session,
while transaction mode may switch backends between transactions (an *assumption* from Supavisor
documentation; preflight (3) and the in-transaction pid re-check fail closed if it is wrong). Session mode on 5432 / transaction mode on 6543 is
Supabase's documented Supavisor port split (in-repo:
`docs/verification/supabase-pooler-idle-connection-drop-20260623.md:97` for 5432 and :99-100
for 6543; `docs/intake-426-triage-20260803.md:41,291` for production on `aws-1`). The hostname is a **reviewed constant** in the
issuer packet; it is not read at runtime. (The only provider API use in this action is the
supported log API read in steps 4 and 7.)
**Endpoint preflight (fail closed):** (0) libpq version >= 16 (so `require_auth` is
honoured), else stop. (1) credential-free: a TCP connect from edge-dev3 to the hostname
succeeds on 5432 and on 6543, and the raw probe socket's `getpeername()` is an IPv4 address; then, in the
authenticated session of preflight (2), libpq `PQhostaddr` (psycopg `conn.info.hostaddr`) is IPv4
(never `inet_server_addr()`, which through the pooler reports the backend side); no `hostaddr` pinning, consistent with repo doctrine in
`tools/coldlion-sync-common.mjs:212,243`, and `host` stays set for verify-full and passfile
matching); SSLRequest + TLS 1.3 verify-full against the
pinned Supabase root succeeds on both. (2) **Cluster identity:** TLS alone cannot tell
`aws-0` from `aws-1` (shared certificate), so the first authenticated step is a read-only
admin session (`postgres.qsllyeztdwjgirsysgai`, session mode 5432, `require_auth`) that must
succeed and must see exactly the four `designflow_prod_*_runtime` roles plus
`current_database()='postgres'`; a wrong cluster rejects the tenant and the run stops with no
write. (3) **pid validity:** in that same session, a harmless deliberately failing
`SELECT` (no secret) is issued and its server-log line must carry that session's
`pg_backend_pid()` (session mode binds one backend per client session), which also measures
ingestion lag. If the pid does not match, stop before any write (no fallback): the step-7
control is then unprovable and nothing is changed. **No cleartext to the pooler anywhere:** every connection that carries a password —
the step-4 admin session (pre-state probe, setting/sink/log-access/ingestion-lag/pid
preflights), the issuer, the undo, and all proof clients — uses `require_auth=scram-sha-256`
and a protected passfile keyed `aws-1-us-east-1.pooler.supabase.com:<5432|6543>:postgres:<user>:<password>`
(dbname `postgres`). **Passfile lifecycle:** written by the stage-B launcher only, mode 0600,
owner the run user, at the fixed path `/run/user/<uid>/770-stage-b/` on the
user runtime **tmpfs (memory-only)** (if `/run/user/<uid>` is absent or not tmpfs, stop before
any password is written) (directory 0700, created by the launcher; never on disk,
and cleared at logout/reboot), referenced by the `passfile` connection
parameter (never `PGPASSFILE` env); removed on every normal exit path by the launcher's
`finally`. **Residue sweep at start:** the launcher refuses to run if
`/run/user/<uid>/770-stage-b/` exists or is non-empty, if any log-response file exists in the
stage-B evidence directory, if any staged 1Password item has a `pending_password` or
`supabase_runtime_password` field, or if the persistent run journal (below) shows an
unfinished run; it
reports the residue and stops. Residue triggers the requirement-1 **recovery mode** (database
back to NULL if needed, run-created vault fields deleted, passfile shredded), never a new
issuance. At the end the directory is removed. The first, consumed
launch left none (Codex postcheck 4:42 PM EDT, #770 comment 6132379006: no residual passfiles
or log-response files, `pending_password` absent). The passfile tests (0600 creation, tmpfs location,
removal on abort, rollback and undo paths, `pending_password` cleanup on abort, residue-sweep
refusal, and that a passfile entry for the wrong port or wrong user is not used) run
**before production** as unit tests of the stage-B programs against isolated
PG17 and a fake vault — never by provoking failures in production. Because stage A's isolated PG17 cannot exercise Supavisor, these live preflights are
the evidence that the session-mode path works before the one-shot write; if any fails, stop
with no write. **Their decision logic is unit-tested before production** with recorded/fake
inputs: IPv6 vs IPv4 peer refused/accepted; wrong cluster (tenant-not-found error), three or
five runtime roles, or wrong `current_database()` each refused; pid mismatch refused;
unreadable Postgres or pooler log source refused; libpq < 16 refused. Changed by this amendment: endpoint, the "directly" wording in Success check,
the preflights above, `require_auth` scope, passfile lifecycle, Method step 1 (new guard test),
Method step 4 (endpoint and preflight order), the Supavisor preflight wording, and by
reference every production connection in steps 6(b) and 8 (same endpoint, user form,
`require_auth` and passfile as 6(a)). Preflight (3) is the ingestion-lag preflight; no
separate failing statement is issued. Everything
else is unchanged.
A fresh one-shot packet and exact-input review are required; the consumed launcher is never
replayed.

Revision 9 + Amendments A and B (historical initial no-write launch in Amendment A; subsequent written/authenticated/undone run and current proof correction in Amendment B). Revisions 1–8 got DeepSeek plan-review REJECT (runs
20261012T181315-1768589-27011, 20261012T181704-2222882-23133 and
20261012T182121-2343611-840, 20261012T182543-2382833-1180, 20261012T182919-2411551-20984, 20261012T183435-2457811-16013, 20261012T183851-2493077-780, all "method sound in
principle"); every finding is answered below. Stage A has run (isolated only); stage B history and current scope are recorded in Amendments A and B.

**Task classes.** (`ai-task-gates start --class CLASS [--reason TEXT] [--base REF]` is the
installed toolkit's documented syntax.) Stage A runs in the private designflow-backend #770 worktree under
`ai-task-gates start --class private-evidence --base 8afda0edfae275b6c85e9827c67483fd180f711f`
(the class the v23 rehearsal used). Stage B redeclares at whatever class
`ai-task-gates explain` reports for the production action and passes
`ai-task-gates check --before production`; a refusal stops the work.

**Two-stage authority.** An APPROVE of *this plan* authorizes only stage A: writing the private
verifier/issuer script and running steps 1–3 (isolated, no production). Stage B (steps 4–8, the
production write) requires a **second** exact-input APPROVE whose packet binds this plan's
commit and the issuer script by SHA-256 (path, commit and digest recorded in this file's
STATUS before that review), then `ai-task-gates check --before production
--reviewer-approval <that report>`. The production action executes only the script bytes whose
digest matches. **How the stage-B reviewer sees the bytes:** the private script is never pushed
to a public repo; it is reviewed exactly like the v23 timing action — through the installed
`ai-review-code-only.py create` export plus a governed DeepSeek code-only review, whose packet
carries the script bytes and their SHA-256. **Runtime enforcement:** the stage-B launcher
recomputes the SHA-256 of **every program that touches the plaintext or the production
connection** — issuer, 1Password writer, login-proof clients, log scanner, undo runner, all of
which live in the same private `scripts/cutover/` packet — immediately before step 2 and refuses
unless each equals the digest in the reviewed packet.

## Problem and why SCRAM verifiers are the correct control

Four runtime roles exist in production `qsllyeztdwjgirsysgai`, all `rolcanlogin=true`:
`designflow_prod_{backend,item_master,tracking,data_sync}_runtime`. Their passwords were
classified NULL on 2026-10-08 by user `postgres`; that is history and is re-proved in step 4.
Read-only evidence 2026-10-12: `postgres` holds `SELECT` on `pg_catalog.pg_authid` and
`pg_shadow` (`has_table_privilege`), so pre- and post-state are directly provable.

Fresh read-only evidence (2026-10-12, between the revision 1 and revision 3 commits;
`pg_settings` via `supabase_read_only_user`): `log_statement=ddl`,
`log_min_error_statement=error`, `log_error_verbosity=default`, `log_duration=off`,
`log_min_duration_statement=-1`, `log_min_duration_sample=-1`,
`log_transaction_sample_rate=0`, `log_{statement,parser,planner,executor}_stats=off`,
`auto_explain.log_min_duration=10000`, `pgaudit` preloaded but `pgaudit.log=none` and extension
not created, `pg_stat_statements.track=top` with `track_utility=on`,
`password_encryption=scram-sha-256`, `log_destination=csvlog`, `logging_collector=on`,
`log_line_prefix='%h %m [%p] %q%u@%d '` (each line and each CSV record carries the backend pid),
PostgreSQL 17.6. Statement-text sinks are therefore: the
server log (`log_statement`, `log_min_error_statement`), `pg_stat_statements`, and the
transient `pg_stat_activity.query` of the issuing session (visible only to `postgres` and
`pg_read_all_stats` members while the statement runs). The Management API is not used for
this action, so it is not a sink. Every sink can only ever contain what was sent: verifiers.

`log_statement=ddl` logs the full text of every successful `ALTER ROLE`, and
`log_min_error_statement=error` logs the text of every failing one. PostgreSQL never redacts a
password literal in either path. So a plaintext `ALTER ROLE ... PASSWORD 'x'` would be logged
**whether or not it fails**; the earlier sessions' target control (`log_error_verbosity`) does
not govern the `log_statement=ddl` success-path line (TERSE only drops some failure-context
detail), so it could never have made plaintext issuance safe. The only
way to keep a usable secret out of provider logs on this platform is to never send one: send a
pre-computed SCRAM-SHA-256 verifier. PostgreSQL documents that a password string already in
SCRAM verifier format is stored as-is (docs: CREATE ROLE, "PASSWORD"; `password_encryption`).
**Owner ruling (Albert Hazan, chat 2026-10-12, verbatim: "yes, drop the old ban and proceed").**
Asked directly whether he approves dropping the earlier AI-recorded ban on the SCRAM verifier
method, the owner said yes. The prohibition in `HANDOFF.d/2026-10-09T0400Z-...:66` and
`HANDOFF.d/2026-10-12T0008Z-...:71` is retired by the owner for #770 credential issuance; the
"provider redaction" success criterion of handoff §6 step 3 is replaced by this plan's Goal and
proofs. The reviewer judges technical merit only.

**Authority.** Owner ruling 2026-09-28 (Albert Hazan, verbatim: "never ask a human to approve
... ai has to do everything for me") makes technical route choices an AI decision gated by an
independent AI reviewer. The SCRAM prohibition was a technical route choice by an earlier AI
session, so retiring it is within the current Root's authority, subject to this review; it is
not presented as an owner decision. Root transfer and the production privilege evidence are
recorded on #770 (comments 6128727049 and 6130294501).

**Root ownership.** Albert asked this Claude chat on 2026-10-12 to "Resume popcre/shared-db #770
from" the 2026-10-12T0008Z handoff and to "finish recovery and four-service production
acceptance"; Root for #770 therefore passed to this session (recorded on #770 with the v23
result). The handoff's "no new scope" line concerned that Codex wrap-up, not its successor.

**Retirement of the recorded SCRAM prohibition (by the current #770 Root, with reasons).**
`HANDOFF.d/2026-10-09T0400Z-...:66` (Codex Root, an AI session — not an owner ruling) required
"provider-scoped fatal/error redaction or documented equivalent ... tested with DUMMY
fatal/error proof" and in the same sentence listed "No ... SCRAM verifier workaround";
`HANDOFF.d/2026-10-12T0008Z-...:71` repeats only the prohibition. That prohibition assumed a
redaction control could exist. On this platform it cannot: `log_statement=ddl` writes the
*successful* `ALTER ROLE` text, and no Supabase-exposed setting redacts statement text
(`log_error_verbosity` is not even settable, and would not cover the success path). The one
setting that would hide the success line, a session `SET log_statement='none'` (superuser-only
on stock PostgreSQL), is itself the logging reduction both handoffs forbid, and would still
leave `pg_stat_statements` as a plaintext sink — so it was considered and rejected. Under the
recorded rule, no password could ever be issued, so #770 could never finish — that is a
deadlock, not a safety property. The rule's purpose is the Goal below; this plan meets that
purpose by never sending a secret. Claude chat 16164463-0b2e-4ea7-a039-2d3d59cd5d21, acting as
#770 Root (owner instruction to pursue this route, Albert, chat 2026-10-12: "yes, go ahead with
the reviewer check"), retires the SCRAM prohibition for this action. Per the owner ruling of
2026-09-28 the gate is the independent AI reviewer, who is asked to judge the route **on its
technical merits against the Goal**, not against the retired line. The handoffs stay immutable;
this retirement is recorded here and on #770.

**Premise proof (step 3 adds it):** on isolated real PG17 with production's logging settings,
issue a DUMMY plaintext `ALTER ROLE dummy PASSWORD '<DUMMY>'` and show the DUMMY string *does*
appear in the server log (success and failure) — proving plaintext issuance is unsafe and
redaction is absent — then show a verifier issuance logs only the verifier.

## Amendment A — binding implementation requirements

These resolve the Amendment A review rounds and override any looser wording above.

1. **Single process, in-memory secret path.** One stage-B process (the launcher) performs, in
   order: residue sweep → credential-free preflights (0) and (1) → tmpfs directory creation →
   admin password read from 1Password and written as the admin passfile entry → preflights
   (2) and (3) → password generation → verifier build/guard → runtime-role passfile entries
   appended → 1Password `pending_password` write → step 5 → steps 6–7 → **promotion**: rename
   `pending_password` to a **new, dedicated field** `supabase_runtime_password` on each staged
   item → passfile and directory removal. **No existing vault field is ever modified:**
   production still runs Cloud SQL and the services' current secret fields stay untouched;
   wiring services to `supabase_runtime_password` belongs to #770's cutover step. So no
   pre-state snapshot is needed. Step 8 undo runs on any failure from step 5 on; if session S
   has been dropped, undo opens a fresh admin session on 5432 (same endpoint, `require_auth`,
   passfile) after re-proving cluster identity. **Promotion failure** (after a successful step
   7): step 8 (database back to NULL), delete every `pending_password` and any
   `supabase_runtime_password` this run created, tag `770-aborted-<timestamp>`, stop.
   **Crash after commit:** the next launcher start finds residue (tmpfs directory or
   `pending_password`) and enters **recovery mode** only — re-prove target and cluster
   identity on a fresh admin session, read the four `rolpassword` values format-only; if any is
   SCRAM, run step 8; delete `pending_password` and any run-created `supabase_runtime_password`;
   tag `770-recovered-<timestamp>`; record on #770; stop. Recovery deliberately discards even a
   possibly successful issuance (its log proof is incomplete); a fresh packet re-issues.
   **Run journal:** before step 5 the launcher writes an append-only journal file in the
   protected evidence mount (no secrets: run id, phase markers, item ids, field ids it
   created). It is closed `DONE` only after a successful run or a *verified* undo (format-only
   read shows all four NULL and run-created fields are gone). If undo itself fails, the journal
   stays open, `pending_password` is **not** deleted, and the run stops `UNDO_FAILED`; the next
   start sees the open journal and enters recovery mode (it is never skipped by a missing tmpfs
   directory). "Run-created" fields are exactly those recorded in the journal; promotion refuses
   if `supabase_runtime_password` already exists on any item (checked in the residue sweep).
   **Vault operation:** promotion uses the 1Password SDK item edit that **adds** the field
   `supabase_runtime_password` with the plaintext and then removes `pending_password`
   (add-then-delete, never a label rename), re-reading the item and comparing digests between
   the two calls, so no step leaves the item without a copy. A stage-A rehearsal runs this
   exact sequence against a **dedicated throw-away item** in vault `vibe_coding` with DUMMY
   values (created and archived by the rehearsal), proving the real SDK semantics.
   Unit tests (fake vault + isolated PG17) cover: promotion failure on the 1st, 2nd and 4th
   item; recovery mode after a simulated post-commit crash; undo with S dropped; and that no
   pre-existing vault field is ever written. The plaintexts
   never leave that process except into (a) the tmpfs passfile, written by that same process,
   and (b) the 1Password SDK call. The admin password is read from 1Password by the same
   process. Passfile fields are escaped per libpq (`\` before `:` and `\`); a test covers an
   admin password containing `:`, `\` and a leading `*`.
2. **Digest binding covers every module the launcher imports or executes.** Two digests
   are recorded in the reviewed packet and recomputed by the launcher: (a) the package digest
   below over the stage-B package directory, which also contains a copy of the stage-A
   `scram_verifier` module; and (b) a runtime digest over the interpreter binary, the venv's
   `psycopg` distribution `RECORD` file hashes, and the libpq shared object actually loaded
   (`psycopg.pq.__impl__` and `pq.version()` plus file SHA-256). Either mismatch refuses
   (preflights,
   passfile writer, issuer, vault writer, proof clients, log scanner, undo). Algorithm: list
   every regular file under the stage-B package directory (launcher included), sort by
   POSIX-relative path bytes, and SHA-256 over `path\0sha256(file)\n` lines; symlinks or
   non-regular files refuse. The reviewed packet records this value; a test tampers one byte
   of one module and one added file and asserts refusal.
3. **Memory hygiene.** The launcher sets `RLIMIT_CORE=0` and `PR_SET_DUMPABLE=0` at start; the
   passfile lifecycle's "never on disk" wording is narrowed to: plaintext is not written to any file other than the tmpfs
   passfile; host swap remains a stated residual (same-UID trusted host, as in the #770
   handoff's existing residuals).
4. **Preflight order and numbering** (supersedes the inline list): (0) libpq ≥ 16; (1)
   credential-free TCP+TLS on 5432 and 6543, raw socket peer IPv4; (2) authenticated admin
   session S on 5432: `PQhostaddr` IPv4, cluster identity (four runtime roles,
   `current_database()='postgres'`); (3) in S, outside any transaction, one failing `SELECT`;
   its Postgres log line must carry S's `pg_backend_pid()`. **Step-7 retry window:** poll every
   60 s until max(15 minutes, 3× the lag measured in (3)); if that exceeds 60 minutes, stop at
   preflight with no write.
   Step 6(0)'s `pg_authid` read and step 8 run on session S.
5. **Same connection.** Step 5 runs on session S (the same client connection as (2)–(3)); the
   pid recorded in (3) is re-read inside the step-5 transaction and must be equal, else
   rollback and stop. Pid matching is used only within the issuance window as corroboration
   together with role names and the transaction's timestamps.
6. **Service-path scope.** 6(c) proves that Supavisor transaction mode authenticates each role
   by SCRAM; it is **not** the services' own node-postgres path, which belongs to the separate
   four-service acceptance step of #770. If Supavisor ever requests cleartext, `require_auth`
   aborts the proof and step 8 undoes — accepted, because a cleartext pooler path would itself
   violate the Goal.
7. **Verifier guard** is decode → re-encode equality plus key recomputation (as implemented in
   `scram_verifier.parse`/`guard`), not the regex alone.

## Goal (stated precisely)

No plaintext password ever appears in provider logs, pooler logs, client logs, argv, process
environment (`PGPASSWORD`, `/proc/<pid>/environ`), connection strings/DSNs, transcripts or Git
during this issuance action (steps 1–8). Later routine service logins are SCRAM exchanges in
which the plaintext never leaves the client; the services' own handling of their secret is the
existing DesignFlow secret-manager path and is out of this plan's scope — on success or failure. SCRAM verifiers appear in `pg_stat_statements`; the provider server log stores
`{REDACTED}` for PASSWORD literals (Amendment B), while isolated PG17 retains verifier text; a verifier alone cannot log in, and becomes usable only together with a
successful server impersonation of a client. That residual is accepted **only** while every
client verifies the pinned Supabase CA, which stage B makes a blocking gate on the deployed
images. If any client stops verifying, the verifiers must be treated as compromised and the four
passwords rotated.

## Method

1. **Verifier tool** — new private script `scripts/cutover/scram_verifier.py` in the existing
   private #770 designflow-backend branch (never pushed): stdlib only
   (`hashlib.pbkdf2_hmac`, `hmac`, `secrets`), RFC 5802/7677, 4096 iterations, 16-byte salt,
   output `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>` with **standard base64 (RFC 4648
   §4, `+/` and `=` padding)** for all three fields, which PostgreSQL's verifier parser
   requires. Reads the password only from an inherited file descriptor; never
   argv/env/stdout. Unit tests against the RFC 7677 test vector, and against libpq
   `PQencryptPasswordConn` output by parsing its salt and iteration count and re-deriving the
   verifier with the tool (libpq picks a fresh salt per call).
   **Guard tests (stage A deliverable):** accept the tool's own output; reject base64url
   alphabet, missing padding, wrong padding, non-canonical padding bits, salt not 16 bytes,
   key not 32 bytes, wrong iteration count, wrong prefix, tampered StoredKey/ServerKey,
   trailing whitespace/newline, and a raw password string; **`require_auth` test** (Amendment
   A): against isolated PG17, (1) `hba` = `password` for a role with a SCRAM verifier, and (2)
   `hba` = `md5` for a role whose stored password is an **MD5** verifier (stored by issuing that role's `ALTER ROLE ... PASSWORD`
   in a session with `SET password_encryption='md5'`, so the server really requests MD5), in **both**
   cases a client with `require_auth=scram-sha-256` must fail with libpq's `require_auth`
   refusal error, and a wire capture on the isolated socket must show no
   PasswordMessage sent by the client (libpq still sends the startup packet with
   user/database); plus an end-to-end test proving a
   rejected verifier never opens a database connection (connection factory spy). **Send-path
   test:** the spy captures every outbound SQL text and parameter for an accepted run and
   asserts each `PASSWORD` operand matches the verifier grammar and that no plaintext byte
   sequence appears anywhere in outbound traffic.
   **Fail-closed send guard:** immediately before step 5 every verifier must match
   `^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$`, decode to
   16/32/32 bytes, and recompute byte-identical from the plaintext and decoded salt; any
   mismatch aborts before a connection opens (a malformed string would be hashed as plaintext
   and its literal logged).
2. **Password generation and custody (stage B only; stage A uses DUMMY values and writes
   nothing to 1Password)** — new plaintexts are written to a **new field** `pending_password`
   on each staged item, never over an existing value; on success (step 7 passes) it is renamed
   to the new dedicated field `supabase_runtime_password` (Amendment A requirement 1); no
   field a deployed service reads today is touched; on any abort before step 5, step-5 rollback, or step-8 undo the
   `pending_password` field is deleted and the item is tagged `770-aborted-<timestamp>`, so the
   vault never claims a credential the database does not hold — one protected issuer process generates 32 random
   bytes from `secrets`, encodes them base64url (this is the password itself, not a verifier
   field), and calls the step-1 verifier function in-process (the fd interface is used only
   when the CLI entrypoint is invoked by tests); the plaintext is written to the existing staged 1Password items (references recorded at
   `HANDOFF.d/2026-10-08T1749Z-edge-dev3-codex-770-production-continuation.md:88`: backend,
   item-master, tracking, sync; presence is checked fail-closed before generation) in vault
   `vibe_coding` through the 1Password SDK/`op` reading from stdin (never argv), serialized
   under the existing op-access lock. Read back and compare digest only.
3. **Isolated byte-equality proof (real PG17, network-isolated bwrap like the #770
   rehearsal)** — the issuing statements run as a **non-superuser** role created to mirror
   production (`CREATEROLE`, `ADMIN OPTION` on the target role, `SELECT` on `pg_authid`
   granted by the superuser); the superuser is used only for setup. Create a test role, `ALTER ROLE ... PASSWORD '<verifier>'`, read
   `pg_authid.rolpassword`, assert byte-equal to the verifier; then log in with the plaintext
   over SCRAM and succeed; log in with a wrong password and fail. Also capture the server log
   with `log_statement=ddl` and `log_min_error_statement=error` and prove only the verifier
   (never the plaintext) appears, for one success and one forced failure; plus the DUMMY
   plaintext premise proof above; plus an **isolated undo test** (set verifier, then
   `PASSWORD NULL`, assert `rolpassword IS NULL` and login refused).
4. **Production issuer** — role `postgres` via the vault production admin item, connecting as
   `postgres.qsllyeztdwjgirsysgai` to `aws-1-us-east-1.pooler.supabase.com:5432` (session mode),
   verify-full with the pinned root, `require_auth=scram-sha-256`, protected passfile; the
   Amendment A endpoint preflights (0)–(3) run first, in this order, before anything below. Read-only
   evidence: `postgres` has `CREATEROLE` and `ADMIN OPTION` on all four runtime roles
   (`pg_auth_members`, 2026-10-12), which PostgreSQL 17 requires for `ALTER ROLE ... PASSWORD`.
   Before the write: prove target (`current_database`, pinned CA verify-full, project ref
   `qsllyeztdwjgirsysgai` assertion). **Pre-state proof:** a format-only query over
   `pg_authid` returning, per role, only `CASE WHEN rolpassword IS NULL THEN 'NULL' WHEN
   rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'SCRAM' ELSE 'OTHER' END`. All four must be `NULL`;
   otherwise stop before any write (an existing credential would be overwritten
   irrecoverably). Because the pre-state is proved NULL, undo to NULL is an exact restore.
   **Setting preflight:** re-read `password_encryption` (must be `scram-sha-256`) and
   `log_line_prefix` (must contain `%p`) immediately before step 5; otherwise stop.
   **Supavisor preflight:** it is an *assumption*, from Supabase pooler documentation, that the
   pooler requests SCRAM from clients (the 2026-10-08 probe was credential-free and cannot
   show the auth method); it is proven by the live preflight (2) handshake; `require_auth` on every password-carrying
   connection (admin session, issuer, undo, proof clients) makes a wrong assumption fail closed
   before any password is sent.
   **Ingestion-lag preflight:** this is Amendment A preflight (3) — its single deliberately
   failing `SELECT` (no secret) is the only one issued; its log lag sets the step-7 window.
   **Pooler logs:** no pooler-log gate. Every password-carrying connection uses
   `require_auth=scram-sha-256`, so the pooler never receives a plaintext and cannot log one;
   step 7 reads the Supavisor log window as **non-blocking corroboration** only (scanned for each
   plaintext; any hit is still a failure → undo).
   **Sink preflight:** `pg_stat_statements` view exists in the target database and is readable by
   the proof user; if not, stop before the write. **Log-access preflight:** before the write, read one recent window of provider Postgres
   logs through the supported Supabase log API and confirm entries are returned; if not, stop
   before the write.
5. **Production write** — one transaction containing four **separately executed** statements
   (one `ALTER ROLE <role> PASSWORD '<verifier>'` per protocol message, never a
   multi-statement string), for exactly those roles; commit. The only text that can reach logs is four
   verifiers.
6. **Production post-check** — (0) for each role read only
   `encode(sha256(convert_to(rolpassword,'UTF8')),'hex')` from `pg_authid` and assert it equals
   the locally computed SHA-256 of that role's verifier (proves verbatim storage without
   echoing the verifier); then (a) pooler session-mode (port 5432)
   login with the plaintext over SCRAM succeeds; (b) wrong password fails; (c) **blocking
   gate:** login through Supavisor pooler port 6543 succeeds, retried every 30 s for up to
   10 minutes, each attempt on a **new** client connection (fresh pooler session), and the same retry policy applies to 6(a) on session mode 5432, to absorb pooler auth-cache refresh before it counts as a failure. The 2026-10-08
   `SUPAVISOR_AUTH_QUERY_SECRET_FORMAT` classification occurred when all four passwords were
   NULL; the inference (not proven) is that the auth query found no secret. This gate proves
   or disproves it. **No cleartext fallback:** the proof client uses libpq
   `require_auth=scram-sha-256` (PG16+ libpq; a preflight before step 4 asserts
   `psycopg.pq.version() >= 160000` and stops before any write otherwise), which refuses any server request for a cleartext
   password, so the plaintext never crosses the wire to the pooler. All proof clients (and the
   issuer) receive the password only through a mode-0600 libpq `passfile` in the Amendment A tmpfs
   path, never via `PGPASSWORD`, DSN or argv; a stage-A test asserts the child environment and
   argv contain no plaintext; and step 7 also scans the
   Supavisor (pooler) logs from the supported log API for the same window. The pooler presents the same Supabase-rooted chain: the 2026-10-08
   credential-free probe completed TLS 1.3 verify-full against the pinned root on the pooler
   (`HANDOFF.d/2026-10-09T0400Z-...:60`), and each run of 6(c) uses verify-full with that
   pinned CA. Any failure = undo.
7. **Log proof on production** — fetch the **entire** provider Postgres and pooler log
   windows from one minute before the transaction to five minutes after through the
   supported API. Apply Amendment B's exact per-role, same-session-pid server-log
   control: one literal `{REDACTED}` statement, or one exact journal-verifier statement.
   Every other operand/form, missing/duplicate/wrong-pid control fails. Poll within
   max(15 minutes, 3× measured preflight lag), retaining the existing bounds. Require
   each role's exact journal verifier in `pg_stat_statements`, never normalized `$1`
   alone. Scan all complete source windows and statement rows recursively for all
   registered plaintext: zero hits. Keep raw response bodies in process memory only.
   Unavailable/incomplete windows or unmet controls fail closed into step 8 undo.
8. **Undo** — `ALTER ROLE <role> PASSWORD NULL` for the four roles returns exactly to the
   step-4 proved pre-state (all NULL); runs automatically if any step-6 or step-7 gate fails
   (a step-5 error inside the transaction rolls back and needs no undo; the format-only query
   still runs to prove all four NULL),
   then the step-4 format-only `pg_authid` query must show all four `NULL` again.

## Why a logged verifier is not a usable secret

SCRAM login needs ClientKey; the verifier holds StoredKey = H(ClientKey) and ServerKey only.
Offline guessing of a 256-bit random password through 4096-iteration PBKDF2 is infeasible.
**Load-bearing residual:** someone holding StoredKey + ServerKey who can also act as the server
to a client (man-in-the-middle) can recover ClientKey from that client's proof and then log in.
So a logged verifier is safe only while every client verifies the server certificate. All four
services pin the Supabase root CA
with `rejectUnauthorized: true` **and** `ca: require('./certificates/supabase-root-2021')`, each
in its own repository's `config/database-pool.js` line 54. Supplying `ca` makes Node's TLS
trust only that certificate set instead of the system store, which is pinning to the Supabase
root (PEM SHA-256 `70072358142...`, per each repo's `config/certificates/README.md`)
(`popcre/designflow-backend` 9402a88f0, `popcre/designflow-item-master` 4aa6850c,
`popcre/designflow-tracking` e88793a0 — all `sandbox-albert`; `popcre/designflow-data-syncing`
c88a43d on `develop`), and each repository's `config/database-connection-contract.js`
refuses Supabase without `DB_SSL=true` (source verified at those commits on 2026-10-12).
**Stage B blocking gate:** re-verify this pinning in the exact image/commit each service will
run against Supabase, and refuse stage B if any service does not verify. (The
`fix_connection_pool.md` "SSL off" note describes the current private-VPC Cloud SQL path, not
the Supabase path.) The issuing and proof clients in this plan also use verify-full with the
pinned CA.

## Success check

All four roles authenticate through Supavisor session mode (5432) and transaction mode (6543) with their 1Password secrets; wrong
passwords fail; provider logs satisfy Amendment B and show no plaintext; logging settings unchanged; the separately
closed credential incident untouched.

## Not in scope

Cutover, PITR, writer fencing, app business acceptance, any logging change, any unsupported
API setter.

## Review findings answered (revision 1 → 2)

1. Byte-equality proved on real PG17 (step 3); production uses behavioural login proof (step 6).
2. Supavisor login is now a blocking gate with the prior observation explained (step 6c).
3. Plan now targets the correct controls (`log_statement=ddl`, `log_min_error_statement`) with
   fresh evidence, and the log proof covers success and failure (steps 3, 7).
4. TLS mode verified for all four services (section above).
5. Undo defined and automatic (step 8).
6. Issuer privilege proved read-only (step 4).
7. Assertion named: behavioural, now direct: `postgres` reads `pg_authid` on Supabase (step 6).
8. Tool and custody specified, no argv exposure (steps 1–2).
9. Registered from the successor handoff; task class and gate stated (STATUS).
10. Prior reason engaged: plaintext issuance is unsafe under `log_statement=ddl` regardless of
    error verbosity (Problem section).
11. STATUS section added.

## Revision 2 → 3 findings answered

1. Pre-state no longer relied on; undo sets explicit NULL (step 4, step 8).
2. Whole-window local scan, retention bound, log-access preflight, fail-closed undo (steps 4, 7).
3. Fail-closed verifier grammar/round-trip guard before send (step 1).
4. Prohibition provenance and supersession authority stated (Problem section).
5. Stage B binds script by SHA-256 (STATUS).
6. Two-stage authority stated (STATUS).
7. TLS evidence cited per repository and commit.
8. All statement sinks enumerated, `pg_stat_statements` added to the proof.
9. `log_error_verbosity` wording corrected.
10. Base64 alphabets explicit.
11. Timestamps replaced by commit-relative provenance.
12. Supavisor cause labelled an inference.

## Revision 3 → 4 findings answered

H1/M2: `postgres` can read `pg_authid` (proved); pre-state NULL is required and proved, undo is
exact. H2: positive control with bounded retry. M3: guard tests listed. M1/L2: residual stated
precisely, pinning is a stage-B blocking gate, pooler TLS cited. M4: equivalence is now an
explicit reviewer decision. M5: task classes stated. L1: LOGIN flags proved. L3: row must
exist, stored form recorded. L4: registered in `docs/agents/active-contracts-and-plans.md`.
L5: `pg_stat_activity` and Management API addressed.

## Revision 4 → 5 findings answered

 H1 prohibition retired by current Root with reasons, reviewer judges merits;
H2 DUMMY premise proof added; M1 pooler logs scanned and cleartext fallback refused
(`require_auth`); M2 1Password item references cited and presence-checked; M3 send-path test;
L1 citation fixed; L2 `--base` documented; L3 rollback path and isolated undo test; L4
in-process generator/tool interface.

## Revision 5 → 6 findings answered

H1 stage-B reviewer sees the bytes through the code-only export; launcher enforces the digest.
H2 Goal restated precisely with the TLS-conditional residual and rotation rule. M1 isolated
proof issues as a production-mirroring non-superuser. M2 pooler retry window. M3 separately
executed statements. M4 libpq version preflight. L1 headings fixed. L2 Root ownership stated
and recorded on #770; production privilege evidence posted on #770. L3 stage A writes no
secrets.

## Revision 6 → 7 findings answered

H1 pinning is `ca:` (trust only the Supabase root), cited. H2 environment/DSN added to Goal,
passfile only, stage-A test. M1 authority stated from the 2026-09-28 owner ruling and #770
comments. M2 `pg_stat_statements` preflight; lines matched by role and issuing backend pid. M3
every plaintext-touching program digest-bound. M4 `pending_password` custody with abort cleanup.
M5 session `log_statement` suppression considered and rejected. Lows: libpq comparison by
re-derivation; `pg_authid` wording reconciled; fresh pooler session per retry.

## Revision 7 → 8 findings answered

M2 `log_line_prefix` read (has `%p`). M3 Goal scoped to the issuance action, runtime residual
stated. M4 `password_encryption` re-asserted right before the write. L5 field name proved from
service secret mapping in stage B. L6 pooler and ingestion-lag preflights before the write.
H1 (authority to retire the earlier AI-recorded prohibition): see Authority section; the owner
ruled directly (quoted at the top of the Problem section).

## Amendment A review rounds

Plan-review runs 20261012T205156-4109415-26928, 205416-4125923-31354, 205713-244450-3085,
210136-735259-14089, 210733-1594943-24368, 211249-1988165-19859, 211708-2374281-9048 and
212118-2874533-23095 (all REJECT, each finding addressed in Amendment A and its binding
requirements above).

## Question for the reviewer

Judge the route on its technical merits against the Goal.
For Amendment A: is the pooler route with the binding requirements sound for a fresh stage-B
packet (to be separately exact-input reviewed)? Original question: does this plan meet the
privacy goal, and does it justify stage A (script + isolated steps
1–3 only)? APPROVE or name the specific remaining gap. Stage B is reviewed separately.

Posted by Claude chat 16164463-0b2e-4ea7-a039-2d3d59cd5d21 on edge-dev3
