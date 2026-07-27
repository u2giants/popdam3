const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sharedDbRoot = process.argv[2];
if (!sharedDbRoot) {
  throw new Error("Pass the explicit shared-db root. Refusing to use a stale default path.");
}
const outputPath = path.resolve(
  __dirname,
  "../src/features/popsg-property-reconciliation/generated-psg2-fixture.ts",
);
const { parseCsv } = require(path.join(
  sharedDbRoot,
  "scripts/popsg-property-psg2-proposals.cjs",
));

const psg1Dir = path.join(
  sharedDbRoot,
  "docs/verification/popsg-property-reconciliation-20260727-psg1",
);
const psg2Dir = path.join(
  sharedDbRoot,
  "docs/verification/popsg-property-reconciliation-20260727-psg2",
);

const inventory = parseCsv(fs.readFileSync(path.join(psg1Dir, "inventory.csv"), "utf8"));
const inventoryByKey = new Map(inventory.map((row) => [row.observation_key, row]));
const proposals = parseCsv(fs.readFileSync(path.join(psg2Dir, "proposals.csv"), "utf8"));
const approvedBatchPath = path.join(psg2Dir, "batch-01-exact-existing.csv");
const approvedBatchBytes = Buffer.from(
  fs.readFileSync(approvedBatchPath, "utf8").replace(/\r\n/g, "\n"),
);
const approvedBatchSha256 = crypto.createHash("sha256").update(approvedBatchBytes).digest("hex");
const expectedApprovedBatchSha256 =
  "f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e";
if (approvedBatchSha256 !== expectedApprovedBatchSha256) {
  throw new Error(`Approved batch hash mismatch: ${approvedBatchSha256}`);
}
const approvedBatch = parseCsv(approvedBatchBytes.toString("utf8"));
const approvedBatchKeys = new Set(approvedBatch.map((row) => row.observation_key));
if (approvedBatchKeys.size !== 51) throw new Error("Approved batch must contain exactly 51 keys.");
const candidateEvidence = parseCsv(
  fs.readFileSync(path.join(psg1Dir, "candidate-evidence.csv"), "utf8"),
);
const candidateStatusByObservationAndId = new Map(
  candidateEvidence.map((row) => [
    `${row.observation_key}|${row.candidate_property_id}`,
    row.candidate_property_status,
  ]),
);

function batchId(proposal) {
  const disposition = proposal.proposed_disposition;
  if (approvedBatchKeys.has(proposal.observation_key)) return "batch-01-exact-existing";
  if (["non_property", "licensed_no_code"].includes(disposition)) {
    return "batch-02-non-property";
  }
  if (disposition === "canonical_create_candidate") return "batch-03-create-candidates";
  if (disposition === "licensor_unresolved") return "batch-05-licensor-unresolved";
  return "batch-04-open-review";
}

const rows = proposals.map((proposal) => {
  const source = inventoryByKey.get(proposal.observation_key);
  if (!source) throw new Error(`Missing PSG-1 evidence for ${proposal.observation_key}`);
  return {
    observationKey: proposal.observation_key,
    batchId: batchId(proposal),
    licensorId: proposal.resolved_licensor_id || null,
    licensorName: proposal.resolved_licensor_name || "Unresolved",
    observedValue: proposal.normalized_observed_value || "[blank]",
    activeFileCount: Number(proposal.active_file_count),
    disposition: proposal.proposed_disposition,
    rationaleCode: proposal.rationale_code,
    targetPropertyId: proposal.target_property_id || null,
    targetPropertyCode: proposal.target_property_code || null,
    targetPropertyName: proposal.target_property_name || null,
    targetPropertyStatus: proposal.target_property_id
      ? candidateStatusByObservationAndId.get(
          `${proposal.observation_key}|${proposal.target_property_id}`,
        ) || "status-not-in-frozen-evidence"
      : null,
    targetPropertyParentLicensorId: proposal.target_property_parent_licensor_id || null,
    currentlyTaggedAtRisk: proposal.currently_tagged_at_risk === "true",
    ambiguity: source.ambiguity_flag === "true",
    representativeExamples: JSON.parse(source.representative_examples || "[]"),
  };
});

const output = `// Generated from signed PSG-1/PSG-2 evidence. Do not hand-edit.\n` +
  `// Generator: scripts/generate-popsg-property-reconciliation-fixture.cjs\n` +
  `export const PSG2_APPROVED_BATCH_SOURCE_SHA256 = ${JSON.stringify(approvedBatchSha256)} as const;\n` +
  `export const PSG2_SIGNED_BATCH_KEYS = ${JSON.stringify([...approvedBatchKeys].sort(), null, 2)} as const;\n` +
  `export const PSG2_FIXTURE_ROWS = ${JSON.stringify(rows, null, 2)} as const;\n`;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, "utf8");
console.log(`Wrote ${rows.length} rows to ${outputPath}`);
