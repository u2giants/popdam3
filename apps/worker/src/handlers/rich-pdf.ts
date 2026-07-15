/**
 * Rich tech-pack / licensing-sheet PDF extraction (op key: "rich-pdf-extract").
 *
 * Reads extracted PDF text from pdf_text_samples for tech-pack / licensing-sheet
 * PDFs (eligibility via isStyleGuideSourcePdf), asks DeepSeek (direct API, for
 * automatic prefix caching) to convert the text into a strict canonical JSON
 * shape, upserts dam.pdf_rich_extraction, then rolls the result up to the owning
 * style group (refresh_style_group_rich_metadata) and refreshes its search
 * document. See docs/RICH_PDF_EXTRACTION.md.
 *
 * Idempotent: each extraction records source_text_sha256; a PDF whose text is
 * unchanged is skipped on re-run.
 */

import { createHash } from "node:crypto";
import { db } from "../supabase.js";
import { config } from "../config.js";
import { deepSeekChat } from "../deepseek.js";
import { isStyleGuideSourcePdf } from "./ai-tagging-shared.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

export const RICH_PDF_SCHEMA_VERSION = 1;
export const RICH_PDF_PROMPT_VERSION = "rich-pdf-v1";
const DEFAULT_RICH_PDF_MODEL = "deepseek-chat";

