import { modelAllowedForTask, normalizeAiModelPool, sameAiModelPool, type AiModelPool } from "./ai-model-options";

export type AdminApiCall = (
  action: string,
  payload?: Record<string, unknown>,
) => Promise<AdminApiResponse>;

interface AdminApiResponse {
  ok?: boolean;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AiModelConfigDraft {
  modelsJson: string;
  taskModels: Record<string, string>;
  savedTaskModels?: Record<string, string>;
  displayNames: Record<string, string>;
  modelPool: AiModelPool;
  openRouterKey: string;
  googleKey: string;
  metaKey: string;
  scaleDownKey: string;
  anthropicKey: string;
  openaiKey: string;
  configuredKeys?: Partial<Record<AiModelKeyField, boolean>>;
  clearKeys?: AiModelKeyField[];
}

export type AiModelKeyField = "openRouterKey" | "googleKey" | "metaKey" | "scaleDownKey" | "anthropicKey" | "openaiKey";

const KEY_ROWS: ReadonlyArray<[AiModelKeyField, string]> = [
  ["openRouterKey", "OPENROUTER_API_KEY"],
  ["googleKey", "GOOGLE_AI_API_KEY"],
  ["metaKey", "META_API_KEY"],
  ["scaleDownKey", "SCALEDOWN_API_KEY"],
  ["anthropicKey", "ANTHROPIC_API_KEY"],
  ["openaiKey", "OPENAI_API_KEY"],
];

/** Key-order-independent equality: jsonb does not preserve object key order. */
export function sameTaskModels(stored: unknown, expected: Record<string, string>): boolean {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const storedEntries = Object.entries(stored as Record<string, unknown>);
  const expectedKeys = Object.keys(expected);
  return storedEntries.length === expectedKeys.length
    && storedEntries.every(([key, value]) => Object.prototype.hasOwnProperty.call(expected, key) && expected[key] === value);
}

function unwrapConfigValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

export async function saveAiModelPool(
  call: AdminApiCall,
  pool: AiModelPool,
): Promise<AdminApiResponse> {
  const expectedModelPool = normalizeAiModelPool(pool);
  await call("set-config", { entries: { AI_MODEL_POOL: expectedModelPool } });

  const confirmed = await call("get-config", { keys: ["AI_MODEL_POOL"] });
  const storedModelPool = unwrapConfigValue(confirmed?.config?.AI_MODEL_POOL) ?? {};
  if (!sameAiModelPool(storedModelPool, expectedModelPool)) {
    throw new Error("Model Pool was not persisted. Please retry.");
  }
  return confirmed;
}

export async function saveAiModelConfig(
  call: AdminApiCall,
  draft: AiModelConfigDraft,
): Promise<AdminApiResponse> {
  let models: unknown;
  try {
    models = draft.modelsJson.trim() ? JSON.parse(draft.modelsJson) : [];
  } catch {
    throw new Error("Invalid JSON in AI Models");
  }

  // The click handler passes a snapshot so a later React render cannot change
  // which task-model selection is sent while the request is in flight.
  const expectedTaskModels = { ...draft.taskModels };
  const expectedModelPool = normalizeAiModelPool(draft.modelPool);
  const clearKeys = new Set(draft.clearKeys ?? []);
  for (const [taskKey, modelId] of Object.entries(expectedTaskModels)) {
    const selectionChanged = modelId !== (draft.savedTaskModels?.[taskKey] ?? "");
    if (selectionChanged && !modelAllowedForTask(modelId, taskKey, taskKey.endsWith("_fallback"))) {
      throw new Error("This provider-specific model is not supported for that task. Direct Gemini Batch is only available for primary Image Tagging; ScaleDown is only available for PDF Text Extraction.");
    }
  }
  const primaryVision = expectedTaskModels.vision_tagging?.trim() ?? "";
  const googleKeyWillBeConfigured = !clearKeys.has("googleKey")
    && (draft.googleKey.trim().length > 0 || draft.configuredKeys?.googleKey === true);
  if (primaryVision.startsWith("google-direct/") && primaryVision.endsWith(":batch") && !googleKeyWillBeConfigured) {
    throw new Error("Save a Google AI API key before selecting Direct Gemini Batch.");
  }
  const metaKeyWillBeConfigured = !clearKeys.has("metaKey")
    && (draft.metaKey.trim().length > 0 || draft.configuredKeys?.metaKey === true);
  const selectsMetaDirect = Object.values(expectedTaskModels).some((model) =>
    typeof model === "string" && model.trim().startsWith("meta-direct/")
  );
  const changesToMetaDirect = Object.entries(expectedTaskModels).some(([taskKey, model]) =>
    typeof model === "string"
      && model.trim().startsWith("meta-direct/")
      && model.trim() !== (draft.savedTaskModels?.[taskKey] ?? "").trim()
  );
  if ((changesToMetaDirect && !metaKeyWillBeConfigured) || (selectsMetaDirect && clearKeys.has("metaKey"))) {
    throw new Error("Save a Meta Model API key before selecting a Meta Direct model.");
  }
  const entries: Record<string, unknown> = {
    AI_MODELS: models,
    AI_TASK_MODELS: expectedTaskModels,
    AI_MODEL_DISPLAY_NAMES: { ...draft.displayNames },
    AI_MODEL_POOL: expectedModelPool,
  };
  const expectedKeys: Record<string, boolean> = {};
  for (const [field, row] of KEY_ROWS) {
    const value = draft[field].trim();
    const shouldWrite = clearKeys.has(field) || value.length > 0;
    if (shouldWrite) {
      entries[row] = clearKeys.has(field) ? "" : value;
      expectedKeys[row] = !clearKeys.has(field);
    }
  }

  await call("set-config", { entries });

  // Do not report success from the write response alone. Read the authoritative
  // values back through the same admin contract and prove the selected models
  // and every changed (including cleared) key are what production stored.
  const confirmed = await call("get-config", { keys: ["AI_TASK_MODELS", "AI_MODEL_POOL", ...Object.keys(expectedKeys)] });
  const storedTaskModels = unwrapConfigValue(confirmed?.config?.AI_TASK_MODELS) ?? {};
  if (!sameTaskModels(storedTaskModels, expectedTaskModels)) {
    throw new Error("AI model selection was not persisted. Please retry.");
  }
  const storedModelPool = unwrapConfigValue(confirmed?.config?.AI_MODEL_POOL) ?? {};
  if (!sameAiModelPool(storedModelPool, expectedModelPool)) {
    throw new Error("Model Pool was not persisted. Please retry.");
  }
  for (const [row, value] of Object.entries(expectedKeys)) {
    const stored = confirmed?.config?.[row] as { configured?: unknown } | undefined;
    if (stored?.configured !== value) {
      throw new Error(value ? "An API key change was not persisted. Please retry." : "An API key was not cleared. Please retry.");
    }
  }

  return confirmed;
}
