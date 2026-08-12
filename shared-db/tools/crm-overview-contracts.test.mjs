// Offline contract tests for the CRM Overview / Sidebar server-side contracts
// (baseline migration 20260812130000 plus exact-parity correction 20260812211000).
//
// These run OFFLINE (no secrets, no database) as part of the "Tools offline
// tests" required CI context. They assert the migration honors the Phase 7A
// contract: additive/idempotent, hard-gated authorization, exact filter
// faithfulness vs the CRM client, bounded recent rows, and rendered-columns-only.
//
// The RUNTIME half of this proof — a CRM user succeeds and a valid non-CRM user
// is denied insufficient_privilege, against preview fixtures — is performed on
// the preview database and recorded under
// docs/verification/crm-overview-contracts-20260812/access-control.txt. These
// offline tests pin the STRUCTURE that makes that runtime behavior guaranteed.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const MIGRATION_FILE = "20260812211000_crm_overview_exact_parity_corrections.sql";
const MIGRATION_PATH = path.join(migrationsDir, MIGRATION_FILE);
const VERSION = MIGRATION_FILE.slice(0, 14);

const sql = () => fs.readFileSync(MIGRATION_PATH, "utf8");

// The seven purpose-specific contracts this migration must define, with the
// rendered columns each bounded-row panel is allowed to return.
const COUNT_FUNCTIONS = [
  "api.crm_overview_counts",
  "api.crm_overview_email_counts",
  "api.crm_overview_pipeline_stages",
];
// Bounded recent-row panels: p_limit clamped to [1,100].
const BOUNDED_PANEL_FUNCTIONS = [
  "api.crm_overview_recent_unrouted",
  "api.crm_overview_recent_meetings",
  "api.crm_overview_pending_approvals",
];
// Set-valued functions with a clamped integer parameter (email_volume uses
// p_weeks clamped to [1,24] — its own dedicated test).
const SET_FUNCTIONS_WITH_LIMIT = ["api.crm_overview_email_volume", ...BOUNDED_PANEL_FUNCTIONS];
const BOUNDED_P_LIMIT_FUNCTIONS = BOUNDED_PANEL_FUNCTIONS;
const ALL_FUNCTIONS = [...COUNT_FUNCTIONS, ...SET_FUNCTIONS_WITH_LIMIT];

const RENDERED_COLUMNS = {
  "api.crm_overview_recent_unrouted": ["id", "subject", "sender", "routing_status"],
  "api.crm_overview_recent_meetings": ["id", "name", "company_id", "company_name", "date"],
  "api.crm_overview_pending_approvals": [
    "id",
    "name",
    "property_name",
    "opportunity_id",
    "opportunity_name",
    "stage",
  ],
};

function normalizeForMatch(text) {
  // Collapse whitespace so multi-line SQL predicates match a single-line expectation.
  return text.replace(/\s+/g, " ").toLowerCase();
}

test("the migration file exists and is uniquely timestamped", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), `missing migration: ${MIGRATION_FILE}`);
  const versions = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{14}.*\.sql$/.test(f))
    .map((f) => f.slice(0, 14));
  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
  assert.deepEqual(dupes, [], `duplicate migration version(s): ${dupes.join(", ")}`);
  assert.ok(
    versions.filter((v) => v === VERSION).length === 1,
    `version ${VERSION} must be claimed by exactly one file`,
  );
});

