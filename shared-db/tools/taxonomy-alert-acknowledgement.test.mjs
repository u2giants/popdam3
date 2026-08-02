// Regression guards for the taxonomy sync alert ACKNOWLEDGEMENT path.
//
// Context: plm.taxonomy_sync_alert.acknowledged_at existed from 20260726180000 but NOTHING
// ever set it, so the alert channel was write-only and the hourly monitor re-fired forever
// (docs/coldlion-preview-alert-diagnosis-20260802.md §5). 20260802140000 added the RPC.
//
// These tests are static assertions over the migration SQL, in the style of the other
// tools/*.test.mjs guards. They exist because each one encodes a defect this repository has
// ALREADY shipped at least once, and every one of those defects installed cleanly and looked
// correct in review:
//
//   1. A NULL-permissive privilege guard `if not ( ... or auth.role() = 'service_role' )`.
//      auth.role() is NULL in a migration and on any direct connection, so `not (NULL)` is
//      NULL and the `if` never fires. Reads strict, behaves wide open.
//   2. A BEFORE trigger reading a GENERATED ... STORED column, which Postgres populates
//      only after before-triggers — the guard was always comparing against NULL.
//   3. A free-text "named human" field (plm.taxonomy_circuit_breaker.reset_by) that an
//      automated actor filled in with its own name, so the audit trail reads like a person.
//   4. Two migrations sharing one 14-digit version, which SILENTLY skips one of them.
//
// If a future change reintroduces any of them here, these fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

const ACK_FUNCTION = "plm.acknowledge_taxonomy_sync_alert(";
const AUTHORITY_FUNCTION = "plm.assert_taxonomy_alert_ack_authority(";

/**
 * The migration that currently DEFINES the RPC is the highest-versioned migration that
 * contains its `create or replace` — Postgres keeps whichever applied last, so the newest
 * file is the live body. Mirrors currentPromotionMigration() in
 * tools/coldlion-promotion-failure-recording.test.mjs.
 */
function newestMigrationDefining(signature) {
  const candidates = readdirSync(migrationsDir)
    .filter((name) => /^\d{14}.*\.sql$/.test(name))
    .filter((name) =>
      readFileSync(path.join(migrationsDir, name), "utf8").includes(
        `create or replace function ${signature}`,
      ),
    )
    .sort();
  assert.ok(
    candidates.length > 0,
    `no migration defines ${signature} — the acknowledgement path has been deleted`,
  );
  const newest = candidates[candidates.length - 1];
  return { name: newest, sql: readFileSync(path.join(migrationsDir, newest), "utf8") };
}

/**
 * The wrapper and the GRANTs are declared once, in the migration that first created them,
 * and are NOT repeated by later `create or replace` migrations that only patch the plm
 * function body. So they must be searched for across the whole migration set, not in
 * whichever file happens to define the RPC today. (This distinction is exactly what these
 * tests caught when 20260802150000 was added.)
 */
function allMigrationSql() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{14}.*\.sql$/.test(name))
    .sort()
    .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

/** Every migration that defines or redefines the acknowledgement RPC, concatenated. */
function ackMigrationSql() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{14}.*\.sql$/.test(name))
    .sort()
    .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
    .filter((sql) => sql.includes(`create or replace function ${ACK_FUNCTION}`))
    .join("\n");
}

/** Body of the acknowledgement function only, so header prose cannot satisfy a guard. */
function ackBody() {
  const { sql } = newestMigrationDefining(ACK_FUNCTION);
  const start = sql.indexOf(`create or replace function ${ACK_FUNCTION}`);
  assert.ok(start >= 0);
  const end = sql.indexOf("comment on function plm.acknowledge_taxonomy_sync_alert", start);
  assert.ok(end > start, "acknowledgement function is not followed by its comment");
  return sql.slice(start, end);
}

