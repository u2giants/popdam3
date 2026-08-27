/**
 * Style Group profile pass (op key: "ai-tag-group-profiles").
 *
 * Builds ONE bounded, evidence-backed artwork profile per Style Group from a
 * diverse set of representative member files. Group rows stay physically on the
 * Style Group — nothing here writes asset rows, asset tags, or `assets.tags`.
 *
 * Scope rules (locked by plan_style_group_scoped_ai_metadata.md):
 *   - only GROUP_TAG_CATEGORIES are accepted; file-only categories are rejected;
 *   - authoritative derived facts are written as `active` with source
 *     "authoritative" and never depend on the model;
 *   - AI terms are `active` only at confidence >= 0.85 with evidence from at
 *     least two distinct member assets, otherwise `candidate`;
 *   - manual rows and rejected tombstones survive every rerun — that is
 *     enforced by the governed RPC `replace_style_group_ai_profile`, which is
 *     the ONLY writer this handler uses.
 */

import { db } from "../supabase.js";
import { logger } from "../logger.js";
import {
  buildProviderPin,
  getOpenRouterBatch,
  imageContent,
  OpenRouterError,
  parseOpenRouterBatchResult,
  submitOpenRouterBatch,
  type ChatCompletionRequest,
  type ChatMessage,
  type OpenRouterBatchResultItem,
} from "../openrouter.js";
import { buildStructuredOutputPlan, getRuntimeModelCapabilities, type StructuredOutputMethod } from "../model-capabilities.js";
import { executeStructuredOutput } from "../structured-output.js";
import type { BatchResult, OpenRouterBatchJobState, OpState } from "../types.js";
import {
  deriveAuthoritativeGroupTags,
  GROUP_TAG_CATEGORIES,
  groupAiStatus,
  normalizeMetadataTag,
} from "../tagging-metadata-policy.js";
import { TAG_STYLE_GROUP_SCHEMA, buildStyleGroupTaggingPrompt } from "../tag-style-group-contract.js";
import {
  selectStyleGroupRepresentatives,
  type StyleGroupRepresentativeCandidate,
} from "../style-group-representatives.js";
import { fetchImageData, getAiTaggingApiKey, parseJsonObject, type ImageData } from "./ai-tagging-shared.js";
import { indexBatchResults, isNewBatchVisibilityDelay, nextBatchAction } from "./ai-tagging-batch-state.js";
import { getVisionModels } from "./ai-tagging.js";

const AI_TIMEOUT_MS = 90_000;
const DEFAULT_GROUP_PAGE_SIZE = 10;
/** Hard ceiling on the ACTUAL downloaded thumbnail bytes for one group. */
export const MAX_GROUP_IMAGE_BYTES = 12 * 1024 * 1024;
/** No single thumbnail may consume more than this share of the group ceiling. */
export const MAX_SINGLE_IMAGE_SHARE = 0.25;
const MEMBER_CANDIDATE_LIMIT = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA_NAME = "tag_style_group";

export const GROUP_PROFILE_SOURCE = "group_ai";
export const AUTHORITATIVE_SOURCE = "authoritative";
export const AUTHORITATIVE_MODEL = "derived";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type StyleGroupProfileRow = {
  id: string;
  sku: string | null;
  item_description: string | null;
  licensor_name: string | null;
  property_name: string | null;
  product_category: string | null;
  rich_metadata: unknown;
  primary_asset_id: string | null;
  group_ai_description: string | null;
};

export type StyleGroupProfileData = {
  group_ai_description: string;
  group_tags: Array<{
    tag: string;
    category: string;
    confidence: number;
    evidence_asset_ids: string[];
  }>;
};

export type GroupTagWrite = {
  tag: string;
  category: string;
  status: "active" | "candidate";
  confidence: number;
  evidence: Record<string, unknown>;
};

export interface GroupProfileRpcClient {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error: null | { message: string; code?: string } }>;
}

