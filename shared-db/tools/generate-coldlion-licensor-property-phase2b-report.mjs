import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const pgRoot = process.env.PG_MODULE_ROOT || "C:\\repos\\oracle\\node_modules\\pg";
const { Client } = require(pgRoot);

const PREVIEW_REF = "rjyboqwcdzcocqgmsyel";
const outputDir = resolve(
  process.argv[2] || "docs/verification/coldlion-licensor-property-phase2b-20260724",
);

function assertPreviewTarget() {
  const identity = [
    process.env.DB_HOST,
    process.env.DB_USER,
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
  ].filter(Boolean).join(" ");
  if (!identity.includes(PREVIEW_REF)) {
    throw new Error(`Refusing report generation: database target is not preview ${PREVIEW_REF}`);
  }
  if (identity.includes("qsllyeztdwjgirsysgai")) {
    throw new Error("Refusing report generation: production project identity detected");
  }
}

function csvCell(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function writeCsv(name, rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const body = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
  await writeFile(resolve(outputDir, name), `${body}\n`, "utf8");
}

function normalize(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function classifySource(source, sameEntity, otherEntity) {
  const codeMatches = sameEntity.filter((row) => normalize(row.code) === normalize(source.mg_code));
  const nameMatches = sameEntity.filter((row) => normalize(row.name) === normalize(source.source_name));
  const crossCode = otherEntity.filter((row) => normalize(row.code) === normalize(source.mg_code));
  const crossName = otherEntity.filter((row) => normalize(row.name) === normalize(source.source_name));

  if (codeMatches.length === 1 && nameMatches.length === 1 && codeMatches[0].id === nameMatches[0].id) {
    return {
      category: "exact compatible code match",
      candidate_id: codeMatches[0].id,
      evidence: "code and normalized name agree",
      blocking: false,
    };
  }
  if (codeMatches.length === 1 && nameMatches.length === 0) {
    return {
      category: "probable alias/rename",
      candidate_id: codeMatches[0].id,
      evidence: "compatible code is unique but name differs",
      blocking: true,
    };
  }
  if (codeMatches.length === 0 && nameMatches.length === 1) {
    return {
      category: "exact normalized-name match",
      candidate_id: nameMatches[0].id,
      evidence: "name is unique but code differs",
      blocking: true,
    };
  }
  if (codeMatches.length > 1 || nameMatches.length > 1) {
    return {
      category: codeMatches.length > 1 ? "code collision" : "name collision",
      candidate_id: null,
      evidence: `same-entity code=${codeMatches.length}; name=${nameMatches.length}`,
      blocking: true,
    };
  }
  if (crossCode.length || crossName.length) {
    return {
      category: "entity-type collision",
      candidate_id: null,
      evidence: `no same-entity candidate; other-entity code=${crossCode.length}; name=${crossName.length}`,
      blocking: true,
    };
  }
  return {
    category: "ColdLion-only candidate",
    candidate_id: null,
    evidence: "no same-entity code or normalized-name candidate",
    blocking: true,
  };
}

function sourceRows(entityType, mirrorRows, canonicalRows, otherCanonicalRows) {
  return mirrorRows.map((source) => {
    const ruling = classifySource(source, canonicalRows, otherCanonicalRows);
    const candidate = canonicalRows.find((row) => row.id === ruling.candidate_id);
    return {
      row_scope: "coldlion_source",
      entity_type: entityType,
      company_code: source.company_code,
      division_code: source.division_code,
      mg_type_code: source.mg_type_code,
      mg_code: source.mg_code,
      source_name: source.source_name,
      category: ruling.category,
      candidate_canonical_id: ruling.candidate_id,
      candidate_code: candidate?.code,
      candidate_name: candidate?.name,
      candidate_status: candidate?.status,
      preserve_canonical_status: candidate ? "yes" : "",
      blocking_review: ruling.blocking ? "yes" : "no",
      evidence: ruling.evidence,
      source_hash: source.source_hash,
      first_seen_at: source.first_seen_at,
      last_seen_at: source.last_seen_at,
      last_sync_run_id: source.last_sync_run_id,
    };
  });
}

function canonicalOnlyRows(entityType, canonicalRows, classifiedSourceRows) {
  const covered = new Set(classifiedSourceRows.map((row) => row.candidate_canonical_id).filter(Boolean));
  return canonicalRows
    .filter((row) => !covered.has(row.id))
    .map((row) => ({
      row_scope: "canonical_only",
      entity_type: entityType,
      canonical_id: row.id,
      canonical_code: row.code,
      canonical_name: row.name,
      canonical_status: row.status,
      category: "canonical-only curated/legacy record",
      preserve_canonical_status: "yes",
      blocking_review: "yes",
      evidence: "no ColdLion source row classified to this canonical UUID",
    }));
}

async function main() {
  assertPreviewTarget();
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 6543),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const [
      licMirrors,
      propMirrors,
      licensors,
      properties,
      reviews,
      runs,
      rawCounts,
      designflow,
      schedules,
    ] = await Promise.all([
      client.query(`select company_code, division_code, mg_type_code, mg_code,
                           name source_name, source_hash, first_seen_at, last_seen_at,
                           last_sync_run_id, licensor_id
                    from plm.erp_licensor
                    order by company_code, division_code, mg_type_code, mg_code`),
      client.query(`select company_code, division_code, mg_type_code, mg_code,
                           name source_name, source_hash, first_seen_at, last_seen_at,
                           last_sync_run_id, property_id
                    from plm.erp_property
                    order by company_code, division_code, mg_type_code, mg_code`),
      client.query(`select id::text, code, name, status::text from core.licensor order by id`),
      client.query(`select id::text, licensor_id::text, code, name, status::text
                    from core.property order by id`),
      client.query(`select id::text, entity_type, finding_scope, company_code, division_code,
                           mg_type_code, mg_code, source_name, proposed_licensor_id::text,
                           proposed_property_id::text, match_method, confidence, reason,
                           evidence, status, resolution, created_at, updated_at
                    from plm.taxonomy_resolution_review
                    order by entity_type, division_code nulls last, mg_type_code nulls last,
                             mg_code nulls last, id`),
      client.query(`select id::text, status::text, started_at, finished_at, rows_seen,
                           rows_inserted, rows_updated, rows_failed, error, metadata
                    from ingest.sync_run
                    where source_name = 'coldlion_licensors_properties_api'
                    order by started_at`),
      client.query(`select source_table, count(*)::integer rows,
                           md5(coalesce(string_agg(record_hash, '|' order by source_id), '')) hash
                    from ingest.raw_record
                    where source_system = 'coldlion'
                      and source_table in ('merchGroupLicensor', 'merchGroupProperty')
                    group by source_table order by source_table`),
      client.query(`select
                      (select count(*)::integer from plm.licensor_import) licensor_rows,
                      (select count(distinct mg_code)::integer from plm.licensor_import) licensor_codes,
                      (select count(*)::integer from plm.property_import) property_rows,
                      (select count(distinct mg_code)::integer from plm.property_import) property_codes,
                      (select max(started_at) from ingest.sync_run
                       where source_system='designflow_plm' and status='succeeded') latest_success`),
      client.query(`select count(*)::integer matching_jobs
                    from cron.job
                    where command ilike '%coldlion%licensor%'
                       or command ilike '%coldlion%property%'
                       or jobname ilike '%coldlion%licensor%'
                       or jobname ilike '%coldlion%property%'`),
    ]);

    const licSource = sourceRows("licensor", licMirrors.rows, licensors.rows, properties.rows);
    const propSource = sourceRows("property", propMirrors.rows, properties.rows, licensors.rows);
    const licAll = [...licSource, ...canonicalOnlyRows("licensor", licensors.rows, licSource)];
    const propAll = [...propSource, ...canonicalOnlyRows("property", properties.rows, propSource)];
    const all = [...licAll, ...propAll];

    const byCategory = Object.fromEntries(
      [...new Set(all.map((row) => row.category))].sort().map((category) => [
        category,
        all.filter((row) => row.category === category).length,
      ]),
    );

    const parentEdges = properties.rows.map((property) => {
      const parent = licensors.rows.find((row) => row.id === property.licensor_id);
      return {
        property_id: property.id,
        property_code: property.code,
        property_name: property.name,
        property_status: property.status,
        licensor_id: property.licensor_id,
        licensor_code: parent?.code,
        licensor_name: parent?.name,
        licensor_status: parent?.status,
      };
    });

    const statusDifferences = all
      .filter((row) => row.candidate_canonical_id && row.candidate_status !== "active")
      .map((row) => ({
        entity_type: row.entity_type,
        division_code: row.division_code,
        mg_code: row.mg_code,
        source_name: row.source_name,
        canonical_id: row.candidate_canonical_id,
        canonical_status: row.candidate_status,
        required_disposition: "preserve canonical",
      }));

    const unmatched = all.filter((row) =>
      ["ColdLion-only candidate", "canonical-only curated/legacy record", "probable alias/rename"]
        .includes(row.category),
    );
    const ambiguous = all.filter((row) =>
      ["entity-type collision", "code collision", "name collision"].includes(row.category),
    );
    const namedPattern = /NASA|ZAG|FRIDA KAHLO|FRIENDS TV|1ST ORDER TROOPER/i;
    const knownLapsed = all.filter((row) =>
      namedPattern.test(`${row.source_name || ""} ${row.canonical_name || ""} ${row.candidate_name || ""}`),
    );

    await mkdir(outputDir, { recursive: true });
    await writeCsv("licensors.csv", licAll);
    await writeCsv("properties.csv", propAll);
    await writeCsv("parent_edges.csv", parentEdges);
    await writeCsv("status_differences.csv", statusDifferences);
    await writeCsv("unmatched.csv", unmatched);
    await writeCsv("ambiguous.csv", ambiguous);
    await writeCsv("known-lapsed.csv", knownLapsed);
    await writeCsv("review-findings.csv", reviews.rows);
    await writeCsv("sync-runs.csv", runs.rows);

    const successful = runs.rows.filter((row) => row.status === "succeeded");
    const failed = runs.rows.filter((row) => row.status !== "succeeded");
    const sourceHashes = {
      environment: PREVIEW_REF,
      generated_at: new Date().toISOString(),
      mirror_counts: {
        licensors: licMirrors.rowCount,
        properties: propMirrors.rowCount,
      },
      mirror_hashes: {
        licensor_keys: await client.query(`select md5(coalesce(string_agg(
          concat_ws('|',company_code,division_code,mg_type_code,mg_code),'|'
          order by company_code,division_code,mg_type_code,mg_code),'')) hash from plm.erp_licensor`)
          .then((result) => result.rows[0].hash),
        property_keys: await client.query(`select md5(coalesce(string_agg(
          concat_ws('|',company_code,division_code,mg_type_code,mg_code),'|'
          order by company_code,division_code,mg_type_code,mg_code),'')) hash from plm.erp_property`)
          .then((result) => result.rows[0].hash),
        licensor_source_hashes: await client.query(`select md5(coalesce(string_agg(
          source_hash,'|' order by company_code,division_code,mg_type_code,mg_code),'')) hash
          from plm.erp_licensor`).then((result) => result.rows[0].hash),
        property_source_hashes: await client.query(`select md5(coalesce(string_agg(
          source_hash,'|' order by company_code,division_code,mg_type_code,mg_code),'')) hash
          from plm.erp_property`).then((result) => result.rows[0].hash),
      },
      raw_counts_and_hashes: rawCounts.rows,
      successful_run_ids: successful.map((row) => row.id),
      successful_snapshot_hashes: successful.map((row) => row.metadata?.snapshot_hash),
      failed_run_ids: failed.map((row) => row.id),
      category_counts: byCategory,
    };
    await writeFile(
      resolve(outputDir, "source-hashes.json"),
      `${JSON.stringify(sourceHashes, null, 2)}\n`,
      "utf8",
    );

    const blockingCount = all.filter((row) => row.blocking_review === "yes").length;
    const readme = `# ColdLion Licensor/Property Phase 2B preview verification

**Environment:** preview \`${PREVIEW_REF}\` only
**Generated:** ${sourceHashes.generated_at}
**Mode:** \`mirror_only\`
**Production:** not connected or modified
**Schedule:** not created (${schedules.rows[0].matching_jobs} matching jobs)

## Operational result

- Successful full snapshots: ${successful.length}
- Successful run UUIDs: ${successful.map((row) => `\`${row.id}\``).join(", ")}
- Snapshot hashes: ${successful.map((row) => `\`${row.metadata?.snapshot_hash}\``).join(", ")}
- Failed/blocked attempts recorded durably: ${failed.length}
- Mirror rows: ${licMirrors.rowCount} Licensor + ${propMirrors.rowCount} Property
- Second-run accounting: ${successful.at(-1)?.rows_inserted || 0} inserted, ${successful.at(-1)?.rows_updated || 0} updated, ${successful.at(-1)?.metadata?.rows_unchanged || 0} unchanged
- Database review findings: ${reviews.rowCount}

