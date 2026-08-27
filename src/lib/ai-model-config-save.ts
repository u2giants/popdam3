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
}

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
  const entries: Record<string, unknown> = {
    AI_MODELS: models,
    AI_TASK_MODELS: expectedTaskModels,
    AI_MODEL_DISPLAY_NAMES: { ...draft.displayNames },
  };
  if (draft.openRouterKey.trim()) entries.OPENROUTER_API_KEY = draft.openRouterKey.trim();
  if (draft.googleKey.trim()) entries.GOOGLE_AI_API_KEY = draft.googleKey.trim();
  if (draft.anthropicKey.trim()) entries.ANTHROPIC_API_KEY = draft.anthropicKey.trim();
  if (draft.openaiKey.trim()) entries.OPENAI_API_KEY = draft.openaiKey.trim();

  await call("set-config", { entries });

  // Do not report success from the write response alone. Read the authoritative
  // value back through the same admin contract and prove the selected models
  // are what production stored.
  const confirmed = await call("get-config", { keys: ["AI_TASK_MODELS"] });
  const storedTaskModels = unwrapConfigValue(confirmed?.config?.AI_TASK_MODELS) ?? {};
  if (JSON.stringify(storedTaskModels) !== JSON.stringify(expectedTaskModels)) {
    throw new Error("AI model selection was not persisted. Please retry.");
  }

  return confirmed;
}