function authorityBody() {
  const { sql } = newestMigrationDefining(AUTHORITY_FUNCTION);
  const start = sql.indexOf(`create or replace function ${AUTHORITY_FUNCTION}`);
  assert.ok(start >= 0);
  const end = sql.indexOf("comment on function plm.assert_taxonomy_alert_ack_authority", start);
  assert.ok(end > start);
  return sql.slice(start, end);
}

// ---------------------------------------------------------------------------------------
// An acknowledgement path exists at all
// ---------------------------------------------------------------------------------------

test("acknowledged_at is written ONLY from inside the acknowledgement RPC", () => {
  const { name } = newestMigrationDefining(ACK_FUNCTION);
  assert.match(name, /^\d{14}_/);

  const all = readdirSync(migrationsDir).filter((f) => /^\d{14}.*\.sql$/.test(f)).sort();
  const definers = all.filter((f) =>
    readFileSync(path.join(migrationsDir, f), "utf8").includes(
      `create or replace function ${ACK_FUNCTION}`,
    ),
  );
  // Any statement assigning acknowledged_at OUTSIDE a migration that defines the RPC would be
  // an unaudited second write path — exactly what the diagnosis forbids. Migrations that
  // redefine the RPC legitimately contain the assignment, because it is in the function body.
  const writers = all.filter((f) => {
    const sql = readFileSync(path.join(migrationsDir, f), "utf8");
    return /set\s+acknowledged_at\s*=/i.test(sql) || /acknowledged_at\s*=\s*now\(\)/i.test(sql);
  });
  const rogue = writers.filter((f) => !definers.includes(f));
  assert.deepEqual(
    rogue,
    [],
    `acknowledged_at is written outside the RPC by: ${rogue.join(", ")}`,
  );
  assert.ok(writers.length > 0, "nothing writes acknowledged_at at all");
});

test("the public wrapper exists so service_role can reach it without schema plm in the API", () => {
  assert.ok(
    allMigrationSql().includes("create or replace function public.acknowledge_taxonomy_sync_alert("),
    "no public wrapper for the acknowledgement RPC",
  );
});

// ---------------------------------------------------------------------------------------
// Defect 1 — the NULL-permissive privilege guard
// ---------------------------------------------------------------------------------------

test("the authority check is NOT written as a NULL-permissive negated OR", () => {
  const body = authorityBody() + ackBody();
  // The exact broken shape: `if not ( <anything> or auth.role() = '...' )`.
  assert.doesNotMatch(
    body,
    /if\s+not\s*\([^)]*\bor\b[^)]*auth\.role\(\)/is,
    "reintroduced the null-permissive guard `if not ( ... or auth.role() = ... )` — it never fires when auth.role() is NULL",
  );
});

test("the authority check requires a NON-NULL role and refuses when none resolves", () => {
  const body = authorityBody();
  assert.match(
    body,
    /v_effective\s+is\s+null/i,
    "no explicit NULL branch — an unresolvable role must REFUSE, not fall through",
  );
  assert.match(
    body,
    /if\s+v_effective\s+is\s+null\s+then\s+raise\s+exception/is,
    "the NULL-role branch does not raise",
  );
});

