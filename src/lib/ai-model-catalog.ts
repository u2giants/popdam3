import { aiModelEndpoint, SCALEDOWN_SUMMARIZE_MODEL, type AiModelEndpoint } from "./ai-model-options";
import { formatOpenRouterPricing, type OpenRouterPricing } from "./openrouter-pricing";

export interface AiCatalogModel {
  id: string;
  name: string;
  supportsTools?: boolean;
  supportsStructuredOutputs?: boolean;
  supportsResponseFormat?: boolean;
  toolChoiceModes?: string[];
  inputModalities?: string[];
  imageInput?: boolean | null;
  contextLength?: number | null;
  pricing?: OpenRouterPricing | null;
  capabilitySource?: string;
}

/**
 * ScaleDown's summarize model never appears in the OpenRouter catalog — the
 * app calls it directly — so settings UIs inject this entry themselves. It
 * accepts an image through ScaleDown's non-standard `document` field, which is
 * why it qualifies for vision-required tasks.
 */
export const SCALEDOWN_SUMMARIZE_CATALOG_MODEL: AiCatalogModel & {
  supportsTools: boolean;
  supportsStructuredOutputs: boolean;
  supportsResponseFormat: boolean;
  toolChoiceModes: string[];
  inputModalities: string[];
} = {
  id: SCALEDOWN_SUMMARIZE_MODEL.id,
  name: SCALEDOWN_SUMMARIZE_MODEL.name,
  supportsTools: false,
  supportsStructuredOutputs: false,
  supportsResponseFormat: false,
  toolChoiceModes: [],
  inputModalities: ["text", "image"],
  imageInput: true,
  contextLength: null,
  // ScaleDown list price: $0.05 per 1M input tokens, no completion charge.
  pricing: { prompt: "0.00000005", completion: "0" },
  capabilitySource: "direct_provider",
};

export type AiCapabilityChip =
  | "vision"
  | "text"
  | "tools"
  | "tool-choice"
  | "json-schema"
  | "json-mode"
  | "batch";

export const CAPABILITY_CHIP_LABELS: Record<AiCapabilityChip, string> = {
  vision: "Vision",
  text: "Text",
  tools: "Tools",
  "tool-choice": "Tool choice",
  "json-schema": "JSON schema",
  "json-mode": "JSON mode",
  batch: "Batch",
};

export interface TaskModelRequirements {
  key: string;
  label: string;
  description: string;
  requiresVision?: boolean;
  requiresTools?: boolean;
  requiresStructuredOutput?: boolean;
  fallbackKey?: string;
  providerPinKey?: string;
}

export function modelEndpointOf(modelId: string): AiModelEndpoint {
  return aiModelEndpoint(modelId);
}

export function modelAcceptsImage(model: AiCatalogModel): boolean {
  if (typeof model.imageInput === "boolean") return model.imageInput;
  return (model.inputModalities ?? []).includes("image");
}

export function modelCapabilityChips(model: AiCatalogModel): AiCapabilityChip[] {
  const chips: AiCapabilityChip[] = [];
  if (modelAcceptsImage(model)) chips.push("vision");
  chips.push("text");
  if (model.supportsTools) chips.push("tools");
  if ((model.toolChoiceModes ?? []).length > 0 || model.supportsTools) chips.push("tool-choice");
  if (model.supportsStructuredOutputs) chips.push("json-schema");
  if (model.supportsResponseFormat) chips.push("json-mode");
  if (model.id.endsWith(":batch")) chips.push("batch");
  return chips;
}

export function modelStructuredOutputSummary(model: AiCatalogModel): string {
  const parts: string[] = [];
  if (model.supportsTools) {
    const modes = model.toolChoiceModes ?? [];
    if (modes.includes("named")) parts.push("tool (named)");
    else if (modes.includes("required")) parts.push("tool (required)");
    else parts.push("tool (auto)");
  }
  if (model.supportsStructuredOutputs) parts.push("schema");
  if (model.supportsResponseFormat) parts.push("json");
  return parts.join(" · ");
}

export function modelPricingLabel(model: AiCatalogModel): string {
  return formatOpenRouterPricing(model.pricing) ?? "pricing n/a";
}

export function modelOptionLabel(model: AiCatalogModel, displayNames?: Record<string, string>): string {
  return displayNames?.[model.id] || model.name || model.id;
}

export function modelMeetsTaskRequirements(model: AiCatalogModel, requirements: Pick<TaskModelRequirements, "requiresVision" | "requiresTools" | "requiresStructuredOutput">): boolean {
  if (requirements.requiresVision && !modelAcceptsImage(model)) return false;
  if (requirements.requiresTools && !model.supportsTools) return false;
  if (requirements.requiresStructuredOutput && !(model.supportsTools || model.supportsStructuredOutputs || model.supportsResponseFormat)) return false;
  return true;
}

export function taskRequirementChips(requirements: Pick<TaskModelRequirements, "requiresVision" | "requiresTools" | "requiresStructuredOutput">): string[] {
  const chips: string[] = [];
  if (requirements.requiresVision) chips.push("Vision input");
  if (requirements.requiresTools) chips.push("Tool use");
  if (requirements.requiresStructuredOutput) chips.push("Structured JSON (tools, schema, or JSON mode)");
  return chips;
}