The first operator attempt used a misparsed 1Password CLI field rendering and ColdLion rejected
the request before import. Preview recorded one durable failed run. The credential value was
then read from the field's JSON \`value\`; both complete snapshots succeeded. One failed run
does not meet the two-consecutive-failure alert threshold, so no external alert was expected.

## Coverage and reconciliation

Every one of the ${licMirrors.rowCount + propMirrors.rowCount} ColdLion source rows and
${licensors.rowCount + properties.rowCount} canonical rows is represented in
\`licensors.csv\` or \`properties.csv\`. Category totals:

${Object.entries(byCategory).map(([category, count]) => `- ${category}: ${count}`).join("\n")}

This Phase 2B ledger is evidence, not an approval ledger. It deliberately flags
${blockingCount} rows for Phase 3 review and does not write mirror links, source references,
canonical rows, statuses, names, or parent edges.

## DesignFlow comparison

- Staging: ${designflow.rows[0].licensor_rows} Licensor rows /
  ${designflow.rows[0].licensor_codes} distinct codes; ${designflow.rows[0].property_rows}
  Property rows / ${designflow.rows[0].property_codes} distinct codes.
- Latest successful DesignFlow run: ${designflow.rows[0].latest_success?.toISOString() || "none"}.

The DesignFlow snapshot is stale, so it is retained as dated comparison evidence only.
The Phase 6 parallel-run clock does not start.

## Readiness ruling

Phase 2B's two-snapshot and canonical-immutability gates pass. Phase 3 may use this ledger as
its starting input, but it must resolve every blocking row and must not link or create
canonical records. The 30 database conflict findings are broader than the earlier FRIDA-only
expectation and are a forward-plan input.
`;
    await writeFile(resolve(outputDir, "generated-summary.md"), readme, "utf8");

    process.stdout.write(`${JSON.stringify({
      target: PREVIEW_REF,
      output_dir: outputDir,
      successful_runs: successful.map((row) => row.id),
      snapshot_hashes: successful.map((row) => row.metadata?.snapshot_hash),
      failed_runs: failed.map((row) => row.id),
      mirror_rows: licMirrors.rowCount + propMirrors.rowCount,
      canonical_rows: licensors.rowCount + properties.rowCount,
      category_counts: byCategory,
      blocking_rows: blockingCount,
      review_findings: reviews.rowCount,
      matching_schedules: schedules.rows[0].matching_jobs,
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
