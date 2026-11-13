#!/usr/bin/env node
// Dry-run planner for NAS folder shortening (issue #963, plan Phase 4).
// Reads a folder listing and a file listing (paths relative to the share root),
// applies rules.json, and writes old-to-new.csv, needs-attention.csv and
// summary.md. It never touches the NAS. Deterministic and idempotent.
//
// Usage:
//   node tools/folder-rename/plan.mjs --rules tools/folder-rename/rules.json \
//     --dirs dirs.txt --files files.txt --out verification/folder-shortening
import fs from "node:fs";
import path from "node:path";

import { planRenames, mapFile } from "../../supabase/functions/_shared/folder-rules/core.mjs";
export * from "../../supabase/functions/_shared/folder-rules/core.mjs";

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, cols) {
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

function countOver(paths, limit) {
  return paths.reduce((n, p) => n + (p.length > limit ? 1 : 0), 0);
}

function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
  );
  const rules = JSON.parse(fs.readFileSync(args.rules, "utf8"));
  const dirs = fs.readFileSync(args.dirs, "utf8").split("\n").filter(Boolean);
  const files = fs.readFileSync(args.files, "utf8").split("\n").filter(Boolean);
  const limit = rules.target_max_path;
  const out = args.out;
  fs.mkdirSync(out, { recursive: true });

  const { renames, attention, map } = planRenames(dirs, rules);
  const after = files.map((f) => mapFile(f, map));
  const altYear = planRenames(dirs, rules, { stripYear: !rules.strip_year_under_year_folder.enabled });
  const afterAlt = files.map((f) => mapFile(f, altYear.map));

  fs.writeFileSync(
    path.join(out, "old-to-new.csv"),
    toCsv(renames, ["depth", "old_path", "new_path", "rule", "chars_saved"]),
  );
  fs.writeFileSync(path.join(out, "needs-attention.csv"), toCsv(attention, ["kind", "old_path", "proposed", "note"]));

  const byRule = {};
  for (const r of renames) for (const k of r.rule.split("+")) byRule[k] = (byRule[k] ?? 0) + 1;
  const byKind = {};
  for (const a of attention) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  const longest = after
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.length - a.p.length || (a.p < b.p ? -1 : 1))
    .slice(0, 50);
  const over = after.filter((p) => p.length > limit);
  // Which folder (first-level under a customer or top folder) holds the remaining long files.
  const groups = {};
  for (const p of over) {
    const segs = p.split("/").slice(0, rules.root.split("/").length + 4).join("/");
    groups[segs] = (groups[segs] ?? 0) + 1;
  }
  const topGroups = Object.entries(groups)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 25);

  const yearOn = rules.strip_year_under_year_folder.enabled;
  const md = [
    "# Folder shortening — dry-run summary (#963, Phase 4)",
    "",
    `Inputs: ${dirs.length.toLocaleString("en-US")} folders, ${files.length.toLocaleString("en-US")} files (listing from edgesynology2, read-only). Target: path from the share root ≤ ${limit} characters.`,
    "",
    "## Totals",
    "",
    `- Folders to rename: ${renames.length.toLocaleString("en-US")}`,
    `- Files over ${limit} before: ${countOver(files, limit).toLocaleString("en-US")}`,
    `- Files over ${limit} after (year rule ${yearOn ? "on" : "off"}): ${over.length.toLocaleString("en-US")}`,
    `- Files over ${limit} after if the year rule were ${yearOn ? "off" : "on"}: ${countOver(afterAlt, limit).toLocaleString("en-US")} (folders renamed: ${altYear.renames.length.toLocaleString("en-US")})`,
    `- Files over 240 before / after: ${countOver(files, 240).toLocaleString("en-US")} / ${countOver(after, 240).toLocaleString("en-US")}`,
    `- Needs attention: ${attention.length.toLocaleString("en-US")}`,
    "",
    "## Renames by rule",
    "",
    ...Object.entries(byRule)
      .sort()
      .map(([k, v]) => `- ${k}: ${v.toLocaleString("en-US")}`),
    "",
    "## Needs attention by kind",
    "",
    ...(Object.keys(byKind).length
      ? Object.entries(byKind)
          .sort()
          .map(([k, v]) => `- ${k}: ${v.toLocaleString("en-US")}`)
      : ["- none"]),
    "",
    `## Where the remaining files over ${limit} live (top 25 folders, 4 levels below the root)`,
    "",
    ...(topGroups.length ? topGroups.map(([g, n]) => `- ${n.toLocaleString("en-US")} — \`${g}\``) : ["- none"]),
    "",
    "## 50 longest paths after renaming",
    "",
    ...longest.map(({ p }) => `- ${p.length} — \`${p}\``),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "summary.md"), md);
  console.log(
    JSON.stringify({ renames: renames.length, attention: attention.length, overBefore: countOver(files, limit), overAfter: over.length, overAfterAltYear: countOver(afterAlt, limit) }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
