/** One bounded transaction; caller owns target proof, coordinator release and the durable journal. */
import { createHash } from "node:crypto";
import {
  stable,
  hasReceipt,
  verifyPreimage,
  appendPayload,
  timestampRow,
  timestampInputs,
  pgTimestamp,
} from "./relink-existing-ai-characters-safety.mjs";
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
const resolverInputs = (value) => ({
  ...value,
  readInputs: value?.readInputs?.map((row) => ({
    ...row,
    data: Array.isArray(row.data)
      ? row.data
          .map(stable)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : row.data,
  })),
});
export async function atomicAssetRelink({
  connection: c,
  entries,
  resolve,
  persist,
  openFreshReader,
  timestampColumns = {},
  apply = false,
  hooks = {},
}) {
  const expected = entries[0].preimage,
    assetId = expected.asset.id,
    payload = entries.map(appendPayload);
  const record = {
    assetId,
    preimage: expected,
    groupPreimage: entries[0].groupPreimage,
    characters: entries.map((row) => row.character),
    payload,
    phase: "intent",
  };
  try {
    persist(record);
  } catch (error) {
    throw Object.assign(error, {
      stopExecution: true,
      relinkCommitState: "intent_not_saved",
    });
  } // Before BEGIN or any lock/write.
  let begun = false,
    commitAttempted = false,
    committed = false,
    fresh = null;
  if (typeof openFreshReader !== "function")
    throw Error("Independent fresh read-only connection required");
  const emit = (phase, extra = {}) => {
    Object.assign(record, extra, { phase });
    try {
      persist(record);
    } catch (error) {
      throw Object.assign(error, { stopExecution: true });
    }
  };
  try {
    fresh = await openFreshReader();
    await c.query("begin isolation level serializable");
    begun = true;
    await c.query(
      "set local time zone 'UTC';set local lock_timeout='500ms';set local statement_timeout='2500ms';set local transaction_timeout='3s';set local idle_in_transaction_session_timeout='3s'",
    );
    await hooks.beforeLocks?.();
    await c.query("select pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'))");
    const config = await c.query(
      "select value from public.admin_config where key='BULK_OPERATIONS' for share",
    );
    if (config.rows.length !== 1)
      throw Error("Operation ownership unavailable");
    const operations =
      typeof config.rows[0].value === "string"
        ? JSON.parse(config.rows[0].value)
        : config.rows[0].value;
    if (hasReceipt(operations, assetId))
      throw Error("Protected external receipt");
    await hooks.beforeTaxonomyLocks?.();
    // These brief locks also prevent new alias/identity/scope phantoms.
    await c.query(
      "lock table core.character,core.character_alias,core.licensor,core.property in share mode",
    );
    await hooks.beforeAssetLocks?.();
    const asset = await c.query(
      "select to_jsonb(a) row from public.assets a where id=$1 for update",
      [assetId],
    );
    if (asset.rows.length !== 1) throw Error("Asset missing");
    const current = { asset: asset.rows[0].row };
    for (const [key, table] of [
      ["tags", "asset_tags"],
      ["links", "asset_licensor_characters"],
      ["legacy", "asset_characters"],
    ]) {
      const r = await c.query(
        `select to_jsonb(r) row from public.${table} r where asset_id=$1 for update`,
        [assetId],
      );
      current[key] = r.rows.map((r) => r.row);
    }
    let group = null;
    if (current.asset.style_group_id) {
      const r = await c.query(
        "select to_jsonb(g) row from public.style_groups g where id=$1 for share",
        [current.asset.style_group_id],
      );
      if (r.rows.length !== 1) throw Error("Group missing");
      group = r.rows[0].row;
    }
    await hooks.afterLocks?.();
    verifyPreimage(expected, current, operations, timestampColumns);
    if (
      !same(
        timestampRow(group, timestampColumns.group),
        timestampRow(entries[0].groupPreimage, timestampColumns.group),
      )
    )
      throw Error("Changed group preimage");
    if (current.asset.is_deleted) throw Error("Deleted asset");
    const resolverProof = await resolve(c, current.asset, entries);
    emit("locked_inputs_verified", { resolverProof });
    await fresh.query("begin isolation level read committed read only");
    await fresh.query(
      "set local time zone 'UTC';set local lock_timeout='500ms';set local statement_timeout='2500ms';set local transaction_timeout='3s'",
    );
    const freshView = {};
    for (const [key, table, col] of [
      ["asset", "assets", "id"],
      ["tags", "asset_tags", "asset_id"],
      ["links", "asset_licensor_characters", "asset_id"],
      ["legacy", "asset_characters", "asset_id"],
    ]) {
      const response = await fresh.query(
        `select to_jsonb(r) row from public.${table} r where ${col}=$1`,
        [assetId],
      );
      freshView[key] =
        key === "asset"
          ? response.rows[0]?.row
          : response.rows.map((row) => row.row);
    }
    let freshGroup = null;
    if (freshView.asset?.style_group_id) {
      const response = await fresh.query(
        "select to_jsonb(g) row from public.style_groups g where id=$1",
        [freshView.asset.style_group_id],
      );
      freshGroup = response.rows[0]?.row;
    }
    const freshConfig = await fresh.query(
      "select value from public.admin_config where key='BULK_OPERATIONS'",
    );
    if (freshConfig.rows.length !== 1)
      throw Error("Fresh operation ownership unavailable");
    const freshOperations =
      typeof freshConfig.rows[0].value === "string"
        ? JSON.parse(freshConfig.rows[0].value)
        : freshConfig.rows[0].value;
    const freshResolverProof = await resolve(fresh, freshView.asset, entries);
    emit("fresh_inputs_read", {
      freshView,
      freshGroup,
      freshOperationsSha256: digest(freshOperations),
      ownedOperationsSha256: digest(operations),
      freshResolverProof,
    });
    verifyPreimage(expected, freshView, freshOperations, timestampColumns);
    if (
      !same(
        timestampInputs(current, timestampColumns),
        timestampInputs(freshView, timestampColumns),
      ) ||
      !same(
        timestampRow(group, timestampColumns.group),
        timestampRow(freshGroup, timestampColumns.group),
      ) ||
      digest(operations) !== digest(freshOperations) ||
      !same(resolverInputs(resolverProof), resolverInputs(freshResolverProof))
    )
      throw Error("Fresh current input diverges from serializable snapshot");
    await fresh.query("rollback");
    emit("fresh_inputs_verified");
    await hooks.beforeInsert?.();
    if (!apply) {
      await c.query("rollback");
      begun = false;
      emit("dry_run_rolled_back");
      return record;
    }
    const inserted = [];
    for (const row of payload) {
      const response = await c.query(
        "insert into public.asset_licensor_characters(asset_id,character_id,source,model,tagged_at) values($1,$2,$3,$4,$5) returning to_jsonb(asset_licensor_characters) row",
        [row.asset_id, row.character_id, row.source, row.model, row.tagged_at],
      );
      inserted.push(...response.rows.map((r) => r.row));
      emit("inserted_uncommitted", { inserted: [...inserted] });
    }
    await hooks.afterInsert?.();
    const post = {};
    const rawPostReads = [];
    for (const [key, table, identity] of [
      ["asset", "assets", "id"],
      ["tags", "asset_tags", "asset_id"],
      ["links", "asset_licensor_characters", "asset_id"],
      ["legacy", "asset_characters", "asset_id"],
    ]) {
      try {
        await hooks.beforePostRead?.(key);
        const response = await c.query(
          `select to_jsonb(r) row from public.${table} r where ${identity}=$1`,
          [assetId],
        );
        rawPostReads.push({ key, status: "fulfilled", response });
        post[key] =
          key === "asset"
            ? response.rows[0]?.row
            : response.rows.map((r) => r.row);
      } catch (error) {
        rawPostReads.push({
          key,
          status: "rejected",
          error: { code: error.code ?? error.name },
        });
      }
      emit("raw_postreads_uncommitted", { rawPostReads: [...rawPostReads] });
    }
    if (rawPostReads.some((r) => r.status !== "fulfilled"))
      throw Error("Unverified post-read; rollback required");
    verifyPreimage(
      { ...expected, links: [...expected.links, ...inserted] },
      post,
      {},
      timestampColumns,
    );
    if (
      inserted.length !== payload.length ||
      inserted.some(
        (row, i) =>
          !same(
            { ...row, tagged_at: pgTimestamp(row.tagged_at) },
            { ...payload[i], tagged_at: pgTimestamp(payload[i].tagged_at) },
          ),
      )
    )
      throw Error("Exact append postcondition failed");
    emit("preservation_verified_uncommitted", { post });
    await hooks.beforeCommit?.();
    emit("commit_intent");
    commitAttempted = true;
    await c.query("commit");
    begun = false;
    committed = true;
    emit("commit_confirmed");
    return record;
  } catch (error) {
    if (committed) {
      try {
        emit("committed_journal_failure", {
          error: { code: error.code ?? error.name },
        });
      } catch {}
      throw Object.assign(error, {
        relinkCommitState: "committed_journal_failure",
      });
    }
    if (commitAttempted) {
      try {
        emit("commit_unconfirmed", {
          error: { code: error.code ?? error.name },
          requiresPointRead: true,
        });
      } catch {}
      throw Object.assign(error, {
        relinkCommitState: "unconfirmed",
        requiresPointRead: true,
      });
    }
    let rolledBack = false;
    if (begun)
      try {
        await c.query("rollback");
        rolledBack = true;
      } catch {}
    try {
      emit(
        rolledBack ? "rollback_confirmed" : "transaction_ended_without_commit",
        {
          error: { code: error.code ?? error.name, message: error.message },
          requiresPointRead: !rolledBack,
        },
      );
    } catch {}
    throw Object.assign(error, {
      relinkCommitState: rolledBack ? "rolled_back" : "no_commit_attempted",
      requiresPointRead: !rolledBack,
    });
  } finally {
    if (fresh) {
      try {
        await fresh.end();
      } catch (error) {
        fresh.connection?.stream?.destroy();
        try {
          emit("fresh_connection_close_error", {
            freshCloseError: { code: error.code ?? error.name },
          });
        } catch {}
        throw Object.assign(error, {
          stopExecution: true,
          relinkCommitState: committed
            ? "committed_fresh_close_error"
            : "reader_close_error",
          requiresPointRead: commitAttempted && !committed,
        });
      }
    }
  }
}
