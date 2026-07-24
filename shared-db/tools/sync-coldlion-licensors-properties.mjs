#!/usr/bin/env node
// Operational runner for the Phase 2A ColdLion licensor/property MIRROR-ONLY sync.
//
// Pulls ColdLion /merchGroupHeaders (every division) + the licensed-division
// /merchGroupDetails (licensor + property type pairs), validates the snapshot, and calls
// public.sync_coldlion_licensors_properties(snapshot, 'mirror_only') — the SECURITY
// DEFINER wrapper over plm.sync_coldlion_licensors_properties.
//
// Reuses the shared ColdLion helpers in coldlion-sync-common.mjs (fetchPaged, runSql,
// buildFailedSyncRunSql, sqlDollarQuote, readColdlionApiKey, COLDLION_BASE_URL) so paging
// and durable-failure logic are not forked. All curation/canonical guards live in SQL;
// this runner adds the operational safety the DB function cannot: caller-side empty/short
// and completeness validation, --dry-run default safety, explicit target reporting, and
// PR #107 durable-failure recording in a SEPARATE transaction (the in-function failed
// sync_run rolls back with the aborted import).
//
// Meaning is ALWAYS resolved from (divisionCode, mgTypeCode) -> mgTypeDesc via headers.
// It never assumes 05/06 means licensor/property globally (EH001 05=Big Theme,
// EP001 05=Product Line). The source natural key is
// (companyCode, divisionCode, mgTypeCode, mgCode); mgDesc is mutable and never in the key.
//
// Usage:
//   COLDLION_API_KEY=... DATABASE_URL=postgres://... node tools/sync-coldlion-licensors-properties.mjs            # dry-run (no DB write)
//   COLDLION_API_KEY=... DATABASE_URL=postgres://... node tools/sync-coldlion-licensors-properties.mjs --apply      # commit
//   COLDLION_API_KEY=...                                                node tools/sync-coldlion-licensors-properties.mjs --apply --linked
//
// ColdLion key: env COLDLION_API_KEY, else `op read op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`.
// Thresholds/divisions are configurable via env (see CONFIG below); 22/258 are NOT baked
// in as permanent "correct" counts.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  COLDLION_BASE_URL,
  buildFailedSyncRunSql,
  fetchPaged,
  readColdlionApiKey,
  runSql,
  sqlDollarQuote,
} from "./coldlion-sync-common.mjs";

// =====================================================================================
// CONFIG — thresholds and required divisions are configuration, not embedded constants.
// The 22 / 258 measured counts inform only conservative floors; they must never become a
// permanent hard-coded "correct" assertion (fix_coldlion_licensor_property_cutover.md §6.2).
// =====================================================================================
export const SOURCE_NAME = "coldlion_licensors_properties_api";
export const PREVIEW_PROJECT_REF = "rjyboqwcdzcocqgmsyel";
export const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";

export const CONFIG = {
  companyCode: process.env.COLDLION_COMPANY_CODE ?? "EDGEHOME",
  // Divisions whose /merchGroupHeaders are fetched to keep the all-division dictionary
  // complete (cheap: 37 rows total). EH001/EP001 are fetched for the dictionary and for
  // the semantic-stability guard, but their 05/06 slots are NEVER treated as licensor/property.
  headerDivisions: (process.env.COLDLION_HEADER_DIVISIONS ?? "CW001,SP001,EH001,EP001")
    .split(",").map((d) => d.trim()).filter(Boolean),
  // Licensed divisions that MUST each resolve one Licensor pair and one Property pair.
  requiredDivisions: (process.env.COLDLION_REQUIRED_DIVISIONS ?? "CW001,SP001")
    .split(",").map((d) => d.trim()).filter(Boolean),
  // Short-pull floors. A pull below either configured floor aborts. The values are
  // deliberately configurable so a legitimate source contraction can be reviewed and
  // approved by changing operations config rather than silently accepting a partial pull.
  licensorFloor: Number(process.env.COLDLION_LICENSOR_FLOOR ?? 5),
  propertyFloor: Number(process.env.COLDLION_PROPERTY_FLOOR ?? 20),
  // Max acceptable count drop vs the prior successful run, as a percentage.
  maxCountDropPct: Number(process.env.COLDLION_MAX_COUNT_DROP_PCT ?? 50),
};

