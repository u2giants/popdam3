import { chatCompletion, isTerminalOpenRouterError, tool, type ChatCompletionRequest, type ChatMessage, type OpenRouterProviderInfo } from "./openrouter.js";
import { recordOpenRouterSchema, withOpenRouterTask } from "./openrouter-call-log.js";
import { buildStructuredOutputPlan, type CapabilityOverride, type ModelCapabilities, type StructuredOutputMethod } from "./model-capabilities.js";
import { recordProviderAttempt } from "./provider-health.js";

export interface OutputAttempt { method: StructuredOutputMethod; status: "success" | "failed"; latencyMs: number; requestedForm?: string; httpStatus?: number; error?: string; parse?: "ok" | "failed"; validation?: "ok" | "failed"; usage?: unknown; providerInfo?: OpenRouterProviderInfo; /** Endpoint that served or failed this call (e.g. straitly, openrouter). */ endpoint?: string; /** True when the endpoint itself failed (outage, overload, timeout), not the answer. */ endpointFailure?: boolean; }
export interface ExecuteStructuredOutputOptions<T> { apiKey: string; model: string; messages: ChatMessage[]; schemaName: string; schema: Record<string, unknown>; validate: (value: Record<string, unknown>) => T; capabilities: ModelCapabilities; override?: CapabilityOverride; timeoutMs?: number; maxTokens?: number; provider?: ChatCompletionRequest["provider"]; completion?: typeof chatCompletion; isTerminalError?: (error: unknown) => boolean; /** Stop starting new methods once this many ms have passed. */ budgetMs?: number; }

export function parseStructuredJson(content?: string): Record<string, unknown> | null {
  if (!content?.trim()) return null;
  const candidates = [content.trim(), content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], content.match(/\{[\s\S]*\}/)?.[0]];
  for (const candidate of candidates) try { const value = JSON.parse(candidate ?? ""); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* next */ }
  return null;
}
/**
 * True when an endpoint (not the model's answer) failed: no reply, a timeout,
 * or an overload/outage status. Account, request and content errors are not
 * endpoint failures. Only errors tagged with the endpoint that raised them count.
 */
export function isEndpointFailure(error: unknown): boolean {
  if (!error || typeof error !== "object" || typeof (error as { endpoint?: unknown }).endpoint !== "string") return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "number") return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Distinct endpoints whose own failure (see isEndpointFailure) ended an attempt. */
