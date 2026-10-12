# Plan: #770 production service credentials via pre-computed SCRAM verifiers

Issue: [popcre/shared-db#770](https://github.com/popcre/shared-db/issues/770). Owner instruction
(Albert, chat, 2026-10-12, verbatim: "yes, go ahead with the reviewer check").
Registered from the #770 successor handoff
[`HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md`](HANDOFF.d/2026-10-12T0008Z-edge-dev3-codex-770-recovery-production.md) §6 step 3.

## STATUS

Revision 9. Revisions 1–8 got DeepSeek plan-review REJECT (runs
20261012T181315-1768589-27011, 20261012T181704-2222882-23133 and
20261012T182121-2343611-840, 20261012T182543-2382833-1180, 20261012T182919-2411551-20984, 20261012T183435-2457811-16013, 20261012T183851-2493077-780, all "method sound in
principle"); every finding is answered below. Nothing has been executed.

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

## Goal (stated precisely)

No plaintext password ever appears in provider logs, pooler logs, client logs, argv, process
environment (`PGPASSWORD`, `/proc/<pid>/environ`), connection strings/DSNs, transcripts or Git
during this issuance action (steps 1–8). Later routine service logins are SCRAM exchanges in
which the plaintext never leaves the client; the services' own handling of their secret is the
existing DesignFlow secret-manager path and is out of this plan's scope — on success or failure. SCRAM verifiers do appear in the server log and
`pg_stat_statements`; a verifier alone cannot log in, and becomes usable only together with a
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
   trailing whitespace/newline, and a raw password string; plus an end-to-end test proving a
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
   on each staged item, never over an existing value; on success (step 7 passes) the field is
   promoted to the field name the stage-B packet proves each service's secret loader reads
   (verified from each service's deployment secret mapping before stage B); on any abort before step 5, step-5 rollback, or step-8 undo the
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
4. **Production issuer** — role `postgres` via the vault production admin item. Read-only
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
   **Supavisor preflight:** confirm from Supabase pooler documentation and the 2026-10-08 probe
   that the pooler requests SCRAM from clients; the proof client's `require_auth` makes a
   wrong assumption fail closed before any plaintext is sent.
   **Ingestion-lag preflight:** before the write, run one harmless read-only statement that
   is logged (a deliberately failing `SELECT` on a non-existent relation under
   `log_min_error_statement=error`, containing no secret) and measure how long it takes to
   appear in the log API; the step-7 retry window is at least 3× that.
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
   echoing the verifier); then (a) direct-port
   login with the plaintext over SCRAM succeeds; (b) wrong password fails; (c) **blocking
   gate:** login through Supavisor pooler port 6543 succeeds, retried every 30 s for up to
   10 minutes, each attempt on a **new** client connection (fresh pooler session), to absorb pooler auth-cache refresh before it counts as a failure. The 2026-10-08
   `SUPAVISOR_AUTH_QUERY_SECRET_FORMAT` classification occurred when all four passwords were
   NULL; the inference (not proven) is that the auth query found no secret. This gate proves
   or disproves it. **No cleartext fallback:** the proof client uses libpq
   `require_auth=scram-sha-256` (PG16+ libpq; a preflight before step 4 asserts
   `psycopg.pq.version() >= 160000` and stops before any write otherwise), which refuses any server request for a cleartext
   password, so the plaintext never crosses the wire to the pooler. All proof clients (and the
   issuer) receive the password only through a mode-0600 libpq `passfile` inside the protected
   mount, never via `PGPASSWORD`, DSN or argv; a stage-A test asserts the child environment and
   argv contain no plaintext; and step 7 also scans the
   Supavisor (pooler) logs from the supported log API for the same window. The pooler presents the same Supabase-rooted chain: the 2026-10-08
   credential-free probe completed TLS 1.3 verify-full against the pinned root on the pooler
   (`HANDOFF.d/2026-10-09T0400Z-...:60`), and each run of 6(c) uses verify-full with that
   pinned CA. Any failure = undo.
7. **Log proof on production** — fetch the **entire** provider Postgres log window from
   1 minute before the transaction to 5 minutes after (well inside retention) through the
   supported log API into protected custody, and scan it locally. **Positive control first:**
   exactly one `ALTER ROLE` statement line naming each of the four roles must be present,
   matched by role name **and** by the issuing connection's backend pid (recorded at step 5)
   so unrelated `ALTER ROLE` activity in the window cannot satisfy or break it (retry the
   fetch every 60 s for up to 15 minutes to absorb ingestion lag). Then: each plaintext occurs
   zero times; each of those lines contains its verifier and nothing password-like. Also read
   the `pg_stat_statements` row(s) for `ALTER ROLE`: at least one row must exist; record its
   stored text form (verbatim verifier or normalized `$1`) and scan it the same way. If the
   positive control is not met in 15 minutes, or the window cannot be fetched in full, the
   proof is failed: step 8 undo runs (fail closed), then stop.
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

All four roles authenticate directly and through Supavisor with their 1Password secrets; wrong
passwords fail; provider logs show only verifiers; logging settings unchanged; the separately
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

## Question for the reviewer

Judge the route on its technical merits against the Goal.
Does this plan meet the privacy goal, and does it justify stage A (script + isolated steps
1–3 only)? APPROVE or name the specific remaining gap. Stage B is reviewed separately.

Posted by Claude chat 16164463-0b2e-4ea7-a039-2d3d59cd5d21 on edge-dev3