// =====================================================================================
// Pure helpers (no network, no DB) — unit tested.
// =====================================================================================

// Map a raw mgTypeDesc to a normalized entity meaning. Only exact (case/space-insensitive)
// 'licensor'/'property' count — Big Theme / Little Theme / Product Line / Product Type /
// Art Type / Character etc. are intentionally NOT licensed entities.
export function normalizeMeaning(desc) {
  const m = String(desc ?? "").trim().toLowerCase();
  if (m === "licensor") return "licensor";
  if (m === "property") return "property";
  return null;
}

// Deterministic, reversible encoding of the composite natural key for ingest.raw_record
// source_id (and later core.taxonomy_source_ref source_id). NEVER mgCode alone (§4.3, §3.6).
export function encodeSourceId(companyCode, divisionCode, mgTypeCode, mgCode) {
  return [companyCode, divisionCode, mgTypeCode, mgCode]
    .map((v) => (v ?? "").toString())
    .join("/");
}

// Runner-side deterministic full-payload fingerprint used for duplicate-conflict detection.
// The database independently hashes jsonb text for durable mirror/raw evidence. Both include
// every source field; neither makes mgDesc part of the natural key.
export function sourceHashOf(row) {
  const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return createHash("md5").update(stable(row ?? null), "utf8").digest("hex");
}

// Resolve which (divisionCode, mgTypeCode) header pairs mean Licensor / Property.
// Returns { pairs: [{divisionCode, mgTypeCode, mgTypeDesc, entityType}], byDivision, unrecognized }.
// A pair is licensed only when its header desc normalizes to exactly licensor/property.
export function resolveLicensedTypes(headers, opts = {}) {
  const companyCode = opts.companyCode ?? CONFIG.companyCode;
  const list = Array.isArray(headers) ? headers : [];
  const pairs = [];
  const unrecognized = [];
  for (const h of list) {
    if ((h?.companyCode ?? CONFIG.companyCode) !== companyCode) continue;
    const meaning = normalizeMeaning(h?.mgTypeDesc);
    const pair = {
      divisionCode: h?.divisionCode,
      mgTypeCode: h?.mgTypeCode,
      mgTypeDesc: h?.mgTypeDesc,
      entityType: meaning,
    };
    if (meaning === "licensor" || meaning === "property") pairs.push(pair);
    else unrecognized.push(pair);
  }
  const byDivision = {};
  for (const p of pairs) {
    (byDivision[p.divisionCode] ??= { licensor: [], property: [] })[p.entityType].push(p);
  }
  return { pairs, byDivision, unrecognized };
}

// Vendor-style empty/short pull decision over the full detail payload.
// Returns { action: 'abort' | 'warn' | 'ok', reason }.
export function classifyDetails(rows) {
  if (!Array.isArray(rows)) return { action: "abort", reason: "details payload is not an array" };
  if (rows.length === 0) return { action: "abort", reason: "empty /merchGroupDetails pull (0 rows)" };
  return { action: "ok", reason: `${rows.length} rows` };
}

