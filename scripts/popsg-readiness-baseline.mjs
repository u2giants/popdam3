#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const expectedUrl = "https://qsllyeztdwjgirsysgai.supabase.co";
const privateDir = path.resolve(".private/popsg-readiness");
const safeDir = path.resolve("verification/popsg-readiness");
mkdirSync(privateDir, { recursive: true });
mkdirSync(safeDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "").replace(/\.\d+Z$/, "Z");
const job = `popsg-readiness-${stamp}`;

function launchNas() {
  const remote = `/volume1/docker/synology-monitor-agent/manual-scans/${job}`;
  execFileSync("ssh", ["-o", "BatchMode=yes", "edgesynology2", "mkdir", remote]);
  for (const local of ["apps/bridge-agent/src/sg-eligibility-contract.json", "scripts/popsg-readiness-nas-scan.py"]) {
    const remoteFile = `${remote}/${path.basename(local)}`;
    execFileSync("ssh", ["-o", "BatchMode=yes", "edgesynology2", "sh", "-c", `cat > '${remoteFile}'`], { input: readFileSync(local) });
  }
  const wrapper = `#!/bin/sh\ncd '${remote}' || exit 90\ndate -u +%FT%TZ > started-at.txt\nnice -n 19 python3 popsg-readiness-nas-scan.py /volume1/styleguides sg-eligibility-contract.json paths.jsonl summary.json >stdout.txt 2>stderr.txt </dev/null\ncode=$?\nprintf '%s\\n' "$code" > exit-code.txt\ndate -u +%FT%TZ > completed-at.txt\n`;
  execFileSync("ssh", ["-o", "BatchMode=yes", "edgesynology2", "sh", "-c", `cat > '${remote}/run.sh'`], { input: wrapper });
  const launch = `cd '${remote}' && nohup sh run.sh >/dev/null 2>&1 </dev/null & echo $! > scan.pid`;
  execFileSync("ssh", ["-o", "BatchMode=yes", "edgesynology2", launch]);
  console.log(JSON.stringify({ job, remote, status: "launched" }));
}

