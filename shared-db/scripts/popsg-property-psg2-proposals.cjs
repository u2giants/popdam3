#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalize } = require("./lib/popsg-property-normalizer-v1.cjs");

const EXPECTED_INVENTORY_SHA256 =
  "97feb1fe91ae0632e27dd4574d955af0bd58c156e3f9c07d8bf99347f0719e8b";
const EXPECTED_AT_RISK_SHA256 =
  "f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6";
const EXPECTED_PROPOSALS_SHA256 =
  "cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4";
const EXPECTED_OWNER_INDEX_SHA256 =
  "78afa12f5edf4ac56f00d8fad592b6c6c2bcb128730ed5c837ad29270931976d";
const EXPECTED_BATCH_SHA256 = Object.freeze({
  "batch-01-exact-existing":
    "f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e",
  "batch-02-non-property":
    "6bde1c518bd2496d861283b9801a7cb05d15144e429eb3b9c51ed005e5ad2a52",
  "batch-03-create-candidates":
    "850c900e7ed76bd272db7bed7ccdcbefc4d0ea55177ddb8d884a5f01d011fcc1",
  "batch-04-open-review":
    "a75a5e1fd7a04f0fcc389c3fef1a81e56cab8eddda3abf7d69ae49bc383c0799",
  "batch-05-licensor-unresolved":
    "beecb4146c952024bf7ab425b3054d81028e30db084c0c7cdc18d6a29e7994d1",
  "batch-06-at-risk-observation": EXPECTED_AT_RISK_SHA256,
});
const DISNEY_LICENSOR_ID = "7d141a6f-e229-46a2-b3f5-0ba0c97dd820";
const CLASSICS = new Set(["bambi", "lion king", "aristocats", "jungle book", "101 dalmatians"]);
const NO_CODE = new Set(["luca", "kim possible", "inside out"]);

const compareText = (left, right) =>
  String(left).localeCompare(String(right), "en-US");
const PROPOSAL_COLUMNS = [
  "observation_key", "licensor_resolution", "resolved_licensor_id",
  "resolved_licensor_name", "normalized_observed_value", "active_file_count",
  "proposal_order", "proposed_disposition", "target_property_id",
  "target_property_code", "target_property_name",
  "target_property_parent_licensor_id", "rationale_code",
  "create_candidate_code", "create_candidate_name",
  "classification_automatic", "owner_activation_required",
  "coldlion_phase5_overlap", "coldlion_phase5_divisions",
  "proposed_parent_evidence", "current_accepted_relationship_count",
  "currently_tagged_at_risk", "cross_parent_proposal",
  "fuzzy_similarity_used_for_selection", "proposal_effective",
];

function canonicalBytes(filePath) {
  return Buffer.from(fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n"), "utf8");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function csvValue(value) {
  const stringValue = String(value ?? "");
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}

function toCsv(rows, columns) {
  return Buffer.from(
    `${columns.join(",")}\n${rows
      .map((row) => columns.map((column) => csvValue(row[column])).join(","))
      .join("\n")}\n`,
    "utf8",
  );
}

function parseJsonArray(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`Expected JSON array: ${value}`);
  return parsed;
}

function boolean(value) {
  return value === true || value === "true";
}

function loadCreateCandidateSet(dispositionsPath) {
  const rows = parseCsv(fs.readFileSync(dispositionsPath, "utf8"));
  const candidates = rows.filter(
    (row) =>
      row.entity_type === "property" &&
      row.disposition === "coldlion_only_new_candidate",
  );
  const deduped = new Map();
  for (const row of candidates) {
    const key = `${row.mg_code}|${normalize(row.source_name)}`;
    const existing = deduped.get(key) ?? {
      code: row.mg_code,
      name: row.source_name,
      normalized_name: normalize(row.source_name),
      divisions: [],
      phase5_decision_status: row.decision_status,
      phase5_action: row.phase4_action,
    };
    existing.divisions.push(row.division_code);
    deduped.set(key, existing);
  }
  return [...deduped.values()]
    .map((row) => ({
      ...row,
      divisions: [...new Set(row.divisions)].sort(compareText).join("|"),
    }))
    .sort((left, right) => compareText(left.code, right.code));
}

function buildParentEdgeMap(parentEdges) {
  const map = new Map();
  for (const edge of parentEdges) {
    if (!edge.property_id || !edge.licensor_id) {
      throw new Error("Authoritative parent edge is missing an identifier");
    }
    if (map.has(edge.property_id)) {
      throw new Error(`Duplicate authoritative parent edge: ${edge.property_id}`);
    }
    map.set(edge.property_id, {
      property_id: edge.property_id,
      property_code: edge.property_code,
      property_name: edge.property_name,
      licensor_id: edge.licensor_id,
      licensor_name: edge.licensor_name,
    });
  }
  return map;
}