// Caller-side validation mirroring the DB guards (defense in depth). Returns
// { ok, action, errors[], warnings[], counts }. `action` follows classifyDetails semantics
// for the runner: 'abort' = refuse + durable-fail; 'warn' = loud but proceed; 'ok' = clean.
export function validateSnapshot(snap, opts = {}) {
  const cfg = { ...CONFIG, ...(snap?.config ?? {}), ...(opts.config ?? {}) };
  const errors = [];
  const warnings = [];
  const headers = Array.isArray(snap?.headers) ? snap.headers : null;
  const details = Array.isArray(snap?.details) ? snap.details : null;
  const pages = Array.isArray(snap?.pages) ? snap.pages : null;
  const pairs = Array.isArray(snap?.pairs) ? snap.pairs : null;

  if (!headers) errors.push("headers must be an array");
  if (!details) errors.push("details must be an array");
  if (!pages) errors.push("pages must be an array");
  if (!pairs) errors.push("pairs must be an array");
  if (errors.length) return { ok: false, action: "abort", errors, warnings, counts: {} };

  if (headers.length === 0) errors.push("empty /merchGroupHeaders pull");
  if (pairs.length === 0) errors.push("no licensed licensor/property pairs resolved (missing required division or semantics changed)");

  // Every configured header division must be present, and a header natural key must occur
  // exactly once even if duplicate rows happen to carry the same description.
  for (const div of cfg.headerDivisions) {
    if (!headers.some((h) => h.companyCode === snap.companyCode && h.divisionCode === div)) {
      errors.push(`configured header division ${div} is missing`);
    }
  }
  const headerKeys = new Map();
  for (const h of headers) {
    const key = `${h.companyCode}|${h.divisionCode}|${h.mgTypeCode}`;
    headerKeys.set(key, (headerKeys.get(key) ?? 0) + 1);
  }
  for (const [key, count] of headerKeys) {
    if (count !== 1) errors.push(`duplicate header natural key: ${key} (${count} rows)`);
  }

  // Required divisions each resolve BOTH a licensor and a property pair.
  for (const div of cfg.requiredDivisions) {
    const licCount = pairs.filter((p) => p.divisionCode === div && p.entityType === "licensor").length;
    const propCount = pairs.filter((p) => p.divisionCode === div && p.entityType === "property").length;
    if (licCount !== 1) errors.push(`required licensed division ${div} must have exactly one Licensor pair (found ${licCount})`);
    if (propCount !== 1) errors.push(`required licensed division ${div} must have exactly one Property pair (found ${propCount})`);
  }

  // Semantic guard: every pair's declared entityType must match normalizeMeaning(header desc).
  // This refuses EH001/EP001 05/06 (Big Theme / Product Line) treated as licensor/property.
  for (const p of pairs) {
    const hdr = headers.find(
      (h) => h.companyCode === snap.companyCode && h.divisionCode === p.divisionCode && h.mgTypeCode === p.mgTypeCode,
    );
    const meaning = normalizeMeaning(hdr?.mgTypeDesc);
    if (meaning !== p.entityType) {
      errors.push(
        `semantic mismatch: pair (${p.divisionCode},${p.mgTypeCode}) declared ${p.entityType} but header means "${hdr?.mgTypeDesc ?? ""}"`,
      );
    }
    if (!/^[0-9]{2}$/.test(String(p.mgTypeCode ?? ""))) {
      errors.push(`pair (${p.divisionCode},${p.mgTypeCode}) mgTypeCode must be two digits`);
    }
  }

  // Pagination completeness: every reported page reached terminal.
  for (const pg of pages) {
    if (pg.terminalReached !== true) {
      errors.push(`incomplete pagination for (${pg.divisionCode},${pg.mgTypeCode}): terminalReached !== true`);
    }
  }
  for (const p of pairs) {
    const pairPages = pages.filter(
      (pg) => pg.divisionCode === p.divisionCode
        && pg.mgTypeCode === p.mgTypeCode
        && pg.entityType === p.entityType,
    );
    if (pairPages.length !== 1) {
      errors.push(`pair (${p.divisionCode},${p.mgTypeCode},${p.entityType}) must have exactly one page-accounting record`);
    }
  }

  // Per-entity counts (only details that belong to a resolved licensed pair count).
  const pairBySlot = new Map(pairs.map((p) => [`${p.divisionCode}|${p.mgTypeCode}`, p.entityType]));
  const licensedDetails = details.filter((d) => pairBySlot.has(`${d.divisionCode}|${d.mgTypeCode}`));
  const licensorRows = licensedDetails.filter((d) => pairBySlot.get(`${d.divisionCode}|${d.mgTypeCode}`) === "licensor");
  const propertyRows = licensedDetails.filter((d) => pairBySlot.get(`${d.divisionCode}|${d.mgTypeCode}`) === "property");
  const counts = {
    total: licensedDetails.length,
    licensor: licensorRows.length,
    property: propertyRows.length,
    divisions: [...new Set(licensedDetails.map((d) => d.divisionCode))].sort(),
  };

  if (details.length === 0) errors.push("empty /merchGroupDetails pull (0 rows)");
  if (licensedDetails.length !== details.length) {
    errors.push(`${details.length - licensedDetails.length} detail row(s) do not belong to a resolved licensed pair`);
  }

  // Conflicting duplicate natural key (same composite key, differing payload).
  const seen = new Map();
  for (const d of details) {
    const key = encodeSourceId(d.companyCode, d.divisionCode, d.mgTypeCode, d.mgCode);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(sourceHashOf(d));
  }
  for (const [key, hashes] of seen) {
    if (new Set(hashes).size > 1) errors.push(`conflicting duplicate natural key: ${key}`);
  }

  // Nonblank codes/names.
  for (const d of details) {
    if (String(d.mgCode ?? "").trim() === "" || String(d.mgDesc ?? "").trim() === "") {
      errors.push(`detail row missing nonblank mgCode/mgDesc: ${encodeSourceId(d.companyCode, d.divisionCode, d.mgTypeCode, d.mgCode)}`);
    }
  }

  // Short-pull guards (floors are config; never permanent counts).
  if (licensorRows.length < cfg.licensorFloor) {
    errors.push(`short licensor pull: ${licensorRows.length} < floor ${cfg.licensorFloor}`);
  }
  if (propertyRows.length < cfg.propertyFloor) {
    errors.push(`short property pull: ${propertyRows.length} < floor ${cfg.propertyFloor}`);
  }
  // Count drop vs prior (warn here; the DB hard-aborts past the threshold).
  const prior = snap?.prior;
  if (prior && typeof prior.licensorCount === "number" && prior.licensorCount > 0) {
    if (licensorRows.length < prior.licensorCount * (100 - cfg.maxCountDropPct) / 100) {
      errors.push(`licensor count dropped from ${prior.licensorCount} to ${licensorRows.length} (> ${cfg.maxCountDropPct}% threshold)`);
    }
  }
  if (prior && typeof prior.propertyCount === "number" && prior.propertyCount > 0) {
    if (propertyRows.length < prior.propertyCount * (100 - cfg.maxCountDropPct) / 100) {
      errors.push(`property count dropped from ${prior.propertyCount} to ${propertyRows.length} (> ${cfg.maxCountDropPct}% threshold)`);
    }
  }

  if (errors.length) return { ok: false, action: "abort", errors, warnings, counts };
  return { ok: true, action: warnings.length ? "warn" : "ok", errors, warnings, counts };
}

