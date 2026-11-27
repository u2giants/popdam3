/**
 * Rich tech-pack / licensing-sheet PDF extraction (op key: "rich-pdf-extract").
 *
 * Reads extracted PDF text from pdf_text_samples for tech-pack / licensing-sheet
 * PDFs (eligibility via isStyleGuideSourcePdf), sends them to Claude Haiku 5.5
 * (low effort) through the Anthropic Message Batches API, upserts
 * dam.pdf_rich_extraction from the results, then rolls each style group up
 * (refresh_style_group_rich_metadata) and refreshes its search document.
 * A batch not finished within 30 minutes is cancelled and its unfinished items
 * are read with direct Haiku calls instead. See docs/RICH_PDF_EXTRACTION.md.
 *
 * Idempotent: each extraction records source_text_sha256 (text + prompt
 * version); a PDF whose text and prompt are unchanged is skipped on re-run.
 */

import { createHash } from "node:crypto";
import { db } from "../supabase.js";
import { config } from "../config.js";
import Anthropic from "@anthropic-ai/sdk";
import { isStyleGuideSourcePdf } from "./ai-tagging-shared.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

export const RICH_PDF_SCHEMA_VERSION = 1;
export const RICH_PDF_PROMPT_VERSION = "rich-pdf-v2";
/** Owner decision 2026-11-27 (bake-off on #1488): Claude Haiku 5.5, low effort, Message Batches. */
export const RICH_PDF_MODEL = "claude-haiku-5-5";
export const RICH_PDF_EFFORT = "low";

/** Canonical field shape (collapsed from the discovery-spike field zoo). */
const RICH_PDF_FIELD_DOC = `{
  "source_files": [{ "name": string, "normalized": string, "confidence": number 0..1 }],
  "style_guide_reference": string | null,
  "approval_date": string(YYYY-MM-DD) | null,
  "submission_date": string(YYYY-MM-DD) | null,
  "production_specs": {
    "dimensions": string | null,
    "materials": string[],
    "component_materials": string[],
    "finish": string[],
    "hardware": string[],
    "packaging": string | null,
    "print_process": string | null,
    "construction_notes": string | null
  } | null,
  "compliance": {
    "regulatory": string[],
    "age_rating": string | null,
    "warnings": string[],
    "country_of_origin": string | null
  } | null,
  "legal": {
    "copyright": string[],
    "required_text": string[],
    "placement": string | null,
    "font_size": string | null
  } | null,
  "manufacturer": { "name": string | null, "address": string | null } | null,
  "colors": [{ "pantone": string | null, "name": string | null }],
  "retailer_program": string | null,
  "season": string | null
}`;

/**
 * Stable system prompt (instructions + schema). This is IDENTICAL for every
 * call, so it forms DeepSeek's cacheable prefix — keep it constant.
 */
export function buildRichPdfSystemPrompt(): string {
  return [
    "You extract structured product data from a licensed-product tech pack or licensing sheet.",
    "You are given the plain text of one PDF. Return ONLY a single JSON object matching this shape:",
    RICH_PDF_FIELD_DOC,
    "",
    "Rules:",
    "- Use only information present in the text. Never invent values.",
    "- Every field is optional: use null for missing scalars and [] for missing arrays.",
    "- Dates as YYYY-MM-DD when a full date is present; otherwise null.",
    "- 'source_files' = entries from any 'Files Used' / 'Source Files' / 'Art Files' section; 'normalized' is the filename lowercased with surrounding whitespace trimmed.",
    "- 'materials' = ONLY the main body material(s) the product itself is made of, most important first, usually one value (e.g. MDF, CANVAS, 100% COTTON BLEND, METAL, CERAMIC, PLASTIC). For a printed piece, the material the art is printed on or mounted to. Never list hangers, hooks, ropes, dowels, frames or moulding of a framed print, glass/acrylic glazing, backing boards, inserts, easels, mechanisms, batteries, labels, stickers or packaging here.",
    "- 'component_materials' = every other material call-out (frame, glass covering, backing board, insert, hanging rope, dowel, hardware materials), as written.",
    "- 'finish'/'hardware' capture finishes (e.g. high-gloss, sugar glitter) and hardware (e.g. sawtooth hanger, keyhole hanger, easel back).",
    "- 'packaging' = how the product is packed (e.g. OPP bag, header card, UPC sticker); never a product material.",
    "- 'regulatory'/'warnings' capture compliance/legal requirements (e.g. TSCA Title VI, CARB Phase 2, Prop 65, 'not a toy').",
    "- Respond with the json object only. No markdown, no commentary.",
  ].join("\n");
}

