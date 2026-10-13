import { CharacterCatalogDependencyError, CharacterReferenceValidationError, AssetTagApplyError, normalizeCharacterIds } from "./ai-tagging-shared.js";
import { AiTagCursorError } from "../ai-tag-cursor.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState, OpenRouterBatchJobState } from "../types.js";
import type { ChatCompletionRequest } from "../openrouter.js";
import { accountFingerprint, assertProviderSubmissionLeaseBudget } from "../batch-provider.js";
import { createStoredMetaResponse, retrieveStoredMetaResponse, parseMetaResponse, isTerminalMetaModelApiError, metaModelId, metaAsyncBusy, MetaCapacityRejectionError, MODEL_NOT_FOUND_RETRY_DELAYS_MS } from "../meta-model-api.js";
import { PreSubmissionError } from "../batch-submission-error.js";
import { nextBatchAction, clearRequestJob, transientPollDelayMs } from "./ai-tagging-batch-state.js";
import { parseStructuredJson } from "../structured-output.js";

export const META_TAG_METHODS = ["json_schema", "json_object", "tool_auto", "json_repair"] as const;
export interface MetaTagAttempt { asset_id: string; method_index: number; same_model_retry: number; repair_error?: string; }
export interface MetaTagCandidate { asset_id: string; next_cursor: number | string; done: boolean; }
export interface PreparedMetaTagRequest { request: ChatCompletionRequest; characterCatalogIds: string[]; }
export const MAX_META_CHARACTER_CATALOG_IDS = 4096;
function validCatalogBinding(value: unknown): value is string[] {
  try { return Array.isArray(value) && value.length <= MAX_META_CHARACTER_CATALOG_IDS && normalizeCharacterIds(value).length === value.length && value.every(id => typeof id === "string" && id === id.toLowerCase()); } catch { return false; }
}
function matchingBinding(a: string[], b: string[]): boolean { return a.length === b.length && a.every(id => b.includes(id)); }
export interface MetaTagDependencies {
  model: string; apiKey: string;
  candidate: () => Promise<MetaTagCandidate | null>;
  prepare: (id: string, method: typeof META_TAG_METHODS[number], repairError?: string) => Promise<PreparedMetaTagRequest | null>;
  validate: (value: Record<string, unknown>, binding: string[]) => void | Promise<void>;
  apply: (id: string, value: Record<string, unknown>, model: string, binding: string[]) => Promise<void>;
  create?: typeof createStoredMetaResponse; retrieve?: typeof retrieveStoredMetaResponse;
  now?: () => number;
  unavailable?: (error: unknown) => boolean;
  missing?: (error: unknown) => boolean;
}

