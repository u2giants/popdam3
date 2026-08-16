import { baseModelId } from "./openrouter.js";
import { logger } from "./logger.js";
import { db } from "./supabase.js";

export type StructuredOutputMethod = "json_schema" | "json_object" | "tool_named" | "tool_required" | "tool_auto" | "json_repair";
export type CapabilitySource = "live" | "stale_cache" | "override" | "unknown";

export interface ModelCapabilities {
  modelId: string;
  imageInput: boolean | null;
  tools: boolean | null;
  toolChoice: boolean | null;
  toolChoiceModes: Array<"named" | "required" | "auto">;
  structuredOutputs: boolean | null;
  jsonObject: boolean | null;
  prefer: StructuredOutputMethod[];
  source: CapabilitySource;
  fetchedAt: string;
}

export interface CapabilityOverride {
  image_input?: boolean;
  tools?: boolean;
  tool_choice?: boolean;
  tool_choice_modes?: Array<"named" | "required" | "auto">;
  structured_outputs?: boolean;
  json_object?: boolean;
  prefer?: StructuredOutputMethod[];
}
export type CapabilityOverrides = Record<string, CapabilityOverride>;

const DEFAULT_OVERRIDES: CapabilityOverrides = {
  "meta/muse-spark-1.2": { tool_choice_modes: ["auto"], prefer: ["json_schema", "json_object", "tool_auto"] },
  "minimax/minimax-m3": { tools: false, prefer: ["json_schema", "json_object"] },
};
const CACHE_MS = 10 * 60_000;
let cache: { fetchedAt: number; models: Map<string, unknown> } | null = null;
let catalogRefresh: Promise<void> | null = null;
let overrideCache: { fetchedAt: number; value: CapabilityOverrides } | null = null;

function boolParam(params: string[], name: string) { return params.includes(name); }
function mergeOverride(profile: ModelCapabilities, override?: CapabilityOverride): ModelCapabilities {
  if (!override) return profile;
  return {
    ...profile,
    imageInput: override.image_input ?? profile.imageInput,
    tools: override.tools ?? profile.tools,
    toolChoice: override.tool_choice ?? profile.toolChoice,
    toolChoiceModes: override.tool_choice_modes ?? profile.toolChoiceModes,
    structuredOutputs: override.structured_outputs ?? profile.structuredOutputs,
    jsonObject: override.json_object ?? profile.jsonObject,
    prefer: override.prefer ?? profile.prefer,
    source: "override",
  };
}

export async function getModelCapabilities(apiKey: string, modelId: string, overrides: CapabilityOverrides = {}): Promise<ModelCapabilities> {
  const bare = baseModelId(modelId);
  let source: CapabilitySource = "live";
  try {
    if (!cache || Date.now() - cache.fetchedAt > CACHE_MS) {
      catalogRefresh ??= (async () => {
        const response = await fetch("https://openrouter.ai/api/v1/models/user", {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
        const payload = await response.json() as { data?: Array<Record<string, unknown>> };
        cache = { fetchedAt: Date.now(), models: new Map((payload.data ?? []).map((item) => [String(item.id), item])) };
      })().finally(() => { catalogRefresh = null; });
      await catalogRefresh;
    }
  } catch (error) {
    if (cache) {
      source = "stale_cache";
      logger.warn("openrouter: capability catalog unavailable; using stale cache", { error: String(error) });
    } else {
      source = "unknown";
      logger.warn("openrouter: capability catalog unavailable; using bounded compatibility plan", { model: bare, error: String(error) });
    }
  }
  const raw = cache?.models.get(bare) as { architecture?: { input_modalities?: string[] }; supported_parameters?: string[] } | undefined;
  if (cache && !raw && source !== "unknown") {
    throw new Error(`Model ${bare} is not available in the OpenRouter account catalog`);
  }
  const params = raw?.supported_parameters ?? [];
  const profile: ModelCapabilities = raw ? {
    modelId: bare,
    imageInput: raw.architecture?.input_modalities?.includes("image") ?? false,
    tools: boolParam(params, "tools"), toolChoice: boolParam(params, "tool_choice"),
    toolChoiceModes: boolParam(params, "tool_choice") ? ["named", "required", "auto"] : [],
    structuredOutputs: boolParam(params, "structured_outputs"),
    jsonObject: boolParam(params, "response_format"), prefer: [], source, fetchedAt: new Date(cache?.fetchedAt ?? Date.now()).toISOString(),
  } : {
    modelId: bare, imageInput: null, tools: null, toolChoice: null,
    toolChoiceModes: [], structuredOutputs: null, jsonObject: null, prefer: [], source: "unknown", fetchedAt: new Date().toISOString(),
  };
  const builtIn = DEFAULT_OVERRIDES[bare];
  const configured = overrides[bare];
  return mergeOverride(profile, builtIn || configured ? { ...builtIn, ...configured } : undefined);
}

export async function getRuntimeModelCapabilities(apiKey: string, modelId: string): Promise<ModelCapabilities> {
  if (!overrideCache || Date.now() - overrideCache.fetchedAt > 60_000) {
    const { data, error } = await db().from("admin_config").select("value").eq("key", "AI_MODEL_CAPABILITY_OVERRIDES").maybeSingle();
    if (error) logger.warn("ai capabilities: override config unavailable; using built-in safety defaults", { error: error.message });
    const value = data?.value;
    overrideCache = { fetchedAt: Date.now(), value: value && typeof value === "object" && !Array.isArray(value) ? value as CapabilityOverrides : {} };
  }
  return getModelCapabilities(apiKey, modelId, overrideCache.value);
}

export function buildStructuredOutputPlan(capabilities: ModelCapabilities, override?: CapabilityOverride): StructuredOutputMethod[] {
  const available: StructuredOutputMethod[] = [];
  if (capabilities.structuredOutputs !== false) available.push("json_schema");
  if (capabilities.jsonObject !== false) available.push("json_object");
  if (capabilities.tools !== false) {
    const modes = capabilities.toolChoiceModes;
    if (modes.includes("named")) available.push("tool_named");
    if (modes.includes("required")) available.push("tool_required");
    if (modes.includes("auto") || capabilities.source === "unknown") available.push("tool_auto");
  }
  const preferred = override?.prefer ?? capabilities.prefer;
  return [...new Set([...preferred.filter((m) => available.includes(m)), ...available])].slice(0, 5);
}

export function resetCapabilityCacheForTests() { cache = null; catalogRefresh = null; overrideCache = null; }