// Assemble the importer snapshot object (the function's payload contract).
export function buildSnapshot({ companyCode, headers, details, pairs, pages, config, prior }) {
  return {
    companyCode,
    mode: "mirror_only",
    headers,
    details,
    pairs,
    pages,
    config,
    prior: prior ?? null,
  };
}

// `select * from public.sync_coldlion_licensors_properties($snap$::jsonb, 'mirror_only')`.
export function buildImportSql(snapshot) {
  return `select * from public.sync_coldlion_licensors_properties(${sqlDollarQuote("cl_snap", snapshot)}::jsonb, 'mirror_only');\n`;
}

// SQL to read the prior successful run's per-entity counts (for the count-drop guard).
export function buildPriorCountsSql() {
  return `select metadata->>'licensor_rows' as licensor_count, metadata->>'property_rows' as property_count
from ingest.sync_run
where source_name = '${SOURCE_NAME}' and status = 'succeeded'
order by started_at desc nulls last
limit 1;\n`;
}

export function parsePriorCounts(stdout) {
  if (!stdout || !stdout.trim()) return null;
  const lines = stdout.trim().split(/\r?\n/);
  // runSql via psql prints a header row, a `--------+--------` separator, then data rows
  // (the separator joins columns with `+`, not `|`). Filter all of those out.
  const data = lines.filter((l) => l && !l.includes("licensor_count") && !/^[-+]+$/.test(l) && !/^\(/.test(l));
  if (!data.length) return null;
  const cells = data[0].split("|").map((c) => c.trim());
  const lic = cells[0] ? Number(cells[0]) : NaN;
  const prop = cells[1] ? Number(cells[1]) : NaN;
  if (Number.isNaN(lic) && Number.isNaN(prop)) return null;
  return {
    licensorCount: Number.isNaN(lic) ? undefined : lic,
    propertyCount: Number.isNaN(prop) ? undefined : prop,
  };
}

// Redact a connection string to a safe target label. Never print credentials.
export function describeTarget(connString, { linked = false } = {}) {
  if (linked) return "supabase --linked (preview project resolved by `supabase link`)";
  if (!connString) return "none (dry-run; set DATABASE_URL or pass --linked to apply)";
  try {
    const u = new URL(connString);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}:${u.port || "(default)"}${u.pathname}`;
  } catch {
    return "unparseable DATABASE_URL (credentials hidden)";
  }
}

// Pure resolution of the run mode from argv/env. Default (no --apply) is a DRY RUN that
// never writes to the database. Exported so the dry-run-default + target-reporting
// guarantees are unit-testable without spawning the process.
export function resolveRunMode(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv);
  const apply = args.has("--apply");
  const linked = args.has("--linked");
  const connString = env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? null;
  return {
    apply,
    linked,
    willWriteDb: apply,
    connString,
    target: describeTarget(connString, { linked }),
  };
}

export function assertPreviewApplyTarget({ apply, linked, connString, linkedProjectRef = null }) {
  if (!apply) return;

  if (linked && connString) {
    throw new Error("Refusing --apply with both --linked and DATABASE_URL/SUPABASE_DB_URL; choose one explicit preview target");
  }
  if (linked) {
    if (linkedProjectRef !== PREVIEW_PROJECT_REF) {
      throw new Error(
        `Refusing --apply: linked Supabase project is ${linkedProjectRef || "unknown"}, not required preview ${PREVIEW_PROJECT_REF}`,
      );
    }
    return;
  }
  if (!connString) {
    throw new Error("Refusing --apply without a database target; pass --linked to the verified preview project or provide its DATABASE_URL");
  }

  let parsed;
  try {
    parsed = new URL(connString);
  } catch {
    throw new Error("Refusing --apply with an unparseable DATABASE_URL");
  }
  const identity = `${parsed.username} ${parsed.hostname}`;
  if (identity.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(`Refusing --apply to production project ${PRODUCTION_PROJECT_REF}; Phase 2 is preview-only`);
  }
  if (!identity.includes(PREVIEW_PROJECT_REF)) {
    throw new Error(`Refusing --apply: DATABASE_URL does not identify required preview project ${PREVIEW_PROJECT_REF}`);
  }
}

// =====================================================================================
// Operational functions (network / DB). Importable; not unit-tested for live behavior.
// =====================================================================================

// Fetch /merchGroupHeaders for every configured division. merchGroupHeaders returns a paged
// envelope; fetchPaged handles both envelope and plain-array forms.
export async function collectHeaders(apiKey, divisions = CONFIG.headerDivisions, fetchImpl = fetch) {
  const rows = [];
  for (const division of divisions) {
    const url = new URL(`${COLDLION_BASE_URL}/merchGroupHeaders`);
    url.searchParams.set("companyCode", CONFIG.companyCode);
    url.searchParams.set("divisionCode", division);
    url.searchParams.set("size", "200");
    const result = await fetchPaged(url, apiKey, fetchImpl);
    rows.push(...result.rows);
  }
  return rows;
}

// Fetch every page of /merchGroupDetails for each resolved licensed pair. merchGroupDetails
// returns a PLAIN JSON ARRAY (not a paged envelope); fetchPaged treats that as terminal.
// Returns { details, pages } where pages records terminalReached + pagesFetched per pair.
export async function collectDetails(apiKey, pairs, fetchImpl = fetch) {
  const details = [];
  const pages = [];
  for (const pair of pairs) {
    const url = new URL(`${COLDLION_BASE_URL}/merchGroupDetails`);
    url.searchParams.set("companyCode", CONFIG.companyCode);
    url.searchParams.set("divisionCode", pair.divisionCode);
    url.searchParams.set("mgTypeCode", pair.mgTypeCode);
    const result = await fetchPaged(url, apiKey, fetchImpl);
    // Preserve the source payload exactly. Entity meaning travels separately in `pairs`;
    // adding mgTypeDesc here would pollute raw audit evidence with a non-source field.
    details.push(...result.rows);
    pages.push({
      divisionCode: pair.divisionCode,
      mgTypeCode: pair.mgTypeCode,
      entityType: pair.entityType,
      pagesFetched: result.pagesFetched,
      terminalReached: result.terminalReached,
      rowCount: result.rows.length,
    });
    if (result.rows.length === 0) {
      throw new Error(`empty /merchGroupDetails pull for (${pair.divisionCode},${pair.mgTypeCode} ${pair.entityType}) — no silent pair skip`);
    }
  }
  return { details, pages };
}

async function main() {
  const { apply, linked, connString, target } = resolveRunMode(process.argv.slice(2), process.env);
  const linkedProjectRef = linked
    ? readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim()
    : null;
  assertPreviewApplyTarget({ apply, linked, connString, linkedProjectRef });

  process.stdout.write(`${JSON.stringify({
    target,
    mode: apply ? "apply" : "dry-run (no DB write)",
    source_name: SOURCE_NAME,
    config: CONFIG,
  }, null, 2)}\n`);

  let stage = "fetch";
  try {
    const apiKey = readColdlionApiKey();
    const headers = await collectHeaders(apiKey);
    const { pairs, unrecognized } = resolveLicensedTypes(headers);
    process.stdout.write(`${JSON.stringify({
      headers: headers.length,
      licensed_pairs: pairs.map((p) => `${p.divisionCode}/${p.mgTypeCode}=${p.entityType}`),
      unrecognized_meanings: unrecognized.map((p) => `${p.divisionCode}/${p.mgTypeCode}=${p.mgTypeDesc}`),
    }, null, 2)}\n`);

    stage = "details";
    const { details, pages } = await collectDetails(apiKey, pairs);

    // Prior-run counts feed the count-drop guard (only readable when we have a DB target).
    let prior = null;
    if (apply) {
      stage = "prior-counts";
      prior = parsePriorCounts(runSql(buildPriorCountsSql(), { linked }));
    }

    const snapshot = buildSnapshot({
      companyCode: CONFIG.companyCode,
      headers,
      details,
      pairs,
      pages,
      config: {
        headerDivisions: CONFIG.headerDivisions,
        requiredDivisions: CONFIG.requiredDivisions,
        licensorFloor: CONFIG.licensorFloor,
        propertyFloor: CONFIG.propertyFloor,
        maxCountDropPct: CONFIG.maxCountDropPct,
      },
      prior,
    });

    const decision = validateSnapshot(snapshot);
    for (const w of decision.warnings) process.stderr.write(`WARNING: ${w}\n`);
    if (!decision.ok) {
      const reason = decision.errors.join("; ");
      stage = "validate";
      throw new Error(`Refusing to apply: ${reason}`);
    }

    process.stdout.write(`${JSON.stringify({ counts: decision.counts, apply }, null, 2)}\n`);

    if (apply) {
      stage = "apply";
      process.stdout.write(runSql(buildImportSql(snapshot), { linked }));
    } else {
      process.stdout.write("Dry-run complete. No database write performed. Re-run with --apply to import.\n");
    }
  } catch (error) {
    if (apply) {
      try { runSql(buildFailedSyncRunSql(SOURCE_NAME, stage, error?.message ?? String(error)), { linked }); }
      catch (recErr) { process.stderr.write(`WARNING: could not record durable failure: ${recErr?.message ?? recErr}\n`); }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`ColdLion licensor/property sync failed: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
