import { chatCompletion, isTerminalOpenRouterError, tool, type ChatCompletionRequest, type ChatMessage, type OpenRouterProviderInfo } from "./openrouter.js";
import { buildStructuredOutputPlan, type CapabilityOverride, type ModelCapabilities, type StructuredOutputMethod } from "./model-capabilities.js";

export interface OutputAttempt { method: StructuredOutputMethod; status: "success" | "failed"; latencyMs: number; error?: string; parse?: "ok" | "failed"; validation?: "ok" | "failed"; usage?: unknown; providerInfo?: OpenRouterProviderInfo; }
export interface ExecuteStructuredOutputOptions<T> { apiKey: string; model: string; messages: ChatMessage[]; schemaName: string; schema: Record<string, unknown>; validate: (value: Record<string, unknown>) => T; capabilities: ModelCapabilities; override?: CapabilityOverride; timeoutMs?: number; maxTokens?: number; provider?: ChatCompletionRequest["provider"]; }

function parse(content?: string): Record<string, unknown> | null {
  if (!content?.trim()) return null;
  const candidates = [content.trim(), content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], content.match(/\{[\s\S]*\}/)?.[0]];
  for (const candidate of candidates) try { const value = JSON.parse(candidate ?? ""); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* next */ }
  return null;
}
function safe(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "[image removed]").slice(0, 500); }

/** OpenAI strict schemas require every declared property at every object level. */
export function isStrictCompatibleSchema(schema: Record<string, unknown>): boolean {
  if (schema.type === "object") {
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties as Record<string, Record<string, unknown>>
      : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (Object.keys(properties).some((key) => !required.includes(key))) return false;
    return Object.values(properties).every(isStrictCompatibleSchema);
  }
  if (schema.type === "array" && schema.items && typeof schema.items === "object") {
    return isStrictCompatibleSchema(schema.items as Record<string, unknown>);
  }
  return true;
}

export async function executeStructuredOutput<T>(options: ExecuteStructuredOutputOptions<T>): Promise<{ value: T; outputMode: StructuredOutputMethod; attempts: OutputAttempt[]; usage?: unknown; providerInfo?: OpenRouterProviderInfo; repairCount: number }> {
  const attempts: OutputAttempt[] = [];
  let repairSource: string | null = null;
  for (const method of buildStructuredOutputPlan(options.capabilities, options.override)) {
    const started = Date.now();
    try {
      const request: ChatCompletionRequest = { model: options.model, messages: options.messages, max_tokens: options.maxTokens ?? 1500, provider: options.provider };
      if (method.startsWith("tool_")) {
        request.tools = [tool(options.schemaName, `Return structured ${options.schemaName} data.`, options.schema)];
        request.tool_choice = method === "tool_named" ? { type: "function", function: { name: options.schemaName } } : method === "tool_required" ? "required" : "auto";
      } else {
        request.messages = [...options.messages, { role: "user", content: "Return only one valid JSON object matching the supplied contract. No markdown or commentary." }];
        request.response_format = method === "json_schema" ? { type: "json_schema", json_schema: { name: options.schemaName, strict: isStrictCompatibleSchema(options.schema), schema: options.schema } } : { type: "json_object" };
      }
      const result = await chatCompletion(options.apiKey, request, options.timeoutMs);
      const candidate = result.toolCalls?.[0]?.arguments ?? parse(result.content);
      if (!candidate) throw new Error("No parsable structured output");
      const value = options.validate(candidate);
      attempts.push({ method, status: "success", latencyMs: Date.now() - started, parse: "ok", validation: "ok", usage: result.usage, providerInfo: result.providerInfo });
      return { value, outputMode: method, attempts, usage: result.usage, providerInfo: result.providerInfo, repairCount: 0 };
    } catch (error) {
      attempts.push({ method, status: "failed", latencyMs: Date.now() - started, error: safe(error), providerInfo: (error as { providerInfo?: OpenRouterProviderInfo })?.providerInfo });
      if (isTerminalOpenRouterError(error)) throw Object.assign(error as Error, { attempts });
      repairSource = safe(error);
    }
  }
  if (repairSource) {
    const method: StructuredOutputMethod = "json_repair"; const started = Date.now();
    try {
      const result = await chatCompletion(options.apiKey, { model: options.model, messages: [...options.messages, { role: "user", content: `A previous response failed validation: ${repairSource}. Return corrected JSON only.` }], response_format: { type: "json_object" }, max_tokens: options.maxTokens ?? 1500, temperature: 0, provider: options.provider }, options.timeoutMs);
      const candidate = parse(result.content); if (!candidate) throw new Error("No parsable JSON after repair");
      const value = options.validate(candidate);
      attempts.push({ method, status: "success", latencyMs: Date.now() - started, parse: "ok", validation: "ok", usage: result.usage, providerInfo: result.providerInfo });
      return { value, outputMode: method, attempts, usage: result.usage, providerInfo: result.providerInfo, repairCount: 1 };
    } catch (error) { attempts.push({ method, status: "failed", latencyMs: Date.now() - started, error: safe(error) }); if (isTerminalOpenRouterError(error)) throw Object.assign(error as Error, { attempts }); }
  }
  throw Object.assign(new Error(`Structured output failed: ${attempts.map((a) => `${a.method}: ${a.error}`).join("; ")}`), { attempts });
}