export interface StyleGroupProfileDependencies {
  client?: GroupProfileRpcClient;
  fetchGroups?: (options: { cursor: string | null; limit: number; force: boolean; groupIds: string[] | null }) => Promise<StyleGroupProfileRow[]>;
  fetchMembers?: (groupId: string) => Promise<StyleGroupRepresentativeCandidate[]>;
  fetchImages?: (representatives: StyleGroupRepresentativeCandidate[]) => Promise<PreparedGroupImages>;
  callModel?: (
    group: StyleGroupProfileRow,
    representatives: StyleGroupRepresentativeCandidate[],
    images: ImageData[],
    model: string,
  ) => Promise<StyleGroupProfileData>;
  batchSize?: number;
  maxImageBytes?: number;
  /** Test seams only — production always reads admin_config. */
  models?: { primary: string; fallback: string | null; providerPin: string | null };
  apiKey?: string;
}

export type PreparedGroupImages = {
  representatives: StyleGroupRepresentativeCandidate[];
  images: ImageData[];
  droppedForBudget: number;
  unavailable: number;
};

// ── Validation ───────────────────────────────────────────────────────────────

export function validateStyleGroupProfileData(value: Record<string, unknown>, mode: string): StyleGroupProfileData {
  const errors: string[] = [];
  if (typeof value.group_ai_description !== "string" || !value.group_ai_description.trim()) {
    errors.push("group_ai_description must be a non-empty string");
  }
  const rawTags = value.group_tags;
  if (!Array.isArray(rawTags)) {
    errors.push("group_tags must be an array");
  } else {
    if (rawTags.length > 18) errors.push("group_tags must contain at most 18 items");
    const normalized: string[] = [];
    for (const item of rawTags as Array<Record<string, unknown>>) {
      if (!item || typeof item !== "object") {
        errors.push("every group tag must be an object");
        continue;
      }
      const tag = normalizeMetadataTag(item.tag);
      if (!tag) errors.push("every group tag must have a non-empty tag");
      else normalized.push(tag);
      if (typeof item.category !== "string" || !GROUP_TAG_CATEGORIES.includes(item.category)) {
        errors.push(`group tags must use a group-only category (got ${String(item.category)})`);
      }
      if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) {
        errors.push("every group tag confidence must be between 0 and 1");
      }
      if (
        !Array.isArray(item.evidence_asset_ids) ||
        item.evidence_asset_ids.length === 0 ||
        item.evidence_asset_ids.some((entry) => typeof entry !== "string" || !UUID_RE.test(entry))
      ) {
        errors.push("every group tag must cite representative asset UUIDs");
      }
    }
    if (new Set(normalized).size !== normalized.length) errors.push("group tags must be distinct");
  }
  if (errors.length > 0) throw new Error(`Model returned invalid ${mode} group profile: ${errors.join("; ")}`);
  return value as unknown as StyleGroupProfileData;
}

// ── Row construction ─────────────────────────────────────────────────────────

/**
 * Convert one validated model profile into database rows.
 *
 * Evidence UUIDs outside the group's own membership are dropped before the RPC
 * is called: the database also fails closed, but a single foreign ID would
 * otherwise abort the whole group write.
 */