/** One asset, one immutable provider response, the existing native receipt/clear protocol. */
export async function handleMetaTagResponse(state: OpState, deps: MetaTagDependencies): Promise<BatchResult> {
  if (!deps.apiKey) throw new PreSubmissionError("No Meta API key configured", true);
  const now = deps.now?.() ?? Date.now(); const iso = new Date(now).toISOString();
  const cursor = state.cursor ?? 0; const job = state.external_job;
  const attempt = state.meta_tag_attempt;
  if (attempt && (!Number.isSafeInteger(attempt.method_index) || attempt.method_index < 0 || attempt.method_index >= META_TAG_METHODS.length || !Number.isSafeInteger(attempt.same_model_retry) || attempt.same_model_retry < 0 || attempt.same_model_retry > 1)) {
    return { ok: false, done: false, error: "Invalid saved Meta tagging attempt", error_code: "contract_error" };
  }
  const owner = state.run_id ?? "unassigned-meta-operation";
  if ((!job || job.phase === "prepared" || job.phase === "submitting" && !job.provider_batch_id) && metaAsyncBusy(owner)) return { ok: true, done: false, nextOffset: cursor, state_transition: "yield_without_save" };
  if (!job) {
    let candidate: MetaTagCandidate | null;
    try { candidate = await deps.candidate(); }
    catch (error) {
      if (error instanceof AiTagCursorError) return { ok: false, done: false, error: error.message, error_code: error.code, error_stage: "candidate_fetch" };
      throw error;
    }
    if (!candidate) return { ok: true, done: true, nextOffset: cursor };
    if (attempt && attempt.asset_id !== candidate.asset_id) return { ok: false, done: false, error: "Saved Meta attempt targets a different asset", error_code: "contract_error" };
    const methodIndex = attempt?.method_index ?? 0;
    let prepared: PreparedMetaTagRequest | null;
    try { prepared = await deps.prepare(candidate.asset_id, META_TAG_METHODS[methodIndex], attempt?.repair_error); }
    catch (error) {
      if (deps.missing?.(error)) return { ok: true, done: candidate.done, nextOffset: candidate.next_cursor, skipped: 1, meta_tag_attempt: null, skip_samples: [{ at: iso, asset_id: candidate.asset_id, reason: "Asset no longer exists" }] };
      if (deps.unavailable?.(error)) return { ok: true, done: candidate.done, nextOffset: candidate.next_cursor, visual_analysis_unavailable: 1, meta_tag_attempt: null };
      if (error instanceof CharacterCatalogDependencyError) return { ok: false, done: false, error: "Character catalog dependency failed before submission", error_code: "dependency_timeout", error_stage: "asset_fetch" };
      const message = error instanceof Error ? error.message : "Meta asset preparation failed before submission";
      const transient = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|timed out|fetch failed|57014|502|503|504|connection refused|too many connections/i.test(message));
      if (transient) return { ok: false, done: false, error: `Dependency timed out before Meta submission: ${message}`, error_code: "dependency_timeout", error_stage: "asset_fetch" };
      throw new PreSubmissionError(message, true);
    }
    if (!prepared) return { ok: true, done: candidate.done, nextOffset: candidate.next_cursor, skipped: 1, meta_tag_attempt: null };
    if (!validCatalogBinding(prepared.characterCatalogIds)) return { ok: false, done: false, error: "Invalid or oversized supplied character catalog binding", error_code: "contract_error" };
    return { ok: true, done: false, nextOffset: cursor,
      meta_tag_attempt: attempt ?? { asset_id: candidate.asset_id, method_index: 0, same_model_retry: 0 },
      transient_prepared_batch: prepared,
      external_job: { version: 1, meta_character_catalog_ids: prepared.characterCatalogIds, provider: "meta-responses", model: deps.model, phase: "prepared", output_method: META_TAG_METHODS[methodIndex] === "json_repair" ? "json_object" : META_TAG_METHODS[methodIndex] as "json_schema" | "json_object" | "tool_auto", prepared_at: iso,
        page_cursor: cursor, next_cursor: candidate.next_cursor, operation_done_after_clear: candidate.done,
        items: [{ asset_id: candidate.asset_id, custom_id: `meta:${state.run_id}:${candidate.asset_id}`, status: "prepared" }] }, last_stage: "state_persist" };
  }
  if (job.provider !== "meta-responses" || job.model !== deps.model || !attempt || job.items?.length !== 1 || job.items[0].asset_id !== attempt.asset_id || job.output_method !== (META_TAG_METHODS[attempt.method_index] === "json_repair" ? "json_object" : META_TAG_METHODS[attempt.method_index])) {
    return { ok: false, done: false, error: "Saved Meta response scope/model/attempt mismatch", error_code: "contract_error" };
  }
  if (!validCatalogBinding(job.meta_character_catalog_ids)) {
    if (job.meta_character_catalog_ids === undefined && job.phase === "prepared" && !job.provider_batch_id && !job.lease_token && !job.submission_owner && !job.lease_proof && !job.lease_expires_at && !job.lease_claimed_at) {
      let prepared: PreparedMetaTagRequest | null;
      try { prepared = await deps.prepare(attempt.asset_id, META_TAG_METHODS[attempt.method_index], attempt.repair_error); }
      catch (error) {
        const transport = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|timed out|fetch failed|57014|502|503|504|connection refused/i.test(error.message));
        if (error instanceof CharacterCatalogDependencyError || transport) return { ok: false, done: false, error: "Character catalog dependency failed before submission", error_code: "dependency_timeout", external_job: job };
        return { ok: false, done: false, error: "Legacy prepared Meta asset is unavailable or invalid; owned reconciliation required", error_code: "contract_error", external_job: job };
      }
      if (!prepared || !validCatalogBinding(prepared.characterCatalogIds)) return { ok: false, done: false, error: "Cannot bind legacy prepared Meta catalog", error_code: "contract_error", external_job: job };
      return { ok: true, done: false, nextOffset: cursor, transient_prepared_batch: prepared, external_job: { ...job, meta_character_catalog_ids: prepared.characterCatalogIds }, last_stage: "state_persist" };
    }
    return { ok: false, done: false, error: "Accepted or claimed Meta response lacks its supplied character catalog binding", error_code: "contract_error", external_job: job };
  }
  if (job.account_fingerprint && job.account_fingerprint !== accountFingerprint(deps.apiKey)) return { ok: false, done: false, error: "Meta account changed during saved response", error_code: "credential_changed" };
  if (job.phase === "submitting" && !job.provider_batch_id && job.meta_capacity_required_revision !== undefined) {
    if (job.next_poll_at && Date.parse(job.next_poll_at) > now) return { ok: true, done: false, nextOffset: cursor, state_transition: "yield_without_save" };
    if ((state.state_revision ?? 0) <= Number(job.meta_capacity_required_revision)) return { ok: true, done: false, nextOffset: cursor, state_transition: "claim_submission" };
  }
  const action = nextBatchAction(job, now);
  if (action.type === "blocked") return { ok: false, done: false, error: action.reason, error_code: "contract_error" };
  if (action.type === "wait") return { ok: true, done: false, nextOffset: cursor, state_transition: "yield_without_save" };
  if (action.type === "claim") return { ok: true, done: false, nextOffset: cursor, state_transition: "claim_submission", transient_prepared_batch: state.transient_prepared_batch };
  if (action.type === "clear") {
    const transition = metaCompletedTransition(state);
    if (!transition) return { ok: false, done: false, error: "Invalid Meta terminal clear transition", error_code: "contract_error" };
    const nextAttempt = transition.meta_tag_attempt;
    return { ok: true, done: !nextAttempt && job.operation_done_after_clear === true, nextOffset: nextAttempt ? cursor : job.next_cursor,
      meta_tag_attempt: nextAttempt ?? null, external_job: clearRequestJob(job, action.leaseToken), last_stage: "state_persist" };
  }
  if (action.type === "submit") {
    let prepared = state.transient_prepared_batch as PreparedMetaTagRequest | undefined;
    if (!prepared) {
      try { prepared = await deps.prepare(attempt.asset_id, META_TAG_METHODS[attempt.method_index], attempt.repair_error) ?? undefined; }
      catch { throw new PreSubmissionError("Meta preparation failed before submission"); }
    }
    if (!prepared || prepared.request.model !== deps.model) throw new PreSubmissionError("Prepared Meta request is unavailable", true);
    if (!validCatalogBinding(prepared.characterCatalogIds) || !matchingBinding(job.meta_character_catalog_ids, prepared.characterCatalogIds)) throw new PreSubmissionError("Rebuilt Meta prompt character catalog changed", true);
    const request = prepared.request;
    assertProviderSubmissionLeaseBudget(job.lease_expires_at);
    let id: string;
    try { id = await (deps.create ?? createStoredMetaResponse)(deps.apiKey, request, 60_000, owner, () => assertProviderSubmissionLeaseBudget(job.lease_expires_at)); }
    catch (error) {
      if (!(error instanceof MetaCapacityRejectionError)) throw error;
      const retries = Number(job.meta_capacity_retries ?? 0);
      if (!Number.isSafeInteger(retries) || retries < 0 || retries >= MODEL_NOT_FOUND_RETRY_DELAYS_MS.length) return { ok: false, done: false, error: "Meta Contributor known capacity retries exhausted; original submission receipt retained", error_code: "meta_capacity_exhausted", external_job: job };
      const delay = MODEL_NOT_FOUND_RETRY_DELAYS_MS[retries];
      return { ok: true, done: false, nextOffset: cursor, external_job: { ...job, meta_capacity_retries: retries + 1,
        meta_capacity_required_revision: (state.state_revision ?? 0) + 1,
        next_poll_at: new Date(now + delay + Math.random() * delay * 0.5).toISOString() }, last_stage: "model_inference" };
    }
    return { ok: true, done: false, nextOffset: cursor, external_job: { ...job, phase: "pending", provider_batch_id: id, submitted_at: iso,
      account_fingerprint: accountFingerprint(deps.apiKey), next_poll_at: new Date(now + 10_000).toISOString(), lease_token: action.leaseToken,
      items: job.items.map(item => ({ ...item, status: "submitted" as const })) }, last_stage: "model_inference" };
  }
  let response: Record<string, unknown>;
  try { response = await (deps.retrieve ?? retrieveStoredMetaResponse)(deps.apiKey, action.batchId, 60_000); }
  catch (error) {
    const status = Number((error as { status?: number }).status);
    if (isTerminalMetaModelApiError(error) && status !== 429 && status < 500) return { ok: false, done: false, error: "Stored Meta response retrieval refused", error_code: "provider_error", external_job: job };
    // Meta can acknowledge the response before its stored result is visible.
    // Keep polling the accepted ID; this is not a new generation or failure.
    const submittedAt = Date.parse(job.submitted_at ?? "");
    if (status === 404 && Number.isFinite(submittedAt) && now >= submittedAt && now - submittedAt <= 120_000) {
      return { ok: true, done: false, nextOffset: cursor, external_job: { ...job, next_poll_at: new Date(now + 10_000).toISOString() }, last_stage: "model_inference" };
    }
    const failures = (job.transient_poll_failures ?? 0) + 1;
    return { ok: true, done: false, nextOffset: cursor, external_job: { ...job, transient_poll_failures: failures, next_poll_at: new Date(now + transientPollDelayMs(failures - 1)).toISOString() }, last_stage: "model_inference" };
  }
  if (response.id !== action.batchId) return { ok: false, done: false, error: "Retrieved Meta response ID mismatch", error_code: "contract_error" };
  if (response.model !== undefined && response.model !== metaModelId(deps.model)) return { ok: false, done: false, error: "Retrieved Meta response model mismatch", error_code: "contract_error" };
  if (response.status === "queued" || response.status === "in_progress") {
    const submittedMs = Date.parse(job.submitted_at ?? "");
    if (!Number.isFinite(submittedMs) || submittedMs > now) return { ok: false, done: false, error: "Stored Meta response has invalid submission time", error_code: "contract_error", external_job: job };
    if (now - submittedMs >= 30 * 60_000) return { ok: false, done: false, error: "Meta response remains active after the 30-minute observation bound; accepted ID retained for owned reconciliation", error_code: "meta_inference_deadline", external_job: job, last_stage: "model_inference" };
    return { ok: true, done: false, nextOffset: cursor,
      external_job: { ...job, next_poll_at: new Date(now + 10_000).toISOString(), transient_poll_failures: undefined }, last_stage: "model_inference" };
  }
  const completed = (changes: Partial<OpenRouterBatchJobState>, counts: Record<string, unknown> = {}): BatchResult => ({ ok: true, done: false, nextOffset: cursor,
    external_job: { ...job, ...changes, meta_asset_terminal: !changes.meta_next_attempt, phase: "completed", next_poll_at: undefined }, ...counts, last_stage: "state_persist" });
  if (!["completed", "failed", "incomplete", "cancelled"].includes(String(response.status))) return { ok: false, done: false, error: "Stored Meta response has unknown status", error_code: "contract_error", external_job: job };
  if (response.status !== "completed") return completed({}, { failed: 1, failure_samples: [{ at: iso, asset_id: attempt.asset_id, error: "Meta response ended without completed output" }] });
  const invalidResult = (error: unknown): BatchResult => {
    const message = error instanceof Error && error.message.startsWith("Model returned invalid ") ? error.message.slice(0, 500) : "Previous structured output could not be parsed or validated";
    const next = attempt.method_index + 1 < META_TAG_METHODS.length
      ? { ...attempt, method_index: attempt.method_index + 1, repair_error: message }
      : attempt.same_model_retry < 1 ? { ...attempt, method_index: 0, same_model_retry: 1, repair_error: message } : undefined;
    if (next) return completed({ meta_next_attempt: next });
    return completed({}, { failed: 1, failure_samples: [{ at: iso, asset_id: attempt.asset_id, error: "Meta structured output attempts exhausted" }] });
  };
  let value: Record<string, unknown>;
  try {
    const parsed = parseMetaResponse(response, deps.model);
    value = parsed.toolCalls?.[0]?.arguments ?? parseStructuredJson(parsed.content)!;
    if (!value) throw new Error("No structured output");
    await deps.validate(value, job.meta_character_catalog_ids);
  } catch (error) {
    if (error instanceof CharacterCatalogDependencyError) return { ok: false, done: false, error: error.message, error_code: "dependency_timeout", external_job: job };
    return invalidResult(error);
  }
  if (job.phase === "pending") {
    const usage = response.usage && typeof response.usage === "object" ? response.usage as Record<string, unknown> : {};
    logger.info("meta-tag: stored generation completed", { elapsed_ms: Math.max(0, now - Date.parse(job.submitted_at ?? iso)),
      input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
      output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
      total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined });
  }
  // The pending-to-applying checkpoint prevents a restart from issuing a new POST.
  if (job.phase !== "applying") return { ok: true, done: false, nextOffset: cursor, external_job: { ...job, phase: "applying", next_poll_at: undefined }, last_stage: "tag_write" };
  try { await deps.apply(attempt.asset_id, value, deps.model, job.meta_character_catalog_ids); }
  catch (error) {
    if (error instanceof CharacterReferenceValidationError) return invalidResult(error);
    if (error instanceof CharacterCatalogDependencyError) return { ok: false, done: false, error: error.message, error_code: "dependency_timeout", external_job: job };
    logger.warn("meta-tag: result save failed", { stage: error instanceof AssetTagApplyError ? error.stage : "apply", error_code: error instanceof CharacterCatalogDependencyError || error instanceof AssetTagApplyError ? error.code : "unknown" });
    const failures = Number(job.meta_apply_failures ?? 0) + 1;
    if (failures >= 5) return completed({}, { failed: 1, failure_samples: [{ at: iso, asset_id: attempt.asset_id, error: "Meta result save failed after bounded retries" }] });
    return { ok: true, done: false, nextOffset: cursor, external_job: { ...job, meta_apply_failures: failures, next_poll_at: new Date(now + transientPollDelayMs(failures - 1)).toISOString() }, last_stage: "tag_write" };
  }
  return completed({ items: job.items.map(item => ({ ...item, status: "applied" })) }, { tagged: 1 });
}

