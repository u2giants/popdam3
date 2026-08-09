#!/usr/bin/env node
// =====================================================================================
// Guarded ColdLion MG04 -> core.product_size importer (network half).
//
// Issue #597 Phase 1. The database half is
// supabase/migrations/20260809170300_coldlion_product_size_guarded_importer.sql, and it
// is where every guard that can protect shared data actually lives. This file fetches,
// normalises and LANDS the feed; it decides nothing.
//
// USAGE
// -----
//   node tools/import-coldlion-product-size.mjs                  # dry run (default)
//   node tools/import-coldlion-product-size.mjs --apply          # writes; requires the flag
//
// Environment (never hard-code, never paste a value into a file):
//   COLDLION_API_KEY   1Password vibe_coding -> "Coldlion ERP API key x5.coldlion.com"
//   DATABASE_URL       target database. MUST be preview unless production is authorised.
//   COLDLION_BASE_URL  optional override; defaults to the documented base.
//
// FIVE THINGS THIS FILE REFUSES TO DO
// -----------------------------------
// 1. Resolve a Size by code alone. The identity is always the full tuple
//    (companyCode, divisionCode, mgTypeCode, mgCode).
// 2. Treat EP001 MG04 as Size. It is Pages. Excluded here AND refused by the SQL guard
//    AND refused by a CHECK constraint on the table. Three layers, on purpose.
// 3. Stop paging early. `collectPages` walks every page and fails loudly if the feed
//    reports more pages than it delivers.
// 4. Write anything on its own authority. It lands rows and calls one SQL function.
// 5. Fall back. Any failure throws; there is no degraded path that imports less and
//    reports success.
//
// ENTRY GUARD: uses pathToFileURL(process.argv[1]).href. A hand-built
// `file://${argv[1]}` comparison is ALWAYS FALSE on Windows (two slashes vs three) and
// makes the tool exit 0 having done nothing. See AGENTS.md §10.3 — a sibling importer
// shipped exactly that bug and imported nothing for nine days while looking healthy.
// =====================================================================================

import { pathToFileURL } from "node:url";

export const COMPANY_CODE = "EDGEHOME";
export const MG_TYPE_CODE_SIZE = "04";

// The three divisions where merch-group slot 04 means Size.
export const SIZE_DIVISIONS = Object.freeze(["CW001", "EH001", "SP001"]);

// EP001 slot 04 means Pages. Named explicitly rather than derived, so that a future
// reader sees the exclusion and its reason instead of an unexplained absence.
export const EXCLUDED_DIVISIONS = Object.freeze(["EP001"]);

export const DEFAULT_BASE_URL = "http://x5.coldlion.com/EhpApi";

export class ImportRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportRefusal";
  }
}

export function parseArgs(argv = []) {
  const args = {
    apply: false,
    minRows: 500,
    maxRows: 700,
    maxRetirements: 10,
    requestedBy: "tools/import-coldlion-product-size.mjs",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      args.apply = true;
    } else if (token === "--dry-run") {
      args.apply = false;
    } else if (token.startsWith("--min-rows=")) {
      args.minRows = Number.parseInt(token.split("=")[1], 10);
    } else if (token.startsWith("--max-rows=")) {
      args.maxRows = Number.parseInt(token.split("=")[1], 10);
    } else if (token.startsWith("--max-retirements=")) {
      args.maxRetirements = Number.parseInt(token.split("=")[1], 10);
    } else if (token.startsWith("--requested-by=")) {
      args.requestedBy = token.slice("--requested-by=".length);
    } else if (token === "--create" || token.startsWith("--create=")) {
      // There is no create mode. Refusing an unknown flag is safer than ignoring it:
      // an ignored flag reads to the operator as "it did the thing I asked".
      throw new ImportRefusal("--create is not a supported flag for this importer");
    } else {
      throw new ImportRefusal(`unrecognised argument: ${token}`);
    }
  }
  for (const key of ["minRows", "maxRows", "maxRetirements"]) {
    if (!Number.isInteger(args[key]) || args[key] < 0) {
      throw new ImportRefusal(`${key} must be a non-negative integer`);
    }
  }
  if (args.minRows > args.maxRows) {
    throw new ImportRefusal("--min-rows may not exceed --max-rows");
  }
  return args;
}