export function failedEndpoints(attempts: readonly OutputAttempt[] | undefined): string[] {
  return [...new Set((attempts ?? []).filter((a) => a.endpointFailure && a.endpoint).map((a) => a.endpoint as string))];
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

export function buildStructuredOutputRequest(options: Pick<ExecuteStructuredOutputOptions<unknown>, "model" | "messages" | "maxTokens" | "provider" | "schema" | "schemaName">, method: StructuredOutputMethod): ChatCompletionRequest {
  const request: ChatCompletionRequest = { model: options.model, messages: options.messages, max_tokens: options.maxTokens ?? 1500, provider: options.provider };
  if (method.startsWith("tool_")) {
    request.tools = [tool(options.schemaName, `Return structured ${options.schemaName} data.`, options.schema)];
    request.tool_choice = method === "tool_named" ? { type: "function", function: { name: options.schemaName } } : method === "tool_required" ? "required" : "auto";
  } else {
    request.messages = [...options.messages, { role: "user", content: `Return only one valid JSON object matching this JSON Schema: ${JSON.stringify(options.schema)}. No markdown or commentary.` }];
    request.response_format = method === "json_schema" ? { type: "json_schema", json_schema: { name: options.schemaName, strict: isStrictCompatibleSchema(options.schema), schema: options.schema } } : { type: "json_object" };
  }
  return request;
}

/** Adds hosts to skip to a request's provider preferences. */
export function withIgnoredProviders(provider: ChatCompletionRequest["provider"], ignored: string[]): ChatCompletionRequest["provider"] {
  if (ignored.length === 0) return provider;
  return { ...(provider ?? {}), ignore: [...new Set([...(provider?.ignore ?? []), ...ignored])] };
}

export async function executeStructuredOutput<T>(options: ExecuteStructuredOutputOptions<T>): Promise<{ value: T; outputMode: StructuredOutputMethod; attempts: OutputAttempt[]; usage?: unknown; providerInfo?: OpenRouterProviderInfo; repairCount: number }> {
  const completion = options.completion ?? chatCompletion;
  const isTerminalError = options.isTerminalError ?? isTerminalOpenRouterError;
  const attempts: OutputAttempt[] = [];
  let repairSource: string | null = null;
  let jsonMethodFailed = false;
  // A host that returns well-formed but invalid output (e.g. tag items with no
  // "tag") is skipped for the rest of this call, and the same method is tried
  // once more elsewhere, so one bad host does not walk the whole ladder.
  const ignored: string[] = [];
  const ladderStarted = Date.now();
  const plan = buildStructuredOutputPlan(options.capabilities, options.override);
  for (let index = 0; index < plan.length; index++) {
    const method = plan[index];
    if (options.budgetMs !== undefined && index > 0 && Date.now() - ladderStarted > options.budgetMs) break;
    const started = Date.now();
    let servedBy: string | null = null;
    const requestedForm = method === "tool_named" ? "tool_choice:named" : method === "tool_required" ? "tool_choice:required" : method === "tool_auto" ? "tool_choice:auto" : `response_format:${method}`;
    let stage: "transport" | "parse" | "validation" = "transport";
    try {
      const request = buildStructuredOutputRequest({ ...options, provider: withIgnoredProviders(options.provider, ignored) }, method);
      const result = await withOpenRouterTask(options.schemaName, () => completion(options.apiKey, request, options.timeoutMs));
      servedBy = result.providerInfo?.provider ?? null;
      stage = "parse";
      const candidate = result.toolCalls?.[0]?.arguments ?? parseStructuredJson(result.content);
      if (!candidate) throw new Error("No parsable structured output");
      stage = "validation";
      const value = options.validate(candidate);
      recordOpenRouterSchema({ task: options.schemaName, model: options.model, host: servedBy, ok: true });
      attempts.push({ method, status: "success", latencyMs: Date.now() - started, requestedForm, parse: "ok", validation: "ok", usage: result.usage, providerInfo: result.providerInfo });
      recordProviderAttempt(options.model, attempts[attempts.length - 1]);
      return { value, outputMode: method, attempts, usage: result.usage, providerInfo: result.providerInfo, repairCount: 0 };
    } catch (error) {
      const endpoint = (error as { endpoint?: unknown })?.endpoint;
      const endpointFailure = stage === "transport" && isEndpointFailure(error);
      if (stage !== "transport") recordOpenRouterSchema({ task: options.schemaName, model: options.model, host: servedBy, ok: false, errorClass: stage === "parse" ? "invalid_json" : "schema_invalid" });
      attempts.push({ method, status: "failed", latencyMs: Date.now() - started, requestedForm, httpStatus: (error as { status?: number })?.status, error: safe(error), parse: stage === "parse" ? "failed" : undefined, validation: stage === "validation" ? "failed" : undefined, providerInfo: (error as { providerInfo?: OpenRouterProviderInfo })?.providerInfo, endpoint: typeof endpoint === "string" ? endpoint : undefined, endpointFailure: endpointFailure || undefined });
      recordProviderAttempt(options.model, attempts[attempts.length - 1]);
      // Owner ruling 2026-11-27: an endpoint outage on Straitly is retried on
      // the second endpoint (OpenRouter) before the call gives up, even when
      // the error is otherwise terminal (429/5xx).
      if (endpointFailure && endpoint === "straitly" && !ignored.includes("straitly")) {
        ignored.push("straitly");
        plan.splice(index + 1, 0, method);
        continue;
      }
      if (isTerminalError(error)) throw Object.assign(error as Error, { attempts });
      repairSource = safe(error);
      if (method === "json_schema" || method === "json_object") jsonMethodFailed = true;
      if (stage === "validation" && servedBy && !ignored.includes(servedBy)) {
        ignored.push(servedBy);
        plan.splice(index + 1, 0, method);
      } else if (stage === "transport" && !ignored.includes("straitly")) {
        // Owner ruling 2026-11-26: an endpoint error retries the SAME model on
        // its backup endpoint (Straitly -> OpenRouter), never a different model.
        ignored.push("straitly");
        plan.splice(index + 1, 0, method);
      }
    }
  }
  if (repairSource && jsonMethodFailed && options.capabilities.jsonObject !== false) {
    let repaired: Awaited<ReturnType<typeof runJsonRepair<T>>>;
    try {
      repaired = await runJsonRepair({ ...options, provider: withIgnoredProviders(options.provider, ignored), completion, isTerminalError, repairSource });
    } catch (error) {
      const repairAttempts = (error as { attempts?: OutputAttempt[] }).attempts ?? [];
      throw Object.assign(error as Error, { attempts: [...attempts, ...repairAttempts] });
    }
    attempts.push(repaired.attempt);
    if (repaired.ok) return { value: repaired.value as T, outputMode: "json_repair", attempts, usage: repaired.usage, providerInfo: repaired.providerInfo, repairCount: 1 };
  }
  throw Object.assign(new Error(`Structured output failed: ${attempts.map((a) => `${a.method}: ${a.error}`).join("; ")}`), { attempts });
}

export interface JsonRepairOptions<T> {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  repairSource: string;
  schema?: Record<string, unknown>;
  validate: (value: Record<string, unknown>) => T;
  maxTokens?: number;
  timeoutMs?: number;
  provider?: ChatCompletionRequest["provider"];
  completion?: typeof chatCompletion;
  isTerminalError?: (error: unknown) => boolean;
}

export function buildJsonRepairRequest(options: Omit<JsonRepairOptions<unknown>, "validate">): ChatCompletionRequest {
  return { model: options.model, messages: [...options.messages, { role: "user", content: `A previous response failed validation: ${safe(options.repairSource)}. Return corrected JSON only.${options.schema ? ` Match this JSON Schema exactly: ${JSON.stringify(options.schema)}.` : ""}` }], response_format: { type: "json_object" }, max_tokens: options.maxTokens ?? 1500, temperature: 0, provider: options.provider };
}

/**
 * The single JSON-repair step: one json_object request on the SAME model,
 * parsed and validated. Shared by the synchronous ladder and the batch apply
 * paths. Terminal provider errors are rethrown with the attempt attached.
 */
export async function runJsonRepair<T>(options: JsonRepairOptions<T>): Promise<
  | { ok: true; value: T; attempt: OutputAttempt; usage?: unknown; providerInfo?: OpenRouterProviderInfo }
  | { ok: false; attempt: OutputAttempt }
> {
  const completion = options.completion ?? chatCompletion;
  const isTerminalError = options.isTerminalError ?? isTerminalOpenRouterError;
  const method: StructuredOutputMethod = "json_repair"; const started = Date.now();
  let stage: "transport" | "parse" | "validation" = "transport";
  try {
    const result = await withOpenRouterTask("json_repair", () => completion(options.apiKey, buildJsonRepairRequest(options), options.timeoutMs));
    stage = "parse"; const candidate = parseStructuredJson(result.content); if (!candidate) throw new Error("No parsable JSON after repair");
    stage = "validation";
    const value = options.validate(candidate);
    return { ok: true, value, usage: result.usage, providerInfo: result.providerInfo, attempt: { method, status: "success", latencyMs: Date.now() - started, requestedForm: "response_format:json_object", parse: "ok", validation: "ok", usage: result.usage, providerInfo: result.providerInfo } };
  } catch (error) {
    const attempt: OutputAttempt = { method, status: "failed", latencyMs: Date.now() - started, requestedForm: "response_format:json_object", httpStatus: (error as { status?: number })?.status, error: safe(error), parse: stage === "parse" ? "failed" : undefined, validation: stage === "validation" ? "failed" : undefined };
    if (isTerminalError(error)) throw Object.assign(error as Error, { attempts: [attempt] });
    return { ok: false, attempt };
  }
}