export interface RichPdfData {
  [key: string]: unknown;
}

/** Parse + lightly validate the model's JSON. Throws on unusable output. */
export function parseRichPdfData(content: string): RichPdfData {
  let text = content.trim();
  // Tolerate accidental code fences.
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Salvage the outermost object if the model added stray prose.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(text.slice(start, end + 1));
    } else {
      throw new Error("Rich-PDF model did not return JSON");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Rich-PDF model returned non-object JSON");
  }
  return parsed as RichPdfData;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Normalize a materials list so the DAM Material facet doesn't split on casing
 * or whitespace noise (canvas / Canvas / CANVAS / " canvas "). Uppercasing is
 * acronym-safe (MDF, DIY, GSM stay intact) and fully dedupes case variants.
 * Genuinely different values (CANVAS vs PLAIN CANVAS) are preserved. Exported
 * for reuse by the one-time backfill-cleanup path and tests.
 */
export function normalizeMaterialList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const norm = raw.trim().replace(/\s+/g, " ").toUpperCase();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/** Call-outs that are never the product's main body material. */
const NON_BODY_MATERIAL =
  /\b(HANGERS?|HOOKS?|SAWTOOTH|KEYHOLE|ROPES?|DOWELS?|EASEL|UPC|STICKERS?|LABELS?|PACKAG\w*|OPP|POLYBAG|HEADER ?CARD|BATTER(Y|IES)|MECHANISM|BACKING|BACKER|INSERT|GLASS COVERING|SCREWS?|NAILS?)\b/;

/**
 * Keep only main body materials in `materials` (feeds assets.product_material);
 * move frame/hanger/backing/packaging call-outs that slipped through into
 * `component_materials`. Exported for tests.
 */
export function splitMainMaterials(materials: unknown, components: unknown): { materials: string[]; component_materials: string[] } {
  const main: string[] = [];
  const real = (m: string) => /[A-Z0-9]/.test(m); // drop OCR bullets like "•"
  const other = normalizeMaterialList(components).filter(real);
  for (const m of normalizeMaterialList(materials).filter(real)) {
    if (NON_BODY_MATERIAL.test(m)) {
      if (!other.includes(m)) other.push(m);
    } else main.push(m);
  }
  return { materials: main, component_materials: other };
}

/** Normalize the materials arrays in-place on a parsed extraction object. */
function normalizeExtraction(data: RichPdfData): RichPdfData {
  const ps = (data as { production_specs?: unknown }).production_specs;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) {
    const specs = ps as { materials?: unknown; component_materials?: unknown };
    Object.assign(specs, splitMainMaterials(specs.materials, specs.component_materials));
  }
  return data;
}

/**
 * Idempotency key stored in source_text_sha256: the prompt version is folded in
 * so a prompt change re-extracts every PDF once (the hash RPC does not return
 * prompt_version), while unchanged text under the same prompt is still skipped.
 */
export function richPdfSourceKey(text: string, promptVersion = RICH_PDF_PROMPT_VERSION): string {
  return sha256(`${promptVersion}\n${text}`);
}

function docKindFromFilename(filename: string): "tech_pack" | "licensing_sheet" {
  return /licens/i.test(filename) ? "licensing_sheet" : "tech_pack";
}

export interface RichPdfExtractionState {
  source_text_sha256: string | null;
  parse_error: string | null;
  extracted_at: string | null;
}

/** Successful hashes remain idempotent; provider failures retry after a cooldown. */
export function shouldExtractRichPdf(
  existing: RichPdfExtractionState | undefined,
  hash: string,
  now = Date.now(),
  retryAfterHours = 24,
): boolean {
  if (!existing || existing.source_text_sha256 !== hash) return true;
  if (existing.parse_error == null) return false;
  const extracted = Date.parse(existing.extracted_at ?? "");
  const hours = Number.isFinite(retryAfterHours) && retryAfterHours > 0 ? retryAfterHours : 24;
  return Number.isFinite(extracted) && now - extracted >= hours * 60 * 60 * 1000;
}

type SampleRow = {
  asset_id: string;
  filename: string | null;
  extracted_text: string | null;
  char_count: number | null;
};