// Pick the Size divisions out of a /merchGroupHeaders payload. Never assume the
// hard-coded list is still complete — if the feed stops offering one of them, that is a
// refusal, not something to quietly work around.
export function selectSizeDivisions(headers = []) {
  const seen = new Set();
  for (const header of headers) {
    const division = String(header?.divisionCode ?? "").trim();
    const mgType = String(header?.mgTypeCode ?? "").trim();
    if (mgType !== MG_TYPE_CODE_SIZE) continue;
    if (EXCLUDED_DIVISIONS.includes(division.toUpperCase())) continue;
    if (!SIZE_DIVISIONS.includes(division)) continue;
    seen.add(division);
  }
  const missing = SIZE_DIVISIONS.filter((d) => !seen.has(d));
  if (missing.length > 0) {
    throw new ImportRefusal(
      `merchGroupHeaders did not offer MG${MG_TYPE_CODE_SIZE} for division(s): ${missing.join(", ")}. ` +
        "A missing division would retire that division's Sizes wholesale, so the run is refused.",
    );
  }
  return [...seen].sort();
}

export function normalizeDetailRow(row, divisionCode) {
  const code = String(row?.mgCode ?? "").trim();
  const label = String(row?.mgDesc ?? row?.mgDescription ?? "").trim();
  const division = String(divisionCode ?? "").trim();
  if (!code) throw new ImportRefusal(`a ${division} MG04 row has a blank mgCode`);
  if (!label) throw new ImportRefusal(`${division} MG04 code ${code} has a blank label`);
  if (EXCLUDED_DIVISIONS.includes(division.toUpperCase())) {
    throw new ImportRefusal(
      `${division} MG04 means Pages, not Size, and must never enter core.product_size`,
    );
  }
  return {
    companyCode: COMPANY_CODE,
    divisionCode: division,
    mgTypeCode: MG_TYPE_CODE_SIZE,
    code,
    label,
    raw: row ?? {},
  };
}

// Full pagination. `fetchPage(page)` returns either a Spring envelope
// ({content, totalPages, last}) or a plain array (which /merchGroupDetails returns).
export async function collectPages(fetchPage, { maxPages = 200 } = {}) {
  const rows = [];
  let page = 0;
  let pagesRead = 0;
  for (;;) {
    if (pagesRead >= maxPages) {
      throw new ImportRefusal(
        `feed exceeded the ${maxPages}-page ceiling; refusing rather than looping forever`,
      );
    }
    const payload = await fetchPage(page);
    pagesRead += 1;
    if (Array.isArray(payload)) {
      rows.push(...payload);
      return { rows, pagesRead };
    }
    const content = payload?.content;
    if (!Array.isArray(content)) {
      throw new ImportRefusal(
        `page ${page} returned neither an array nor a paged envelope with content[]`,
      );
    }
    rows.push(...content);
    const totalPages = Number(payload?.totalPages ?? 1);
    const last = payload?.last === true || page >= totalPages - 1;
    if (last) {
      if (pagesRead < totalPages) {
        throw new ImportRefusal(
          `feed claimed ${totalPages} pages but delivered ${pagesRead}; a truncated feed is never applied`,
        );
      }
      return { rows, pagesRead };
    }
    page += 1;
  }
}

