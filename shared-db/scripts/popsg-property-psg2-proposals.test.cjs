"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  EXPECTED_AT_RISK_SHA256,
  EXPECTED_BATCH_SHA256,
  EXPECTED_INVENTORY_SHA256,
  EXPECTED_OWNER_INDEX_SHA256,
  EXPECTED_PROPOSALS_SHA256,
  PROPOSAL_COLUMNS,
  buildParentEdgeMap,
  buildProposals,
  generate,
  normalize,
  parseCsv,
  sha256,
  toCsv,
} = require("./popsg-property-psg2-proposals.cjs");

const repoRoot = path.resolve(__dirname, "..");
const psg1 = path.join(
  repoRoot,
  "docs",
  "verification",
  "popsg-property-reconciliation-20260727-psg1",
);
const psg0 = path.join(
  repoRoot,
  "docs",
  "verification",
  "popsg-property-reconciliation-20260726",
);
const phase3 = path.join(
  repoRoot,
  "docs",
  "verification",
  "coldlion-licensor-property-phase3-20260725",
);
const psg2 = path.join(
  repoRoot,
  "docs",
  "verification",
  "popsg-property-reconciliation-20260727-psg2",
);
const canonical = (file) =>
  Buffer.from(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "utf8");

// Reuse the PSG-1 normalizer source byte-for-byte and prove every shared fixture.
const psg1Source = fs.readFileSync(
  path.join(repoRoot, "scripts", "popsg-property-psg1-inventory.cjs"),
  "utf8",
).replace(/\r\n/g, "\n");
const frozenNormalizerSource = psg1Source.match(
  /function normalize\(value\) \{[\s\S]*?\n\}/,
);
assert(frozenNormalizerSource, "PSG-1 frozen normalizer source was not found");
assert.equal(normalize.toString(), frozenNormalizerSource[0]);
const normalizationFixtures = JSON.parse(
  fs.readFileSync(path.join(psg0, "normalization-fixtures-v1.json"), "utf8"),
);
for (const fixture of normalizationFixtures) {
  assert.equal(normalize(fixture.input), fixture.expected, fixture.id);
}
assert.equal(normalize("Parks & Rec"), "parks rec");

const generationOptions = {
  inventoryPath: path.join(psg1, "inventory.csv"),
  atRiskPath: path.join(psg1, "currently-tagged-at-risk.csv"),
  dispositionsPath: path.join(phase3, "dispositions.csv"),
  parentEdgesPath: path.join(phase3, "parent-edges.csv"),
};
const result = generate(generationOptions);

assert.equal(result.summary.input_inventory_sha256, EXPECTED_INVENTORY_SHA256);
assert.equal(result.summary.immutable_at_risk_sha256, EXPECTED_AT_RISK_SHA256);
assert.equal(result.proposals.length, 372);
assert.equal(result.summary.active_file_occurrences, 216417);
assert.equal(result.summary.currently_tagged_at_risk_relationships, 6961);
assert.equal(result.summary.automatically_proposed_cross_parent_mappings, 0);
assert.equal(result.summary.unresolved_licensor_property_proposals, 0);
assert.equal(result.summary.fuzzy_selected_mappings, 0);
assert.equal(result.summary.effective_or_activated_proposals, 0);
assert.equal(result.summary.owner_activation_required_rows, 372);
assert(result.proposals.every((row) => row.owner_activation_required));
assert.equal(result.summary.coldlion_phase5_unique_create_candidates, 6);
assert.equal(result.summary.coldlion_phase5_overlaps_in_proposals, 2);
assert.deepEqual(
  result.proposals
    .filter((row) => row.coldlion_phase5_overlap)
    .map((row) => row.create_candidate_code)
    .sort((left, right) => left.localeCompare(right, "en-US")),
  ["CHR", "EX"],
);
assert(
  result.proposals
    .filter((row) => row.target_property_id)
    .every(
      (row) =>
        row.target_property_code &&
        row.target_property_parent_licensor_id === row.resolved_licensor_id &&
        !row.cross_parent_proposal,
    ),
);
assert.equal(
  result.proposals.filter((row) => row.proposed_disposition === "classics_cp").length,
  0,
);
assert.equal(
  result.proposals.filter((row) => row.proposed_disposition === "licensed_no_code").length,
  0,
);
const lionKing = result.proposals.find(
  (row) => row.normalized_observed_value === "the lion king",
);
assert(lionKing);
assert.equal(lionKing.proposed_disposition, "ambiguous");
assert.equal(lionKing.rationale_code, "multiple_same_parent_or_phase5_review_candidates");
const unresolved = result.proposals.filter(
  (row) => row.licensor_resolution === "licensor_unresolved",
);
assert.equal(unresolved.length, 1);
assert.equal(unresolved[0].proposed_disposition, "licensor_unresolved");