async function collect() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url !== expectedUrl || !key) throw new Error("Expected production SUPABASE_URL and injected service-role key");
  const remote = process.env.POPSG_NAS_JOB;
  if (!remote) throw new Error("Set POPSG_NAS_JOB to the completed remote job directory");
  const exitCode = execFileSync("ssh", ["edgesynology2", "cat", `${remote}/exit-code.txt`], { encoding: "utf8" }).trim();
  if (exitCode !== "0") throw new Error(`NAS inventory incomplete (exit ${exitCode})`);
  for (const [remoteName, localName] of [["paths.jsonl", `nas-paths-${stamp}.jsonl`], ["summary.json", `nas-summary-${stamp}.json`]]) {
    const target = `${privateDir}/${localName}`;
    const fd = openSync(target, "w", 0o600);
    const result = spawnSync("ssh", ["-o", "BatchMode=yes", "edgesynology2", "cat", `${remote}/${remoteName}`], { stdio: ["ignore", fd, "pipe"] });
    closeSync(fd);
    if (result.status !== 0) throw new Error(`Private NAS evidence retrieval failed for ${remoteName}`);
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await client.from("style_guide_files").select("id,root_label,relative_path,crawl_run_id,file_extension,licensor_name,property_folder,thumbnail_url,thumbnail_error,tag_search_text").eq("is_active", true).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  writeFileSync(`${privateDir}/db-active-${stamp}.jsonl`, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const { data: crawls, error: crawlError } = await client.from("style_guide_crawl_runs").select("*").order("started_at", { ascending: false }).limit(30);
  if (crawlError) throw crawlError;
  const [pdfRemainingResult, pdfSamplesResult, sourceResult, groupsResult, foldersResult] = await Promise.all([
    client.rpc("count_pdf_backfill_remaining"),
    client.from("pdf_text_samples").select("char_count", { count: "exact" }),
    client.from("sku_files_used").select("style_guide_file_id"),
    client.from("style_guide_file_groups").select("*", { count: "exact", head: true }),
    client.from("style_guide_folders").select("*", { count: "exact", head: true }),
  ]);
  for (const [label, result] of Object.entries({ pdfRemainingResult, pdfSamplesResult, sourceResult, groupsResult, foldersResult })) {
    if (result.error) throw new Error(`Aggregate query failed: ${label}: ${result.error.message || result.error.code || "unknown"}`);
  }
  const latest = crawls[0];
  const nasLines = readFileSync(`${privateDir}/nas-paths-${stamp}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const nasKeys = new Set(nasLines.map(row => `${row.root_label}\0${row.relative_path}`));
  const dbKeys = new Set(rows.map(row => `${row.root_label}\0${row.relative_path}`));
  const missing = [...nasKeys].filter(key => !dbKeys.has(key));
  const extra = [...dbKeys].filter(key => !nasKeys.has(key));
  writeFileSync(`${privateDir}/missing-in-db-${stamp}.txt`, missing.join("\n") + "\n");
  writeFileSync(`${privateDir}/extra-in-db-${stamp}.txt`, extra.join("\n") + "\n");
  const hash = values => createHash("sha256").update([...values].sort().join("\n")).digest("hex");
  const countBy = (values, fn) => Object.fromEntries([...values.reduce((m, value) => m.set(fn(value) || "(none)", (m.get(fn(value) || "(none)") || 0) + 1), new Map())].sort());
  const privateLabelHash = value => createHash("sha256").update(value || "(none)").digest("hex").slice(0, 16);
  const summary = {
    observed_at: new Date().toISOString(), production_url: expectedUrl, latest_crawl: latest,
    active_rows: rows.length, accepted_latest_crawl: rows.filter(row => row.crawl_run_id === latest.id).length,
    active_not_latest_crawl: rows.filter(row => row.crawl_run_id !== latest.id).length,
    nas_eligible: nasLines.length, missing_in_db: missing.length, extra_in_db: extra.length,
    nas_path_set_sha256: hash(nasKeys), db_path_set_sha256: hash(dbKeys), missing_set_sha256: hash(missing), extra_set_sha256: hash(extra),
    by_extension: countBy(rows, row => row.file_extension),
    by_licensor: countBy(rows, row => row.licensor_name),
    by_property_hash: countBy(rows, row => privateLabelHash(row.property_folder)),
    preview: { with_preview: rows.filter(row => row.thumbnail_url).length, without_preview: rows.filter(row => !row.thumbnail_url).length, with_error: rows.filter(row => row.thumbnail_error).length, unexplained: rows.filter(row => !row.thumbnail_url && !row.thumbnail_error).length },
    tags: { covered: rows.filter(row => row.tag_search_text?.trim()).length, missing: rows.filter(row => !row.tag_search_text?.trim()).length },
    pdf_and_source_coverage: {
      popdam_pdf_backfill_remaining: Number(pdfRemainingResult.data),
      pdf_text_samples: pdfSamplesResult.count,
      pdf_text_nonempty: pdfSamplesResult.data.filter(row => Number(row.char_count || 0) > 0).length,
      pdf_text_empty_or_failed: pdfSamplesResult.data.filter(row => Number(row.char_count || 0) === 0).length,
      source_resolved: sourceResult.data.filter(row => row.style_guide_file_id).length,
      source_unresolved: sourceResult.data.filter(row => !row.style_guide_file_id).length,
      popsg_pdf_pipeline: "not present in baseline schema"
    },
    aggregates: { guide_rows: groupsResult.count, folder_rows: foldersResult.count, freshness: "not exposed by baseline schema" },
    server_rejections: { count: latest.files_found - rows.filter(row => row.crawl_run_id === latest.id).length, reasons: "not persisted by baseline schema" },
    crawl_history: crawls.map(row => ({ id: row.id, status: row.status, started_at: row.started_at, completed_at: row.completed_at, files_found: row.files_found, inaccessible_root_count: row.inaccessible_roots?.length || 0 }))
  };
  const safePath = `${safeDir}/baseline-${stamp}.json`;
  writeFileSync(safePath, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ safePath, privateDir, counts: { active: rows.length, nas: nasLines.length, missing: missing.length, extra: extra.length } }));
}

if (process.argv.includes("--launch-nas")) launchNas();
else if (process.argv.includes("--collect")) await collect();
else throw new Error("Use --launch-nas or --collect");
