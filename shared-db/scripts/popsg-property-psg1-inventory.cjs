#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LICENSOR_ALIASES = [
  ["NBC Universal", "NBC"],
  ["Marvel Style Guide", "Marvel"],
  ["One Piece", "TOEI - ONE PIECE"],
  ["Peanuts", "Peanuts Worldwide"],
  ["Sesame Workshop", "Sesame Street"],
  ["Paramount", "Viacom Multi"],
  ["Nickelodeon", "Viacom Multi"],
  ["Viacom", "Viacom Multi"],
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[_/\\–—-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function csvCell(value) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n") + "\n";
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileMetadata(file) {
  const buffer = fs.readFileSync(file);
  return { sha256: sha256(buffer), bytes: buffer.length };
}

function addLookup(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function unique(rows, key = (row) => row.id) {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

function sharedTokenScore(observed, candidate) {
  const a = new Set(normalize(observed).split(" ").filter((token) => token.length > 2));
  const b = new Set(normalize(candidate).split(" ").filter((token) => token.length > 2));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function structuralHint(value) {
  const normalized = normalize(value);
  const words = [
    "style guide", "styleguide", "collection", "collections", "archive", "archives",
    "in development", "new structure", "approved", "final", "finals", "assets",
    "artwork", "working", "wip", "misc", "folder", "program",
  ];
  return words.some((word) => normalized.includes(word));
}

function redactedExample(relativePath, filename, extension) {
  const depth = String(relativePath ?? "").split("/").filter(Boolean).length;
  const fileHash = sha256(Buffer.from(String(filename ?? ""), "utf8")).slice(0, 12);
  const pathHash = sha256(Buffer.from(String(relativePath ?? ""), "utf8")).slice(0, 12);
  const ext = String(extension ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return {
    path: `[redacted:${pathHash}]/depth-${depth}/[file].${ext || "unknown"}`,
    filename: `[redacted:${fileHash}].${ext || "unknown"}`,
  };
}

async function withReadOnly(client, work) {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await work(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

function buildClient(Client, config) {
  return new Client({ ...config, ssl: { rejectUnauthorized: false } });
}

async function fetchProduction(client) {
  const [files, licensors, properties, accepted, designflow, sourceRefs, migrationLedger] =
    await Promise.all([
      client.query(`
        select id, licensor_name, property_folder, relative_path, filename, file_extension
        from public.style_guide_files
        where is_active
        order by id
      `),
      client.query("select id, name, code, status::text as status from core.licensor order by id"),
      client.query(`
        select p.id, p.licensor_id, p.name, p.code, p.status::text as status,
               l.name as licensor_name, l.code as licensor_code
        from core.property p join core.licensor l on l.id = p.licensor_id
        order by p.id
      `),
      client.query(`
        select ft.id as relationship_id, ft.style_guide_file_id as file_id,
               ft.tag_id, t.tag, t.normalized_tag, t.display_name,
               ft.source, ft.status, ft.rule_version
        from public.style_guide_file_tags ft
        join public.style_guide_tags t on t.id = ft.tag_id
        where ft.facet = 'property' and ft.status = 'accepted'
        order by ft.id
      `),
      client.query(`
        select plm_property_id, property_id, plm_parent_licensor_id, licensor_id,
               title, mg_code, division_code, mg_category
        from plm.property_import
        order by plm_property_id
      `),
      client.query(`
        select entity_id, source_system, source_table, source_id, source_code, source_name
        from core.taxonomy_source_ref
        where entity_schema = 'core' and entity_table in ('licensor', 'property')
        order by entity_table, entity_id, source_system, source_table, source_id
      `),
      client.query("select version from supabase_migrations.schema_migrations order by version"),
    ]);
  return {
    files: files.rows,
    licensors: licensors.rows,
    properties: properties.rows,
    accepted: accepted.rows,
    designflow: designflow.rows,
    sourceRefs: sourceRefs.rows,
    migrationVersions: migrationLedger.rows.map((row) => String(row.version)),
  };
}

async function fetchPreview(client) {
  const [coldlionLicensors, coldlionProperties, observations, alerts, latestSync] =
    await Promise.all([
      client.query(`
        select company_code, division_code, mg_type_code, mg_code, name,
               licensor_id, resolution_status
        from plm.erp_licensor order by company_code, division_code, mg_type_code, mg_code
      `),
      client.query(`
        select company_code, division_code, mg_type_code, mg_code, name,
               property_id, resolution_status
        from plm.erp_property order by company_code, division_code, mg_type_code, mg_code
      `),
      client.query(`
        select id, observed_at, is_drill, pass, unexplained_diff_count,
               licensor_count, property_count, linked_licensor_count, linked_property_count,
               baseline_ok, coldlion_ok, designflow_ok, immutability_ok, links_ok
        from plm.taxonomy_parallel_observation order by observed_at desc
      `),
      client.query(`
        select id, observation_id, fired_at, is_drill, severity, reason
        from plm.taxonomy_sync_alert order by fired_at desc
      `),
      client.query(`
        select id, started_at, finished_at, status, metadata ->> 'mode' as mode
        from ingest.sync_run
        where source_system = 'coldlion'
        order by started_at desc limit 20
      `),
    ]);
  return {
    coldlionLicensors: coldlionLicensors.rows,
    coldlionProperties: coldlionProperties.rows,
    observations: observations.rows,
    alerts: alerts.rows,
    latestSync: latestSync.rows,
  };
}

function buildEvidence(production, preview, measuredAt) {
  const licensorByNormalized = new Map();
  const licensorById = new Map(production.licensors.map((row) => [row.id, row]));
  for (const row of production.licensors) {
    addLookup(licensorByNormalized, normalize(row.name), row);
    addLookup(licensorByNormalized, normalize(row.code), row);
  }
  const aliasByNormalized = new Map();
  for (const [alias, canonical] of LICENSOR_ALIASES) {
    const target = (licensorByNormalized.get(normalize(canonical)) ?? [])[0];
    if (target) aliasByNormalized.set(normalize(alias), { alias, target });
  }

  const propertyByGlobalName = new Map();
  const propertyByScopedNameCode = new Map();
  const propertiesByLicensor = new Map();
  for (const row of production.properties) {
    addLookup(propertyByGlobalName, normalize(row.name), row);
    addLookup(propertyByScopedNameCode, `${row.licensor_id}|${normalize(row.name)}`, row);
    addLookup(propertyByScopedNameCode, `${row.licensor_id}|${normalize(row.code)}`, row);
    addLookup(propertiesByLicensor, row.licensor_id, row);
  }

  const acceptedByFile = new Map();
  for (const row of production.accepted) addLookup(acceptedByFile, row.file_id, row);

  const dfByLicensor = new Map();
  for (const row of production.designflow) {
    if (row.licensor_id) addLookup(dfByLicensor, row.licensor_id, row);
  }
  const coldlionByLicensor = new Map();
  for (const row of preview.coldlionProperties) {
    const canonical = production.properties.find((property) => property.id === row.property_id);
    if (canonical?.licensor_id) addLookup(coldlionByLicensor, canonical.licensor_id, row);
  }

  const matrix = {
    licensor_resolved__property_resolved: 0,
    licensor_resolved__property_unresolved: 0,
    licensor_unresolved__property_resolved: 0,
    licensor_unresolved__property_unresolved: 0,
  };
  const groups = new Map();
  const atRisk = [];
  const aliasBlast = new Map(LICENSOR_ALIASES.map(([alias, canonical]) => [
    alias,
    {
      alias,
      canonical_licensor: canonical,
      active_file_count: 0,
      property_present_file_count: 0,
      distinct_normalized_property_count: 0,
      accepted_property_relationship_count: 0,
      currently_tagged_at_risk_relationship_count: 0,
      property_values: new Set(),
    },
  ]));

  for (const file of production.files) {
    const normalizedLicensor = normalize(file.licensor_name);
    const normalizedProperty = normalize(file.property_folder);
    const directLicensors = licensorByNormalized.get(normalizedLicensor) ?? [];
    const alias = aliasByNormalized.get(normalizedLicensor);
    const resolvedLicensors = directLicensors.length === 1 ? directLicensors : alias ? [alias.target] : [];
    const licensor = resolvedLicensors.length === 1 ? resolvedLicensors[0] : null;
    const globalProperties = propertyByGlobalName.get(normalizedProperty) ?? [];
    const globalProperty = globalProperties.length === 1 ? globalProperties[0] : null;
    const globalResolved = Boolean(globalProperty);
    matrix[
      `${licensor ? "licensor_resolved" : "licensor_unresolved"}__${globalResolved ? "property_resolved" : "property_unresolved"}`
    ] += 1;

    const groupKey = licensor
      ? `${licensor.id}|${normalizedProperty || "[blank]"}`
      : `licensor_unresolved|${normalizedLicensor || "[blank]"}|${normalizedProperty || "[blank]"}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        observation_key: groupKey,
        licensor_resolution: licensor ? "resolved" : "licensor_unresolved",
        resolved_licensor_id: licensor?.id ?? "",
        resolved_licensor_name: licensor?.name ?? "",
        raw_licensor_variants: new Map(),
        normalized_licensor: normalizedLicensor,
        normalized_observed_value: normalizedProperty,
        raw_property_variants: new Map(),
        active_file_count: 0,
        representative_examples: [],
        current_global_property_ids: new Set(),
        current_global_property_names: new Set(),
        scoped_exact_property_ids: new Set(),
        scoped_exact_property_names: new Set(),
        current_accepted_relationship_count: 0,
        current_accepted_file_count: 0,
        current_global_would_resolve: false,
        scoped_would_resolve: false,
        currently_tagged_at_risk: false,
        licensor_alias: alias?.alias ?? "",
        structural_folder_hint: false,
        cross_parent_flag: false,
        ambiguity_flag: directLicensors.length > 1 || globalProperties.length > 1,
      });
    }
    const group = groups.get(groupKey);
    group.active_file_count += 1;
    group.raw_licensor_variants.set(
      file.licensor_name ?? "",
      (group.raw_licensor_variants.get(file.licensor_name ?? "") ?? 0) + 1,
    );
    group.raw_property_variants.set(
      file.property_folder ?? "",
      (group.raw_property_variants.get(file.property_folder ?? "") ?? 0) + 1,
    );
    if (group.representative_examples.length < 3) {
      group.representative_examples.push(redactedExample(file.relative_path, file.filename, file.file_extension));
    }
    group.structural_folder_hint ||= structuralHint(file.property_folder);
    if (globalProperty) {
      group.current_global_property_ids.add(globalProperty.id);
      group.current_global_property_names.add(globalProperty.name);
      group.current_global_would_resolve = true;
    }
    const scoped = licensor
      ? unique(propertyByScopedNameCode.get(`${licensor.id}|${normalizedProperty}`) ?? [])
      : [];
    if (scoped.length === 1) {
      group.scoped_exact_property_ids.add(scoped[0].id);
      group.scoped_exact_property_names.add(scoped[0].name);
      group.scoped_would_resolve = true;
    }
    if (globalProperty && licensor && globalProperty.licensor_id !== licensor.id) group.cross_parent_flag = true;

    const accepted = acceptedByFile.get(file.id) ?? [];
    if (accepted.length) {
      group.current_accepted_relationship_count += accepted.length;
      group.current_accepted_file_count += 1;
    }
    for (const relationship of accepted) {
      const relationshipNormalized = normalize(relationship.tag || relationship.normalized_tag || relationship.display_name);
      const isCurrentGlobal = globalProperty && relationshipNormalized === normalize(globalProperty.name);
      const threatened = isCurrentGlobal && (!licensor || globalProperty.licensor_id !== licensor.id);
      if (!threatened) continue;
      group.currently_tagged_at_risk = true;
      const row = {
        relationship_id: relationship.relationship_id,
        file_id: file.id,
        normalized_licensor: normalizedLicensor,
        resolved_licensor_id: licensor?.id ?? "",
        resolved_licensor_name: licensor?.name ?? "",
        licensor_resolution: licensor ? "resolved" : "licensor_unresolved",
        licensor_alias: alias?.alias ?? "",
        normalized_observed_property: normalizedProperty,
        raw_property_value: file.property_folder ?? "",
        current_property_id: globalProperty.id,
        current_property_name: globalProperty.name,
        current_property_licensor_id: globalProperty.licensor_id,
        current_property_licensor_name: globalProperty.licensor_name,
        removal_reason: licensor ? "cross_parent_global_match" : "licensor_unresolved",
        source: relationship.source,
        status: relationship.status,
        rule_version: relationship.rule_version,
      };
      atRisk.push(row);
      if (alias) aliasBlast.get(alias.alias).currently_tagged_at_risk_relationship_count += 1;
    }

    if (alias) {
      const blast = aliasBlast.get(alias.alias);
      blast.active_file_count += 1;
      if (normalizedProperty) {
        blast.property_present_file_count += 1;
        blast.property_values.add(normalizedProperty);
      }
      blast.accepted_property_relationship_count += accepted.length;
    }
  }

  const inventory = [];
  const candidates = [];
  for (const group of groups.values()) {
    const sameParent = group.resolved_licensor_id
      ? propertiesByLicensor.get(group.resolved_licensor_id) ?? []
      : [];
    const rawValue = [...group.raw_property_variants.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
    const evidenceCandidates = group.resolved_licensor_id
      ? sameParent
        .map((property) => ({
          property,
          match_type:
            normalize(property.name) === group.normalized_observed_value ? "exact_name"
              : normalize(property.code) === group.normalized_observed_value ? "exact_code"
                : "shared_token_review_evidence",
          score: sharedTokenScore(rawValue, property.name),
        }))
        .filter((candidate) => candidate.match_type !== "shared_token_review_evidence" || candidate.score > 0)
        .sort((a, b) => {
          const rank = { exact_name: 0, exact_code: 1, shared_token_review_evidence: 2 };
          return rank[a.match_type] - rank[b.match_type] || b.score - a.score || a.property.name.localeCompare(b.property.name);
        })
        .slice(0, 10)
      : [];

    const dfEvidence = group.resolved_licensor_id
      ? (dfByLicensor.get(group.resolved_licensor_id) ?? []).filter((row) =>
          normalize(row.title) === group.normalized_observed_value
          || normalize(row.mg_code) === group.normalized_observed_value)
      : [];
    const coldlionEvidence = group.resolved_licensor_id
      ? (coldlionByLicensor.get(group.resolved_licensor_id) ?? []).filter((row) =>
          normalize(row.name) === group.normalized_observed_value
          || normalize(row.mg_code) === group.normalized_observed_value)
      : [];

    const base = {
      observation_key: group.observation_key,
      licensor_resolution: group.licensor_resolution,
      resolved_licensor_id: group.resolved_licensor_id,
      resolved_licensor_name: group.resolved_licensor_name,
      normalized_licensor: group.normalized_licensor,
      normalized_observed_value: group.normalized_observed_value,
      raw_licensor_variants: [...group.raw_licensor_variants.entries()].sort((a, b) => b[1] - a[1]),
      raw_property_variants: [...group.raw_property_variants.entries()].sort((a, b) => b[1] - a[1]),
      active_file_count: group.active_file_count,
      representative_examples: group.representative_examples,
      current_global_property_ids: [...group.current_global_property_ids].sort(),
      current_global_property_names: [...group.current_global_property_names].sort(),
      scoped_exact_property_ids: [...group.scoped_exact_property_ids].sort(),
      scoped_exact_property_names: [...group.scoped_exact_property_names].sort(),
      existing_alias_result: "none_property_aliases_frozen_empty",
      candidate_property_ids: evidenceCandidates.map((candidate) => candidate.property.id),
      coldlion_exact_evidence_count: coldlionEvidence.length,
      designflow_exact_evidence_count: dfEvidence.length,
      structural_folder_hint: group.structural_folder_hint,
      current_accepted_relationship_count: group.current_accepted_relationship_count,
      current_accepted_file_count: group.current_accepted_file_count,
      current_global_would_resolve: group.current_global_would_resolve,
      scoped_would_resolve: group.scoped_would_resolve,
      currently_tagged_at_risk: group.currently_tagged_at_risk,
      licensor_alias: group.licensor_alias,
      cross_parent_flag: group.cross_parent_flag,
      ambiguity_flag: group.ambiguity_flag,
      proposal_eligible: group.licensor_resolution === "resolved",
      proposal_exclusion_reason: group.licensor_resolution === "resolved" ? "" : "licensor_unresolved",
    };
    inventory.push(base);
    for (const candidate of evidenceCandidates) {
      candidates.push({
        observation_key: group.observation_key,
        resolved_licensor_id: group.resolved_licensor_id,
        resolved_licensor_name: group.resolved_licensor_name,
        normalized_observed_value: group.normalized_observed_value,
        candidate_property_id: candidate.property.id,
        candidate_property_name: candidate.property.name,
        candidate_property_code: candidate.property.code,
        candidate_property_status: candidate.property.status,
        match_type: candidate.match_type,
        shared_token_score: candidate.score.toFixed(6),
        automatic_mapping_allowed: false,
        coldlion_exact_evidence: coldlionEvidence.some((row) => row.property_id === candidate.property.id),
        designflow_exact_evidence: dfEvidence.some((row) => row.property_id === candidate.property.id),
      });
    }
  }
  inventory.sort((a, b) =>
    a.licensor_resolution.localeCompare(b.licensor_resolution)
    || a.resolved_licensor_name.localeCompare(b.resolved_licensor_name)
    || a.normalized_observed_value.localeCompare(b.normalized_observed_value)
    || a.normalized_licensor.localeCompare(b.normalized_licensor));
  candidates.sort((a, b) => a.observation_key.localeCompare(b.observation_key) || a.match_type.localeCompare(b.match_type));
  atRisk.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));

  const unresolved = inventory
    .filter((row) => !row.scoped_would_resolve)
    .sort((a, b) => b.active_file_count - a.active_file_count || a.observation_key.localeCompare(b.observation_key));
  const aliasRows = [...aliasBlast.values()].map((row) => ({
    ...row,
    distinct_normalized_property_count: row.property_values.size,
    property_values: [...row.property_values].sort(),
  }));

  const matrixTotal = Object.values(matrix).reduce((sum, count) => sum + count, 0);
  const summary = {
    phase: "PSG-1",
    measured_at: measuredAt,
    database_mode: "repeatable_read_read_only_rollback",
    active_file_occurrences: production.files.length,
    matrix_total: matrixTotal,
    inventory_rows: inventory.length,
    resolved_licensor_inventory_rows: inventory.filter((row) => row.licensor_resolution === "resolved").length,
    licensor_unresolved_inventory_rows: inventory.filter((row) => row.licensor_resolution === "licensor_unresolved").length,
    property_scoped_exact_inventory_rows: inventory.filter((row) => row.scoped_would_resolve).length,
    property_scoped_exact_file_occurrences: inventory.filter((row) => row.scoped_would_resolve)
      .reduce((sum, row) => sum + row.active_file_count, 0),
    currently_tagged_at_risk_relationships: atRisk.length,
    unresolved_licensor_property_proposals: 0,
    candidate_evidence_rows: candidates.length,
    production_canonical_licensors: production.licensors.length,
    production_canonical_properties: production.properties.length,
    production_migration_ledger_versions: production.migrationVersions.length,
    preview_coldlion_licensors: preview.coldlionLicensors.length,
    preview_coldlion_properties: preview.coldlionProperties.length,
    latest_preview_parallel_observation: preview.observations[0] ?? null,
    latest_preview_non_drill_observation: preview.observations.find((row) => !row.is_drill) ?? null,
    latest_preview_alert: preview.alerts[0] ?? null,
    latest_preview_coldlion_sync: preview.latestSync[0] ?? null,
    safeguards: {
      fuzzy_automatic_mapping: false,
      database_writes: false,
      unresolved_licensor_candidates: false,
      full_paths_or_filenames_exported: false,
    },
  };
  return { inventory, candidates, atRisk, unresolved, aliasRows, matrix, summary };
}

function writeArtifacts(outputDir, evidence, inputs) {
  fs.mkdirSync(outputDir, { recursive: true });
  const inventoryColumns = [
    "observation_key", "licensor_resolution", "resolved_licensor_id", "resolved_licensor_name",
    "normalized_licensor", "normalized_observed_value", "raw_licensor_variants",
    "raw_property_variants", "active_file_count", "representative_examples",
    "current_global_property_ids", "current_global_property_names", "scoped_exact_property_ids",
    "scoped_exact_property_names", "existing_alias_result", "candidate_property_ids",
    "coldlion_exact_evidence_count", "designflow_exact_evidence_count", "structural_folder_hint",
    "current_accepted_relationship_count", "current_accepted_file_count",
    "current_global_would_resolve", "scoped_would_resolve", "currently_tagged_at_risk",
    "licensor_alias", "cross_parent_flag", "ambiguity_flag", "proposal_eligible",
    "proposal_exclusion_reason",
  ];
  const candidateColumns = [
    "observation_key", "resolved_licensor_id", "resolved_licensor_name",
    "normalized_observed_value", "candidate_property_id", "candidate_property_name",
    "candidate_property_code", "candidate_property_status", "match_type",
    "shared_token_score", "automatic_mapping_allowed", "coldlion_exact_evidence",
    "designflow_exact_evidence",
  ];
  const riskColumns = [
    "relationship_id", "file_id", "normalized_licensor", "resolved_licensor_id",
    "resolved_licensor_name", "licensor_resolution", "licensor_alias",
    "normalized_observed_property", "raw_property_value", "current_property_id",
    "current_property_name", "current_property_licensor_id", "current_property_licensor_name",
    "removal_reason", "source", "status", "rule_version",
  ];
  const aliasColumns = [
    "alias", "canonical_licensor", "active_file_count", "property_present_file_count",
    "distinct_normalized_property_count", "accepted_property_relationship_count",
    "currently_tagged_at_risk_relationship_count", "property_values",
  ];
  const topColumns = [
    "observation_key", "licensor_resolution", "resolved_licensor_id", "resolved_licensor_name",
    "normalized_licensor", "normalized_observed_value", "active_file_count",
    "raw_property_variants", "structural_folder_hint", "current_global_would_resolve",
    "currently_tagged_at_risk", "proposal_eligible", "proposal_exclusion_reason",
  ];
  const files = new Map([
    ["inventory.csv", Buffer.from(toCsv(evidence.inventory, inventoryColumns), "utf8")],
    ["summary.json", Buffer.from(JSON.stringify(evidence.summary, null, 2) + "\n", "utf8")],
    ["top-unresolved.csv", Buffer.from(toCsv(evidence.unresolved.slice(0, 500), topColumns), "utf8")],
    ["candidate-evidence.csv", Buffer.from(toCsv(evidence.candidates, candidateColumns), "utf8")],
    ["currently-tagged-at-risk.csv", Buffer.from(toCsv(evidence.atRisk, riskColumns), "utf8")],
    ["licensor-alias-blast-radius.csv", Buffer.from(toCsv(evidence.aliasRows, aliasColumns), "utf8")],
    ["licensor-property-resolution-matrix.json", Buffer.from(JSON.stringify({
      axes: {
        licensor: "Current worker exact name/code plus the eight frozen hard-coded aliases.",
        property: "Current worker global exact canonical Property name behavior.",
      },
      cells: evidence.matrix,
      total: Object.values(evidence.matrix).reduce((sum, count) => sum + count, 0),
    }, null, 2) + "\n", "utf8")],
  ]);
  const riskHash = sha256(files.get("currently-tagged-at-risk.csv"));
  const readme = `# PopSG Property reconciliation PSG-1 evidence

**Phase:** PSG-1 only  
**Measured:** ${evidence.summary.measured_at}  
**Production:** \`qsllyeztdwjgirsysgai\`  
**Preview:** \`rjyboqwcdzcocqgmsyel\`

## Result

- All ${evidence.summary.active_file_occurrences.toLocaleString("en-US")} active file occurrences appear exactly once in the 2×2 matrix.
- The inventory contains ${evidence.summary.inventory_rows.toLocaleString("en-US")} normalized observation rows.
- ${evidence.summary.licensor_unresolved_inventory_rows.toLocaleString("en-US")} inventory row is \`licensor_unresolved\` and has no Property candidate or proposal.
- Parent-scoped exact name/code matching resolves ${evidence.summary.property_scoped_exact_file_occurrences.toLocaleString("en-US")} file occurrences.
- Parent scoping would remove ${evidence.summary.currently_tagged_at_risk_relationships.toLocaleString("en-US")} currently accepted global Property relationships.
- The signed at-risk file is SHA-256 \`${riskHash}\`.
- No fuzzy evidence row is allowed to map automatically.
- No full path or filename is exported. Examples contain only a hash, depth, and extension.

## 2×2 matrix

The Licensor axis reproduces the current worker resolver: exact canonical name/code plus the
eight frozen hard-coded aliases. The Property axis reproduces the current worker's global exact
canonical-name behavior. This matrix describes current observations, not proposed behavior.

| Licensor | Property | Active files |
|---|---|---:|
| Resolved | Resolved | ${evidence.matrix.licensor_resolved__property_resolved.toLocaleString("en-US")} |
| Resolved | Unresolved | ${evidence.matrix.licensor_resolved__property_unresolved.toLocaleString("en-US")} |
| Unresolved | Resolved | ${evidence.matrix.licensor_unresolved__property_resolved.toLocaleString("en-US")} |
| Unresolved | Unresolved | ${evidence.matrix.licensor_unresolved__property_unresolved.toLocaleString("en-US")} |

## Files

- \`inventory.csv\`: one row per resolved-Licensor and normalized Property tuple, or one
  \`licensor_unresolved\` row per normalized unresolved-parent observation.
- \`summary.json\`: counts, safeguards, migration ledger count, and the moving ColdLion checkpoint.
- \`top-unresolved.csv\`: the first 500 unresolved rows by active-file impact.
- \`candidate-evidence.csv\`: same-parent evidence only. Shared-token rows are review evidence,
  have \`automatic_mapping_allowed=false\`, and are not proposals.
- \`currently-tagged-at-risk.csv\`: every accepted current global exact match that parent scoping
  would remove. Its SHA-256 above is the signed PSG-1 delta.
- \`licensor-alias-blast-radius.csv\`: all eight hard-coded aliases, including zero-use aliases.
- \`licensor-property-resolution-matrix.json\`: machine-readable 2×2 counts and axis definitions.
- \`source-hashes.json\`: hashes and byte sizes for every PSG-1 artifact and source input.

## Inventory field guide

- \`observation_key\`: stable grouping key.
- \`licensor_resolution\`: \`resolved\` or \`licensor_unresolved\`.
- \`resolved_licensor_*\`: canonical parent identity, blank when unresolved.
- \`normalized_*\`: output of frozen contract \`popsg-property-observation-v1\`.
- \`raw_*_variants\`: counted raw spellings for the grouped observation.
- \`representative_examples\`: at most three redacted path/filename shapes.
- \`current_global_*\`: current worker global canonical-name result.
- \`scoped_exact_*\`: canonical name or code match under the resolved parent.
- \`candidate_property_ids\`: same-parent review evidence only.
- \`coldlion_exact_evidence_count\`: exact ColdLion name/code evidence linked to the same canonical row.
- \`designflow_exact_evidence_count\`: exact DesignFlow comparison evidence while that lane remains active.
- \`structural_folder_hint\`: text looks like collection/style-guide/workflow structure.
- \`currently_tagged_at_risk\`: an accepted global match would be removed by parent scoping.
- \`licensor_alias\`: one of the eight frozen hard-coded aliases, if used.
- \`cross_parent_flag\`: global Property parent differs from resolved Licensor.
- \`ambiguity_flag\`: the current global input has more than one canonical match.
- \`proposal_eligible\`: false for every unresolved Licensor.
- \`proposal_exclusion_reason\`: \`licensor_unresolved\` when Property work is forbidden.

## Reproduction

1. Install \`pg@8.16.3\` in a scratch folder outside the repo.
2. Set \`PG_MODULE\` to that scratch module path.
3. Inject the production DB password and preview \`DB_HOST\`, \`DB_USER\`, \`DB_PASSWORD\`,
   \`DB_NAME\`, and \`DB_PORT\` from the named 1Password items.
4. Run:

\`\`\`powershell
node scripts/popsg-property-psg1-inventory.test.cjs
node scripts/popsg-property-psg1-inventory.cjs docs/verification/popsg-property-reconciliation-20260727-psg1
\`\`\`

Both connections start \`REPEATABLE READ READ ONLY\` and finish with \`ROLLBACK\`. PostgreSQL
rejects writes inside these transactions.

## Boundaries

- No database write, migration, canonical creation, rebuild, deployment, or UI change occurred.
- No alias or Property proposal was produced.
- Every unresolved Licensor is excluded from candidate evidence and future Property proposals.
- PSG-2 has not started.
`;
  files.set("README.md", Buffer.from(readme, "utf8"));
  for (const [name, buffer] of files) fs.writeFileSync(path.join(outputDir, name), buffer);
  const manifest = {};
  for (const [name, buffer] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    manifest[name] = { sha256: sha256(buffer), bytes: buffer.length };
  }
  manifest.inputs = inputs;
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(outputDir, "source-hashes.json"), manifestBuffer);
  return manifest;
}

async function main() {
  const outputDir = path.resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("Usage: node scripts/popsg-property-psg1-inventory.cjs <output-directory>");
  if (!process.env.PG_MODULE) throw new Error("PG_MODULE must point to the installed pg module");
  const { Client } = require(process.env.PG_MODULE);
  const required = [
    "PROD_DB_PASSWORD", "PREVIEW_DB_HOST", "PREVIEW_DB_USER", "PREVIEW_DB_PASSWORD",
    "PREVIEW_DB_NAME", "PREVIEW_DB_PORT",
  ];
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
  const measuredAt = new Date().toISOString();
  const production = await withReadOnly(
    buildClient(Client, {
      host: "aws-1-us-east-1.pooler.supabase.com",
      port: 6543,
      user: "postgres.qsllyeztdwjgirsysgai",
      password: process.env.PROD_DB_PASSWORD,
      database: "postgres",
    }),
    fetchProduction,
  );
  const preview = await withReadOnly(
    buildClient(Client, {
      host: process.env.PREVIEW_DB_HOST,
      port: Number(process.env.PREVIEW_DB_PORT),
      user: process.env.PREVIEW_DB_USER,
      password: process.env.PREVIEW_DB_PASSWORD,
      database: process.env.PREVIEW_DB_NAME,
    }),
    fetchPreview,
  );
  const evidence = buildEvidence(production, preview, measuredAt);
  const popdamRepo = path.resolve(process.env.POPDAM_REPO ?? path.join(__dirname, "..", "..", "popdam3"));
  const manifest = writeArtifacts(outputDir, evidence, {
    production_project_ref: "qsllyeztdwjgirsysgai",
    preview_project_ref: "rjyboqwcdzcocqgmsyel",
    production_transaction: "REPEATABLE READ READ ONLY then ROLLBACK",
    preview_transaction: "REPEATABLE READ READ ONLY then ROLLBACK",
    normalizer_contract: "popsg-property-observation-v1",
    source_files: {
      "shared-db/scripts/popsg-property-psg1-inventory.cjs": fileMetadata(__filename),
      "shared-db/scripts/popsg-property-psg1-inventory.test.cjs": fileMetadata(
        path.join(__dirname, "popsg-property-psg1-inventory.test.cjs"),
      ),
      "shared-db/docs/verification/popsg-property-reconciliation-20260726/normalization-contract-v1.md":
        fileMetadata(path.join(__dirname, "..", "docs", "verification", "popsg-property-reconciliation-20260726", "normalization-contract-v1.md")),
      "popdam3/apps/worker/src/handlers/popsg-tags.ts":
        fileMetadata(path.join(popdamRepo, "apps", "worker", "src", "handlers", "popsg-tags.ts")),
    },
  });
  process.stdout.write(JSON.stringify({ summary: evidence.summary, manifest }, null, 2) + "\n");
}

module.exports = {
  LICENSOR_ALIASES,
  normalize,
  csvCell,
  toCsv,
  sha256,
  fileMetadata,
  sharedTokenScore,
  structuralHint,
  redactedExample,
  buildEvidence,
  writeArtifacts,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