function fixtureRow(overrides = {}) {
  return {
    observation_key: "lic-a|observed",
    licensor_resolution: "resolved",
    resolved_licensor_id: "lic-a",
    resolved_licensor_name: "Licensor A",
    normalized_observed_value: "observed",
    active_file_count: "1",
    scoped_exact_property_ids: "[]",
    scoped_exact_property_names: "[]",
    existing_alias_result: "none_property_aliases_frozen_empty",
    candidate_property_ids: "[]",
    structural_folder_hint: "false",
    ambiguity_flag: "false",
    current_accepted_relationship_count: "0",
    currently_tagged_at_risk: "false",
    ...overrides,
  };
}
const fixtureEdges = buildParentEdgeMap([
  {
    property_id: "prop-name",
    property_code: "PN",
    property_name: "STYLE GUIDE",
    licensor_id: "lic-a",
    licensor_name: "Licensor A",
  },
  {
    property_id: "prop-code",
    property_code: "X1",
    property_name: "ALPHA",
    licensor_id: "lic-a",
    licensor_name: "Licensor A",
  },
  {
    property_id: "prop-wrong-parent",
    property_code: "WP",
    property_name: "OBSERVED",
    licensor_id: "lic-b",
    licensor_name: "Licensor B",
  },
  {
    property_id: "cp",
    property_code: "CP",
    property_name: "CLASSIC PROPERTIES",
    licensor_id: "7d141a6f-e229-46a2-b3f5-0ba0c97dd820",
    licensor_name: "DISNEY",
  },
]);
const cp = { id: "cp", code: "CP", name: "CLASSIC PROPERTIES" };
const createCandidates = [
  {
    code: "OBS",
    name: "OBSERVED",
    normalized_name: "observed",
    divisions: "CW001|SP001",
  },
];

// Strict order: exact name beats structural, then exact code is proved independently.
let fixtureProposal = buildProposals(
  [
    fixtureRow({
      normalized_observed_value: "style guide",
      structural_folder_hint: "true",
      scoped_exact_property_ids: '["prop-name"]',
      scoped_exact_property_names: '["STYLE GUIDE"]',
    }),
  ],
  createCandidates,
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "exact_existing");
assert.equal(fixtureProposal.proposal_order, 1);
assert.equal(fixtureProposal.rationale_code, "exact_normalized_canonical_name_under_resolved_licensor");
assert.equal(fixtureProposal.target_property_code, "PN");

fixtureProposal = buildProposals(
  [
    fixtureRow({
      normalized_observed_value: "x1",
      scoped_exact_property_ids: '["prop-code"]',
      scoped_exact_property_names: '["ALPHA"]',
    }),
  ],
  createCandidates,
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposal_order, 2);
assert.equal(fixtureProposal.rationale_code, "exact_canonical_code_under_resolved_licensor");
assert.equal(fixtureProposal.target_property_code, "X1");

// Frozen source has no approved alias contract, so an unexpected alias fails closed at step 3.
assert.throws(
  () =>
    buildProposals(
      [fixtureRow({ existing_alias_result: "unexpected-approved-alias" })],
      createCandidates,
      cp,
      fixtureEdges,
    ),
  /Unexpected approved alias input/,
);

// Steps 4 through 6 precede create/open review.
fixtureProposal = buildProposals(
  [
    fixtureRow({
      observation_key: "disney|bambi",
      resolved_licensor_id: "7d141a6f-e229-46a2-b3f5-0ba0c97dd820",
      resolved_licensor_name: "DISNEY",
      normalized_observed_value: "bambi",
    }),
  ],
  [{ code: "BAM", name: "BAMBI", normalized_name: "bambi", divisions: "CW001" }],
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "classics_cp");
assert.equal(fixtureProposal.proposal_order, 4);

fixtureProposal = buildProposals(
  [fixtureRow({ normalized_observed_value: "style guide", structural_folder_hint: "true" })],
  [{ code: "SG", name: "STYLE GUIDE", normalized_name: "style guide", divisions: "CW001" }],
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "non_property");
assert.equal(fixtureProposal.proposal_order, 5);

fixtureProposal = buildProposals(
  [
    fixtureRow({
      observation_key: "disney|luca",
      resolved_licensor_id: "7d141a6f-e229-46a2-b3f5-0ba0c97dd820",
      resolved_licensor_name: "DISNEY",
      normalized_observed_value: "luca",
    }),
  ],
  [{ code: "LU", name: "LUCA", normalized_name: "luca", divisions: "CW001" }],
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "licensed_no_code");
assert.equal(fixtureProposal.proposal_order, 6);