test("the authority check is a POSITIVE allow-list match, not a deny-list", () => {
  const body = authorityBody();
  assert.match(body, /v_allowed\s+text\[\]\s*:=\s*array\[/i, "no allow-list array");
  assert.match(
    body,
    /not\s*\(\s*v_effective\s*=\s*any\s*\(\s*v_allowed\s*\)\s*\)/i,
    "the effective role is not positively matched against the allow-list",
  );
  // A present-but-disallowed JWT role must be refused on its own, so `authenticated` cannot
  // ride in on session_user = 'authenticator'.
  assert.match(
    body,
    /v_jwt_role\s+is\s+not\s+null\s+and\s+not\s*\(\s*v_jwt_role\s*=\s*any/i,
    "a present JWT role is not independently checked against the allow-list",
  );
});

// 20260802150000 adopted GLM 5.2's machine-credential binding, but it tested a value that
// does not follow SET ROLE, so it never fired — a service_role caller successfully recorded
// `human:John Smith` on preview. Caught by behavioural assertion, not by reading the SQL.
// Fixed by 20260802160000.
test("the effective role is resolved from current_user, which follows SET ROLE", () => {
  const body = authorityBody();
  assert.match(
    body,
    /v_effective\s*:=\s*coalesce\(\s*v_jwt_role\s*,\s*nullif\(btrim\(current_user::text\)/i,
    "the effective role is not resolved from current_user — session_user does not follow SET ROLE, so the machine-credential binding silently never fires",
  );
  assert.doesNotMatch(
    body,
    /v_effective\s*:=\s*coalesce\(\s*v_jwt_role\s*,\s*nullif\(btrim\(session_user/i,
    "regressed to session_user for the authority decision",
  );
  // session_user must still be RECORDED — it is forensic evidence, just not the decision.
  assert.match(ackBody(), /'session_user'\s*,\s*session_user::text/i);
});

test("the RPC calls the authority assertion before doing anything else", () => {
  const body = ackBody();
  const assertIdx = body.indexOf("plm.assert_taxonomy_alert_ack_authority()");
  const updateIdx = body.indexOf("update plm.taxonomy_sync_alert");
  assert.ok(assertIdx > 0, "the RPC does not assert authority at all");
  assert.ok(updateIdx > assertIdx, "the RPC updates before asserting authority");
});

test("the RPC is SECURITY INVOKER so the table GRANT is the real guard", () => {
  const body = ackBody();
  assert.match(body, /security\s+invoker/i, "the RPC must not be security definer");
  assert.doesNotMatch(
    body,
    /security\s+definer/i,
    "security definer would bypass the UPDATE grant that is the primary guard",
  );
  const all = allMigrationSql();
  const wrapper = all.slice(all.indexOf("create or replace function public.acknowledge_taxonomy_sync_alert("));
  assert.match(wrapper, /security\s+invoker/i, "the public wrapper must also be security invoker");
});

test("browser roles are explicitly revoked from the public wrapper", () => {
  const sql = allMigrationSql();
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.acknowledge_taxonomy_sync_alert\(uuid,\s*jsonb\)\s+from\s+anon,\s*authenticated;/i,
    "anon/authenticated are not explicitly revoked from the public wrapper",
  );
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.acknowledge_taxonomy_sync_alert\(uuid,\s*jsonb\)\s+to\s+service_role;/i,
    "service_role is not granted execute on the public wrapper",
  );
});

// ---------------------------------------------------------------------------------------
// Defect 2 — BEFORE trigger reading a GENERATED ... STORED column
// ---------------------------------------------------------------------------------------

test("no BEFORE trigger and no generated column are involved in the acknowledgement path", () => {
  const sql = ackMigrationSql();
  assert.doesNotMatch(sql, /\bbefore\s+(insert|update|delete)\b/i, "installs a BEFORE trigger");
  assert.doesNotMatch(sql, /generated\s+always\s+as/i, "introduces a generated column");
});

// ---------------------------------------------------------------------------------------
// Defect 3 — an automated actor recorded as if it were a person
// ---------------------------------------------------------------------------------------

test("actor_type is mandatory and closed to exactly human|automation", () => {
  const body = ackBody();
  assert.match(
    body,
    /v_actor_type\s+is\s+null\s+or\s+v_actor_type\s+not\s+in\s*\(\s*'human'\s*,\s*'automation'\s*\)/i,
    "actor_type is not mandatory-and-closed",
  );
  assert.doesNotMatch(
    body,
    /p_acknowledgement->>'actor_type'\s*,\s*'human'\s*\)/i,
    "actor_type must have NO default — defaulting to 'human' is the whole defect",
  );
});

test("acknowledged_by is CONSTRUCTED with a prefix, never taken verbatim from the caller", () => {
  const body = ackBody();
  assert.match(body, /format\(\s*'human:%s'/i, "no constructed human: prefix");
  assert.match(
    body,
    /format\(\s*'automation:%s \(on behalf of human:%s\)'/i,
    "no constructed automation: prefix naming the responsible human",
  );
  // acknowledged_by must be set from the constructed value, not from caller text.
  assert.match(body, /acknowledged_by\s*=\s*v_by/i, "acknowledged_by is not set from the constructed value");
  assert.doesNotMatch(
    body,
    /acknowledged_by\s*=\s*(p_acknowledgement|v_actor)\b/i,
    "acknowledged_by is set from raw caller input — that is how reset_by ended up naming a sub-agent",
  );
});

test("an automation acknowledgement must name a human, and that human may not itself look automated", () => {
  const body = ackBody();
  assert.match(body, /v_on_behalf\s+is\s+null\s+then\s+raise\s+exception/is, "on_behalf_of is not required for automation");
  assert.match(
    body,
    /taxonomy_alert_actor_looks_automated\(v_on_behalf\)/i,
    "on_behalf_of is not checked for being another machine",
  );
  assert.match(
    body,
    /taxonomy_alert_actor_looks_automated\(v_actor\)/i,
    "an automation-shaped name is not refused on the actor_type='human' path",
  );
});

test("the record carries server-observed connection facts the caller cannot forge", () => {
  const body = ackBody();
  assert.match(body, /'session_user'\s*,\s*session_user::text/i);
  assert.match(body, /'current_user'\s*,\s*current_user::text/i);
  assert.match(body, /'effective_role'\s*,\s*v_role/i);
  // Added after GLM 5.2's review: the JWT subject, so a 'human' record minted through a
  // JWT-bearing path can be checked against a real identity.
  assert.match(body, /'jwt_sub'\s*,\s*v_uid/i, "the JWT subject is not recorded");
});

// GLM 5.2 review, question 4: without this, a service_role/CI caller could mint
// actor_type='human' with any name that evades the regex. The role binding turns the weakest
// link from a name heuristic into a structural property.
test("a machine credential may NOT record itself as a human", () => {
  const body = ackBody();
  assert.match(
    body,
    /v_actor_type\s*=\s*'human'\s+and\s+v_role\s+in\s*\(\s*'service_role'\s*,\s*'supabase_admin'\s*\)/i,
    "actor_type='human' is not bound to the effective database role — a service key could claim to be a person",
  );
  // postgres must stay exempt: a direct admin connection is the human operator path.
  assert.doesNotMatch(
    body,
    /v_actor_type\s*=\s*'human'\s+and\s+v_role\s+in\s*\([^)]*'postgres'/i,
    "postgres must remain able to record actor_type='human'",
  );
});

// Found by exercising the function on preview, and independently by GLM 5.2: the original
// regex rejected real surnames. Fail-closed, but it pushed a human towards recording a FALSE
// automation label, which is worse than no guard.
test("the automation-name heuristic is word-anchored so real names are not rejected", () => {
  const heuristic = readdirSync(migrationsDir)
    .filter((f) => /^\d{14}.*\.sql$/.test(f))
    .sort()
    .filter((f) =>
      readFileSync(path.join(migrationsDir, f), "utf8").includes(
        "create or replace function plm.taxonomy_alert_actor_looks_automated(",
      ),
    )
    .pop();
  assert.ok(heuristic, "the automation-name heuristic no longer exists");
  const sql = readFileSync(path.join(migrationsDir, heuristic), "utf8");
  // Bound to the function STATEMENT. The trailing `comment on function` prose names Abbot,
  // Talbot, Scriptor and Cronin, and would otherwise satisfy the substring guards below.
  const start = sql.indexOf("create or replace function plm.taxonomy_alert_actor_looks_automated(");
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, "could not find the end of the heuristic function body");
  const body = sql.slice(start, end);

  // The tokens that collided with Abbot / Talbot / Botany / Cronin / Scriptor must now be
  // inside a whole-word group, never bare substrings.
  assert.match(body, /\\m\(bot\|/i, "the short-token group is not word-anchored at the start");
  assert.match(body, /\)\\M/, "the short-token group is not word-anchored at the end");
  for (const bare of ["bot\\M|", "|\\mbot", "\\mai\\M", "job\\M", "\\mci\\M"]) {
    assert.ok(!body.includes(bare), `bare token ${bare} is back — it matches real human names`);
  }

  // Tier 2 matches ANYWHERE in the string, so the name-colliding tokens must never appear
  // there — only in the word-anchored tier 1 group.
  const tier2 = body.slice(body.indexOf("or coalesce(p_name"));
  // Note `sub[_ -]?agent` IS allowed in tier 2 — a compound, unambiguous marker. What must
  // not appear is a BARE alternation branch that matches inside ordinary words.
  for (const mustNotBeSubstring of ["script", "cron", "bot", "|agent|", "(agent|", "worker"]) {
    assert.ok(
      !tier2.includes(mustNotBeSubstring),
      `tier 2 matches '${mustNotBeSubstring}' as a bare substring — that is how 'Scriptor' and 'Cronin' were rejected`,
    );
  }

  // The machine markers that actually matter must survive somewhere.
  for (const kept of ["agent", "automation", "github[_ -]?actions", "service[_ -]?role", "workflow"]) {
    assert.ok(body.includes(kept), `machine marker ${kept} was lost`);
  }
});

test("a reason is mandatory and cannot be a token character", () => {
  const body = ackBody();
  assert.match(
    body,
    /v_reason\s+is\s+null\s+or\s+length\(v_reason\)\s*<\s*20/i,
    "the reason is not required to be substantive",
  );
});

// ---------------------------------------------------------------------------------------
// Append-only / no silent overwrite
// ---------------------------------------------------------------------------------------

test("the acknowledgement is append-only and never deletes the alert row", () => {
  const sql = ackMigrationSql();
  assert.doesNotMatch(sql, /delete\s+from\s+plm\.taxonomy_sync_alert/i, "deletes alert rows");
  const body = ackBody();
  assert.match(
    body,
    /payload\s*=\s*coalesce\(payload,\s*'\{\}'::jsonb\)\s*\|\|/i,
    "the payload is replaced rather than merged — existing keys would be lost",
  );
});

test("re-acknowledging an already-acknowledged alert raises instead of overwriting", () => {
  const body = ackBody();
  assert.match(
    body,
    /v_alert\.acknowledged_at\s+is\s+not\s+null\s+then\s+raise\s+exception/is,
    "double-acknowledgement does not raise",
  );
  assert.match(
    body,
    /where\s+id\s*=\s*p_alert_id\s*and\s+acknowledged_at\s+is\s+null/is,
    "the UPDATE is not guarded against a concurrent acknowledgement",
  );
  assert.match(
    body,
    /if\s+not\s+found\s+then[\s\S]{0,200}acknowledged concurrently/i,
    "a lost concurrency race would be reported as success — a silent failure",
  );
});

test("a missing alert id is a loud error, not a silent no-op", () => {
  const body = ackBody();
  assert.match(body, /does not exist/i, "an unknown alert id does not raise");
});

// ---------------------------------------------------------------------------------------
// Defect 4 — duplicate migration versions silently skip a migration
// ---------------------------------------------------------------------------------------

test("no two migrations share a 14-digit version", () => {
  const versions = readdirSync(migrationsDir)
    .filter((f) => /^\d{14}.*\.sql$/.test(f))
    .map((f) => f.slice(0, 14));
  const seen = new Map();
  for (const v of versions) seen.set(v, (seen.get(v) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
  assert.deepEqual(dupes, [], `duplicate migration versions silently skip a migration: ${dupes.join(", ")}`);
});

test("the acknowledgement migration sorts after every migration that existed before it", () => {
  const { name } = newestMigrationDefining(ACK_FUNCTION);
  const version = name.slice(0, 14);
  // The alert table itself must already exist when this applies.
  assert.ok(
    version > "20260726180000",
    "the acknowledgement RPC sorts before the migration that creates plm.taxonomy_sync_alert",
  );
});
