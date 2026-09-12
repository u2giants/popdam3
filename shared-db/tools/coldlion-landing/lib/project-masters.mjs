import { date, num, sourceHash, text } from "./values.mjs";
import { knownApiFields } from "./master-specs.mjs";

function timestamp(value) {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new Error("a timestamp field was not an ISO timestamp");
  if (parsed.toISOString() <= "1900-01-01T23:59:59.999Z") return null;
  return parsed.toISOString();
}

const converters = { text, num, date, ts: timestamp };
converters.keytext = (value) => value === null || value === undefined ? null : String(value).trim();

export function assertKnownShape(spec, rows) {
  const known = knownApiFields(spec);
  const unknown = [...new Set(rows.flatMap((row) => Object.keys(row)).filter((key) => !known.has(key)))].sort();
  if (unknown.length) throw new Error(`${spec.endpoint} returned unreviewed field(s): ${unknown.join(", ")}`);
  const required = spec.fields.map((field)=>field.api);
  for (const row of rows) {
    const missing=required.filter((field)=>!(field in row));
    if (missing.length) throw new Error(`${spec.endpoint} omitted approved field(s): ${missing.join(", ")}`);
  }
}

export function projectCurrentRows(spec, sourceRows, { runId, fetchedAt, excludeDivision = "EP001" } = {}) {
  try { assertKnownShape(spec, sourceRows); }
  catch (error) { error.endpoint ??= spec.endpoint; throw error; }
  const byKey = new Map();
  let excluded = 0;
  for (const source of sourceRows) {
    if (text(source.divisionCode) === excludeDivision) { excluded += 1; continue; }
    const row = {};
    for (const field of spec.fields) row[field.column] = converters[field.type](source[field.api]);
    // The schema contract requires a complete-record hash and retains that record
    // privately in change_log; public fixtures and logs never contain its values.
    row.source_hash = sourceHash(source);
    row.source_raw = source;
    row.run_id = runId;
    row.fetched_at = fetchedAt;
    const key = spec.key.map((column) => row[column] ?? "").join("\u001f");
    if (spec.key.some((column) => row[column] === null)) { const error=new Error(`${spec.endpoint} returned a blank natural key`); error.endpoint=spec.endpoint; throw error; }
    const prior = byKey.get(key);
    if (prior) { const error=new Error(`${spec.endpoint} returned duplicate rows for one natural key`); error.endpoint=spec.endpoint; throw error; }
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()], excluded };
}

export function projectItemSlots(sourceRows, { runId, fetchedAt, itemPkey = null, excludeDivision = "EP001" } = {}) {
  const slots = [];
  for (const source of sourceRows) {
    if (text(source.divisionCode) === excludeDivision) continue;
    for (let slotNo = 1; slotNo <= 14; slotNo += 1) {
      const suffix = String(slotNo).padStart(2, "0");
      const mgCode = text(source[`merchGroup${suffix}`]);
      if (mgCode === null) continue;
      const row = {
        company_code: text(source.companyCode), division_code: text(source.divisionCode), item_no: text(source.itemNo),
        item_pkey: itemPkey === "source" ? text(source.itemPkey) : null,
        slot_no: slotNo, mg_code: mgCode, mg_desc: text(source[`merchGroup${suffix}Desc`]),
        run_id: runId, fetched_at: fetchedAt,
      };
      row.source_hash = sourceHash({ slotNo, mgCode: row.mg_code, mgDesc: row.mg_desc });
      slots.push(row);
    }
  }
  return slots;
}