function validateAndPopulateTarget(proposal, row, parentEdgeMap) {
  if (!proposal.target_property_id) return proposal;
  const edge = parentEdgeMap.get(proposal.target_property_id);
  if (!edge) {
    throw new Error(`Target lacks authoritative parent edge: ${proposal.target_property_id}`);
  }
  if (edge.licensor_id !== row.resolved_licensor_id) {
    throw new Error(
      `Cross-parent target rejected for ${row.observation_key}: ` +
      `${edge.licensor_id} != ${row.resolved_licensor_id}`,
    );
  }
  if (
    proposal.target_property_name &&
    proposal.target_property_name !== edge.property_name
  ) {
    throw new Error(`Target name differs from authoritative edge: ${row.observation_key}`);
  }
  proposal.target_property_name = edge.property_name;
  proposal.target_property_code = edge.property_code;
  proposal.target_property_parent_licensor_id = edge.licensor_id;
  proposal.cross_parent_proposal = edge.licensor_id !== row.resolved_licensor_id;
  return proposal;
}

function buildProposals(inventory, createCandidates, cpProperty, parentEdgeMap) {
  const proposals = [];
  const createByNormalized = new Map();
  for (const candidate of createCandidates) {
    const values = createByNormalized.get(candidate.normalized_name) ?? [];
    values.push(candidate);
    createByNormalized.set(candidate.normalized_name, values);
  }

  for (const row of inventory) {
    const observed = row.normalized_observed_value;
    const scopedIds = parseJsonArray(row.scoped_exact_property_ids);
    const scopedNames = parseJsonArray(row.scoped_exact_property_names);
    const reviewCandidateIds = parseJsonArray(row.candidate_property_ids);
    let proposal;

    if (row.licensor_resolution === "licensor_unresolved") {
      proposal = {
        proposal_order: 0,
        proposed_disposition: "licensor_unresolved",
        rationale_code: "parent_licensor_unresolved",
        approval_required: false,
      };
    } else if (scopedIds.length) {
      if (scopedIds.length !== 1 || scopedNames.length !== 1) {
        throw new Error(`Scoped exact match is not singular: ${row.observation_key}`);
      }
      const nameMatch = normalize(scopedNames[0]) === observed;
      const edge = parentEdgeMap.get(scopedIds[0]);
      if (!edge) {
        throw new Error(`Scoped target lacks authoritative edge: ${row.observation_key}`);
      }
      const codeMatch = normalize(edge.property_code) === observed;
      if (nameMatch === codeMatch) {
        throw new Error(
          `Exact match must be name XOR code for ${row.observation_key}: ` +
          `name=${nameMatch} code=${codeMatch}`,
        );
      }
      proposal = {
        proposal_order: nameMatch ? 1 : 2,
        proposed_disposition: "exact_existing",
        target_property_id: scopedIds[0],
        target_property_name: scopedNames[0],
        rationale_code: nameMatch
          ? "exact_normalized_canonical_name_under_resolved_licensor"
          : "exact_canonical_code_under_resolved_licensor",
        approval_required: false,
      };
    } else if (
      row.existing_alias_result &&
      row.existing_alias_result !== "none_property_aliases_frozen_empty"
    ) {
      throw new Error(`Unexpected approved alias input: ${row.observation_key}`);
    } else if (
      row.resolved_licensor_id === DISNEY_LICENSOR_ID &&
      CLASSICS.has(observed)
    ) {
      proposal = {
        proposal_order: 4,
        proposed_disposition: "classics_cp",
        target_property_id: cpProperty.id,
        target_property_name: cpProperty.name,
        target_property_code: cpProperty.code,
        rationale_code: "exact_owner_approved_disney_classics_title",
        approval_required: true,
      };
    } else if (!observed || boolean(row.structural_folder_hint)) {
      proposal = {
        proposal_order: 5,
        proposed_disposition: "non_property",
        rationale_code: !observed
          ? "blank_property_observation"
          : "psg1_structural_folder_pattern_candidate",
        approval_required: true,
      };
    } else if (
      row.resolved_licensor_id === DISNEY_LICENSOR_ID &&
      NO_CODE.has(observed)
    ) {
      proposal = {
        proposal_order: 6,
        proposed_disposition: "licensed_no_code",
        rationale_code: "exact_documented_owner_no_code_title",
        approval_required: true,
      };
    } else if ((createByNormalized.get(observed) ?? []).length === 1) {
      const candidate = createByNormalized.get(observed)[0];
      proposal = {
        proposal_order: 7,
        proposed_disposition: "canonical_create_candidate",
        create_candidate_code: candidate.code,
        create_candidate_name: candidate.name,
        rationale_code:
          "exact_coldlion_phase5_candidate_with_resolved_popsg_parent_observation",
        approval_required: true,
        coldlion_phase5_overlap: true,
        coldlion_phase5_divisions: candidate.divisions,
        proposed_parent_evidence:
          "resolved PopSG Licensor observation only; ColdLion supplies no parent; owner approval required",
      };
    } else if (
      boolean(row.ambiguity_flag) ||
      reviewCandidateIds.length > 1 ||
      (createByNormalized.get(observed) ?? []).length > 1
    ) {
      proposal = {
        proposal_order: 8,
        proposed_disposition: "ambiguous",
        rationale_code: boolean(row.ambiguity_flag)
          ? "psg1_canonical_ambiguity"
          : "multiple_same_parent_or_phase5_review_candidates",
        approval_required: true,
      };
    } else {
      proposal = {
        proposal_order: 8,
        proposed_disposition: "deferred",
        rationale_code: reviewCandidateIds.length === 1
          ? "single_similarity_hint_is_not_deterministic_evidence"
          : "insufficient_deterministic_evidence",
        approval_required: true,
      };
    }

    proposal = validateAndPopulateTarget(proposal, row, parentEdgeMap);
    proposals.push({
      observation_key: row.observation_key,
      licensor_resolution: row.licensor_resolution,
      resolved_licensor_id: row.resolved_licensor_id,
      resolved_licensor_name: row.resolved_licensor_name,
      normalized_observed_value: observed,
      active_file_count: Number(row.active_file_count),
      proposal_order: proposal.proposal_order,
      proposed_disposition: proposal.proposed_disposition,
      target_property_id: proposal.target_property_id ?? "",
      target_property_code: proposal.target_property_code ?? "",
      target_property_name: proposal.target_property_name ?? "",
      target_property_parent_licensor_id:
        proposal.target_property_parent_licensor_id ?? "",
      create_candidate_code: proposal.create_candidate_code ?? "",
      create_candidate_name: proposal.create_candidate_name ?? "",
      rationale_code: proposal.rationale_code,
      classification_automatic:
        proposal.proposed_disposition === "exact_existing" ||
        proposal.proposed_disposition === "licensor_unresolved",
      owner_activation_required: true,
      coldlion_phase5_overlap: proposal.coldlion_phase5_overlap ?? false,
      coldlion_phase5_divisions: proposal.coldlion_phase5_divisions ?? "",
      proposed_parent_evidence: proposal.proposed_parent_evidence ?? "",
      current_accepted_relationship_count: Number(row.current_accepted_relationship_count),
      currently_tagged_at_risk: boolean(row.currently_tagged_at_risk),
      cross_parent_proposal: proposal.cross_parent_proposal ?? false,
      fuzzy_similarity_used_for_selection: false,
      proposal_effective: false,
    });
  }
  return proposals.sort((left, right) =>
    compareText(left.observation_key, right.observation_key),
  );
}

