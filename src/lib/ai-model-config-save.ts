import { modelAllowedForTask } from "./ai-model-options";

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
  displayNames: Record<string, string>;
  openRouterKey: string;
  googleKey: string;
  anthropicKey: string;
  openaiKey: string;
  /**
   * The key values the form was loaded with. When present, a key whose field
   * now differs (including a field cleared to blank) is written and then read
   * back; unchanged keys are not rewritten. Without it, only non-blank keys are
   * written (legacy behavior).
   */
  savedKeys?: Partial<Record<KeyField, string>>;
}

type KeyField = "openRouterKey" | "googleKey" | "anthropicKey" | "openaiKey";

const KEY_ROWS: ReadonlyArray<[KeyField, string]> = [
  ["openRouterKey", "OPENROUTER_API_KEY"],
  ["googleKey", "GOOGLE_AI_API_KEY"],
  ["anthropicKey", "ANTHROPIC_API_KEY"],
  ["openaiKey", "OPENAI_API_KEY"],
];

function unwrapConfigValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
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
  for (const [taskKey, modelId] of Object.entries(expectedTaskModels)) {
    if (!modelAllowedForTask(modelId, taskKey, taskKey.endsWith("_fallback"))) {
      throw new Error("Batch-only models (including Direct Gemini Batch) may only be selected as the primary Image Tagging model.");
    }
  }
  const primaryVision = expectedTaskModels.vision_tagging?.trim() ?? "";
  if (primaryVision.startsWith("google-direct/") && primaryVision.endsWith(":batch") && !draft.googleKey.trim()) {
    throw new Error("Save a Google AI API key before selecting Direct Gemini Batch.");
  }
  const entries: Record<string, unknown> = {
    AI_MODELS: models,
    AI_TASK_MODELS: expectedTaskModels,
    AI_MODEL_DISPLAY_NAMES: { ...draft.displayNames },
  };
  const expectedKeys: Record<string, string> = {};
  for (const [field, row] of KEY_ROWS) {
    const value = draft[field].trim();
    const changed = draft.savedKeys
      ? value !== (draft.savedKeys[field] ?? "").trim()
      : value.length > 0;
    if (changed) {
      entries[row] = value;
      expectedKeys[row] = value;
    }
  }

  await call("set-config", { entries });

  // Do not report success from the write response alone. Read the authoritative
  // values back through the same admin contract and prove the selected models
  // and every changed (including cleared) key are what production stored.
  const confirmed = await call("get-config", { keys: ["AI_TASK_MODELS", ...Object.keys(expectedKeys)] });
  const storedTaskModels = unwrapConfigValue(confirmed?.config?.AI_TASK_MODELS) ?? {};
  if (JSON.stringify(storedTaskModels) !== JSON.stringify(expectedTaskModels)) {
    throw new Error("AI model selection was not persisted. Please retry.");
  }
  for (const [row, value] of Object.entries(expectedKeys)) {
    const stored = unwrapConfigValue(confirmed?.config?.[row]);
    if ((typeof stored === "string" ? stored : "") !== value) {
      throw new Error(value ? "An API key change was not persisted. Please retry." : "An API key was not cleared. Please retry.");
    }
  }

  return confirmed;
}
