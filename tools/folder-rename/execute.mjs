#!/usr/bin/env node
// Phase 5 executor for folder shortening (popdam3#963, plan §5.1).
//
// Renames NAS folders on edge1 from the frozen old-to-new.csv, records each
// rename in dam.folder_rename_log, and rewrites PopDAM's stored paths.
// Must run under `op run` with PGPASSWORD (database) and DSM_PW (edge1 `ai`
// account, used only for the snapshot) in the environment.
//
//   node tools/folder-rename/execute.mjs --db prod --match "<old_path prefix>" [--match ...] \
//     --batch-label pilot-desperate [--dry-run]
//   node tools/folder-rename/execute.mjs --db prod --revert <batch_id>
//
// Rehearsal (plan §5.2): --db preview --disk-root /volume1/mac/_folder_rename_rehearsal --no-snapshot
// renames a scratch copy of the tree instead of the real share.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DBS = {
  prod: { host: "aws-1-us-east-1.pooler.supabase.com", user: "postgres.qsllyeztdwjgirsysgai" },
  preview: { host: "aws-0-us-east-1.pooler.supabase.com", user: "postgres.mvpkijzfmfcxhnzqogzs" },
};
const NAS_HOST = "edgesynology1";
const SHARE = "mac";
const CHUNK = 20000;

/** Tables holding paths below the share root (plan step 0.4). Search documents are derived by trigger. */
export const PATH_COLUMNS = [
  { table: "public.assets", col: "relative_path", key: "id" },
  { table: "public.style_groups", col: "folder_path", key: "id" },
  { table: "public.hygiene_findings", col: "relative_path", key: "id" },
  { table: "public.tiff_optimization_queue", col: "relative_path", key: "id" },
  { table: "public.scanner_ai_ignores", col: "relative_path", key: "id" },
  { table: "public.pdf_text_samples", col: "relative_path", key: "id" },
];

export const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function args(argv) {
  const a = { match: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    if (["dry-run", "no-snapshot"].includes(k)) a[k] = true;
    else if (k === "match") a.match.push(argv[++i]);
    else a[k] = argv[++i];
  }
  return a;
}