export function metaCompletedTransition(stored: OpState): Partial<OpState> | null {
  const storedJob = stored.external_job;
  if (!storedJob || storedJob.provider !== "meta-responses" || storedJob.phase !== "completed") return null;
  const attempt = stored.meta_tag_attempt;
  const next = storedJob.meta_next_attempt as OpState["meta_tag_attempt"];
  const assetId = storedJob.items?.length === 1 ? storedJob.items[0].asset_id : null;
  const validAttempt = (value: OpState["meta_tag_attempt"]): boolean => !!value && value.asset_id === assetId &&
    Number.isSafeInteger(value.method_index) && value.method_index >= 0 && value.method_index < 4 &&
    Number.isSafeInteger(value.same_model_retry) && value.same_model_retry >= 0 && value.same_model_retry <= 1;
  if (!assetId || !validAttempt(attempt)) return null;
  const ids = Array.isArray(stored.params?.asset_ids) ? stored.params!.asset_ids as unknown[] : null;
  if (ids?.length) {
    if (typeof stored.cursor !== "number" || !Number.isSafeInteger(stored.cursor) || ids[stored.cursor] !== assetId || storedJob.next_cursor !== stored.cursor + 1) return null;
  } else {
    if (typeof storedJob.next_cursor !== "string" || !/^ai1:\d+:[0-9a-f-]+$/i.test(storedJob.next_cursor) || !storedJob.next_cursor.endsWith(`:${assetId.toLowerCase()}`)) return null;
  }
  if (next !== undefined) {
    if (!validAttempt(next) || storedJob.meta_asset_terminal !== false || !attempt || !next || !(
    next.same_model_retry === attempt.same_model_retry && next.method_index === attempt.method_index + 1 ||
    attempt.method_index === 3 && attempt.same_model_retry === 0 && next.method_index === 0 && next.same_model_retry === 1
    )) return null;
    return { meta_tag_attempt: next, cursor: stored.cursor, status: "running" };
  } else {
    if (storedJob.meta_asset_terminal !== true) return null;
    return { meta_tag_attempt: null, cursor: storedJob.next_cursor, status: storedJob.operation_done_after_clear === true ? "completed" : "running" };
  }
}