function summarize(proposals, createCandidates, inputs) {
  const byDisposition = {};
  const filesByDisposition = {};
  const byRationale = {};
  for (const proposal of proposals) {
    byDisposition[proposal.proposed_disposition] =
      (byDisposition[proposal.proposed_disposition] ?? 0) + 1;
    filesByDisposition[proposal.proposed_disposition] =
      (filesByDisposition[proposal.proposed_disposition] ?? 0) +
      proposal.active_file_count;
    byRationale[proposal.rationale_code] =
      (byRationale[proposal.rationale_code] ?? 0) + 1;
  }
  return {
    phase: "PSG-2",
    generated_at: "2026-07-27",
    proposal_engine: "popsg-property-psg2-v1",
    input_inventory_sha256: inputs.inventorySha256,
    immutable_at_risk_sha256: inputs.atRiskSha256,
    inventory_rows: proposals.length,
    active_file_occurrences: proposals.reduce(
      (sum, proposal) => sum + proposal.active_file_count,
      0,
    ),
    disposition_rows: Object.fromEntries(
      [
        "licensor_unresolved", "exact_existing", "alias_existing", "classics_cp",
        "non_property", "licensed_no_code", "canonical_create_candidate",
        "ambiguous", "deferred",
      ].map((key) => [key, byDisposition[key] ?? 0]),
    ),
    disposition_file_occurrences: filesByDisposition,
    rationale_rows: byRationale,
    automatically_proposed_cross_parent_mappings: proposals.filter(
      (proposal) => proposal.cross_parent_proposal,
    ).length,
    unresolved_licensor_property_proposals: proposals.filter(
      (proposal) =>
        proposal.licensor_resolution === "licensor_unresolved" &&
        proposal.proposed_disposition !== "licensor_unresolved",
    ).length,
    fuzzy_selected_mappings: proposals.filter(
      (proposal) => proposal.fuzzy_similarity_used_for_selection,
    ).length,
    effective_or_activated_proposals: proposals.filter(
      (proposal) => proposal.proposal_effective,
    ).length,
    owner_activation_required_rows: proposals.filter(
      (proposal) => proposal.owner_activation_required,
    ).length,
    classification_automatic_rows: proposals.filter(
      (proposal) => proposal.classification_automatic,
    ).length,
    currently_tagged_at_risk_relationships: inputs.atRiskRows,
    coldlion_phase5_unique_create_candidates: createCandidates.length,
    coldlion_phase5_overlaps_in_proposals: proposals.filter(
      (proposal) => proposal.coldlion_phase5_overlap,
    ).length,
    safeguards: {
      database_writes: false,
      migrations: false,
      canonical_creates: false,
      rebuilds: false,
      deployments: false,
      popdam_ui_changes: false,
      proposal_activation: false,
    },
  };
}

