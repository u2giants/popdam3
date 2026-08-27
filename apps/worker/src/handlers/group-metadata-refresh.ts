/**
 * Safe Style Group metadata refresh (op key: "refresh-group-metadata").
 *
 * This REPLACES the legacy tag-propagation behavior, which copied one "primary"
 * asset's tags, characters, and identity onto every sibling in the group. That
 * gave a technical drawing a photograph's view and colours. The user-facing
 * capability — "make this group's shared facts current" — is preserved; only the
 * mechanism changes.
 *
 * What a refresh does:
 *   1. Re-derives the group's authoritative product facts from the Style Group's
 *      own columns and reconciles them through the governed RPC, so a stale row
 *      from an earlier run is cleared.
 *   2. Rebuilds the group's search document so members stay findable by shared
 *      product and property terms.
 *
 * What a refresh must NEVER do: touch `assets`, `asset_tags`, `asset_characters`,
 * or any asset identity column. Group facts stay physically on the group.
 */

import { db } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";
import {
  AUTHORITATIVE_TAG_MODEL,
  AUTHORITATIVE_TAG_SOURCE,
  authoritativeTagsAreCurrent,
  deriveAuthoritativeGroupTags,
} from "../tagging-metadata-policy.js";
import type { GroupProfileRpcClient, GroupTagWrite } from "./ai-style-group-profile.js";

export { authoritativeTagsAreCurrent };

const DEFAULT_REFRESH_BATCH_SIZE = 200;
const SEARCH_REFRESH_CHUNK = 200;

export const LEGACY_PROPAGATION_OP_KEY = "propagate-group-tags";
export const REFRESH_GROUP_METADATA_OP_KEY = "refresh-group-metadata";
export const LEGACY_PROPAGATION_DEPRECATION =
  "propagate-group-tags is deprecated: it now runs the safe group-metadata refresh and never copies tags between files. Use refresh-group-metadata.";

export type RefreshGroupRow = {
  id: string;
  product_category: string | null;
  group_ai_description: string | null;
  group_ai_description_source: string | null;
  group_ai_description_model: string | null;
  group_ai_evidence_asset_ids: string[] | null;
  group_ai_tagged_at: string | null;
};

export type StoredAuthoritativeTag = { style_group_id: string; tag: string; category: string; status: string };

export interface RefreshDependencies {
  client?: GroupProfileRpcClient;
  fetchGroups?: (options: { cursor: string | null; limit: number; groupIds: string[] | null }) => Promise<RefreshGroupRow[]>;
  fetchAuthoritativeTags?: (groupIds: string[]) => Promise<StoredAuthoritativeTag[]>;
  restoreProvenance?: (groupId: string, group: RefreshGroupRow) => Promise<void>;
  batchSize?: number;
}

export function deriveRefreshTags(group: RefreshGroupRow): GroupTagWrite[] {
  return deriveAuthoritativeGroupTags(group as unknown as Record<string, unknown>).map((row) => ({
    tag: row.tag as string,
    category: row.category as string,
    status: "active" as const,
    confidence: 1,
    evidence: row.evidence as Record<string, unknown>,
  }));
}

/**
 * The governed RPC always rewrites the group's `group_ai_description*` columns
 * with the source and model it was called under. A refresh passes the existing
 * description straight back, so the TEXT is safe — but calling it as
 * `authoritative` would relabel an AI-written summary as derived. When the group
 * carried a different provenance beforehand, restore those columns afterwards.
 */
export function needsProvenanceRestore(group: RefreshGroupRow): boolean {
  if (!group.group_ai_description) return false;
  const source = group.group_ai_description_source;
  const model = group.group_ai_description_model;
  if (!source && !model) return false;
  return source !== AUTHORITATIVE_TAG_SOURCE || (model ?? AUTHORITATIVE_TAG_MODEL) !== AUTHORITATIVE_TAG_MODEL;
}

const GROUP_COLUMNS =
  "id, product_category, group_ai_description, group_ai_description_source, " +
  "group_ai_description_model, group_ai_evidence_asset_ids, group_ai_tagged_at";

