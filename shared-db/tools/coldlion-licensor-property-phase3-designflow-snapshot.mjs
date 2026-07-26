// ColdLion licensor/property Phase 3 — fresh read-only DesignFlow comparison snapshot.
//
// Fetches DesignFlow's getLicensorsWithProperties (GET, x-api-key) and writes a dated,
// trustworthy comparison snapshot used as the Phase 3 entry-gate evidence and the parent-edge
// comparison source. This script DOES NOT touch Supabase (no read, no write): it is a pure
// read-only HTTP GET against api.designflow.app. The API key is supplied via env and never
// printed.
//
// The pure helpers (pickTitle, hashEdges, summarizePayload) are EXPORTED so the validation test
// can exercise the title mapping + blank-title guard deterministically with synthetic payloads,
// WITHOUT calling the API. The network/filesystem code runs only when this file is invoked
// directly (`node tools/...snapshot.mjs`), never on import.
//
// IMPORTANT (title field): the live DesignFlow API exposes each licensor/property NAME as `title`.
// An earlier version of this tool read `mg_desc`/`name`, which the payload does not carry, so every
// emitted name was blank. pickTitle now reads `title` FIRST (mg_desc/name kept only as legacy
// fallbacks), and summarizePayload reports name completeness (titles_complete + per-field blank
// counts) so a blank title can never silently pass. The checked-in snapshot was regenerated
// with this title-aware mapper; see README §7 for the refresh command.
//
// Usage:
//   DESIGNFLOW_API_KEY="$(op read 'op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key')" \
//     node tools/coldlion-licensor-property-phase3-designflow-snapshot.mjs [output_dir]
//
// Writes:
//   <output_dir>/designflow-fresh-snapshot.json   summary (counts, edge_hash, distinct codes, title completeness)
//   <output_dir>/designflow-fresh-edges.json      full edge list (licensor->property, non-secret)
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const DESIGNFLOW_ENDPOINT =
  "https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties";

// Resolve the human-readable title for a DesignFlow licensor/property record. The live API exposes
// the name as `title`; `mg_desc`/`name` are legacy fallbacks kept for older snapshots. `title`
// wins when present (an empty-string title is reported as blank, not silently substituted), so a
// missing/blank title surfaces instead of masquerading as a populated name. Pure + deterministic.
export function pickTitle(obj) {
  return String(obj?.title ?? obj?.mg_desc ?? obj?.name ?? "").trim();
}

function pickCode(obj) {
  return String(obj?.mg_code ?? obj?.code ?? "").trim();
}

// Deterministic edge hash over the flattened edge list. The encoding is identical to the original
// tool: sort by (division, licensor_code, property_code), join each edge's 7 fields with a tab,
// then join all rows with a newline and md5. Exported so a test can verify the recorded edge_hash
// equals a recompute over the recorded edges (internal consistency) instead of a brittle literal
// that would change once the snapshot is regenerated with populated titles.
export function hashEdges(edges) {
  const ordered = [...edges].sort((a, b) =>
    String([a.division, a.licensor_code, a.property_code])
      .localeCompare(String([b.division, b.licensor_code, b.property_code])));
  return createHash("md5")
    .update(
      ordered
        .map((e) =>
          [
            e.division, e.licensor_code, e.licensor_name, e.licensor_active,
            e.property_code, e.property_name, e.property_active,
          ].join("\t"))
        .join("\n"),
    )
    .digest("hex");
}

