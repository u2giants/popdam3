/**
 * ScaleDown (scaledown.ai) direct client — bake-off only.
 *
 * ScaleDown sells task-specific small models behind an OpenAI-compatible
 * endpoint. Its `summarize` model accepts an image as a base64 `document`
 * (non-standard field) and answers the system instructions about it. It has
 * no tool calling or json_schema mode, so we ask for JSON in the instructions
 * and parse the `summary` text. Billing is flat per input token
 * (list price $0.05 per 1M tokens, verified 2026-10-14).
 *
 * Key: admin_config.SCALEDOWN_API_KEY, managed in Settings → Processing → AI
 * Tagging. The Railway environment value remains a rollout fallback.
 */
import { getScaleDownApiKey } from "./provider-api-key.js";

export const SCALEDOWN_PREFIX = "scaledown/";
export const SCALEDOWN_SUMMARIZE_MODEL = `${SCALEDOWN_PREFIX}summarize`;
const SCALEDOWN_URL = "https://api.scaledown.xyz/v1/chat/completions";
export const SCALEDOWN_PRICE_PER_TOKEN = 0.05 / 1_000_000;

export function isScaleDownModel(model: string): boolean {
  return model.trim().startsWith(SCALEDOWN_PREFIX);
}

const JSON_INSTRUCTIONS = `

Respond with ONLY one JSON object, no prose and no markdown fences:
{"ai_description": string (one or two sentences),
 "scene_description": string,
 "asset_tags": [{"tag": string}] (8-18 lowercase search tags),
 "character_names": [string] (named licensed characters actually visible),
 "property_name": string or null (franchise/brand)}`;

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`ScaleDown returned no JSON object: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ScaleDown returned non-object JSON");
  return parsed as Record<string, unknown>;
}

/** Accept tags as strings or {tag} objects and return the bake-off shape. */
export function normalizeScaleDownTagData(raw: Record<string, unknown>): Record<string, unknown> {
  const tags = Array.isArray(raw.asset_tags)
    ? raw.asset_tags
      .map((item) => typeof item === "string" ? item : item && typeof item === "object" ? (item as Record<string, unknown>).tag : null)
      .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      .map((tag) => ({ tag: tag.trim() }))
    : [];
  if (typeof raw.ai_description !== "string" || !raw.ai_description.trim()) throw new Error("ScaleDown output missing ai_description");
  if (tags.length === 0) throw new Error("ScaleDown output missing asset_tags");
  return { ...raw, asset_tags: tags };
}

export async function scaleDownTagImage(
  model: string,
  systemPrompt: string,
  image: { base64: string; mimeType: string },
  timeoutMs: number,
  apiKey?: string,
): Promise<{ tagData: Record<string, unknown>; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  const selectedApiKey = apiKey ?? await getScaleDownApiKey();
  if (!selectedApiKey) throw new Error("ScaleDown API key is not configured in Settings");
  const resp = await fetch(SCALEDOWN_URL, {
    method: "POST",
    headers: { "x-api-key": selectedApiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: model.trim().slice(SCALEDOWN_PREFIX.length),
      messages: [
        { role: "system", content: systemPrompt + JSON_INSTRUCTIONS },
        { role: "user", content: "Analyze this design asset image and return the JSON object." },
      ],
      document: image.base64,
      document_mime_type: image.mimeType,
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`ScaleDown ${resp.status}: ${body.slice(0, 300)}`);
  const payload = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const inner = parseJsonObject(content) as { summary?: unknown; finish_reason?: unknown };
  if (typeof inner.summary !== "string") throw new Error("ScaleDown response missing summary");
  if (inner.finish_reason === "length") throw new Error("ScaleDown output hit the 1000-token limit");
  return { tagData: normalizeScaleDownTagData(parseJsonObject(inner.summary)), usage: payload.usage ?? {} };
}
