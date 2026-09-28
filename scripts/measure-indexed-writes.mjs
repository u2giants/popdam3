#!/usr/bin/env node
// Opt-in, read-only #169 observer. Never run a workload or store row data in Git.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, realpath, lstat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import Cursor from "pg-cursor";
import { assessWindow, compareSortedRows, normalizeIndexInventory, summarizeResultReceipt } from "./lib/indexed-write-measurement.mjs";

const PROJECT_REF = "qsllyeztdwjgirsysgai";
const TABLES = {
  "public.assets": ["id"],
  "public.dam_search_documents": ["document_type", "entity_id"],
  "public.style_guide_files": ["id"],
  "plm.style_tracker_item_bridge": ["id"],
};
const DEFAULT_MAX_ROWS = 500_000;
const BATCH_SIZE = 500;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SCRIPT_DIR, "..");

function parseArgs(argv) {
  const [action, ...tokens] = argv;
  if (!["before", "after"].includes(action)) throw new Error("expected before or after");
  const options = {};
  for (let i = 0; i < tokens.length; i += 2) {
    const key = tokens[i];
    if (!key?.startsWith("--") || i + 1 >= tokens.length || options[key.slice(2)]) throw new Error("invalid arguments");
    options[key.slice(2)] = tokens[i + 1];
  }
  if (!options.dir || (action === "before" && !TABLES[options.table]) ||
      (action === "after" && !options.operation)) throw new Error("missing required argument");
  const maxRows = options["max-rows"] === undefined ? DEFAULT_MAX_ROWS : Number(options["max-rows"]);
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 2_000_000) throw new Error("invalid row bound");
  return { action, ...options, maxRows };
}

async function protectedDirectory(path, create) {
  const absolute = resolve(path);
  if (absolute === REPO_DIR || !relative(REPO_DIR, absolute).startsWith("..")) {
    throw new Error("scratch directory must be outside the repository");
  }
  if (create) await mkdir(absolute, { recursive: true, mode: 0o700 });
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error("scratch directory must be owned by this user with mode 0700");
  }
  if (await realpath(absolute) !== absolute) throw new Error("scratch directory contains a symlink");
  return absolute;
}

async function readProtectedJson(path) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error("input file must be private, owned by this user, and mode 0600");
  }
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function protectedFileHash(path) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error("receipt file must be private, owned by this user, and mode 0600");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  return hash.digest("hex");
}

async function writePrivateJson(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); }
  finally { await file.close(); }
}

export function requireReadOnlyUrl(raw, ca) {
  if (!raw) throw new Error("POP_MEASURE_READONLY_DATABASE_URL is required");
  if (typeof ca !== "string" || !ca.includes("-----BEGIN CERTIFICATE-----") ||
      !ca.includes("-----END CERTIFICATE-----")) throw new Error("verified Supabase CA certificate is required");
  let url;
  try { url = new URL(raw); } catch { throw new Error("database URL is invalid"); }
  const host = "aws-1-us-east-1.pooler.supabase.com";
  const poolerUser = `supabase_read_only_user.${PROJECT_REF}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== host ||
      decodeURIComponent(url.username) !== poolerUser || !url.password ||
      url.pathname !== "/postgres" || (url.port && url.port !== "5432") ||
      url.search || url.hash) {
    throw new Error("database URL must use the exact production host, read-only role, and database");
  }
  return { host, port: 5432, user: poolerUser, password: decodeURIComponent(url.password),
    database: "postgres", ssl: { ca, rejectUnauthorized: true, servername: host } };
}

const INVENTORY_SQL = `
  WITH indexes AS (
    SELECT i.indexrelid, i.indrelid, i.indkey, c.relname AS index_name,
      pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = $1::regclass
  )
  SELECT x.index_name, x.definition,
    array_agg(DISTINCT a.attname ORDER BY a.attname) FILTER (WHERE a.attname IS NOT NULL) AS columns
  FROM indexes x
  LEFT JOIN LATERAL (
    SELECT k.attnum::smallint AS attnum FROM unnest(x.indkey) AS k(attnum) WHERE k.attnum > 0
    UNION
    SELECT d.refobjsubid::smallint FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = x.indexrelid
      AND d.refobjid = x.indrelid AND d.refobjsubid > 0
  ) dep ON true
  LEFT JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = dep.attnum
  GROUP BY x.index_name, x.definition ORDER BY x.index_name`;

const STATS_SQL = `
  SELECT current_database() AS database_name, current_user AS role_name,
    session_user AS session_role, current_setting('transaction_read_only') AS read_only,
    pg_postmaster_start_time()::text AS server_started_at,
    (SELECT stats_reset::text FROM pg_stat_bgwriter) AS bgwriter_reset_at,
    (SELECT stats_reset::text FROM pg_stat_database WHERE datname = current_database()) AS database_reset_at,
    s.n_tup_ins::text, s.n_tup_upd::text, s.n_tup_hot_upd::text,
    s.n_tup_newpage_upd::text
  FROM pg_stat_user_tables s WHERE s.relid = $1::regclass`;

async function capture(client, table, path, maxRows, CursorClass) {
  const startedAt = new Date().toISOString();
  const keys = TABLES[table];
  const primary = await client.query(`
    SELECT array_agg(a.attname ORDER BY k.ordinality) AS columns
    FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = $1::regclass AND c.contype = 'p'`, [table]);
  if (JSON.stringify(primary.rows[0]?.columns) !== JSON.stringify(keys)) throw new Error("primary key changed");
  const inventory = normalizeIndexInventory((await client.query(INVENTORY_SQL, [table])).rows);
  const statsRows = (await client.query(STATS_SQL, [table])).rows;
  if (statsRows.length !== 1 || statsRows[0].database_name !== "postgres" ||
      statsRows[0].role_name !== "supabase_read_only_user" ||
      statsRows[0].session_role !== "supabase_read_only_user" || statsRows[0].read_only !== "on") {
    throw new Error("production read-only target identity was not proved");
  }
  const { database_name, role_name, session_role, read_only, ...statValues } = statsRows[0];
  const quotedTable = table.split(".").map((part) => `"${part}"`).join(".");
  const quote = (column) => `"${column.replaceAll('"', '""')}"`;
  const keyExpr = `jsonb_build_array(${keys.map((column) => `t.${quote(column)}`).join(", ")})::text`;
  const valuesExpr = `jsonb_build_object(${inventory.columns.map((column) => `'${column.replaceAll("'", "''")}', t.${quote(column)}`).join(", ")})::text`;
  const sql = `SELECT ${keyExpr} AS id, t.xmin::text AS version, ${valuesExpr} AS values
    FROM ${quotedTable} t ORDER BY id COLLATE "C"`;
  const file = await open(path, "wx", 0o600);
  const digest = createHash("sha256");
  let rowCount = 0;
  const cursor = client.query(new CursorClass(sql));
  try {
    while (true) {
      const rows = await cursor.read(BATCH_SIZE);
      if (rows.length === 0) break;
      rowCount += rows.length;
      if (rowCount > maxRows) throw new Error("row bound exceeded");
      const chunk = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      digest.update(chunk);
      await file.write(chunk);
    }
  } finally {
    await cursor.close();
    await file.close();
  }
  return { table, project_ref: PROJECT_REF, started_at: startedAt, finished_at: new Date().toISOString(),
    inventory, stats: { table, project_ref: PROJECT_REF, table_reset_at: null, ...statValues },
    row_count: rowCount, rows_sha256: digest.digest("hex") };
}