// Same text under the wrong Licensor and any mismatched target parent fail closed.
assert.throws(
  () =>
    buildProposals(
      [
        fixtureRow({
          scoped_exact_property_ids: '["prop-wrong-parent"]',
          scoped_exact_property_names: '["OBSERVED"]',
        }),
      ],
      createCandidates,
      cp,
      fixtureEdges,
    ),
  /Cross-parent target rejected/,
);
assert.throws(
  () =>
    buildProposals(
      [
        fixtureRow({
          scoped_exact_property_ids: '["missing-property"]',
          scoped_exact_property_names: '["OBSERVED"]',
        }),
      ],
      createCandidates,
      cp,
      fixtureEdges,
    ),
  /Scoped target lacks authoritative edge/,
);

// Fuzzy/reviewer evidence never selects a target.
fixtureProposal = buildProposals(
  [fixtureRow({ candidate_property_ids: '["fuzzy-one"]' })],
  [],
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "deferred");
assert.equal(fixtureProposal.target_property_id, "");
assert.equal(fixtureProposal.fuzzy_similarity_used_for_selection, false);
fixtureProposal = buildProposals(
  [fixtureRow({ candidate_property_ids: '["fuzzy-one","fuzzy-two"]' })],
  [],
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "ambiguous");
assert.equal(fixtureProposal.target_property_id, "");

// Phase-5 create candidates match exact normalized names only, never bare codes.
fixtureProposal = buildProposals(
  [fixtureRow({ normalized_observed_value: "observed" })],
  createCandidates,
  cp,
  fixtureEdges,
)[0];
assert.equal(fixtureProposal.proposed_disposition, "canonical_create_candidate");
assert.equal(fixtureProposal.target_property_id, "");
assert.equal(fixtureProposal.target_property_code, "");
assert.equal(fixtureProposal.create_candidate_code, "OBS");
fixtureProposal = buildProposals(
  [fixtureRow({ normalized_observed_value: "obs" })],
  createCandidates,
  cp,
  fixtureEdges,
)[0];
assert.notEqual(fixtureProposal.proposed_disposition, "canonical_create_candidate");

// Frozen inventory hash is a hard gate.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "psg2-hash-"));
const alteredInventory = path.join(temporary, "inventory.csv");
fs.writeFileSync(
  alteredInventory,
  `${fs.readFileSync(generationOptions.inventoryPath, "utf8")} `,
  "utf8",
);
assert.throws(
  () => generate({ ...generationOptions, inventoryPath: alteredInventory }),
  /Frozen PSG-1 inventory hash mismatch/,
);

// Deterministic rerun bytes.
const first = toCsv(result.proposals, PROPOSAL_COLUMNS);
const rerun = generate(generationOptions);
const second = toCsv(rerun.proposals, PROPOSAL_COLUMNS);
assert.equal(sha256(first), sha256(second));

// Frozen/committed evidence matches its manifest, proposal ledger, and every batch hash.
if (fs.existsSync(path.join(psg2, "source-hashes.json"))) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(psg2, "source-hashes.json"), "utf8"),
  );
  for (const [name, expected] of Object.entries(manifest)) {
    if (name === "inputs") continue;
    assert.equal(sha256(canonical(path.join(psg2, name))), expected.sha256, name);
  }
  assert.equal(
    sha256(first),
    EXPECTED_PROPOSALS_SHA256,
    "generated proposals differ from frozen proposals.csv",
  );
  assert.equal(manifest["proposals.csv"].sha256, EXPECTED_PROPOSALS_SHA256);
  assert.equal(
    manifest["owner-review-batches.csv"].sha256,
    EXPECTED_OWNER_INDEX_SHA256,
  );
  const ownerIndex = parseCsv(
    canonical(path.join(psg2, "owner-review-batches.csv")).toString("utf8"),
  );
  for (const row of ownerIndex) {
    if (row.batch_id === "batch-06-at-risk-observation") {
      assert.equal(row.sha256, EXPECTED_BATCH_SHA256[row.batch_id]);
      assert.equal(row.approvable, "false");
      assert.match(row.source_pointer, /currently-tagged-at-risk\.csv$/);
      continue;
    }
    assert.equal(
      sha256(canonical(path.join(psg2, row.source_pointer))),
      EXPECTED_BATCH_SHA256[row.batch_id],
      row.batch_id,
    );
    assert.equal(row.sha256, EXPECTED_BATCH_SHA256[row.batch_id]);
  }
}

const lf = path.join(temporary, "lf.csv");
const crlf = path.join(temporary, "crlf.csv");
fs.writeFileSync(lf, "a,b\n1,2\n", "utf8");
fs.writeFileSync(crlf, "a,b\r\n1,2\r\n", "utf8");
assert.equal(sha256(canonical(lf)), sha256(canonical(crlf)));

process.stdout.write("PSG-2 proposal tests passed\n");