function generate(options) {
  const inventoryBytes = canonicalBytes(options.inventoryPath);
  const atRiskBytes = canonicalBytes(options.atRiskPath);
  const inventorySha256 = sha256(inventoryBytes);
  const atRiskSha256 = sha256(atRiskBytes);
  if (inventorySha256 !== EXPECTED_INVENTORY_SHA256) {
    throw new Error(`Frozen PSG-1 inventory hash mismatch: ${inventorySha256}`);
  }
  if (atRiskSha256 !== EXPECTED_AT_RISK_SHA256) {
    throw new Error(`Immutable at-risk input hash mismatch: ${atRiskSha256}`);
  }
  const inventory = parseCsv(inventoryBytes.toString("utf8"));
  const atRiskRows = parseCsv(atRiskBytes.toString("utf8")).length;
  const createCandidates = loadCreateCandidateSet(options.dispositionsPath);
  const parentEdges = parseCsv(fs.readFileSync(options.parentEdgesPath, "utf8"));
  const parentEdgeMap = buildParentEdgeMap(parentEdges);
  const cpRows = parentEdges.filter(
    (row) =>
      row.property_code === "CP" &&
      row.property_name === "CLASSIC PROPERTIES" &&
      row.licensor_id === DISNEY_LICENSOR_ID,
  );
  if (cpRows.length !== 1) throw new Error(`Expected one Disney CP row, found ${cpRows.length}`);
  const cpProperty = {
    id: cpRows[0].property_id,
    code: cpRows[0].property_code,
    name: cpRows[0].property_name,
  };
  const proposals = buildProposals(
    inventory,
    createCandidates,
    cpProperty,
    parentEdgeMap,
  );
  const summary = summarize(proposals, createCandidates, {
    inventorySha256,
    atRiskSha256,
    atRiskRows,
  });
  return { proposals, summary, createCandidates, cpProperty };
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const outputDir = path.resolve(process.argv[2] ?? "");
  if (!process.argv[2]) {
    throw new Error("Usage: node scripts/popsg-property-psg2-proposals.cjs <output-directory>");
  }
  const psg1 = path.join(
    repoRoot,
    "docs",
    "verification",
    "popsg-property-reconciliation-20260727-psg1",
  );
  const phase3 = path.join(
    repoRoot,
    "docs",
    "verification",
    "coldlion-licensor-property-phase3-20260725",
  );
  const psg1Manifest = JSON.parse(
    fs.readFileSync(path.join(psg1, "source-hashes.json"), "utf8"),
  );
  for (const [name, expected] of Object.entries(psg1Manifest)) {
    if (name === "inputs") continue;
    const actual = sha256(canonicalBytes(path.join(psg1, name)));
    if (actual !== expected.sha256) {
      throw new Error(`PSG-1 artifact hash mismatch for ${name}: ${actual}`);
    }
  }
  const result = generate({
    inventoryPath: path.join(psg1, "inventory.csv"),
    atRiskPath: path.join(psg1, "currently-tagged-at-risk.csv"),
    dispositionsPath: path.join(phase3, "dispositions.csv"),
    parentEdgesPath: path.join(phase3, "parent-edges.csv"),
  });
  fs.mkdirSync(outputDir, { recursive: true });
  const createDiffRows = result.createCandidates.map((candidate) => {
    const overlaps = result.proposals.filter(
      (proposal) =>
        proposal.coldlion_phase5_overlap &&
        proposal.create_candidate_code === candidate.code,
    );
    return {
      coldlion_code: candidate.code,
      coldlion_name: candidate.name,
      coldlion_divisions: candidate.divisions,
      phase5_decision_status: candidate.phase5_decision_status,
      phase5_action: candidate.phase5_action,
      psg2_overlap_rows: overlaps.length,
      psg2_active_file_occurrences: overlaps.reduce(
        (sum, proposal) => sum + proposal.active_file_count,
        0,
      ),
      psg2_observation_keys: overlaps.map((proposal) => proposal.observation_key).join("|"),
      routing: overlaps.length
        ? "existing_coldlion_phase5_reentry_only"
        : "no_psg2_overlap",
    };
  });
  const proposalBuffer = toCsv(result.proposals, PROPOSAL_COLUMNS);
  const batchDefinitions = [
    {
      id: "batch-01-exact-existing",
      disposition: "exact_existing",
      rows: result.proposals.filter((row) => row.proposed_disposition === "exact_existing"),
      recommended_action: "approve_expected_deterministic_baseline",
      approvable: true,
    },
    {
      id: "batch-02-non-property",
      disposition: "non_property",
      rows: result.proposals.filter((row) => row.proposed_disposition === "non_property"),
      recommended_action: "business_review_required",
      approvable: true,
    },
    {
      id: "batch-03-create-candidates",
      disposition: "canonical_create_candidate",
      rows: result.proposals.filter(
        (row) => row.proposed_disposition === "canonical_create_candidate",
      ),
      recommended_action: "route_to_existing_coldlion_phase5_gate",
      approvable: false,
    },
    {
      id: "batch-04-open-review",
      disposition: "ambiguous_or_deferred",
      rows: result.proposals.filter((row) =>
        ["ambiguous", "deferred"].includes(row.proposed_disposition),
      ),
      recommended_action: "do_not_approve_as_mappings",
      approvable: false,
    },
    {
      id: "batch-05-licensor-unresolved",
      disposition: "licensor_unresolved",
      rows: result.proposals.filter(
        (row) => row.proposed_disposition === "licensor_unresolved",
      ),
      recommended_action: "exclude_from_property_work",
      approvable: false,
    },
    {
      id: "batch-06-at-risk-observation",
      disposition: "signed_at_risk_observation",
      rows: null,
      recommended_action: "non_approvable_risk_evidence_only",
      approvable: false,
      source_pointer:
        "../popsg-property-reconciliation-20260727-psg1/currently-tagged-at-risk.csv",
      external_sha256: EXPECTED_AT_RISK_SHA256,
      external_rows: 6961,
    },
  ];
  const batchFiles = batchDefinitions.map((batch) => {
    if (batch.rows === null) {
      return {
        ...batch,
        filename: "",
        buffer: null,
        sha256: batch.external_sha256,
        active_file_count: "",
        proposal_row_count: batch.external_rows,
      };
    }
    const buffer = toCsv(batch.rows, PROPOSAL_COLUMNS);
    return {
      ...batch,
      filename: `${batch.id}.csv`,
      buffer,
      sha256: sha256(buffer),
      active_file_count: batch.rows.reduce((sum, row) => sum + row.active_file_count, 0),
      proposal_row_count: batch.rows.length,
    };
  });
  const batchIndexRows = batchFiles.map((batch) => ({
    batch_id: batch.id,
    disposition_scope: batch.disposition,
    proposal_rows: batch.proposal_row_count,
    active_file_occurrences: batch.active_file_count,
    sha256: batch.sha256,
    recommended_action: batch.recommended_action,
    approvable: batch.approvable,
    source_pointer: batch.source_pointer ?? batch.filename,
    proposal_effective: false,
  }));
  const batchIndexBuffer = toCsv(batchIndexRows, [
    "batch_id", "disposition_scope", "proposal_rows", "active_file_occurrences",
    "sha256", "recommended_action", "approvable", "source_pointer",
    "proposal_effective",
  ]);
  if (sha256(proposalBuffer) !== EXPECTED_PROPOSALS_SHA256) {
    throw new Error(`Frozen proposal ledger drifted: ${sha256(proposalBuffer)}`);
  }
  for (const batch of batchFiles) {
    if (batch.sha256 !== EXPECTED_BATCH_SHA256[batch.id]) {
      throw new Error(`Frozen owner batch drifted: ${batch.id} ${batch.sha256}`);
    }
  }
  if (sha256(batchIndexBuffer) !== EXPECTED_OWNER_INDEX_SHA256) {
    throw new Error(`Frozen owner index drifted: ${sha256(batchIndexBuffer)}`);
  }
  result.summary.proposals_sha256 = sha256(proposalBuffer);
  result.summary.owner_review_batches_sha256 = sha256(batchIndexBuffer);
  const popdamRoot = path.resolve(repoRoot, "..", "popdam3");
  const workerPath = path.join(
    popdamRoot,
    "apps",
    "worker",
    "src",
    "handlers",
    "popsg-tags.ts",
  );
  const workerCanonicalBytes = canonicalBytes(workerPath);
  const workerCrlfBytes = Buffer.from(
    workerCanonicalBytes.toString("utf8").replace(/\n/g, "\r\n"),
    "utf8",
  );
  const frozenWorkerRawSha256 =
    psg1Manifest.inputs.source_files["popdam3/apps/worker/src/handlers/popsg-tags.ts"].sha256;
  result.summary.popdam_worker_authority = {
    psg1_manifest_raw_working_tree_sha256: frozenWorkerRawSha256,
    current_canonical_lf_sha256: sha256(workerCanonicalBytes),
    current_reconstructed_crlf_sha256: sha256(workerCrlfBytes),
    behavior_content_matches_psg1:
      sha256(workerCrlfBytes) === frozenWorkerRawSha256,
    psg5_rebaseline_required_if_behavior_hash_changes: true,
  };
  const summaryBuffer = Buffer.from(`${JSON.stringify(result.summary, null, 2)}\n`, "utf8");
  const authorityFiles = [
    ["shared-db/AGENTS.md", path.join(repoRoot, "AGENTS.md")],
    ["shared-db/HANDOFF.md", path.join(repoRoot, "HANDOFF.md")],
    [
      "shared-db/fix_popsg_property_taxonomy_reconciliation.md",
      path.join(repoRoot, "fix_popsg_property_taxonomy_reconciliation.md"),
    ],
    [
      "shared-db/fix_coldlion_licensor_property_cutover.md",
      path.join(repoRoot, "fix_coldlion_licensor_property_cutover.md"),
    ],
    [
      "shared-db/fix_coldlion_licensor_property_phase6_handoff.md",
      path.join(repoRoot, "fix_coldlion_licensor_property_phase6_handoff.md"),
    ],
    [
      "shared-db/docs/style-guides-characters-and-royalties.md",
      path.join(repoRoot, "docs", "style-guides-characters-and-royalties.md"),
    ],
    ["popdam3/AGENTS.md", path.join(popdamRoot, "AGENTS.md")],
    ["popdam3/docs/POPSG.md", path.join(popdamRoot, "docs", "POPSG.md")],
    [
      "popdam3/apps/worker/src/handlers/popsg-tags.ts",
      workerPath,
    ],
  ];
  const authorityManifest = Object.fromEntries(
    authorityFiles.map(([name, file]) => {
      const bytes = canonicalBytes(file);
      return [name, { sha256: sha256(bytes), bytes: bytes.length }];
    }),
  );
  const authorityBuffer = Buffer.from(
    `${JSON.stringify(authorityManifest, null, 2)}\n`,
    "utf8",
  );
  const dispositionRows = result.summary.disposition_rows;
  const dispositionFiles = result.summary.disposition_file_occurrences;
  const readmeBuffer = Buffer.from(`# PopSG Property reconciliation PSG-2 proposal evidence

**Phase:** PSG-2 deterministic proposals only
**Status:** DRAFT INCOMPLETE; second Grok review PASS; stopped at Albert's exact-hash gate
**Generated:** 2026-07-27
**Production:** \`qsllyeztdwjgirsysgai\` (read-only source evidence; no PSG-2 connection or write)
**Preview:** \`rjyboqwcdzcocqgmsyel\` (not changed)

## Result

- Every one of the 372 PSG-1 inventory rows has exactly one proposed disposition.
- The rows cover all 216,417 active file occurrences.
- The unresolved Licensor row has no Property proposal.
- No proposal crosses a canonical Licensor parent.
- No fuzzy score selected a target or disposition.
- Every row requires owner activation and no proposal is effective or activated.
- The immutable 6,961-row at-risk input still hashes to \`${result.summary.immutable_at_risk_sha256}\`.
- \`proposals.csv\` hashes to \`${result.summary.proposals_sha256}\`.
- \`owner-review-batches.csv\` hashes to \`${result.summary.owner_review_batches_sha256}\`.

## Proposed dispositions

| Proposed disposition | Distinct rows | Active files | Meaning now |
|---|---:|---:|---|
| \`exact_existing\` | ${dispositionRows.exact_existing} | ${dispositionFiles.exact_existing.toLocaleString("en-US")} | Deterministic same-parent baseline; owner activation still required |
| \`non_property\` | ${dispositionRows.non_property} | ${dispositionFiles.non_property.toLocaleString("en-US")} | Structural/blank candidates; human approval required |
| \`canonical_create_candidate\` | ${dispositionRows.canonical_create_candidate} | ${dispositionFiles.canonical_create_candidate.toLocaleString("en-US")} | Existing ColdLion Phase 5 overlaps; no create approved |
| \`ambiguous\` | ${dispositionRows.ambiguous} | ${dispositionFiles.ambiguous.toLocaleString("en-US")} | Open; no target selected |
| \`deferred\` | ${dispositionRows.deferred} | ${dispositionFiles.deferred.toLocaleString("en-US")} | Open; insufficient deterministic evidence |
| \`licensor_unresolved\` | ${dispositionRows.licensor_unresolved} | ${dispositionFiles.licensor_unresolved.toLocaleString("en-US")} | Excluded from Property work |
| \`alias_existing\` | ${dispositionRows.alias_existing} | 0 | No approved Property alias source exists |
| \`classics_cp\` | ${dispositionRows.classics_cp} | 0 | No inventory value exactly equals an approved Classics title |
| \`licensed_no_code\` | ${dispositionRows.licensed_no_code} | 0 | No inventory value exactly equals a documented no-code title |

The Disney observation \`the lion king\` affects 521 files but does not exactly equal the owner
list's \`lion king\` text. It also has multiple PSG-1 same-parent reviewer candidates, so it is
\`ambiguous\`, not merely an exact-Classics miss. The engine did not infer that the article is
harmless or select among candidates.

## Strict proposal order

1. Fifty canonical-name matches became \`exact_existing\`.
2. One canonical-code match became \`exact_existing\`.
3. No approved Property alias exists.
4. No exact owner-list Disney Classics observation exists.
5. Fifteen blank observations and 21 PSG-1 structural-pattern rows became \`non_property\` candidates.
6. No exact documented no-code observation exists.
7. \`CHEERS\` / \`CHR\` and \`THE EXORCIST\` / \`EX\` exactly overlap the existing ColdLion
   Phase 5 candidate ledger. They are routed back to that gate. Their resolved PopSG Licensor is
   evidence only; ColdLion supplies no parent, and no canonical create is approved.
8. All other rows are \`ambiguous\` or \`deferred\`.

## Immutable owner-review batches

The exact batch hashes are in \`owner-review-batches.csv\`. Every proposal requires owner
activation even when its classification is automatic. The recommended first bounded decision
is \`batch-01-exact-existing.csv\`: 51 same-parent deterministic rows covering 44,331 files. Approval
must name that batch ID and exact SHA-256. It does not approve the 36 non-Property candidates, the
two create candidates, any of the 6,961 at-risk removals, a migration, a rebuild, or production.

\`batch-02-non-property.csv\` needs a separate business review. \`batch-03-create-candidates.csv\`
must use the existing ColdLion Phase 5 re-entry gate. \`batch-04-open-review.csv\` is not a mapping
batch. \`batch-05-licensor-unresolved.csv\` remains excluded from Property work.
\`batch-06-at-risk-observation\` is a non-approvable pointer to the immutable 6,961-row PSG-1
risk file and its signed hash. It is evidence only, never a removal approval.

## Files

- \`proposals.csv\`: complete one-row-per-observation proposal ledger.
- \`owner-review-batches.csv\`: exact immutable hashes and recommended action for each bounded set.
- \`batch-*.csv\`: the frozen row sets referenced by the batch index.
- \`coldlion-phase5-create-candidate-diff.csv\`: all six unique Phase 5 candidates and the two PSG-2 overlaps.
- \`summary.json\`: reconciliation totals and zero-write safeguards.
- \`authority-source-hashes.json\`: current hashes for all nine PSG authority files.
- \`source-hashes.json\`: output and input hashes.
- \`scripts/popsg-property-psg2-proposals.cjs\`: deterministic generator.
- \`scripts/popsg-property-psg2-proposals.test.cjs\`: ordering, hash, scope, and safety tests.

## Current Git, migration, and ColdLion checkpoint

- Shared-db started clean on \`main\` at \`f530c424b00ddd91eef4c0f8d172eeb451551f82\`.
- PopDAM was clean and fast-forwarded to \`main\` at \`c8ce9624\`; only its shared-db mirror changed.
- One unrelated docs-only shared-db PR was open: #238.
- No duplicate 14-digit migration version exists.
- ColdLion Phase 6 remains **IN PROGRESS** on preview.
- Accelerated readiness Steps 1 through 10 remain open; Phase 7 is forbidden.
- PSG-2 added no migration and made no database query or write.
- The PSG-1 worker authority hash used raw CRLF checkout bytes
  (\`${frozenWorkerRawSha256}\`). The current canonical LF hash is
  \`${result.summary.popdam_worker_authority.current_canonical_lf_sha256}\`; reconstructing CRLF
  reproduces the PSG-1 hash exactly, so this is line-ending encoding, not behavior drift. PSG-5
  must rebaseline if the worker behavior hash changes.

## Failures and corrections

- Windows checkout files use CRLF, so direct working-tree hashes differed from the signed LF
  manifest. All eight exact Git blobs matched PSG-1 \`source-hashes.json\`; the engine canonicalizes
  CRLF to LF before verifying immutable inputs.
- The first summary tried to infer the 6,961 at-risk relationship count from an inventory aggregate
  and got 7,182 because that field includes accepted relationships beyond the signed removal set.
  The final engine counts the immutable at-risk CSV rows directly.
- A first unit-test draft rebuilt from the wrong in-memory shape. It was corrected to rerun the
  generator from the signed inputs and compare deterministic output bytes.
- First Grok review rejected the draft because parent safety was asserted rather than computed,
  Phase-5 candidates accepted bare codes, the copied normalizer changed ampersand behavior,
  activation authority was unclear, and strict-order/frozen-hash fixtures were incomplete. The
  corrected draft now fails closed on authoritative parent/name/code proof, matches Phase-5 names
  only, reuses the PSG-1 normalizer and fixtures exactly, requires owner activation for every row,
  hard-locks all proposal/batch hashes, and tests every cited boundary.
- Second Grok review passed with no Critical, High, or Medium findings. Residual non-blocking
  notes are the intentional gates: every row still needs owner activation, PSG-2 remains
  incomplete until Albert names an exact batch hash, and PSG-3 remains forbidden.

## PSG-3 through PSG-7 forward-impact audit

- PSG-3 must show the five immutable queues separately and must not treat \`batch-04\` as mappings.
- PSG-3 must route the two create candidates to ColdLion Phase 5 rather than create a second ledger.
- PSG-3 must expose \`the lion king\` as open because no exact Classics decision exists for it.
- PSG-4 must approve exact batch hashes. No current PSG-2 row authorizes any at-risk removal.
- PSG-5 cannot assert an approved 6,961-row removal delta until Albert approves the exact expected subset.
- PSG-5 still must resolve all eight hard-coded Licensor aliases; PSG-2 did not approve them.
- PSG-6 remains blocked by the moving ColdLion checkpoint, owner sign-off, and a production window.
- PSG-7 metrics must preserve zero-valued alias/Classics/no-code proposal categories honestly.
- No phase ordering, schema assumption, rollback rule, or production safety boundary otherwise drifted.

## Gate

The second Grok review passed. PSG-2 remains draft and incomplete at Albert's exact-hash gate.
Albert must approve or reject the proposed vocabulary/bounded batch by exact hash. Do not start
PSG-3, create schema, activate decisions, or infer approval from this evidence package.
`, "utf8");

  const files = new Map([
    ["proposals.csv", proposalBuffer],
    [
      "coldlion-phase5-create-candidate-diff.csv",
      toCsv(createDiffRows, [
        "coldlion_code", "coldlion_name", "coldlion_divisions",
        "phase5_decision_status", "phase5_action", "psg2_overlap_rows",
        "psg2_active_file_occurrences", "psg2_observation_keys", "routing",
      ]),
    ],
    ["owner-review-batches.csv", batchIndexBuffer],
    ...batchFiles
      .filter((batch) => batch.buffer)
      .map((batch) => [batch.filename, batch.buffer]),
    ["summary.json", summaryBuffer],
    ["authority-source-hashes.json", authorityBuffer],
    ["README.md", readmeBuffer],
  ]);
  const manifest = {};
  for (const [name, buffer] of files) {
    fs.writeFileSync(path.join(outputDir, name), buffer);
    manifest[name] = { sha256: sha256(buffer), bytes: buffer.length };
  }
  const sourceManifest = {
    ...manifest,
    inputs: {
      "psg1/inventory.csv": {
        sha256: result.summary.input_inventory_sha256,
        bytes: canonicalBytes(path.join(psg1, "inventory.csv")).length,
      },
      "psg1/currently-tagged-at-risk.csv": {
        sha256: result.summary.immutable_at_risk_sha256,
        bytes: canonicalBytes(path.join(psg1, "currently-tagged-at-risk.csv")).length,
      },
      "coldlion-phase3/dispositions.csv": {
        sha256: sha256(canonicalBytes(path.join(phase3, "dispositions.csv"))),
        bytes: canonicalBytes(path.join(phase3, "dispositions.csv")).length,
      },
      "coldlion-phase3/parent-edges.csv": {
        sha256: sha256(canonicalBytes(path.join(phase3, "parent-edges.csv"))),
        bytes: canonicalBytes(path.join(phase3, "parent-edges.csv")).length,
      },
      "shared-db/scripts/popsg-property-psg2-proposals.cjs": {
        sha256: sha256(canonicalBytes(__filename)),
        bytes: canonicalBytes(__filename).length,
      },
      "shared-db/scripts/popsg-property-psg2-proposals.test.cjs": {
        sha256: sha256(
          canonicalBytes(path.join(repoRoot, "scripts", "popsg-property-psg2-proposals.test.cjs")),
        ),
        bytes: canonicalBytes(
          path.join(repoRoot, "scripts", "popsg-property-psg2-proposals.test.cjs"),
        ).length,
      },
      "shared-db/scripts/lib/popsg-property-normalizer-v1.cjs": {
        sha256: sha256(
          canonicalBytes(
            path.join(repoRoot, "scripts", "lib", "popsg-property-normalizer-v1.cjs"),
          ),
        ),
        bytes: canonicalBytes(
          path.join(repoRoot, "scripts", "lib", "popsg-property-normalizer-v1.cjs"),
        ).length,
      },
      "shared-db/docs/verification/popsg-property-reconciliation-20260726/normalization-fixtures-v1.json": {
        sha256: sha256(
          canonicalBytes(
            path.join(
              repoRoot,
              "docs",
              "verification",
              "popsg-property-reconciliation-20260726",
              "normalization-fixtures-v1.json",
            ),
          ),
        ),
        bytes: canonicalBytes(
          path.join(
            repoRoot,
            "docs",
            "verification",
            "popsg-property-reconciliation-20260726",
            "normalization-fixtures-v1.json",
          ),
        ).length,
      },
    },
  };
  fs.writeFileSync(
    path.join(outputDir, "source-hashes.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
}

module.exports = {
  EXPECTED_INVENTORY_SHA256,
  EXPECTED_AT_RISK_SHA256,
  EXPECTED_BATCH_SHA256,
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
};

if (require.main === module) main();
