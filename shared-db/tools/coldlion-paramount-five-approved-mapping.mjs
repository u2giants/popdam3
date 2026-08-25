import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildExpectedContract,
  buildLinkInput,
  compositeKeyOf,
} from "./run-coldlion-licensor-property-phase4.mjs";

export const APPROVED_HASH = "09e18e47d67181b06483d6cf4454e053";
export const APPROVED_COUNT = 552;
export const APPROVED_DISTINCT = 276;
export const APPROVED_SCHEMA = "coldlion_phase4_approved_mapping_input/v2";
export const APPROVED_MAPPING_PATH = fileURLToPath(new URL(
  "../docs/verification/coldlion-licensor-property-paramount-five-20260825/approved-mapping.json",
  import.meta.url,
));

export function validateWidenedApprovedMapping(doc) {
  if (doc?.schema !== APPROVED_SCHEMA || doc?.approved_by !== "Albert Hazan"
      || doc?.approved_at_utc !== "2026-08-18"
      || doc?.target !== "environment-neutral; prove the database target at execution"
      || !Array.isArray(doc?.mappings)) {
    throw new Error("widened approved mapping header is missing or unauthorized");
  }
  if (doc.mappings.some((m) => !["licensor", "property"].includes(m?.entity_type)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m?.canonical_id ?? "")
      || [m?.company_code, m?.division_code, m?.mg_type_code, m?.mg_code]
        .some((v) => typeof v !== "string" || v.length === 0))) {
    throw new Error("widened approved mapping contains an invalid typed row");
  }
  const keys = doc.mappings.map(compositeKeyOf);
  if (new Set(keys).size !== keys.length) throw new Error("widened mapping has duplicate source keys");
  const expected = buildExpectedContract(doc.mappings);
  if (expected.hash !== APPROVED_HASH || expected.count !== APPROVED_COUNT
      || expected.distinct_canonical !== APPROVED_DISTINCT
      || doc.approved_mapping_hash !== APPROVED_HASH
      || doc.mapping_count !== APPROVED_COUNT
      || doc.distinct_canonical !== APPROVED_DISTINCT) {
    throw new Error("widened approved mapping fingerprint/count contract does not match #539");
  }
  const admitted = doc.mappings.filter((m) => ["AM1","AM2","MGM","WND","EP"].includes(m.mg_code));
  if (admitted.length !== 10
      || new Set(admitted.map((m) => m.canonical_id)).size !== 5
      || admitted.some((m) => m.entity_type !== "property" || m.company_code !== "EDGEHOME"
        || m.mg_type_code !== "06" || !["CW001","SP001"].includes(m.division_code))) {
    throw new Error("widened mapping does not contain exactly the ten approved typed Paramount rows");
  }
  return { doc, input: buildLinkInput(doc), expected };
}

export function loadWidenedApprovedMapping(path = APPROVED_MAPPING_PATH) {
  return validateWidenedApprovedMapping(JSON.parse(readFileSync(path, "utf8")));
}
