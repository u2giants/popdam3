// Unit tests for the Phase 2A ColdLion licensor/property mirror-only runner.
// Run: node --test tools/sync-coldlion-licensors-properties.test.mjs
// No database, no network (fetch is injected). Covers §11.2 runner cases.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIG,
  SOURCE_NAME,
  buildImportSql,
  buildPriorCountsSql,
  buildSnapshot,
  classifyDetails,
  collectDetails,
  collectHeaders,
  describeTarget,
  encodeSourceId,
  normalizeMeaning,
  parsePriorCounts,
  resolveLicensedTypes,
  resolveRunMode,
  sourceHashOf,
  validateSnapshot,
} from "./sync-coldlion-licensors-properties.mjs";
import { buildFailedSyncRunSql } from "./coldlion-sync-common.mjs";

const COMPANY = CONFIG.companyCode; // EDGEHOME

// Minimal valid header set: CW001/SP001 licensed, EH001 non-licensed (Big Theme).
function baseHeaders() {
  return [
    { companyCode: COMPANY, divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor", createdTime: "2026-01-01T00:00:00", modTime: "2026-01-01T00:00:00" },
    { companyCode: COMPANY, divisionCode: "CW001", mgTypeCode: "06", mgTypeDesc: "Property", createdTime: "2026-01-01T00:00:00", modTime: "2026-01-01T00:00:00" },
    { companyCode: COMPANY, divisionCode: "SP001", mgTypeCode: "05", mgTypeDesc: "Licensor", createdTime: "2026-01-01T00:00:00", modTime: "2026-01-01T00:00:00" },
    { companyCode: COMPANY, divisionCode: "SP001", mgTypeCode: "06", mgTypeDesc: "Property", createdTime: "2026-01-01T00:00:00", modTime: "2026-01-01T00:00:00" },
    { companyCode: COMPANY, divisionCode: "EH001", mgTypeCode: "05", mgTypeDesc: "Big Theme", createdTime: "2026-01-01T00:00:00", modTime: "2026-01-01T00:00:00" },
    { companyCode: COMPANY, divisionCode: "EP001", mgTypeCode: "05", mgTypeDesc: "Product Line", createdTime: "2026-01-01T00:00:00", modTime: "2026-01-01T00:00:00" },
  ];
}

function detail(div, type, code, desc) {
  // The runner stamps mgTypeDesc onto each detail from the resolved pair (collectDetails);
  // tests mirror that so validateSnapshot routes licensor/property correctly.
  const meaning = type === "05" ? "Licensor" : "Property";
  return {
    companyCode: COMPANY, divisionCode: div, mgTypeCode: type, mgCode: code, mgDesc: desc,
    mgTypeDesc: meaning, itemNoCode: code, mgCode2: code, mgCategory: "",
    createdTime: "2026-01-01T00:00:00", createdUser: "u", modTime: "2026-01-01T00:00:00", modUser: "u",
  };
}

function okPairs() {
  return [
    { divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor", entityType: "licensor" },
    { divisionCode: "CW001", mgTypeCode: "06", mgTypeDesc: "Property", entityType: "property" },
    { divisionCode: "SP001", mgTypeCode: "05", mgTypeDesc: "Licensor", entityType: "licensor" },
    { divisionCode: "SP001", mgTypeCode: "06", mgTypeDesc: "Property", entityType: "property" },
  ];
}

function okPages(pairs) {
  return pairs.map((p) => ({ divisionCode: p.divisionCode, mgTypeCode: p.mgTypeCode, entityType: p.entityType, pagesFetched: 1, terminalReached: true, rowCount: 1 }));
}

function snapshot(overrides = {}) {
  const pairs = overrides.pairs ?? okPairs();
  const details = overrides.details ?? [
    detail("CW001", "05", "DY", "DISNEY"),
    detail("CW001", "06", "1P", "ONE PIECE GENERAL ART"),
  ];
  return buildSnapshot({
    companyCode: COMPANY,
    headers: overrides.headers ?? baseHeaders(),
    details,
    pairs,
    pages: overrides.pages ?? okPages(pairs),
    config: overrides.config ?? {
      headerDivisions: CONFIG.headerDivisions,
      requiredDivisions: CONFIG.requiredDivisions,
      licensorFloor: 1,
      propertyFloor: 1,
      maxCountDropPct: CONFIG.maxCountDropPct,
    },
    prior: overrides.prior,
  });
}

// ---------------------------------------------------------------------------------------
// Meaning resolution — the single most dangerous assumption (mgTypeCode is not global).
// ---------------------------------------------------------------------------------------
test("normalizeMeaning: only exact licensor/property count; Big Theme etc. are not entities", () => {
  assert.equal(normalizeMeaning("Licensor"), "licensor");
  assert.equal(normalizeMeaning("  PROPERTY "), "property");
  assert.equal(normalizeMeaning("Big Theme"), null);
  assert.equal(normalizeMeaning("Product Line"), null);
  assert.equal(normalizeMeaning("Little Theme"), null);
  assert.equal(normalizeMeaning(null), null);
});

test("resolveLicensedTypes: derives CW001/SP001 05/06 pairs and ignores EH001 Big Theme", () => {
  const { pairs, unrecognized } = resolveLicensedTypes(baseHeaders());
  const key = (p) => `${p.divisionCode}/${p.mgTypeCode}=${p.entityType}`;
  assert.ok(pairs.some((p) => key(p) === "CW001/05=licensor"));
  assert.ok(pairs.some((p) => key(p) === "CW001/06=property"));
  assert.ok(pairs.some((p) => key(p) === "SP001/06=property"));
  // EH001 05 is Big Theme — must NOT become a licensor/property pair.
  assert.ok(!pairs.some((p) => p.divisionCode === "EH001"));
  assert.ok(unrecognized.some((p) => p.divisionCode === "EH001" && p.mgTypeDesc === "Big Theme"));
});

// ---------------------------------------------------------------------------------------
// Natural key + source hash
// ---------------------------------------------------------------------------------------
test("encodeSourceId: reversible composite key, never mgCode alone", () => {
  assert.equal(encodeSourceId(COMPANY, "CW001", "05", "DY"), "EDGEHOME/CW001/05/DY");
  assert.notEqual(encodeSourceId(COMPANY, "CW001", "05", "DY"), encodeSourceId(COMPANY, "CW001", "06", "DY"));
});

test("sourceHashOf: stable across key order and changes when any raw source field changes", () => {
  const a = detail("CW001", "05", "DY", "DISNEY");
  const b = Object.fromEntries(Object.entries(detail("CW001", "05", "DY", "DISNEY")).reverse());
  const renamed = detail("CW001", "05", "DY", "THE WALT DISNEY COMPANY");
  const metadataChanged = { ...a, mgCategory: "changed" };
  assert.equal(sourceHashOf(a), sourceHashOf(b));
  assert.notEqual(sourceHashOf(a), sourceHashOf(renamed));
  assert.notEqual(sourceHashOf(a), sourceHashOf(metadataChanged));
});

// ---------------------------------------------------------------------------------------
// validateSnapshot guard matrix (mirrors the DB guards)
// ---------------------------------------------------------------------------------------
test("validateSnapshot: a clean licensed snapshot is ok", () => {
  const d = validateSnapshot(snapshot());
  assert.equal(d.ok, true, `expected ok; errors=${JSON.stringify(d.errors)}`);
  assert.equal(d.action === "ok" || d.action === "warn", true);
  assert.equal(d.counts.licensor >= 1, true);
  assert.equal(d.counts.property >= 1, true);
});

test("validateSnapshot: empty headers abort", () => {
  const d = validateSnapshot(snapshot({ headers: [] }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /empty \/merchGroupHeaders/i);
});

test("validateSnapshot: missing required licensed division aborts", () => {
  // SP001 has no pairs.
  const pairs = okPairs().filter((p) => p.divisionCode !== "SP001");
  const pages = okPages(pairs);
  const d = validateSnapshot(snapshot({ pairs, pages }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /SP001 must have exactly one Licensor pair/);
});

test("validateSnapshot: missing configured header division and duplicate header key abort", () => {
  const headers = baseHeaders().filter((h) => h.divisionCode !== "EH001");
  headers.push({ ...headers[0] });
  const d = validateSnapshot(snapshot({ headers }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /configured header division EH001 is missing/);
  assert.match(d.errors.join("; "), /duplicate header natural key/);
});

test("validateSnapshot: semantic mismatch (EH001 Big Theme declared as licensor) aborts", () => {
  const pairs = [...okPairs(), { divisionCode: "EH001", mgTypeCode: "05", mgTypeDesc: "Big Theme", entityType: "licensor" }];
  const pages = okPages(pairs);
  const d = validateSnapshot(snapshot({ pairs, pages }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /semantic mismatch/i);
});

test("validateSnapshot: non-terminal page (silent page skip) aborts", () => {
  const pages = okPairs().map((p) => ({ divisionCode: p.divisionCode, mgTypeCode: p.mgTypeCode, entityType: p.entityType, pagesFetched: 2, terminalReached: false, rowCount: 1 }));
  const d = validateSnapshot(snapshot({ pages }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /incomplete pagination/);
});

test("validateSnapshot: missing page accounting for a resolved pair aborts", () => {
  const pages = okPages(okPairs()).slice(1);
  const d = validateSnapshot(snapshot({ pages }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /must have exactly one page-accounting record/);
});

test("validateSnapshot: conflicting duplicate natural key aborts", () => {
  const details = [
    detail("CW001", "05", "DUP", "NAME ONE"),
    detail("CW001", "05", "DUP", "NAME TWO"), // same key, different mgDesc -> different hash
  ];
  const d = validateSnapshot(snapshot({ details }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /conflicting duplicate natural key/);
});

test("validateSnapshot: blank mgCode/mgDesc aborts", () => {
  const details = [detail("CW001", "05", "  ", "DISNEY")];
  const d = validateSnapshot(snapshot({ details }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /nonblank mgCode\/mgDesc/);
});

test("validateSnapshot: empty details abort", () => {
  const d = validateSnapshot(snapshot({ details: [] }));
  assert.equal(d.ok, false);
  assert.match(d.errors.join("; "), /empty \/merchGroupDetails/);
});

test("validateSnapshot: short pull under the configured floor aborts", () => {
  const details = [
    detail("CW001", "05", "L1", "LIC A"),
    detail("CW001", "06", "P1", "PROP A"),
    detail("CW001", "06", "P2", "PROP B"),
  ];
  const d = validateSnapshot(snapshot({ details, config: { requiredDivisions: ["CW001", "SP001"], licensorFloor: 5, propertyFloor: 20, maxCountDropPct: 50 } }));
  assert.equal(d.ok, false);
  assert.ok(d.errors.some((w) => /short licensor pull/.test(w)));
  assert.ok(d.errors.some((w) => /short property pull/.test(w)));
});

test("validateSnapshot: count drop beyond threshold aborts", () => {
  const details = [
    detail("CW001", "05", "L1", "LIC A"),
    detail("CW001", "06", "P1", "PROP A"),
    detail("CW001", "06", "P2", "PROP B"),
    detail("CW001", "06", "P3", "PROP C"),
  ];
  const d = validateSnapshot(snapshot({ details, prior: { licensorCount: 22, propertyCount: 258 } }));
  assert.equal(d.ok, false);
  assert.ok(d.errors.some((w) => /dropped from 22/.test(w)));
  assert.ok(d.errors.some((w) => /dropped from 258/.test(w)));
});

test("classifyDetails: 0 rows abort, non-array abort, populated ok", () => {
  assert.equal(classifyDetails([]).action, "abort");
  assert.equal(classifyDetails(null).action, "abort");
  assert.equal(classifyDetails([{ mgCode: "A" }]).action, "ok");
});

// ---------------------------------------------------------------------------------------
// collectHeaders / collectDetails with injected fetch (no live call)
// ---------------------------------------------------------------------------------------
function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("collectHeaders: requests every configured division, merges envelope rows", async () => {
  const seen = [];
  const rows = await collectHeaders("fixture-key", ["CW001", "SP001"], async (url) => {
    const div = new URL(url).searchParams.get("divisionCode");
    seen.push(div);
    return jsonResponse([{ companyCode: COMPANY, divisionCode: div, mgTypeCode: "05", mgTypeDesc: "Licensor" }]);
  });
  assert.deepEqual(seen, ["CW001", "SP001"]);
  assert.equal(rows.length, 2);
});

test("collectDetails: plain-array response is terminal and raw source rows are not polluted", async () => {
  const pairs = [{ divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor", entityType: "licensor" }];
  const calls = [];
  const { details, pages } = await collectDetails("fixture-key", pairs, async (url) => {
    calls.push(String(url));
    // merchGroupDetails returns a plain JSON array (not a paged envelope).
    return jsonResponse([{ companyCode: COMPANY, divisionCode: "CW001", mgTypeCode: "05", mgCode: "DY", mgDesc: "DISNEY" }]);
  });
  assert.equal(details.length, 1);
  assert.equal(Object.hasOwn(details[0], "mgTypeDesc"), false);
  assert.equal(pages[0].terminalReached, true);
  assert.equal(pages[0].rowCount, 1);
});

test("collectDetails: HTTP failure propagates (no silent swallow)", async () => {
  const pairs = [{ divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor", entityType: "licensor" }];
  await assert.rejects(
    () => collectDetails("fixture-key", pairs, async () => ({ ok: false, status: 500, json: async () => ({}) })),
    /HTTP 500/,
  );
});

test("collectDetails: non-JSON/unexpected (non-array, non-envelope) payload throws", async () => {
  const pairs = [{ divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor", entityType: "licensor" }];
  await assert.rejects(
    () => collectDetails("fixture-key", pairs, async () => jsonResponse({ unexpected: true })),
    /did not return an array or paged content envelope/,
  );
});

test("collectDetails: empty pair pull throws (no silent per-pair skip)", async () => {
  const pairs = [{ divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor", entityType: "licensor" }];
  await assert.rejects(
    () => collectDetails("fixture-key", pairs, async () => jsonResponse([])),
    /empty \/merchGroupDetails pull/,
  );
});

// ---------------------------------------------------------------------------------------
// Missing API key
// ---------------------------------------------------------------------------------------
test("readColdlionApiKey prefers COLDLION_API_KEY env (no op call needed)", async () => {
  const { readColdlionApiKey } = await import("./coldlion-sync-common.mjs");
  const orig = process.env.COLDLION_API_KEY;
  process.env.COLDLION_API_KEY = "fixture-key-from-env";
  try {
    assert.equal(readColdlionApiKey(), "fixture-key-from-env");
  } finally {
    if (orig === undefined) delete process.env.COLDLION_API_KEY;
    else process.env.COLDLION_API_KEY = orig;
  }
});

test("readColdlionApiKey throws when no key AND op is unresolvable (missing-key failure)", async () => {
  const { readColdlionApiKey } = await import("./coldlion-sync-common.mjs");
  const origKey = process.env.COLDLION_API_KEY;
  const origPath = process.env.PATH;
  delete process.env.COLDLION_API_KEY;
  // Force `op` to be unresolvable so the documented missing-key path is exercised
  // deterministically, independent of whether 1Password CLI is installed.
  process.env.PATH = "";
  try {
    assert.throws(() => readColdlionApiKey(), /COLDLION_API_KEY|op read/i);
  } finally {
    if (origKey === undefined) delete process.env.COLDLION_API_KEY;
    else process.env.COLDLION_API_KEY = origKey;
    process.env.PATH = origPath;
  }
});

// ---------------------------------------------------------------------------------------
// Durable failure SQL + import SQL builders
// ---------------------------------------------------------------------------------------
test("buildImportSql calls the public mirror_only wrapper and forces mirror_only", () => {
  const sql = buildImportSql(buildSnapshot({ companyCode: COMPANY, headers: [], details: [], pairs: [], pages: [], config: {} }));
  assert.match(sql, /public\.sync_coldlion_licensors_properties/);
  assert.match(sql, /'mirror_only'/);
});

test("buildFailureSql records a durable failed row and alerts after two consecutive non-promotions", () => {
  const sql = buildFailedSyncRunSql(SOURCE_NAME, "apply", "forced fixture failure");
  assert.match(sql, /insert into ingest\.sync_run/);
  assert.ok(sql.includes(SOURCE_NAME));
  assert.match(sql, /'failed'/);
  assert.match(sql, /forced fixture failure/);
  assert.match(sql, /pg_notify\('coldlion_sync_alert'/);
});

test("buildPriorCountsSql targets the licensor/property source", () => {
  assert.match(buildPriorCountsSql(), new RegExp(SOURCE_NAME));
  assert.match(buildPriorCountsSql(), /status = 'succeeded'/);
});

test("parsePriorCounts reads psql table output and tolerates no-prior-run", () => {
  const stdout = " licensor_count | property_count\n----------------+----------------\n 22             | 258\n";
  assert.deepEqual(parsePriorCounts(stdout), { licensorCount: 22, propertyCount: 258 });
  const empty = " licensor_count | property_count\n----------------+----------------\n(0 rows)\n";
  assert.equal(parsePriorCounts(empty), null);
  assert.equal(parsePriorCounts(""), null);
});

// ---------------------------------------------------------------------------------------
// Dry-run default/safety + explicit target reporting + no secret emission
// ---------------------------------------------------------------------------------------
test("resolveRunMode: default (no flags) is a dry run that will not write the DB", () => {
  const m = resolveRunMode([], {});
  assert.equal(m.apply, false);
  assert.equal(m.willWriteDb, false);
  assert.match(m.target, /dry-run/);
});

test("resolveRunMode: --apply sets willWriteDb; --linked changes the target", () => {
  const m = resolveRunMode(["--apply"], {});
  assert.equal(m.apply, true);
  assert.equal(m.willWriteDb, true);
  const linked = resolveRunMode(["--apply", "--linked"], {});
  assert.match(linked.target, /--linked/);
});

test("describeTarget: never leaks credentials from a connection string", () => {
  const t = describeTarget("postgres://postgres.user:supersecret@aws-1-us-east-1.pooler.supabase.com:6543/postgres", {});
  assert.equal(t.includes("supersecret"), false);
  assert.equal(t.includes("postgres.user"), false);
  assert.ok(t.includes("***@"));
  assert.ok(t.includes("pooler.supabase.com"));
});

test("no secret emission: CONFIG/SOURCE_NAME contain no key material", () => {
  const blob = JSON.stringify(CONFIG) + SOURCE_NAME;
  assert.equal(/op:\/\//.test(blob), false);
  assert.equal(/x-api-key|apikey|secret|password/i.test(blob), false);
});