export function buildGroupProfileWrites(input: {
  group: StyleGroupProfileRow;
  memberAssetIds: readonly string[];
  profile: StyleGroupProfileData;
}): {
  description: string | null;
  authoritativeTags: GroupTagWrite[];
  aiTags: GroupTagWrite[];
  evidenceAssetIds: string[];
} {
  const members = new Set(input.memberAssetIds);
  const authoritativeTags = deriveAuthoritativeGroupTags(
    input.group as unknown as Record<string, unknown>,
  ).map((row) => ({
    tag: row.tag as string,
    category: row.category as string,
    status: "active" as const,
    confidence: 1,
    evidence: row.evidence as Record<string, unknown>,
  }));
  const authoritativeTagText = new Set(authoritativeTags.map((row) => row.tag));

  const aiTags: GroupTagWrite[] = [];
  const seen = new Set<string>();
  const evidence = new Set<string>();
  for (const item of input.profile.group_tags) {
    const tag = normalizeMetadataTag(item.tag);
    if (!tag || seen.has(tag)) continue;
    // Authoritative business facts outrank AI; never emit a competing AI row.
    if (authoritativeTagText.has(tag)) continue;
    const validEvidence = Array.from(new Set(item.evidence_asset_ids.filter((id) => members.has(id))));
    if (validEvidence.length === 0) continue;
    seen.add(tag);
    for (const id of validEvidence) evidence.add(id);
    aiTags.push({
      tag,
      category: item.category,
      status: groupAiStatus(item.confidence, validEvidence),
      confidence: item.confidence,
      evidence: { asset_ids: validEvidence },
    });
  }

  return {
    description: input.profile.group_ai_description.trim() || input.group.group_ai_description,
    authoritativeTags,
    aiTags,
    evidenceAssetIds: Array.from(evidence),
  };
}

/**
 * Atomic write. `replace_style_group_ai_profile` is called once per source so
 * authoritative rows and AI rows keep their own provenance; the authoritative
 * call runs first so the final description/model on `style_groups` belongs to
 * the AI pass. Both calls carry the SAME final description, so a failure
 * between them can never blank an existing group description.
 */
export async function writeStyleGroupProfile(
  client: GroupProfileRpcClient,
  input: {
    groupId: string;
    model: string;
    description: string | null;
    authoritativeTags: GroupTagWrite[];
    aiTags: GroupTagWrite[];
    evidenceAssetIds: string[];
  },
): Promise<void> {
  if (input.authoritativeTags.length > 0) {
    const authoritative = await client.rpc("replace_style_group_ai_profile", {
      p_style_group_id: input.groupId,
      p_source: AUTHORITATIVE_SOURCE,
      p_model: AUTHORITATIVE_MODEL,
      p_description: input.description,
      p_tags: input.authoritativeTags,
      p_evidence_asset_ids: input.evidenceAssetIds,
    });
    if (authoritative.error) throw new Error(`Authoritative group write failed: ${authoritative.error.message}`);
  }
  const profile = await client.rpc("replace_style_group_ai_profile", {
    p_style_group_id: input.groupId,
    p_source: GROUP_PROFILE_SOURCE,
    p_model: input.model,
    p_description: input.description,
    p_tags: input.aiTags,
    p_evidence_asset_ids: input.evidenceAssetIds,
  });
  if (profile.error) throw new Error(`Atomic group profile write failed: ${profile.error.message}`);
}

// ── Default data access ──────────────────────────────────────────────────────

const GROUP_COLUMNS =
  "id, sku, item_description, licensor_name, property_name, product_category, rich_metadata, primary_asset_id, group_ai_description";
const MEMBER_COLUMNS =
  "id, filename, relative_path, file_type, content_type, file_size, thumbnail_url";

