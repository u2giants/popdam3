// Regression guards for the TEMPORARY status snapshot + change log
// (supabase/migrations/20260803200000_temp_status_watch_snapshot_and_change_log.sql).
//
// Context: core.property.status and core.licensor.status are curated BY HAND, production's
// plm.import_master_data force-sets them to 'active' on every matched row, and there is no
// audit trail. Albert asked (2026-08-03) for a snapshot of all 256 property statuses plus a
// running record of changes, explicitly marked temporary and to be deleted after cut-over.
//
// These are static assertions over the migration SQL, in the style of the other
// tools/*.test.mjs guards. Each one encodes a defect this repository has ALREADY shipped at
// least once, and every one of those defects installed cleanly and looked correct in review:
//
//   1. A NULL-permissive privilege guard `if not ( ... or auth.role() = 'service_role' )`.
//      auth.role() is NULL in a migration, so `not (NULL)` is NULL and the `if` never fires.
//   2. A BEFORE trigger reading a GENERATED ... STORED column, which Postgres populates only
//      after before-triggers, so the guard always compared against NULL and did nothing.
//   3. A free-text "named human" field (plm.taxonomy_circuit_breaker.reset_by) that an
//      automated actor filled in with its own name, so the audit trail read like a person.
//   4. Two migrations sharing one 14-digit version, which SILENTLY skips one of them.
//   5. A "temporary" artefact with no written deletion trigger, which becomes permanent.
//
// If a future change reintroduces any of them here, these fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const MIGRATION = "20260803200000_temp_status_watch_snapshot_and_change_log.sql";
// Line endings are normalised on read: this repo is checked out CRLF on Windows and LF in
// CI, and several assertions below match across line breaks. Without this the same test
// passes on one platform and fails on the other.
const readSql = (name) => readFileSync(path.join(migrationsDir, name), "utf8").replace(/\r\n/g, "\n");

const sql = readSql(MIGRATION);

// `sql` includes the long explanatory header. Several assertions below are of the form
// "this shape must NOT appear", and the header deliberately QUOTES those shapes in order to
// explain why they are wrong. Testing against the raw file would therefore fail on the
// documentation rather than on the code, so those assertions run against `code`: the same
// file with every `--` comment line removed.
// Whole-line `--` comments are dropped; so are trailing `--` comments, but only on lines
// that contain no quote, so a `--` inside a string literal is never mistaken for a comment.
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .map((line) => (line.includes("'") ? line : line.replace(/--.*$/, "")))
  .join("\n");

// `code` still contains the COMMENT ON ... statements, whose bodies also quote the bad
// shapes in order to warn about them (the warning has to live in the database, not only in
// the file). For "this shape must NOT appear" assertions, use `executable`: code with the
// COMMENT ON statements removed too — i.e. only DDL and function bodies.
const executable = code.replace(/comment on [\s\S]*?';/gi, "");

// Each CREATE TRIGGER statement, isolated, so a regex cannot run past a statement boundary
// and pair one trigger's name with a later trigger's table.
const triggerStatements = [...code.matchAll(/create trigger[\s\S]*?;/gi)].map((m) => m[0]);

// A COMMENT ON ... statement's body is a single-quoted string that may itself contain
// semicolons, so a non-greedy match to the first `;` truncates it. Match to `';` instead.
const commentOn = (target) => {
  const m = sql.match(new RegExp(`comment on ${target} is[\\s\\S]*?';`, "i"));
  assert.ok(m, `expected a COMMENT ON ${target}`);
  return m[0];
};

// ---------------------------------------------------------------------------------------
// Version hygiene
// ---------------------------------------------------------------------------------------

test("the migration version is unique across the whole migrations directory", () => {
  const versions = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, 14));
  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
  assert.deepEqual([...new Set(dupes)], [], "duplicate 14-digit versions SILENTLY skip a migration");
});

