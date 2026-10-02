/**
 * Item short description — "shorten-item-descriptions" operation.
 *
 * Library cover cards show a very short display description. The full ColdLion
 * Item Master description is copied nightly into style_groups.item_description
 * (source 'coldlion') by public.refresh_sku_human_description(), which also
 * enqueues this operation whenever a short description is missing or stale.
 *
 * The model is admin_config.AI_TASK_MODELS.text_classification (normally the
 * direct Meta Muse Spark contributor model). A short description whose source
 * is 'manual' is human-entered and is never overwritten.
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getOpenRouterApiKey } from "../openrouter-key.js";
import type { ChatMessage } from "../openrouter.js";
import { getRuntimeModelCapabilities, type ModelCapabilities } from "../model-capabilities.js";
import { executeStructuredOutput } from "../structured-output.js";
import { isMetaDirectModel, isTerminalMetaModelApiError, metaChatCompletion } from "../meta-model-api.js";
import { getClassificationModel } from "./erp.js";
import type { BatchResult, OpState } from "../types.js";

export const SHORT_DESCRIPTION_MAX_CHARS = 40;
const SCAN_PAGE = 500;
const MAX_PER_TICK = 24;
const CONCURRENCY = 6;
const AI_TIMEOUT_MS = 120_000;

export const SHORT_DESCRIPTION_SCHEMA = {
  type: "object",
  properties: { short_description: { type: "string", maxLength: SHORT_DESCRIPTION_MAX_CHARS } },
  required: ["short_description"],
  additionalProperties: false,
};

export function validateShortDescription(value: Record<string, unknown>): string {
  const raw = value.short_description;
  if (typeof raw !== "string") throw new Error("short_description is required");
  const text = raw.replace(/\s+/g, " ").replace(/^["'\s]+|["'.\s]+$/g, "").trim();
  if (!text) throw new Error("short_description is empty");
  if (text.length > SHORT_DESCRIPTION_MAX_CHARS) throw new Error(`short_description exceeds ${SHORT_DESCRIPTION_MAX_CHARS} characters`);
  return text;
}

export function buildShortDescriptionMessages(fullDescription: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You write very short product labels for a home décor design library. " +
        "Each label is shown on a small card under the licensor and property names.",
    },
    {
      role: "user",
      content:
        `Shorten this item description to a display label of 2 to 6 words and at most ${SHORT_DESCRIPTION_MAX_CHARS} characters.\n` +
        "Keep the product type and the main subject or character. Drop licensor, brand and property names, " +
        "dimensions, sizes, quantities, SKUs and construction codes. Use Title Case. No trailing punctuation.\n" +
        "Examples:\n" +
        '- "Peanuts Printed MDF Wall Plaque Snoopy Happy Easter 14x14\\" x9mm" -> "Snoopy Happy Easter Plaque"\n' +
        '- "Marvel canvas with gel gift set Retro comics characters 4 x 10x13\\"" -> "Retro Comics Canvas Set"\n' +
        '- "NBC Jurassic Park Framed MDF with gel Dino Size Chart Knowledge Poster 14x20\\"" -> "Dino Size Chart Framed Print"\n\n' +
        `Item description: ${fullDescription}`,
    },
  ];
}

const META_CAPABILITIES = (model: string): ModelCapabilities => ({
  modelId: model,
  imageInput: false,
  tools: true,
  toolChoice: true,
  toolChoiceModes: ["auto"],
  structuredOutputs: true,
  jsonObject: true,
  prefer: ["json_schema", "json_object", "tool_auto"],
  source: "override",
  fetchedAt: new Date().toISOString(),
});

async function shortenOne(model: string, apiKey: string, capabilities: ModelCapabilities, fullDescription: string): Promise<string> {
  const directMeta = isMetaDirectModel(model);
  const result = await executeStructuredOutput({
    apiKey,
    model,
    messages: buildShortDescriptionMessages(fullDescription),
    schemaName: "short_description",
    schema: SHORT_DESCRIPTION_SCHEMA,
    capabilities,
    timeoutMs: AI_TIMEOUT_MS,
    maxTokens: 200,
    completion: directMeta ? metaChatCompletion : undefined,
    isTerminalError: directMeta ? isTerminalMetaModelApiError : undefined,
    validate: validateShortDescription,
  });
  return result.value;
}

type GroupRow = {
  id: string;
  item_description: string | null;
  item_short_description_source: string | null;
  item_short_description_input: string | null;
};

export function isStale(row: GroupRow): boolean {
  return !!row.item_description?.trim() &&
    row.item_short_description_source !== "manual" &&
    row.item_short_description_input !== row.item_description;
}

export async function handleShortenItemDescriptions(opState: OpState): Promise<BatchResult> {
  const client = db();
  const model = await getClassificationModel();
  const directMeta = isMetaDirectModel(model);
  const apiKey = directMeta ? config.metaApiKey : await getOpenRouterApiKey();
  if (!apiKey) {
    return { ok: false, done: false, error: `No AI API key configured (set ${directMeta ? "META_API_KEY" : "OPENROUTER_API_KEY"})` };
  }
  const capabilities = directMeta ? META_CAPABILITIES(model) : await getRuntimeModelCapabilities(apiKey, model);

  // Cursor is the last style_groups.id examined (uuid order). 0/empty = start.
  let after = typeof opState.cursor === "string" && opState.cursor.length > 0 ? opState.cursor : null;
  const stale: GroupRow[] = [];
  let scanned = 0;
  let exhausted = false;

  while (stale.length < MAX_PER_TICK) {
    let query = client
      .from("style_groups")
      .select("id, item_description, item_short_description_source, item_short_description_input")
      .eq("item_description_source", "coldlion")
      .not("item_description", "is", null)
      .order("id", { ascending: true })
      .limit(SCAN_PAGE);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) return { ok: false, done: false, error: error.message };
    const rows = (data ?? []) as GroupRow[];
    scanned += rows.length;
    for (const row of rows) {
      after = row.id;
      if (isStale(row)) {
        stale.push(row);
        if (stale.length >= MAX_PER_TICK) break;
      }
    }
    if (rows.length < SCAN_PAGE && stale.length < MAX_PER_TICK) { exhausted = true; break; }
  }

  let shortened = 0;
  let failed = 0;
  const failureSamples: Array<{ id: string; error: string }> = [];

  let terminalError: string | null = null;
  for (let i = 0; i < stale.length && !terminalError; i += CONCURRENCY) {
    await Promise.all(stale.slice(i, i + CONCURRENCY).map(async (row) => {
      const input = row.item_description as string;
      try {
        const short = await shortenOne(model, apiKey, capabilities, input);
        const { error } = await client
          .from("style_groups")
          .update({
            item_short_description: short,
            item_short_description_source: "ai",
            item_short_description_input: input,
            item_short_description_model: model,
            item_short_description_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("item_description", input)
          .or("item_short_description_source.is.null,item_short_description_source.neq.manual");
        if (error) throw new Error(error.message);
        shortened++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        failureSamples.push({ id: row.id, error: msg.slice(0, 300) });
        logger.warn("shorten-item-descriptions: failed", { style_group_id: row.id, error: msg.slice(0, 300) });
        if (directMeta && isTerminalMetaModelApiError(e)) terminalError = msg.slice(0, 300);
      }
    }));
  }

  if (terminalError) return { ok: false, done: false, error: terminalError, shortened, failed };

  return {
    ok: true,
    done: exhausted,
    nextOffset: exhausted ? null : after,
    shortened,
    failed,
    scanned,
    failure_samples: failureSamples,
  };
}
