// `ai-tag-popsg`: AI image tagging for PopSG style-guide files, reusing the
// PopDAM tagger's model call (Straitly share route, OpenRouter fallback,
// missing-tag host retry, 60 s ladder budget — KNOWN_QUIRKS #83). Results go to
// style_guide_file_tags (source `vision_ai`) and style_guide_tagging_state
// (pipeline `vision`). Settings live in admin_config.AI_TAG_POPSG_RUN, shaped
// like AI_TAG_PARALLEL_RUN; its run_id must equal the operation's run_id.
import { db } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";
import { parallelTagRun, type ParallelTagRun } from "./ai-tag-parallel.js";
import { settledPool, isRetryableStructuredOutputError } from "./ai-tagging.js";
import {
  buildImageTaggingMessages, buildImageTaggingPrompt, callTagAssetModel, fetchImageData,
  getAiTaggingApiKey, TAG_LADDER_BUDGET_MS,
} from "./ai-tagging-shared.js";
import { normalizePopSGTag, type PopSGTagFacet } from "./popsg-tags.js";

export const POPSG_VISION_RULE_VERSION = "vision-v1";
export const POPSG_AI_TAG_CONFIG_KEY = "AI_TAG_POPSG_RUN";
const AI_TIMEOUT_MS = 60_000;
const PAGE_MULTIPLIER = 4;

export interface PopSGVisionFile {
  id: string; filename: string; relative_path: string; file_extension: string | null;
  licensor_name: string | null; property_folder: string | null; style_guide_folder: string | null; thumbnail_url: string;
}
export type PopSGTagOutcome = { outcome: "tagged" | "failed" | "unavailable"; error?: string };

const FACETS: Record<string, PopSGTagFacet> = { file_type: "asset_type", color: "color", technique: "style", scene: "theme" };

/** Map the shared tag_asset result onto PopSG tag rows. */
export function popsgVisionTags(tagData: Record<string, unknown>, model: string, licensedNames: ReadonlySet<string> = new Set()) {
  const seen = new Set<string>();
  const rows: Array<{ normalized: string; display_name: string; facet: PopSGTagFacet; confidence: number; guessedName: boolean; evidence: Record<string, unknown> }> = [];
  for (const item of (Array.isArray(tagData.asset_tags) ? tagData.asset_tags : []) as Array<Record<string, unknown>>) {
    const display = typeof item?.tag === "string" ? item.tag.trim() : "";
    const normalized = normalizePopSGTag(display);
    if (!normalized || seen.has(normalized)) continue;
    // A licensor, property or character name guessed from the picture is kept
    // but marked `suggested`, so it never feeds search ahead of folder metadata
    // (#1430 accuracy regression). Search reads only `accepted` tags.
    const guessedName = licensedNames.has(normalized);
    seen.add(normalized);
    const c = Number(item.confidence);
    rows.push({
      normalized, display_name: display.slice(0, 200), facet: FACETS[String(item.category)] ?? "other",
      confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.8, guessedName,
      evidence: { category: item.category ?? null, evidence: item.evidence ?? null, model },
    });
  }
  return rows;
}

const NAMES_TTL_MS = 3_600_000;
let namesCache: { at: number; names: Set<string> } | null = null;

/** Normalized licensor, property, character and character-alias names (3+ characters). */
export async function loadLicensedNames(): Promise<Set<string>> {
  if (namesCache && Date.now() - namesCache.at < NAMES_TTL_MS) return namesCache.names;
  const names = new Set<string>();
  const sources: Array<[string, string]> = [["licensor", "name"], ["property", "name"], ["character", "name"], ["character_alias", "alias"]];
  for (const [table, column] of sources) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db().schema("core").from(table).select(column).order(column).range(from, from + 999);
      if (error) throw new Error(`name list ${table}: ${error.message}`);
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const n = typeof row[column] === "string" ? normalizePopSGTag(row[column] as string) : "";
        if (n.length >= 3) names.add(n);
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  namesCache = { at: Date.now(), names };
  return names;
}

let demoteQueue: string[] | null = null;