// Pure, deterministic transform of the raw DesignFlow payload into the snapshot summary + edges.
// No network, no filesystem. Exposed for local test coverage (title precedence + blank guard).
export function summarizePayload(licensors, meta = {}) {
  if (!Array.isArray(licensors)) {
    throw new TypeError("summarizePayload: licensors payload must be an array");
  }
  let propertyRows = 0;
  const licensorCodes = new Set();
  const propertyCodes = new Set();
  const edges = [];
  for (const lic of licensors) {
    const lcode = pickCode(lic);
    const lname = pickTitle(lic);
    const lactive = lic.is_active == null ? "" : !!lic.is_active;
    if (lcode) licensorCodes.add(lcode);
    for (const p of (lic.properties || [])) {
      propertyRows += 1;
      const pcode = pickCode(p);
      const pname = pickTitle(p);
      if (pcode) propertyCodes.add(pcode);
      edges.push({
        division: lic.divisionCode_id_fk ?? lic.divisionCode ?? "",
        licensor_code: lcode,
        licensor_name: lname,
        licensor_active: lactive,
        property_code: pcode,
        property_name: pname,
        property_active: p.is_active == null ? "" : !!p.is_active,
      });
    }
  }

  const edgeHash = hashEdges(edges);

  const propActiveTrue = edges.filter((e) => e.property_active === true).length;
  const propActiveFalse = edges.filter((e) => e.property_active === false).length;
  const blankLicNames = edges.filter((e) => e.licensor_name === "").length;
  const blankPropNames = edges.filter((e) => e.property_name === "").length;

  const summary = {
    fetched_at_utc: meta.startedAtUtc ?? null,
    endpoint: meta.endpoint ?? DESIGNFLOW_ENDPOINT,
    http_status: meta.httpStatus ?? null,
    elapsed_ms: meta.elapsedMs ?? null,
    licensor_rows: licensors.length,
    distinct_licensor_codes: licensorCodes.size,
    property_rows: propertyRows,
    distinct_property_codes: propertyCodes.size,
    edge_count: edges.length,
    edge_hash: edgeHash,
    property_active_breakdown: {
      true: propActiveTrue,
      false: propActiveFalse,
      blank: edges.length - propActiveTrue - propActiveFalse,
    },
    // Name-completeness guard: the API name lives in `title`. A blank title is surfaced here as a
    // non-zero blank count and titles_complete=false so it can never silently pass.
    licensor_name_breakdown: { populated: edges.length - blankLicNames, blank: blankLicNames },
    property_name_breakdown: { populated: edges.length - blankPropNames, blank: blankPropNames },
    titles_complete: blankLicNames === 0 && blankPropNames === 0,
    distinct_licensor_codes_sorted: [...licensorCodes].sort(),
    distinct_property_codes_sorted: [...propertyCodes].sort(),
  };
  return { summary, edges };
}

async function main() {
  const outputDir = resolve(
    process.argv[2] || "docs/verification/coldlion-licensor-property-phase3-20260725",
  );

  const key = process.env.DESIGNFLOW_API_KEY;
  if (!key) {
    throw new Error("DESIGNFLOW_API_KEY is not set (use the 1Password op:// reference).");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response;
  const startedAt = new Date();
  const t0 = Date.now();
  try {
    response = await fetch(DESIGNFLOW_ENDPOINT, { headers: { "x-api-key": key }, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const elapsedMs = Date.now() - t0;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${DESIGNFLOW_ENDPOINT} returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`${DESIGNFLOW_ENDPOINT} returned ${typeof payload}; expected a JSON array.`);
  }

  const { summary, edges } = summarizePayload(payload, {
    startedAtUtc: startedAt.toISOString(),
    httpStatus: response.status,
    elapsedMs,
  });

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "designflow-fresh-snapshot.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDir, "designflow-fresh-edges.json"), `${JSON.stringify(edges, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    fetched_at_utc: summary.fetched_at_utc,
    http_status: summary.http_status,
    licensor_rows: summary.licensor_rows,
    distinct_licensor_codes: summary.distinct_licensor_codes,
    property_rows: summary.property_rows,
    distinct_property_codes: summary.distinct_property_codes,
    edge_count: summary.edge_count,
    edge_hash: summary.edge_hash,
    titles_complete: summary.titles_complete,
    licensor_name_blank: summary.licensor_name_breakdown.blank,
    property_name_blank: summary.property_name_breakdown.blank,
    output_dir: outputDir,
  }, null, 2)}\n`);
}

// Run only when invoked directly, never on import — so the validation test can import the pure
// helpers offline (no API key, no network).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(`${e.stack || String(e)}\n`);
    process.exitCode = 1;
  });
}