async function defaultFetchGroups(options: { cursor: string | null; limit: number; force: boolean; groupIds: string[] | null }): Promise<StyleGroupProfileRow[]> {
  const client = db();
  let query = client.from("style_groups").select(GROUP_COLUMNS).order("id", { ascending: true }).limit(options.limit);
  if (options.groupIds?.length) query = query.in("id", options.groupIds);
  else if (!options.force) query = query.is("group_ai_tagged_at", null);
  if (options.cursor) query = query.gt("id", options.cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Style group candidate fetch failed: ${error.message}`);
  return (data ?? []) as unknown as StyleGroupProfileRow[];
}

async function defaultFetchMembers(groupId: string): Promise<StyleGroupRepresentativeCandidate[]> {
  const client = db();
  const { data, error } = await client
    .from("assets")
    .select(MEMBER_COLUMNS)
    .eq("style_group_id", groupId)
    // A soft-deleted file keeps its thumbnail in Spaces, so without this filter a
    // deleted member could be shown to the model and counted as group evidence.
    .eq("is_deleted", false)
    .limit(MEMBER_CANDIDATE_LIMIT);
  if (error) throw new Error(`Style group member fetch failed: ${error.message}`);
  return (data ?? []) as unknown as StyleGroupRepresentativeCandidate[];
}

/** Downloads selected thumbnails and enforces the ACTUAL byte ceiling. */
export async function prepareGroupImages(
  representatives: StyleGroupRepresentativeCandidate[],
  maxBytes = MAX_GROUP_IMAGE_BYTES,
): Promise<PreparedGroupImages> {
  const kept: StyleGroupRepresentativeCandidate[] = [];
  const images: ImageData[] = [];
  let bytes = 0;
  let droppedForBudget = 0;
  let unavailable = 0;
  for (const representative of representatives) {
    if (!representative.thumbnail_url) {
      unavailable++;
      continue;
    }
    let image: ImageData;
    try {
      image = await fetchImageData(representative.thumbnail_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Thumbnail fetch HTTP (403|404)\b/.test(message)) {
        unavailable++;
        continue;
      }
      throw error;
    }
    // base64 inflates by 4/3; measure the decoded payload we actually hold.
    const actualBytes = Math.ceil((image.base64.length * 3) / 4);
    // A single oversized or corrupt object must never enter the payload, even as
    // the first representative — otherwise one bad thumbnail defeats the ceiling.
    if (actualBytes > maxBytes * MAX_SINGLE_IMAGE_SHARE) {
      droppedForBudget++;
      continue;
    }
    if (kept.length > 0 && bytes + actualBytes > maxBytes) {
      droppedForBudget++;
      continue;
    }
    bytes += actualBytes;
    kept.push(representative);
    images.push(image);
  }
  return { representatives: kept, images, droppedForBudget, unavailable };
}

export function buildGroupProfileMessages(
  group: StyleGroupProfileRow,
  representatives: StyleGroupRepresentativeCandidate[],
  images: ImageData[],
): ChatMessage[] {
  const prompt = buildStyleGroupTaggingPrompt({
    styleGroup: group as unknown as Record<string, unknown>,
    representativeAssets: representatives.map((representative) => ({
      id: representative.id,
      content_type: representative.content_type ?? undefined,
      descriptor: representative.file_type ?? undefined,
    })),
    richMetadata: group.rich_metadata ?? null,
  });
  return [
    { role: "system", content: prompt },
    {
      role: "user",
      content: [
        ...images.map((image) => imageContent(image.base64, image.mimeType)),
        {
          type: "text" as const,
          text:
            "These images are the representative files of ONE Style Group, in the same order as the representative asset IDs above. " +
            "Return group_ai_description and group_tags describing only what the whole group shares.",
        },
      ],
    },
  ];
}

async function defaultCallModel(
  group: StyleGroupProfileRow,
  representatives: StyleGroupRepresentativeCandidate[],
  images: ImageData[],
  model: string,
): Promise<StyleGroupProfileData> {
  const apiKey = await getAiTaggingApiKey(model);
  if (!apiKey) throw new Error("No AI API key configured for Style Group profiling");
  const models = await getVisionModels();
  const capabilities = await getRuntimeModelCapabilities(apiKey, model);
  const result = await executeStructuredOutput({
    apiKey,
    model,
    messages: buildGroupProfileMessages(group, representatives, images),
    schemaName: SCHEMA_NAME,
    schema: TAG_STYLE_GROUP_SCHEMA as Record<string, unknown>,
    capabilities,
    timeoutMs: AI_TIMEOUT_MS,
    maxTokens: 3000,
    provider: buildProviderPin(models.providerPin),
    validate: (value) => validateStyleGroupProfileData(value, "structured"),
  });
  return result.value;
}

// ── One group ────────────────────────────────────────────────────────────────

export type GroupOutcome =
  | { outcome: "profiled" | "visual_analysis_unavailable" }
  | { outcome: "failed"; error: string };

export async function profileOneStyleGroup(
  group: StyleGroupProfileRow,
  model: string,
  dependencies: StyleGroupProfileDependencies,
): Promise<GroupOutcome> {
  const client = dependencies.client ?? (db() as unknown as GroupProfileRpcClient);
  const fetchMembers = dependencies.fetchMembers ?? defaultFetchMembers;
  const fetchImages = dependencies.fetchImages ??
    ((representatives: StyleGroupRepresentativeCandidate[]) =>
      prepareGroupImages(representatives, dependencies.maxImageBytes ?? MAX_GROUP_IMAGE_BYTES));
  const callModel = dependencies.callModel ?? defaultCallModel;

  const members = await fetchMembers(group.id);
  const memberIds = members.map((member) => member.id);
  const representatives = selectStyleGroupRepresentatives(
    members.map((member) => ({ ...member, is_primary: member.id === group.primary_asset_id })),
  );

  if (representatives.length === 0) return { outcome: "visual_analysis_unavailable" };
  const prepared = await fetchImages(representatives);
  // Nothing analyzable this cycle. Deliberately write NOTHING: the governed RPC
  // stamps group_ai_tagged_at unconditionally, so a write here would mark the
  // group profiled and exclude it from every later default run — a group whose
  // thumbnails were temporarily missing would never be profiled once they
  // recover. Leaving it untouched keeps it eligible. (Authoritative-only refresh
  // for permanently unanalyzable groups is Step 6's group-refresh pass.)
  if (prepared.images.length === 0) return { outcome: "visual_analysis_unavailable" };

  const profile = await callModel(group, prepared.representatives, prepared.images, model);
  const writes = buildGroupProfileWrites({ group, memberAssetIds: memberIds, profile });
  await writeStyleGroupProfile(client, {
    groupId: group.id,
    model,
    description: writes.description,
    authoritativeTags: writes.authoritativeTags,
    aiTags: writes.aiTags,
    evidenceAssetIds: writes.evidenceAssetIds,
  });
  return { outcome: "profiled" };
}

// ── Durable (OpenRouter batch) path ──────────────────────────────────────────

type GroupJobItem = {
  style_group_id: string;
  custom_id: string;
  status: "prepared" | "submitted" | "applied" | "failed_terminal";
  sku?: string | null;
  error?: string;
};

function groupItems(job: OpenRouterBatchJobState): GroupJobItem[] {
  return Array.isArray(job.group_items) ? job.group_items as GroupJobItem[] : [];
}

async function handleDurableGroupProfiles(
  opState: OpState,
  force: boolean,
  dependencies: StyleGroupProfileDependencies,
  batchSize: number,
): Promise<BatchResult> {
  const models = dependencies.models ?? await getVisionModels();
  const model = opState.external_job?.model ?? models.primary;
  const apiKey = dependencies.apiKey ?? await getAiTaggingApiKey(model);
  if (!apiKey) return { ok: false, done: false, error: "No OpenRouter API key configured" };
  const provider = buildProviderPin(models.providerPin);
  const fetchGroups = dependencies.fetchGroups ?? defaultFetchGroups;
  const fetchMembers = dependencies.fetchMembers ?? defaultFetchMembers;
  const fetchImages = dependencies.fetchImages ??
    ((representatives: StyleGroupRepresentativeCandidate[]) =>
      prepareGroupImages(representatives, dependencies.maxImageBytes ?? MAX_GROUP_IMAGE_BYTES));
  const client = dependencies.client ?? (db() as unknown as GroupProfileRpcClient);
  const job = opState.external_job;

  if (!job) {
    const capabilities = await getRuntimeModelCapabilities(apiKey, model);
    const outputMethod = buildStructuredOutputPlan(capabilities)
      .find((method): method is Exclude<StructuredOutputMethod, "json_repair"> => method !== "json_repair");
    if (!outputMethod) return { ok: false, done: false, error: `Model ${model} has no supported structured-output method` };
    const groupIds = Array.isArray(opState.params?.group_ids) ? opState.params.group_ids as string[] : null;
    const cursor = typeof opState.cursor === "string" && opState.cursor ? opState.cursor : null;
    const groups = await fetchGroups({ cursor, limit: batchSize, force, groupIds });
    if (!groups.length) return { ok: true, done: true, profiled: 0, skipped: 0, failed: 0, nextOffset: opState.cursor ?? 0 };
    const runId = opState.run_id ?? "unassigned";
    return {
      ok: true,
      done: false,
      nextOffset: opState.cursor ?? 0,
      external_job: {
        version: 1,
        phase: "prepared",
        model,
        output_method: outputMethod,
        prepared_at: new Date().toISOString(),
        page_cursor: opState.cursor ?? 0,
        next_cursor: groups[groups.length - 1].id,
        operation_done_after_clear: Boolean(groupIds?.length),
        scope: "style_group",
        group_items: groups.map((group) => ({
          style_group_id: group.id,
          custom_id: `popdam-group:${runId}:${group.id}:${outputMethod}:0`,
          status: "prepared",
          sku: group.sku,
        })),
        items: [],
      },
      last_stage: "state_persist",
    };
  }

  const action = nextBatchAction(job);
  if (action.type === "blocked") return { ok: false, done: false, error: action.reason, error_code: "contract_error" };
  if (action.type === "claim") return { ok: true, done: false, nextOffset: job.page_cursor ?? opState.cursor ?? 0, state_transition: "claim_submission" };
  if (action.type === "wait") return { ok: true, done: false, nextOffset: job.page_cursor ?? opState.cursor ?? 0, state_transition: "yield_without_save", last_stage: "model_inference" };
  if (action.type === "clear") {
    return {
      ok: true,
      done: job.operation_done_after_clear === true,
      nextOffset: job.next_cursor ?? job.page_cursor ?? opState.cursor ?? 0,
      profiled: 0,
      skipped: 0,
      failed: 0,
      external_job: { ...job, lease_token: action.leaseToken, clear_after_reconciliation: true },
      last_stage: "state_persist",
    };
  }

  if (action.type === "submit") {
    const outputMethod = job.output_method ?? "json_schema";
    const submissions = [];
    let visualAnalysisUnavailable = 0;
    for (const item of groupItems(job)) {
      const groups = await fetchGroups({ cursor: null, limit: 1, force: true, groupIds: [item.style_group_id] });
      const group = groups[0];
      if (!group) continue;
      const members = await fetchMembers(group.id);
      const representatives = selectStyleGroupRepresentatives(
        members.map((member) => ({ ...member, is_primary: member.id === group.primary_asset_id })),
      );
      if (!representatives.length) {
        visualAnalysisUnavailable++;
        continue;
      }
      const prepared = await fetchImages(representatives);
      if (!prepared.images.length) {
        visualAnalysisUnavailable++;
        continue;
      }
      const request: ChatCompletionRequest = {
        model,
        messages: buildGroupProfileMessages(group, prepared.representatives, prepared.images),
        max_tokens: 3000,
        provider,
      };
      applyStructuredOutputMethod(request, outputMethod);
      submissions.push({ customId: item.custom_id, request });
    }
    if (!submissions.length) {
      return {
        ok: true,
        done: job.operation_done_after_clear === true,
        nextOffset: job.next_cursor ?? job.page_cursor ?? 0,
        clear_external_job: true,
        skipped: groupItems(job).length,
        visual_analysis_unavailable: visualAnalysisUnavailable,
      };
    }
    const created = await submitOpenRouterBatch(apiKey, submissions);
    const submittedIds = new Set(submissions.map((submission) => submission.customId));
    return {
      ok: true,
      done: false,
      nextOffset: job.page_cursor ?? opState.cursor ?? 0,
      external_job: {
        ...job,
        phase: "pending",
        provider_batch_id: created.id,
        submitted_at: new Date().toISOString(),
        lease_token: action.leaseToken,
        next_poll_at: new Date(Date.now() + 10_000).toISOString(),
        group_items: groupItems(job)
          .filter((item) => submittedIds.has(item.custom_id))
          .map((item) => ({ ...item, status: "submitted" as const })),
      },
      visual_analysis_unavailable: visualAnalysisUnavailable,
      last_stage: "model_inference",
    };
  }

  let record;
  try {
    record = await getOpenRouterBatch(apiKey, action.batchId);
  } catch (error) {
    if (error instanceof OpenRouterError && isNewBatchVisibilityDelay(error.status, job.submitted_at)) {
      return {
        ok: true,
        done: false,
        nextOffset: job.page_cursor ?? opState.cursor ?? 0,
        external_job: { ...job, last_checked_at: new Date().toISOString(), next_poll_at: new Date(Date.now() + 10_000).toISOString() },
        last_stage: "model_inference",
      };
    }
    throw error;
  }
  if (!["completed", "failed", "cancelled", "canceled", "expired"].includes(record.status ?? "")) {
    return {
      ok: true, done: false, nextOffset: job.page_cursor ?? opState.cursor ?? 0,
      external_job: { ...job, last_checked_at: new Date().toISOString(), next_poll_at: new Date(Date.now() + 10_000).toISOString() },
      last_stage: "model_inference",
    };
  }
  if (record.status !== "completed") {
    return {
      ok: false,
      done: false,
      error: `OpenRouter batch ${action.batchId} ${record.status}`,
      error_code: "provider_terminal",
      external_job: { ...job, provider_status: record.status, lease_token: job.lease_token, last_checked_at: new Date().toISOString() },
    };
  }
  if (action.type !== "apply") {
    return {
      ok: true,
      done: false,
      nextOffset: job.page_cursor ?? opState.cursor ?? 0,
      external_job: { ...job, phase: "applying", lease_token: job.lease_token, last_checked_at: new Date().toISOString(), next_poll_at: undefined },
      last_stage: "state_persist",
    };
  }

  const results = indexBatchResults(
    groupItems(job).map((item) => item.custom_id),
    (record.results ?? []) as OpenRouterBatchResultItem[],
  );
  let profiled = 0, failed = 0;
  const failureSamples = [];
  for (const item of groupItems(job)) {
    const raw = results.get(item.custom_id) as OpenRouterBatchResultItem | undefined;
    try {
      if (!raw) throw new Error("OpenRouter result missing");
      const completion = await parseOpenRouterBatchResult(apiKey, raw);
      const parsed = completion.toolCalls?.find((call) => call.name === SCHEMA_NAME)?.arguments ?? parseJsonObject(completion.content);
      if (!parsed) throw new Error("OpenRouter result contains no structured group profile");
      const profile = validateStyleGroupProfileData(parsed, "batch");
      const groups = await fetchGroups({ cursor: null, limit: 1, force: true, groupIds: [item.style_group_id] });
      const group = groups[0];
      if (!group) throw new Error(`Style group not found: ${item.style_group_id}`);
      const members = await fetchMembers(group.id);
      const writes = buildGroupProfileWrites({ group, memberAssetIds: members.map((member) => member.id), profile });
      await writeStyleGroupProfile(client, {
        groupId: group.id,
        model,
        description: writes.description,
        authoritativeTags: writes.authoritativeTags,
        aiTags: writes.aiTags,
        evidenceAssetIds: writes.evidenceAssetIds,
      });
      profiled++;
    } catch (error) {
      failed++;
      failureSamples.push({
        at: new Date().toISOString(),
        style_group_id: item.style_group_id,
        sku: item.sku ?? "",
        error: String(error).slice(0, 500),
      });
    }
  }
  return {
    ok: true, done: false, profiled, failed, skipped: 0,
    failure_samples: failureSamples,
    nextOffset: job.next_cursor ?? job.page_cursor ?? opState.cursor ?? 0,
    external_job: { ...job, phase: "completed", lease_token: job.lease_token, last_checked_at: new Date().toISOString() },
    last_stage: "tag_write",
  };
}

function applyStructuredOutputMethod(
  request: ChatCompletionRequest,
  method: Exclude<StructuredOutputMethod, "json_repair">,
): void {
  if (method === "json_schema") {
    request.response_format = {
      type: "json_schema",
      json_schema: { name: SCHEMA_NAME, strict: false, schema: TAG_STYLE_GROUP_SCHEMA as Record<string, unknown> },
    };
  } else if (method === "json_object") {
    request.response_format = { type: "json_object" };
  } else {
    request.tools = [{
      type: "function",
      function: {
        name: SCHEMA_NAME,
        description: "Return the structured artwork profile for this Style Group.",
        parameters: TAG_STYLE_GROUP_SCHEMA as Record<string, unknown>,
      },
    }];
    request.tool_choice = method === "tool_named"
      ? { type: "function", function: { name: SCHEMA_NAME } }
      : method === "tool_required" ? "required" : "auto";
  }
}

// ── Batch handler (called from operation-loop) ───────────────────────────────

export async function handleStyleGroupProfiles(
  opState: OpState,
  dependencies: StyleGroupProfileDependencies = {},
): Promise<BatchResult> {
  const batchSize = Math.max(1, dependencies.batchSize ?? DEFAULT_GROUP_PAGE_SIZE);
  const force = opState.params?.force === true;
  const models = dependencies.models ?? await getVisionModels();
  if (opState.external_job || models.primary.trim().endsWith(":batch")) {
    return handleDurableGroupProfiles(opState, force, dependencies, batchSize);
  }

  const fetchGroups = dependencies.fetchGroups ?? defaultFetchGroups;
  const groupIds = Array.isArray(opState.params?.group_ids) ? opState.params.group_ids as string[] : null;
  const cursor = typeof opState.cursor === "string" && opState.cursor ? opState.cursor : null;
  const stageStartedAt = new Date().toISOString();

  let groups: StyleGroupProfileRow[];
  try {
    groups = await fetchGroups({ cursor, limit: batchSize, force, groupIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, done: false, error: message, error_stage: "candidate_fetch", last_stage_started_at: stageStartedAt };
  }

  if (!groups.length) {
    return {
      ok: true, done: true, profiled: 0, skipped: 0, failed: 0,
      failure_samples: [], nextOffset: opState.cursor ?? 0,
      last_stage: "candidate_fetch", last_stage_started_at: stageStartedAt,
    };
  }

  let profiled = 0, failed = 0, visualAnalysisUnavailable = 0;
  const failureSamples: Array<Record<string, unknown>> = [];
  for (const group of groups) {
    try {
      const result = await profileOneStyleGroup(group, models.primary, dependencies);
      if (result.outcome === "profiled") profiled++;
      else if (result.outcome === "visual_analysis_unavailable") visualAnalysisUnavailable++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("ai-style-group-profile: group failed", { styleGroupId: group.id, error: message.slice(0, 300) });
      failureSamples.push({ at: new Date().toISOString(), style_group_id: group.id, sku: group.sku ?? "", error: message.slice(0, 500) });
    }
  }

  return {
    ok: true,
    // Confirm completion with an empty page so concurrent inserts cannot end a run early.
    done: false,
    profiled,
    skipped: 0,
    failed,
    visual_analysis_unavailable: visualAnalysisUnavailable,
    failure_samples: failureSamples.slice(-200),
    nextOffset: groups[groups.length - 1].id,
    last_stage: "tag_write",
    last_stage_started_at: stageStartedAt,
  };
}