/**
 * Mark up to `limit` earlier accepted vision_ai links whose tag is a licensed
 * name as `suggested`. Nothing is deleted. Returns the number marked; 0 once
 * none are left.
 */
export async function demoteLicensedNameTags(names: ReadonlySet<string>, limit = 20000): Promise<number> {
  const client = db();
  if (demoteQueue === null) {
    const list = [...names];
    const ids: string[] = [];
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await client.from("style_guide_tags").select("id").in("normalized_tag", list.slice(i, i + 200));
      if (error) throw new Error(`name tag lookup: ${error.message}`);
      for (const r of data ?? []) ids.push(r.id as string);
    }
    demoteQueue = ids;
  }
  let marked = 0;
  while (demoteQueue.length && marked < limit) {
    const tagId = demoteQueue[0];
    const { data, error } = await client.from("style_guide_file_tags").select("id")
      .eq("tag_id", tagId).eq("status", "accepted").eq("source", "vision_ai").limit(Math.min(150, limit - marked));
    if (error) throw new Error(`name link lookup: ${error.message}`);
    const ids = (data ?? []).map(r => r.id as string);
    if (!ids.length) { demoteQueue.shift(); continue; }
    const upd = await client.from("style_guide_file_tags").update({ status: "suggested" }).in("id", ids);
    if (upd.error) throw new Error(`name link mark: ${upd.error.message}`);
    marked += ids.length;
  }
  return marked;
}