test("every contract function is defined exactly once with create or replace", () => {
  const text = sql();
  for (const fn of ALL_FUNCTIONS) {
    const createRe = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${fn.replace(/\./g, "\\.")}\\s*\\(`,
      "i",
    );
    const matches = text.match(new RegExp(createRe.source, "gi"));
    assert.ok(matches && matches.length === 1, `${fn} defined exactly once (got ${matches?.length ?? 0})`);
  }
});

test("every function is idempotent (create or replace, never create-only or drop)", () => {
  const text = sql();
  for (const fn of ALL_FUNCTIONS) {
    const bare = text.match(new RegExp(`create\\s+function\\s+${fn.replace(/\./g, "\\.")}\\s*\\(`, "i"));
    assert.ok(!bare, `${fn} must use CREATE OR REPLACE, not bare CREATE`);
  }
  // Additive-only: no structure-changing DDL that another app could notice.
  assert.ok(!/\bdrop\s+(function|table|view|index)\b/i.test(text), "no DROP statements");
  assert.ok(!/\balter\s+table\b/i.test(text), "no ALTER TABLE statements");
  assert.ok(!/\bcreate\s+index\b/i.test(text), "no CREATE INDEX in this migration (additive functions only)");
  assert.ok(!/\bcreate\s+table\b/i.test(text), "no CREATE TABLE statements");
  assert.ok(!/concurrently/i.test(text), "no CONCURRENTLY (cannot be pushed through a pipeline)");
});

// NEGATIVE AUTHORIZATION CONTRACT — the structural guarantee that a non-CRM user
// is DENIED. Each function must be security definer, must check
// app.has_app_access('crm'), and must raise insufficient_privilege on failure.
test("negative authorization: every function hard-gates on app.has_app_access('crm') and raises insufficient_privilege", () => {
  const text = sql();
  // Slice the migration into per-function blocks for precise assertions.
  const blocks = new Map();
  const re = /create\s+or\s+replace\s+function\s+(api\.\w+)\b[\s\S]*?\$\$;/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.set(m[1].toLowerCase(), m[0]);
  }
  for (const fn of ALL_FUNCTIONS) {
    const block = blocks.get(fn.toLowerCase());
    assert.ok(block, `located function body for ${fn}`);
    assert.match(block, /security\s+definer/i, `${fn} is SECURITY DEFINER`);
    assert.match(block, /app\.has_app_access\(\s*['"]crm['"]\s*\)/i, `${fn} checks app.has_app_access('crm')`);
    assert.match(block, /raise\s+exception/i, `${fn} raises an exception when unauthorized`);
    assert.match(
      block,
      /errcode\s*=\s*['"]insufficient_privilege['"]/i,
      `${fn} raises errcode insufficient_privilege`,
    );
    // The auth check must come BEFORE any return query (deny fast, before work).
    const authIdx = block.search(/if\s+not\s+app\.has_app_access/i);
    const returnIdx = block.search(/return\s+query/i);
    assert.ok(authIdx !== -1 && (returnIdx === -1 || authIdx < returnIdx), `${fn} checks auth before returning data`);
  }
});

test("every function sets a search_path (injection resistance) and is stable/read-only", () => {
  const text = sql();
  const blocks = new Map();
  const re = /create\s+or\s+replace\s+function\s+(api\.\w+)\b[\s\S]*?\$\$;/gi;
  let m;
  while ((m = re.exec(text)) !== null) blocks.set(m[1].toLowerCase(), m[0]);
  for (const fn of ALL_FUNCTIONS) {
    const block = blocks.get(fn.toLowerCase());
    assert.match(block, /set\s+search_path\s*=/i, `${fn} sets search_path`);
    assert.match(block, /\blanguage\s+plpgsql\b/i, `${fn} is plpgsql`);
    assert.match(block, /\bstable\b/i, `${fn} is STABLE (read-only)`);
  }
});

test("execute is revoked from public and granted to authenticated for every function", () => {
  const text = sql();
  for (const fn of ALL_FUNCTIONS) {
    const esc = fn.replace(/\./g, "\\.").replace(/overdue/i, "overdue");
    assert.match(
      text,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${esc}\\s*\\([^)]*\\)\\s*from\\s+public`, "i"),
      `${fn}: revoke all from public`,
    );
    assert.match(
      text,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${esc}\\s*\\([^)]*\\)\\s*to\\s+authenticated`, "i"),
      `${fn}: grant execute to authenticated`,
    );
  }
});

test("bounded recent-row functions clamp p_limit to [1,100] and apply a deterministic limit", () => {
  const text = sql();
  const blocks = new Map();
  const re = /create\s+or\s+replace\s+function\s+(api\.\w+)\b[\s\S]*?\$\$;/gi;
  let m;
  while ((m = re.exec(text)) !== null) blocks.set(m[1].toLowerCase(), m[0]);
  for (const fn of BOUNDED_P_LIMIT_FUNCTIONS) {
    const block = blocks.get(fn.toLowerCase());
    // least(greatest(coalesce(p_limit, default), 1), 100) — clamps into [1,100].
    assert.match(block, /least\s*\(\s*greatest\s*\(\s*coalesce\s*\(\s*p_limit/i, `${fn} clamps p_limit with least(greatest(coalesce(...`);
    assert.match(block, /,\s*1\s*\)\s*,\s*100\s*\)/i, `${fn} clamps to [1,100]`);
    assert.match(block, /limit\s+v_limit/i, `${fn} applies LIMIT v_limit`);
    // Deterministic ordering with an id ascending tie-breaker.
    assert.match(block, /order\s+by[\s\S]*,\s*\w+\.id\b(\s|$)/i, `${fn} ends its ORDER BY with an id tie-breaker`);
  }
});

test("the volume function clamps p_weeks and uses rolling seven-day windows at one stable boundary", () => {
  const block = sql().match(/create\s+or\s+replace\s+function\s+api\.crm_overview_email_volume\b[\s\S]*?\$\$;/i)[0];
  assert.match(block, /v_weeks\s*integer\s*:=\s*least\s*\(\s*greatest\s*\(\s*coalesce\s*\(\s*p_weeks,\s*12\s*\)/i, "p_weeks default 12, clamped");
  assert.match(block, /,\s*1\s*\)\s*,\s*24\s*\)/i, "p_weeks clamped to [1,24]");
  assert.match(block, /v_boundary\s+timestamptz\s*:=\s*statement_timestamp\(\)/i, "one stable server boundary per call");
  assert.match(block, /v_boundary\s*-\s*\(v_weeks\s*-\s*n\)\s*\*\s*interval\s*['"]7 days['"]/i, "rolling window starts match the browser calculation");
  assert.match(block, /v_boundary\s*-\s*\(v_weeks\s*-\s*n\s*-\s*1\)\s*\*\s*interval\s*['"]7 days['"]/i, "rolling window ends match the browser calculation");
  assert.doesNotMatch(block, /date_trunc\s*\(\s*['"]week['"]/i, "does not use calendar-week boundaries");
  assert.match(block, /generate_series/i, "uses generate_series for the week grid");
});

test("email contracts operate on exactly the newest 500 messages", () => {
  const text = sql();
  for (const fn of [
    "api.crm_overview_email_counts",
    "api.crm_overview_email_volume",
    "api.crm_overview_recent_unrouted",
  ]) {
    const block = text.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn.replace(/\./g, "\\.")}\\b[\\s\\S]*?\\$\\$;`, "i"))[0];
    assert.match(block, /with\s+recent_emails\s+as\s*\(/i, `${fn} defines the browser-equivalent recent window`);
    assert.match(block, /order\s+by\s+src\.received_at\s+desc\s+nulls\s+last\s*,\s*src\.id/i, `${fn} selects newest messages deterministically`);
    assert.match(block, /limit\s+500/i, `${fn} matches fetchEmailMessages(-1)'s 500-row cap`);
  }
});

// FILTER FAITHFULNESS — the server predicates must equal the CRM client filters
// exactly (null/empty handling included), so counts match.
test("filter faithfulness: scalar KPI predicates match the CRM client", () => {
  const n = normalizeForMatch(sql());
  // Customers = active segment.
  assert.ok(
    n.includes("customer_status in ('active_customer', 'potential_customer')"),
    "customers filter matches fetchRetailers('active')",
  );
  // Contacts = primary company active (lateral over contact_company).
  assert.ok(
    /left join lateral[\s\S]*contact_company[\s\S]*order by[\s\S]*is_primary desc nulls last[\s\S]*x\.id[\s\S]*limit 1/i.test(n),
    "contacts filter uses the primary-company lateral",
  );
  // Open opportunities = stage is distinct from 'CLOSED' (null counts as open).
  assert.ok(n.includes("o.stage is distinct from 'closed'"), "open_opportunities filter");
  // Open tasks = not DONE/CANCELED.
  assert.ok(n.includes("t.status is distinct from 'done'"), "open_tasks excludes DONE");
  assert.ok(n.includes("t.status is distinct from 'canceled'"), "open_tasks excludes CANCELED");
  // Pending approvals = NOT isApprovalResolved(stage).
  assert.ok(
    n.includes("coalesce(a.stage, '') !~* '(approv|reject|declin|denied|complete|closed|signed)'"),
    "pending_approvals regex matches isApprovalResolved negation",
  );
});

test("filter faithfulness: email counts match needsRouting() and the donut null-bucketing", () => {
  const n = normalizeForMatch(sql());
  // needsRouting() = non-empty status not in (ROUTED, SKIPPED).
  assert.ok(
    n.includes("nullif(e.routing_status, '') is not null and e.routing_status not in ('routed', 'skipped')"),
    "needs_routing filter matches needsRouting()",
  );
  // Donut buckets null/empty -> UNROUTED (mirrors `e.routing_status || 'UNROUTED'`).
  assert.ok(
    n.includes("coalesce(nullif(e.routing_status, ''), 'unrouted') = 'unrouted'"),
    "unrouted donut bucket includes null/empty",
  );
  // All six known routing-status keys are counted.
  for (const key of ["'routed'", "'skipped'", "'company_only'", "'company_dept'", "'unrouted'", "'customer_email_no_company'"]) {
    assert.ok(n.includes(`e.routing_status = ${key}`) || n.includes(key), `email count covers ${key}`);
  }
});

test("filter faithfulness: pipeline null/empty stage buckets to DIRECTIVE_RECEIVED", () => {
  const n = normalizeForMatch(sql());
  assert.ok(
    n.includes("coalesce(nullif(o.stage, ''), 'directive_received')"),
    "pipeline null/empty stage bucketed to DIRECTIVE_RECEIVED (mirrors `o.stage || OPPORTUNITY_STAGES[0]`)",
  );
  // All eight known stages are emitted in deterministic chart order.
  for (const stage of [
    "directive_received",
    "design_in_progress",
    "buyer_review",
    "pricing_and_sampling",
    "awaiting_sales_order",
    "in_production",
    "shipped",
    "closed",
  ]) {
    assert.ok(n.includes(`('${stage}')`), `pipeline stages include ${stage}`);
  }
});

test("filter faithfulness: recent panels filter and order correctly", () => {
  const n = normalizeForMatch(sql());
  // Recent unrouted = needsRouting, ordered by received_at desc, id.
  assert.ok(
    n.includes("nullif(e.routing_status, '') is not null and e.routing_status not in ('routed', 'skipped')"),
    "recent_unrouted uses needsRouting filter",
  );
  assert.ok(/order by e\.received_at desc nulls last, e\.id/i.test(n), "recent_unrouted deterministic order");
  // Recent meetings ordered by meeting_at desc, id.
  assert.ok(/order by m\.meeting_at desc nulls last, m\.id/i.test(n), "recent_meetings deterministic order");
  // Pending approvals = NOT resolved, preserving fetchApprovalThreads order:
  // stage asc, submitted_date desc, then an id tie-breaker.
  assert.ok(
    n.includes("coalesce(a.stage, '') !~* '(approv|reject|declin|denied|complete|closed|signed)'"),
    "pending_approvals uses NOT isApprovalResolved filter",
  );
  assert.ok(
    /order by a\.stage asc nulls last, a\.submitted_date desc nulls last, a\.id/i.test(n),
    "pending_approvals preserves browser order with deterministic id tie-breaker",
  );
});

test("rendered-columns-only: bounded panels never return bodies, transcripts, or ingest payloads", () => {
  const text = sql();
  const forbidden = ["body_preview", "body_storage_ref", "participants", "action_items", "summary", "fireflies_transcript_id", "recipients", "licensor_comments"];
  // The bounded-row functions are the only ones returning row payloads; assert
  // none of the sensitive/over-fetch columns appear anywhere in the migration.
  for (const col of forbidden) {
    assert.ok(!text.toLowerCase().includes(col), `migration must not expose over-fetch column: ${col}`);
  }
});

test("every bounded panel's RETURNS TABLE lists exactly its rendered columns", () => {
  const blocks = new Map();
  const re = /create\s+or\s+replace\s+function\s+(api\.\w+)\b[\s\S]*?returns\s+table\s*\(([\s\S]*?)\)\s*language/gi;
  let m;
  while ((m = re.exec(sql())) !== null) {
    const cols = m[2]
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0].toLowerCase())
      .filter(Boolean);
    blocks.set(m[1].toLowerCase(), cols);
  }
  for (const [fn, expected] of Object.entries(RENDERED_COLUMNS)) {
    const got = blocks.get(fn.toLowerCase());
    assert.deepEqual(got, expected, `${fn} returns exactly the rendered columns`);
  }
});
