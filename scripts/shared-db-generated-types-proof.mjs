// Generated-types proof for a shared-db outcome issue whose scope says
// generated_types: required. Reads TypeScript types generated from production
// (the Management API generator behind `supabase gen types`), checks the issue's objects are present, and writes
// db-generated-types-proof.json in the shape the shared-db --complete-outcome
// checker re-derives (matchesGeneratedTypesProof).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// Each issue's written objects, as they appear in the generated Database type.
export const REQUIRED_TYPES = {
  4257: [/\bplm:\s*\{/, /\bproduction_po_reservation:\s*\{/, /\bproduction_po_legacy_admission:\s*\{/, /\bproduction_order:\s*\{/],
  4268: [/\bget_dam_order_sales_order_dates:\s*\{[\s\S]*?Args:\s*\{\s*p_line_ids:\s*string\[\]/, /\bsales_order_date:\s*string\b/],
};

export function createGeneratedTypesProof({ source, workIssue, applicationCommitSha }) {
  const required = REQUIRED_TYPES[workIssue];
  if (!required) throw new Error(`no generated-types requirement for issue ${workIssue}`);
  if (!/^[0-9a-f]{40}$/i.test(applicationCommitSha ?? "")) throw new Error("application commit sha must be 40 hex characters");
  if (!/export type Database = \{/.test(source)) throw new Error("source is not supabase generated types");
  for (const pattern of required) if (!pattern.test(source)) throw new Error(`generated types are missing ${pattern}`);
  return {
    schema_version: 1,
    work_issue: workIssue,
    application_commit_sha: applicationCommitSha.toLowerCase(),
    database_project_id: "qsllyeztdwjgirsysgai",
    result: "passed",
    generated_types_sha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
  };
}

// Same generator `supabase gen types typescript --project-id` calls.
async function generateTypes() {
  const token = process.env.SUPABASE_ACCESS_TOKEN || "";
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is empty");
  const response = await fetch("https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/types/typescript?included_schemas=public,api,plm", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`type generation returned HTTP ${response.status}`);
  const { types } = await response.json();
  if (typeof types !== "string") throw new Error("type generation returned no types");
  return types;
}

async function main() {
  const workIssue = Number.parseInt(process.env.PROOF_ISSUE ?? "", 10);
  const source = process.env.GENERATED_TYPES_PATH ? await readFile(process.env.GENERATED_TYPES_PATH, "utf8") : await generateTypes();
  const proof = createGeneratedTypesProof({ source, workIssue, applicationCommitSha: process.env.APPLICATION_COMMIT_SHA });
  const out = process.env.GENERATED_TYPES_PROOF_PATH;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(`generated types proof for ${workIssue}: ${proof.generated_types_sha256}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`GENERATED TYPES PROOF FAILED: ${error.message}`);
    process.exit(1);
  });
}
