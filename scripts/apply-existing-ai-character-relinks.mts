/** Production defaults to read-only. Only root may release the exact reviewed native packet hash. */
import pg from "pg";
import {
  readFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { atomicAssetRelink } from "./atomic-ai-character-relink.mjs";
import { resolveNativeEntries } from "./resolve-native-ai-characters.mts";
import {
  verifyPreimage,
  hasReceipt,
  stable,
  timestampRow,
} from "./relink-existing-ai-characters-safety.mjs";
const [manifestFile, journalFile, reviewedSha] = process.argv.slice(2);
if (!manifestFile || !journalFile)
  throw Error("Private manifest and create-only journal required");
const raw = readFileSync(manifestFile, "utf8"),
  sha = createHash("sha256").update(raw).digest("hex"),
  packet = JSON.parse(raw);
const target = "qsllyeztdwjgirsysgai";
if (
  packet.target !== `https://${target}.supabase.co` ||
  !process.env.PGPASSWORD
)
  throw Error("Protected production target/credential required");
const apply = reviewedSha !== undefined;
if (apply && reviewedSha !== sha)
  throw Error("Exact root-reviewed manifest hash required");
const descriptor = openSync(journalFile, "wx", 0o600);
function persist(event: any) {
  writeSync(
    descriptor,
    JSON.stringify({
      observedAt: new Date().toISOString(),
      manifestSha256: sha,
      ...event,
    }) + "\n",
  );
  fsyncSync(descriptor);
}
const c = new pg.Client({
  host: "aws-1-us-east-1.pooler.supabase.com",
  port: 6543,
  user: "postgres." + target,
  database: "postgres",
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
c.on("error", (error: any) => {
  try {
    persist({
      phase: "native_connection_error",
      error: { code: error.code ?? error.name },
    });
  } catch {}
});
const groups = new Map<string, any[]>();
for (const row of packet.manifest) {
  const rows = groups.get(row.assetId) ?? [];
  rows.push(row);
  groups.set(row.assetId, rows);
}
const counts: Record<string, number> = {};
try {
  await c.connect();
  if (
    c.connectionParameters.host !== "aws-1-us-east-1.pooler.supabase.com" ||
    c.connectionParameters.user !== "postgres." + target ||
    c.connectionParameters.port !== 6543
  )
    throw Error("Native destination mismatch");
  const proof = await c.query(
    "select current_database() db,current_user username,current_setting('server_version_num') version",
  );
  if (
    proof.rows[0].db !== "postgres" ||
    +proof.rows[0].version < 170000 ||
    +proof.rows[0].version >= 180000
  )
    throw Error("Expected production PostgreSQL17 target unavailable");
  persist({ phase: "target_proved", target, apply, proof: proof.rows });
  const columnTypes = await c.query(
    "select table_name,column_name from information_schema.columns where table_schema in('public','core') and table_name in('assets','asset_tags','asset_licensor_characters','asset_characters','style_groups','character') and data_type='timestamp with time zone'",
  );
  const names: any = {
      assets: "asset",
      asset_tags: "tags",
      asset_licensor_characters: "links",
      asset_characters: "legacy",
      style_groups: "group",
      character: "character",
    },
    timestampColumns: any = {};
  for (const row of columnTypes.rows)
    (timestampColumns[names[row.table_name]] ??= []).push(row.column_name);
  const resolve = (connection: any, asset: any, entries: any[]) =>
    resolveNativeEntries(connection, asset, entries, timestampColumns);
  for (const [assetId, entries] of groups) {
    if (apply) {
      try {
        await atomicAssetRelink({
          connection: c,
          entries,
          resolve,
          persist,
          timestampColumns,
          openFreshReader: async () => {
            const reader = new pg.Client({
              host: "aws-1-us-east-1.pooler.supabase.com",
              port: 6543,
              user: "postgres." + target,
              database: "postgres",
              password: process.env.PGPASSWORD,
              ssl: { rejectUnauthorized: false },
              connectionTimeoutMillis: 10000,
            });
            reader.on("error", () => {});
            try {
              await reader.connect();
              return reader;
            } catch (error) {
              await reader.end().catch(() => {});
              throw error;
            }
          },
          apply: true,
        });
        counts.committed = (counts.committed ?? 0) + 1;
      } catch (error: any) {
        if (
          error.stopExecution ||
          error.requiresPointRead ||
          error.relinkCommitState === "committed_journal_failure"
        )
          throw error;
        counts.abstained = (counts.abstained ?? 0) + 1;
      }
    } else {
      persist({
        phase: "read_only_intent",
        assetId,
        preimage: entries[0].preimage,
      });
      try {
        await c.query("begin read only");
        await c.query(
          "set local time zone 'UTC';set local statement_timeout='2500ms';set local transaction_timeout='3s'",
        );
        const current: any = {};
        for (const [key, table, col] of [
          ["asset", "assets", "id"],
          ["tags", "asset_tags", "asset_id"],
          ["links", "asset_licensor_characters", "asset_id"],
          ["legacy", "asset_characters", "asset_id"],
        ]) {
          const r = await c.query(
            `select to_jsonb(r) row from public.${table} r where ${col}=$1`,
            [assetId],
          );
          current[key] =
            key === "asset" ? r.rows[0]?.row : r.rows.map((r) => r.row);
        }
        const ops = await c.query(
          "select value from admin_config where key='BULK_OPERATIONS'",
        );
        if (ops.rows.length !== 1)
          throw Error("Operation ownership unavailable");
        const value = ops.rows[0].value,
          operations = typeof value === "string" ? JSON.parse(value) : value;
        verifyPreimage(
          entries[0].preimage,
          current,
          operations,
          timestampColumns,
        );
        if (current.asset.style_group_id) {
          const group = await c.query(
            "select to_jsonb(g) row from style_groups g where id=$1",
            [current.asset.style_group_id],
          );
          if (
            JSON.stringify(
              stable(timestampRow(group.rows[0]?.row, timestampColumns.group)),
            ) !==
            JSON.stringify(
              stable(
                timestampRow(entries[0].groupPreimage, timestampColumns.group),
              ),
            )
          )
            throw Error("Changed group preimage");
        }
        const resolverProof = await resolve(c, current.asset, entries);
        await c.query("rollback");
        persist({ phase: "read_only_ready", assetId, resolverProof });
        counts.ready = (counts.ready ?? 0) + 1;
      } catch (error: any) {
        try {
          await c.query("rollback");
        } catch {}
        persist({
          phase: "read_only_abstained",
          assetId,
          error: { code: error.code ?? error.name, message: error.message },
        });
        counts.abstained = (counts.abstained ?? 0) + 1;
      }
    }
  }
  persist({ phase: "completed", apply, counts });
  console.log(JSON.stringify({ apply, manifestSha256: sha, counts }));
} catch (error: any) {
  try {
    persist({
      phase: "execution_stopped",
      commitState: error.relinkCommitState ?? "not_attempted",
      requiresPointRead: !!error.requiresPointRead,
      error: { code: error.code ?? error.name },
    });
  } catch {}
  console.error(
    JSON.stringify({
      executionStopped: true,
      commitState: error.relinkCommitState ?? "not_attempted",
      requiresPointRead: !!error.requiresPointRead,
    }),
  );
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
  closeSync(descriptor);
}