// Last check before landing. Duplicates within one run would silently collapse under
// the landing table's unique constraint, so they are refused with a real message.
export function assertLandingSetIsSane(rows, { minRows = 500, maxRows = 700 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ImportRefusal("no rows were fetched; refusing to land an empty set");
  }
  if (rows.length < minRows || rows.length > maxRows) {
    throw new ImportRefusal(
      `fetched ${rows.length} Size rows, outside the accepted band ${minRows}..${maxRows}`,
    );
  }
  const seen = new Set();
  for (const row of rows) {
    const key = [row.companyCode, row.divisionCode, row.mgTypeCode, row.code].join("|");
    if (seen.has(key)) {
      throw new ImportRefusal(`duplicate identity in one run: ${key}`);
    }
    seen.add(key);
    if (EXCLUDED_DIVISIONS.includes(String(row.divisionCode).toUpperCase())) {
      throw new ImportRefusal(`EP001 row reached the landing set: ${key}`);
    }
  }
  const divisions = new Set(rows.map((r) => r.divisionCode));
  for (const division of SIZE_DIVISIONS) {
    if (!divisions.has(division)) {
      throw new ImportRefusal(`no rows fetched for division ${division}`);
    }
  }
  return { rowCount: rows.length, divisions: [...divisions].sort() };
}

async function fetchJson(url, apiKey) {
  const response = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!response.ok) {
    throw new ImportRefusal(`GET ${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchSizeRows({ baseUrl = DEFAULT_BASE_URL, apiKey } = {}) {
  if (!apiKey) throw new ImportRefusal("COLDLION_API_KEY is required");
  const headerPayload = await collectPages((page) =>
    fetchJson(
      `${baseUrl}/merchGroupHeaders?companyCode=${COMPANY_CODE}&size=200&page=${page}`,
      apiKey,
    ),
  );
  const divisions = selectSizeDivisions(headerPayload.rows);

  const rows = [];
  for (const division of divisions) {
    const detail = await collectPages((page) =>
      fetchJson(
        `${baseUrl}/merchGroupDetails?companyCode=${COMPANY_CODE}` +
          `&divisionCode=${division}&mgTypeCode=${MG_TYPE_CODE_SIZE}&size=500&page=${page}`,
        apiKey,
      ),
    );
    for (const raw of detail.rows) rows.push(normalizeDetailRow(raw, division));
  }
  return rows;
}

export async function runImport({ argv = [], env = process.env, log = console.log } = {}) {
  const args = parseArgs(argv);

  if (!env.DATABASE_URL) throw new ImportRefusal("DATABASE_URL is required");
  if (!env.COLDLION_API_KEY) throw new ImportRefusal("COLDLION_API_KEY is required");

  const { default: pg } = await import("pg");

  const rows = await fetchSizeRows({
    baseUrl: env.COLDLION_BASE_URL || DEFAULT_BASE_URL,
    apiKey: env.COLDLION_API_KEY,
  });
  const shape = assertLandingSetIsSane(rows, { minRows: args.minRows, maxRows: args.maxRows });
  log(`fetched ${shape.rowCount} Size rows across ${shape.divisions.join(", ")}`);

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    // TARGET PROOF, printed immediately before the first write, every run.
    const proof = await client.query(
      "select current_database() as db, current_user as usr, inet_server_addr()::text as host",
    );
    log(`TARGET PROOF db=${proof.rows[0].db} user=${proof.rows[0].usr}`);

    await client.query("begin");
    const run = await client.query(
      `insert into ingest.coldlion_product_size_run
         (mode, requested_by, source_endpoint, page_count, fetched_row_count)
       values ($1, $2, '/merchGroupDetails', null, $3) returning id`,
      [args.apply ? "apply" : "dry_run", args.requestedBy, shape.rowCount],
    );
    const runId = run.rows[0].id;

    for (const row of rows) {
      await client.query(
        `insert into ingest.coldlion_product_size_landing
           (run_id, company_code, division_code, mg_type_code, code, label, raw)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [runId, row.companyCode, row.divisionCode, row.mgTypeCode, row.code, row.label, row.raw],
      );
    }

    const result = await client.query(
      "select ingest.apply_coldlion_product_size($1,$2,$3,$4,$5) as result",
      [runId, args.apply, args.minRows, args.maxRows, args.maxRetirements],
    );
    await client.query("commit");
    log(JSON.stringify(result.rows[0].result, null, 2));
    return result.rows[0].result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runImport({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(`IMPORT FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