/** Rebuild up to 15 x 1,000 queued PopSG search records (each call stays under the API statement timeout). */
export async function refreshSearchSlice(): Promise<number> {
  let total = 0;
  for (let i = 0; i < 15; i++) {
    const { data, error } = await db().rpc("refresh_style_guide_matviews", { p_run_id: null, p_search_batch_size: 1000, p_step: "search" });
    if (error) throw new Error(`search refresh: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { search_documents_synced?: number } | null;
    const n = Number(row?.search_documents_synced ?? 0);
    total += n;
    if (n < 1000) break;
  }
  return total;
}

async function saveTags(file: PopSGVisionFile, tagData: Record<string, unknown>, model: string, attempts: number) {
  const client = db();
  const rows = popsgVisionTags(tagData, model, await loadLicensedNames());
  if (!rows.length) throw new Error("No usable tags");
  const names = rows.map(r => r.normalized);
  const inserted = await client.from("style_guide_tags").upsert(
    rows.map(r => ({ tag: r.normalized, normalized_tag: r.normalized, display_name: r.display_name, facet: r.facet })),
    { onConflict: "normalized_tag", ignoreDuplicates: true });
  if (inserted.error) throw new Error(`tag upsert: ${inserted.error.message}`);
  const found = await client.from("style_guide_tags").select("id, normalized_tag").in("normalized_tag", names);
  if (found.error) throw new Error(`tag lookup: ${found.error.message}`);
  const ids = new Map((found.data ?? []).map(t => [t.normalized_tag as string, t.id as string]));
  const removed = await client.from("style_guide_file_tags").delete().eq("style_guide_file_id", file.id).eq("source", "vision_ai");
  if (removed.error) throw new Error(`old tag delete: ${removed.error.message}`);
  const links = rows.filter(r => ids.has(r.normalized)).map(r => ({
    style_guide_file_id: file.id, tag_id: ids.get(r.normalized), source: "vision_ai", facet: r.facet,
    confidence: r.confidence, status: r.guessedName ? "suggested" : "accepted", evidence: r.evidence, inherited: false, rule_version: POPSG_VISION_RULE_VERSION,
  }));
  const saved = await client.from("style_guide_file_tags").insert(links);
  if (saved.error) throw new Error(`file tag insert: ${saved.error.message}`);
  await writeState(file.id, { status: "completed", candidate_count: rows.length, accepted_count: links.length, attempt_count: attempts, error_code: null, error_detail: null, completed_at: new Date().toISOString() });
}

async function writeState(fileId: string, fields: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { error } = await db().from("style_guide_tagging_state").upsert({
    style_guide_file_id: fileId, pipeline: "vision", rule_version: POPSG_VISION_RULE_VERSION, started_at: now, updated_at: now, ...fields,
  }, { onConflict: "style_guide_file_id,pipeline" });
  if (error) throw new Error(`state write: ${error.message}`);
}

export async function tagPopSGFile(file: PopSGVisionFile, model: string, attempts: number): Promise<PopSGTagOutcome> {
  let image;
  try { image = await fetchImageData(file.thumbnail_url); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/HTTP (403|404)/.test(msg)) {
      await writeState(file.id, { status: "failed", attempt_count: attempts, error_code: "image_unavailable", error_detail: msg.slice(0, 300) }).catch(() => undefined);
      return { outcome: "unavailable", error: msg };
    }
    return { outcome: "failed", error: `Thumbnail fetch error: ${msg.slice(0, 200)}` };
  }
  const prompt = await buildImageTaggingPrompt({ id: file.id, filename: file.filename, relative_path: file.relative_path,
    file_type: file.file_extension, tags: null, licensor_id: null, property_id: null, sku: null });
  const context = [file.licensor_name && `licensor folder "${file.licensor_name}"`, file.property_folder && `property folder "${file.property_folder}"`, file.style_guide_folder && `style guide "${file.style_guide_folder}"`].filter(Boolean).join(", ");
  const messages = buildImageTaggingMessages(prompt, image,
    `This is a page or art file from a licensor style guide${context ? ` (${context})` : ""}. Analyze the image and return structured tags matching the tag_asset schema.`);
  const apiKey = await getAiTaggingApiKey(model);
  const started = Date.now();
  let lastError = "AI call failed";
  for (let retry = 0; retry <= 1; retry++) {
    try {
      const { tagData } = await callTagAssetModel(apiKey, model, messages, AI_TIMEOUT_MS, 4000, undefined, []);
      await saveTags(file, tagData, model, attempts);
      return { outcome: "tagged" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (retry === 0 && Date.now() - started < TAG_LADDER_BUDGET_MS && isRetryableStructuredOutputError(lastError)) continue;
      break;
    }
  }
  await writeState(file.id, { status: "failed", attempt_count: attempts, error_code: "ai_call", error_detail: lastError.slice(0, 300) }).catch(() => undefined);
  return { outcome: "failed", error: `AI call error: ${lastError.slice(0, 300)}` };
}

export interface PopSGAiTagDeps {
  config?: unknown;
  fetchPage?: (afterId: string | null, limit: number) => Promise<PopSGVisionFile[]>;
  doneStates?: (ids: string[]) => Promise<Map<string, { status: string; attempt_count: number }>>;
  tagFile?: (file: PopSGVisionFile, model: string, attempts: number) => Promise<PopSGTagOutcome>;
  taggedRecently?: () => Promise<boolean>;
  demoteNames?: () => Promise<number>;
  refreshSearch?: () => Promise<number>;
}

async function fetchPageDefault(afterId: string | null, limit: number): Promise<PopSGVisionFile[]> {
  let q = db().from("style_guide_files").select("id, filename, relative_path, file_extension, licensor_name, property_folder, style_guide_folder, thumbnail_url")
    .eq("is_active", true).not("thumbnail_url", "is", null).order("id").limit(limit);
  if (afterId) q = q.gt("id", afterId);
  const { data, error } = await q;
  if (error) throw new Error(`candidate fetch: ${error.message}`);
  return (data ?? []) as PopSGVisionFile[];
}
async function doneStatesDefault(ids: string[]) {
  const { data, error } = await db().from("style_guide_tagging_state").select("style_guide_file_id, status, attempt_count").eq("pipeline", "vision").in("style_guide_file_id", ids);
  if (error) throw new Error(`state fetch: ${error.message}`);
  return new Map((data ?? []).map(r => [r.style_guide_file_id as string, { status: r.status as string, attempt_count: Number(r.attempt_count) || 0 }]));
}
async function taggedRecentlyDefault() {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { data, error } = await db().from("style_guide_tagging_state").select("style_guide_file_id").eq("pipeline", "vision").eq("status", "completed").gte("completed_at", since).limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export async function handlePopSGAiTag(opState: OpState, deps: PopSGAiTagDeps = {}): Promise<BatchResult> {
  let setting = deps.config;
  if (setting === undefined) {
    const { data, error } = await db().from("admin_config").select("value").eq("key", POPSG_AI_TAG_CONFIG_KEY).maybeSingle();
    if (error) return { ok: false, done: false, error: "PopSG tagging config unavailable" };
    setting = data?.value;
  }
  let run: ParallelTagRun | null;
  try { run = parallelTagRun(setting, opState.run_id, undefined); }
  catch (error) { return { ok: false, done: false, error: String(error), error_stage: "candidate_fetch" }; }
  if (!run?.discover) return { ok: false, done: false, error: `PopSG tagging requires ${POPSG_AI_TAG_CONFIG_KEY} with discover:true and the operation's run_id` };
  const model = run.models[0];
  // Mark earlier licensed-name tags `suggested` a slice at a time; a failure here never stops tagging.
  const marked = await (deps.demoteNames ?? (async () => demoteLicensedNameTags(await loadLicensedNames())))()
    .catch((error) => { logger.warn(`ai-tag-popsg: name tag marking failed: ${String(error).slice(0, 200)}`); return 0; });
  if (marked) logger.info(`ai-tag-popsg: marked ${marked} licensed-name tags suggested`);
  // Tag changes reach search only when their search records are rebuilt; the
  // hourly job rebuilds ~3,500. Rebuild a bounded slice here so changed tags
  // are searchable within minutes. A failure never stops tagging.
  const synced = await (deps.refreshSearch ?? refreshSearchSlice)()
    .catch((error) => { logger.warn(`ai-tag-popsg: search refresh failed: ${String(error).slice(0, 200)}`); return 0; });
  if (synced) logger.info(`ai-tag-popsg: refreshed ${synced} search records`);
  const cursor = typeof opState.cursor === "string" && opState.cursor ? opState.cursor : null;
  let files: PopSGVisionFile[];
  let states: Map<string, { status: string; attempt_count: number }>;
  try {
    files = await (deps.fetchPage ?? fetchPageDefault)(cursor, run.concurrency * PAGE_MULTIPLIER);
    states = files.length ? await (deps.doneStates ?? doneStatesDefault)(files.map(f => f.id)) : new Map();
  } catch (error) { return { ok: false, done: false, error: String(error), error_stage: "candidate_fetch" }; }
  if (!files.length) {
    // The pass reached the end. Start the next pass while the last hour still
    // tagged something, so failed files get retried; otherwise the run is done.
    if (cursor && await (deps.taggedRecently ?? taggedRecentlyDefault)()) {
      logger.info("ai-tag-popsg: pass finished; starting the next pass");
      return { ok: true, done: false, tagged: 0, skipped: 0, failed: 0, failure_samples: [], skip_samples: [], nextOffset: 0 };
    }
    return { ok: true, done: true, tagged: 0, skipped: 0, failed: 0, failure_samples: [], skip_samples: [], nextOffset: cursor ?? 0 };
  }
  const todo = files.filter(f => states.get(f.id)?.status !== "completed");
  const skipped = files.length - todo.length;
  const tagFile = deps.tagFile ?? tagPopSGFile;
  const results = await settledPool(todo, run.concurrency, f => tagFile(f, model, (states.get(f.id)?.attempt_count ?? 0) + 1));
  let tagged = 0, failed = 0, unavailable = 0;
  const failureSamples: Array<{ at: string; asset_id: string; filename: string; relative_path: string; error: string }> = [];
  results.forEach((r, i) => {
    const v = r.status === "fulfilled" ? r.value : { outcome: "failed" as const, error: String(r.reason).slice(0, 300) };
    if (v.outcome === "tagged") tagged++;
    else if (v.outcome === "unavailable") unavailable++;
    else { failed++; failureSamples.push({ at: new Date().toISOString(), asset_id: todo[i].id, filename: todo[i].filename, relative_path: todo[i].relative_path, error: v.error ?? "AI call failed" }); }
  });
  return { ok: true, done: false, tagged, skipped, failed, visual_analysis_unavailable: unavailable, failure_samples: failureSamples, skip_samples: [], nextOffset: files[files.length - 1].id };
}