test("the migration sorts strictly after every other migration present when it was authored", () => {
  const versions = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
  // Both files of this artefact must sort after everything that existed before them.
  const mine = ["20260803200000", "20260803201000"];
  const others = versions.filter((v) => !mine.includes(v));
  assert.ok(
    others.every((v) => v < mine[0]),
    "a migration that sorts before the remote max forces --include-all at promotion time",
  );
  assert.ok(mine[0] < mine[1], "the hardening must sort after the file it hardens");
});

// ---------------------------------------------------------------------------------------
// Defect 1 — the NULL-permissive privilege guard
// ---------------------------------------------------------------------------------------

test("no guard branches on auth.role() at all", () => {
  // The append-only enforcement raises unconditionally, so there is no expression a NULL
  // role can satisfy. auth.role() is READ (to record it) but never TESTED.
  const guardBody = sql.slice(sql.indexOf("function temp_status_watch.reject_mutation"));
  const guardFn = guardBody.slice(0, guardBody.indexOf("$$;") + 3);
  assert.ok(!/auth\.role\s*\(\s*\)/i.test(guardFn), "the append-only guard must not test auth.role()");
  assert.ok(/raise\s+exception/i.test(guardFn), "the append-only guard must raise");
  assert.ok(
    !/if\s+not\s*\(/i.test(guardFn),
    "an `if not ( ... )` guard is the shape that goes NULL-permissive; the guard is unconditional",
  );
});

test("auth.role() never gates a decision — it is only captured, then labelled", () => {
  // The only permitted use is `v_role := auth.role();` to RECORD it. It must never appear
  // inside a conditional, because it is NULL inside a migration and on any direct
  // connection, and `not (NULL)` is NULL, so such a guard silently never fires.
  for (const re of [/if\s+not\s*\([^)]*auth\.role\s*\(\s*\)/i, /auth\.role\s*\(\s*\)\s*(=|<>|!=|in)\b/i]) {
    assert.ok(!re.test(executable), `auth.role() must not gate behaviour (matched ${re})`);
  }
  const calls = [...executable.matchAll(/auth\.role\s*\(\s*\)/gi)];
  assert.equal(calls.length, 1, "auth.role() should be called exactly once, to capture it");
  assert.ok(/v_role\s*:=\s*auth\.role\s*\(\s*\)\s*;/i.test(code), "the single call must be a plain capture");

  // The derived label may compare the CAPTURED value, but a NULL capture must fall through
  // to a conservative label — never to 'signed_in_user'.
  const labelCase = code.slice(code.indexOf("v_actor_kind := case"), code.indexOf("end;\n\n  insert into"));
  assert.ok(/else\s+'direct_db_connection_unattributed'/i.test(labelCase),
    "a NULL role must land on the unattributed label, not on a person");
});

test("auth.role() is recorded, and the column comment warns that NULL is not permission", () => {
  assert.ok(/jwt_role\s+text/.test(sql), "the connection's auth.role() must be recorded");
  assert.ok(
    /never write a guard\s*'?\s*'?that treats null here as permission/i.test(sql.replace(/\s+/g, " ")),
    "the jwt_role column comment must warn that NULL is not permission",
  );
});

// ---------------------------------------------------------------------------------------
// Defect 2 — a BEFORE trigger that cannot see what it is guarding
// ---------------------------------------------------------------------------------------

test("every trigger that RECORDS a status change is AFTER, never BEFORE", () => {
  // Only the triggers installed ON THE CURATED TABLES. The append-only guards on the log
  // itself are deliberately BEFORE — they must veto the write, not observe it.
  const recording = triggerStatements.filter((s) => /\bon core\./i.test(s));
  assert.equal(recording.length, 4, "expected insert/delete and update triggers on both core tables");
  for (const stmt of recording) {
    const [, name, timing] = stmt.match(/create trigger\s+(\w+)\s+(before|after)\b/i);
    assert.equal(
      timing.toLowerCase(),
      "after",
      `${name} must be AFTER: a BEFORE trigger reads NULL from a GENERATED ... STORED column`,
    );
  }
  // ...and the append-only guards are correctly the other way round.
  const guards = triggerStatements.filter((s) => /\bon temp_status_watch\./i.test(s));
  assert.equal(guards.length, 2, "both temporary tables must carry an append-only guard");
  for (const stmt of guards) {
    assert.match(stmt, /\bbefore\b/i, "an append-only guard must be BEFORE, to veto the write");
  }
});

test("the recording trigger reads NEW/OLD status rather than a generated helper column", () => {
  assert.ok(/old\.status::text/.test(sql) && /new\.status::text/.test(sql));
});

// ---------------------------------------------------------------------------------------
// Defect 3 — actor honesty
// ---------------------------------------------------------------------------------------

test("the change log has NO free-text actor-name column an automation could fill in", () => {
  const logDdl = sql.slice(
    sql.indexOf("create table if not exists temp_status_watch.status_change_log"),
    sql.indexOf("comment on table temp_status_watch.status_change_log"),
  );
  for (const banned of ["reset_by", "changed_by", "acknowledged_by", "updated_by", "actor_name", "user_name"]) {
    assert.ok(
      !new RegExp(`\\b${banned}\\b`).test(logDdl),
      `${banned} is a free-text human-name field; an automated actor filled exactly such a field once and an auditor was misled`,
    );
  }
});

test("actor_kind is DERIVED from connection facts, not supplied by the caller", () => {
  const fn = sql.slice(sql.indexOf("function temp_status_watch.record_status_change"));
  assert.ok(/v_actor_kind\s*:=\s*case/i.test(fn), "actor_kind must be computed in the trigger");
  // It must be computed from things the database observes, not from a trigger argument.
  assert.ok(/current_user/.test(fn) && /auth\.uid\s*\(\s*\)/.test(fn));
  assert.ok(
    !/v_actor_kind\s*:=\s*tg_argv/i.test(fn),
    "actor_kind must never come from a trigger argument the caller controls",
  );
});

test("a service_role / privileged connection cannot be labelled a signed-in person", () => {
  const fn = sql.slice(sql.indexOf("function temp_status_watch.record_status_change"));
  assert.ok(/service_role_automation/.test(fn), "service_role must get its own automation label");
  assert.ok(
    /direct_db_connection_unattributed/.test(fn),
    "an unidentified direct connection must be labelled unattributed, never as a person",
  );
  // 'signed_in_user' may only be reached when a real JWT subject exists.
  assert.ok(
    /when\s+v_uid\s+is\s+not\s+null\s+then\s+'signed_in_user'/i.test(fn),
    "signed_in_user must require a non-null auth.uid()",
  );
});

test("the change record is append-only for everyone, including postgres", () => {
  assert.ok(/before update or delete on temp_status_watch\.status_change_log/i.test(sql));
  assert.ok(/before update or delete on temp_status_watch\.status_snapshot/i.test(sql));
});

// ---------------------------------------------------------------------------------------
// Coverage — a status change must not be able to slip past the record
// ---------------------------------------------------------------------------------------

test("both curated tables are instrumented, for insert, update AND delete", () => {
  for (const tbl of ["core.property", "core.licensor"]) {
    const t = sql.match(new RegExp(`after insert or delete on ${tbl.replace(".", "\\.")}`, "i"));
    assert.ok(t, `${tbl} must record inserts and deletes (the delete-and-reinsert loophole)`);
    const u = sql.match(new RegExp(`after update on ${tbl.replace(".", "\\.")}`, "i"));
    assert.ok(u, `${tbl} must record status updates`);
  }
});

test("the update trigger fires only on an actual status change", () => {
  const whens = [...sql.matchAll(/when\s*\(old\.status is distinct from new\.status\)/gi)];
  assert.equal(whens.length, 2, "both update triggers must be narrowed to real status changes");
});

test("the recording function is SECURITY DEFINER with a pinned search_path", () => {
  const fn = sql.slice(sql.indexOf("function temp_status_watch.record_status_change"));
  const head = fn.slice(0, fn.indexOf("as $$"));
  assert.ok(/security definer/i.test(head), "a caller lacking INSERT on the log must still be recorded");
  assert.ok(/set search_path = ''/.test(head), "SECURITY DEFINER without a pinned search_path is a hijack risk");
});

test("nothing in this migration changes a status value", () => {
  // This work captures and records. It does not curate.
  assert.ok(
    !/update\s+core\.(property|licensor)\s+set/i.test(sql),
    "this migration must never write core.property.status or core.licensor.status",
  );
});

// ---------------------------------------------------------------------------------------
// Snapshot correctness
// ---------------------------------------------------------------------------------------

test("the snapshot is populated from live data, never hard-coded", () => {
  const inserts = [...sql.matchAll(/insert into temp_status_watch\.status_snapshot[\s\S]*?;/gi)];
  assert.ok(inserts.length >= 2, "expected a licensor insert and a property insert");
  for (const [stmt] of inserts) {
    assert.ok(
      /select/i.test(stmt) && /from core\.(property|licensor)/i.test(stmt),
      "the snapshot must SELECT from the live table so it captures whatever database it lands in",
    );
    assert.ok(
      !/\bvalues\s*\(/i.test(stmt),
      "a hard-coded VALUES snapshot would be WRONG: preview and production differ on these very statuses",
    );
  }
});

test("the snapshot stores status as text, so it survives a change to the enum", () => {
  assert.ok(/status\s+text\s+not null/.test(sql));
  assert.ok(/\.status::text/.test(sql));
});

test("the snapshot is labelled and re-runnable", () => {
  assert.ok(/snapshot_label/.test(sql));
  assert.ok(/on conflict \(snapshot_label, entity_type, entity_id\) do nothing/i.test(sql));
});

test("Albert can ask 'what did I have inactive before?' without writing SQL", () => {
  assert.ok(/create or replace view temp_status_watch\.what_was_inactive_before/i.test(sql));
  assert.ok(/create or replace view temp_status_watch\.status_changes_since_snapshot/i.test(sql));
  assert.ok(/create or replace view temp_status_watch\.status_change_history/i.test(sql));
});

test("the history view shows the timestamp in New York as well as UTC", () => {
  // A midnight-UTC change reads back through ::date as the previous day in New York.
  assert.ok(/at time zone 'America\/New_York'/.test(sql));
});

// ---------------------------------------------------------------------------------------
// Defect 5 — "temporary" with no deletion trigger becomes permanent
// ---------------------------------------------------------------------------------------

test("the artefact is marked TEMPORARY in the schema itself, not just in prose", () => {
  assert.ok(/create schema if not exists temp_status_watch/i.test(sql), "the schema name must carry the label");
  assert.ok(/comment on schema temp_status_watch is/i.test(sql));
  for (const tbl of ["status_snapshot", "status_change_log"]) {
    assert.ok(/TEMPORARY/.test(commentOn(`table temp_status_watch\\.${tbl}`)), `${tbl}'s comment must say TEMPORARY`);
  }
});

test("it is a DURABLE table labelled temporary, not a session-scoped TEMPORARY TABLE", () => {
  assert.ok(
    !/create\s+(global\s+|local\s+)?(temp|temporary)\s+table/i.test(code),
    "a Postgres TEMPORARY TABLE is session-scoped and would vanish at disconnect",
  );
});

test("the deletion trigger is a written condition, not 'someday'", () => {
  const flat = sql.replace(/\s+/g, " ");
  assert.ok(/DELETION TRIGGER/i.test(sql), "the header must name the deletion trigger explicitly");
  assert.ok(/drop schema temp_status_watch cascade/i.test(flat), "the teardown command must be stated");
  assert.ok(/ALL THREE/i.test(flat), "the trigger must be a conjunction of stated conditions");
  assert.ok(/pg_get_functiondef/i.test(flat), "condition 1 must be verified against the live function, not a ledger row");
  assert.ok(/30 consecutive days/i.test(flat), "condition 2 must state a concrete quiet period");
  assert.ok(/REVIEW DATE: 2026-11-03/i.test(sql), "an unmet trigger must escalate on a date, not drift");
});

test("the deletion trigger is repeated in the schema comment, which survives in the database", () => {
  const c = commentOn("schema temp_status_watch");
  assert.ok(/drop schema temp_status_watch cascade/i.test(c), "teardown command must be in the schema comment");
  assert.ok(/ALL THREE/i.test(c), "the three conditions must be in the schema comment");
  assert.ok(/2026-11-03/.test(c), "the review date must be in the schema comment");
});

test("teardown is a single statement with no dependants outside the schema", () => {
  // Everything the migration creates must live inside temp_status_watch, except the four
  // triggers on the core tables — and those are dropped by CASCADE because their function
  // lives in the schema.
  const created = [...sql.matchAll(/create (?:or replace )?(?:table if not exists |table |view |function |index if not exists |index )([\w.]+)/gi)]
    .map((m) => m[1])
    .filter((n) => n.includes("."));
  for (const name of created) {
    assert.ok(
      name.startsWith("temp_status_watch."),
      `${name} is created outside the temporary schema, so DROP SCHEMA CASCADE would not remove it`,
    );
  }
});

test("the migration explains why this exists and cites the owner ruling", () => {
  assert.ok(/import_master_data/.test(sql), "the header must name the force-to-active path");
  assert.ok(/§6\.4|6\.4/.test(sql), "the header must cite the owner ruling it supports");
  assert.ok(/20260802170000/.test(sql), "the header must name the corrective migration not yet on production");
});

// =========================================================================================
// HARDENING migration (20260803201000) — adopted from GLM 5.2's independent review.
// Each test below corresponds to a bypass that was PROVEN to exist before it landed.
// =========================================================================================

const HARDENING = "20260803201000_temp_status_watch_hardening.sql";
const hard = readSql(HARDENING);
// Prose assertions must survive line wrapping (both in `--` comments and in the multi-part
// string literals of COMMENT ON), so match against a whitespace-and-comment-marker-flattened
// copy rather than the raw text.
const hardFlat = hard.replace(/\n\s*(--\s*)?/g, " ").replace(/'\s+'/g, "");

test("the hardening migration sorts after the migration it hardens", () => {
  assert.ok("20260803201000" > "20260803200000");
});

test("it is a FORWARD fix — the original migration is not edited", () => {
  // 20260803200000 is applied to preview. Editing it would desync file from ledger.
  assert.ok(/WHY A SECOND FILE/i.test(hardFlat));
  assert.ok(/every fix is FORWARD/i.test(hardFlat));
});

test("all six core-table triggers are ENABLE ALWAYS, closing the replica-role bypass", () => {
  // Default ENABLE ORIGIN triggers are SKIPPED by a session with
  // session_replication_role = 'replica' — a normal bulk-ETL setting. Proven on preview.
  const always = [...hard.matchAll(/alter table core\.\w+\s+enable always trigger\s+(\w+)/gi)].map((m) => m[1]);
  assert.equal(always.length, 6, "four row triggers + two truncate triggers must be ENABLE ALWAYS");
  for (const t of ["property_status_change_log", "property_status_change_log_upd",
                   "licensor_status_change_log", "licensor_status_change_log_upd",
                   "property_status_truncate_log", "licensor_status_truncate_log"]) {
    assert.ok(always.includes(t), `${t} must be ENABLE ALWAYS or a replica-role session skips it`);
  }
});

test("TRUNCATE of a curated table is recorded (row triggers do not fire on TRUNCATE)", () => {
  for (const tbl of ["core.property", "core.licensor"]) {
    assert.ok(
      new RegExp(`after truncate on ${tbl.replace(".", "\\.")}[\\s\\S]*?for each statement`, "i").test(hard),
      `${tbl} needs a statement-level AFTER TRUNCATE marker; a mass wipe would otherwise be unlogged`,
    );
  }
  assert.ok(/change_kind in \('insert', 'update', 'delete', 'truncate'\)/.test(hard));
});

test("TRUNCATE of the temporary tables is BLOCKED — append-only a TRUNCATE can empty is not append-only", () => {
  for (const tbl of ["status_change_log", "status_snapshot"]) {
    assert.ok(
      new RegExp(`before truncate on temp_status_watch\\.${tbl}[\\s\\S]*?reject_mutation`, "i").test(hard),
      `${tbl} must reject TRUNCATE`,
    );
  }
});

test("a truncate marker is the ONLY row allowed a NULL entity_id", () => {
  assert.ok(/check \(\(change_kind = 'truncate'\) = \(entity_id is null\)\)/.test(hard));
});

test("a forged JWT on an admin connection cannot be laundered into a person", () => {
  // request.jwt.claims is an ordinary settable GUC, so a direct connection can mint any
  // subject. A real end-user request arrives via PostgREST as authenticator/authenticated,
  // NEVER as postgres/supabase_admin.
  assert.ok(/claimed_jwt_on_admin_connection/.test(hard), "the suspect case needs its own loud label");
  const idxSuspect = hard.indexOf("then 'claimed_jwt_on_admin_connection'");
  const idxHuman = hard.indexOf("then 'signed_in_user'");
  assert.ok(idxSuspect > 0 && idxHuman > 0 && idxSuspect < idxHuman,
    "the suspect branch must be tested BEFORE signed_in_user, or it is unreachable");
  assert.ok(/current_user in \('postgres', 'supabase_admin'\)/.test(hard),
    "the suspect branch must key on the admin connection, not on a name heuristic");
});

test("the forged subject is still recorded, so the row stays auditable", () => {
  assert.ok(/jwt_uid/.test(hard), "recording the claimed subject is what makes the forgery visible");
});

test("the derivation still never grants a label on a NULL role", () => {
  const fn = hard.slice(hard.indexOf("function temp_status_watch.derive_actor_kind"));
  const body = fn.slice(0, fn.indexOf("$$;"));
  assert.ok(/else 'direct_db_connection_unattributed'/.test(body), "NULL must fall through to the least-trusting label");
  assert.ok(!/if\s+not\s*\(/i.test(body), "no `if not (...)` shape — that is how a guard goes NULL-permissive");
});

test("the over-broad read grant on the record is revoked", () => {
  // temp_status_watch is not in pgrst.db_schemas, so `authenticated` could never reach it
  // anyway — the grant bought nothing and exposed statement text.
  assert.ok(/revoke select on temp_status_watch\.status_snapshot/i.test(hard));
  assert.ok(/revoke usage on schema temp_status_watch from authenticated/i.test(hard));
});

test("caller-controlled columns are labelled as NOT identity", () => {
  for (const col of ["application_name", "statement_prefix"]) {
    const c = hardFlat.match(new RegExp(`comment on column temp_status_watch\\.status_change_log\\.${col} is.*?';`, "i"));
    assert.ok(c, `${col} must be commented`);
    assert.ok(/CALLER-CONTROLLED/.test(c[0]) && /NEVER identity/.test(c[0]),
      `${col} is caller-controlled free text and must not be read as identity`);
  }
});

test("the hardening still changes no status value, and stays inside the temporary schema", () => {
  const hcode = hard.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.ok(!/update\s+core\.(property|licensor)\s+set/i.test(hcode), "this work records; it never curates");
  const created = [...hcode.matchAll(/create (?:or replace )?(?:function |view |table )([\w.]+)/gi)].map((m) => m[1]);
  for (const n of created.filter((x) => x.includes("."))) {
    assert.ok(n.startsWith("temp_status_watch."), `${n} must be inside the disposable schema`);
  }
});

test("the hardening is covered by the SAME teardown", () => {
  assert.ok(/drop schema temp_status_watch cascade/i.test(hard));
  assert.ok(/2026-11-03/.test(hard), "the review date must travel with every file of this artefact");
});