/** One PDF sent to the model; enough to write its row once the answer is back. */
export interface RichPdfItem {
  asset_id: string;
  style_group_id: string | null;
  sku: string | null;
  doc_kind: "tech_pack" | "licensing_sheet";
  hash: string;
}

/** The batch in flight, kept in admin_config so a worker restart resumes it. */
export interface PendingRichPdfBatch {
  batch_id: string;
  submitted_at: string;
  cursor_after: number;
  items: RichPdfItem[];
}

export const PENDING_BATCH_KEY = "RICH_PDF_PENDING_BATCH";
/** Owner rule: no automated hold longer than 30 minutes. */
export const BATCH_MAX_WAIT_MS = 30 * 60 * 1000;
const POLL_SLEEP_MS = 20_000;

export function richPdfUserMessage(docKind: string, filename: string, text: string): string {
  return `Document kind: ${docKind}\nFilename: ${filename}\n\nPDF TEXT:\n${text}\n\nReturn the json object.`;
}

export function richPdfRequestParams(user: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: RICH_PDF_MODEL,
    max_tokens: 16000,
    system: buildRichPdfSystemPrompt(),
    messages: [{ role: "user", content: user }],
    output_config: { effort: RICH_PDF_EFFORT },
  } as Anthropic.MessageCreateParamsNonStreaming;
}

/** Text of a Claude reply; a refusal or a cut-off reply is a failure. */
export function messageText(m: Pick<Anthropic.Message, "stop_reason" | "content">): string {
  if (m.stop_reason === "refusal") throw new Error("model refused");
  if (m.stop_reason === "max_tokens") throw new Error("reply cut off at max_tokens");
  return m.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
}

/** Whether a pending batch has waited past the 30-minute limit. */
export function batchOverdue(pending: Pick<PendingRichPdfBatch, "submitted_at">, now = Date.now()): boolean {
  const t = Date.parse(pending.submitted_at);
  return !Number.isFinite(t) || now - t >= BATCH_MAX_WAIT_MS;
}

let anthropicClient: Anthropic | null = null;
function anthropic(apiKey: string): Anthropic {
  anthropicClient ??= new Anthropic({ apiKey, maxRetries: 4 });
  return anthropicClient;
}