/** Canonical field shape (collapsed from the discovery-spike field zoo). */
const RICH_PDF_FIELD_DOC = `{
  "source_files": [{ "name": string, "normalized": string, "confidence": number 0..1 }],
  "style_guide_reference": string | null,
  "approval_date": string(YYYY-MM-DD) | null,
  "submission_date": string(YYYY-MM-DD) | null,
  "production_specs": {
    "dimensions": string | null,
    "materials": string[],
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
    "- 'materials'/'finish'/'hardware' capture production spec bullet values (e.g. MDF, canvas, high-gloss, sawtooth hanger).",
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

/** Normalize the materials array in-place on a parsed extraction object. */
function normalizeExtraction(data: RichPdfData): RichPdfData {
  const ps = (data as { production_specs?: unknown }).production_specs;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) {
    const specs = ps as { materials?: unknown };
    if (Array.isArray(specs.materials)) {
      specs.materials = normalizeMaterialList(specs.materials);
    }
  }
  return data;
}

function docKindFromFilename(filename: string): "tech_pack" | "licensing_sheet" {
  return /licens/i.test(filename) ? "licensing_sheet" : "tech_pack";
}

let cachedModel: { value: string; at: number } | null = null;
async function getRichPdfModel(): Promise<string> {
  if (cachedModel && Date.now() - cachedModel.at < 60_000) return cachedModel.value;
  const client = db();
  const { data } = await client
    .from("admin_config")
    .select("value")
    .eq("key", "AI_TASK_MODELS")
    .maybeSingle();
  const models = (data?.value ?? {}) as Record<string, string>;
  const value = models.rich_pdf_extraction || DEFAULT_RICH_PDF_MODEL;
  cachedModel = { value, at: Date.now() };
  return value;
}

type SampleRow = {
  asset_id: string;
  filename: string | null;
  extracted_text: string | null;
  char_count: number | null;
};

/**
 * One batch: scan pdf_text_samples for eligible tech-pack/licensing PDFs, extract
 * the ones whose text changed since last extraction, roll up + reindex.
 */
export async function handleRichPdfExtract(opState: OpState): Promise<BatchResult> {
  const apiKey = config.deepSeekApiKey;
  if (!apiKey) {
    return {
      ok: false,
      done: false,
      error: "No DeepSeek API key configured (set DEEPSEEK_API_KEY in the Railway worker env; value in 1Password ai-provider-api-keys/deepseek)",
    };
  }

  const model = await getRichPdfModel();
  const client = db();

  const scanWindow = 200;
  const maxScanWindows = 15;
  const batchTarget = 20; // model calls per tick
  const concurrency = 6;

  const offset = typeof opState.cursor === "number" ? opState.cursor : 0;
  let scanOffset = offset;
  let scanned = 0;
  let exhausted = false;

  // 1. Gather eligible samples (with text) until we have a batch or run dry.
  const eligible: SampleRow[] = [];
  for (let i = 0; i < maxScanWindows && eligible.length < batchTarget; i++) {
    const { data: rows, error } = await client
      .from("pdf_text_samples")
      .select("asset_id, filename, extracted_text, char_count")
      .not("extracted_text", "is", null)
      .gte("char_count", 50)
      .order("asset_id", { ascending: true })
      .range(scanOffset, scanOffset + scanWindow - 1);
    if (error) return { ok: false, done: false, error: error.message };

    const window = (rows ?? []) as SampleRow[];
    if (window.length === 0) { exhausted = true; break; }
    scanned += window.length;
    scanOffset += window.length;

    for (const r of window) {
      if (r.filename && isStyleGuideSourcePdf({ filename: r.filename, file_type: "pdf" }) && r.extracted_text) {
        eligible.push(r);
      }
    }
    if (window.length < scanWindow) { exhausted = true; break; }
  }

  if (eligible.length === 0) {
    return { ok: true, done: exhausted, processed: 0, skipped: 0, scanned, nextOffset: scanOffset };
  }

  const assetIds = eligible.map((r) => r.asset_id);

  // 2. Resolve assets (skip deleted; need style_group_id + sku).
  const { data: assetRows, error: assetErr } = await client
    .from("assets")
    .select("id, sku, style_group_id, is_deleted")
    .in("id", assetIds);
  if (assetErr) return { ok: false, done: false, error: assetErr.message };
  const assetById = new Map(
    (assetRows ?? [])
      .filter((a) => !a.is_deleted)
      .map((a) => [a.id as string, a as { id: string; sku: string | null; style_group_id: string | null }]),
  );

  // 3. Skip unchanged extractions (idempotency by source_text_sha256).
  //    dam.* is not exposed to PostgREST, so go through the public RPC wrapper.
  const { data: existing, error: exErr } = await client.rpc("get_pdf_rich_extraction_hashes", {
    p_asset_ids: assetIds,
  });
  if (exErr) return { ok: false, done: false, error: exErr.message };
  const existingHash = new Map(
    ((existing ?? []) as Array<{ asset_id: string; source_text_sha256: string | null }>).map((e) => [
      e.asset_id,
      e.source_text_sha256,
    ]),
  );

  const work = eligible.filter((r) => {
    const asset = assetById.get(r.asset_id);
    if (!asset) return false; // deleted / missing
    const hash = sha256(r.extracted_text as string);
    return existingHash.get(r.asset_id) !== hash;
  });

  let processed = 0;
  let failed = 0;
  const affectedGroups = new Set<string>();
  const system = buildRichPdfSystemPrompt();

  // 4. Extract with bounded concurrency.
  for (let i = 0; i < work.length; i += concurrency) {
    const slice = work.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (r) => {
        const asset = assetById.get(r.asset_id)!;
        const text = r.extracted_text as string;
        const hash = sha256(text);
        const docKind = docKindFromFilename(r.filename ?? "");
        try {
          const result = await deepSeekChat({
            apiKey,
            model,
            system,
            user: `Document kind: ${docKind}\nFilename: ${r.filename ?? ""}\n\nPDF TEXT:\n${text}`,
          });
          const data = normalizeExtraction(parseRichPdfData(result.content));
          const { error: upErr } = await client.rpc("upsert_pdf_rich_extraction", {
            p_asset_id: r.asset_id,
            p_style_group_id: asset.style_group_id,
            p_sku: asset.sku,
            p_doc_kind: docKind,
            p_data: data,
            p_source_text_sha256: hash,
            p_model: result.model,
            p_prompt_version: RICH_PDF_PROMPT_VERSION,
            p_schema_version: RICH_PDF_SCHEMA_VERSION,
            p_parse_error: null,
          });
          if (upErr) throw new Error(upErr.message);
          if (asset.style_group_id) affectedGroups.add(asset.style_group_id);
          processed++;
        } catch (err) {
          failed++;
          logger.warn(`rich-pdf extract failed for asset ${r.asset_id}: ${(err as Error).message}`);
          // Persist the failure so we don't hot-loop the same asset every tick.
          await client.rpc("upsert_pdf_rich_extraction", {
            p_asset_id: r.asset_id,
            p_style_group_id: asset.style_group_id,
            p_sku: asset.sku,
            p_doc_kind: docKind,
            p_data: {},
            p_source_text_sha256: hash,
            p_model: model,
            p_prompt_version: RICH_PDF_PROMPT_VERSION,
            p_schema_version: RICH_PDF_SCHEMA_VERSION,
            p_parse_error: (err as Error).message.slice(0, 500),
          });
        }
      }),
    );
  }

  // 5. Roll up affected groups + refresh their search documents.
  for (const gid of affectedGroups) {
    const { error: rollupErr } = await client.rpc("refresh_style_group_rich_metadata", { p_style_group_id: gid });
    if (rollupErr) logger.warn(`refresh_style_group_rich_metadata failed for ${gid}: ${rollupErr.message}`);
    const { error: searchErr } = await client.rpc("refresh_dam_search_style_group_document", { p_style_group_id: gid });
    if (searchErr) logger.warn(`refresh_dam_search_style_group_document failed for ${gid}: ${searchErr.message}`);
  }

  return {
    ok: true,
    done: exhausted && work.length === 0,
    processed,
    failed,
    skipped: eligible.length - work.length,
    groups_rolled_up: affectedGroups.size,
    scanned,
    nextOffset: scanOffset,
  };
}
