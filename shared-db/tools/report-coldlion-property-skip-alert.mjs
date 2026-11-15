#!/usr/bin/env node
// Delivery leg for the #6194 skipped-licensor alert.
//
// plm.sync_core_property_from_coldlion skips active ColdLion MG06 values whose licensor it
// cannot resolve (it never guesses). The trigger from migration 20261115073715 records each new
// set of such codes as an unacknowledged 'warning' in plm.taxonomy_sync_alert
// (source 'coldlion_core_property_sync'). This script reads those rows (one plain SELECT) and
// prints an issue plan. The workflow opens ONE issue per code set; while an open issue already
// carries the same dedupe marker, nothing new is filed.
//
// Public repository: the plan names ColdLion codes only, never licensed source rows.
//
//   node tools/report-coldlion-property-skip-alert.mjs --linked --out plan.json
// Exit: 0 nothing outstanding, 1 alert outstanding (plan written), 2 probe unreadable.
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { runSql } from "./coldlion-sync-common.mjs";
import { parseResult } from "./check-coldlion-property-scrape-names.mjs";

export const SOURCE_NAME = "coldlion_core_property_sync";
export const ISSUE_TITLE = "ColdLion MG06 values skipped: no licensor found (property sync)";
export const MARKER_PREFIX = "coldlion-property-skip-alert";

export const ALERT_SQL = `select json_build_object('alerts', (
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'fired_at', a.fired_at, 'reason', a.reason,
           'codes', a.payload->'codes', 'sync_run_id', a.payload->'sync_run_id')
         order by a.fired_at desc), '[]')
    from plm.taxonomy_sync_alert a
   where a.source_name = '${SOURCE_NAME}' and a.acknowledged_at is null)) as result;`;

export function dedupeKey(codes) {
  return crypto.createHash("sha256").update([...codes].sort().join("\n")).digest("hex").slice(0, 16);
}

export function marker(key) {
  return `<!-- ${MARKER_PREFIX}: ${key} -->`;
}

/** Pure. The newest unacknowledged alert is the current state of the skip list. */
export function buildPlan(probe) {
  if (!probe || !Array.isArray(probe.alerts)) {
    return { ok: false, deliver: false, reason: "alert probe unreadable; failing closed" };
  }
  const latest = probe.alerts[0];
  if (!latest) return { ok: true, deliver: false };
  const codes = Array.isArray(latest.codes) ? latest.codes.map(String).sort() : [];
  if (codes.length === 0) return { ok: false, deliver: false, reason: "alert row has no codes" };
  const key = dedupeKey(codes);
  const body = [
    marker(key),
    `The nightly ColdLion property sync skipped **${codes.length}** active MG06 value(s) because no licensor owns the code and the app list gives no MG05 parent. They are **not** in the shared property list. Nothing was guessed.`,
    "",
    `Codes: ${codes.map((c) => `\`${c}\``).join(", ")}`,
    "",
    `Reason: \`unresolved_licensor\`. Alert \`${latest.id}\` in \`plm.taxonomy_sync_alert\` (sync run ${latest.sync_run_id}), fired ${latest.fired_at} (UTC).`,
    "",
    "Human response owner: Albert Hazan. Fix by giving each code its licensor in ColdLion (MG05 parent) or core.property; never guess.",
    "Close this issue after acknowledging the alert row. A changed code list files a fresh issue.",
  ].join("\n");
  return { ok: true, deliver: true, key, codes, title: ISSUE_TITLE, body };
}

/** Pure. Returns the open issue number already carrying this key, or null. */
export function findDuplicate(issues, key) {
  const m = marker(key);
  const hit = (issues ?? []).find((i) => !i.pull_request && typeof i.body === "string" && i.body.includes(m));
  return hit ? hit.number : null;
}

/** Pure. `gh api --paginate` prints one JSON array per page, back to back. */
export function parsePaginated(text) {
  const out = [];
  let rest = String(text ?? "").trim();
  while (rest) {
    // Find the end of the first top-level array by trying successive "]" positions.
    let end = rest.indexOf("]");
    let page;
    for (;;) {
      if (end < 0) throw new Error("unparseable paginated output");
      try { page = JSON.parse(rest.slice(0, end + 1)); break; } catch { end = rest.indexOf("]", end + 1); }
    }
    if (!Array.isArray(page)) throw new Error("paginated page is not an array");
    out.push(...page);
    rest = rest.slice(end + 1).trim();
  }
  return out;
}

function main(argv) {
  const d = argv.indexOf("--find-duplicate");
  if (d >= 0) {
    const plan = JSON.parse(fs.readFileSync(argv[d + 1], "utf8"));
    const n = findDuplicate(parsePaginated(fs.readFileSync(argv[d + 2], "utf8")), plan.key);
    process.stdout.write(n == null ? "" : String(n));
    return 0;
  }
  const linked = argv.includes("--linked");
  const i = argv.indexOf("--out");
  let plan;
  try {
    plan = buildPlan(parseResult(runSql(ALERT_SQL, { linked })));
  } catch (e) {
    plan = { ok: false, deliver: false, reason: `alert probe failed: ${e.message}` };
  }
  if (i >= 0) fs.writeFileSync(argv[i + 1], JSON.stringify(plan, null, 2));
  if (!plan.ok) { console.error(plan.reason); return 2; }
  if (!plan.deliver) { console.log("No outstanding skipped-licensor alert."); return 0; }
  console.log(`Outstanding: ${plan.codes.length} skipped code(s): ${plan.codes.join(", ")}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