async function readPending(): Promise<PendingRichPdfBatch | null> {
  const { data, error } = await db().from("admin_config").select("value").eq("key", PENDING_BATCH_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = data?.value as PendingRichPdfBatch | null | undefined;
  return v && typeof v.batch_id === "string" ? v : null;
}

async function writePending(value: PendingRichPdfBatch | null): Promise<void> {
  const { error } = await db().from("admin_config").upsert({ key: PENDING_BATCH_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Save one model answer (or failure) and note the style group to roll up. */
async function saveResult(item: RichPdfItem, outcome: { text: string } | { error: string }, groups: Set<string>): Promise<boolean> {
  const client = db();
  let data: RichPdfData = {};
  let parseError: string | null = null;
  if ("text" in outcome) {
    try { data = normalizeExtraction(parseRichPdfData(outcome.text)); } catch (e) { parseError = (e as Error).message; }
  } else parseError = outcome.error;
  const { error } = await client.rpc("upsert_pdf_rich_extraction", {
    p_asset_id: item.asset_id,
    p_style_group_id: item.style_group_id,
    p_sku: item.sku,
    p_doc_kind: item.doc_kind,
    p_data: parseError ? {} : data,
    p_source_text_sha256: item.hash,
    p_model: RICH_PDF_MODEL,
    p_prompt_version: RICH_PDF_PROMPT_VERSION,
    p_schema_version: RICH_PDF_SCHEMA_VERSION,
    p_parse_error: parseError ? parseError.slice(0, 500) : null,
  });
  if (error) throw new Error(`upsert_pdf_rich_extraction failed for ${item.asset_id}: ${error.message}`);
  if (!parseError && item.style_group_id) groups.add(item.style_group_id);
  return !parseError;
}

async function rollUp(groups: Set<string>, concurrency = 6): Promise<void> {
  const client = db();
  const ids = [...groups];
  for (let i = 0; i < ids.length; i += concurrency) {
    await Promise.all(ids.slice(i, i + concurrency).map(async (gid) => {
      const { error: rollupErr } = await client.rpc("refresh_style_group_rich_metadata", { p_style_group_id: gid });
      if (rollupErr) logger.warn(`refresh_style_group_rich_metadata failed for ${gid}: ${rollupErr.message}`);
      const { error: searchErr } = await client.rpc("refresh_dam_search_style_group_document", { p_style_group_id: gid });
      if (searchErr) logger.warn(`refresh_dam_search_style_group_document failed for ${gid}: ${searchErr.message}`);
    }));
  }
}

/** Fallback for a batch past 30 minutes: read the unfinished items directly. */
async function readDirect(apiKey: string, items: RichPdfItem[], groups: Set<string>): Promise<{ ok: number; failed: number }> {
  const client = db();
  const { data: rows, error } = await client.from("pdf_text_samples").select("asset_id, filename, extracted_text").in("asset_id", items.map((i) => i.asset_id));
  if (error) throw new Error(error.message);
  const textById = new Map((rows ?? []).map((r) => [r.asset_id as string, r as { filename: string | null; extracted_text: string | null }]));
  let ok = 0, failed = 0;
  const concurrency = 6;
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(async (item) => {
      const row = textById.get(item.asset_id);
      let outcome: { text: string } | { error: string };
      if (!row?.extracted_text) outcome = { error: "PDF text no longer available" };
      else {
        try {
          const m = await anthropic(apiKey).messages.create(richPdfRequestParams(richPdfUserMessage(item.doc_kind, row.filename ?? "", row.extracted_text)));
          outcome = { text: messageText(m) };
        } catch (e) { outcome = { error: (e as Error).message }; }
      }
      if (await saveResult(item, outcome, groups)) ok++; else failed++;
    }));
  }
  return { ok, failed };
}

/** Collect eligible PDFs whose text or prompt changed since their last reading. */
async function gatherWork(offset: number, target: number): Promise<{ items: RichPdfItem[]; texts: Map<string, { filename: string; text: string }>; scanned: number; scanOffset: number; exhausted: boolean; skipped: number }> {
  const client = db();
  const scanWindow = 1000;
  const maxScanWindows = 20;
  let scanOffset = offset, scanned = 0, exhausted = false, skipped = 0;
  const items: RichPdfItem[] = [];
  const texts = new Map<string, { filename: string; text: string }>();
  const retryAfterHours = Number(process.env.RICH_PDF_RETRY_AFTER_HOURS ?? 24);

  for (let w = 0; w < maxScanWindows && items.length < target; w++) {
    const { data: rows, error } = await client
      .from("pdf_text_samples")
      .select("asset_id, filename, extracted_text, char_count")
      .not("extracted_text", "is", null)
      .gte("char_count", 50)
      .order("asset_id", { ascending: true })
      .range(scanOffset, scanOffset + scanWindow - 1);
    if (error) throw new Error(error.message);
    const window = (rows ?? []) as SampleRow[];
    if (window.length === 0) { exhausted = true; break; }
    scanned += window.length;
    scanOffset += window.length;

    const eligible = window.filter((r) => r.filename && r.extracted_text && isStyleGuideSourcePdf({ filename: r.filename, file_type: "pdf" }));
    if (eligible.length > 0) {
      const ids = eligible.map((r) => r.asset_id);
      const [{ data: assetRows, error: assetErr }, { data: existing, error: exErr }] = await Promise.all([
        client.from("assets").select("id, sku, style_group_id, is_deleted").in("id", ids),
        // dam.* is not exposed to PostgREST, so go through the public RPC wrapper.
        client.rpc("get_pdf_rich_extraction_hashes", { p_asset_ids: ids }),
      ]);
      if (assetErr) throw new Error(assetErr.message);
      if (exErr) throw new Error(exErr.message);
      const assetById = new Map((assetRows ?? []).filter((a) => !a.is_deleted).map((a) => [a.id as string, a]));
      const existingByAsset = new Map(((existing ?? []) as Array<RichPdfExtractionState & { asset_id: string }>).map((r) => [r.asset_id, r]));
      const now = Date.now();
      for (const r of eligible) {
        const asset = assetById.get(r.asset_id);
        if (!asset) continue;
        const hash = richPdfSourceKey(r.extracted_text as string);
        if (!shouldExtractRichPdf(existingByAsset.get(r.asset_id), hash, now, retryAfterHours)) { skipped++; continue; }
        const docKind = docKindFromFilename(r.filename ?? "");
        items.push({ asset_id: r.asset_id, style_group_id: (asset.style_group_id as string | null) ?? null, sku: (asset.sku as string | null) ?? null, doc_kind: docKind, hash });
        texts.set(r.asset_id, { filename: r.filename ?? "", text: r.extracted_text as string });
      }
    }
    if (window.length < scanWindow) { exhausted = true; break; }
  }
  return { items, texts, scanned, scanOffset, exhausted, skipped };
}

/**
 * One tick. With a batch in flight: wait briefly, apply results when it has
 * ended, or switch to direct reads past 30 minutes. Otherwise gather the next
 * PDFs and submit them as one batch.
 */
export async function handleRichPdfExtract(opState: OpState): Promise<BatchResult> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    return { ok: false, done: false, error: "No Anthropic API key configured (set ANTHROPIC_API_KEY in the Railway worker env)" };
  }
  const offset = typeof opState.cursor === "number" ? opState.cursor : 0;
  const groups = new Set<string>();

  try {
    const pending = await readPending();
    if (pending) {
      const client = anthropic(apiKey);
      let batch = await client.messages.batches.retrieve(pending.batch_id);
      if (batch.processing_status !== "ended" && !batchOverdue(pending)) {
        await new Promise((r) => setTimeout(r, POLL_SLEEP_MS));
        batch = await client.messages.batches.retrieve(pending.batch_id);
      }
      if (batch.processing_status !== "ended") {
        if (!batchOverdue(pending)) {
          return { ok: true, done: false, processed: 0, batch_id: pending.batch_id, batch_waiting: pending.items.length, nextOffset: offset };
        }
        // Past 30 minutes: stop waiting. Cancel, then read whatever the batch did not finish.
        logger.warn(`rich-pdf batch ${pending.batch_id} unfinished after 30 min; cancelling and reading directly`);
        await client.messages.batches.cancel(pending.batch_id).catch((e) => logger.warn(`cancel failed: ${(e as Error).message}`));
      }
      const byId = new Map(pending.items.map((i) => [i.asset_id, i]));
      const done = new Set<string>();
      let processed = 0, failed = 0;
      if (batch.processing_status === "ended" || batch.results_url) {
        for await (const res of await client.messages.batches.results(pending.batch_id)) {
          const item = byId.get(res.custom_id);
          if (!item) continue;
          if (res.result.type === "succeeded") {
            let outcome: { text: string } | { error: string };
            try { outcome = { text: messageText(res.result.message) }; } catch (e) { outcome = { error: (e as Error).message }; }
            if (await saveResult(item, outcome, groups)) processed++; else failed++;
            done.add(item.asset_id);
          } else if (res.result.type === "errored" && res.result.error.error?.type === "invalid_request_error") {
            await saveResult(item, { error: `batch request rejected: ${res.result.error.error.message ?? "invalid request"}` }, groups);
            failed++; done.add(item.asset_id);
          }
          // errored (server), canceled, expired: left for the direct fallback below.
        }
      }
      const rest = pending.items.filter((i) => !done.has(i.asset_id));
      if (rest.length > 0) {
        const direct = await readDirect(apiKey, rest, groups);
        processed += direct.ok; failed += direct.failed;
      }
      await rollUp(groups);
      await writePending(null);
      return { ok: true, done: false, processed, failed, groups_rolled_up: groups.size, batch_id: pending.batch_id, nextOffset: pending.cursor_after };
    }

    const batchTarget = Number(process.env.RICH_PDF_BATCH_SIZE ?? 1000);
    const work = await gatherWork(offset, Number.isFinite(batchTarget) && batchTarget > 0 ? batchTarget : 1000);
    if (work.items.length === 0) {
      return { ok: true, done: work.exhausted, processed: 0, skipped: work.skipped, scanned: work.scanned, nextOffset: work.scanOffset };
    }
    const batch = await anthropic(apiKey).messages.batches.create({
      requests: work.items.map((item) => {
        const t = work.texts.get(item.asset_id)!;
        return { custom_id: item.asset_id, params: richPdfRequestParams(richPdfUserMessage(item.doc_kind, t.filename, t.text)) };
      }),
    });
    await writePending({ batch_id: batch.id, submitted_at: new Date().toISOString(), cursor_after: work.scanOffset, items: work.items });
    logger.info(`rich-pdf batch ${batch.id} submitted with ${work.items.length} PDFs`);
    return { ok: true, done: false, processed: 0, submitted: work.items.length, skipped: work.skipped, scanned: work.scanned, batch_id: batch.id, nextOffset: offset };
  } catch (err) {
    return { ok: false, done: false, error: (err as Error).message };
  }
}