async function defaultFetchGroups(options: { cursor: string | null; limit: number; groupIds: string[] | null }): Promise<RefreshGroupRow[]> {
  const client = db();
  let query = client.from("style_groups").select(GROUP_COLUMNS).order("id", { ascending: true }).limit(options.limit);
  if (options.groupIds?.length) query = query.in("id", options.groupIds);
  if (options.cursor) query = query.gt("id", options.cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Style group refresh fetch failed: ${error.message}`);
  return (data ?? []) as unknown as RefreshGroupRow[];
}

async function defaultFetchAuthoritativeTags(groupIds: string[]): Promise<StoredAuthoritativeTag[]> {
  if (!groupIds.length) return [];
  const client = db();
  const { data, error } = await client
    .from("style_group_tags")
    .select("style_group_id, tag, category, status")
    .in("style_group_id", groupIds)
    .eq("source", AUTHORITATIVE_TAG_SOURCE);
  if (error) throw new Error(`Authoritative group tag read failed: ${error.message}`);
  return (data ?? []) as unknown as StoredAuthoritativeTag[];
}

async function defaultRestoreProvenance(groupId: string, group: RefreshGroupRow): Promise<void> {
  const client = db();
  const { error } = await client
    .from("style_groups")
    .update({
      group_ai_description_source: group.group_ai_description_source,
      group_ai_description_model: group.group_ai_description_model,
      group_ai_evidence_asset_ids: group.group_ai_evidence_asset_ids ?? [],
      // Restored too, or a successful refresh leaves a group_ai summary carrying
      // a refresh timestamp — internally inconsistent provenance.
      group_ai_tagged_at: group.group_ai_tagged_at,
    })
    .eq("id", groupId);
  if (error) throw new Error(`Group provenance restore failed: ${error.message}`);
}

export async function handleRefreshGroupMetadata(
  opState: OpState,
  dependencies: RefreshDependencies = {},
): Promise<BatchResult> {
  const client = dependencies.client ?? (db() as unknown as GroupProfileRpcClient);
  const fetchGroups = dependencies.fetchGroups ?? defaultFetchGroups;
  const fetchAuthoritativeTags = dependencies.fetchAuthoritativeTags ?? defaultFetchAuthoritativeTags;
  const restoreProvenance = dependencies.restoreProvenance ?? defaultRestoreProvenance;
  const limit = Math.max(1, dependencies.batchSize ?? DEFAULT_REFRESH_BATCH_SIZE);
  const groupIds = Array.isArray(opState.params?.group_ids) ? opState.params.group_ids as string[] : null;
  const cursor = typeof opState.cursor === "string" && opState.cursor && opState.cursor !== "0" ? opState.cursor : null;
  const stageStartedAt = new Date().toISOString();

  let groups: RefreshGroupRow[];
  try {
    groups = await fetchGroups({ cursor, limit, groupIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, done: false, error: message, error_stage: "candidate_fetch", last_stage_started_at: stageStartedAt };
  }

  if (!groups.length) {
    return {
      ok: true, done: true, refreshed: 0, unchanged: 0, failed: 0,
      failure_samples: [], nextOffset: opState.cursor ?? 0,
      last_stage: "candidate_fetch", last_stage_started_at: stageStartedAt,
    };
  }

  let stored: StoredAuthoritativeTag[];
  try {
    stored = await fetchAuthoritativeTags(groups.map((group) => group.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, done: false, error: message, error_stage: "candidate_fetch", last_stage_started_at: stageStartedAt };
  }
  const storedByGroup = new Map<string, StoredAuthoritativeTag[]>();
  for (const row of stored) {
    const list = storedByGroup.get(row.style_group_id) ?? [];
    list.push(row);
    storedByGroup.set(row.style_group_id, list);
  }

  let refreshed = 0, unchanged = 0, failed = 0;
  const failureSamples: Array<Record<string, unknown>> = [];
  const searchRefreshIds: string[] = [];

  for (const group of groups) {
    try {
      const desired = deriveRefreshTags(group);
      if (authoritativeTagsAreCurrent(desired, storedByGroup.get(group.id) ?? [])) {
        unchanged++;
        searchRefreshIds.push(group.id);
        continue;
      }
      const result = await client.rpc("replace_style_group_ai_profile", {
        p_style_group_id: group.id,
        p_source: AUTHORITATIVE_TAG_SOURCE,
        p_model: AUTHORITATIVE_TAG_MODEL,
        // Pass the group's own description straight back — a refresh must never
        // invent, translate, or blank the artwork summary.
        p_description: group.group_ai_description,
        p_tags: desired,
        p_evidence_asset_ids: group.group_ai_evidence_asset_ids ?? [],
      });
      if (result.error) throw new Error(result.error.message);
      if (needsProvenanceRestore(group)) await restoreProvenance(group.id, group);
      refreshed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("refresh-group-metadata: group failed", { styleGroupId: group.id, error: message.slice(0, 300) });
      failureSamples.push({
        at: new Date().toISOString(),
        style_group_id: group.id,
        error: message.slice(0, 500),
        // A crash between the write and the provenance restore leaves the group
        // labelled `authoritative`. These are the values needed to repair it.
        prior_provenance: {
          source: group.group_ai_description_source,
          model: group.group_ai_description_model,
          tagged_at: group.group_ai_tagged_at,
          evidence_asset_ids: group.group_ai_evidence_asset_ids ?? [],
        },
      });
    }
  }

  // Groups whose authoritative facts were already current still need their search
  // document rebuilt; the RPC does it for the ones it wrote.
  for (let index = 0; index < searchRefreshIds.length; index += SEARCH_REFRESH_CHUNK) {
    const chunk = searchRefreshIds.slice(index, index + SEARCH_REFRESH_CHUNK);
    const search = await client.rpc("refresh_dam_search_documents_batch", {
      p_asset_ids: [],
      p_style_group_ids: chunk,
      p_limit: chunk.length,
    });
    if (search.error) {
      failed += chunk.length;
      unchanged -= chunk.length;
      failureSamples.push({ at: new Date().toISOString(), style_group_id: chunk[0], error: `Search refresh failed: ${search.error.message}`.slice(0, 500) });
    }
  }

  return {
    ok: true,
    // Confirm completion with an empty page so a concurrent insert cannot end a run early.
    done: false,
    refreshed,
    unchanged,
    failed,
    failure_samples: failureSamples.slice(-200),
    nextOffset: groups[groups.length - 1].id,
    last_stage: "tag_write",
    last_stage_started_at: stageStartedAt,
  };
}

/**
 * Compatibility alias for the retired `propagate-group-tags` operation. It runs
 * the safe refresh and emits a deprecation diagnostic. It exists so the owner's
 * existing button, any queued operation, and any saved automation keep working —
 * the capability is never removed, only made safe.
 */
export async function handleLegacyPropagationAlias(
  opState: OpState,
  dependencies: RefreshDependencies = {},
): Promise<BatchResult> {
  logger.warn("propagate-group-tags: deprecated alias invoked", { replacement: REFRESH_GROUP_METADATA_OP_KEY });
  const result = await handleRefreshGroupMetadata(opState, dependencies);
  return { ...result, deprecated: true, deprecation_notice: LEGACY_PROPAGATION_DEPRECATION };
}