function csvRows(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const head = lines.shift().split(",");
  return lines.map((l) => {
    const cells = [];
    let cur = "", inQ = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (inQ) {
        if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

/**
 * Turn frozen rows into in-place renames, deepest first. Each folder keeps its
 * current parent (parents are renamed later, by their own row), so the new
 * path is the parent as it is on disk when the batch runs plus the new name.
 * `currentOf` maps a frozen old path to where it is now (earlier batches).
 */
export function planSteps(rows, currentOf = (p) => p) {
  return rows
    .map((r) => {
      const oldParent = r.old_path.slice(0, r.old_path.lastIndexOf("/"));
      const parentNow = currentOf(oldParent);
      const from = `${parentNow}/${r.old_path.slice(r.old_path.lastIndexOf("/") + 1)}`;
      const to = `${parentNow}/${r.new_path.slice(r.new_path.lastIndexOf("/") + 1)}`;
      return { from, to, rule: r.rule, depth: r.old_path.split("/").length };
    })
    .filter((s) => s.from !== s.to)
    .sort((a, b) => b.depth - a.depth || a.from.localeCompare(b.from));
}

/** Apply logged renames (oldest first) to a path: where is this folder now? */
export function forwardMap(p, logRows) {
  let v = p;
  for (const r of logRows) {
    if (v === r.old_path) v = r.new_path;
    else if (v.startsWith(r.old_path + "/")) v = r.new_path + v.slice(r.old_path.length);
  }
  return v;
}

/** SQL that moves every stored path under `from` to `to`, in chunks. */
export function rewriteSql(from, to) {
  const out = [];
  for (const { table, col, key } of PATH_COLUMNS) {
    const match = `(${col} = ${q(from)} or left(${col}, ${from.length + 1}) = ${q(from + "/")})`;
    out.push(`do $$ declare n int; begin loop
  update ${table} set ${col} = ${q(to)} || substr(${col}, ${from.length + 1})
  where ${key} in (select ${key} from ${table} where ${match} limit ${CHUNK});
  get diagnostics n = row_count; exit when n = 0; end loop; end $$;`);
  }
  return out.join("\n");
}

function psql(db, sql) {
  const { host, user } = DBS[db];
  return execFileSync(
    "psql",
    [`host=${host} port=5432 user=${user} dbname=postgres sslmode=require`, "-X", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", maxBuffer: 1 << 26 },
  ).trim();
}

function ssh(cmd, input) {
  return execFileSync("ssh", [NAS_HOST, cmd], { input, encoding: "utf8", timeout: 60000 }).trim();
}

function countUnder(db, p) {
  return Number(
    psql(db, `select count(*) from public.assets where is_deleted is not true and left(relative_path, ${p.length + 1}) = ${q(p + "/")};`),
  );
}

function snapshot(label) {
  // DSM API as the `ai` administrator: create a locked snapshot of the share.
  const script = `PW=$(cat); B=http://127.0.0.1:5000/webapi/entry.cgi
SID=$(curl -s "$B" --data-urlencode api=SYNO.API.Auth --data-urlencode version=6 --data-urlencode method=login --data-urlencode account=ai --data-urlencode "passwd=$PW" --data-urlencode session=popdamsnap --data-urlencode format=sid | sed -n 's/.*"sid":"\\([^"]*\\)".*/\\1/p')
[ -z "$SID" ] && { echo LOGIN_FAILED; exit 1; }
curl -s "$B" --data-urlencode api=SYNO.Core.Share.Snapshot --data-urlencode version=1 --data-urlencode method=create --data-urlencode name=${SHARE} --data-urlencode 'snapinfo={"desc":"${label}","lock":true}' --data-urlencode _sid=$SID
curl -s "$B" --data-urlencode api=SYNO.API.Auth --data-urlencode version=6 --data-urlencode method=logout --data-urlencode session=popdamsnap --data-urlencode _sid=$SID >/dev/null`;
  const out = execFileSync("ssh", [NAS_HOST, script], { input: process.env.DSM_PW, encoding: "utf8", timeout: 60000 });
  if (!/"success":true/.test(out)) throw new Error(`snapshot failed: ${out.slice(0, 200)}`);
  return out.match(/"data":"([^"]+)"/)?.[1] ?? out.trim();
}

function log(lines, s) {
  lines.push(s);
  console.log(s);
}

async function run() {
  const a = args(process.argv);
  const db = a.db;
  if (!DBS[db]) throw new Error("--db prod|preview required");
  const diskRoot = a["disk-root"] ?? `/volume1/${SHARE}`;
  if (db === "preview" && !a["disk-root"]) throw new Error("preview runs must use a scratch --disk-root");
  const disk = (p) => `${diskRoot}/${p}`;
  const lines = [];
  const now = () => new Date().toISOString();

  if (a.revert) return revert(a, db, disk, lines);

  // Batch rows from the frozen list.
  const csv = a.csv ?? new URL("../../verification/folder-shortening/old-to-new.csv", import.meta.url).pathname;
  const rows = csvRows(csv).filter((r) => a.match.some((m) => r.old_path === m || r.old_path.startsWith(m + "/")));
  if (!rows.length) throw new Error("no rows match --match");
  const logRows = JSON.parse(
    psql(db, `select coalesce(json_agg(l order by renamed_at, id), '[]') from dam.folder_rename_log l where share = ${q(SHARE)} and reverted_at is null;`) || "[]",
  );
  const steps = planSteps(rows, (p) => forwardMap(p, logRows));
  const batchId = crypto.randomUUID();
  const label = a["batch-label"] ?? "batch";
  log(lines, `# Folder rename run ${label}\n\n- batch_id: ${batchId}\n- db: ${db}\n- disk root: ${diskRoot}\n- started: ${now()}\n- folders: ${steps.length}\n`);

  // Preconditions (all or nothing).
  const scan = JSON.parse(psql(db, `select json_build_object('auto', (select value from admin_config where key='AUTO_SCAN_CONFIG'), 'progress', (select value->>'status' from admin_config where key='SCAN_PROGRESS'));`));
  const problems = [];
  if (db === "prod" && scan.auto?.enabled) problems.push("automatic scan is still enabled (AUTO_SCAN_CONFIG)");
  if (db === "prod" && scan.progress === "running") problems.push("a scan is running");
  const top = [...new Set(steps.map((s) => s.from))];
  const checkouts = psql(
    db,
    `select count(*) from public.asset_checkouts c join public.assets x on x.id = c.asset_id where c.status = 'active' and (${top
      .map((p) => `left(x.relative_path, ${p.length + 1}) = ${q(p + "/")}`)
      .join(" or ")});`,
  );
  if (Number(checkouts) > 0) problems.push(`${checkouts} active checkout(s) inside the batch`);
  for (const s of steps) {
    const r = ssh(`[ -d ${shq(disk(s.from))} ] && echo src; [ -e ${shq(disk(s.to))} ] && echo dst; true`);
    if (!r.includes("src")) problems.push(`missing on disk: ${s.from}`);
    if (r.includes("dst")) problems.push(`target already exists: ${s.to}`);
  }
  log(lines, `## Preconditions\n\n${problems.length ? problems.map((p) => `- FAIL ${p}`).join("\n") : "- all passed (scan paused and idle, no active checkouts, sources exist, targets free)"}\n`);
  if (problems.length) throw new Error("preconditions failed; nothing changed");

  const before = Object.fromEntries(top.map((p) => [p, countUnder(db, p)]));
  if (a["dry-run"]) {
    log(lines, "## Dry run\n\n" + steps.map((s) => `- ${s.from} → ${path.basename(s.to)}`).join("\n"));
    return;
  }

  if (!a["no-snapshot"]) {
    const snap = snapshot(`pre-folder-rename-${label}-${batchId.slice(0, 8)}`);
    log(lines, `## Snapshot\n\n- locked snapshot of share ${SHARE}: ${snap}\n`);
  }

  log(lines, "## Renames (deepest first)\n");
  for (const s of steps) {
    const r = ssh(`mv -n ${shq(disk(s.from))} ${shq(disk(s.to))} && [ ! -e ${shq(disk(s.from))} ] && [ -d ${shq(disk(s.to))} ] && echo ok`);
    if (r !== "ok") throw new Error(`rename failed for ${s.from}; batch ${batchId} stopped, revert with --revert`);
    const at = now();
    try {
      psql(db, `begin;
set local statement_timeout = '20min';
insert into dam.folder_rename_log (share, old_path, new_path, renamed_at, batch_id, rule)
values (${q(SHARE)}, ${q(s.from)}, ${q(s.to)}, ${q(at)}, ${q(batchId)}, ${q(s.rule)});
${rewriteSql(s.from, s.to)}
commit;`);
    } catch (e) {
      ssh(`mv -n ${shq(disk(s.to))} ${shq(disk(s.from))}`);
      throw new Error(`database update failed for ${s.from}; that folder was renamed back. ${e.message}`);
    }
    log(lines, `- ${at} ${s.from} → ${path.basename(s.to)} (${s.rule})`);
  }

  // Postconditions.
  log(lines, "\n## Postconditions\n");
  const finalOf = (p) => forwardMap(p, steps.map((s) => ({ old_path: s.from, new_path: s.to })));
  let ok = true;
  for (const p of top) {
    const np = finalOf(p);
    const after = countUnder(db, np);
    const left = countUnder(db, p);
    const good = after === before[p] && left === 0;
    ok &&= good;
    log(lines, `- ${good ? "ok" : "FAIL"} ${p}: ${before[p]} assets before, ${after} under new name, ${left} left under old`);
  }
  const sample = psql(
    db,
    `select relative_path from public.assets where is_deleted is not true and (${top
      .map((p) => `left(relative_path, ${finalOf(p).length + 1}) = ${q(finalOf(p) + "/")}`)
      .join(" or ")}) order by random() limit 20;`,
  ).split("\n").filter(Boolean);
  const missing = sample.filter((p) => ssh(`[ -e ${shq(disk(p))} ] && echo y || echo n`) !== "y");
  ok &&= missing.length === 0;
  log(lines, `- ${missing.length ? "FAIL" : "ok"} ${sample.length} sampled files exist at their new location${missing.length ? `; missing: ${missing.join("; ")}` : ""}`);
  log(lines, `\n- finished: ${now()}\n- result: ${ok ? "OK" : "PROBLEMS — see above"}`);
  writeRunLog(label, batchId, lines);
  if (!ok) process.exitCode = 1;
}

function revert(a, db, disk, lines) {
  const batchId = a.revert;
  const rows = JSON.parse(
    psql(db, `select coalesce(json_agg(l order by renamed_at desc, id desc), '[]') from dam.folder_rename_log l where batch_id = ${q(batchId)} and reverted_at is null;`) || "[]",
  );
  log(lines, `# Revert of batch ${batchId}\n\n- db: ${db}\n- folders: ${rows.length}\n`);
  for (const r of rows) {
    const ok = ssh(`mv -n ${shq(disk(r.new_path))} ${shq(disk(r.old_path))} && [ -d ${shq(disk(r.old_path))} ] && echo ok`);
    if (ok !== "ok") throw new Error(`revert rename failed for ${r.new_path}`);
    psql(db, `begin;
set local statement_timeout = '20min';
${rewriteSql(r.new_path, r.old_path)}
update dam.folder_rename_log set reverted_at = now() where id = ${Number(r.id)};
commit;`);
    log(lines, `- ${r.new_path} → ${path.basename(r.old_path)}`);
  }
  writeRunLog(`revert-${a["batch-label"] ?? "batch"}`, batchId, lines);
}

function writeRunLog(label, batchId, lines) {
  const out = new URL(`../../verification/folder-shortening/run-${label}-${batchId.slice(0, 8)}.md`, import.meta.url).pathname;
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`run log: ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.length > 2) {
  run().catch((e) => {
    console.error(`STOPPED: ${e.message}`);
    process.exit(1);
  });
}
