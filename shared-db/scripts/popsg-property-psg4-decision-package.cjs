const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_REL =
  "docs/verification/popsg-property-reconciliation-20260727-psg2/batch-01-exact-existing.csv";
const OUT_REL =
  "docs/verification/popsg-property-reconciliation-20260728-psg4";
const SOURCE_SHA =
  "f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e";
const REVIEWED_AT = "2026-07-28T16:35:58-04:00";
const EVIDENCE_REVIEWER = "Codex PSG-4 evidence review";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalLf(value) {
  return value.replace(/\r\n/g, "\n");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows.filter((r) => r.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers, rows) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    "",
  ].join("\n");
}

function build() {
  const sourcePath = path.join(ROOT, SOURCE_REL);
  const sourceBytes = canonicalLf(fs.readFileSync(sourcePath, "utf8"));
  if (sha256(sourceBytes) !== SOURCE_SHA) {
    throw new Error("Frozen Batch 01 hash mismatch. Refusing to build PSG-4.");
  }

  const sourceRows = parseCsv(sourceBytes);
  if (sourceRows.length !== 51) {
    throw new Error(`Expected 51 source rows, found ${sourceRows.length}.`);
  }

  const decisions = sourceRows.map((row) => {
    const parentMatches =
      row.resolved_licensor_id &&
      row.resolved_licensor_id === row.target_property_parent_licensor_id;
    const exactProof =
      row.proposed_disposition === "exact_existing" &&
      ["exact_normalized_canonical_name_under_resolved_licensor",
        "exact_canonical_code_under_resolved_licensor"].includes(row.rationale_code);
    const safeFlags =
      row.cross_parent_proposal === "false" &&
      row.fuzzy_similarity_used_for_selection === "false" &&
      row.proposal_effective === "false" &&
      row.owner_activation_required === "true";
    if (!parentMatches || !exactProof || !safeFlags || !row.target_property_id) {
      throw new Error(`Missing safe parent/target proof for ${row.observation_key}.`);
    }
    return {
      observation_key: row.observation_key,
      resolved_licensor_id: row.resolved_licensor_id,
      resolved_licensor_name: row.resolved_licensor_name,
      normalized_observed_value: row.normalized_observed_value,
      active_file_count: row.active_file_count,
      disposition: "exact_existing",
      target_property_id: row.target_property_id,
      target_property_code: row.target_property_code,
      target_property_name: row.target_property_name,
      target_property_parent_licensor_id: row.target_property_parent_licensor_id,
      reason:
        row.rationale_code === "exact_canonical_code_under_resolved_licensor"
          ? "Observed value exactly matches this canonical Property code under the resolved Licensor."
          : "Observed value exactly matches this canonical Property name under the resolved Licensor.",
      parent_evidence:
        `PASS: resolved Licensor ${row.resolved_licensor_id} equals target Property parent ` +
        `${row.target_property_parent_licensor_id}; frozen PSG-2 evidence.`,
      evidence_reviewer: EVIDENCE_REVIEWER,
      evidence_reviewed_at: REVIEWED_AT,
      owner_decision_status: "pending_explicit_psg4_approval",
      owner_decision_reviewer: "Albert Hazan",
      owner_decision_timestamp: "recorded_from_explicit_approval_message",
    };
  });

  const headers = Object.keys(decisions[0]);
  const decisionCsv = csv(headers, decisions);
  const decisionSha = sha256(decisionCsv);
  const totalFiles = decisions.reduce((sum, row) => sum + Number(row.active_file_count), 0);
  if (totalFiles !== 44331) {
    throw new Error(`Expected 44,331 affected files, found ${totalFiles}.`);
  }

  const top = [...decisions]
    .sort((a, b) => Number(b.active_file_count) - Number(a.active_file_count))
    .slice(0, 10);
  const approvalText =
    `I, Albert Hazan, approve PSG-4 package PACKAGE_HASH for ` +
    `batch-01-exact-existing only: 51 exact-existing decisions affecting 44,331 files, ` +
    `bound to unchanged source SHA-256 ${SOURCE_SHA}. I approve only the per-row dispositions ` +
    `and same-parent targets in this package. I do not approve Batch 02, canonical creates, ` +
    `the 6,961 at-risk removals, ambiguous or deferred rows, schema or migration work, RLS or RPC work, ` +
    `database writes, mapping activation, tag rebuilds, deployment, production, or PSG-5.`;
  const approvalTemplateSha = sha256(approvalText);
  const packageHash = sha256(
    JSON.stringify({
      format: "popsg-psg4-package-v1",
      source_sha256: SOURCE_SHA,
      decisions_sha256: decisionSha,
      approval_template_sha256: approvalTemplateSha,
      rows: 51,
      active_files: 44331,
    })
  );
  const exactApproval = approvalText.replace("PACKAGE_HASH", packageHash);
  const approvalSha = sha256(exactApproval);

  const manifest = {
    phase: "PSG-4",
    status: "pending_explicit_owner_approval",
    package_format: "popsg-psg4-package-v1",
    generated_at: REVIEWED_AT,
    source: {
      path: SOURCE_REL,
      sha256: SOURCE_SHA,
      unchanged: true,
      rows: 51,
      active_files: 44331,
    },
    files: {
      "decisions.csv": { sha256: decisionSha, rows: 51, active_files: 44331 },
      "approval-language.txt": { sha256: approvalSha },
    },
    package_hash_inputs: {
      source_sha256: SOURCE_SHA,
      decisions_sha256: decisionSha,
      approval_template_sha256: approvalTemplateSha,
      rows: 51,
      active_files: 44331,
    },
    package_sha256: packageHash,
    exclusions: [
      "batch-02-non-property",
      "canonical creates",
      "6961 at-risk removals",
      "ambiguous rows",
      "deferred rows",
      "schema, migrations, RLS, or RPCs",
      "database writes",
      "mapping activation",
      "tag rebuilds",
      "deployment",
      "production",
      "PSG-5",
    ],
  };

  const topTable = top
    .map(
      (row) =>
        `| ${row.resolved_licensor_name} | ${row.normalized_observed_value} | ` +
        `${row.target_property_code} / ${row.target_property_name} | ${Number(
          row.active_file_count
        ).toLocaleString("en-US")} |`
    )
    .join("\n");
  const readme = `# PSG-4 owner decision package: Batch 01 exact existing

**Status:** PENDING ALBERT'S EXPLICIT PSG-4 APPROVAL
**Scope:** 51 same-parent exact matches affecting 44,331 active files
**Frozen source SHA-256:** \`${SOURCE_SHA}\`
**Immutable package SHA-256:** \`${packageHash}\`

## Business decision

The recommendation is to approve all 51 rows. Each observed PopSG Property value exactly matches
an existing canonical Property name or code under the same resolved Licensor. This package creates
nothing and changes nothing. Approval only records the bounded PSG-4 business decision for later,
separately authorized PSG-5 work.

## Totals

| Decision | Rows | Files |
|---|---:|---:|
| Approve \`exact_existing\` same-parent target | 51 | 44,331 |
| Reject | 0 | 0 |
| Defer inside this package | 0 | 0 |
| Canonical create | 0 | 0 |

## Highest-impact rows

| Licensor | Observed value | Existing Property | Files |
|---|---|---|---:|
${topTable}

## Parent proof

Every row fails closed unless its resolved Licensor ID exactly equals the target Property's parent
Licensor ID in the frozen PSG-2 evidence. All 51 rows passed. The package also requires an existing
target Property ID, an exact-name or exact-code reason, no fuzzy selection, no cross-parent flag,
and no already-effective proposal.

## Explicit exclusions

This package does not include or approve Batch 02, canonical creates, the 6,961 at-risk removals,
ambiguous or deferred rows, schema or migration work, RLS or RPC work, database writes, mapping
activation, tag rebuilds, deployment, production, or PSG-5.

## Exact owner approval language

Copy the single line from \`approval-language.txt\` exactly. The package remains pending until
Albert sends that exact bounded approval. The message timestamp becomes the owner decision
timestamp. Any changed decision row, source byte, or approval scope requires a new package and
new approval.

## Files and validation

- \`decisions.csv\`: one row per decision, including disposition, reason, parent evidence,
  evidence reviewer/time, and the pending owner reviewer/time contract.
- \`manifest.json\`: source binding, file hashes, exclusions, and immutable package hash.
- \`approval-language.txt\`: exact bounded words Albert must send.
- \`node scripts/popsg-property-psg4-decision-package.test.cjs\`: reproduces and verifies the
  source hash, 51 rows, 44,331 files, every parent edge, every exclusion, and all package hashes.
`;

  return {
    "decisions.csv": decisionCsv,
    "approval-language.txt": `${exactApproval}\n`,
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "README.md": readme,
  };
}

function writeOrCheck() {
  const built = build();
  const outDir = path.join(ROOT, OUT_REL);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(built)) {
      fs.writeFileSync(path.join(outDir, name), content, "utf8");
    }
    return;
  }
  for (const [name, expected] of Object.entries(built)) {
    const file = path.join(outDir, name);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
    const actual = canonicalLf(fs.readFileSync(file, "utf8"));
    if (actual !== expected) throw new Error(`${name} is not reproducible.`);
  }
}

if (require.main === module) writeOrCheck();
module.exports = { build, SOURCE_SHA };