export async function advanceMetaCapabilityRejection(
  rpc: import("../provider-submission-recovery.js").RpcCall,
  receipt: import("../provider-submission-recovery.js").SubmissionReceipt,
  state: OpState,
  rejection: import("../meta-model-api.js").MetaCapabilityRejectionError,
): Promise<OpState | null> {
  const job = state.external_job; const attempt = state.meta_tag_attempt;
  if (job?.provider !== "meta-responses" || job.provider_batch_id || !attempt || job.items?.length !== 1 || job.items[0].asset_id !== attempt.asset_id || attempt.method_index < 0 || attempt.method_index > 3 || attempt.same_model_retry < 0 || attempt.same_model_retry > 1) return null;
  const next = attempt.method_index < 3 ? { ...attempt, method_index: attempt.method_index + 1 } : attempt.same_model_retry === 0 ? { ...attempt, method_index: 0, same_model_retry: 1 } : null;
  if (!next) return null;
  const { resetSubmissionLease, DEFINITIVE_REJECTION_REASON } = await import("../provider-submission-recovery.js");
  const reset = await resetSubmissionLease(rpc, receipt, DEFINITIVE_REJECTION_REASON, rejection.status, rejection.providerError);
  const prepared = reset.operation.external_job!;
  const { last_definitive_rejection_at: _at, last_definitive_rejection_reason: _reason, last_definitive_rejection_status: _status, ...cleanJob } = prepared;
  const nextState: OpState = { ...reset.operation, meta_tag_attempt: next, external_job: { ...cleanJob, output_method: META_TAG_METHODS[next.method_index] === "json_repair" ? "json_object" : META_TAG_METHODS[next.method_index] as "json_schema" | "json_object" | "tool_auto" }, updated_at: new Date().toISOString() };
  const saved = await rpc("update_bulk_operation", { p_op_key: receipt.opKey, p_op_state: nextState, p_only_if_status: "running", p_expected_revision: reset.stateRevision });
  const envelope = saved.data as { ok?: boolean; state_revision?: number } | null;
  if (saved.error || envelope?.ok !== true || typeof envelope.state_revision !== "number") throw new Error("Meta rejected-capability transition refused; no new submission is authorized");
  return nextState;
}