async function* rowsFrom(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) throw new Error("snapshot contains an empty row");
    yield JSON.parse(line);
  }
}

async function verifyRows(path, expected) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error("snapshot row file is not private");
  }
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  if (hash.digest("hex") !== expected.rows_sha256) throw new Error("snapshot row file changed");
}

export async function main(argv, { Client = pg.Client, CursorClass = Cursor,
  environment = process.env, log = console.log } = {}) {
  const options = parseArgs(argv);
  const directory = await protectedDirectory(options.dir, options.action === "before");
  const table = options.action === "before" ? options.table :
    (await readProtectedJson(resolve(directory, "before.json"))).table;
  if (!TABLES[table]) throw new Error("captured table is unsupported");
  if (!environment.POP_MEASURE_SUPABASE_CA_FILE) throw new Error("Supabase CA certificate path is required");
  const ca = await readFile(environment.POP_MEASURE_SUPABASE_CA_FILE, "utf8");
  const connection = requireReadOnlyUrl(environment.POP_MEASURE_READONLY_DATABASE_URL, ca);
  const client = new Client({ ...connection, application_name: "popdam169_read_only_measurement",
    statement_timeout: 120_000, query_timeout: 130_000 });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const label = options.action;
    const metadata = await capture(client, table, resolve(directory, `${label}.rows.ndjson`), options.maxRows, CursorClass);
    await client.query("COMMIT");
    transactionOpen = false;
    await writePrivateJson(resolve(directory, `${label}.json`), metadata);
    if (label === "after") {
      const before = await readProtectedJson(resolve(directory, "before.json"));
      await verifyRows(resolve(directory, "before.rows.ndjson"), before);
      await verifyRows(resolve(directory, "after.rows.ndjson"), metadata);
      const operation = await readProtectedJson(options.operation);
      if (!operation.result_receipt_path || !operation.single_writer_receipt_path ||
          await protectedFileHash(operation.result_receipt_path) !== operation.result_receipt_sha256 ||
          await protectedFileHash(operation.single_writer_receipt_path) !== operation.single_writer_receipt_sha256) {
        throw new Error("operation receipts are missing or changed");
      }
      const receipt = await readProtectedJson(operation.result_receipt_path);
      const receiptCounts = summarizeResultReceipt(receipt, { table, path: operation.path,
        afterBefore: before.finished_at, beforeAfter: metadata.started_at });
      if (Number(operation.attempted_rows) !== receiptCounts.attempted_rows ||
          Number(operation.succeeded_rows) !== receiptCounts.succeeded_rows) {
        throw new Error("operation counts do not match the result receipt");
      }
      const counts = await compareSortedRows(rowsFrom(resolve(directory, "before.rows.ndjson")),
        rowsFrom(resolve(directory, "after.rows.ndjson")));
      const report = assessWindow({ before, after: metadata, counts, operation });
      await writePrivateJson(resolve(directory, "report.json"), report);
      log("Internally consistent aggregate report written; independent receipt review is still required.");
    } else log("Private before snapshot captured. Run only an independently authorized workload before after capture.");
  } finally {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    }
    try { await client.end(); } catch { /* Preserve the original failure. */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    // Never echo a provider error, a row, an identifier, or a credential.
    const safe = /^(expected|invalid|missing|scratch|input|captured|primary key|no indexes|index |duplicate|row bound|production read-only|target or|statistics|n_tup_|operation|repeated|succeeded|updated row|snapshot|a captured|before snapshot|after snapshot|indexed value)/.test(error.message);
    console.error(safe ? error.message : "measurement failed; no conclusive report was produced");
    process.exitCode = 1;
  });
}
